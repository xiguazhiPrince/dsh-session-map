/**
 * Pure helpers for the Git workspace feature: request validation, repository
 * name and target derivation, the clone argv, and stderr classification.
 *
 * They live apart from the Host adapter so every rule can be exercised without
 * a Cordis context or a real `git`; `host.ts` owns the service calls and the
 * HTTP envelope, and `client.ts` reuses the envelope types.
 *
 * @module dsh-session-map/git-workspace/git
 */

/** Execution-world platform reported by the Host's subprocess seam. */
export type GitHostPlatform = 'posix' | 'windows'

/** One validated clone request. */
export interface GitCloneRequest {
  readonly url: string
  readonly parentDir: string
  readonly shallow: boolean
}

/** Stable failure codes shared by the Host routes and the settings page. */
export type GitCloneFailureCode =
  | 'invalid-request'
  | 'invalid-url'
  | 'unsupported-url'
  | 'invalid-directory'
  | 'git-not-found'
  | 'parent-missing'
  | 'target-exists'
  | 'authentication'
  | 'not-found'
  | 'network'
  | 'timeout'
  | 'busy'
  | 'clone-failed'
  | 'workspace-failed'

/** Short diagnosis the settings page maps to its own copy. */
export interface GitCloneFailure {
  readonly code: GitCloneFailureCode
  readonly message: string
}

/** Result of validating a raw `/clone` request body. */
export type GitCloneRequestResult =
  | { readonly ok: true; readonly request: GitCloneRequest }
  | ({ readonly ok: false } & GitCloneFailure)

/** Host failure envelope carried inside an HTTP response body. */
export interface GitWorkspaceErrorEnvelope {
  readonly code: string
  readonly message: string
  readonly detail?: string
}

/** Host Workspace projection returned after a successful clone. */
export interface GitWorkspaceWorkspaceEnvelope {
  readonly id: string
  readonly path: string
  readonly title: string
}

/** Body of `GET /plugin-git-workspace/state`. */
export interface GitWorkspaceStateEnvelope {
  readonly ok: boolean
  readonly git?: { readonly available: boolean; readonly path?: string }
  readonly defaultParentDir?: string | null
  readonly error?: GitWorkspaceErrorEnvelope
}

/** Body of `POST /plugin-git-workspace/clone`. */
export interface GitWorkspaceCloneEnvelope {
  readonly ok: boolean
  readonly repoName?: string
  readonly targetPath?: string
  readonly workspace?: GitWorkspaceWorkspaceEnvelope
  readonly error?: GitWorkspaceErrorEnvelope
}

/** Longest repository address accepted from the page. */
const MAX_URL_LENGTH = 2048

/** Longest parent directory accepted from the page. */
const MAX_DIRECTORY_LENGTH = 1024

/** Longest derived repository directory name. */
const MAX_REPOSITORY_NAME = 100

/** How much git stderr travels back to the page as diagnostics. */
const MAX_DETAIL_LENGTH = 1200

/** Bytes no address or directory may contain. */
const CONTROL_CHARACTERS = /[\u0000-\u001f\u007f]/

/** Whitespace never belongs in a clone address. */
const WHITESPACE = /\s/

/** Any `scheme://` prefix; the accepted schemes are checked separately. */
const SCHEME_URL = /^[A-Za-z][A-Za-z0-9+.-]*:\/\//

/** `git@host:path` — the SSH address form that carries no scheme. */
const SCP_LIKE = /^[^\s@/:]+@[^\s@/:]+:[^\s]+$/

/** A drive-letter absolute path. */
const WINDOWS_ABSOLUTE = /^[A-Za-z]:[\\/]/

