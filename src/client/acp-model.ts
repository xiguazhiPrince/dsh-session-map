/**
 * Pure model behind the ACP 供应商 settings page: draft shape, wire conversion,
 * validation, list edits, the vendor table, and namespace discovery.
 *
 * Everything the page *decides* lives here, away from React, so it is testable
 * without a DOM (`tsdown` builds this file for Node as `lib/acp-model.js` as well
 * as bundling it into the browser half) and the component stays a thin render
 * over it.
 *
 * The page edits ONE field — `agents` — and always writes it as a whole value:
 * the settings service strips every volatile field from the stored patch and
 * merges the new one in, so a single array write is both atomic and the only
 * shape that cannot leave a half-written agent list behind.
 *
 * @module dsh-session-map/client/acp-model
 */

/** One agent as the page edits it: every field is text, because every input is a text input. */
export interface AgentDraft {
  /** Model id on the `acp` route, and the stem of that agent's preset card id. */
  name: string
  /** The CLI to launch: a name on `PATH`, or an executable path. */
  command: string
  /** Arguments, space-separated as typed. */
  args: string
  /** Session mode, or empty to leave the agent's own default. */
  mode: string
  /** Permission auto-answer policy under `approval: policy`. */
  permission: 'allow' | 'reject'
  /** Working-directory override; empty means the Session's own workspace. */
  cwd: string
  /** Extra environment entries, one `KEY=VALUE` per line. */
  env: string
  /** Session configuration options applied after `session/new`, one `KEY=VALUE` per line. */
  configOptions: string
  /** Whether the route mounts this agent at all. */
  enabled: boolean
}

/** One validation problem, addressed to a draft. */
export interface DraftProblem {
  /** Index into the draft list. */
  readonly index: number
  /** Human-readable message shown under that agent's row. */
  readonly message: string
}

/**
 * One vendor preset: what a "add this CLI" button fills in.
 *
 * Facts only, no behaviour: the command lands verbatim in the draft, and the
 * `docs` link is what the page's intro points at. A vendor whose CLI is
 * installed under a different name keeps working through the general command
 * ladder, so a stale entry costs a failed spawn and one diagnostic line, never
 * a wrong default.
 */
export interface AcpVendor {
  /** Draft name stem, and the button's identity. */
  readonly id: string
  /** Button text. */
  readonly label: string
  /** The CLI name to launch. */
  readonly command: string
  /** Arguments, space-separated. */
  readonly args: string
  /** Official ACP documentation. */
  readonly docs: string
  /** Optional caveat shown beside the button. */
  readonly note?: string
}

/** The vendor presets this page offers. */
export const ACP_VENDORS: readonly AcpVendor[] = [
  {
    id: 'cursor',
    label: 'Cursor CLI',
    command: 'cursor-agent',
    args: 'acp',
    docs: 'https://cursor.com/docs/cli/acp',
    note: '新版安装也可能只提供 agent，两个名字都能解析；首次使用先在终端登录。',
  },
  {
    id: 'opencode',
    label: 'opencode',
    command: 'opencode',
    args: 'acp',
    docs: 'https://opencode.ai/docs/acp',
  },
  {
    id: 'gemini',
    label: 'Gemini CLI',
    command: 'gemini',
    args: '--acp',
    docs: 'https://geminicli.com/docs/cli/acp-mode/',
    note: 'Gemini CLI 已于 2026-06-18 由 Antigravity CLI 取代，仍可用但需自行确认。',
  },
]

/** The shipped row id, used when the schema marker is absent (a renamed or re-inserted row). */
export const KNOWN_ENTRY_ID = 'acp-agent'

/** Agent names address the model route and seed a preset card id. */
const AGENT_NAME = /^[A-Za-z0-9._-]+$/

/** Absolute-path shapes the Host accepts for `cwd`: a drive root, a UNC root, or a POSIX root. */
const ABSOLUTE_CWD = /^(?:[A-Za-z]:[\\/]|\\\\|\/)/

