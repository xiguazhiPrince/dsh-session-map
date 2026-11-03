/**
 * Shared vocabulary for the Agent instructions (AGENTS.md) tab.
 *
 * The product's `@deepseek-ai/dsh-agent-instructions` plugin discovers
 * instruction files in a fixed, documented order and injects them into the
 * model prompt from broadest to most specific:
 *
 * 1. user-global candidates — `~/.dsh/AGENTS.md` and `~/.agents/AGENTS.md`,
 *    which form one candidate group for duplicate suppression;
 * 2. the project chain — every directory from the resolved project root down to
 *    the Session's current directory, each contributing `AGENTS.md`,
 *    `CLAUDE.md`, then the local overlays `AGENTS.local.md` and
 *    `CLAUDE.local.md`.
 *
 * A project root is the nearest ancestor of the Session cwd that holds the
 * `.git` marker (the product's default marker), falling back to the cwd itself.
 * Mutually identical files within one candidate group are rendered once, so a
 * symlinked or byte-copied sibling does not repeat in the prompt.
 *
 * This module owns the wire vocabulary and the pure assembly rules both halves
 * use. It stays platform-neutral — no Node imports — because the browser bundle
 * imports it too: the Host half walks the filesystem and reads contents, then
 * hands the discovered rows here, and the browser half renders the assembled
 * state and the editor.
 *
 * @module dsh-session-map/agent-instructions/model
 */

/** Route family shared by the Host routes and the browser tab. */
export const AGENT_INSTRUCTIONS_ROUTE = '/plugin-agent-instructions'

/** Largest instruction file this surface reads or writes, matching the product's source cap. */
export const INSTRUCTION_FILE_MAX_BYTES = 1024 * 1024

/** The file name of the user-global instruction file under each user root. */
export const USER_GLOBAL_INSTRUCTION_FILE = 'AGENTS.md'

/** Per-directory candidates that load before the local overlays, in discovery order. */
export const BASE_INSTRUCTION_FILE_CANDIDATES = ['AGENTS.md', 'CLAUDE.md'] as const

/** Per-directory local-overlay candidates, loaded after the base candidates. */
export const LOCAL_INSTRUCTION_FILE_CANDIDATES = ['AGENTS.local.md', 'CLAUDE.local.md'] as const

/** Layer an instruction file belongs to. */
export type InstructionScope = 'user' | 'project'

/** Whether one candidate is a base instruction file or its local overlay. */
export type InstructionVariant = 'base' | 'local'

/** Why an existing instruction file contributes no prompt content. */
export type InstructionSkipReason = 'too-large' | 'unreadable'

/** Stable ids of the two user-global roots, in injection order. */
export type UserRootId = 'user:dsh-home' | 'user:agents-home'

/** One user-global root the product reads. */
export interface UserRootDefinition {
  /** Stable level id, also used as the summary's `levelId`. */
  readonly id: UserRootId
  /** Environment variable that overrides the default location. */
  readonly envName: string
  /** Directory name under the OS home. */
  readonly dirName: string
  /** Symbolic display label for the default location. */
  readonly defaultDisplay: string
}

/** One project chain level: a directory from the project root down to the cwd. */
export interface InstructionLevelInput {
  /** Stable level id, `project:.` for the root and `project:<relative dir>` below it. */
  readonly id: string
  /** Display title, `项目根` for the root. */
  readonly title: string
  /** Root-relative directory, `.` for the project root. */
  readonly relativeDir: string
  /** Absolute directory path. */
  readonly absolutePath: string
}

/** One user-global root description, with its resolved absolute home. */
export interface UserRootInput {
  /** Stable level id, also used as the summary's `levelId`. */
  readonly id: UserRootId
  /** Symbolic display label, `~/.dsh` or `$DSH_HOME` after an override. */
  readonly title: string
  /** Absolute root directory, the parent of the instruction file. */
  readonly home: string
}

/**
 * One instruction candidate the Host discovered on disk.
 *
 * `digest` is the SHA-1 of the file's trimmed content, computed only for
 * existing files the Host could read; it drives duplicate suppression. A file
 * that exists but exceeds the source cap, or cannot be read, carries `skipped`
 * instead and never enters the prompt.
 */
