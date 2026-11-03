/**
 * Host half of the Agent instructions (AGENTS.md) tab.
 *
 * Registers one same-origin prefix route under `/plugin-agent-instructions` that
 * mirrors, for display, what the product's `@deepseek-ai/dsh-agent-instructions`
 * plugin injects into a Session's prompt:
 *
 * 1. the two user-global roots, `$DSH_HOME/AGENTS.md` then
 *    `$DSH_AGENTS_HOME/AGENTS.md` (defaults `~/.dsh`, `~/.agents`), which form
 *    one candidate group for duplicate suppression;
 * 2. the project chain — every directory from the resolved project root down to
 *    the Session cwd inclusive, each contributing `AGENTS.md`, `CLAUDE.md`,
 *    then `AGENTS.local.md` and `CLAUDE.local.md`.
 *
 * Discovery is read-only and lives here rather than in the browser half: the
 * browser has no filesystem. The route answers the assembled state, one file
 * body, and the two write actions.
 *
 * Security model:
 *
 * - The loopback trust gate runs before anything else, exactly like the Git
 *   route family: these routes bypass the web server's authenticated document
 *   layer, and they can write files under the user's home and project trees.
 * - A client never names a path. Every write and delete re-reads the state for
 *   the Session and resolves the absolute path only from the discovered state
 *   row whose stable id the client sent; an id absent from that state is
 *   rejected, so a crafted request cannot address an arbitrary file.
 * - Writes refuse symlinks and non-regular files, are limited to the product's
 *   1 MiB source cap, must be valid UTF-8 text without NUL bytes, and land
 *   atomically through a same-directory temp file plus `rename`.
 * - Optimistic concurrency: an editor that loaded a file must send back the
 *   SHA-1 it saw; a create must send none and only lands when nothing is there,
 *   so two open tabs cannot silently overwrite each other.
 *
 * The digests differ on purpose. Duplicate suppression hashes the trimmed
 * content, exactly like the product. The digest a save must match hashes the
 * exact file bytes, so an external whitespace-only edit still fails the save.
 *
 * The Session cwd is resolved the way the product's session skill catalog does:
 * observe the Session, prefer the projected working directory over the header
 * cwd, let `workingDirectory.ensure(liveAgent)` refine it, and fall back to the
 * deployment default. Services are read through `ctx.get` against local
 * structural types, because this repository deliberately does not pin the
 * product's runtime packages.
 *
 * @module dsh-session-map/agent-instructions/host
 */
