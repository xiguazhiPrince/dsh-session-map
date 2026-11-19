/**
 * Shared vocabulary for the Conversation → MCP tab.
 *
 * Manages native `@deepseek-ai/dsh-mcp-client` rows in the current profile's
 * `cordis.patch.yml`, kept inside a marker-delimited block owned by this plugin.
 * The Host half owns filesystem I/O, probes, OAuth, and loader hot-apply; the
 * browser half renders the approved design screens and talks only through the
 * same-origin route family below.
 *
 * This module stays platform-neutral — no Node imports — because the browser
 * bundle imports it too.
 *
 * @module dsh-session-map/mcp-manager/model
 */

/** Route family shared by the Host routes and the browser tab. */
export const MCP_MANAGER_ROUTE = '/plugin-mcp-manager'

/** Marker that opens this plugin's managed block inside cordis.patch.yml. */
export const MCP_BLOCK_BEGIN = '# >>> dsh-session-map:mcp:begin'

/** Marker that closes this plugin's managed block inside cordis.patch.yml. */
export const MCP_BLOCK_END = '# <<< dsh-session-map:mcp:end'

/** Package name every managed row must carry. */
export const MCP_CLIENT_PACKAGE = '@deepseek-ai/dsh-mcp-client'

/** Prefix for row ids this plugin creates (`mcp-session-map-<serverName>`). */
export const MCP_ROW_ID_PREFIX = 'mcp-session-map-'

/** serverName / namespace rule from dsh-mcp-client. */
export const MCP_SERVER_NAME_RE = /^[A-Za-z0-9_-]{1,32}$/

/** Default tools/call timeout, matching the product. */
export const MCP_DEFAULT_TIMEOUT_MS = 60_000

/** Largest JSON body any MCP manager route accepts. */
export const MCP_MAX_BODY_BYTES = 1024 * 1024

/** Transport the UI and wire use (maps to stdio / streamable-http on disk). */
export type McpTransport = 'stdio' | 'http'

/**
 * Connection state shown as the status dot.
 *
 * - `online` — tools are registered / probe succeeded
 * - `auth` — HTTP 401/403, needs OAuth login
 * - `idle` — enabled but still starting or reachable without tools yet
 * - `down` — unreachable or failed
 * - `off` — disabled in the patch
 */
export type McpServerState = 'online' | 'auth' | 'idle' | 'down' | 'off'

/** One tool the Host observed for a connected server (optional detail). */
export interface McpToolSummary {
  /** Raw tool name on the server (without mcp__ns__ prefix). */
  readonly name: string
  /** Short description, may be empty. */
  readonly description: string
  /**
   * JSON Schema for the tool arguments when the Host could read it.
   * Usually `{ type: 'object', properties, required }`.
   */
  readonly parameters?: unknown
}

/** One compact parameter line for the tool list. */
export interface McpParamSummary {
  readonly name: string
  readonly type: string
  readonly required: boolean
}

/**
 * Summarise a tool parameters schema into name/type/required rows.
 * @param parameters - JSON Schema-like object from tools.schemas().
 */
export function summariseParameters(parameters: unknown): McpParamSummary[] {
  if (!isObject(parameters)) return []
  const properties = isObject(parameters.properties) ? parameters.properties : undefined
  if (properties === undefined) return []
  const required = new Set(
    Array.isArray(parameters.required)
      ? parameters.required.filter((item): item is string => typeof item === 'string')
      : [],
  )
  const rows: McpParamSummary[] = []
  for (const [name, schema] of Object.entries(properties)) {
    rows.push({
      name,
      type: parameterTypeLabel(schema),
      required: required.has(name),
    })
  }
  return rows
}

/**
 * Compact type label for one JSON Schema node.
 * @param schema - property schema.
 */
function parameterTypeLabel(schema: unknown): string {
  if (!isObject(schema)) return 'any'
  if (typeof schema.type === 'string') {
    if (schema.type === 'array') {
      const items = isObject(schema.items) ? parameterTypeLabel(schema.items) : 'any'
      return `${items}[]`
    }
    return schema.type
  }
  if (Array.isArray(schema.type)) {
    return schema.type.map((item) => String(item)).join('|')
  }
  if (Array.isArray(schema.enum)) return 'enum'
  if (schema.anyOf !== undefined || schema.oneOf !== undefined) return 'union'
  return 'object'
}

