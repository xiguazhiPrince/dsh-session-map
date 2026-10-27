/**
 * Write actions for the Git tool window: confirmation tokens, the per-repository
 * mutation lock, action execution and failure classification.
 *
 * The pure argv/validation rules live in `git-actions.ts`; this module owns the
 * Host state that must not be recreated per request.
 *
 * @module dsh-session-map/git-workspace/host-actions
 */
import { randomUUID } from 'node:crypto'
import type { CommandReceipt, ResolvedRepo } from './git-types'
import { writeInvocation } from './git-command'
import {
  ACTION_POLICY,
  buildActionInvocations,
  confirmationTarget,
  parseActionRequest,
  type GitAction,
} from './git-actions'
import { RouteFailure, classifyFailure, sendRouteFailure, statusFor } from './host-errors'
import { readJsonBody, sendJson, type RouteRequest, type RouteResponse } from './host-http'
import { GitRunError, GitRunner } from './host-process'
import { GIT_WORKSPACE_ROUTE } from './route'

/** How long a confirmation token stays valid. */
const CONFIRM_TTL_MS = 60_000

/** One issued confirmation. */
interface Confirmation {
  readonly token: string
  readonly root: string
  readonly kind: GitAction['kind']
  readonly target: string
  readonly expiresAt: number
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

/**
 * Create the `/confirm` and `/action` routes.
 * @param service - runner, repository resolver and snapshot invalidation.
 * @returns a handler that claims only those two paths.
 */
export function createActionRouter(service: ActionService): ActionRouteHandler {
  const confirmations = new Map<string, Confirmation>()
  const running = new Set<string>()

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
  const execute = async (action: GitAction, repo: ResolvedRepo): Promise<{ readonly commands: CommandReceipt[]; readonly summary: string }> => {
    if (running.has(repo.root)) {
      throw new RouteFailure('busy', 409, 'another write operation is running on this repository')
    }
    running.add(repo.root)
    try {
      const gitPath = await service.runner.gitPath()
      const invocations = buildActionInvocations(action, { gitPath, root: repo.root })
      const commands: CommandReceipt[] = []
      for (const invocation of invocations) {
        const result = await service.runner.run(invocation)
        commands.push(result.receipt)
        if (result.exitCode !== 0) {
          // Unborn HEAD cannot restore from a commit; remove the index entry instead.
          if (action.kind === 'unstage' && /could not resolve HEAD/.test(result.stderr)) {
            const fallback = writeInvocation(gitPath, repo.root, ['rm', '--cached', '--', ...action.paths], { label: 'rm --cached' })
            const retry = await service.runner.run(fallback)
            commands.push(retry.receipt)
            if (retry.exitCode === 0) continue
          }
          throw actionFailure(action, result.stdout, result.stderr, result.exitCode)
        }
        if (result.stdout.trim() === '' && result.stderr.trim() === '' && invocation.label === 'clean-preview') {
          continue
        }
      }
      service.invalidate(repo.root)
      return { commands, summary: ACTION_POLICY[action.kind].summary }
    } finally {
      running.delete(repo.root)
    }
  }

  return async (request, response, url, method): Promise<boolean> => {
    if (url.pathname !== `${GIT_WORKSPACE_ROUTE}/confirm` && url.pathname !== `${GIT_WORKSPACE_ROUTE}/action`) {
      return false
    }
    try {
      if (method !== 'POST') throw new RouteFailure('invalid-request', 405, 'use POST')
      const contentType = (request.headers['content-type'] ?? '').toString().toLowerCase()
      if (!contentType.includes('application/json')) {
        throw new RouteFailure('invalid-request', 415, 'use application/json')
      }
      const body = await readJsonBody(request)
      if (!body.ok) throw new RouteFailure('invalid-request', body.status, body.message)
      const parsed = parseActionRequest(body.value)
      if (!parsed.ok) throw new RouteFailure(parsed.code, statusFor(parsed.code), parsed.message)
      const action = parsed.action
      const repo = await service.resolveRepo(action.workspaceId)

      if (url.pathname.endsWith('/confirm')) {
        const entry = issue(action, repo)
        sendJson(response, 200, { ok: true, token: entry.token, expiresAt: entry.expiresAt })
        return true
      }

      consume(confirmationOf(body.value), action, repo)
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
