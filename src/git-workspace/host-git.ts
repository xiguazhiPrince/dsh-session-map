/**
 * Host half of the Git tool window: read routes over real git plus the shared
 * repository resolver every future write route will reuse.
 *
 * The handler assumes the dispatcher already applied the loopback trust gate and
 * the JSON size cap; it still owns its own input validation, path containment and
 * output limits. It claims only paths under {@link GIT_WORKSPACE_ROUTE} other
 * than `/state` and `/clone`.
 *
 * @module dsh-session-map/git-workspace/host-git
 */
import { realpath, stat } from 'node:fs/promises'
import { isAbsolute, join, resolve } from 'node:path'
import type { CommandReceipt, CommitDetail, GitPlatform, RepoSnapshot, ResolvedRepo } from './git-types'
import {
  commitFilesArgs,
  commitMetaArgs,
  commitNumstatArgs,
  containsArgs,
  diffArgs,
  forEachRefArgs,
  gitPathArgs,
  logArgs,
  readInvocation,
  remoteVerboseArgs,
  repoProbeArgs,
  statusArgs,
  verifyCommitArgs,
  type GitInvocation,
} from './git-command'
import {
  mergeFileStats,
  parseCommitMeta,
  parseForEachRef,
  parseLogZ,
  parseNameStatusZ,
  parseNumstatZ,
  parseRemoteVerbose,
  parseRepoProbe,
  parseStatusV2,
  parseGitPathLines,
  type NumstatEntry,
} from './git-parse'
import { isPathInside, isSafeHash, isSafeRefName, normalizeRepoRelativePath } from './git-repo'
import { sendJson, type RouteRequest, type RouteResponse } from './host-http'
import { RouteFailure, classifyFailure, sendRouteFailure, statusFor } from './host-errors'
import { createActionRouter } from './host-actions'
import { GitRunError, GitRunner, type SubprocessService } from './host-process'
import { GIT_WORKSPACE_ROUTE } from './route'
import type { WorkspaceRegistryService } from './host-clone'

/** Marker files whose presence means an operation is in progress. */
const OPERATION_MARKERS = [
  'MERGE_HEAD',
  'rebase-merge',
  'rebase-apply',
  'CHERRY_PICK_HEAD',
  'REVERT_HEAD',
  'BISECT_LOG',
  'sequencer',
  'index',
] as const

/** How long one snapshot is reused to collapse React double-fetches. */
const SNAPSHOT_TTL_MS = 800

/** Maximum commits one log page may return. */
const MAX_LOG_LIMIT = 100

/** Maximum page offset the UI may request. */
const MAX_LOG_SKIP = 50_000

/** Longest free-text filter accepted from the page. */
const MAX_FILTER_LENGTH = 200

/** One claimed-route handler. */
export type GitWindowRouteHandler = (
  request: RouteRequest,
  response: RouteResponse,
  url: URL,
  method: string,
) => Promise<boolean>

/** Dependencies the read routes need. */
export interface GitWindowDeps {
  readonly subprocess: SubprocessService
  readonly workspaces: WorkspaceRegistryService
}

/** Cached snapshot plus the receipts that produced it. */
interface CachedSnapshot {
  readonly snapshot: RepoSnapshot
  readonly commands: readonly CommandReceipt[]
  readonly at: number
}

/** Map one failure code onto an HTTP status. */

/** Short, stable djb2 hash used for the snapshot version. */
function fingerprint(value: string): string {
  let hash = 5381
  for (let index = 0; index < value.length; index += 1) {
    hash = ((hash << 5) + hash) ^ value.charCodeAt(index)
  }
  return (hash >>> 0).toString(16)
}

/** Read the execution-world platform, defaulting to POSIX. */
async function readPlatform(subprocess: SubprocessService): Promise<GitPlatform> {
  try {
    const environment = await subprocess.terminalEnvironment()
    return environment.platform === 'windows' ? 'windows' : 'posix'
  } catch {
    return 'posix'
  }
}

/** Validate one required query string. */
function requiredString(url: URL, name: string): string {
  const value = url.searchParams.get(name)
  if (value === null || value.trim() === '') {
    throw new RouteFailure('invalid-request', 400, `"${name}" is required`)
  }
  return value.trim()
}