export interface DiscoveredInstructionFile {
  /** Stable identity, the level id and the file name. */
  readonly levelId: string
  /** Layer the candidate belongs to. */
  readonly scope: InstructionScope
  /** Candidate file name, such as `AGENTS.md`. */
  readonly name: string
  /** Path relative to the project root, or the symbolic user path. */
  readonly displayPath: string
  /** Absolute host path. */
  readonly absolutePath: string
  /** Whether a regular file is present at the path. */
  readonly exists: boolean
  /** Byte size of a present file, when known. */
  readonly size: number | null
  /** Last modification time as an ISO string, when known. */
  readonly modifiedAt: string | null
  /** SHA-1 of the trimmed content, when the file was read for injection. */
  readonly digest?: string
  /** Why the file contributes no prompt content. */
  readonly skipped?: InstructionSkipReason
}

/** Everything the Host discovered for one Session, before ordering is applied. */
export interface AgentInstructionsStateInput {
  /** Session the chain belongs to. */
  readonly sessionId: string
  /** Session working directory, absolute. */
  readonly cwd: string
  /** Shortened `cwd` display path, using `~` when it is under the OS home. */
  readonly cwdDisplay: string
  /** Resolved project root and whether a marker actually selected it. */
  readonly project: {
    /** Absolute project root. */
    readonly root: string
    /** Shortened root display path. */
    readonly display: string
    /** Whether a `.git` marker was found; false means the chain is just the cwd. */
    readonly hasMarker: boolean
  }
  /** The two user-global roots, in injection order. */
  readonly userRoots: readonly UserRootInput[]
  /** The project chain, broadest first. */
  readonly levels: readonly InstructionLevelInput[]
  /** Every candidate in injection order: user roots, then the project chain. */
  readonly discovered: readonly DiscoveredInstructionFile[]
}

/** One instruction candidate as the Host reports it and the tab renders it. */
export interface InstructionFileSummary {
  /** Stable identity used by the file, save, and delete routes. */
  readonly id: string
  /** Layer the candidate belongs to. */
  readonly scope: InstructionScope
  /** Level id the candidate belongs to. */
  readonly levelId: string
  /** Candidate file name. */
  readonly name: string
  /** Base candidate or local overlay. */
  readonly variant: InstructionVariant
  /** Path relative to the project root, or the symbolic user path. */
  readonly displayPath: string
  /** Absolute host path, shown as a tooltip and explained in the editor. */
  readonly absolutePath: string
  /** Whether a regular file is present. */
  readonly exists: boolean
  /** Byte size of a present file, when known. */
  readonly size: number | null
  /** Last modification time as an ISO string, when known. */
  readonly modifiedAt: string | null
  /** 1-based injection order; present only for a file the prompt includes. */
  readonly order?: number
  /** Earlier file in the same candidate group whose content this file duplicates. */
  readonly duplicateOf?: string
  /** Why an existing file contributes no prompt content. */
  readonly skipped?: InstructionSkipReason
}

/** One file's body, returned when the editor opens it. */
export interface InstructionFileDetail extends InstructionFileSummary {
  /** UTF-8 file content. */
  readonly content: string
  /** SHA-1 of the content, used to detect external edits before a save. */
  readonly sha1: string
}

/** One project chain level with its candidate files, in discovery order. */
export interface InstructionLevel extends InstructionLevelInput {
  /** The four candidates of this directory. */
  readonly files: readonly InstructionFileSummary[]
}

/** One user-global root with its single `AGENTS.md` candidate. */
export interface UserRootView extends UserRootInput {
  /** The `AGENTS.md` candidate of this root. */
  readonly file: InstructionFileSummary
}

/** The complete state the tab renders for one Session. */
export interface AgentInstructionsState {
  /** Session the chain belongs to. */
  readonly sessionId: string
  /** Session working directory, absolute. */
  readonly cwd: string
  /** Shortened `cwd` display path. */
  readonly cwdDisplay: string
  /** Resolved project root and whether a marker selected it. */
  readonly project: {
    /** Absolute project root. */
    readonly root: string
    /** Shortened root display path. */
    readonly display: string
    /** Whether a `.git` marker was found. */
    readonly hasMarker: boolean
  }
  /** The two user-global roots, in injection order. */
  readonly userRoots: readonly UserRootView[]
  /** The project chain, broadest first. */
  readonly levels: readonly InstructionLevel[]
  /** How many files the prompt actually includes after duplicate suppression. */
  readonly effectiveCount: number
  /** ISO timestamp of the read. */
  readonly generatedAt: string
}