/**
 * A new, empty agent draft.
 * @returns the draft.
 */
export function emptyAgent(): AgentDraft {
  return {
    name: '',
    command: '',
    args: 'acp',
    mode: '',
    permission: 'allow',
    cwd: '',
    env: '',
    configOptions: '',
    enabled: true,
  }
}

/**
 * Pick a name not already used by another draft.
 * @param base - the preferred stem.
 * @param taken - names already in use.
 * @returns `base`, or `base-2`, `base-3`, … until one is free.
 */
export function uniqueName(base: string, taken: readonly string[]): string {
  const used = new Set(taken.map(name => name.trim()))
  if (!used.has(base)) return base
  for (let suffix = 2; suffix < 1000; suffix += 1) {
    const candidate = `${base}-${String(suffix)}`
    if (!used.has(candidate)) return candidate
  }
  return `${base}-${String(Date.now())}`
}

/**
 * A draft pre-filled from one vendor preset, named so it cannot collide with an
 * agent the page is already showing.
 * @param vendor - the preset.
 * @param existing - the drafts currently in the list.
 * @returns the draft.
 */
export function vendorAgent(vendor: AcpVendor, existing: readonly AgentDraft[]): AgentDraft {
  return {
    ...emptyAgent(),
    name: uniqueName(vendor.id, existing.map(draft => draft.name)),
    command: vendor.command,
    args: vendor.args,
  }
}

/**
 * Read a string field, treating anything else as absent.
 * @param value - the stored value.
 * @returns the text, or `''`.
 */
function text(value: unknown): string {
  return typeof value === 'string' ? value : ''
}

/**
 * Format a scalar map as `KEY=VALUE` lines.
 * @param value - the map as stored.
 * @returns the textarea text.
 */
export function formatPairs(value: unknown): string {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return ''
  return Object.entries(value as Record<string, unknown>)
    .map(([key, entry]) => `${key}=${String(entry)}`)
    .join('\n')
}

/**
 * Parse `KEY=VALUE` lines.
 * @param source - the textarea text.
 * @returns the parsed map, or the first problem found.
 */
export function parsePairs(source: string): { ok: true; value: Record<string, string> } | { ok: false; message: string } {
  const value: Record<string, string> = {}
  for (const [number, rawLine] of source.split('\n').entries()) {
    const line = rawLine.trim()
    if (line === '' || line.startsWith('#')) continue
    const separator = line.indexOf('=')
    if (separator <= 0) return { ok: false, message: `第 ${number + 1} 行不是 KEY=VALUE` }
    const key = line.slice(0, separator).trim()
    if (key === '') return { ok: false, message: `第 ${number + 1} 行缺少键名` }
    if (Object.hasOwn(value, key)) return { ok: false, message: `第 ${number + 1} 行的键 ${key} 重复` }
    value[key] = line.slice(separator + 1).trim()
  }
  return { ok: true, value }
}

/**
 * Split an argument line the way a shell user expects, honouring double quotes.
 *
 * The Host never interprets a shell, so this is not a shell parser: it is the
 * one convention the page documents (space-separated, double quotes for a token
 * that contains a space).
 * @param source - the argument text.
 * @returns the argv tail.
 */
export function parseArgs(source: string): string[] {
  const tokens: string[] = []
  let current = ''
  let quoted = false
  let started = false
  for (const character of source) {
    if (character === '"') { quoted = !quoted; started = true; continue }
    if (!quoted && /\s/.test(character)) {
      if (started) tokens.push(current)
      current = ''
      started = false
      continue
    }
    current += character
    started = true
  }
  if (started) tokens.push(current)
  return tokens
}

/**
 * Convert one stored agent into a draft.
 * @param raw - the stored agent.
 * @returns the draft.
 */