/** Validate one optional free-text filter. */
function optionalFilter(url: URL, name: string): string | undefined {
  const value = url.searchParams.get(name)
  if (value === null) return undefined
  const trimmed = value.trim()
  if (trimmed === '') return undefined
  if (trimmed.length > MAX_FILTER_LENGTH) {
    throw new RouteFailure('invalid-request', 400, `"${name}" is too long`)
  }
  if (/[\u0000-\u001f\u007f]/.test(trimmed)) {
    throw new RouteFailure('invalid-request', 400, `"${name}" contains control characters`)
  }
  return trimmed
}

/** Validate a date filter shape (ISO date or date-time). */
function optionalDate(url: URL, name: string): string | undefined {
  const value = optionalFilter(url, name)
  if (value === undefined) return undefined
  if (!/^\d{4}-\d{2}-\d{2}(?:[T ]\d{2}:\d{2}(?::\d{2})?)?$/.test(value)) {
    throw new RouteFailure('invalid-request', 400, `"${name}" must be an ISO date`)
  }
  return value
}

/** Clamp one integer query parameter. */
function integerParam(url: URL, name: string, fallback: number, min: number, max: number): number {
  const raw = url.searchParams.get(name)
  if (raw === null) return fallback
  const value = Number(raw)
  if (!Number.isInteger(value)) throw new RouteFailure('invalid-request', 400, `"${name}" must be an integer`)
  return Math.min(max, Math.max(min, value))
}

/** Build one read invocation from a resolved executable and repository. */
function read(gitPath: string, repo: ResolvedRepo, args: readonly string[], options: { timeoutMs?: number; label?: string } = {}): GitInvocation {
  return readInvocation(gitPath, repo.root, args, options)
}

/** Map a failed git run onto a stable route failure. */

/** One snapshot cache entry lookup with TTL. */
function freshSnapshot(cache: Map<string, CachedSnapshot>, root: string): CachedSnapshot | undefined {
  const entry = cache.get(root)
  if (entry === undefined) return undefined
  if (Date.now() - entry.at > SNAPSHOT_TTL_MS) {
    cache.delete(root)
    return undefined
  }
  return entry
}

/**
 * Create the Git tool window route handler.
 * @param deps - subprocess seam plus the durable Workspace registry.
 * @returns a handler that claims the read paths and reports 404 under its prefix otherwise.
 */
