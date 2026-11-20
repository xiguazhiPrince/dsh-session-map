/**
 * Host half of the Conversation → MCP tab.
 *
 * Registers one same-origin prefix route under `/plugin-mcp-manager` that owns
 * the profile's `@deepseek-ai/dsh-mcp-client` rows inside a marker-delimited
 * block of `cordis.patch.yml`. Mutations write that block atomically, then
 * hot-apply the loader entry when the composition mounts one. HTTP servers get
 * a lightweight initialize probe so the UI can tell online / auth / down apart.
 *
 * Security model: the loopback trust gate from `host-http` runs before any
 * filesystem or process work — these routes bypass the web server's
 * authenticated document layer and can rewrite the profile patch plus spawn
 * diagnose subprocesses.
 *
 * Loader hot-apply is best-effort: a loader failure becomes `loader-error` in
 * the envelope when the route surfaces it, but the patch write still succeeds
 * whenever possible (matching the mcp-console reference). Callers that only
 * care about persistence can ignore the loader warning.
 *
 * @module dsh-session-map/mcp-manager/host
 */
import type { Context } from '@deepseek-ai/cordis'
import { spawn } from 'node:child_process'
import { readdirSync, readFileSync, realpathSync, statSync } from 'node:fs'
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { dirname, join, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import { isMap, isSeq, parseDocument, stringify } from 'yaml'
import type { Document, Node } from 'yaml'
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
  MCP_BLOCK_BEGIN,
  MCP_BLOCK_END,
  MCP_CLIENT_PACKAGE,
  MCP_MANAGER_ROUTE,
  MCP_MAX_BODY_BYTES,
  MCP_ROW_ID_PREFIX,
  MCP_SERVER_NAME_RE,
  buildExportText,
  buildPatchRow,
  isObject,
  maskSecretMap,
  nonEmptyString,
  normalizeServerInput,
  parseImportText,
  sortServers,
  stringMap,
  viewFromPatchRow,
  type McpAdoptResult,
  type McpAdoptSkip,
  type McpFailureCode,
  type McpManagerState,
  type McpPatchRow,
  type McpServerView,
  type McpToolSummary,
  type McpUnmanagedView,
} from './model'
import {
  authorizationHeader,
  buildAuthorizationUrl,
  createPkce,
  createState,
  exchangeCode,
  loadStore,
  registerClient,
  resolveOAuth,
  saveStore,
  startLoopbackServer,
  type LoopbackServer,
  type OAuthMetadata,
} from './oauth'

/** Structural view of the context's untyped service lookup. */
interface ServiceLocator {
  get(name: string): unknown
}

/** One loader entry the Host may create / update / remove. */
interface LoaderEntry {
  readonly id: string
  readonly disabled?: boolean
  readonly fiber?: unknown
  readonly _initTask?: unknown
  readonly options?: {
    readonly id?: string
    readonly name?: string
    readonly config?: {
      readonly serverName?: string
      readonly url?: string
      readonly command?: string
    }
  }
}

/** Structural face of the product's plugin loader. */
interface LoaderService {
  entries(): Iterable<LoaderEntry>
  resolve(id: string): LoaderEntry | undefined
  create(options: {
    readonly id: string
    readonly name: string
    readonly config: unknown
    readonly disabled?: boolean
  }): Promise<unknown> | unknown
  update(
    id: string,
    options: { readonly config: unknown; readonly disabled?: boolean },
  ): Promise<unknown> | unknown
  remove(id: string): unknown
}

/** One tool definition as far as the MCP tab needs it. */
interface ToolDefinitionFace {
  readonly name?: string
  readonly description?: string
  readonly parameters?: unknown
}

/** Structural face of the product's tools registry (optional). */
interface ToolsService {
  view?(scope: undefined): {
    readonly knownNames?: Iterable<string>
    readonly visible?: ReadonlyMap<string, ToolDefinitionFace>
  } | undefined
  schemas?(scope?: undefined): readonly ToolDefinitionFace[]
}

/**
 * yaml `!!js` tag: parse the expression into `{ __js }` and stringify it back
 * as `!!js …`, so a read-modify-write round-trip never corrupts the loader
 * expressions dsh recommends for referenced credentials.
 */
const JS_EXPR_TAG = {
  tag: 'tag:yaml.org,2002:js',
  resolve: (value: string) => ({ __js: value }),
  identify: (value: unknown): boolean =>
    typeof value === 'object' && value !== null && !Array.isArray(value)
    && typeof (value as { __js?: unknown }).__js === 'string',
  stringify: (item: { readonly value: unknown }): string =>
    String((item.value as { __js: string }).__js),
}

/** Legacy markers from dsh-mcp-console — migrated into our markers on first load. */
const LEGACY_CONSOLE_BEGIN = '# >>> dsh-mcp-console:begin'
const LEGACY_CONSOLE_END = '# <<< dsh-mcp-console:end'

/** Even older skill-panel markers, also migrated. */
const LEGACY_SKILL_BEGIN = '# >>> dsh-skill-mcp-panel:mcp:begin'
const LEGACY_SKILL_END = '# <<< dsh-skill-mcp-panel:mcp:end'

/** Probe cache TTL and per-probe timeout, matching the reference. */
const PROBE_TTL_MS = 45_000
const PROBE_TIMEOUT_MS = 6_000

/** Preferred OAuth callback port so a registered client can be reused. */
const OAUTH_CALLBACK_PORT = 33_418

/** Endpoint table: each sub-path accepts exactly one method. */
const ENDPOINT_METHODS: Readonly<Record<string, string>> = {
  '/state': 'GET',
  '/server': 'POST',
  '/toggle': 'POST',
  '/remove': 'POST',
  '/adopt': 'POST',
  '/reconnect': 'POST',
  '/import': 'POST',
  '/export': 'GET',
  '/diagnose': 'POST',
  '/oauth/start': 'POST',
  '/oauth/poll': 'GET',
}

/** Effect label the route registration is owned by. */
const ROUTE_EFFECT_LABEL = 'mcp-manager: routes'

/** In-flight OAuth flows keyed by flowId. */
interface OAuthFlow {
  readonly flowId: string
  readonly name: string
  readonly state: string
  readonly clientId: string
  readonly metadata: OAuthMetadata
  readonly verifier: string
  readonly redirectUri: string
  readonly resource: string
  readonly loopback: LoopbackServer
  status: 'pending' | 'exchanging' | 'done' | 'error'
  code?: string
  error?: string
}

const OAUTH_FLOWS = new Map<string, OAuthFlow>()
const PROBES = new Map<string, { readonly at: number; readonly result: ProbeResult }>()

interface ProbeResult {
  readonly state: 'auth' | 'reachable' | 'down'
  readonly message: string
}

/**
 * Map one failure code onto the HTTP status the route answers.
 * @param code - stable failure code.
 */
function statusFor(code: McpFailureCode): number {
  switch (code) {
    case 'not-trusted':
      return 403
    case 'bad-request':
      return 400
    case 'not-found':
      return 404
    case 'conflict':
      return 409
    case 'patch-error':
    case 'loader-error':
    case 'oauth-error':
    case 'diagnose-error':
    case 'internal':
      return 500
  }
}

/** One route failure with its HTTP mapping. */
export class McpHostError extends Error {
  readonly code: McpFailureCode
  readonly status: number

  constructor(code: McpFailureCode, message: string) {
    super(message)
    this.name = 'McpHostError'
    this.code = code
    this.status = statusFor(code)
  }
}

/**
 * Read one optional service from the global store.
 * @param ctx - the plugin's context.
 * @param name - the service name.
 */
function lookup<T>(ctx: Context, name: string): T | undefined {
  const locator = ctx as unknown as ServiceLocator
  return locator.get(name) as T | undefined
}

/**
 * Resolve `$DSH_HOME`, defaulting to `~/.dsh`.
 * @param env - environment; defaults to `process.env`.
 * @param home - OS home; defaults to `os.homedir()`.
 */
export function resolveDshHome(
  env: Readonly<Record<string, string | undefined>> = process.env,
  home: string = homedir(),
): string {
  const configured = nonEmptyString(env.DSH_HOME)
  return resolve(configured ?? join(home, '.dsh'))
}

/**
 * Resolve the current profile directory.
 *
 * `DSH_PROFILE_DIR` / `DSH_PROFILE` win when set, but the Host process does
 * not always carry them: Desktop and the web runner inject `DSH_*` facts into
 * tool shells, not into their own environment. Blindly defaulting to
 * `desktop` then edits the wrong profile's patch file, so the bundle locates
 * the profile that actually mounted it before falling back.
 *
 * @param env - environment; defaults to `process.env`.
 * @param home - OS home; defaults to `os.homedir()`.
 */