/** Stable failure codes shared by the Host routes and the tab. */
export type InstructionFailureCode =
  | 'not-trusted'
  | 'bad-request'
  | 'session-not-found'
  | 'session-cwd-unavailable'
  | 'unknown-file'
  | 'not-regular-file'
  | 'symlink-not-allowed'
  | 'conflict'
  | 'too-large'
  | 'not-text'
  | 'write-failed'
  | 'delete-failed'
  | 'internal'

/** Host failure envelope carried inside an HTTP response body. */
export interface InstructionFailure {
  /** Stable failure code. */
  readonly code: string
  /** Human-readable explanation, Chinese-first like the rest of the plugin. */
  readonly message: string
}

/** Body of `GET /plugin-agent-instructions/state`. */
export interface StateEnvelope {
  /** Whether the read succeeded. */
  readonly ok: boolean
  /** Assembled state on success. */
  readonly state?: unknown
  /** Failure detail on rejection. */
  readonly error?: unknown
}

/** Body of `GET /plugin-agent-instructions/file`. */
export interface FileEnvelope {
  /** Whether the read succeeded. */
  readonly ok: boolean
  /** File body on success. */
  readonly file?: unknown
  /** Failure detail on rejection. */
  readonly error?: unknown
}

/** Body of `POST /plugin-agent-instructions/save`. */
export interface WriteEnvelope {
  /** Whether the write succeeded. */
  readonly ok: boolean
  /** The written file on success. */
  readonly file?: unknown
  /** Failure detail on rejection. */
  readonly error?: unknown
}

/** Body of `POST /plugin-agent-instructions/delete`. */
export interface DeleteEnvelope {
  /** Whether the delete succeeded. */
  readonly ok: boolean
  /** Failure detail on rejection. */
  readonly error?: unknown
}

/** One save request; the Host re-derives the allowed absolute path from `id`. */
export interface SaveInstructionRequest {
  /** Session whose chain the file belongs to. */
  readonly sessionId: string
  /** Candidate identity from the state read. */
  readonly id: string
  /** New UTF-8 content. */
  readonly content: string
  /** SHA-1 the editor loaded; omitted when creating a file that did not exist. */
  readonly expectedSha1?: string
}

/** One delete request; the Host re-derives the allowed absolute path from `id`. */
export interface DeleteInstructionRequest {
  /** Session whose chain the file belongs to. */
  readonly sessionId: string
  /** Candidate identity from the state read. */
  readonly id: string
}

/** The two user-global roots, in injection order. */
export const USER_ROOTS: readonly UserRootDefinition[] = [
  { id: 'user:dsh-home', envName: 'DSH_HOME', dirName: '.dsh', defaultDisplay: '~/.dsh' },
  { id: 'user:agents-home', envName: 'DSH_AGENTS_HOME', dirName: '.agents', defaultDisplay: '~/.agents' },
]

/** Directory names whose leading position would otherwise collide with a user-global scope. */
const RESERVED_SCOPE_DIRECTORIES = new Set(['user-global', 'agents-global'])

/**
 * Normalize a path to forward slashes for display and comparison.
 * @param path - platform path.
 * @returns the same path with every separator as `/`.
 */
export function displayPathOf(path: string): string {
  return path.replace(/\\/g, '/')
}

/**
 * Shorten an absolute path under the OS home to a `~/…` display path.
 * @param path - absolute host path.
 * @param home - absolute OS home directory.
 * @returns the shortened path, or the original when it is not under `home`.
 */
export function shortenHomePath(path: string, home: string): string {
  const target = displayPathOf(path)
  const root = displayPathOf(home).replace(/\/+$/, '')
  if (root === '') return path
  if (target === root) return '~'
  return target.startsWith(`${root}/`) ? `~${target.slice(root.length)}` : path
}

/**
 * Keep a project-relative path out of the user-global display namespace.
 *
 * The product marks a project directory literally named `user-global` or
 * `agents-global` with a leading `.` so its display path never reads as the
 * user-global scope. Reusing the same rule keeps the tab's paths identical to
 * the model-facing ones.
 * @param relativePath - project-root-relative path.
 * @returns the path, with a leading `.` when its first component collides.
 */
export function escapeProjectDisplayPath(relativePath: string): string {
  const normalized = displayPathOf(relativePath)
  const separator = normalized.indexOf('/')
  const first = separator < 0 ? normalized : normalized.slice(0, separator)
  return RESERVED_SCOPE_DIRECTORIES.has(first) ? `./${normalized}` : normalized
}

