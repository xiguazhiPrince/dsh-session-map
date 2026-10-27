/**
 * Host half of the "clone from Git" settings page.
 *
 * The handler keeps the two operations the page needs — a state probe and one
 * `git clone` followed by Workspace registration — and reports whether it
 * claimed the request. The route family's trust gate and JSON body cap are
 * applied by the dispatcher in `host.ts` before this handler runs.
 *
 * @module dsh-session-map/git-workspace/host-clone
 */
import type { GitHostPlatform } from './git'
import {
  classifyCloneFailure,
  cloneArgv,
  cloneFailureDetail,
  errorMessage,
  joinTargetPath,
  parentDirectoryOf,
  parseCloneRequest,
  repositoryNameFromAddress,
  type GitCloneFailureCode,
  type GitWorkspaceCloneEnvelope,
  type GitWorkspaceStateEnvelope,
} from './git'
import { GIT_WORKSPACE_ROUTE } from './route'
import { readJsonBody, sendJson, type RouteRequest, type RouteResponse } from './host-http'
import type { SubprocessHandle, SubprocessService } from './host-process'

/** One clone may run at a time; the page disables its button, but curls exist. */
const CLONE_TIMEOUT_MS = 15 * 60 * 1000

/** How much stdout/stderr one clone keeps in memory. */
const MAX_OUTPUT_BYTES = 256 * 1024

/** Grace period handed to the subprocess provider on termination. */
const GRACE_MS = 5_000

/** Host names that only ever identify this machine. */
export interface WorkspaceEntity {
  readonly id: unknown
  readonly path: string
  readonly title: string
}

/** The durable Workspace registry this handler writes to. */
export interface WorkspaceRegistryService {
  list(): readonly { readonly path: string }[]
  get(id: string): WorkspaceEntity | undefined
  create(path: string, title?: string): Promise<WorkspaceEntity>
}

/** The deployment fallback directory the page pre-fills. */
export interface WorkingDirectoryService {
  readonly defaultDirectory: string
}

/** One route handler that reports whether it claimed the request. */
export type CloneRouteHandler = (
  request: RouteRequest,
  response: RouteResponse,
  url: URL,
  method: string,
) => Promise<boolean>

/** Dependencies the clone handler reads. */
export interface CloneHandlerDeps {
  readonly subprocess: SubprocessService
  readonly workspaces: WorkspaceRegistryService
  readonly workingDirectory: WorkingDirectoryService | undefined
}

/**
 * Read the platform the clone must build paths for.
 * @param subprocess - the subprocess seam.
 * @returns the seam's platform, defaulting to POSIX when it cannot report one.
 */
async function readPlatform(subprocess: SubprocessService): Promise<GitHostPlatform> {
  try {
    const environment = await subprocess.terminalEnvironment()
    return environment.platform === 'windows' ? 'windows' : 'posix'
  } catch {
    return 'posix'
  }
}

/**
 * Build one failure response body.
 * @param code - stable failure code.
 * @param message - short English diagnosis.
 * @param detail - optional path or collected stderr.
 * @returns the clone envelope.
 */
function cloneFailure(
  code: GitCloneFailureCode | 'invalid-request',
  message: string,
  detail?: string,
): GitWorkspaceCloneEnvelope {
  return detail === undefined || detail === ''
    ? { ok: false, error: { code, message } }
    : { ok: false, error: { code, message, detail } }
}

/** Status code paired with one clone failure. */
function cloneFailureStatus(code: string): number {
  switch (code) {
    case 'invalid-request':
    case 'invalid-url':
    case 'unsupported-url':
    case 'invalid-directory':
    case 'parent-missing':
      return 400
    case 'busy':
    case 'target-exists':
    case 'workspace-failed':
      return 409
    case 'not-found':
      return 404
    case 'authentication':
      return 401
    case 'network':
      return 502
    case 'timeout':
      return 504
    default:
      return 500
  }
}

/** One clone failure as an HTTP result. */
function failureResult(
  code: GitCloneFailureCode,
  message: string,
  detail?: string,
): { readonly status: number; readonly body: GitWorkspaceCloneEnvelope } {
  return { status: cloneFailureStatus(code), body: cloneFailure(code, message, detail) }
}

/**
 * Install the Clone-from-Git handler and its Workspace registration.
 * @param deps - the subprocess seam and the Workspace registry.
 * @returns the route handler; it claims `/state` and `/clone` only.
 */