/**
 * One-line parameter summary: `path: string · session?: string`.
 * @param parameters - JSON Schema-like object.
 */
export function formatParameterSummary(parameters: unknown): string {
  const rows = summariseParameters(parameters)
  if (rows.length === 0) return ''
  return rows
    .map((row) => `${row.name}${row.required ? '' : '?'}: ${row.type}`)
    .join(' · ')
}

/** One MCP server as the browser list/detail screens render it. */
export interface McpServerView {
  /** Patch row id, e.g. `mcp-session-map-github`. */
  readonly id: string
  /** Tool namespace / serverName. */
  readonly name: string
  /** UI transport. */
  readonly transport: McpTransport
  /** Whether the row is enabled (not `disabled: true`). */
  readonly enabled: boolean
  /** Status dot. */
  readonly state: McpServerState
  /** Optional status hint under the name. */
  readonly message: string
  /** Registered tool count for this namespace, or 0. */
  readonly tools: number
  /** Whether the loader currently holds a live entry. */
  readonly live: boolean
  /** Whether the UI should offer the OAuth login button. */
  readonly oauth: boolean
  /** stdio command. */
  readonly command: string
  /** stdio args. */
  readonly args: readonly string[]
  /** stdio env (secrets may be masked by the Host). */
  readonly env: Readonly<Record<string, string>>
  /** stdio working directory. */
  readonly cwd: string
  /** HTTP endpoint. */
  readonly url: string
  /** HTTP headers (Authorization may be masked). */
  readonly headers: Readonly<Record<string, string>>
  /** tools/call timeout. */
  readonly timeoutMs: number
  /** Whether reconnect is enabled in config (default true). */
  readonly reconnectEnabled: boolean
  /** Optional tool list when the Host expanded detail. */
  readonly toolList?: readonly McpToolSummary[]
}

/** Assembled list payload for the MCP tab. */
export interface McpManagerState {
  /** Absolute path of the profile patch file. */
  readonly patchFile: string
  /** Profile directory display label. */
  readonly profileDir: string
  /** ISO timestamp of this assembly. */
  readonly updatedAt: string
  /** Servers in display order (name ascending). */
  readonly servers: readonly McpServerView[]
}

/** Create / update payload from the form. */
export interface McpServerInput {
  /** Optional existing row id; omit to create. */
  readonly id?: string
  /** serverName. */
  readonly name: string
  /** Transport. */
  readonly transport: McpTransport
  /** Enabled flag. */
  readonly enabled: boolean
  /** stdio command. */
  readonly command?: string
  /** stdio args. */
  readonly args?: readonly string[]
  /** stdio env. */
  readonly env?: Readonly<Record<string, string>>
  /** stdio cwd. */
  readonly cwd?: string
  /** HTTP url. */
  readonly url?: string
  /** HTTP headers. */
  readonly headers?: Readonly<Record<string, string>>
  /** Optional timeout override. */
  readonly timeoutMs?: number
  /** Optional reconnect flag; default true. */
  readonly reconnectEnabled?: boolean
}

/** Toggle request. */
export interface McpToggleRequest {
  readonly name: string
  readonly enabled: boolean
}

/** Remove / diagnose / oauth-start request keyed by serverName. */
export interface McpNameRequest {
  readonly name: string
}

/** Import request: a Claude/Codex mcpServers object, an array, or patch rows. */
export interface McpImportRequest {
  readonly text: string
}

/** Diagnose response. */
export interface McpDiagnoseResult {
  readonly name: string
  readonly text: string
}

/** OAuth start response. */
export interface McpOAuthStartResult {
  readonly flowId: string
  readonly authorizationUrl: string
}

/** OAuth poll response. */
export interface McpOAuthPollResult {
  readonly status: 'pending' | 'done' | 'error'
  readonly message?: string
}

/** Export response. */
export interface McpExportResult {
  readonly text: string
  readonly format: 'mcpServers'
}

/** Failure codes the Host may return. */
export type McpFailureCode =
  | 'not-trusted'
  | 'bad-request'
  | 'not-found'
  | 'conflict'
  | 'patch-error'
  | 'loader-error'
  | 'oauth-error'
  | 'diagnose-error'
  | 'internal'

/** Success / failure envelope. */
export type McpEnvelope<
  T extends Record<string, unknown> = Record<string, never>,