export function resolveProfileDir(
  env: Readonly<Record<string, string | undefined>> = process.env,
  home: string = homedir(),
): string {
  const configured = nonEmptyString(env.DSH_PROFILE_DIR)
  if (configured !== undefined) return resolve(configured)
  const named = nonEmptyString(env.DSH_PROFILE)
  if (named !== undefined) {
    return join(resolveDshHome(env, home), 'profiles', named)
  }
  const detected = detectProfileDir(env, home)
  if (detected !== undefined) return detected
  return join(resolveDshHome(env, home), 'profiles', 'desktop')
}

/**
 * This package's directory with symlinks resolved: the nearest ancestor of
 * this module that holds a `package.json`. Works for the built `lib/index.js`
 * and for the TypeScript source a test imports.
 */
function ownPackageDir(): string | undefined {
  let dir: string
  try {
    dir = realpathSync(dirname(fileURLToPath(import.meta.url)))
  } catch {
    return undefined
  }
  for (let depth = 0; depth < 8; depth += 1) {
    try {
      if (statSync(join(dir, 'package.json')).isFile()) return dir
    } catch {
      // keep walking up
    }
    const parent = dirname(dir)
    if (parent === dir) return undefined
    dir = parent
  }
  return undefined
}

/** Manifest names read so far, keyed by package directory. */
const OWN_PACKAGE_NAMES = new Map<string, string | undefined>()

/** This package's `name`, read from its own manifest once per directory. */
function ownPackageName(dir: string): string | undefined {
  if (OWN_PACKAGE_NAMES.has(dir)) return OWN_PACKAGE_NAMES.get(dir)
  let name: string | undefined
  try {
    const parsed: unknown = JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8'))
    name = isObject(parsed) ? nonEmptyString(parsed.name) : undefined
  } catch {
    name = undefined
  }
  OWN_PACKAGE_NAMES.set(dir, name)
  return name
}

/**
 * Profile directory implied by one resolved package path: a package living in
 * `<dshHome>/profiles/<name>/node_modules/…` belongs to profile `<name>`.
 * Pure, so the rule can be tested without filesystem fixtures.
 * @param packageDir - resolved directory of this bundle.
 */
export function profileDirFromOwnPath(packageDir: string): string | undefined {
  const marker = `${sep}profiles${sep}`
  const at = packageDir.lastIndexOf(marker)
  if (at < 0) return undefined
  const name = packageDir.slice(at + marker.length).split(sep)[0]
  if (name === undefined || name === '' || name.startsWith('.')) return undefined
  return packageDir.slice(0, at + marker.length) + name
}

/**
 * Locate the profile that mounted this bundle.
 *
 * An installed copy resolves inside its own profile, so the path answers
 * directly. A `link:` copy (a development checkout) resolves outside every
 * profile, so each profile's `node_modules` entry is compared with this
 * package's real path; several matches resolve to the most recently touched
 * `cordis.patch.yml`.
 *
 * @param env - environment for path resolution.
 * @param home - OS home.
 * @param own - this package's resolved directory; defaults to the real one.
 * @param profilesRoot - profiles root; defaults to `<dshHome>/profiles`.
 */
export function detectProfileDir(
  env: Readonly<Record<string, string | undefined>> = process.env,
  home: string = homedir(),
  own: string | undefined = ownPackageDir(),
  profilesRoot: string = join(resolveDshHome(env, home), 'profiles'),
): string | undefined {
  if (own === undefined) return undefined
  const fromPath = profileDirFromOwnPath(own)
  if (fromPath !== undefined) return fromPath
  const packageName = ownPackageName(own)
  if (packageName === undefined) return undefined

  let names: string[]
  try {
    names = readdirSync(profilesRoot, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name)
  } catch {
    return undefined
  }

  const matches: Array<{ readonly dir: string; readonly touched: number }> = []
  for (const name of names) {
    const entry = join(profilesRoot, name, 'node_modules', ...packageName.split('/'))
    let resolved: string
    try {
      resolved = realpathSync(entry)
    } catch {
      continue
    }
    if (resolved !== own) continue
    let touched = 0
    try {
      touched = statSync(join(profilesRoot, name, 'cordis.patch.yml')).mtimeMs
    } catch {
      // A profile without a patch has no recency signal; it still counts.
    }
    matches.push({ dir: join(profilesRoot, name), touched })
  }
  if (matches.length === 0) return undefined
  if (matches.length === 1) return matches[0]!.dir
  const [newest] = [...matches].sort((a, b) => b.touched - a.touched)
  return newest?.dir
}

/** Absolute path of the profile's `cordis.patch.yml`. */
export function resolvePatchFile(
  env: Readonly<Record<string, string | undefined>> = process.env,
  home: string = homedir(),
): string {
  return join(resolveProfileDir(env, home), 'cordis.patch.yml')
}

/** Absolute path of the OAuth client/token store. */
export function resolveOAuthFile(
  env: Readonly<Record<string, string | undefined>> = process.env,
  home: string = homedir(),
): string {
  return join(resolveDshHome(env, home), 'storages', 'session-map', 'mcp-oauth.json')
}

/**
 * Read the raw patch text; a missing file reads as `[]\n`.
 * @param env - environment for path resolution.
 */
async function readPatchText(
  env: Readonly<Record<string, string | undefined>> = process.env,
): Promise<string> {
  const file = resolvePatchFile(env)
  try {
    return await readFile(file, 'utf8')
  } catch (error: unknown) {
    const code = isObject(error) ? error.code : undefined
    if (code === 'ENOENT') return '[]\n'
    throw new McpHostError('patch-error', `读取 profile patch 失败：${errorMessage(error)}`)
  }
}

/** Parse the managed YAML block body into ours / foreign / inserted rows. */
function parseBlock(text: string): {
  readonly ours: McpPatchRow[]
  readonly foreign: unknown[]
  readonly inserted: unknown[]
} {
  const doc = parseDocument(text, { logLevel: 'silent', customTags: [JS_EXPR_TAG] })
  if (doc.errors.length > 0) {
    throw new McpHostError('patch-error', `配置块解析失败：${doc.errors[0]?.message ?? 'unknown'}`)
  }
  const value: unknown = doc.toJS()
  const ours: McpPatchRow[] = []
  const inserted: unknown[] = []
  const foreign: unknown[] = []
  for (const entry of Array.isArray(value) ? value : []) {
    if (!isObject(entry)) continue
    const isInsert = Array.isArray(entry.insert)
    const members: unknown[] = isInsert ? (entry.insert as unknown[]) : [entry]
    for (const row of members) {
      if (!isObject(row)) continue
      if (row.name === MCP_CLIENT_PACKAGE) {
        ours.push(row as unknown as McpPatchRow)
      } else if (isInsert) {
        inserted.push(row)
      } else {
        foreign.push(row)
      }
    }
  }
  return { ours, foreign, inserted }
}

/** Start of the line containing `index`. */
function lineStart(text: string, index: number): number {
  return text.lastIndexOf('\n', index - 1) + 1
}

/** End of the line containing `index` (inclusive of the newline when present). */
function lineEnd(text: string, index: number): number {
  const at = text.indexOf('\n', index)
  return at < 0 ? text.length : at + 1
}

/** Locate one marker-delimited block, or null when absent / inverted. */
function findBlock(
  raw: string,
  beginMark: string,
  endMark: string,
): { readonly start: number; readonly end: number; readonly body: string } | null {
  const begin = raw.indexOf(beginMark)
  const end = raw.indexOf(endMark)
  if (begin < 0 || end < 0 || end < begin) return null
  return {
    start: lineStart(raw, begin),
    end: lineEnd(raw, end + endMark.length),
    body: raw.slice(begin + beginMark.length, end),
  }
}

/** Render the managed block with our rows plus preserved foreign / inserted. */
function renderBlock(
  rows: readonly McpPatchRow[],
  foreign: readonly unknown[] = [],
  inserted: readonly unknown[] = [],
): string {
  const parts: string[] = []
  const inserts = [...rows, ...inserted]
  if (inserts.length > 0) {
    const body = inserts
      .map((row) =>
        stringify([row], { lineWidth: 0, customTags: [JS_EXPR_TAG] })
          .replace(/\n+$/, '')
          .split('\n')
          .map((line) => `    ${line}`)
          .join('\n'),
      )
      .join('\n')
    parts.push(`- insert:\n${body}\n`)
  }
  for (const row of foreign) {
    parts.push(stringify([row], { lineWidth: 0, customTags: [JS_EXPR_TAG] }))
  }
  return `${MCP_BLOCK_BEGIN}\n${parts.join('')}${MCP_BLOCK_END}\n`
}

/** Whether the patch text is only our empty marker block (no YAML nodes). */
function isEmptyMarkerOnly(text: string): boolean {
  const withoutMarkers = text
    .replace(MCP_BLOCK_BEGIN, '')
    .replace(MCP_BLOCK_END, '')
    .replace(LEGACY_CONSOLE_BEGIN, '')
    .replace(LEGACY_CONSOLE_END, '')
    .replace(LEGACY_SKILL_BEGIN, '')
    .replace(LEGACY_SKILL_END, '')
  // Comments and whitespace only — no sequence items or mappings left.
  return withoutMarkers
    .split('\n')
    .every((line) => {
      const trimmed = line.trim()
      return trimmed === '' || trimmed.startsWith('#')
    })
}

