/**
 * Host half of the Git workspace feature.
 *
 * Registers one same-origin route family under `/plugin-git-workspace` and owns
 * the two operations behind it:
 *
 * - `GET  /plugin-git-workspace/state` reports git availability and the
 *   default parent directory the page fills on first use.
 * - `POST /plugin-git-workspace/clone` validates the request, runs
 *   `git clone` through the subprocess seam, then registers the cloned
 *   directory with the durable Workspace registry. The registry publishes the
 *   new Workspace through its own follow stream, so the sidebar updates without
 *   this plugin touching client state.
 *
 * The page is a first-party Harness surface, so the route keeps the shipped
 * convention: plugin routes are unauthenticated by the web server, and each
 * mutating handler accepts only a loopback Host with a matching Origin.
 *
 * @module dsh-session-map/git-workspace/host
 */
import type { Context } from '@deepseek-ai/cordis'
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
  type GitHostPlatform,
  type GitWorkspaceCloneEnvelope,
  type GitWorkspaceStateEnvelope,
} from './git'

/** Route family shared by the page and the Host. */
export const GIT_WORKSPACE_ROUTE = '/plugin-git-workspace'

/** One clone may run at a time; the page disables its button, but curls exist. */
const CLONE_TIMEOUT_MS = 15 * 60 * 1000

/** Largest JSON request body the clone endpoint accepts. */
const MAX_BODY_BYTES = 16 * 1024

/** How much stdout/stderr one clone keeps in memory. */
const MAX_OUTPUT_BYTES = 256 * 1024

/** Grace period handed to the subprocess provider on termination. */
const GRACE_MS = 5_000

/** Host names that only ever identify this machine. */
const LOOPBACK_HOSTS = new Set(['127.0.0.1', 'localhost', '::1'])

/** Structural view of the context's untyped service lookup. */
interface ServiceLocator {
  get(name: string): unknown
}

/**
 * Read one optional service from the global store.
 * @param ctx - the plugin's context.
 * @param name - the service name.
 * @returns the service as the caller's local interface, or `undefined`.
 */
function lookup<T>(ctx: Context, name: string): T | undefined {
  const locator = ctx as unknown as ServiceLocator
  return locator.get(name) as T | undefined
}

/** The subset of a Node request the route reads. */
interface RouteRequest {
  readonly method?: string | undefined
  readonly url?: string | undefined
  readonly headers: Readonly<Record<string, string | string[] | undefined>>
  /** Real peer connection; the Host header alone is client-controlled. */
  readonly socket?: { readonly remoteAddress?: string } | undefined
  on(event: 'data', listener: (chunk: Uint8Array) => void): unknown
  on(event: 'end', listener: () => void): unknown
  on(event: 'close', listener: () => void): unknown
  on(event: 'aborted', listener: () => void): unknown
  on(event: 'error', listener: () => void): unknown
}

/** The subset of a Node response the route writes. */
interface RouteResponse {
  writeHead(status: number, headers?: Readonly<Record<string, string | number>>): unknown
  end(body?: string): unknown
  on(event: 'close', listener: () => void): unknown
}

/** One web-server route registration. */
interface WebRoute {
  readonly kind: 'exact' | 'prefix'
  readonly path: string
  readonly handler: (request: RouteRequest, response: RouteResponse) => void | Promise<void>
}

/** The web-server service this Host plugin registers into. */
interface WebServerService {
  getOrigin(): string
  register(route: WebRoute): () => void
}

/** Exit facts of one closed process. */
interface SubprocessOutcome {
  readonly exitCode: number | null
  readonly signal: string | null
}

/** One offset-based read of a collected stream. */
interface SubprocessOutputReader {
  readFrom(fromByte: number): { readonly text: string }
}

/** One spawned process, as far as a batch clone needs. */
interface SubprocessHandle {
  readonly done: Promise<SubprocessOutcome>
  readonly collected: {
    readonly stdout?: SubprocessOutputReader | undefined
    readonly stderr?: SubprocessOutputReader | undefined
  }
}

/** Per-stream dispositions; this feature uses collect mode for both outputs. */
interface SubprocessStdio {
  readonly stdin: 'ignore'
  readonly stdout: { readonly maxBytes: number }
  readonly stderr: { readonly maxBytes: number }
}