> =
  | ({ readonly ok: true } & T)
  | {
      readonly ok: false
      readonly error: { readonly code: McpFailureCode; readonly message: string }
    }

export type McpStateEnvelope = McpEnvelope<{ readonly state: McpManagerState }>
export type McpServerEnvelope = McpEnvelope<{ readonly server: McpServerView }>
export type McpDiagnoseEnvelope = McpEnvelope<{ readonly result: McpDiagnoseResult }>
export type McpExportEnvelope = McpEnvelope<{ readonly result: McpExportResult }>
export type McpOAuthStartEnvelope = McpEnvelope<{ readonly result: McpOAuthStartResult }>
export type McpOAuthPollEnvelope = McpEnvelope<{ readonly result: McpOAuthPollResult }>
export type McpOkEnvelope = McpEnvelope

/** Raw patch row shape (before UI mapping). */
export interface McpPatchRow {
  readonly id: string
  readonly name: typeof MCP_CLIENT_PACKAGE
  readonly disabled?: boolean
  readonly config: McpPatchConfig
}

/** Config object inside one patch row. */
export interface McpPatchConfig {
  readonly serverName: string
  readonly transport: 'stdio' | 'streamable-http'
  readonly command?: string
  readonly args?: readonly string[]
  readonly env?: Readonly<Record<string, string>>
  readonly cwd?: string
  readonly url?: string
  readonly headers?: Readonly<Record<string, string>>
  readonly toolCallTimeoutMs?: number
  readonly reconnect?: { readonly enabled?: boolean }
}

/**
 * Whether an unknown value is a plain object record.
 * @param value - candidate.
 */
export function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/**
 * Read one non-empty trimmed string, or undefined.
 * @param value - candidate.
 */
export function nonEmptyString(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined
  const trimmed = value.trim()
  return trimmed === '' ? undefined : trimmed
}

/**
 * Keep only string→string entries from a map-like value.
 * @param value - candidate.
 */
export function stringMap(value: unknown): Record<string, string> {
  if (!isObject(value)) return {}
  const out: Record<string, string> = {}
  for (const [key, item] of Object.entries(value)) {
    if (typeof item !== 'string') continue
    const name = key.trim()
    if (name === '') continue
    out[name] = item
  }
  return out
}

/**
 * Validate and normalize a create/update form payload.
 * @param input - raw form value.
 * @returns a clean input, or throws Error with a Chinese message.
 */
export function normalizeServerInput(input: unknown): McpServerInput {
  if (!isObject(input)) throw new Error('请求体无效')
  const name = nonEmptyString(input.name)
  if (name === undefined || !MCP_SERVER_NAME_RE.test(name)) {
    throw new Error('名称只能是 1–32 位字母、数字、下划线或连字符')
  }
  const transport: McpTransport = input.transport === 'http' ? 'http' : 'stdio'
  const enabled = input.enabled !== false
  const timeoutRaw = Number(input.timeoutMs)
  const timeoutMs = Number.isFinite(timeoutRaw) && timeoutRaw > 0
    ? Math.round(timeoutRaw)
    : undefined
  const reconnectEnabled = input.reconnectEnabled === false ? false : true
  const id = nonEmptyString(input.id)

  if (transport === 'http') {
    const url = nonEmptyString(input.url)
    if (url === undefined || !/^https?:\/\//i.test(url)) {
      throw new Error('请填写以 http(s):// 开头的地址')
    }
    return {
      ...(id !== undefined ? { id } : {}),
      name,
      transport,
      enabled,
      url,
      headers: stringMap(input.headers),
      ...(timeoutMs !== undefined ? { timeoutMs } : {}),
      reconnectEnabled,
    }
  }

  const command = nonEmptyString(input.command)
  if (command === undefined) throw new Error('请填写启动命令')
  const args = Array.isArray(input.args)
    ? input.args.map((item) => String(item)).filter((item) => item.length > 0)
    : []
  return {
    ...(id !== undefined ? { id } : {}),
    name,
    transport,
    enabled,
    command,
    args,
    env: stringMap(input.env),
    cwd: nonEmptyString(input.cwd) ?? '',
    ...(timeoutMs !== undefined ? { timeoutMs } : {}),
    reconnectEnabled,
  }
}

/**
 * Build a patch row from a normalized form input.
 * @param input - validated form.
 * @param previous - existing row when updating.
 */