export function draftFromWire(raw: unknown): AgentDraft {
  const record = (raw ?? {}) as Record<string, unknown>
  const args = record['args']
  return {
    name: text(record['name']),
    command: text(record['command']),
    args: Array.isArray(args) ? args.map(String).join(' ') : args === undefined ? '' : String(args),
    mode: text(record['mode']),
    permission: record['permission'] === 'reject' ? 'reject' : 'allow',
    cwd: text(record['cwd']),
    env: formatPairs(record['env']),
    configOptions: formatPairs(record['configOptions']),
    enabled: record['enabled'] !== false,
  }
}

/**
 * Read the stored agent list.
 * @param value - the namespace value from the settings mirror.
 * @returns the drafts, and any problem reading one of them.
 */
export function draftsFromValue(value: unknown): { drafts: AgentDraft[]; problems: DraftProblem[] } {
  const agents = (value ?? {}) as { agents?: unknown }
  if (!Array.isArray(agents.agents)) return { drafts: [], problems: [] }
  const drafts: AgentDraft[] = []
  const problems: DraftProblem[] = []
  for (const [index, raw] of agents.agents.entries()) {
    if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) {
      problems.push({ index, message: '这一项不是有效的 agent 配置' })
      continue
    }
    drafts.push(draftFromWire(raw))
  }
  return { drafts, problems }
}

/**
 * Validate the whole draft list: the rules the backend enforces, surfaced before
 * a write rather than as a Host refusal. The Host drops a disabled agent only
 * after parsing it, so nothing here is conditional on `enabled`.
 * @param drafts - the drafts to check.
 * @returns every problem found, in draft order.
 */
export function validateDrafts(drafts: readonly AgentDraft[]): DraftProblem[] {
  const problems: DraftProblem[] = []
  const seen = new Map<string, number>()
  for (const [index, draft] of drafts.entries()) {
    const name = draft.name.trim()
    if (name === '') problems.push({ index, message: '名称必填（它就是 acp 路由上的模型 id）' })
    else if (!AGENT_NAME.test(name)) problems.push({ index, message: '名称只能用字母、数字、点、下划线、连字符' })
    else if (seen.has(name)) problems.push({ index, message: `名称与第 ${(seen.get(name) ?? 0) + 1} 个 agent 重复` })
    else seen.set(name, index)

    if (draft.command.trim() === '') problems.push({ index, message: '命令必填（CLI 名字或可执行文件路径）' })
    const cwd = draft.cwd.trim()
    if (cwd !== '' && !ABSOLUTE_CWD.test(cwd)) problems.push({ index, message: '工作目录要写绝对路径' })
    const env = parsePairs(draft.env)
    if (!env.ok) problems.push({ index, message: `环境变量：${env.message}` })
    const options = parsePairs(draft.configOptions)
    if (!options.ok) problems.push({ index, message: `会话选项：${options.message}` })
  }
  return problems
}

/**
 * Convert the drafts back to the stored shape, dropping empty optional fields
 * and every default so the patch stays readable.
 * @param drafts - the drafts to persist.
 * @returns the `agents` value, or the problems that make them unwritable.
 */
export function valueFromDrafts(drafts: readonly AgentDraft[]): { ok: true; value: unknown[] } | { ok: false; problems: DraftProblem[] } {
  const problems = validateDrafts(drafts)
  if (problems.length > 0) return { ok: false, problems }
  return {
    ok: true,
    value: drafts.map((draft) => {
      const agent: Record<string, unknown> = { name: draft.name.trim(), command: draft.command.trim() }
      const args = parseArgs(draft.args)
      if (args.length > 0 && !(args.length === 1 && args[0] === 'acp')) agent['args'] = args
      if (draft.mode.trim() !== '') agent['mode'] = draft.mode.trim()
      if (draft.permission === 'reject') agent['permission'] = 'reject'
      if (draft.cwd.trim() !== '') agent['cwd'] = draft.cwd.trim()
      const env = parsePairs(draft.env)
      if (env.ok && Object.keys(env.value).length > 0) agent['env'] = env.value
      const options = parsePairs(draft.configOptions)
      if (options.ok && Object.keys(options.value).length > 0) agent['configOptions'] = options.value
      if (!draft.enabled) agent['enabled'] = false
      return agent
    }),
  }
}