/** Validate that a full patch document stays a top-level YAML array. */
function validatePatch(text: string): void {
  const trimmed = text.trim()
  // An empty managed block is comments only; treat it like `[]` so removing the
  // last server does not fail validation on a null document.
  if (trimmed === '' || isEmptyMarkerOnly(text)) return
  const doc = parseDocument(text, { logLevel: 'silent', customTags: [JS_EXPR_TAG] })
  if (doc.errors.length > 0) {
    throw new McpHostError('patch-error', `写入后 YAML 校验失败：${doc.errors[0]?.message ?? 'unknown'}`)
  }
  const value = doc.toJS()
  if (value === null || value === undefined) {
    if (isEmptyMarkerOnly(text)) return
  }
  if (!Array.isArray(value)) {
    throw new McpHostError('patch-error', 'profile patch 顶层必须是数组')
  }
}

/** Write one file via tmp + rename; fall back to direct write on rename races. */
async function writeAtomic(file: string, text: string): Promise<void> {
  await mkdir(dirname(file), { recursive: true })
  const tmp = `${file}.tmp-${process.pid}-${Date.now().toString(36)}`
  await writeFile(tmp, text, 'utf8')
  try {
    await rename(tmp, file)
  } catch (error: unknown) {
    const code = isObject(error) ? error.code : undefined
    if (code !== 'EPERM' && code !== 'EACCES' && code !== 'EEXIST') throw error
    await writeFile(file, text, 'utf8')
  }
}

/**
 * Splice the managed block inside raw patch text so it holds exactly `rows`,
 * migrating a legacy block when ours is absent and preserving foreign
 * content. Pure — the filesystem write lives in {@link writePatchRows}.
 * @param raw - current patch text.
 * @param rows - our `@deepseek-ai/dsh-mcp-client` rows.
 * @returns the next patch text, validated.
 */
export function splicePatchRows(raw: string, rows: readonly McpPatchRow[]): string {
  const current = findBlock(raw, MCP_BLOCK_BEGIN, MCP_BLOCK_END)
  const legacyConsole = findBlock(raw, LEGACY_CONSOLE_BEGIN, LEGACY_CONSOLE_END)
  const legacySkill = findBlock(raw, LEGACY_SKILL_BEGIN, LEGACY_SKILL_END)
  const previous = current
    ? parseBlock(current.body)
    : legacyConsole
      ? parseBlock(legacyConsole.body)
      : legacySkill
        ? parseBlock(legacySkill.body)
        : { foreign: [] as unknown[], inserted: [] as unknown[] }

  const block = renderBlock(rows, previous.foreign, previous.inserted)
  const emptyManaged = rows.length === 0
    && previous.foreign.length === 0
    && previous.inserted.length === 0
  let next: string
  if (current !== null) {
    const replaced = raw.slice(0, current.start) + block + raw.slice(current.end)
    // Removing the last managed row from an otherwise-empty patch leaves only
    // markers (or nothing). Keep a valid empty array document.
    next = emptyManaged && isEmptyMarkerOnly(replaced) ? '[]\n' : replaced
  } else if (legacyConsole !== null) {
    const replaced = raw.slice(0, legacyConsole.start) + block + raw.slice(legacyConsole.end)
    next = emptyManaged && isEmptyMarkerOnly(replaced) ? '[]\n' : replaced
  } else if (legacySkill !== null) {
    const replaced = raw.slice(0, legacySkill.start) + block + raw.slice(legacySkill.end)
    next = emptyManaged && isEmptyMarkerOnly(replaced) ? '[]\n' : replaced
  } else {
    // An empty / `[]` patch is a complete flow node; appending `- insert:`
    // after it is invalid YAML. Replace the empty document with our block
    // alone. Non-empty patches are a top-level sequence, so comments + more
    // items append fine.
    const trimmed = raw.trim()
    if (trimmed === '' || trimmed === '[]') {
      next = emptyManaged ? '[]\n' : block
    } else {
      next = `${raw.replace(/\s*$/, '')}\n\n${block}`
    }
  }
  validatePatch(next)
  return next
}

/**
 * Replace the managed block (or migrate a legacy one) with the given rows.
 * Preserves foreign / inserted rows that lived inside the previous block.
 * @param rows - our `@deepseek-ai/dsh-mcp-client` rows.
 * @param env - environment for path resolution.
 */
export async function writePatchRows(
  rows: readonly McpPatchRow[],
  env: Readonly<Record<string, string | undefined>> = process.env,
): Promise<void> {
  const file = resolvePatchFile(env)
  const next = splicePatchRows(await readPatchText(env), rows)
  try {
    await writeAtomic(file, next)
  } catch (error: unknown) {
    throw new McpHostError('patch-error', `写入 profile patch 失败：${errorMessage(error)}`)
  }
}

/** Managed rows from patch text, without the legacy migration write. */
function rowsFromText(raw: string): McpPatchRow[] {
  const ours = findBlock(raw, MCP_BLOCK_BEGIN, MCP_BLOCK_END)
  if (ours !== null) return parseBlock(ours.body).ours

  const legacyConsole = findBlock(raw, LEGACY_CONSOLE_BEGIN, LEGACY_CONSOLE_END)
  if (legacyConsole !== null) return parseBlock(legacyConsole.body).ours

  const legacySkill = findBlock(raw, LEGACY_SKILL_BEGIN, LEGACY_SKILL_END)
  if (legacySkill !== null) return parseBlock(legacySkill.body).ours

  return []
}

/**
 * Load our managed rows from the profile patch, migrating legacy markers
 * into ours on first load.
 * @param env - environment for path resolution.
 */
export async function loadPatchRows(
  env: Readonly<Record<string, string | undefined>> = process.env,
): Promise<McpPatchRow[]> {
  const raw = await readPatchText(env)
  const rows = rowsFromText(raw)
  if (
    findBlock(raw, MCP_BLOCK_BEGIN, MCP_BLOCK_END) === null
    && (findBlock(raw, LEGACY_CONSOLE_BEGIN, LEGACY_CONSOLE_END) !== null
      || findBlock(raw, LEGACY_SKILL_BEGIN, LEGACY_SKILL_END) !== null)
  ) {
    await writePatchRows(rows, env)
  }
  return rows
}

/** One `@deepseek-ai/dsh-mcp-client` row scanned outside the marker blocks. */
export interface UnmanagedCandidate {
  /** Parsed row; null when the shape is not adoptable. */
  readonly row: McpPatchRow | null
  /** serverName when readable, else the row id. */
  readonly name: string
  /** Row id as written, when readable. */
  readonly id: string
  /** Why the row cannot be adopted, when it cannot. */
  readonly blocked?: string
  /** Cut span: start of the row's first source line. */
  readonly start: number
  /** Cut span: end of the row's last source line (past the newline). */
  readonly end: number
  /**
   * Cut span widened to the whole `- insert:` item when this row is that
   * item's only member, so adopting it never leaves an empty `insert:` key.
   */
  readonly cutStart: number
  /** End of the widened cut span. */
  readonly cutEnd: number
}

/** One read of a YAML node as a managed-row candidate. */
interface RowRead {
  /** Parsed row; null when the shape is not adoptable. */
  readonly row: McpPatchRow | null
  /** serverName when readable, else the row id. */
  readonly name: string
  /** Row id as written, when readable. */
  readonly id: string
  /** Why the row cannot be adopted, when it cannot. */
  readonly blocked?: string
}

/**
 * Read one YAML node as a dsh-mcp-client row candidate.
 * @param node - parsed map node.
 * @param doc - owning document, for JS-value conversion.
 * @returns the candidate read, or null when the node is not such a row.
 */
function rowFromNode(node: unknown, doc: Document): RowRead | null {
  if (!isMap(node)) return null
  const value = node.toJS(doc) as unknown
  if (!isObject(value) || value.name !== MCP_CLIENT_PACKAGE) return null
  const config = isObject(value.config) ? value.config : undefined
  const name = nonEmptyString(config?.serverName)
  const id = nonEmptyString(value.id) ?? ''
  if (config === undefined || name === undefined) {
    return { row: null, name: id === '' ? '(未命名)' : id, id, blocked: '行缺少 config.serverName，无法收编' }
  }
  if (!MCP_SERVER_NAME_RE.test(name)) {
    return { row: null, name, id, blocked: `serverName「${name}」不合法` }
  }
  const row: McpPatchRow = {
    id: id === '' ? `${MCP_ROW_ID_PREFIX}${name}` : id,
    name: MCP_CLIENT_PACKAGE,
    ...(value.disabled === true ? { disabled: true } : {}),
    config: config as unknown as McpPatchRow['config'],
  }
  return { row, name, id }
}

