/**
 * Write actions for the Git tool window: confirmation tokens, the per-repository
 * mutation lock, background jobs for network operations, action execution and
 * failure classification.
 *
 * The pure argv/validation rules live in `git-actions.ts`; this module owns the
 * Host state that must not be recreated per request.
 *
 * @module dsh-session-map/git-workspace/host-actions
 */
import { randomUUID } from 'node:crypto'
import type {
  CommandReceipt,
  GitJobStatus,
  GitJobView,
  GitWindowError,
  ResolvedRepo,
} from './git-types'
import { writeInvocation } from './git-command'
import {
  buildActionInvocations,
  confirmationTarget,
  parseActionRequest,
  policyFor,
  type GitAction,
} from './git-actions'
import { RouteFailure, classifyFailure, sendRouteFailure, statusFor } from './host-errors'
import { readJsonBody, sendJson, type RouteRequest, type RouteResponse } from './host-http'
import { GitRunError, GitRunner } from './host-process'
import { GIT_WORKSPACE_ROUTE } from './route'

/** How long a confirmation token stays valid. */
const CONFIRM_TTL_MS = 60_000

/** How long a finished job stays readable in memory. */
const JOB_TTL_MS = 5 * 60_000

/** How many progress lines one job keeps. */
const JOB_LINE_LIMIT = 400

/** Actions that may take long enough to deserve a background job. */
const LONG_ACTIONS: ReadonlySet<GitAction['kind']> = new Set(['fetch', 'update', 'push'])

/** One issued confirmation. */
interface Confirmation {
  readonly token: string
  readonly root: string
  readonly kind: GitAction['kind']
  readonly target: string
  readonly expiresAt: number
}

/** One running or finished job, including its private cancellation state. */
interface JobRecord {
  readonly id: string
  readonly kind: string
  readonly workspaceId: string
  readonly startedAt: number
  readonly controller: AbortController
  readonly lines: string[]
  readonly listeners: Set<(view: GitJobView) => void>
  status: GitJobStatus
  summary: string | undefined
  error: GitWindowError | undefined
  finishedAt: number | undefined
}

/** Operations the router needs from the read-route module. */
export interface ActionService {
  readonly runner: GitRunner
  resolveRepo(workspaceId: string): Promise<ResolvedRepo>
  /** Drop the cached snapshot after a write. */
  invalidate(root: string): void
}

/** One claimed-route handler. */
export type ActionRouteHandler = (
  request: RouteRequest,
  response: RouteResponse,
  url: URL,
  method: string,
) => Promise<boolean>

/** Read one raw JSON object field. */
function asRecord(value: unknown): Record<string, unknown> | undefined {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return undefined
  return value as Record<string, unknown>
}

/** Read one required string field. */
function stringField(record: Record<string, unknown>, name: string): string {
  const value = record[name]
  if (typeof value !== 'string' || value === '') {
    throw new RouteFailure('invalid-request', 400, `"${name}" is required`)
  }
  return value
}

