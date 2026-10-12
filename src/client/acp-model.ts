/**
 * Pure model behind the ACP agents settings card: draft shape, wire conversion,
 * validation, list edits, and namespace discovery.
 *
 * Everything the card *decides* lives here, away from React, so it is testable
 * without a DOM and the component stays a thin render over it. The card edits
 * one field — `agents` — as a whole value: the settings service fences a write
 * with the namespace revision, so a single array write is both atomic and small
 * enough that no partial agent list is ever persisted.
 *
 * @module dsh-session-map/client/acp-model
 */

/** One agent as the card edits it: every field is text, because every input is a text input. */
export interface AgentDraft {
  /** Registry name and the stem of the default tool name. */
  name: string
  /** The CLI to launch. */
  command: string
  /** Arguments, space-separated as typed. */
  args: string
  /** Session mode, or empty to leave the agent's own default. */
  mode: string
  /** Permission auto-answer policy. */
  permission: 'allow' | 'reject'
  /** Delegation tool name; empty means the derived default. */
  toolName: string
  /** Working-directory override; empty means the delegating session's cwd. */
  cwd: string
  /** Extra environment entries, one `KEY=VALUE` per line. */
  env: string
  /** Session configuration options, one `KEY=VALUE` per line. */
  configOptions: string
  /** Whether the backend mounts this agent at all. */
  enabled: boolean
}

/** One validation problem, addressed to a draft. */
export interface DraftProblem {
  /** Index into the draft list. */
  readonly index: number
  /** Human-readable message shown under that agent's row. */
  readonly message: string
}

/** Tool names are model-facing identifiers. */
const TOOL_NAME = /^[a-z0-9_]+$/

/** Agent names address a provider registry and seed a tool name. */
const AGENT_NAME = /^[A-Za-z0-9._-]+$/

/**
 * The delegation tool name derived from an agent name, mirroring the host's rule
 * so the card's placeholder shows what the backend will really register.
 * @param name - the agent name.
 * @returns the derived tool name.
 */
export function defaultToolName(name: string): string {
  const folded = name.toLowerCase().replaceAll(/[^a-z0-9]+/g, '_').replaceAll(/^_+|_+$/g, '')
  return `subagent_${folded === '' ? 'agent' : folded}`
}

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
    toolName: '',
    cwd: '',
    env: '',
    configOptions: '',
    enabled: true,
  }
}

/** Read a string field, treating anything else as absent. */
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
    toolName: text(record['toolName']),
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
 * Convert the drafts back to the stored shape, dropping empty optional fields
 * and defaults so the patch stays readable.
 * @param drafts - the drafts to persist.
 * @returns the `agents` value, or the first problem that makes them unwritable.
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
      if (draft.toolName.trim() !== '') agent['toolName'] = draft.toolName.trim()
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
 * Validate the whole draft list: the same rules the backend enforces, surfaced
 * before a write rather than as a Host refusal.
 * @param drafts - the drafts to check.
 * @returns every problem found, in draft order.
 */
export function validateDrafts(drafts: readonly AgentDraft[]): DraftProblem[] {
  const problems: DraftProblem[] = []
  const seen = new Map<string, number>()
  for (const [index, draft] of drafts.entries()) {
    const name = draft.name.trim()
    if (name === '') problems.push({ index, message: '名称必填（注册名，也是默认工具名的来源）' })
    else if (!AGENT_NAME.test(name)) problems.push({ index, message: '名称只能用字母、数字、点、下划线、连字符' })
    else if (seen.has(name)) problems.push({ index, message: `名称与第 ${(seen.get(name) ?? 0) + 1} 个 agent 重复` })
    else seen.set(name, index)

    if (draft.command.trim() === '') problems.push({ index, message: '命令必填（CLI 名字或可执行文件路径）' })
    const toolName = draft.toolName.trim()
    if (toolName !== '' && !TOOL_NAME.test(toolName)) problems.push({ index, message: '工具名只能用小写字母、数字、下划线' })
    const env = parsePairs(draft.env)
    if (!env.ok) problems.push({ index, message: `环境变量：${env.message}` })
    const options = parsePairs(draft.configOptions)
    if (!options.ok) problems.push({ index, message: `会话选项：${options.message}` })
  }
  return problems
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

/** Resolve one node of a schemastery `toJSON()` ref graph. */
function resolveSchemaNode(schema: unknown, uid: unknown): Record<string, unknown> | undefined {
  if (schema === null || typeof schema !== 'object') return undefined
  const graph = schema as { refs?: Record<string, unknown> }
  const node = graph.refs?.[String(uid)]
  return node !== null && typeof node === 'object' ? node as Record<string, unknown> : undefined
}

/**
 * Whether one namespace's schema is this plugin's agent list.
 *
 * The Host does not report which plugin owns a namespace, so a card that must
 * find its own entry identifies the schema instead: an `agents` array whose
 * items declare `name` and `command`. Matching on shape rather than on a
 * hard-coded row id also means a profile that renamed or inserted the row still
 * gets its card.
 * @param view - the namespace view.
 * @returns true when the schema is the ACP backend's.
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
 * Choose the namespace this card edits.
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