/** Characters Windows refuses in one path segment. */
const WINDOWS_FORBIDDEN = /[<>:"|?*]/

/** Windows device names that cannot name a directory, with or without a suffix. */
const WINDOWS_RESERVED = /^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i

/**
 * Read a value that may be a JSON object.
 * @param value - raw decoded body.
 * @returns the object, or undefined for every other JSON shape.
 */
function asRecord(value: unknown): Record<string, unknown> | undefined {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return undefined
  return value as Record<string, unknown>
}

/**
 * Whether an address uses a form `git clone` can be asked to fetch.
 *
 * This is a shape check, not a reachability check: the Host never builds a
 * shell command, so the only concern is that git receives one positional.
 * @param value - trimmed address.
 * @returns true for a supported scheme, `user@host:path`, or an absolute path.
 */
export function isSupportedRepositoryAddress(value: string): boolean {
  if (SCHEME_URL.test(value)) {
    const scheme = value.slice(0, value.indexOf(':')).toLowerCase()
    return scheme === 'http' || scheme === 'https' || scheme === 'ssh' || scheme === 'git' || scheme === 'file'
  }
  if (SCP_LIKE.test(value)) return true
  if (value.startsWith('/')) return true
  return WINDOWS_ABSOLUTE.test(value)
}

/**
 * Whether a directory is absolute in this build's two path dialects.
 * @param value - trimmed parent directory.
 * @returns true for a POSIX or Windows absolute path.
 */
export function isAbsoluteDirectory(value: string): boolean {
  return value.startsWith('/') || WINDOWS_ABSOLUTE.test(value) || value.startsWith('\\\\')
}

/**
 * Take the final non-empty slash- or backslash-separated segment.
 * @param value - a URL pathname, an SCP suffix, or a local path.
 * @returns the final segment, or undefined when there is none.
 */
function lastSegment(value: string): string | undefined {
  const parts = value.split(/[\\/]+/)
  for (let index = parts.length - 1; index >= 0; index -= 1) {
    const part = parts[index]
    if (part !== undefined && part !== '') return part
  }
  return undefined
}

/**
 * Derive the directory `git clone` would create from an address.
 *
 * The Host passes an explicit target directory, so this name is the one
 * invariant the page, the clone, and the Workspace title share. A name that
 * could escape the chosen parent, hide as `.`/`..`, or trip a path dialect is
 * refused instead of repaired.
 * @param address - raw user-entered repository address.
 * @returns a safe single-segment name, or undefined when none can be derived.
 */
export function repositoryNameFromAddress(address: string): string | undefined {
  const value = address.trim()
  if (value === '') return undefined
  let candidate: string | undefined
  if (SCHEME_URL.test(value)) {
    let pathname: string
    try {
      pathname = new URL(value).pathname
    } catch {
      return undefined
    }
    candidate = lastSegment(pathname)
  } else if (SCP_LIKE.test(value)) {
    candidate = lastSegment(value.slice(value.indexOf(':') + 1))
  } else {
    candidate = lastSegment(value)
  }
  if (candidate === undefined) return undefined
  const name = candidate.replace(/\.git$/i, '')
  if (name === '' || name === '.' || name === '..') return undefined
  if (name.length > MAX_REPOSITORY_NAME) return undefined
  if (name.startsWith('-')) return undefined
  if (CONTROL_CHARACTERS.test(name) || WHITESPACE.test(name)) return undefined
  if (WINDOWS_FORBIDDEN.test(name)) return undefined
  // Windows trims trailing dots/spaces and reserves device names; a name that
  // would change meaning per dialect is refused instead of repaired.
  if (/[. ]$/.test(name)) return undefined
  if (WINDOWS_RESERVED.test(name)) return undefined
  return name
}

/**
 * Validate and normalize one raw clone request body.
 * @param input - decoded JSON body.
 * @returns the request, or the first rejected field with a stable code.
 */
export function parseCloneRequest(input: unknown): GitCloneRequestResult {
  const record = asRecord(input)
  if (record === undefined) {
    return { ok: false, code: 'invalid-request', message: 'the request body must be a JSON object' }
  }

  const rawUrl = record['url']
  if (typeof rawUrl !== 'string') {
    return { ok: false, code: 'invalid-request', message: '"url" must be a string' }
  }
  const url = rawUrl.trim()
  if (url === '') {
    return { ok: false, code: 'invalid-url', message: 'the repository address is required' }
  }
  if (url.length > MAX_URL_LENGTH) {
    return { ok: false, code: 'invalid-url', message: 'the repository address is too long' }
  }
  if (CONTROL_CHARACTERS.test(url) || WHITESPACE.test(url)) {
    return { ok: false, code: 'invalid-url', message: 'the repository address contains control or whitespace characters' }
  }
  if (url.startsWith('-')) {
    return { ok: false, code: 'invalid-url', message: 'the repository address must not start with "-"' }
  }
  if (!isSupportedRepositoryAddress(url)) {
    return {
      ok: false,
      code: 'unsupported-url',
      message: 'use an https, ssh, git, file, git@host:path or absolute local address',
    }
  }

  const rawParent = record['parentDir']
  if (typeof rawParent !== 'string') {
    return { ok: false, code: 'invalid-request', message: '"parentDir" must be a string' }
  }
  const parentDir = rawParent.trim()
  if (parentDir === '') {
    return { ok: false, code: 'invalid-directory', message: 'the parent directory is required' }
  }
  if (parentDir.length > MAX_DIRECTORY_LENGTH) {
    return { ok: false, code: 'invalid-directory', message: 'the parent directory is too long' }
  }
  if (CONTROL_CHARACTERS.test(parentDir)) {
    return { ok: false, code: 'invalid-directory', message: 'the parent directory contains control characters' }
  }
  if (!isAbsoluteDirectory(parentDir)) {
    return { ok: false, code: 'invalid-directory', message: 'the parent directory must be absolute' }
  }

  const rawShallow = record['shallow']
  const shallow = rawShallow === undefined ? false : rawShallow
  if (typeof shallow !== 'boolean') {
    return { ok: false, code: 'invalid-request', message: '"shallow" must be a boolean' }
  }

  return { ok: true, request: { url, parentDir, shallow } }
}

/**
 * Return the parent directory of an absolute path.
 *
 * Used to propose where new repositories go: the parent of the most recently
 * added Workspace is usually the reader's projects root, which is a better
 * first suggestion than the deployment fallback (often the home directory).
 * @param path - absolute file or directory path.
 * @returns the parent path, or undefined when there is none to derive.
 */
export function parentDirectoryOf(path: string): string | undefined {
  const trimmed = path.replace(/[\\/]+$/, '')
  const separatorIndex = Math.max(trimmed.lastIndexOf('/'), trimmed.lastIndexOf('\\'))
  if (separatorIndex <= 0) return undefined
  const parent = trimmed.slice(0, separatorIndex)
  if (/^[A-Za-z]:$/.test(parent)) return `${parent}\\`
  return parent
}

/**
 * Join the chosen parent and the derived repository name.
 *
 * The separator follows the Host's execution world, not the browser's, and a
 * trailing separator on the parent never doubles.
 * @param parentDir - validated absolute parent directory.
 * @param name - validated single-segment repository name.
 * @param platform - the subprocess seam's platform.
 * @returns the absolute target directory for the clone.
 */
export function joinTargetPath(parentDir: string, name: string, platform: GitHostPlatform): string {
  const separator = platform === 'windows' ? '\\' : '/'
  const trimmed = parentDir.replace(/[\\/]+$/, '')
  if (trimmed === '') return `${separator}${name}`
  return `${trimmed}${separator}${name}`
}

/**
 * Build the argv `ctx.subprocess.spawn` receives.
 *
 * The address and target are positional after `--`, so neither can be read as
 * a git option even when a user pastes a leading dash.
 * @param gitPath - resolved git executable.
 * @param url - validated repository address.
 * @param targetPath - absolute target directory.
 * @param shallow - whether to request `--depth 1`.
 * @returns argv with git as `argv[0]`.
 */
export function cloneArgv(
  gitPath: string,
  url: string,
  targetPath: string,
  shallow: boolean,
): readonly string[] {
  return [gitPath, 'clone', ...(shallow ? ['--depth', '1'] : []), '--', url, targetPath]
}

/**
 * Map git stderr onto a stable failure code.
 * @param stderr - collected git stderr text.
 * @returns the code and a short English diagnosis.
 */
export function classifyCloneFailure(stderr: string): GitCloneFailure {
  const text = stderr.toLowerCase()
  // Checked first: an existing destination is an argument problem, and git
  // states it with the same "already exists" wording for files and directories.
  if (text.includes('already exists') || text.includes('file exists')) {
    return { code: 'target-exists', message: 'the target path already exists' }
  }
  // Authentication before the generic filesystem wording: ssh reports a
  // missing identity file as "No such file or directory", which must not read
  // as a missing parent directory.
  if (
    /could not read username|terminal prompts disabled|authentication failed|permission denied \(publickey\)|host key verification failed|no such identity|publickey|returned error: 40[13]|access denied|forbidden/.test(text)
  ) {
    return { code: 'authentication', message: 'git authentication failed or the remote refused access' }
  }
  if (
    text.includes('could not create work tree dir')
    || text.includes('cannot create directory')
    || text.includes('could not create leading directories')
    || text.includes('no such file or directory')
    || text.includes('permission denied')
  ) {
    return { code: 'parent-missing', message: 'the parent directory does not exist or is not writable' }
  }
  if (
    /repository .* does not exist|repository not found|does not appear to be a git repository|remote: not found/.test(text)
  ) {
    return { code: 'not-found', message: 'the repository does not exist or is not accessible' }
  }
  if (
    /could not resolve host|unable to access|failed to connect|connection timed out|connection refused|network is unreachable|operation timed out/.test(text)
  ) {
    return { code: 'network', message: 'the repository host could not be reached' }
  }
  return { code: 'clone-failed', message: 'git clone exited with a failure' }
}

/**
 * Keep the tail of git stderr, where git states the cause.
 * @param stderr - collected stderr text.
 * @returns the trimmed tail, or an empty string.
 */
export function cloneFailureDetail(stderr: string): string {
  const trimmed = stderr.trim()
  if (trimmed.length <= MAX_DETAIL_LENGTH) return trimmed
  return `…${trimmed.slice(trimmed.length - MAX_DETAIL_LENGTH)}`
}

/**
 * Read a message off an unknown thrown value.
 * @param error - value caught from a service call.
 * @returns a printable message.
 */
export function errorMessage(error: unknown): string {
  if (error instanceof Error) return error.message
  if (typeof error === 'string') return error
  return String(error)
}