/** A fully specified spawn request. */
interface SubprocessSpawnSpec {
  readonly argv: readonly string[]
  readonly cwd: string
  readonly stdio: SubprocessStdio
  readonly graceMs: number
  readonly signal?: AbortSignal | undefined
  readonly env?: Readonly<Record<string, string | undefined>> | undefined
}

/** The subprocess seam this Host plugin calls. */
interface SubprocessService {
  resolveExecutable(command: string, env?: Readonly<Record<string, string>>, signal?: AbortSignal): Promise<string>
  terminalEnvironment(signal?: AbortSignal): Promise<{ readonly platform: 'posix' | 'windows' }>
  spawn(spec: SubprocessSpawnSpec): SubprocessHandle
}

/** One durable Workspace entity, as far as clone feedback needs. */
interface WorkspaceEntity {
  readonly id: unknown
  readonly path: string
  readonly title: string
}

/** The durable Workspace registry this Host plugin writes to. */
interface WorkspaceRegistryService {
  list(): readonly { readonly path: string }[]
  create(path: string, title?: string): Promise<WorkspaceEntity>
}

/** The deployment fallback directory the page pre-fills. */
interface WorkingDirectoryService {
  readonly defaultDirectory: string
}

/** Raise and format one JSON response; a closed connection is not an error. */
function sendJson(response: RouteResponse, status: number, value: unknown): void {
  const body = JSON.stringify(value)
  try {
    response.writeHead(status, {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store',
      'content-length': new TextEncoder().encode(body).byteLength,
    })
    response.end(body)
  } catch {
    // The page navigated away or reloaded while the clone ran; its response is gone.
  }
}

/**
 * Read one header value.
 * @param request - incoming request.
 * @param name - lower-case header name.
 * @returns the first value, or undefined when absent.
 */
function headerValue(request: RouteRequest, name: string): string | undefined {
  const value = request.headers[name]
  if (typeof value === 'string') return value
  if (Array.isArray(value)) return value[0]
  return undefined
}

/**
 * Whether a request may reach this route family.
 *
 * Plugin routes carry no server-side auth token, so a page loaded from another
 * origin could otherwise drive clones. Only a loopback Host, plus an Origin
 * that agrees with it when the browser sends one, is accepted.
 * @param request - incoming request.
 * @returns true when the request is same-machine.
 */
export function isTrustedRequest(request: RouteRequest): boolean {
  // The Host header is client-controlled, so the socket peer decides first:
  // a LAN or public bind must not let a remote raw-HTTP client spoof a
  // loopback Host and drive git clone on this machine.
  const peer = request.socket?.remoteAddress
  if (peer === undefined || !isLoopbackAddress(peer)) return false

  const host = headerValue(request, 'host')
  if (host === undefined || host === '') return false
  const hostname = host.startsWith('[')
    ? host.slice(0, host.indexOf(']') + 1).replace(/^\[|\]$/g, '').toLowerCase()
    : host.replace(/:\d+$/, '').toLowerCase()
  if (!LOOPBACK_HOSTS.has(hostname)) return false

  const origin = headerValue(request, 'origin')
  if (origin === undefined) return true
  try {
    return new URL(origin).host === host
  } catch {
    return false
  }
}

/**
 * Whether one connection peer belongs to this machine.
 * @param address - `socket.remoteAddress`.
 * @returns true for IPv4/IPv6 loopback, including mapped IPv4.
 */
function isLoopbackAddress(address: string): boolean {
  const value = address.toLowerCase()
  if (value.startsWith('::ffff:')) return isLoopbackAddress(value.slice(7))
  return value === '::1' || value === '127.0.0.1' || value.startsWith('127.')
}

/** Concatenate received request chunks. */
function concatChunks(chunks: readonly Uint8Array[], totalBytes: number): Uint8Array {
  const merged = new Uint8Array(totalBytes)
  let offset = 0
  for (const chunk of chunks) {
    merged.set(chunk, offset)
    offset += chunk.byteLength
  }
  return merged
}

/** Result of reading a JSON request body. */
type JsonBodyResult =
  | { readonly ok: true; readonly value: unknown }
  | { readonly ok: false; readonly status: 400 | 413; readonly message: string }

/**
 * Read a bounded JSON request body. The web server has no body parser, so the
 * route owns the stream.
 * @param request - incoming request.
 * @returns the decoded value, or a rejection message.
 */