/**
 * Stable level id for one project-relative directory.
 * @param relativeDir - root-relative directory; `.` or the empty string for the root.
 * @returns `project:.` for the root, else `project:<relative dir>`.
 */
export function projectLevelId(relativeDir: string): string {
  const normalized = escapeProjectDisplayPath(relativeDir)
  return `project:${normalized === '' || normalized === '.' ? '.' : normalized}`
}

/**
 * Stable identity of one candidate file within a level.
 * @param levelId - the level's stable id.
 * @param name - candidate file name.
 * @returns the id the file, save, and delete routes address.
 */
export function instructionFileId(levelId: string, name: string): string {
  return `${levelId}/${name}`
}

/** Display title for one project chain level. */
export function projectLevelTitle(relativeDir: string): string {
  const normalized = displayPathOf(relativeDir)
  return normalized === '' || normalized === '.' ? '项目根' : normalized
}

/**
 * Whether a candidate name is the local overlay rather than a base file.
 * @param name - candidate file name.
 * @returns true for `*.local.md` names.
 */
export function instructionVariantOf(name: string): InstructionVariant {
  return /\.local\.md$/i.test(name) ? 'local' : 'base'
}

/**
 * Every candidate name of one project directory, in discovery order.
 * @returns the base candidates followed by the local overlays.
 */
export function projectCandidateNames(): readonly string[] {
  return [...BASE_INSTRUCTION_FILE_CANDIDATES, ...LOCAL_INSTRUCTION_FILE_CANDIDATES]
}

/**
 * Assign injection order and duplicate suppression over the discovered rows.
 *
 * The rules mirror the product: the two user-global roots form one candidate
 * group, every project directory forms its own; within a group the first file
 * with a given trimmed-content digest wins and later identical files are marked
 * with the display path they duplicate. Files that are absent, skipped, or
 * without a digest never take an order.
 * @param discovered - every candidate, in injection order.
 * @returns the same rows stamped with `order` or `duplicateOf`.
 */
export function assignInjectionOrder(
  discovered: readonly DiscoveredInstructionFile[],
): InstructionFileSummary[] {
  const seenByGroup = new Map<string, Map<string, string>>()
  let nextOrder = 1
  const summaries: InstructionFileSummary[] = []
  for (const file of discovered) {
    const group = file.scope === 'user' ? 'user' : file.levelId
    let seen = seenByGroup.get(group)
    if (seen === undefined) {
      seen = new Map()
      seenByGroup.set(group, seen)
    }
    let order: number | undefined
    let duplicateOf: string | undefined
    if (file.exists && file.skipped === undefined && file.digest !== undefined) {
      const earlier = seen.get(file.digest)
      if (earlier === undefined) {
        seen.set(file.digest, file.displayPath)
        order = nextOrder
        nextOrder += 1
      } else {
        duplicateOf = earlier
      }
    }
    summaries.push({
      id: instructionFileId(file.levelId, file.name),
      scope: file.scope,
      levelId: file.levelId,
      name: file.name,
      variant: instructionVariantOf(file.name),
      displayPath: file.displayPath,
      absolutePath: file.absolutePath,
      exists: file.exists,
      size: file.size,
      modifiedAt: file.modifiedAt,
      ...order === undefined ? {} : { order },
      ...duplicateOf === undefined ? {} : { duplicateOf },
      ...file.skipped === undefined ? {} : { skipped: file.skipped },
    })
  }
  return summaries
}

/**
 * Assemble the state the tab renders from the Host's discovered rows.
 * @param input - Session identity, roots, chain, and discovered candidates.
 * @param generatedAt - ISO timestamp of the read.
 * @returns the complete, ordered state.
 */
export function assembleInstructionState(
  input: AgentInstructionsStateInput,
  generatedAt: string,
): AgentInstructionsState {
  const summaries = assignInjectionOrder(input.discovered)
  const byId = new Map(summaries.map(summary => [summary.id, summary]))
  const userRoots: UserRootView[] = []
  for (const root of input.userRoots) {
    const file = byId.get(instructionFileId(root.id, USER_GLOBAL_INSTRUCTION_FILE))
    // The Host always contributes the user candidate; a defensive skip would
    // silently hide the root instead of rendering a broken file row.
    if (file === undefined) continue
    userRoots.push({ ...root, file })
  }
  const levels: InstructionLevel[] = input.levels.map((level) => ({
    ...level,
    files: summaries.filter(summary => summary.levelId === level.id),
  }))
  const effectiveCount = summaries.reduce(
    (highest, summary) => summary.order !== undefined && summary.order > highest ? summary.order : highest,
    0,
  )
  return {
    sessionId: input.sessionId,
    cwd: input.cwd,
    cwdDisplay: input.cwdDisplay,
    project: input.project,
    userRoots,
    levels,
    effectiveCount,
    generatedAt,
  }
}