export function buildPatchRow(
  input: McpServerInput,
  previous?: McpPatchRow,
): McpPatchRow {
  const previousConfig = previous?.config
  const config: Record<string, unknown> = previousConfig ? { ...previousConfig } : {}
  config.serverName = input.name

  if (input.transport === 'http') {
    config.transport = 'streamable-http'
    config.url = input.url
    const headers = input.headers ?? {}
    if (Object.keys(headers).length > 0) config.headers = headers
    else delete config.headers
    for (const key of ['command', 'args', 'env', 'cwd'] as const) delete config[key]
  } else {
    config.transport = 'stdio'
    config.command = input.command
    const args = input.args ?? []
    if (args.length > 0) config.args = args
    else delete config.args
    const env = input.env ?? {}
    if (Object.keys(env).length > 0) config.env = env
    else delete config.env
    const cwd = input.cwd?.trim() ?? ''
    if (cwd !== '') config.cwd = cwd
    else delete config.cwd
    delete config.url
    delete config.headers
  }

  if (
    input.timeoutMs !== undefined
    && input.timeoutMs > 0
    && input.timeoutMs !== MCP_DEFAULT_TIMEOUT_MS
  ) {
    config.toolCallTimeoutMs = input.timeoutMs
  } else {
    delete config.toolCallTimeoutMs
  }

  if (input.reconnectEnabled === false) {
    config.reconnect = { ...(isObject(config.reconnect) ? config.reconnect : {}), enabled: false }
  } else if (isObject(config.reconnect)) {
    const next = { ...config.reconnect }
    delete next.enabled
    if (Object.keys(next).length === 0) delete config.reconnect
    else config.reconnect = next
  }

  const row: McpPatchRow = {
    id: previous?.id ?? `${MCP_ROW_ID_PREFIX}${input.name}`,
    name: MCP_CLIENT_PACKAGE,
    config: config as unknown as McpPatchConfig,
  }
  if (input.enabled === false) {
    return { ...row, disabled: true }
  }
  return row
}

/**
 * Map one patch row to a UI view without live/probe fields filled in.
 * @param row - patch row.
 */
export function viewFromPatchRow(row: McpPatchRow): McpServerView {
  const config = row.config
  const http = config.transport === 'streamable-http'
  const reconnectEnabled = !(isObject(config.reconnect) && config.reconnect.enabled === false)
  return {
    id: row.id,
    name: String(config.serverName ?? ''),
    transport: http ? 'http' : 'stdio',
    enabled: row.disabled !== true,
    state: row.disabled === true ? 'off' : 'idle',
    message: '',
    tools: 0,
    live: false,
    oauth: false,
    command: http ? '' : String(config.command ?? ''),
    args: http ? [] : Array.isArray(config.args) ? config.args.map((item) => String(item)) : [],
    env: http ? {} : stringMap(config.env),
    cwd: http ? '' : String(config.cwd ?? ''),
    url: http ? String(config.url ?? '') : '',
    headers: http ? stringMap(config.headers) : {},
    timeoutMs: Number.isFinite(config.toolCallTimeoutMs)
      ? Number(config.toolCallTimeoutMs)
      : MCP_DEFAULT_TIMEOUT_MS,
    reconnectEnabled,
  }
}

/**
 * Mask secret-looking map values for display.
 * @param map - env or headers.
 */
export function maskSecretMap(
  map: Readonly<Record<string, string>>,
): Record<string, string> {
  const out: Record<string, string> = {}
  for (const [key, value] of Object.entries(map)) {
    out[key] = /authorization|token|key|secret|password|cookie/i.test(key)
      ? '••••••••'
      : value
  }
  return out
}

/**
 * Sort servers by name (case-insensitive).
 * @param servers - views.
 */
export function sortServers(servers: readonly McpServerView[]): McpServerView[] {
  return [...servers].sort((a, b) => a.name.localeCompare(b.name, 'en'))
}

/**
 * Unwrap a state envelope.
 * @param body - Host JSON.
 */
export function stateFromEnvelope(body: McpStateEnvelope): McpManagerState {
  if (!body.ok) throw new Error(body.error.message)
  return body.state
}

/**
 * Unwrap a diagnose envelope.
 * @param body - Host JSON.
 */
export function diagnoseFromEnvelope(body: McpDiagnoseEnvelope): McpDiagnoseResult {
  if (!body.ok) throw new Error(body.error.message)
  return body.result
}