async function readJsonBody(request: RouteRequest): Promise<JsonBodyResult> {
  return await new Promise<JsonBodyResult>((resolve) => {
    const chunks: Uint8Array[] = []
    let totalBytes = 0
    let settled = false
    const settle = (result: JsonBodyResult): void => {
      if (settled) return
      settled = true
      resolve(result)
    }
    request.on('data', (chunk) => {
      if (settled) return
      totalBytes += chunk.byteLength
      if (totalBytes > MAX_BODY_BYTES) {
        settle({ ok: false, status: 413, message: 'the request body is too large' })
        return
      }
      chunks.push(chunk)
    })
    request.on('end', () => {
      if (settled) return
      try {
        const text = new TextDecoder().decode(concatChunks(chunks, totalBytes)).trim()
        settle({ ok: true, value: text === '' ? {} : JSON.parse(text) as unknown })
      } catch {
        settle({ ok: false, status: 400, message: 'the request body is not valid JSON' })
      }
    })
    // 'close' is the portable terminal event: an aborted upload may never emit
    // 'end' or the deprecated 'aborted' event on every Node version.
    request.on('close', () => { settle({ ok: false, status: 400, message: 'the request was closed before its body completed' }) })
    request.on('aborted', () => { settle({ ok: false, status: 400, message: 'the request was aborted' }) })
    request.on('error', () => { settle({ ok: false, status: 400, message: 'the request stream failed' }) })
  })
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
 * Install the Clone-from-Git routes and their Workspace registration.
 *
 * Call this from a context that already provides `webServer`, `subprocess` and
 * `workspaceRegistry`; every registration is owned by an effect.
 * @param ctx - plugin context carrying the three host services.
 */
export function installGitWorkspaceHost(ctx: Context): void {
  const webServer = lookup<WebServerService>(ctx, 'webServer')
  const subprocess = lookup<SubprocessService>(ctx, 'subprocess')
  const workspaces = lookup<WorkspaceRegistryService>(ctx, 'workspaceRegistry')
  if (webServer === undefined || subprocess === undefined || workspaces === undefined) return

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
    const workingDirectory = lookup<WorkingDirectoryService>(ctx, 'workingDirectory')
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

      let outcome: SubprocessOutcome
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


  const handler = async (request: RouteRequest, response: RouteResponse): Promise<void> => {
    try {
      if (!isTrustedRequest(request)) {
        sendJson(response, 403, { ok: false, error: { code: 'forbidden', message: 'untrusted host' } })
        return
      }
      const url = new URL(request.url ?? '/', 'http://localhost')
      const method = (request.method ?? 'GET').toUpperCase()

      if (url.pathname === `${GIT_WORKSPACE_ROUTE}/state`) {
        if (method !== 'GET') {
          sendJson(response, 405, { ok: false, error: { code: 'method-not-allowed', message: 'use GET' } })
          return
        }
        sendJson(response, 200, await readState())
        return
      }

      if (url.pathname === `${GIT_WORKSPACE_ROUTE}/clone`) {
        if (method !== 'POST') {
          sendJson(response, 405, { ok: false, error: { code: 'method-not-allowed', message: 'use POST' } })
          return
        }
        // A browser form cannot set this header, so the gate also blocks
        // cross-site form posts that would otherwise be unauthenticated.
        const contentType = (headerValue(request, 'content-type') ?? '').toLowerCase()
        if (!contentType.includes('application/json')) {
          sendJson(response, 415, {
            ok: false,
            error: { code: 'unsupported-media-type', message: 'use application/json' },
          })
          return
        }
        const body = await readJsonBody(request)
        if (!body.ok) {
          sendJson(response, body.status, cloneFailure('invalid-request', body.message))
          return
        }
        const result = await runClone(body.value, response)
        sendJson(response, result.status, result.body)
        return
      }

      sendJson(response, 404, { ok: false, error: { code: 'not-found', message: `unknown endpoint: ${method} ${url.pathname}` } })
    } catch (error) {
      sendJson(response, 500, { ok: false, error: { code: 'internal', message: errorMessage(error) } })
    }
  }

  ctx.effect(
    () => webServer.register({ kind: 'prefix', path: GIT_WORKSPACE_ROUTE, handler }),
    'git-workspace: clone routes',
  )
}