/**
 * Every candidate in the state, user roots first, in injection order.
 * @param state - assembled state.
 * @returns the flattened, read-only list.
 */
export function allInstructionFiles(state: AgentInstructionsState): InstructionFileSummary[] {
  return [
    ...state.userRoots.map(root => root.file),
    ...state.levels.flatMap(level => [...level.files]),
  ]
}

/**
 * Every candidate the state reports as present on disk.
 * @param state - assembled state.
 * @returns the existing files, in injection order.
 */
export function existingInstructionFiles(state: AgentInstructionsState): InstructionFileSummary[] {
  return allInstructionFiles(state).filter(file => file.exists)
}

/**
 * The files the prompt actually includes, ordered by injection position.
 * @param state - assembled state.
 * @returns one row per included file.
 */
export function injectionOrderOf(state: AgentInstructionsState): InstructionFileSummary[] {
  return allInstructionFiles(state)
    .filter(file => file.order !== undefined)
    .sort((left, right) => (left.order ?? 0) - (right.order ?? 0))
}

/**
 * Find one candidate by its stable id.
 * @param state - assembled state.
 * @param id - candidate identity from the wire.
 * @returns the matching row, or `undefined`.
 */
export function findInstructionFile(
  state: AgentInstructionsState,
  id: string,
): InstructionFileSummary | undefined {
  return allInstructionFiles(state).find(file => file.id === id)
}

/**
 * Render one byte count the way the file rows show it.
 * @param size - byte count, or `null` when unknown.
 * @returns `—` for an unknown size, bytes below 1 KiB, else one decimal of KiB/MiB.
 */
