/**
 * Shared route failure vocabulary: the status mapping, the stderr classifier and
 * the JSON error writer used by both the read routes and the write actions.
 *
 * @module dsh-session-map/git-workspace/host-errors
 */
import type { GitWindowErrorCode } from './git-types'
import { sendJson, type RouteResponse } from './host-http'

/** One route failure with its HTTP mapping. */
export class RouteFailure extends Error {
  readonly code: GitWindowErrorCode
  readonly status: number
  readonly detail: string | undefined

  constructor(code: GitWindowErrorCode, status: number, message: string, detail?: string) {
    super(message)
    this.name = 'RouteFailure'
    this.code = code
    this.status = status
    this.detail = detail
  }
}

/** Map one failure code onto an HTTP status. */
export function statusFor(code: GitWindowErrorCode): number {
  switch (code) {
    case 'invalid-request':
    case 'invalid-path':
    case 'invalid-ref':
    case 'unsupported-action':
      return 400
    case 'workspace-not-found':
      return 404
    case 'not-a-repository':
      return 200
    case 'busy':
    case 'lock':
    case 'conflict':
    case 'stash-conflict':
    case 'branch-not-merged':
    case 'branch-checked-out':
    case 'dirty-worktree':
    case 'no-upstream':
    case 'push-rejected':
    case 'hook-failed':
    case 'detached-head':
    case 'safe-directory':
      return 409
    case 'auth-required':
      return 401
    case 'git-not-found':
    case 'parse-failed':
    case 'internal':
      return 500
    case 'network':
      return 502
    case 'timeout':
      return 504
    case 'cancelled':
      return 499
    default:
      return 500
  }
}

/**
 * Map git stderr onto a stable route failure.
 * @param stderr - collected stderr.
 * @param exitCode - finished exit code.
 * @returns the failure with its HTTP status.
 */
export function classifyFailure(stderr: string, exitCode: number | null): RouteFailure {
  const text = stderr.toLowerCase()
  if (text.includes('detected dubious ownership')) {
    return new RouteFailure('safe-directory', 409, 'the repository owner does not match the current user', stderr)
  }
  if (text.includes('index.lock') || text.includes('another git process')) {
    return new RouteFailure('lock', 409, 'another git process is operating the repository', stderr)
  }
  if (/authentication failed|could not read username|terminal prompts disabled|permission denied \(publickey\)|host key verification failed/.test(text)) {
    return new RouteFailure('auth-required', 401, 'git authentication failed', stderr)
  }
  if (/could not resolve host|unable to access|failed to connect|connection timed out|network is unreachable/.test(text)) {
    return new RouteFailure('network', 502, 'the remote host could not be reached', stderr)
  }
  if (text.includes('has no upstream branch')) {
    return new RouteFailure('no-upstream', 409, 'the branch has no upstream', stderr)
  }
  if (/would be overwritten|your local changes|commit your changes or stash/.test(text)) {
    return new RouteFailure('dirty-worktree', 409, 'the working tree has changes that would be overwritten', stderr)
  }
  if (text.includes('not fully merged')) {
    return new RouteFailure('conflict', 409, 'the branch is not fully merged', stderr)
  }
  if (/unknown revision|not a valid object name|did not match any/.test(text)) {
    return new RouteFailure('invalid-ref', 400, 'the requested ref does not exist', stderr)
  }
  return new RouteFailure('internal', 500, `git exited with ${String(exitCode)}`, stderr)
}

/**
 * Write one route failure as JSON.
 * @param response - route response.
 * @param failure - the classified failure.
 */
export function sendRouteFailure(response: RouteResponse, failure: RouteFailure): void {
  sendJson(response, failure.status, {
    ok: false,
    error: {
      code: failure.code,
      message: failure.message,
      ...(failure.detail === undefined || failure.detail === '' ? {} : { detail: failure.detail.slice(-4096) }),
    },
  })
}