/**
 * Append a new agent.
 * @param drafts - the current drafts.
 * @returns the new list.
 */
export function addAgent(drafts: readonly AgentDraft[]): AgentDraft[] {
  return [...drafts, emptyAgent()]
}

/**
 * Remove one agent.
 * @param drafts - the current drafts.
 * @param index - the agent to drop.
 * @returns the new list.
 */
export function removeAgent(drafts: readonly AgentDraft[], index: number): AgentDraft[] {
  return drafts.filter((_, position) => position !== index)
}

/**
 * Move one agent by one position.
 * @param drafts - the current drafts.
 * @param index - the agent to move.
 * @param delta - `-1` towards the front, `1` towards the back.
 * @returns the new list, unchanged when the move would fall off an end.
 */
export function moveAgent(drafts: readonly AgentDraft[], index: number, delta: number): AgentDraft[] {
  const target = index + delta
  if (target < 0 || target >= drafts.length) return [...drafts]
  const next = [...drafts]
  const [moved] = next.splice(index, 1)
  next.splice(target, 0, moved as AgentDraft)
  return next
}

/**
 * Apply a field change to one agent.
 * @param drafts - the current drafts.
 * @param index - the agent to change.
 * @param patch - the fields to replace.
 * @returns the new list.
 */
export function patchAgent(drafts: readonly AgentDraft[], index: number, patch: Partial<AgentDraft>): AgentDraft[] {
  return drafts.map((draft, position) => (position === index ? { ...draft, ...patch } : draft))
}

/** One namespace as the client mirror reports it. */
export interface NamespaceView {
  /** The namespace id, which is the Host plugin entry id. */
  readonly ns: string
  /** The projected schema, as a schemastery ref graph. */
  readonly schema?: unknown
}

/**
 * Resolve one node of a schemastery `toJSON()` ref graph.
 * @param schema - the serialized schema envelope.
 * @param uid - the node reference to follow.
 * @returns the node, or undefined when the graph has no such reference.
 */
function resolveSchemaNode(schema: unknown, uid: unknown): Record<string, unknown> | undefined {
  if (schema === null || typeof schema !== 'object') return undefined
  const graph = schema as { refs?: Record<string, unknown> }
  const node = graph.refs?.[String(uid)]
  return node !== null && typeof node === 'object' ? node as Record<string, unknown> : undefined
}

/**
 * Whether one namespace's schema is this plugin's agent list.
 *
 * The Host does not report which plugin owns a namespace, so a page that must
 * find its own entry identifies the schema instead: an `agents` array whose
 * items declare `name` and `command`. Matching on shape rather than on a
 * hard-coded row id also means a profile that renamed or re-inserted the row
 * still gets its page.
 * @param view - the namespace view.
 * @returns true when the schema is the ACP route's.
 */
export function isAcpNamespace(view: NamespaceView): boolean {
  const graph = view.schema as { uid?: unknown } | undefined
  const root = resolveSchemaNode(view.schema, graph?.uid)
  const dict = root?.['dict'] as Record<string, unknown> | undefined
  const agents = resolveSchemaNode(view.schema, dict?.['agents'])
  if (agents?.['type'] !== 'array') return false
  const item = resolveSchemaNode(view.schema, agents['inner'])
  const itemDict = item?.['dict'] as Record<string, unknown> | undefined
  return itemDict !== undefined && itemDict['name'] !== undefined && itemDict['command'] !== undefined
}

/**
 * Choose the namespace this page edits.
 * @param namespaces - every namespace the Host serves.
 * @param fallbackId - the shipped row id, used when the schema marker is absent.
 * @returns the namespace id, or `undefined` when the Host serves none of ours.
 */
export function selectAcpNamespace(
  namespaces: readonly NamespaceView[],
  fallbackId: string,
): string | undefined {
  return namespaces.find(isAcpNamespace)?.ns ?? namespaces.find(view => view.ns === fallbackId)?.ns
}