/**
 * Unwrap an export envelope.
 * @param body - Host JSON.
 */
export function exportFromEnvelope(body: McpExportEnvelope): McpExportResult {
  if (!body.ok) throw new Error(body.error.message)
  return body.result
}

/**
 * Unwrap an OAuth start envelope.
 * @param body - Host JSON.
 */
export function oauthStartFromEnvelope(body: McpOAuthStartEnvelope): McpOAuthStartResult {
  if (!body.ok) throw new Error(body.error.message)
  return body.result
}

/**
 * Unwrap an OAuth poll envelope.
 * @param body - Host JSON.
 */
export function oauthPollFromEnvelope(body: McpOAuthPollEnvelope): McpOAuthPollResult {
  if (!body.ok) throw new Error(body.error.message)
  return body.result
}

/**
 * Unwrap a bare ok envelope.
 * @param body - Host JSON.
 */
export function checkOkEnvelope(body: McpOkEnvelope): void {
  if (!body.ok) throw new Error(body.error.message)
}

/**
 * Parse one Claude/Codex-style mcpServers JSON object into form inputs.
 * @param text - pasted JSON.
 */
export function parseImportText(text: string): McpServerInput[] {
  const trimmed = text.trim()
  if (trimmed === '') throw new Error('导入内容为空')
  let parsed: unknown
  try {
    parsed = JSON.parse(trimmed) as unknown
  } catch {
    throw new Error('导入内容不是合法 JSON')
  }

  if (isObject(parsed) && isObject(parsed.mcpServers)) {
    return Object.entries(parsed.mcpServers).map(([name, value]) =>
      importEntryToInput(name, value),
    )
  }
  if (Array.isArray(parsed)) {
    return parsed.map((item, index) => {
      if (!isObject(item)) throw new Error(`第 ${index + 1} 项不是对象`)
      const name = nonEmptyString(item.name) ?? nonEmptyString(item.serverName)
      if (name === undefined) throw new Error(`第 ${index + 1} 项缺少 name`)
      return importEntryToInput(name, item)
    })
  }
  if (isObject(parsed)) {
    // Bare map of name → config.
    return Object.entries(parsed).map(([name, value]) => importEntryToInput(name, value))
  }
  throw new Error('无法识别的导入格式')
}

/**
 * Convert one imported entry into a form input.
 * @param name - server name.
 * @param value - entry body.
 */
function importEntryToInput(name: string, value: unknown): McpServerInput {
  if (!isObject(value)) throw new Error(`服务器 ${name} 的配置无效`)
  const command = nonEmptyString(value.command)
  const url = nonEmptyString(value.url)
  if (url !== undefined || value.type === 'http' || value.transport === 'http' || value.transport === 'streamable-http') {
    return normalizeServerInput({
      name,
      transport: 'http',
      enabled: value.disabled !== true && value.enabled !== false,
      url: url ?? '',
      headers: value.headers,
      timeoutMs: value.timeoutMs ?? value.toolCallTimeoutMs,
    })
  }
  return normalizeServerInput({
    name,
    transport: 'stdio',
    enabled: value.disabled !== true && value.enabled !== false,
    command: command ?? '',
    args: value.args,
    env: value.env,
    cwd: value.cwd,
    timeoutMs: value.timeoutMs ?? value.toolCallTimeoutMs,
  })
}

/**
 * Build a Claude-compatible mcpServers export object text.
 * @param servers - current views.
 */
export function buildExportText(servers: readonly McpServerView[]): string {
  const mcpServers: Record<string, Record<string, unknown>> = {}
  for (const server of servers) {
    if (server.transport === 'http') {
      const entry: Record<string, unknown> = { url: server.url }
      if (Object.keys(server.headers).length > 0) entry.headers = { ...server.headers }
      if (!server.enabled) entry.disabled = true
      mcpServers[server.name] = entry
    } else {
      const entry: Record<string, unknown> = { command: server.command }
      if (server.args.length > 0) entry.args = [...server.args]
      if (Object.keys(server.env).length > 0) entry.env = { ...server.env }
      if (server.cwd !== '') entry.cwd = server.cwd
      if (!server.enabled) entry.disabled = true
      mcpServers[server.name] = entry
    }
  }
  return `${JSON.stringify({ mcpServers }, null, 2)}\n`
}