export function formatInstructionBytes(size: number | null): string {
  if (size === null) return '—'
  if (size < 1024) return `${size} B`
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KiB`
  return `${(size / (1024 * 1024)).toFixed(1)} MiB`
}

/** Whether an unknown value is a plain object record. */
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/** Read one string field, or `undefined` when absent or malformed. */
function readString(source: Record<string, unknown>, key: string): string | undefined {
  const value = source[key]
  return typeof value === 'string' ? value : undefined
}

/** Read one non-negative integer field, or `null` when absent or malformed. */
function readSize(source: Record<string, unknown>, key: string): number | null {
  const value = source[key]
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : null
}

/**
 * Coerce one wire candidate into the summary shape.
 * @param value - untrusted wire value.
 * @returns the summary, or `undefined` when required identity fields are missing.
 */
function readSummary(value: unknown): InstructionFileSummary | undefined {
  if (!isRecord(value)) return undefined
  const id = readString(value, 'id')
  const levelId = readString(value, 'levelId')
  const name = readString(value, 'name')
  const displayPath = readString(value, 'displayPath')
  const absolutePath = readString(value, 'absolutePath')
  if (id === undefined || levelId === undefined || name === undefined) return undefined
  if (displayPath === undefined || absolutePath === undefined) return undefined
  const scope = value.scope === 'user' || value.scope === 'project' ? value.scope : 'project'
  const variant = value.variant === 'local' ? 'local' : 'base'
  const order = typeof value.order === 'number' && Number.isInteger(value.order) && value.order > 0
    ? value.order
    : undefined
  const duplicateOf = readString(value, 'duplicateOf')
  const skipped = value.skipped === 'too-large' || value.skipped === 'unreadable'
    ? value.skipped
    : undefined
  return {
    id,
    scope,
    levelId,
    name,
    variant,
    displayPath,
    absolutePath,
    exists: value.exists === true,
    size: readSize(value, 'size'),
    modifiedAt: readString(value, 'modifiedAt') ?? null,
    ...order === undefined ? {} : { order },
    ...duplicateOf === undefined ? {} : { duplicateOf },
    ...skipped === undefined ? {} : { skipped },
  }
}

/**
 * Turn one wire failure into a client error.
 * @param envelope - response body carrying the failure.
 * @returns the error to throw.
 */
function failureFrom(envelope: { readonly error?: unknown }): Error {
  if (isRecord(envelope.error)) {
    const code = readString(envelope.error, 'code') ?? 'internal'
    const message = readString(envelope.error, 'message') ?? '指令读取失败'
    return new Error(`${code}: ${message}`)
  }
  return new Error('指令读取失败：Host 没有返回失败原因')
}

/**
 * Read a successful state out of a route envelope.
 * @param envelope - parsed response body.
 * @returns the assembled state.
 * @throws Error carrying the Host failure code and message otherwise.
 */
export function stateFromEnvelope(envelope: StateEnvelope): AgentInstructionsState {
  if (envelope.ok !== true) throw failureFrom(envelope)
  const value = envelope.state
  if (!isRecord(value)) throw new Error('internal: Host 返回的指令状态格式不正确')
  const sessionId = readString(value, 'sessionId')
  const cwd = readString(value, 'cwd')
  const cwdDisplay = readString(value, 'cwdDisplay')
  const project = isRecord(value.project) ? value.project : undefined
  const projectRoot = project === undefined ? undefined : readString(project, 'root')
  const projectDisplay = project === undefined ? undefined : readString(project, 'display')
  if (sessionId === undefined || cwd === undefined || cwdDisplay === undefined) {
    throw new Error('internal: Host 返回的指令状态格式不正确')
  }
  if (projectRoot === undefined || projectDisplay === undefined) {
    throw new Error('internal: Host 返回的指令状态格式不正确')
  }
  const userRoots: UserRootView[] = []
  for (const raw of Array.isArray(value.userRoots) ? value.userRoots : []) {
    if (!isRecord(raw)) continue
    const id = readString(raw, 'id')
    const title = readString(raw, 'title')
    const home = readString(raw, 'home')
    const file = readSummary(raw.file)
    if (id === undefined || title === undefined || home === undefined || file === undefined) continue
    if (id !== 'user:dsh-home' && id !== 'user:agents-home') continue
    userRoots.push({ id, title, home, file })
  }
  const levels: InstructionLevel[] = []
  for (const raw of Array.isArray(value.levels) ? value.levels : []) {
    if (!isRecord(raw)) continue
    const id = readString(raw, 'id')
    const title = readString(raw, 'title')
    const relativeDir = readString(raw, 'relativeDir')
    const absolutePath = readString(raw, 'absolutePath')
    if (id === undefined || title === undefined || relativeDir === undefined) continue
    if (absolutePath === undefined) continue
    const files: InstructionFileSummary[] = []
    for (const file of Array.isArray(raw.files) ? raw.files : []) {
      const summary = readSummary(file)
      if (summary !== undefined) files.push(summary)
    }
    levels.push({ id, title, relativeDir, absolutePath, files })
  }
  const effectiveCount = typeof value.effectiveCount === 'number' && Number.isInteger(value.effectiveCount)
    ? value.effectiveCount
    : 0
  return {
    sessionId,
    cwd,
    cwdDisplay,
    project: {
      root: projectRoot,
      display: projectDisplay,
      hasMarker: project?.hasMarker === true,
    },
    userRoots,
    levels,
    effectiveCount,
    generatedAt: readString(value, 'generatedAt') ?? new Date().toISOString(),
  }
}

/**
 * Read one file body out of a route envelope.
 * @param envelope - parsed response body.
 * @returns the file summary plus content.
 * @throws Error carrying the Host failure code and message otherwise.
 */
export function fileFromEnvelope(envelope: FileEnvelope): InstructionFileDetail {
  if (envelope.ok !== true) throw failureFrom(envelope)
  const summary = readSummary(envelope.file)
  const source = isRecord(envelope.file) ? envelope.file : undefined
  const content = source === undefined ? undefined : readString(source, 'content')
  const sha1 = source === undefined ? undefined : readString(source, 'sha1')
  if (summary === undefined || content === undefined || sha1 === undefined) {
    throw new Error('internal: Host 返回的文件内容格式不正确')
  }
  return { ...summary, content, sha1 }
}

/**
 * Read one written-file body out of a route envelope.
 * @param envelope - parsed response body.
 * @returns the file summary plus content and digest.
 * @throws Error carrying the Host failure code and message otherwise.
 */
export function writeFromEnvelope(envelope: WriteEnvelope): InstructionFileDetail {
  return fileFromEnvelope({ ok: envelope.ok, file: envelope.file, error: envelope.error })
}

/**
 * Throw the failure carried by a delete envelope.
 * @param envelope - parsed response body.
 */
export function checkDeleteEnvelope(envelope: DeleteEnvelope): void {
  if (envelope.ok !== true) throw failureFrom(envelope)
}