/** Classify a failed action run. */
function actionFailure(action: GitAction, stdout: string, stderr: string, exitCode: number | null): RouteFailure {
  const text = `${stdout}\n${stderr}`.toLowerCase()
  if (action.kind === 'commit') {
    if (/nothing to commit|no changes added to commit|nothing added to commit/.test(text)) {
      return new RouteFailure('nothing-to-commit', 409, 'there is nothing staged to commit', stderr || stdout)
    }
    if (/committing is not possible|unmerged files|fix conflicts/.test(text)) {
      return new RouteFailure('conflict', 409, 'unresolved conflicts block the commit', stderr || stdout)
    }
    if (/hook declined|pre-commit|commit-msg|commit-msg hook|husky/.test(text)) {
      return new RouteFailure('hook-failed', 409, 'a git hook rejected the commit', stderr || stdout)
    }
  }
  if (action.kind === 'push' && /rejected|non-fast-forward|failed to push|fetch first|protected branch/.test(text)) {
    return new RouteFailure('push-rejected', 409, 'the push was rejected by the remote', stderr || stdout)
  }
  if (action.kind === 'update' && /conflict|automatic merge failed|needs merge/.test(text)) {
    return new RouteFailure('conflict', 409, 'the update produced conflicts', stderr || stdout)
  }
  if ((action.kind === 'merge' || action.kind === 'rebase' || action.kind === 'cherryPick' || action.kind === 'revert')
    && /conflict|automatic merge failed|needs merge|could not apply/.test(text)) {
    return new RouteFailure('conflict', 409, 'the operation produced conflicts', stderr || stdout)
  }
  if (action.kind === 'continueOperation' && /no merge|no rebase|no cherry-pick|no revert|not in the middle|nothing to commit/.test(text)) {
    return new RouteFailure('conflict', 409, 'no operation is in progress', stderr || stdout)
  }
  if (action.kind === 'stashPop' && /conflict|needs merge|automatic merge failed/.test(text)) {
    return new RouteFailure(
      'stash-conflict',
      409,
      'the stash could not be applied cleanly; resolve the conflicts, stage the files, then drop the stash',
      stderr || stdout,
    )
  }
  if (action.kind === 'tagCreate' && /already exists/.test(text)) {
    return new RouteFailure('invalid-request', 409, 'the tag already exists', stderr || stdout)
  }
  if (action.kind === 'deleteBranch' && /not fully merged/.test(text)) {
    return new RouteFailure('branch-not-merged', 409, 'the branch has commits that are not merged', stderr || stdout)
  }
  if (action.kind === 'deleteBranch' && /cannot delete branch|checked out at/.test(text)) {
    return new RouteFailure('branch-checked-out', 409, 'the branch is currently checked out', stderr || stdout)
  }
  return classifyFailure(stderr, exitCode)
}

/** Read the confirmation token out of an action body. */
function confirmationOf(body: unknown): string | undefined {
  const record = asRecord(body)
  const value = record?.['confirm']
  return typeof value === 'string' && value !== '' ? value : undefined
}

/** Public projection of one job. */
function jobView(record: JobRecord): GitJobView {
  return {
    id: record.id,
    kind: record.kind,
    workspaceId: record.workspaceId,
    status: record.status,
    lines: [...record.lines],
    ...(record.summary === undefined ? {} : { summary: record.summary }),
    ...(record.error === undefined ? {} : { error: record.error }),
    startedAt: record.startedAt,
    ...(record.finishedAt === undefined ? {} : { finishedAt: record.finishedAt }),
  }
}

/**
 * Create the write-route family: confirmation, action and job routes.
 * @param service - runner, repository resolver and snapshot invalidation.
 * @returns a handler that claims `/confirm`, `/action`, `/job`, `/cancel` and `/events`.
 */