export function createGitWindowHandler(deps: GitWindowDeps): GitWindowRouteHandler {
  const { subprocess, workspaces } = deps
  const runner = new GitRunner(subprocess)
  const snapshots = new Map<string, CachedSnapshot>()
  const repos = new Map<string, { readonly repo: ResolvedRepo; readonly at: number }>()
  const platform = new WeakMap<SubprocessService, GitPlatform>()

  /** Resolve one workspace id into a contained repository root. */
  const resolveRepo = async (workspaceId: string): Promise<ResolvedRepo> => {
    const cachedRepo = repos.get(workspaceId)
    if (cachedRepo !== undefined && Date.now() - cachedRepo.at < 30_000) return cachedRepo.repo
    const workspace = workspaces.get(workspaceId)
    if (workspace === undefined) {
      throw new RouteFailure('workspace-not-found', 404, 'the requested workspace is not registered')
    }
    let workspacePath: string
    try {
      workspacePath = await realpath(workspace.path)
    } catch {
      throw new RouteFailure('invalid-path', 400, 'the workspace directory does not exist')
    }
    const world = platform.get(subprocess) ?? await readPlatform(subprocess)
    platform.set(subprocess, world)
    const gitPath = await runner.gitPath()
    const probe = await runner.run(read(gitPath, { root: workspacePath, gitDir: '', platform: world }, repoProbeArgs()))
    if (probe.exitCode !== 0) {
      const failure = classifyFailure(probe.stderr, probe.exitCode)
      if (failure.code === 'internal') {
        throw new RouteFailure('not-a-repository', 200, 'the workspace is not a git repository', probe.stderr)
      }
      throw failure
    }
    const parsed = parseRepoProbe(probe.stdout)
    if (parsed === undefined) {
      throw new RouteFailure('parse-failed', 500, 'the repository probe could not be parsed', probe.stdout)
    }
    if (!parsed.insideWorkTree || parsed.bare) {
      throw new RouteFailure('not-a-repository', 200, 'the workspace is not a git work tree')
    }
    let root: string
    try {
      root = await realpath(parsed.topLevel)
    } catch {
      root = parsed.topLevel
    }
    if (!isPathInside(workspacePath, root, world)) {
      throw new RouteFailure('invalid-path', 400, 'the repository root is outside the workspace')
    }
    const gitDir = isAbsolute(parsed.gitDir) ? parsed.gitDir : resolve(workspacePath, parsed.gitDir)
    const repo: ResolvedRepo = { root, gitDir, platform: world }
    repos.set(workspaceId, { repo, at: Date.now() })
    return repo
  }

  const actions = createActionRouter({
    runner,
    resolveRepo,
    invalidate: (root: string) => { snapshots.delete(root) },
  })

  /** Fingerprint the files that move when refs or the index change. */
  const readVersion = async (repo: ResolvedRepo): Promise<string> => {
    const files = ['index', 'HEAD', 'packed-refs', 'FETCH_HEAD', 'ORIG_HEAD'].map(name => join(repo.gitDir, name))
    let text = ''
    for (const file of files) {
      try {
        const info = await stat(file)
        text += `${file}:${info.mtimeMs}:${info.size};`
      } catch {
        text += `${file}:0;`
      }
    }
    try {
      const refs = await stat(join(repo.gitDir, 'refs'))
      text += `refs:${refs.mtimeMs};`
    } catch {
      // A packed repository may have no refs directory yet.
    }
    return fingerprint(text)
  }

  /** Detect the operation in progress from marker files. */
  const readOperation = async (repo: ResolvedRepo, markerPaths: readonly string[]): Promise<RepoSnapshot['head']['operation']> => {
    const present = new Set<string>()
    await Promise.all(OPERATION_MARKERS.map(async (name, index) => {
      const path = markerPaths[index]
      if (path === undefined) return
      const absolute = isAbsolute(path) ? path : resolve(repo.root, path)
      try {
        await stat(absolute)
        present.add(name)
      } catch {
        // Absent markers are the normal case.
      }
    }))
    if (present.has('rebase-merge')) return 'rebase'
    if (present.has('rebase-apply')) return 'rebase-apply'
    if (present.has('MERGE_HEAD')) return 'merge'
    if (present.has('CHERRY_PICK_HEAD')) return 'cherry-pick'
    if (present.has('REVERT_HEAD')) return 'revert'
    if (present.has('BISECT_LOG')) return 'bisect'
    return 'none'
  }

  /** Build one complete snapshot. */
  const buildSnapshot = async (repo: ResolvedRepo, controller: AbortController): Promise<CachedSnapshot> => {
    const cached = freshSnapshot(snapshots, repo.root)
    if (cached !== undefined) return cached
    const gitPath = await runner.gitPath()
    const commands: CommandReceipt[] = []
    const run = async (args: readonly string[], label: string): Promise<Awaited<ReturnType<GitRunner['run']>>> => {
      const result = await runner.run(read(gitPath, repo, args, { label }), controller.signal)
      commands.push(result.receipt)
      return result
    }

    const [statusRun, refsRun, markersRun, remotesRun] = await Promise.all([
      run(statusArgs('normal'), 'status'),
      run(forEachRefArgs(), 'refs'),
      run(gitPathArgs(OPERATION_MARKERS), 'paths'),
      run(remoteVerboseArgs(), 'remotes'),
    ])
    for (const result of [statusRun, refsRun, markersRun, remotesRun]) {
      if (result.exitCode !== 0) throw classifyFailure(result.stderr, result.exitCode)
    }
    const status = parseStatusV2(statusRun.stdout)
    const refs = parseForEachRef(refsRun.stdout)
    const markers = parseGitPathLines(markersRun.stdout)
    const operation = await readOperation(repo, markers)
    const version = await readVersion(repo)
    const counts = { staged: 0, unstaged: 0, untracked: 0, conflicted: 0 }
    for (const change of status.changes) {
      if (change.group === 'staged') counts.staged += 1
      else if (change.group === 'unstaged') counts.unstaged += 1
      else if (change.group === 'untracked') counts.untracked += 1
      else counts.conflicted += 1
    }
    const snapshot: RepoSnapshot = {
      takenAt: Date.now(),
      stale: false,
      truncated: status.truncated || refs.truncated || statusRun.truncated || refsRun.truncated,
      version,
      repo: { root: repo.root, gitDir: repo.gitDir, isBare: false, isWorktree: false },
      head: {
        oid: status.head.oid,
        branch: status.head.branch,
        detached: status.head.detached,
        unborn: status.head.unborn,
        upstream: status.head.upstream === null
          ? null
          : {
            ref: status.head.upstream,
            ahead: status.head.ahead,
            behind: status.head.behind,
            gone: false,
          },
        operation,
      },
      changes: status.changes,
      counts,
      stashCount: status.head.stashCount,
      branches: refs.refs.filter(ref => ref.type === 'local' || ref.type === 'remote'),
      remotes: parseRemoteVerbose(remotesRun.stdout),
    }
    const entry: CachedSnapshot = { snapshot, commands, at: Date.now() }
    snapshots.set(repo.root, entry)
    return entry
  }

  /** Snapshot route payload builder. */
  const snapshotPayload = async (url: URL, controller: AbortController): Promise<{ snapshot: RepoSnapshot; commands: readonly CommandReceipt[] }> => {
    const repo = await resolveRepo(requiredString(url, 'workspaceId'))
    const cached = await buildSnapshot(repo, controller)
    return { snapshot: cached.snapshot, commands: cached.commands }
  }

  /** Log page route. */
  const logRoute = async (url: URL, controller: AbortController): Promise<unknown> => {
    const repo = await resolveRepo(requiredString(url, 'workspaceId'))
    const ref = optionalFilter(url, 'ref')
    if (ref !== undefined && !isSafeRefName(ref) && !isSafeHash(ref)) {
      throw new RouteFailure('invalid-ref', 400, 'the requested ref is not a valid name')
    }
    const limit = integerParam(url, 'limit', 50, 1, MAX_LOG_LIMIT)
    const skip = integerParam(url, 'skip', 0, 0, MAX_LOG_SKIP)
    let query = optionalFilter(url, 'query')
    const author = optionalFilter(url, 'author')
    const since = optionalDate(url, 'since')
    const until = optionalDate(url, 'until')
    const allBranches = url.searchParams.get('all') === '1'
    const fileParam = optionalFilter(url, 'file')
    let file: string | undefined
    if (fileParam !== undefined) {
      const normalized = normalizeRepoRelativePath(fileParam)
      if (!normalized.ok) throw new RouteFailure('invalid-path', 400, normalized.message)
      file = normalized.path
    }
    const gitPath = await runner.gitPath()
    const commands: CommandReceipt[] = []

    // A hexadecimal query is a commit id, not a message substring: resolve it
    // first so the page lands on that commit instead of an empty grep.
    let refForLog = ref
    if (query !== undefined && isSafeHash(query)) {
      const verified = await runner.run(read(gitPath, repo, verifyCommitArgs(query), { label: 'verify' }), controller.signal)
      commands.push(verified.receipt)
      if (verified.exitCode === 0) {
        refForLog = verified.stdout.trim()
        query = undefined
      }
    }

    const result = await runner.run(read(gitPath, repo, logArgs({
      ...(refForLog === undefined ? {} : { ref: refForLog }),
      allBranches,
      limit,
      skip,
      ...(query === undefined ? {} : { query }),
      ...(author === undefined ? {} : { author }),
      ...(since === undefined ? {} : { since }),
      ...(until === undefined ? {} : { until }),
      ...(file === undefined ? {} : { file }),
    }), { timeoutMs: 20_000, label: 'log' }), controller.signal)
    commands.push(result.receipt)
    if (result.exitCode !== 0 && /does not have any commits yet|bad revision/i.test(result.stderr)) {
      return { ok: true, commits: [], hasMore: false, truncated: false, commands }
    }
    if (result.exitCode !== 0) throw classifyFailure(result.stderr, result.exitCode)
    const parsed = parseLogZ(result.stdout)
    return {
      ok: true,
      commits: parsed.commits,
      hasMore: parsed.commits.length >= limit,
      truncated: parsed.truncated || result.truncated,
      commands,
    }
  }

  /** Commit-detail route. */
  const commitRoute = async (url: URL, controller: AbortController): Promise<unknown> => {
    const repo = await resolveRepo(requiredString(url, 'workspaceId'))
    const hash = requiredString(url, 'hash')
    if (!isSafeHash(hash)) throw new RouteFailure('invalid-ref', 400, 'the commit hash is not valid')
    const gitPath = await runner.gitPath()
    const run = async (args: readonly string[], label: string): Promise<Awaited<ReturnType<GitRunner['run']>>> => {
      const result = await runner.run(read(gitPath, repo, args, { label }), controller.signal)
      return result
    }
    const [meta, files, stats, branches] = await Promise.all([
      run(commitMetaArgs(hash), 'show-meta'),
      run(commitFilesArgs(hash), 'show-files'),
      run(commitNumstatArgs(hash), 'show-stats'),
      run(containsArgs(hash), 'contains'),
    ])
    const commands = [meta.receipt, files.receipt, stats.receipt, branches.receipt]
    for (const result of [meta, files, stats]) {
      if (result.exitCode !== 0) throw classifyFailure(result.stderr, result.exitCode)
    }
    const parsedMeta = parseCommitMeta(meta.stdout)
    if (parsedMeta === undefined) {
      throw new RouteFailure('parse-failed', 500, 'the commit metadata could not be parsed')
    }
    const parsedFiles = parseNameStatusZ(files.stdout)
    const parsedStats = parseNumstatZ(stats.stdout)
    const contained = branches.exitCode === 0
      ? branches.stdout.split('\n').map(line => line.trim()).filter(line => line !== '' && !line.endsWith('/HEAD'))
      : []
    const commit: CommitDetail = {
      ...parsedMeta.commit,
      message: parsedMeta.message,
      files: mergeFileStats(parsedFiles.files, parsedStats.entries as readonly NumstatEntry[]),
      containedInBranches: contained,
    }
    return {
      ok: true,
      commit,
      commands,
    }
  }

  /** Diff route. */
  const diffRoute = async (url: URL, controller: AbortController): Promise<unknown> => {
    const repo = await resolveRepo(requiredString(url, 'workspaceId'))
    const fileParam = requiredString(url, 'file')
    const normalized = normalizeRepoRelativePath(fileParam)
    if (!normalized.ok) throw new RouteFailure('invalid-path', 400, normalized.message)
    const hash = optionalFilter(url, 'hash')
    if (hash !== undefined && !isSafeHash(hash)) throw new RouteFailure('invalid-ref', 400, 'the commit hash is not valid')
    const staged = url.searchParams.get('staged') === '1'
    const context = integerParam(url, 'context', 3, 0, 20)
    const gitPath = await runner.gitPath()
    const result = await runner.run(read(gitPath, repo, diffArgs({
      ...(hash === undefined ? {} : { hash }),
      file: normalized.path,
      staged,
      context,
    }), { timeoutMs: 20_000, label: 'diff' }), controller.signal)
    if (result.exitCode !== 0) {
      if (/does not exist|not in the working tree|exists on disk, but not in/.test(result.stderr)) {
        throw new RouteFailure('invalid-path', 400, 'the path does not exist in this revision', result.stderr)
      }
      throw classifyFailure(result.stderr, result.exitCode)
    }
    const binary = /^Binary files .* differ$/m.test(result.stdout) || /^GIT binary patch$/m.test(result.stdout)
    return {
      ok: true,
      patch: result.stdout,
      binary,
      truncated: result.truncated,
      commands: [result.receipt],
    }
  }

  return async (request, response, url, method): Promise<boolean> => {
    if (!url.pathname.startsWith(`${GIT_WORKSPACE_ROUTE}/`)) return false
    const path = url.pathname.slice(GIT_WORKSPACE_ROUTE.length)
    const controller = new AbortController()
    response.on('close', () => controller.abort())
    try {
      if (await actions(request, response, url, method)) return true
      if (path === '/snapshot') {
        if (method !== 'GET') throw new RouteFailure('invalid-request', 405, 'use GET')
        const payload = await snapshotPayload(url, controller)
        sendJson(response, 200, { ok: true, ...payload })
        return true
      }
      if (path === '/log') {
        if (method !== 'GET') throw new RouteFailure('invalid-request', 405, 'use GET')
        sendJson(response, 200, await logRoute(url, controller))
        return true
      }
      if (path === '/commit') {
        if (method !== 'GET') throw new RouteFailure('invalid-request', 405, 'use GET')
        sendJson(response, 200, await commitRoute(url, controller))
        return true
      }
      if (path === '/diff') {
        if (method !== 'GET') throw new RouteFailure('invalid-request', 405, 'use GET')
        sendJson(response, 200, await diffRoute(url, controller))
        return true
      }
      throw new RouteFailure('invalid-request', 404, `unknown endpoint: ${method} ${url.pathname}`)
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