import type { Context } from '@deepseek-ai/cordis'
import type { Stats } from 'node:fs'
import { createHash, randomUUID } from 'node:crypto'
import { chmod, lstat, mkdir, readFile, rename, rm, stat, unlink, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { basename, dirname, join, relative, resolve } from 'node:path'
import { errorMessage } from '../git-workspace/git'
import {
  isTrustedRequest,
  readJsonBody,
  sendJson,
  type RouteRequest,
  type RouteResponse,
  type WebServerService,
} from '../git-workspace/host-http'
import {
  AGENT_INSTRUCTIONS_ROUTE,
  INSTRUCTION_FILE_MAX_BYTES,
  USER_GLOBAL_INSTRUCTION_FILE,
  USER_ROOTS,
  assembleInstructionState,
  displayPathOf,
  escapeProjectDisplayPath,
  findInstructionFile,
  projectCandidateNames,
  projectLevelId,
  projectLevelTitle,
  shortenHomePath,
  type AgentInstructionsState,
  type DiscoveredInstructionFile,
  type InstructionFailureCode,
  type InstructionFileDetail,
  type InstructionFileSummary,
  type InstructionLevelInput,
  type InstructionScope,
  type UserRootDefinition,
  type UserRootInput,
} from './model'

/** Structural view of the context's untyped service lookup. */
interface ServiceLocator {
  get(name: string): unknown
}

/** The two resolved user-global roots plus their symbolic display labels. */
export interface InstructionHomes {
  /** Absolute `$DSH_HOME`, default `~/.dsh`. */
  readonly dshHome: string
  /** Absolute `$DSH_AGENTS_HOME`, default `~/.agents`. */
  readonly agentsHome: string
  /** Display label of `dshHome`, `~/.dsh` or `$DSH_HOME`. */
  readonly dshTitle: string
  /** Display label of `agentsHome`, `~/.agents` or `$DSH_AGENTS_HOME`. */
  readonly agentsTitle: string
}

/** One optional capability the routes read per request. */
interface InstructionServices {
  readonly sessionQuery?: unknown
  readonly workingDirectory?: unknown
  readonly agents?: unknown
}

/** Endpoint table: each sub-path accepts exactly one method. */
const ENDPOINT_METHODS: Readonly<Record<string, string>> = {
  '/state': 'GET',
  '/file': 'GET',
  '/save': 'POST',
  '/delete': 'POST',
}

/** Largest save body: the file cap with room for JSON escaping and the envelope. */
const SAVE_BODY_MAX_BYTES = INSTRUCTION_FILE_MAX_BYTES * 2 + 64 * 1024

/** Effect label the route registration is owned by. */
const ROUTE_EFFECT_LABEL = 'agent-instructions: routes'

/**
 * Map one failure code onto the HTTP status the route answers.
 *
 * `symlink-not-allowed` and `not-regular-file` are precondition conflicts rather
 * than server faults: the client asked to replace something this surface must
 * not touch, so they answer 409 like a stale digest.
 * @param code - stable failure code.
 * @returns the HTTP status.
 */
function statusFor(code: InstructionFailureCode): number {
  switch (code) {
    case 'not-trusted':
      return 403
    case 'bad-request':
    case 'session-cwd-unavailable':
      return 400
    case 'session-not-found':
    case 'unknown-file':
      return 404
    case 'conflict':
    case 'symlink-not-allowed':
    case 'not-regular-file':
      return 409
    case 'too-large':
      return 413
    case 'not-text':
      return 415
    case 'write-failed':
    case 'delete-failed':
    case 'internal':
      return 500
  }
}

/** One route failure with its HTTP mapping, thrown by every Host operation. */
export class InstructionHostError extends Error {
  /** Stable failure code shared with the browser half. */
  readonly code: InstructionFailureCode
  /** HTTP status the route answers. */
  readonly status: number

  constructor(code: InstructionFailureCode, message: string) {
    super(message)
    this.name = 'InstructionHostError'
    this.code = code
    this.status = statusFor(code)
  }
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

/** Whether an unknown value is a non-null object record. */
function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/** Read one non-empty string value, or `undefined` when absent or blank. */
function nonEmptyString(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined
  const trimmed = value.trim()
  return trimmed === '' ? undefined : trimmed
}

/**
 * Resolve one user root's directory and display label.
 * @param definition - the product's root definition.
 * @param env - environment to read the override from.
 * @param base - OS home directory.
 * @returns absolute directory plus symbolic label.
 */
function resolveUserRoot(
  definition: UserRootDefinition,
  env: Readonly<Record<string, string | undefined>>,
  base: string,
): { readonly home: string; readonly title: string } {
  const defaultHome = resolve(join(base, definition.dirName))
  const override = nonEmptyString(env[definition.envName])
  const home = override === undefined ? defaultHome : resolve(override)
  return {
    home,
    title: home === defaultHome ? definition.defaultDisplay : `$${definition.envName}`,
  }
}

/**
 * Resolve the two user-global instruction roots.
 *
 * The overrides behave like the product's `dsh-home-paths`: a set, non-blank
 * `DSH_HOME`/`DSH_AGENTS_HOME` wins over `<home>/.dsh`/`<home>/.agents`, and
 * the symbolic label only stays `~/.dsh`-style when the resolved directory is
 * exactly the default one.
 * @param env - environment to read; defaults to `process.env`.
 * @param home - OS home directory; defaults to `os.homedir()`.
 * @returns both roots with their display labels.
 */
export function resolveInstructionHomes(
  env: Readonly<Record<string, string | undefined>> = process.env,
  home: string = homedir(),
): InstructionHomes {
  const base = home.trim() === '' ? homedir() : home
  const dshDefinition = USER_ROOTS[0]
  const agentsDefinition = USER_ROOTS[1]
  if (dshDefinition === undefined || agentsDefinition === undefined) {
    throw new InstructionHostError('internal', '用户级指令根定义缺失')
  }
  const dsh = resolveUserRoot(dshDefinition, env, base)
  const agents = resolveUserRoot(agentsDefinition, env, base)
  return {
    dshHome: dsh.home,
    agentsHome: agents.home,
    dshTitle: dsh.title,
    agentsTitle: agents.title,
  }
}

/**
 * Build the model's user-root inputs from resolved homes, in injection order.
 * @param homes - the resolved roots.
 * @returns one input per root.
 */
function userRootInputs(homes: InstructionHomes): UserRootInput[] {
  return USER_ROOTS.map((definition) => {
    const isDsh = definition.id === 'user:dsh-home'
    return {
      id: definition.id,
      title: isDsh ? homes.dshTitle : homes.agentsTitle,
      home: isDsh ? homes.dshHome : homes.agentsHome,
    }
  })
}

/** SHA-1 of a string's trimmed content, the digest duplicate suppression uses. */
function sha1OfTrimmed(content: string): string {
  return createHash('sha1').update(content.trim()).digest('hex')
}

/** SHA-1 of a file's exact text, the digest a save must match. */
function sha1Of(content: string): string {
  return createHash('sha1').update(content).digest('hex')
}

/**
 * Stat a path, reporting absence instead of throwing.
 * @param path - absolute host path.
 * @returns the stats, or `undefined` when the path is absent or unreadable.
 */
async function statOrUndefined(path: string): Promise<Stats | undefined> {
  try {
    return await stat(path)
  } catch {
    return undefined
  }
}

/**
 * Whether a path exists, without distinguishing files from directories.
 * @param path - absolute host path.
 * @returns whether `stat` succeeded.
 */
async function pathExists(path: string): Promise<boolean> {
  return (await statOrUndefined(path)) !== undefined
}

/**
 * Resolve the project root the way the product does: the nearest ancestor (or
 * the cwd itself) holding a `.git` marker, else the cwd.
 * @param cwd - absolute Session working directory.
 * @returns the root and whether a marker actually selected it.
 */
async function resolveProjectRoot(
  cwd: string,
): Promise<{ readonly root: string; readonly hasMarker: boolean }> {
  const start = resolve(cwd)
  let current = start
  for (;;) {
    if (await pathExists(join(current, '.git'))) return { root: current, hasMarker: true }
    const parent = dirname(current)
    if (parent === current) break
    current = parent
  }
  return { root: start, hasMarker: false }
}

/**
 * Build the chain from the project root down to the cwd inclusive.
 * @param root - absolute project root.
 * @param cwd - absolute Session working directory.
 * @returns one level per directory, broadest first; the root's `relativeDir` is `.`.
 */
function buildChain(root: string, cwd: string): InstructionLevelInput[] {
  const relativeDir = displayPathOf(relative(root, cwd))
  const parts = relativeDir === '' || relativeDir === '.' ? [] : relativeDir.split('/')
  const levels: InstructionLevelInput[] = []
  const push = (dir: string): void => {
    const normalized = dir === '' ? '.' : dir
    levels.push({
      id: projectLevelId(normalized),
      title: projectLevelTitle(normalized),
      relativeDir: normalized,
      absolutePath: join(root, normalized),
    })
  }
  let current = ''
  push(current)
  for (const part of parts) {
    current = current === '' ? part : `${current}/${part}`
    push(current)
  }
  return levels
}

/**
 * Read one candidate's metadata and, within the source cap, its digest.
 *
 * A missing path and a non-regular path both render as `exists: false`: the tab
 * only offers an editor for a path it can replace with a regular file. An
 * unreadable or oversized present file keeps its stat metadata so the row can
 * still explain why the prompt ignores it.
 * @param candidate - identity and absolute path of one candidate.
 * @returns the discovered row.
 */
async function probeInstructionFile(
  candidate: {
    readonly levelId: string
    readonly scope: InstructionScope
    readonly name: string
    readonly displayPath: string
    readonly absolutePath: string
  },
): Promise<DiscoveredInstructionFile> {
  const info = await statOrUndefined(candidate.absolutePath)
  if (info === undefined || !info.isFile()) {
    return { ...candidate, exists: false, size: null, modifiedAt: null }
  }
  const metadata = { size: info.size, modifiedAt: info.mtime.toISOString() }
  if (info.size > INSTRUCTION_FILE_MAX_BYTES) {
    return { ...candidate, exists: true, ...metadata, skipped: 'too-large' }
  }
  try {
    const content = await readFile(candidate.absolutePath, 'utf8')
    return { ...candidate, exists: true, ...metadata, digest: sha1OfTrimmed(content) }
  } catch {
    return { ...candidate, exists: true, ...metadata, skipped: 'unreadable' }
  }
}

/**
 * Discover every instruction candidate for one Session.
 *
 * The read follows the product's injection order: the two user roots first,
 * then the project chain broadest first. Ordering and duplicate suppression are
 * applied by the model's `assembleInstructionState`, not here.
 * @param options - Session id, its cwd, the resolved homes, and an optional
 * clock override for deterministic tests.
 * @returns the assembled state the tab renders.
 * @throws InstructionHostError with code `session-cwd-unavailable` when the cwd
 * is not a directory.
 */
export async function readInstructionState(options: {
  readonly sessionId: string
  readonly cwd: string
  readonly homes: InstructionHomes
  readonly generatedAt?: string
}): Promise<AgentInstructionsState> {
  const cwd = resolve(options.cwd)
  const cwdInfo = await statOrUndefined(cwd)
  if (cwdInfo === undefined) {
    throw new InstructionHostError('session-cwd-unavailable', `会话工作目录不存在：${cwd}`)
  }
  if (!cwdInfo.isDirectory()) {
    throw new InstructionHostError('session-cwd-unavailable', `会话工作目录不是目录：${cwd}`)
  }

  const project = await resolveProjectRoot(cwd)
  const userRoots = userRootInputs(options.homes)
  const levels = buildChain(project.root, cwd)

  const discovered: DiscoveredInstructionFile[] = []
  for (const root of userRoots) {
    discovered.push(await probeInstructionFile({
      levelId: root.id,
      scope: 'user',
      name: USER_GLOBAL_INSTRUCTION_FILE,
      displayPath: `${root.title}/${USER_GLOBAL_INSTRUCTION_FILE}`,
      absolutePath: join(root.home, USER_GLOBAL_INSTRUCTION_FILE),
    }))
  }
  const names = projectCandidateNames()
  for (const level of levels) {
    const prefix = level.relativeDir === '.' ? '' : `${escapeProjectDisplayPath(level.relativeDir)}/`
    for (const name of names) {
      discovered.push(await probeInstructionFile({
        levelId: level.id,
        scope: 'project',
        name,
        displayPath: `${prefix}${name}`,
        absolutePath: join(level.absolutePath, name),
      }))
    }
  }

  const home = homedir()
  return assembleInstructionState({
    sessionId: options.sessionId,
    cwd,
    cwdDisplay: shortenHomePath(cwd, home),
    project: {
      root: project.root,
      display: shortenHomePath(project.root, home),
      hasMarker: project.hasMarker,
    },
    userRoots,
    levels,
    discovered,
  }, options.generatedAt ?? new Date().toISOString())
}

/**
 * Find one candidate by id in the state, or fail with `unknown-file`.
 * @param state - assembled state read for the same Session.
 * @param id - candidate identity from the wire.
 * @returns the matching state row.
 */
function requireFile(state: AgentInstructionsState, id: string): InstructionFileSummary {
  const file = findInstructionFile(state, id)
  if (file === undefined) {
    throw new InstructionHostError('unknown-file', `未知的指令文件：${id}`)
  }
  return file
}

/**
 * Inspect a target path without following a final symlink.
 *
 * A write or delete must never follow a link out of the discovered directory,
 * and a directory or device at the candidate path is not a file this surface
 * may replace.
 * @param path - absolute target path taken from the state row.
 * @returns the target's size and permission bits, or `undefined` when absent.
 * @throws InstructionHostError for a symlink or a non-regular file.
 */
async function inspectTarget(
  path: string,
): Promise<{ readonly size: number; readonly mode: number } | undefined> {
  let info: Stats
  try {
    info = await lstat(path)
  } catch {
    return undefined
  }
  if (info.isSymbolicLink()) {
    throw new InstructionHostError(
      'symlink-not-allowed',
      `拒绝操作符号链接：${path}。请先手动处理该链接`,
    )
  }
  if (!info.isFile()) {
    throw new InstructionHostError('not-regular-file', `目标不是普通文件：${path}`)
  }
  return { size: info.size, mode: info.mode & 0o7777 }
}

/**
 * Write one file atomically: same-directory temp file, then rename over target.
 *
 * The temp name is random and is not a candidate file name, so a concurrent
 * state read never reports it. An existing file's permission bits are copied
 * onto the temp file before the rename, so the replacement keeps them.
 * @param target - absolute target path taken from the state row.
 * @param content - UTF-8 text to write.
 * @param mode - permission bits to preserve, when the target already existed.
 * @returns the written size in bytes and its fresh modification time.
 * @throws InstructionHostError with code `write-failed` on any failure.
 */
async function writeAtomically(
  target: string,
  content: string,
  mode: number | undefined,
): Promise<{ readonly size: number; readonly modifiedAt: string }> {
  const temp = join(dirname(target), `.${basename(target)}.${randomUUID()}.tmp`)
  try {
    await writeFile(temp, content, 'utf8')
    if (mode !== undefined) await chmod(temp, mode)
    await rename(temp, target)
  } catch (error: unknown) {
    await rm(temp, { force: true }).catch(() => undefined)
    throw new InstructionHostError('write-failed', `写入失败：${errorMessage(error)}`)
  }
  const size = Buffer.byteLength(content, 'utf8')
  const info = await statOrUndefined(target)
  return { size, modifiedAt: info === undefined ? new Date().toISOString() : info.mtime.toISOString() }
}

/**
 * Write one instruction file after re-deriving its path from the state.
 *
 * The id must address a row of the state the caller just read; the absolute
 * path comes only from that row. A save with `expectedSha1` is an overwrite and
 * only lands when the file still holds that exact content; a save without one
 * is a create and only lands when the path is free.
 * @param state - assembled state for the Session, read just before this call.
 * @param request - candidate id, new content, and the digest the editor loaded.
 * @returns the written file with fresh metadata and content.
 * @throws InstructionHostError with a stable failure code.
 */
export async function writeInstructionFile(
  state: AgentInstructionsState,
  request: { readonly id: string; readonly content: string; readonly expectedSha1?: string },
): Promise<InstructionFileDetail> {
  const file = requireFile(state, request.id)
  const size = Buffer.byteLength(request.content, 'utf8')
  if (size > INSTRUCTION_FILE_MAX_BYTES) {
    throw new InstructionHostError(
      'too-large',
      `内容超过 ${INSTRUCTION_FILE_MAX_BYTES} 字节上限：${size} 字节`,
    )
  }
  if (request.content.includes('\u0000')) {
    throw new InstructionHostError('not-text', '内容包含 NUL 字符，不是文本文件')
  }

  const target = file.absolutePath
  const existing = await inspectTarget(target)

  if (request.expectedSha1 !== undefined) {
    if (existing === undefined) {
      throw new InstructionHostError('conflict', '文件已被删除，请刷新后重试')
    }
    if (existing.size > INSTRUCTION_FILE_MAX_BYTES) {
      throw new InstructionHostError('conflict', '文件已超过大小上限，无法覆盖')
    }
    let current: string
    try {
      current = await readFile(target, 'utf8')
    } catch {
      throw new InstructionHostError('conflict', '无法读取当前内容，请刷新后重试')
    }
    if (sha1Of(current) !== request.expectedSha1) {
      throw new InstructionHostError('conflict', '文件已被其他编辑器修改，请刷新后重试')
    }
  } else if (existing !== undefined) {
    throw new InstructionHostError('conflict', '文件已存在，请刷新后重试')
  }

  if (file.scope === 'user') {
    try {
      await mkdir(dirname(target), { recursive: true })
    } catch (error: unknown) {
      throw new InstructionHostError('write-failed', `无法创建目录：${errorMessage(error)}`)
    }
  }

  const written = await writeAtomically(target, request.content, existing?.mode)
  return {
    id: file.id,
    scope: file.scope,
    levelId: file.levelId,
    name: file.name,
    variant: file.variant,
    displayPath: file.displayPath,
    absolutePath: file.absolutePath,
    exists: true,
    size: written.size,
    modifiedAt: written.modifiedAt,
    content: request.content,
    sha1: sha1Of(request.content),
  }
}

/**
 * Delete one instruction file after re-deriving its path from the state.
 * @param state - assembled state for the Session, read just before this call.
 * @param id - candidate identity from the wire.
 * @throws InstructionHostError with a stable failure code.
 */
export async function deleteInstructionFile(
  state: AgentInstructionsState,
  id: string,
): Promise<void> {
  const file = requireFile(state, id)
  const target = file.absolutePath
  const existing = await inspectTarget(target)
  if (existing === undefined) {
    throw new InstructionHostError('unknown-file', `指令文件已不存在：${file.displayPath}`)
  }
  try {
    await unlink(target)
  } catch (error: unknown) {
    throw new InstructionHostError('delete-failed', `删除失败：${errorMessage(error)}`)
  }
}

/**
 * Read the cwd projection of one Session observation.
 *
 * Observation results come from the product, which this repository does not
 * type against, so every field is read defensively.
 * @param observation - whatever `observeSession` returned.
 * @returns the projected working directory, else the header cwd.
 */
function observedCwd(observation: unknown): string | undefined {
  if (!isObject(observation)) return undefined
  const projections = isObject(observation.projections) ? observation.projections : undefined
  const values = projections !== undefined && isObject(projections.values) ? projections.values : undefined
  const header = isObject(observation.header) ? observation.header : undefined
  return (values === undefined ? undefined : nonEmptyString(values.workingDirectory))
    ?? (header === undefined ? undefined : nonEmptyString(header.cwd))
}

/**
 * Release an observation's disposable, if it carries one.
 *
 * A dispose failure must never fail the read: the cwd has already been copied
 * out by the time this runs.
 * @param observation - whatever `observeSession` returned.
 */
function disposeObservation(observation: unknown): void {
  if (!isObject(observation)) return
  const dispose: unknown = (observation as { [Symbol.dispose]?: unknown })[Symbol.dispose]
  if (typeof dispose !== 'function') return
  try {
    ;(dispose as () => void).call(observation)
  } catch {
    // Cleanup is best effort; the Session read already succeeded.
  }
}

/**
 * Observe one Session, failing with `session-not-found` when the query service
 * is absent or the observation throws.
 * @param service - the `sessionQuery` capability, when composed.
 * @param sessionId - Session to observe.
 * @returns the observation result.
 */
async function observeSession(service: unknown, sessionId: string): Promise<unknown> {
  const observe = isObject(service) ? service.observeSession : undefined
  if (typeof observe !== 'function') {
    throw new InstructionHostError(
      'session-not-found',
      '会话查询服务不可用：当前组合没有挂载 sessionQuery',
    )
  }
  try {
    return await (observe as (id: string) => unknown).call(service, sessionId)
  } catch (error: unknown) {
    throw new InstructionHostError('session-not-found', `读取会话失败：${errorMessage(error)}`)
  }
}

/**
 * Read the live agent a Session owns, when the registry is composed.
 * @param service - the `agents` capability.
 * @param sessionId - Session to look up.
 * @returns the live agent, or `undefined`.
 */
function liveAgentOf(service: unknown, sessionId: string): unknown {
  if (!isObject(service)) return undefined
  const get = service.get
  if (typeof get !== 'function') return undefined
  try {
    return (get as (id: string) => unknown).call(service, sessionId)
  } catch {
    return undefined
  }
}

/**
 * Resolve one Session's working directory.
 *
 * Mirrors the product's session skill catalog: the projection wins over the
 * header cwd, a live agent lets `workingDirectory.ensure` refine it, and the
 * deployment default is the last resort. A disposable observation is released
 * in a `finally` no matter which field read fails.
 * @param services - optional `sessionQuery`, `workingDirectory` and `agents`.
 * @param sessionId - Session to resolve.
 * @returns the absolute working directory.
 * @throws InstructionHostError with code `session-not-found` when the Session
 * cannot be observed, or `session-cwd-unavailable` when no cwd is available.
 */
export async function resolveSessionCwd(
  services: {
    readonly sessionQuery?: unknown
    readonly workingDirectory?: unknown
    readonly agents?: unknown
  },
  sessionId: string,
): Promise<string> {
  const observation = await observeSession(services.sessionQuery, sessionId)
  let observed: string | undefined
  try {
    if (observation === undefined || observation === null) {
      throw new InstructionHostError('session-not-found', `会话不存在：${sessionId}`)
    }
    observed = observedCwd(observation)
  } finally {
    disposeObservation(observation)
  }

  let cwd = observed
  const workingDirectory = isObject(services.workingDirectory) ? services.workingDirectory : undefined
  const agent = liveAgentOf(services.agents, sessionId)
  const ensure = workingDirectory === undefined ? undefined : workingDirectory.ensure
  if (agent !== undefined && typeof ensure === 'function') {
    try {
      const refined = await (ensure as (live: unknown) => unknown).call(workingDirectory, agent)
      const text = nonEmptyString(refined)
      if (text !== undefined) cwd = text
    } catch {
      // A failed ensure only means the observed cwd stands.
    }
  }
  if (cwd === undefined) {
    cwd = workingDirectory === undefined
      ? undefined
      : nonEmptyString(workingDirectory.defaultDirectory)
  }
  if (cwd === undefined) {
    throw new InstructionHostError('session-cwd-unavailable', `无法确定会话工作目录：${sessionId}`)
  }
  return cwd
}

/**
 * Read one file body for the editor.
 * @param state - assembled state for the Session.
 * @param id - candidate identity from the wire.
 * @returns the state row plus content and the digest a save must match.
 * @throws InstructionHostError for an unknown, symlinked, non-regular, or
 * oversized file.
 */
async function readInstructionFile(
  state: AgentInstructionsState,
  id: string,
): Promise<InstructionFileDetail> {
  const file = requireFile(state, id)
  const target = file.absolutePath
  let info: Stats
  try {
    info = await lstat(target)
  } catch {
    throw new InstructionHostError('unknown-file', `指令文件已不存在：${file.displayPath}`)
  }
  if (info.isSymbolicLink()) {
    throw new InstructionHostError('symlink-not-allowed', `拒绝读取符号链接：${file.displayPath}`)
  }
  if (!info.isFile()) {
    throw new InstructionHostError('not-regular-file', `目标不是普通文件：${file.displayPath}`)
  }
  if (info.size > INSTRUCTION_FILE_MAX_BYTES) {
    throw new InstructionHostError(
      'too-large',
      `文件超过 ${INSTRUCTION_FILE_MAX_BYTES} 字节上限：${file.displayPath}`,
    )
  }
  let content: string
  try {
    content = await readFile(target, 'utf8')
  } catch (error: unknown) {
    throw new InstructionHostError('internal', `读取指令文件失败：${errorMessage(error)}`)
  }
  return { ...file, content, sha1: sha1Of(content) }
}

/**
 * Raise one failure envelope; Chinese-first like the rest of the plugin.
 * @param response - route response.
 * @param status - HTTP status.
 * @param code - stable failure code.
 * @param message - explanation for the page.
 */
function sendFailure(
  response: RouteResponse,
  status: number,
  code: InstructionFailureCode,
  message: string,
): void {
  sendJson(response, status, { ok: false, error: { code, message } })
}

/**
 * Map a thrown value onto the failure envelope the page renders.
 * @param response - route response.
 * @param error - the thrown value.
 */
function sendFromError(response: RouteResponse, error: unknown): void {
  if (error instanceof InstructionHostError) {
    sendFailure(response, error.status, error.code, error.message)
    return
  }
  sendFailure(response, 500, 'internal', errorMessage(error))
}

/**
 * Read one required string field from a JSON request body.
 * @param source - the parsed body.
 * @param key - field name.
 * @returns the trimmed, non-empty value.
 * @throws InstructionHostError with code `bad-request` when absent or blank.
 */
function requiredField(source: Record<string, unknown>, key: string): string {
  const value = nonEmptyString(source[key])
  if (value === undefined) {
    throw new InstructionHostError('bad-request', `缺少 ${key} 字段`)
  }
  return value
}

/**
 * Read one text field from a JSON request body; an empty string is valid.
 * @param source - the parsed body.
 * @param key - field name.
 * @returns the field value.
 * @throws InstructionHostError with code `bad-request` when absent or not a string.
 */
function textField(source: Record<string, unknown>, key: string): string {
  const value = source[key]
  if (typeof value !== 'string') {
    throw new InstructionHostError('bad-request', `${key} 字段必须是字符串`)
  }
  return value
}

/**
 * Read one optional string field from a JSON request body.
 * @param source - the parsed body.
 * @param key - field name.
 * @returns the value, or `undefined` when absent or blank.
 * @throws InstructionHostError with code `bad-request` when present but not a string.
 */
function optionalField(source: Record<string, unknown>, key: string): string | undefined {
  const value = source[key]
  if (value === undefined) return undefined
  if (typeof value !== 'string') {
    throw new InstructionHostError('bad-request', `${key} 字段必须是字符串`)
  }
  return nonEmptyString(value)
}

/**
 * Read a request body and require a JSON object.
 * @param request - incoming request.
 * @param maxBytes - largest accepted body.
 * @returns the parsed body record.
 * @throws InstructionHostError with code `bad-request` or `too-large`.
 */
async function readBodyRecord(
  request: RouteRequest,
  maxBytes?: number,
): Promise<Record<string, unknown>> {
  const result = await readJsonBody(request, maxBytes)
  if (!result.ok) {
    if (result.status === 413) {
      throw new InstructionHostError('too-large', '请求体超过大小上限')
    }
    throw new InstructionHostError('bad-request', '请求体不是合法的 JSON 对象')
  }
  if (!isObject(result.value)) {
    throw new InstructionHostError('bad-request', '请求体必须是 JSON 对象')
  }
  return result.value
}

/**
 * Read the Session id from a query string.
 * @param url - the request URL.
 * @returns the Session id.
 * @throws InstructionHostError with code `bad-request` when absent.
 */
function querySessionId(url: URL): string {
  return requiredField({ sessionId: url.searchParams.get('sessionId') }, 'sessionId')
}

/**
 * Read the candidate id from a query string.
 * @param url - the request URL.
 * @returns the candidate id.
 * @throws InstructionHostError with code `bad-request` when absent.
 */
function queryFileId(url: URL): string {
  return requiredField({ id: url.searchParams.get('id') }, 'id')
}

/**
 * Read the three optional capabilities the routes use, per request.
 * @param ctx - the plugin's context.
 * @returns whatever the composition currently mounts.
 */
function instructionServices(ctx: Context): InstructionServices {
  return {
    sessionQuery: lookup<unknown>(ctx, 'sessionQuery'),
    workingDirectory: lookup<unknown>(ctx, 'workingDirectory'),
    agents: lookup<unknown>(ctx, 'agents'),
  }
}

/**
 * Read the state one request works against.
 * @param ctx - the plugin's context.
 * @param sessionId - Session from the request.
 * @returns the assembled state.
 */
async function readStateFor(ctx: Context, sessionId: string): Promise<AgentInstructionsState> {
  const cwd = await resolveSessionCwd(instructionServices(ctx), sessionId)
  return await readInstructionState({ sessionId, cwd, homes: resolveInstructionHomes() })
}

/**
 * Answer one route request.
 *
 * The sub-path selects both the operation and its only accepted method, so a
 * wrong method is answered with 405 before any service or filesystem work.
 * @param ctx - the plugin's context.
 * @param request - incoming request.
 * @param response - route response.
 */
async function dispatch(
  ctx: Context,
  request: RouteRequest,
  response: RouteResponse,
): Promise<void> {
  const url = new URL(request.url ?? '/', 'http://localhost')
  const method = (request.method ?? 'GET').toUpperCase()
  const subpath = url.pathname.startsWith(`${AGENT_INSTRUCTIONS_ROUTE}/`)
    ? url.pathname.slice(AGENT_INSTRUCTIONS_ROUTE.length)
    : url.pathname
  const expected = ENDPOINT_METHODS[subpath]
  if (expected === undefined) {
    // Unknown sub-paths are a routing miss, not a validation failure: answer
    // 404 while keeping the shared `bad-request` code.
    sendFailure(response, 404, 'bad-request', `未知的接口：${method} ${url.pathname}`)
    return
  }
  if (method !== expected) {
    sendFailure(response, 405, 'bad-request', `该接口只接受 ${expected} 请求`)
    return
  }

  switch (subpath) {
    case '/state': {
      const sessionId = querySessionId(url)
      sendJson(response, 200, { ok: true, state: await readStateFor(ctx, sessionId) })
      return
    }
    case '/file': {
      const sessionId = querySessionId(url)
      const id = queryFileId(url)
      const state = await readStateFor(ctx, sessionId)
      sendJson(response, 200, { ok: true, file: await readInstructionFile(state, id) })
      return
    }
    case '/save': {
      const body = await readBodyRecord(request, SAVE_BODY_MAX_BYTES)
      const sessionId = requiredField(body, 'sessionId')
      const id = requiredField(body, 'id')
      const content = textField(body, 'content')
      const expectedSha1 = optionalField(body, 'expectedSha1')
      const state = await readStateFor(ctx, sessionId)
      const file = await writeInstructionFile(state, {
        id,
        content,
        ...expectedSha1 === undefined ? {} : { expectedSha1 },
      })
      sendJson(response, 200, { ok: true, file })
      return
    }
    case '/delete': {
      const body = await readBodyRecord(request)
      const sessionId = requiredField(body, 'sessionId')
      const id = requiredField(body, 'id')
      const state = await readStateFor(ctx, sessionId)
      await deleteInstructionFile(state, id)
      sendJson(response, 200, { ok: true })
      return
    }
    default:
      // The endpoint table above already rejected every other value; this keeps
      // the switch exhaustive if a case is ever removed without the table.
      throw new InstructionHostError('bad-request', `未知的接口：${method} ${url.pathname}`)
  }
}

/**
 * Install the Agent instructions routes.
 *
 * Call this from a context that provides `webServer`; `sessionQuery`,
 * `workingDirectory` and `agents` stay optional capabilities read per request,
 * so a thin composition answers a clear envelope instead of failing at apply
 * time.
 * @param ctx - plugin context carrying the web server.
 */
export function installAgentInstructionsHost(ctx: Context): void {
  const webServer = lookup<WebServerService>(ctx, 'webServer')
  if (webServer === undefined) return

  const handler = async (request: RouteRequest, response: RouteResponse): Promise<void> => {
    // The route family carries no server-side auth token; only a request from
    // this machine, addressed to a loopback Host, may reach a file at all.
    if (!isTrustedRequest(request)) {
      sendFailure(response, 403, 'not-trusted', '仅允许本机同源请求访问指令文件')
      return
    }
    try {
      await dispatch(ctx, request, response)
    } catch (error: unknown) {
      sendFromError(response, error)
    }
  }

  ctx.effect(
    () => webServer.register({ kind: 'prefix', path: AGENT_INSTRUCTIONS_ROUTE, handler }),
    ROUTE_EFFECT_LABEL,
  )
}