/**
 * Scan patch text for `@deepseek-ai/dsh-mcp-client` rows outside the managed
 * (and legacy) marker blocks, keeping the source spans an adopt must cut.
 * An unparseable document scans as empty: a broken patch elsewhere must not
 * take the whole tab down.
 * @param raw - patch text.
 */
export function scanUnmanagedRows(raw: string): readonly UnmanagedCandidate[] {
  let doc: Document
  try {
    doc = parseDocument(raw, { logLevel: 'silent', customTags: [JS_EXPR_TAG] })
  } catch {
    return []
  }
  const root = doc.contents
  if (doc.errors.length > 0 || !isSeq(root)) return []

  const spans: Array<{ readonly start: number; readonly end: number }> = []
  for (const [begin, end] of [
    [MCP_BLOCK_BEGIN, MCP_BLOCK_END],
    [LEGACY_CONSOLE_BEGIN, LEGACY_CONSOLE_END],
    [LEGACY_SKILL_BEGIN, LEGACY_SKILL_END],
  ] as const) {
    const block = findBlock(raw, begin, end)
    if (block !== null) spans.push({ start: block.start, end: block.end })
  }
  const inBlocks = (at: number): boolean =>
    spans.some((span) => at >= span.start && at < span.end)

  const out: UnmanagedCandidate[] = []
  for (const item of root.items as unknown as readonly Node[]) {
    if (item.range == null) continue
    const itemStart = lineStart(raw, item.range[0])
    if (inBlocks(itemStart)) continue
    const insertNode = isMap(item) ? item.get('insert', true) : undefined
    if (isSeq(insertNode)) {
      const members = insertNode.items as unknown as readonly Node[]
      for (const member of members) {
        if (member.range == null) continue
        const read = rowFromNode(member, doc)
        if (read === null) continue
        const start = lineStart(raw, member.range[0])
        if (inBlocks(start)) continue
        const end = lineEnd(raw, member.range[1])
        const sole = members.length === 1
        out.push({
          row: read.row,
          name: read.name,
          id: read.id,
          ...(read.blocked !== undefined ? { blocked: read.blocked } : {}),
          start,
          end,
          cutStart: sole ? itemStart : start,
          cutEnd: sole ? lineEnd(raw, item.range[1]) : end,
        })
      }
      continue
    }
    const read = rowFromNode(item, doc)
    if (read === null) continue
    const end = lineEnd(raw, item.range[1])
    out.push({
      row: read.row,
      name: read.name,
      id: read.id,
      ...(read.blocked !== undefined ? { blocked: read.blocked } : {}),
      start: itemStart,
      end,
      cutStart: itemStart,
      cutEnd: end,
    })
  }
  return out
}

/**
 * Map scan candidates to unmanaged views, in scan order, marking conflicts
 * against the managed rows and each other. The first same-name row wins.
 * @param candidates - scan output.
 * @param managed - rows already inside the managed block.
 */
export function classifyUnmanaged(
  candidates: readonly UnmanagedCandidate[],
  managed: readonly McpPatchRow[],
): McpUnmanagedView[] {
  const names = new Set(managed.map((row) => String(row.config.serverName)))
  const ids = new Set(managed.map((row) => row.id))
  const seen = new Set<string>()
  const out: McpUnmanagedView[] = []
  for (const candidate of candidates) {
    const row = candidate.row
    const config = row?.config
    let conflict = candidate.blocked
    if (row !== null && conflict === undefined) {
      const name = String(config?.serverName ?? '')
      if (names.has(name)) conflict = `与已纳管服务器「${name}」同名`
      else if (ids.has(row.id)) conflict = `行 id「${row.id}」已被已纳管行使用`
      else if (seen.has(name)) conflict = `与另一台未纳管服务器「${name}」同名`
      seen.add(name)
    }
    const http = config?.transport === 'streamable-http'
    out.push({
      id: candidate.id,
      name: candidate.name,
      transport: http ? 'http' : 'stdio',
      enabled: row !== null && row.disabled !== true,
      endpoint: http ? String(config?.url ?? '') : String(config?.command ?? ''),
      ...(conflict !== undefined ? { conflict } : {}),
    })
  }
  return out
}

/**
 * Adopt out-of-block `@deepseek-ai/dsh-mcp-client` rows into the managed
 * block: cut their source lines from `cordis.patch.yml`, then splice them
 * into the block in one atomic write. Config round-trips through the yaml
 * tree (including `!!js` expressions), row ids stay as written, and the
 * loader entries keep their live connections — nothing reconnects.
 * Conflicting rows stay untouched and come back with reasons.
 * @param ctx - plugin context (optional loader for hot-apply parity).
 * @param names - serverName filter; omit to adopt every non-conflicting row.
 * @param env - environment for path resolution.
 * @returns adopted serverNames and skipped rows with reasons.
 */
export async function adoptUnmanaged(
  ctx: Context,
  names?: readonly string[],
  env: Readonly<Record<string, string | undefined>> = process.env,
): Promise<McpAdoptResult> {
  const raw = await readPatchText(env)
  const managed = rowsFromText(raw)
  const candidates = scanUnmanagedRows(raw)
  const views = classifyUnmanaged(candidates, managed)
  const wanted = names === undefined ? undefined : new Set(names)

  const adoptedRows: McpPatchRow[] = []
  const adopted: string[] = []
  const skipped: McpAdoptSkip[] = []
  const cuts: Array<{ readonly start: number; readonly end: number }> = []
  for (let index = 0; index < candidates.length; index += 1) {
    const candidate = candidates[index]!
    const view = views[index]!
    if (wanted !== undefined && !wanted.has(candidate.name)) continue
    if (view.conflict !== undefined) {
      skipped.push({ name: view.name, id: view.id, reason: view.conflict })
      continue
    }
    if (candidate.row === null) continue
    adoptedRows.push(candidate.row)
    adopted.push(candidate.name)
    cuts.push({ start: candidate.cutStart, end: candidate.cutEnd })
  }
  if (wanted !== undefined) {
    for (const name of wanted) {
      if (adopted.includes(name) || skipped.some((item) => item.name === name)) continue
      skipped.push({ name, id: '', reason: '管理块之外没有这台服务器' })
    }
  }

  if (adoptedRows.length > 0) {
    // Cut from the end so spans computed on the original text stay valid.
    let cut = raw
    for (const span of [...cuts].sort((a, b) => b.start - a.start)) {
      cut = cut.slice(0, span.start) + cut.slice(span.end)
    }
    const next = splicePatchRows(cut, [...managed, ...adoptedRows])
    try {
      await writeAtomic(resolvePatchFile(env), next)
    } catch (error: unknown) {
      throw new McpHostError('patch-error', `写入 profile patch 失败：${errorMessage(error)}`)
    }
    // The adopted entries were already live under these ids; the update is a
    // parity call, not a restart.
    for (const row of adoptedRows) await applyRow(ctx, row, 'save')
  }
  return { adopted, skipped }
}

/** List every loader entry, swallowing loader faults. */
function listEntries(loader: LoaderService | undefined): LoaderEntry[] {
  if (loader === undefined || typeof loader.entries !== 'function') return []
  try {
    return Array.from(loader.entries())
  } catch {
    return []
  }
}

/** Find the live loader entry for one patch row (by id, then by serverName). */
function findEntry(
  loader: LoaderService | undefined,
  row: McpPatchRow,
): LoaderEntry | null {
  if (loader === undefined) return null
  const all = listEntries(loader)
  const localId = String(row.id ?? '')
  const name = String(row.config?.serverName ?? '')
  return all.find((entry) => entry?.options?.id === localId)
    ?? all.find((entry) =>
      name !== '' && String(entry?.options?.config?.serverName ?? '') === name)
    ?? null
}

/** Count tools whose names start with the given mcp__ns__ prefix. */
function countTools(tools: ToolsService | undefined, prefix: string): number {
  return listTools(tools, prefix).length
}

/**
 * List tools under one mcp__ns__ prefix for the detail pane.
 * Prefer the live `visible` map (name + description), then `schemas()`, then
 * bare `knownNames` so the UI never shows "unavailable" when the count is > 0.
 */
