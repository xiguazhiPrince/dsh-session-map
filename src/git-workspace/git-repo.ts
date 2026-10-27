/**
 * Pure path and reference-name rules for the Git tool window.
 *
 * Every user-supplied path is normalized here before a command is built, and
 * every branch/tag name is pre-checked here before the authoritative
 * `git check-ref-format` call. Nothing in this module touches the filesystem.
 *
 * @module dsh-session-map/git-workspace/git-repo
 */
import type { GitPlatform } from './git-types'

/** Longest repository-relative path the plugin accepts. */
const MAX_PATH_LENGTH = 4096

/** Longest git ref name git itself allows. */
const MAX_REF_LENGTH = 255

/** Characters git forbids inside a ref name. */
const REF_FORBIDDEN = /[\u0000-\u0020~^:?*[\\\u007f]/

/** One path-validation result. */
export type RepoPathResult =
  | { readonly ok: true; readonly path: string }
  | { readonly ok: false; readonly message: string }

/**
 * Convert either path dialect to the `/` form git reports.
 * @param value - raw path.
 * @returns a slash-separated path.
 */
export function toPosixPath(value: string): string {
  return value.replace(/\\/g, '/')
}

/**
 * Normalize one repository-relative path and refuse anything that could leave
 * the repository.
 * @param input - user- or protocol-supplied path.
 * @returns the normalized POSIX path, or the first rejection.
 */
export function normalizeRepoRelativePath(input: unknown): RepoPathResult {
  if (typeof input !== 'string') {
    return { ok: false, message: 'a path must be a string' }
  }
  const value = input.trim()
  if (value === '') return { ok: false, message: 'a path is required' }
  if (value.length > MAX_PATH_LENGTH) return { ok: false, message: 'the path is too long' }
  if (/[\u0000-\u001f\u007f]/.test(value)) {
    return { ok: false, message: 'the path contains control characters' }
  }
  if (value.startsWith('/') || value.startsWith('\\') || /^[A-Za-z]:/.test(value)) {
    return { ok: false, message: 'the path must be relative to the repository root' }
  }
  const parts = toPosixPath(value).split('/')
  const stack: string[] = []
  for (const part of parts) {
    if (part === '' || part === '.') continue
    if (part === '..') {
      if (stack.length === 0) return { ok: false, message: 'the path escapes the repository root' }
      stack.pop()
      continue
    }
    stack.push(part)
  }
  if (stack.length === 0) return { ok: false, message: 'the path does not name a repository entry' }
  return { ok: true, path: stack.join('/') }
}

/**
 * Compare two absolute paths under a platform's case rules.
 * @param left - first absolute path.
 * @param right - second absolute path.
 * @param platform - execution world.
 * @returns true when both name the same location.
 */
export function samePath(left: string, right: string, platform: GitPlatform): boolean {
  const a = toPosixPath(left).replace(/\/+$/, '')
  const b = toPosixPath(right).replace(/\/+$/, '')
  if (platform === 'windows') return a.toLowerCase() === b.toLowerCase()
  return a === b
}

/**
 * Whether a path is the parent directory itself or one of its descendants.
 * @param parent - absolute directory.
 * @param child - absolute path.
 * @param platform - execution world.
 * @returns true when `child` is inside `parent`.
 */
export function isPathInside(parent: string, child: string, platform: GitPlatform): boolean {
  const root = toPosixPath(parent).replace(/\/+$/, '')
  const target = toPosixPath(child).replace(/\/+$/, '')
  const caseFold = platform === 'windows' ? (value: string): string => value.toLowerCase() : (value: string): string => value
  const foldedRoot = caseFold(root)
  const foldedTarget = caseFold(target)
  if (foldedTarget === foldedRoot) return true
  return foldedTarget.startsWith(`${foldedRoot}/`)
}

/**
 * Pre-check a branch or tag name. The Host still runs
 * `git check-ref-format --branch <name>` before creating refs; this function
 * only keeps obviously invalid names out of the argv builder.
 * @param input - user-supplied ref name.
 * @returns true when the shape is acceptable.
 */
export function isSafeRefName(input: unknown): input is string {
  if (typeof input !== 'string') return false
  const value = input.trim()
  if (value === '' || value.length > MAX_REF_LENGTH) return false
  if (value.startsWith('-') || value.startsWith('/') || value.endsWith('/')) return false
  if (value.endsWith('.') || value.endsWith('.lock')) return false
  if (value.includes('//') || value.includes('..') || value.includes('@{')) return false
  if (value === '@') return false
  return !REF_FORBIDDEN.test(value)
}

/**
 * Pre-check one commit-ish hash or hash prefix.
 * @param input - candidate hash.
 * @returns true for 4–40 hexadecimal characters.
 */
export function isSafeHash(input: unknown): input is string {
  return typeof input === 'string' && /^[0-9a-fA-F]{4,40}$/.test(input)
}

/**
 * Pre-check one remote name.
 * @param input - candidate remote.
 * @returns true for a name git can address.
 */
export function isSafeRemoteName(input: unknown): input is string {
  return typeof input === 'string' && /^[A-Za-z0-9._-]{1,100}$/.test(input)
}

/**
 * Split a ref name into its display parts.
 * @param ref - full ref name (`refs/heads/main`).
 * @returns the short name git would show.
 */
export function shortRefName(ref: string): string {
  return ref.replace(/^refs\/(?:heads|remotes|tags)\//, '')
}

/**
 * Whether a name looks like a local branch hierarchy that the tree should fold.
 * @param name - short branch name.
 * @returns the parent directory, or undefined for a top-level branch.
 */
export function branchParent(name: string): string | undefined {
  const index = name.indexOf('/')
  return index <= 0 ? undefined : name.slice(0, index)
}