export function createActionRouter(service: ActionService): ActionRouteHandler {
  const confirmations = new Map<string, Confirmation>()
  const running = new Set<string>()
  const jobs = new Map<string, JobRecord>()

  /** Drop expired tokens; called on every issue/consume. */
  const prune = (now: number): void => {
    for (const [token, entry] of confirmations) {
      if (entry.expiresAt <= now) confirmations.delete(token)
    }
  }

  /** Issue one single-use token for an action that needs confirmation. */
  const issue = (action: GitAction, repo: ResolvedRepo): Confirmation => {
    const target = confirmationTarget(action, repo.root)
    if (target === undefined) {
      throw new RouteFailure('unsupported-action', 400, 'this action does not need a confirmation')
    }
    prune(Date.now())
    const entry: Confirmation = {
      token: randomUUID(),
      root: repo.root,
      kind: action.kind,
      target,
      expiresAt: Date.now() + CONFIRM_TTL_MS,
    }
    confirmations.set(entry.token, entry)
    return entry
  }

  /** Consume a token, or fail with the precise mismatch code. */
  const consume = (token: string | undefined, action: GitAction, repo: ResolvedRepo): void => {
    const target = confirmationTarget(action, repo.root)
    if (target === undefined) return
    if (token === undefined) {
      throw new RouteFailure('confirmation-required', 409, 'this action requires an explicit confirmation')
    }
    prune(Date.now())
    const entry = confirmations.get(token)
    if (entry === undefined) {
      throw new RouteFailure('confirmation-required', 409, 'the confirmation expired or was already used')
    }
    confirmations.delete(token)
    if (entry.target !== target || entry.root !== repo.root || entry.kind !== action.kind) {
      throw new RouteFailure('confirmation-mismatch', 409, 'the confirmation does not match this action')
    }
  }

  /** Execute one action under the repository lock. */
  const execute = async (
    action: GitAction,
    repo: ResolvedRepo,
    signal?: AbortSignal,
    onProgress?: (line: string) => void,
  ): Promise<{ readonly commands: CommandReceipt[]; readonly summary: string }> => {
    if (running.has(repo.root)) {
      throw new RouteFailure('busy', 409, 'another write operation is running on this repository')
    }
    running.add(repo.root)
    try {
      const gitPath = await service.runner.gitPath()
      const invocations = buildActionInvocations(action, { gitPath, root: repo.root })
      const commands: CommandReceipt[] = []
      for (const invocation of invocations) {
        const result = await service.runner.run(invocation, signal, onProgress)
        commands.push(result.receipt)
        if (result.exitCode !== 0) {
          // Unborn HEAD cannot restore from a commit; remove the index entry instead.
          if (action.kind === 'unstage' && /could not resolve HEAD/.test(result.stderr)) {
            const fallback = writeInvocation(gitPath, repo.root, ['rm', '--cached', '--', ...action.paths], { label: 'rm --cached' })
            const retry = await service.runner.run(fallback, signal)
            commands.push(retry.receipt)
            if (retry.exitCode === 0) continue
          }
          throw actionFailure(action, result.stdout, result.stderr, result.exitCode)
        }
      }
      service.invalidate(repo.root)
      return { commands, summary: policyFor(action).summary }
    } finally {
      running.delete(repo.root)
    }
  }

  /** Create and start one background job. */
  const startJob = (action: GitAction, repo: ResolvedRepo): JobRecord => {
    if (running.has(repo.root)) {
      throw new RouteFailure('busy', 409, 'another write operation is running on this repository')
    }
    const record: JobRecord = {
      id: randomUUID(),
      kind: action.kind,
      workspaceId: action.workspaceId,
      startedAt: Date.now(),
      controller: new AbortController(),
      lines: [],
      listeners: new Set(),
      status: 'running',
      summary: undefined,
      error: undefined,
      finishedAt: undefined,
    }
    jobs.set(record.id, record)
    void (async () => {
      try {
        const result = await execute(action, repo, record.controller.signal, (line) => {
          if (record.lines.length < JOB_LINE_LIMIT) record.lines.push(line)
          const view = jobView(record)
          for (const listener of record.listeners) listener(view)
        })
        record.summary = result.summary
        record.status = 'done'
      } catch (error) {
        if (error instanceof GitRunError && error.code === 'cancelled') {
          record.status = 'cancelled'
        } else if (error instanceof RouteFailure) {
          record.status = 'failed'
          record.error = {
            code: error.code,
            message: error.message,
            ...(error.detail === undefined ? {} : { detail: error.detail }),
          }
        } else {
          record.status = 'failed'
          record.error = {
            code: error instanceof GitRunError ? error.code : 'internal',
            message: error instanceof Error ? error.message : String(error),
          }
        }
      } finally {
        record.finishedAt = Date.now()
        service.invalidate(repo.root)
        const view = jobView(record)
        for (const listener of record.listeners) listener(view)
        const timer = setTimeout(() => jobs.delete(record.id), JOB_TTL_MS)
        timer.unref?.()
      }
    })()
    return record
  }

  /** Stream one job as server-sent events. */
  const streamJob = (record: JobRecord, response: RouteResponse): void => {
    try {
      response.writeHead(200, {
        'content-type': 'text/event-stream; charset=utf-8',
        'cache-control': 'no-cache, no-store',
        connection: 'keep-alive',
      })
    } catch {
      return
    }
    const send = (view: GitJobView): void => {
      try {
        response.write?.(`data: ${JSON.stringify(view)}\n\n`)
      } catch {
        // The page closed the stream; the job keeps running until cancelled.
      }
    }
    let closed = false
    const close = (): void => {
      if (closed) return
      closed = true
      clearInterval(heartbeat)
      record.listeners.delete(listener)
      try {
        response.end()
      } catch {
        // Already closed.
      }
    }
    const listener = (view: GitJobView): void => {
      send(view)
      if (view.status !== 'running') close()
    }
    record.listeners.add(listener)
    const heartbeat = setInterval(() => {
      try {
        response.write?.(': ping\n\n')
      } catch {
        close()
      }
    }, 15_000)
    heartbeat.unref?.()
    response.on('close', close)
    send(jobView(record))
    if (record.status !== 'running') close()
  }

  return async (request, response, url, method): Promise<boolean> => {
    const path = url.pathname.slice(GIT_WORKSPACE_ROUTE.length)
    if (path !== '/confirm' && path !== '/action' && path !== '/job' && path !== '/cancel' && path !== '/events') {
      return false
    }
    try {
      const expectedMethod = path === '/job' || path === '/events' ? 'GET' : 'POST'
      if (method !== expectedMethod) throw new RouteFailure('invalid-request', 405, `use ${expectedMethod}`)

      if (path === '/events') {
        const record = jobs.get(requiredId(url, 'job'))
        if (record === undefined) throw new RouteFailure('invalid-request', 404, 'the job does not exist')
        streamJob(record, response)
        return true
      }

      if (path === '/job') {
        const record = jobs.get(requiredId(url, 'id'))
        if (record === undefined) throw new RouteFailure('invalid-request', 404, 'the job does not exist')
        sendJson(response, 200, { ok: true, job: jobView(record) })
        return true
      }

      const contentType = (request.headers['content-type'] ?? '').toString().toLowerCase()
      if (!contentType.includes('application/json')) {
        throw new RouteFailure('invalid-request', 415, 'use application/json')
      }
      const body = await readJsonBody(request)
      if (!body.ok) throw new RouteFailure('invalid-request', body.status, body.message)

      if (path === '/cancel') {
        const record = jobs.get(requiredIdFrom(objectOf(body.value)))
        if (record === undefined) throw new RouteFailure('invalid-request', 404, 'the job does not exist')
        if (record.status === 'running') record.controller.abort()
        sendJson(response, 200, { ok: true, job: jobView(record) })
        return true
      }

      const parsed = parseActionRequest(body.value)
      if (!parsed.ok) throw new RouteFailure(parsed.code, statusFor(parsed.code), parsed.message)
      const action = parsed.action
      const repo = await service.resolveRepo(action.workspaceId)

      if (path === '/confirm') {
        const entry = issue(action, repo)
        sendJson(response, 200, { ok: true, token: entry.token, expiresAt: entry.expiresAt })
        return true
      }

      consume(confirmationOf(body.value), action, repo)
      if (LONG_ACTIONS.has(action.kind)) {
        const record = startJob(action, repo)
        sendJson(response, 200, { ok: true, job: { id: record.id, status: 'running' } })
        return true
      }
      const result = await execute(action, repo)
      sendJson(response, 200, { ok: true, ...result })
      return true
    } catch (error) {
      if (error instanceof RouteFailure) {
        sendRouteFailure(response, error)
        return true
      }
      if (error instanceof GitRunError) {
        sendJson(response, statusFor(error.code), {
          ok: false,
          error: {
            code: error.code,
            message: error.message,
            ...(error.detail === undefined ? {} : { detail: error.detail.slice(-4096) }),
          },
        })
        return true
      }
      sendJson(response, 500, {
        ok: false,
        error: { code: 'internal', message: error instanceof Error ? error.message : String(error) },
      })
      return true
    }
  }
}

/** Read one required query id. */
function requiredId(url: URL, name: string): string {
  const value = url.searchParams.get(name)
  if (value === null || value === '') throw new RouteFailure('invalid-request', 400, `"${name}" is required`)
  return value
}

/** Read the job id out of a cancel body. */
function objectOf(value: unknown): Record<string, unknown> {
  const parsed = asRecord(value)
  if (parsed === undefined) throw new RouteFailure('invalid-request', 400, 'the request body must be an object')
  return parsed
}

/** Read the job id out of a cancel body. */
function requiredIdFrom(body: Record<string, unknown>): string {
  return stringField(body, 'id')
}