function listTools(
  tools: ToolsService | undefined,
  prefix: string,
): McpToolSummary[] {
  if (tools === undefined) return []
  try {
    const out: McpToolSummary[] = []
    // Public API first: schemas() returns name + description + parameters.
    if (typeof tools.schemas === 'function') {
      for (const schema of tools.schemas(undefined) ?? []) {
        const name = typeof schema?.name === 'string' ? schema.name : ''
        if (!name.startsWith(prefix)) continue
        out.push({
          name: name.slice(prefix.length),
          description: typeof schema.description === 'string' ? schema.description : '',
          ...(schema.parameters !== undefined ? { parameters: schema.parameters } : {}),
        })
      }
      if (out.length > 0) return out.sort((a, b) => a.name.localeCompare(b.name, 'en'))
    }
    // Runtime still exposes view() (TS-private); use it for count + optional desc.
    const view = tools.view?.(undefined)
    const visible = view?.visible
    if (visible !== undefined) {
      for (const [name, definition] of visible) {
        if (typeof name !== 'string' || !name.startsWith(prefix)) continue
        out.push({
          name: name.slice(prefix.length),
          description: typeof definition?.description === 'string' ? definition.description : '',
          ...(definition?.parameters !== undefined ? { parameters: definition.parameters } : {}),
        })
      }
      return out.sort((a, b) => a.name.localeCompare(b.name, 'en'))
    }
    const names = view?.knownNames
    if (names === undefined) return []
    for (const name of names) {
      if (typeof name !== 'string' || !name.startsWith(prefix)) continue
      out.push({ name: name.slice(prefix.length), description: '' })
    }
    return out.sort((a, b) => a.name.localeCompare(b.name, 'en'))
  } catch {
    return []
  }
}

/**
 * Hot-apply one row through the optional loader.
 * Failures become `{ ok: false }` so the caller can still return the patch state.
 * @param ctx - plugin context.
 * @param row - patch row.
 * @param mode - `save` creates/updates; `remove` drops the entry.
 */
async function applyRow(
  ctx: Context,
  row: McpPatchRow,
  mode: 'save' | 'remove',
): Promise<{ readonly ok: true } | { readonly ok: false; readonly error: string }> {
  const loader = lookup<LoaderService>(ctx, 'loader')
  if (loader === undefined) return { ok: false, error: 'loader 不可用' }
  try {
    if (mode === 'remove') {
      const target = findEntry(loader, row)
      if (target !== null) loader.remove(target.id)
      return { ok: true }
    }
    const existing = findEntry(loader, row)
    if (existing !== null) {
      await loader.update(existing.id, {
        config: row.config,
        disabled: row.disabled === true,
      })
    } else {
      await loader.create({
        id: row.id,
        name: MCP_CLIENT_PACKAGE,
        config: row.config,
        disabled: row.disabled === true,
      })
    }
    return { ok: true }
  } catch (error: unknown) {
    return { ok: false, error: errorMessage(error) }
  }
}

/** Open a URL in the user's default browser without shelling through cmd.exe. */
function openExternal(url: string): void {
  const candidates: Array<[string, string[]]> = process.platform === 'win32'
    ? [['rundll32.exe', ['url.dll,FileProtocolHandler', url]]]
    : [[process.platform === 'darwin' ? 'open' : 'xdg-open', [url]]]
  for (const [command, args] of candidates) {
    try {
      const child = spawn(command, args, {
        detached: true,
        stdio: 'ignore',
        windowsHide: true,
      })
      child.on('error', () => undefined)
      child.unref()
      return
    } catch {
      // Try the next candidate.
    }
  }
}

/** Probe one HTTP MCP endpoint with a tiny initialize call. */
async function probeHttp(server: McpServerView, fresh = false): Promise<ProbeResult> {
  const key = `${server.name}|${server.url}`
  const now = Date.now()
  const cached = PROBES.get(key)
  if (!fresh && cached !== undefined && now - cached.at < PROBE_TTL_MS) return cached.result

  let result: ProbeResult
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), PROBE_TIMEOUT_MS)
  timer.unref?.()
  try {
    const response = await fetch(server.url, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        accept: 'application/json, text/event-stream',
        ...server.headers,
      },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method: 'initialize',
        params: {
          protocolVersion: '2025-06-18',
          capabilities: {},
          clientInfo: { name: 'dsh-session-map', version: '0.1.0' },
        },
      }),
      signal: controller.signal,
    })
    if (response.status === 401 || response.status === 403) {
      result = { state: 'auth', message: '需要登录' }
    } else if (response.ok) {
      result = { state: 'reachable', message: '' }
    } else {
      result = { state: 'down', message: `HTTP ${response.status}` }
    }
  } catch {
    result = {
      state: 'down',
      message: controller.signal.aborted ? '连接超时' : '连不上',
    }
  } finally {
    clearTimeout(timer)
  }
  PROBES.set(key, { at: now, result })
  return result
}

/** Mask secret fields on one view for the wire. */
function maskView(view: McpServerView): McpServerView {
  return {
    ...view,
    env: maskSecretMap(view.env),
    headers: maskSecretMap(view.headers),
  }
}

/**
 * Assemble the list payload the tab renders.
 * @param ctx - plugin context (optional loader / tools).
 * @param env - environment for path resolution.
 * @param options - `fresh` bypasses the HTTP probe cache for a manual retry.
 */
export async function buildManagerState(
  ctx: Context,
  env: Readonly<Record<string, string | undefined>> = process.env,
  options: { readonly fresh?: boolean } = {},
): Promise<McpManagerState> {
  const rows = await loadPatchRows(env)
  const unmanaged = classifyUnmanaged(scanUnmanagedRows(await readPatchText(env)), rows)
  const loader = lookup<LoaderService>(ctx, 'loader')
  const tools = lookup<ToolsService>(ctx, 'tools')
  const servers: McpServerView[] = []

  for (const row of rows) {
    const base = viewFromPatchRow(row)
    const entry = findEntry(loader, row)
    const toolList = listTools(tools, `mcp__${base.name}__`)
    const toolCount = toolList.length
    const live = entry !== null && entry.disabled !== true
    let state = base.state
    let message = base.message
    let oauth = false

    if (!base.enabled) {
      state = 'off'
    } else if (toolCount > 0) {
      state = 'online'
    } else if (base.transport === 'http') {
      const probe = await probeHttp(base, options.fresh === true)
      message = probe.message
      state = probe.state === 'auth' ? 'auth' : probe.state === 'reachable' ? 'idle' : 'down'
      oauth = probe.state === 'auth'
      if (oauth) resolveOAuth(base.url).catch(() => undefined)
    } else {
      state = live ? 'idle' : 'down'
      message = live ? '启动中' : '未启动'
    }

    servers.push(maskView({
      ...base,
      state,
      message,
      tools: toolCount,
      toolList,
      live,
      oauth,
    }))
  }

  return {
    patchFile: resolvePatchFile(env),
    profileDir: resolveProfileDir(env),
    updatedAt: new Date().toISOString(),
    servers: sortServers(servers),
    unmanaged: [...unmanaged].sort((a, b) => a.name.localeCompare(b.name, 'en')),
  }
}

/** HH:mm:ss.sss stamp for diagnose transcripts. */
function stamp(): string {
  return new Date().toISOString().slice(11, 23)
}

/** Mask headers for diagnose output. */
function maskHeadersForLog(headers: Readonly<Record<string, string>>): string {
  const out: string[] = []
  for (const [key, value] of Object.entries(headers)) {
    out.push(
      /authorization|token|key|secret|cookie/i.test(key)
        ? `${key}: ****`
        : `${key}: ${String(value).slice(0, 120)}`,
    )
  }
  return out.length > 0 ? out.join(', ') : '(无)'
}

/** Parse a JSON-RPC payload from plain JSON or an SSE `data:` line. */
function parsePayload(text: string): Record<string, unknown> | undefined {
  for (const line of String(text || '').split(/\r?\n/)) {
    if (line.startsWith('data:')) {
      try {
        const parsed: unknown = JSON.parse(line.slice(5).trim())
        if (isObject(parsed)) return parsed
      } catch {
        // keep scanning
      }
    }
  }
  try {
    const parsed: unknown = JSON.parse(text)
    return isObject(parsed) ? parsed : undefined
  } catch {
    return undefined
  }
}

const INITIALIZE_BODY = {
  jsonrpc: '2.0',
  id: 1,
  method: 'initialize',
  params: {
    protocolVersion: '2025-06-18',
    capabilities: {},
    clientInfo: { name: 'dsh-session-map', version: '0.1.0' },
  },
} as const

async function postJson(
  url: string,
  headers: Readonly<Record<string, string>>,
  body: unknown,
  timeoutMs: number,
): Promise<
  | { readonly ok: true; readonly status: number; readonly headers: Headers; readonly text: string; readonly ms: number }
  | { readonly ok: false; readonly error: string; readonly aborted: boolean }
> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  try {
    const started = Date.now()
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        accept: 'application/json, text/event-stream',
        ...headers,
      },
      body: JSON.stringify(body),
      signal: controller.signal,
    })
    const text = await response.text()
    return {
      ok: true,
      status: response.status,
      headers: response.headers,
      text,
      ms: Date.now() - started,
    }
  } catch (error: unknown) {
    return { ok: false, error: errorMessage(error), aborted: controller.signal.aborted }
  } finally {
    clearTimeout(timer)
  }
}