export function createCloneHandler(deps: CloneHandlerDeps): CloneRouteHandler {
  const { subprocess, workspaces, workingDirectory } = deps
  let cloning = false

  /** Report the two facts the page needs before it can offer a clone. */
  const readState = async (): Promise<GitWorkspaceStateEnvelope> => {
    let git: { available: boolean; path?: string }
    try {
      const path = await subprocess.resolveExecutable('git')
      git = { available: true, path }
    } catch {
      git = { available: false }
    }
    // Propose the projects root that already holds the newest Workspace; the
    // deployment fallback (often the home directory) only fills the gap.
    const newestWorkspace = workspaces.list()[0]
    const workspaceParent = newestWorkspace === undefined ? undefined : parentDirectoryOf(newestWorkspace.path)
    const defaultParentDir = workspaceParent
      ?? (typeof workingDirectory?.defaultDirectory === 'string' ? workingDirectory.defaultDirectory : null)
    return { ok: true, git, defaultParentDir }
  }

  /**
   * Validate one request, clone into the derived target, then add the Workspace.
   * The directory is the operation's only lasting side effect when Workspace
   * registration fails, so that failure reports the path instead of hiding it.
   */
  const runClone = async (
    body: unknown,
    response: RouteResponse,
  ): Promise<{ readonly status: number; readonly body: GitWorkspaceCloneEnvelope }> => {
    // The lock spans validation and every await below: between the check and
    // the first process launch the event loop can admit another request.
    if (cloning) {
      return { status: 409, body: cloneFailure('busy', 'another clone is already running') }
    }
    cloning = true
    try {
      return await cloneOnce(body, response)
    } finally {
      cloning = false
    }
  }

  /** One clone attempt; runs only while the single-clone lock is held. */
  const cloneOnce = async (
    body: unknown,
    response: RouteResponse,
  ): Promise<{ readonly status: number; readonly body: GitWorkspaceCloneEnvelope }> => {
    const parsed = parseCloneRequest(body)
    if (!parsed.ok) return failureResult(parsed.code, parsed.message)
    const { url, parentDir, shallow } = parsed.request
    const repoName = repositoryNameFromAddress(url)
    if (repoName === undefined) {
      return failureResult('invalid-url', 'no usable directory name can be derived from the repository address')
    }

    // The close listener must exist before the first await: a page that leaves
    // during lookup would otherwise keep a clone running with no consumer.
    const controller = new AbortController()
    let timedOut = false
    let abortedByClient = false
    let finished = false
    const timer = setTimeout(() => {
      timedOut = true
      controller.abort(new Error('git clone timed out'))
    }, CLONE_TIMEOUT_MS)
    const onClose = (): void => {
      if (finished) return
      abortedByClient = true
      controller.abort(new Error('the settings page closed the clone request'))
    }
    response.on('close', onClose)

    try {
      const targetPath = joinTargetPath(parentDir, repoName, await readPlatform(subprocess))

      let gitPath: string
      try {
        gitPath = await subprocess.resolveExecutable('git')
      } catch (error) {
        return failureResult('git-not-found', 'the git executable was not found on this machine', errorMessage(error))
      }

      let handle: SubprocessHandle
      try {
        handle = subprocess.spawn({
          argv: cloneArgv(gitPath, url, targetPath, shallow),
          cwd: parentDir,
          stdio: {
            stdin: 'ignore',
            stdout: { maxBytes: MAX_OUTPUT_BYTES },
            stderr: { maxBytes: MAX_OUTPUT_BYTES },
          },
          graceMs: GRACE_MS,
          signal: controller.signal,
          env: { GIT_TERMINAL_PROMPT: '0' },
        })
      } catch (error) {
        return failureResult('clone-failed', 'the git process could not be started', errorMessage(error))
      }

      let outcome
      try {
        outcome = await handle.done
      } catch (error) {
        if (timedOut) return failureResult('timeout', 'git clone exceeded the time limit', targetPath)
        if (abortedByClient) {
          return { status: 499, body: cloneFailure('clone-failed', 'the client aborted the clone request') }
        }
        const message = errorMessage(error)
        const missingDirectory = /ENOENT|no such file or directory/i.test(message)
        return missingDirectory
          ? failureResult('parent-missing', 'the parent directory does not exist', message)
          : failureResult('clone-failed', 'git clone could not start', message)
      }

      const stderr = handle.collected.stderr?.readFrom(0).text ?? ''
      const stdout = handle.collected.stdout?.readFrom(0).text ?? ''

      // A finished clone is a success even when a close or the timer raced it:
      // the directory exists, so registering it is the useful outcome.
      if (outcome.exitCode === 0) {
        try {
          const workspace = await workspaces.create(targetPath)
          return {
            status: 200,
            body: {
              ok: true,
              repoName,
              targetPath,
              workspace: { id: String(workspace.id), path: workspace.path, title: workspace.title },
            },
          }
        } catch (error) {
          return failureResult(
            'workspace-failed',
            'the repository was cloned but the workspace could not be added',
            `${targetPath}\n${errorMessage(error)}`,
          )
        }
      }
      if (timedOut) {
        return failureResult('timeout', 'git clone exceeded the time limit', cloneFailureDetail(stderr || stdout))
      }
      if (abortedByClient) {
        return { status: 499, body: cloneFailure('clone-failed', 'the client aborted the clone request') }
      }
      const failure = classifyCloneFailure(stderr)
      return failureResult(failure.code, failure.message, cloneFailureDetail(stderr || stdout))
    } finally {
      finished = true
      clearTimeout(timer)
    }
  }

  return async (request, response, url, method): Promise<boolean> => {
    if (url.pathname === `${GIT_WORKSPACE_ROUTE}/state`) {
      if (method !== 'GET') {
        sendJson(response, 405, { ok: false, error: { code: 'method-not-allowed', message: 'use GET' } })
        return true
      }
      sendJson(response, 200, await readState())
      return true
    }

    if (url.pathname === `${GIT_WORKSPACE_ROUTE}/clone`) {
      if (method !== 'POST') {
        sendJson(response, 405, { ok: false, error: { code: 'method-not-allowed', message: 'use POST' } })
        return true
      }
      // A browser form cannot set this header, so the gate also blocks
      // cross-site form posts that would otherwise be unauthenticated.
      const contentType = (request.headers['content-type'] ?? '').toString().toLowerCase()
      if (!contentType.includes('application/json')) {
        sendJson(response, 415, {
          ok: false,
          error: { code: 'unsupported-media-type', message: 'use application/json' },
        })
        return true
      }
      const body = await readJsonBody(request)
      if (!body.ok) {
        sendJson(response, body.status, cloneFailure('invalid-request', body.message))
        return true
      }
      const result = await runClone(body.value, response)
      sendJson(response, result.status, result.body)
      return true
    }

    return false
  }
}