async function diagnoseHttpLog(server: McpServerView, lines: string[]): Promise<void> {
  lines.push(`[${stamp()}] 发送 initialize：POST ${server.url}`)
  lines.push(`[${stamp()}] 请求头：${maskHeadersForLog(server.headers)}`)
  const init = await postJson(server.url, server.headers, INITIALIZE_BODY, 10_000)
  if (!init.ok) {
    lines.push(`[${stamp()}] 请求失败：${init.aborted ? '超时（10 秒）' : init.error}`)
    return
  }
  lines.push(`[${stamp()}] 响应：HTTP ${init.status}，用时 ${init.ms}ms`)
  for (const key of ['www-authenticate', 'mcp-session-id', 'content-type'] as const) {
    const value = init.headers.get(key)
    if (value) lines.push(`[${stamp()}]   ${key}: ${value.slice(0, 300)}`)
  }
  lines.push(`[${stamp()}] 响应体：${init.text ? init.text.slice(0, 1200) : '(空)'}`)
  if (init.status === 401 || init.status === 403) {
    lines.push(`[${stamp()}] 结论：需要登录（HTTP ${init.status}）`)
    const discovery = await resolveOAuth(server.url).catch(() => undefined)
    if (discovery !== undefined) {
      lines.push(`[${stamp()}] 授权服务器：${String(discovery.metadata.issuer ?? '')}`)
      lines.push(`[${stamp()}] 授权地址：${String(discovery.metadata.authorization_endpoint ?? '')}`)
      lines.push(`[${stamp()}] 令牌地址：${discovery.metadata.token_endpoint}`)
      lines.push(`[${stamp()}] 资源标识：${discovery.resource}`)
      lines.push(`[${stamp()}] 可申请权限：${discovery.scopes.join(' ') || '(无)'}`)
    } else {
      lines.push(`[${stamp()}] 没有 OAuth 元数据，这个地址可能只接受静态请求头`)
    }
    return
  }
  const sessionId = init.headers.get('mcp-session-id')
  if (sessionId === null || sessionId === '') {
    lines.push(`[${stamp()}] 没有返回 mcp-session-id，服务端可能不支持 Streamable HTTP`)
    return
  }
  await postJson(
    server.url,
    { ...server.headers, 'mcp-session-id': sessionId },
    { jsonrpc: '2.0', method: 'notifications/initialized' },
    5_000,
  )
  const list = await postJson(
    server.url,
    { ...server.headers, 'mcp-session-id': sessionId },
    { jsonrpc: '2.0', id: 2, method: 'tools/list', params: {} },
    10_000,
  )
  if (!list.ok) {
    lines.push(`[${stamp()}] tools/list 失败：${list.error}`)
    return
  }
  lines.push(`[${stamp()}] tools/list 响应：HTTP ${list.status}，用时 ${list.ms}ms`)
  const parsed = parsePayload(list.text)
  if (parsed?.error !== undefined) {
    lines.push(`[${stamp()}] 错误：${JSON.stringify(parsed.error).slice(0, 500)}`)
  }
  const toolsValue = isObject(parsed?.result) ? parsed.result.tools : undefined
  const names = Array.isArray(toolsValue)
    ? toolsValue
      .map((tool) => (isObject(tool) ? String(tool.name ?? '') : ''))
      .filter((name) => name !== '')
    : []
  lines.push(
    `[${stamp()}] 工具数：${names.length}${names.length > 0 ? `（${names.slice(0, 8).join(', ')}…）` : ''}`,
  )
  const initParsed = parsePayload(init.text)
  const protocol = isObject(initParsed?.result) ? initParsed.result.protocolVersion : undefined
  if (typeof protocol === 'string') {
    lines.push(`[${stamp()}] 协议版本：${protocol}`)
  }
  if (names.length > 0) {
    lines.push(`[${stamp()}] 结论：服务端正常，工具也能列出来。面板还是"启动中"的话，是客户端连接这一侧的问题`)
  }
}

async function diagnoseStdioLog(server: McpServerView, lines: string[]): Promise<void> {
  lines.push(`[${stamp()}] 启动进程：${[server.command].concat([...server.args]).join(' ')}`)
  lines.push(`[${stamp()}] 工作目录：${server.cwd || process.cwd()}`)
  lines.push(
    `[${stamp()}] 环境变量：${Object.keys(server.env).length > 0 ? Object.keys(server.env).join(', ') : '(无)'}`,
  )
  let child: ReturnType<typeof spawn>
  try {
    child = spawn(server.command, [...server.args], {
      cwd: server.cwd || undefined,
      env: { ...process.env, ...server.env },
      windowsHide: true,
      stdio: ['pipe', 'pipe', 'pipe'],
    })
  } catch (error: unknown) {
    lines.push(`[${stamp()}] 启动失败：${errorMessage(error)}`)
    return
  }

  let stdout = ''
  let stderr = ''
  let exited = ''
  child.stdout?.on('data', (chunk: Buffer | string) => {
    stdout += String(chunk)
  })
  child.stderr?.on('data', (chunk: Buffer | string) => {
    stderr += String(chunk)
  })
  child.on('error', (error) => {
    lines.push(`[${stamp()}] 进程错误：${errorMessage(error)}`)
  })
  child.on('exit', (code, signal) => {
    exited = `进程退出：code=${String(code)}${signal ? ` signal=${signal}` : ''}`
  })
  try {
    child.stdin?.write(`${JSON.stringify(INITIALIZE_BODY)}\n`)
  } catch {
    // stdin may already be closed
  }
  await new Promise<void>((resolveDelay) => setTimeout(resolveDelay, 6_000))
  lines.push(`[${stamp()}] 已发送 initialize，观察 6 秒`)
  if (exited !== '') lines.push(`[${stamp()}] ${exited}`)
  if (stdout.trim() !== '') lines.push(`[${stamp()}] stdout：\n${stdout.slice(0, 3000).trim()}`)
  if (stderr.trim() !== '') lines.push(`[${stamp()}] stderr：\n${stderr.slice(0, 3000).trim()}`)
  if (stdout.trim() === '' && stderr.trim() === '') {
    lines.push(`[${stamp()}] 六秒内没有任何输出。常见原因：命令不在 PATH、包没装、缺少 token、网络问题`)
  } else if (stdout.includes('"result"')) {
    lines.push(`[${stamp()}] 结论：收到 initialize 响应，服务端是活的`)
  } else {
    lines.push(`[${stamp()}] 结论：有输出，但没收到 initialize 响应`)
  }
  try {
    if (process.platform === 'win32') {
      spawn('taskkill', ['/pid', String(child.pid), '/T', '/F'], {
        stdio: 'ignore',
        windowsHide: true,
      })
    } else {
      child.kill('SIGKILL')
    }
  } catch {
    // best effort
  }
}

/**
 * Run a diagnose transcript for one server by name.
 * @param ctx - plugin context.
 * @param name - serverName.
 * @param env - environment for path resolution.
 */
export async function diagnoseServer(
  ctx: Context,
  name: string,
  env: Readonly<Record<string, string | undefined>> = process.env,
): Promise<{ readonly name: string; readonly text: string }> {
  const row = (await loadPatchRows(env)).find((item) => item.config?.serverName === name)
  if (row === undefined) {
    throw new McpHostError('not-found', `服务器 "${name}" 不存在`)
  }
  // Diagnose needs the real secrets, so rebuild the view without masking.
  const server = viewFromPatchRow(row)
  const lines: string[] = []
  lines.push(`[${stamp()}] ${server.name}（${server.transport === 'http' ? 'HTTP' : 'stdio'}）`)
  lines.push(
    `[${stamp()}] 启用：${server.enabled ? '是' : '否'} · 工具调用超时：${server.timeoutMs}ms`,
  )
  const loader = lookup<LoaderService>(ctx, 'loader')
  const entry = findEntry(loader, row)
  lines.push(
    `[${stamp()}] 运行时条目：${entry !== null ? `已加载（实际 id=${entry.id}）` : `未加载（id=${row.id}）`}`,
  )
  lines.push(
    `[${stamp()}] 当前工具数：${countTools(lookup<ToolsService>(ctx, 'tools'), `mcp__${server.name}__`)}`,
  )
  if (server.transport === 'http') await diagnoseHttpLog(server, lines)
  else await diagnoseStdioLog(server, lines)
  return { name: server.name, text: lines.join('\n') }
}

function sendFailure(
  response: RouteResponse,
  status: number,
  code: McpFailureCode,
  message: string,
): void {
  sendJson(response, status, { ok: false, error: { code, message } })
}

function sendFromError(response: RouteResponse, error: unknown): void {
  if (error instanceof McpHostError) {
    sendFailure(response, error.status, error.code, error.message)
    return
  }
  sendFailure(response, 500, 'internal', errorMessage(error))
}

function requiredField(source: Record<string, unknown>, key: string): string {
  const value = nonEmptyString(source[key])
  if (value === undefined) {
    throw new McpHostError('bad-request', `缺少 ${key} 字段`)
  }
  return value
}

async function readBodyRecord(
  request: RouteRequest,
  maxBytes: number = MCP_MAX_BODY_BYTES,
): Promise<Record<string, unknown>> {
  const result = await readJsonBody(request, maxBytes)
  if (!result.ok) {
    if (result.status === 413) {
      throw new McpHostError('bad-request', '请求体超过大小上限')
    }
    throw new McpHostError('bad-request', '请求体不是合法的 JSON 对象')
  }
  if (!isObject(result.value)) {
    throw new McpHostError('bad-request', '请求体必须是 JSON 对象')
  }
  return result.value
}

/** Rebuild a row when only the enabled flag changes. */
function rebuildRow(previous: McpPatchRow, enabled: boolean): McpPatchRow {
  const row: McpPatchRow = {
    id: previous.id,
    name: MCP_CLIENT_PACKAGE,
    config: previous.config,
  }
  if (!enabled) return { ...row, disabled: true }
  return row
}

async function handleState(
  ctx: Context,
  url: URL,
  response: RouteResponse,
): Promise<void> {
  const fresh = url.searchParams.get('fresh') === '1'
  sendJson(response, 200, { ok: true, state: await buildManagerState(ctx, process.env, { fresh }) })
}

/**
 * Retry one server: drop its cached probe and, for a stdio row, re-apply the
 * loader entry so a dead child process is respawned. Answers with a fresh
 * state so the caller does not need a second round trip.
 */
async function handleReconnect(
  ctx: Context,
  request: RouteRequest,
  response: RouteResponse,
): Promise<void> {
  const body = await readBodyRecord(request)
  const name = requiredField(body, 'name')
  const rows = await loadPatchRows()
  const row = rows.find((item) => item.config.serverName === name)
  if (row === undefined) throw new McpHostError('not-found', `服务器 "${name}" 不存在`)
  PROBES.delete(`${name}|${String(row.config.url ?? '')}`)
  let warning: { readonly code: McpFailureCode; readonly message: string } | undefined
  if (row.config.transport !== 'streamable-http') {
    const applied = await applyRow(ctx, row, 'save')
    if (!applied.ok) warning = { code: 'loader-error', message: applied.error }
  }
  const state = await buildManagerState(ctx, process.env, { fresh: true })
  sendJson(response, 200, { ok: true, state, ...(warning !== undefined ? { warning } : {}) })
}

async function handleServer(
  ctx: Context,
  request: RouteRequest,
  response: RouteResponse,
): Promise<void> {
  const body = await readBodyRecord(request)
  // Accept either a bare form payload or `{ server: … }` from older clients.
  const rawInput = isObject(body.server) ? body.server : body
  const input = normalizeServerInput(rawInput)
  const rows = await loadPatchRows()
  const previousName = nonEmptyString(body.previousName) ?? input.name
  if (
    rows.some((row) =>
      row.config.serverName === input.name && row.config.serverName !== previousName)
  ) {
    throw new McpHostError('conflict', `服务器 "${input.name}" 已存在`)
  }
  const previous = rows.find((row) => row.config.serverName === previousName)
  const row = buildPatchRow(input, previous)
  const next = previous === undefined
    ? [...rows, row]
    : rows.map((item) => (item === previous ? row : item))
  await writePatchRows(next)
  // Clear a stale probe when the URL may have changed.
  if (row.config.transport === 'streamable-http') {
    PROBES.delete(`${row.config.serverName}|${String(row.config.url ?? '')}`)
  }
  const applied = await applyRow(ctx, row, 'save')
  const state = await buildManagerState(ctx)
  const server = state.servers.find((item) => item.name === row.config.serverName)
  if (server === undefined) {
    throw new McpHostError('internal', '写入后找不到服务器视图')
  }
  if (!applied.ok) {
    // Patch write succeeded; surface the loader fault without rolling back.
    sendJson(response, 200, {
      ok: true,
      server,
      state,
      warning: { code: 'loader-error' as const, message: applied.error },
    })
    return
  }
  sendJson(response, 200, { ok: true, server, state })
}

async function handleToggle(
  ctx: Context,
  request: RouteRequest,
  response: RouteResponse,
): Promise<void> {
  const body = await readBodyRecord(request)
  const name = requiredField(body, 'name')
  const enabled = body.enabled !== false
  const rows = await loadPatchRows()
  const index = rows.findIndex((row) => row.config.serverName === name)
  if (index < 0) throw new McpHostError('not-found', `服务器 "${name}" 不存在`)
  const previous = rows[index]
  if (previous === undefined) throw new McpHostError('not-found', `服务器 "${name}" 不存在`)
  const row = rebuildRow(previous, enabled)
  const next = rows.slice()
  next[index] = row
  await writePatchRows(next)
  await applyRow(ctx, row, 'save')
  sendJson(response, 200, { ok: true, state: await buildManagerState(ctx) })
}

async function handleRemove(
  ctx: Context,
  request: RouteRequest,
  response: RouteResponse,
): Promise<void> {
  const body = await readBodyRecord(request)
  const name = requiredField(body, 'name')
  const rows = await loadPatchRows()
  const row = rows.find((item) => item.config.serverName === name)
  if (row === undefined) throw new McpHostError('not-found', `服务器 "${name}" 不存在`)
  await writePatchRows(rows.filter((item) => item !== row))
  await applyRow(ctx, row, 'remove')
  if (row.config.transport === 'streamable-http') {
    PROBES.delete(`${name}|${String(row.config.url ?? '')}`)
  }
  sendJson(response, 200, { ok: true, state: await buildManagerState(ctx) })
}

async function handleAdopt(
  ctx: Context,
  request: RouteRequest,
  response: RouteResponse,
): Promise<void> {
  // Tolerate an empty or unreadable body: adopt-everything is the default
  // operation and revalidates every candidate anyway.
  const body = await readBodyRecord(request).catch(
    () => ({}) as Record<string, unknown>,
  )
  const names = Array.isArray(body.names)
    ? body.names.filter((item): item is string => typeof item === 'string' && item !== '')
    : undefined
  const result = await adoptUnmanaged(ctx, names)
  sendJson(response, 200, {
    ok: true,
    result,
    state: await buildManagerState(ctx),
  })
}

async function handleImport(
  ctx: Context,
  request: RouteRequest,
  response: RouteResponse,
): Promise<void> {
  const body = await readBodyRecord(request)
  const text = typeof body.text === 'string' ? body.text : ''
  const inputs = parseImportText(text)
  if (inputs.length === 0) {
    throw new McpHostError('bad-request', '没有从 JSON 里读出一台服务器')
  }
  let rows = await loadPatchRows()
  const imported: string[] = []
  for (const input of inputs) {
    const previous = rows.find((row) => row.config.serverName === input.name)
    const row = buildPatchRow(input, previous)
    rows = previous === undefined
      ? [...rows, row]
      : rows.map((item) => (item === previous ? row : item))
    imported.push(input.name)
  }
  await writePatchRows(rows)
  for (const name of imported) {
    const row = rows.find((item) => item.config.serverName === name)
    if (row !== undefined) await applyRow(ctx, row, 'save')
  }
  sendJson(response, 200, {
    ok: true,
    state: await buildManagerState(ctx),
    imported,
  })
}

async function handleExport(ctx: Context, response: RouteResponse): Promise<void> {
  const state = await buildManagerState(ctx)
  // Export uses masked views; re-read unmasked for fidelity of env/headers.
  const rows = await loadPatchRows()
  const views = rows.map((row) => viewFromPatchRow(row))
  sendJson(response, 200, {
    ok: true,
    result: {
      text: buildExportText(views),
      format: 'mcpServers' as const,
    },
    // Keep state available for clients that refresh after export.
    state,
  })
}

async function handleDiagnose(
  ctx: Context,
  request: RouteRequest,
  response: RouteResponse,
): Promise<void> {
  const body = await readBodyRecord(request)
  const name = requiredField(body, 'name')
  try {
    const result = await diagnoseServer(ctx, name)
    sendJson(response, 200, { ok: true, result })
  } catch (error: unknown) {
    if (error instanceof McpHostError) throw error
    throw new McpHostError('diagnose-error', errorMessage(error))
  }
}

async function handleOAuthStart(
  ctx: Context,
  request: RouteRequest,
  response: RouteResponse,
): Promise<void> {
  const body = await readBodyRecord(request)
  const name = requiredField(body, 'name')
  const row = (await loadPatchRows()).find((item) => item.config.serverName === name)
  if (row === undefined) throw new McpHostError('not-found', `服务器 "${name}" 不存在`)
  const config = row.config
  if (config.transport !== 'streamable-http' || typeof config.url !== 'string') {
    throw new McpHostError('bad-request', '只有 HTTP 服务器可以 OAuth 登录')
  }

  let discovery
  try {
    discovery = await resolveOAuth(config.url)
  } catch (error: unknown) {
    throw new McpHostError('oauth-error', errorMessage(error))
  }
  if (discovery === undefined) {
    throw new McpHostError('oauth-error', '这个地址没有暴露 OAuth 配置，无法自动登录')
  }

  const metadata = discovery.metadata
  const state = createState()
  const { verifier, challenge } = createPkce()
  const loopback = await startLoopbackServer(state, 300_000, OAUTH_CALLBACK_PORT)
  const oauthPath = resolveOAuthFile()
  const store = await loadStore(oauthPath)
  const clientKey = `${name}|${loopback.redirectUri}`
  let clientId = store.clients[clientKey]?.clientId
  if (clientId === undefined) {
    try {
      const registration = await registerClient(metadata, loopback.redirectUri)
      clientId = registration?.client_id
      if (clientId !== undefined) {
        store.clients[clientKey] = {
          clientId,
          serverUrl: String(config.url ?? ''),
          at: Date.now(),
        }
        await saveStore(oauthPath, store)
      }
    } catch (error: unknown) {
      await loopback.close().catch(() => undefined)
      throw new McpHostError('oauth-error', errorMessage(error))
    }
  }
  if (clientId === undefined) {
    await loopback.close().catch(() => undefined)
    throw new McpHostError('oauth-error', '拿不到 client_id：服务器不支持动态注册')
  }

  const scope = typeof body.scope === 'string' && body.scope !== ''
    ? body.scope
    : discovery.scopes.length > 0
      ? discovery.scopes.join(' ')
      : undefined
  const authorizationUrl = buildAuthorizationUrl(
    metadata,
    clientId,
    loopback.redirectUri,
    challenge,
    state,
    scope,
    discovery.resource,
  )
  const flowId = createState('flow-')
  const flow: OAuthFlow = {
    flowId,
    name,
    state,
    clientId,
    metadata,
    verifier,
    redirectUri: loopback.redirectUri,
    resource: discovery.resource,
    loopback,
    status: 'pending',
  }
  OAUTH_FLOWS.set(flowId, flow)
  loopback.waitForCode().then(
    (result) => {
      flow.code = result.code
    },
    (error: unknown) => {
      flow.status = 'error'
      flow.error = errorMessage(error)
    },
  )
  openExternal(authorizationUrl)
  sendJson(response, 200, {
    ok: true,
    result: { flowId, authorizationUrl },
  })
  // Silence unused-ctx until poll needs the same composition.
  void ctx
}

async function handleOAuthPoll(
  ctx: Context,
  url: URL,
  response: RouteResponse,
): Promise<void> {
  const flowId = nonEmptyString(url.searchParams.get('flowId'))
  if (flowId === undefined) {
    throw new McpHostError('bad-request', '缺少 flowId 字段')
  }
  const flow = OAUTH_FLOWS.get(flowId)
  if (flow === undefined) {
    throw new McpHostError('not-found', '这次登录流程不存在或已经结束')
  }
  if (flow.status === 'error') {
    OAUTH_FLOWS.delete(flowId)
    await flow.loopback.close().catch(() => undefined)
    sendJson(response, 200, {
      ok: true,
      result: { status: 'error' as const, message: flow.error ?? '授权失败' },
    })
    return
  }
  if (flow.code === undefined) {
    sendJson(response, 200, { ok: true, result: { status: 'pending' as const } })
    return
  }
  if (flow.status === 'done') {
    sendJson(response, 200, { ok: true, result: { status: 'done' as const } })
    return
  }

  flow.status = 'exchanging'
  try {
    const tokens = await exchangeCode(
      flow.metadata,
      flow.clientId,
      flow.code,
      flow.verifier,
      flow.redirectUri,
      flow.resource,
    )
    const header = authorizationHeader(tokens)
    const oauthPath = resolveOAuthFile()
    const store = await loadStore(oauthPath)
    const rows = await loadPatchRows()
    const index = rows.findIndex((row) => row.config.serverName === flow.name)
    const serverUrl = index >= 0 ? String(rows[index]?.config.url ?? '') : ''
    store.servers[flow.name] = {
      clientId: flow.clientId,
      serverUrl,
      tokenEndpoint: flow.metadata.token_endpoint,
      tokenType: typeof tokens.token_type === 'string' ? tokens.token_type : undefined,
      accessToken: tokens.access_token,
      expiresIn: typeof tokens.expires_in === 'number' ? tokens.expires_in : undefined,
      obtainedAt: Date.now(),
    }
    await saveStore(oauthPath, store)

    if (index >= 0) {
      const row = rows[index]
      if (row !== undefined) {
        const headers = { ...stringMap(row.config.headers), Authorization: header }
        const config = { ...row.config, headers }
        const next = rows.slice()
        next[index] = {
          id: row.id,
          name: MCP_CLIENT_PACKAGE,
          ...(row.disabled === true ? { disabled: true as const } : {}),
          config,
        }
        await writePatchRows(next)
        PROBES.delete(`${flow.name}|${String(config.url ?? '')}`)
        await applyRow(ctx, next[index]!, 'save')
      }
    }
    flow.status = 'done'
    await flow.loopback.close().catch(() => undefined)
    OAUTH_FLOWS.delete(flowId)
    sendJson(response, 200, { ok: true, result: { status: 'done' as const } })
  } catch (error: unknown) {
    flow.status = 'error'
    flow.error = errorMessage(error)
    OAUTH_FLOWS.delete(flowId)
    await flow.loopback.close().catch(() => undefined)
    sendJson(response, 200, {
      ok: true,
      result: { status: 'error' as const, message: flow.error },
    })
  }
}

/**
 * Answer one route request.
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
  const subpath = url.pathname.startsWith(`${MCP_MANAGER_ROUTE}/`)
    ? url.pathname.slice(MCP_MANAGER_ROUTE.length)
    : url.pathname === MCP_MANAGER_ROUTE
      ? '/'
      : url.pathname
  const expected = ENDPOINT_METHODS[subpath]
  if (expected === undefined) {
    sendFailure(response, 404, 'bad-request', `未知的接口：${method} ${url.pathname}`)
    return
  }
  if (method !== expected) {
    sendFailure(response, 405, 'bad-request', `该接口只接受 ${expected} 请求`)
    return
  }

  switch (subpath) {
    case '/state':
      await handleState(ctx, url, response)
      return
    case '/server':
      await handleServer(ctx, request, response)
      return
    case '/toggle':
      await handleToggle(ctx, request, response)
      return
    case '/remove':
      await handleRemove(ctx, request, response)
      return
    case '/adopt':
      await handleAdopt(ctx, request, response)
      return
    case '/reconnect':
      await handleReconnect(ctx, request, response)
      return
    case '/import':
      await handleImport(ctx, request, response)
      return
    case '/export':
      await handleExport(ctx, response)
      return
    case '/diagnose':
      await handleDiagnose(ctx, request, response)
      return
    case '/oauth/start':
      await handleOAuthStart(ctx, request, response)
      return
    case '/oauth/poll':
      await handleOAuthPoll(ctx, url, response)
      return
    default:
      throw new McpHostError('bad-request', `未知的接口：${method} ${url.pathname}`)
  }
}

/**
 * Install the MCP manager Host routes.
 *
 * Call this from a context that provides `webServer`. `loader` and `tools` stay
 * optional capabilities read per request, so a thin composition still answers
 * patch state without hot-apply.
 * @param ctx - plugin context carrying the web server.
 */
export function installMcpManagerHost(ctx: Context): void {
  const webServer = lookup<WebServerService>(ctx, 'webServer')
  if (webServer === undefined) return

  const handler = async (request: RouteRequest, response: RouteResponse): Promise<void> => {
    if (!isTrustedRequest(request)) {
      sendFailure(response, 403, 'not-trusted', '仅允许本机同源请求访问 MCP 管理接口')
      return
    }
    try {
      await dispatch(ctx, request, response)
    } catch (error: unknown) {
      // normalizeServerInput throws plain Error with Chinese messages.
      if (error instanceof Error && !(error instanceof McpHostError)) {
        const message = error.message
        if (
          message.includes('名称')
          || message.includes('请求体')
          || message.includes('填写')
          || message.includes('导入')
          || message.includes('合法')
          || message.includes('识别')
        ) {
          sendFailure(response, 400, 'bad-request', message)
          return
        }
      }
      sendFromError(response, error)
    }
  }

  ctx.effect(
    () => webServer.register({ kind: 'prefix', path: MCP_MANAGER_ROUTE, handler }),
    ROUTE_EFFECT_LABEL,
  )
}

/** Test-only probe cache clear. */
export function clearProbeCache(): void {
  PROBES.clear()
}

/** Test-only OAuth flow clear. */
export function clearOAuthFlows(): void {
  for (const flow of OAUTH_FLOWS.values()) {
    void flow.loopback.close().catch(() => undefined)
  }
  OAUTH_FLOWS.clear()
}
