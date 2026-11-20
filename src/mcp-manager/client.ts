/**
 * Browser half of the Conversation → MCP tab.
 *
 * Renders the approved design screens (list/detail master-detail, add/edit
 * form, auth banner, empty state, diagnose transcript, import/export) and
 * talks only to the Host's same-origin `/plugin-mcp-manager` routes. Wire
 * types and envelope parsers live in `./model`; this module owns fetch,
 * Chinese copy, AbortControllers, and the theme-token stylesheet.
 *
 * @module dsh-session-map/mcp-manager/client
 */
import type { Context } from '@deepseek-ai/cordis'
import * as React from 'react'
import { errorText } from '../session-map/format'
import {
  MCP_CLIENT_PACKAGE,
  MCP_DEFAULT_TIMEOUT_MS,
  MCP_MANAGER_ROUTE,
  MCP_ROW_ID_PREFIX,
  MCP_SERVER_NAME_RE,
  adoptFromEnvelope,
  checkOkEnvelope,
  diagnoseFromEnvelope,
  exportFromEnvelope,
  formatParameterSummary,
  normalizeServerInput,
  oauthPollFromEnvelope,
  oauthStartFromEnvelope,
  stateFromEnvelope,
  type McpAdoptEnvelope,
  type McpAdoptResult,
  type McpDiagnoseEnvelope,
  type McpDiagnoseResult,
  type McpExportEnvelope,
  type McpExportResult,
  type McpManagerState,
  type McpOAuthPollEnvelope,
  type McpOAuthPollResult,
  type McpOAuthStartEnvelope,
  type McpOAuthStartResult,
  type McpOkEnvelope,
  type McpServerInput,
  type McpServerState,
  type McpServerView,
  type McpStateEnvelope,
  type McpToolSummary,
  type McpTransport,
  type McpUnmanagedView,
  type ToolPermission,
} from './model'

/** Fixed UI copy; Chinese-first like the other Conversation seats. */
const COPY = {
  title: 'MCP',
  description: '管理当前 profile 的原生 dsh-mcp-client 服务器：增删改、启停、HTTP 鉴权；写入 cordis.patch.yml。',
  import: '导入',
  export: '导出',
  add: '添加服务器',
  searchPlaceholder: '搜索名称、命令或 URL',
  filterAll: '全部',
  filterOnline: '已连接',
  filterAuth: '需鉴权',
  filterOff: '已禁用',
  refresh: '刷新',
  refreshing: '读取中…',
  loading: '正在读取 MCP 服务器…',
  retry: '重试',
  updatedPrefix: '更新于 ',
  staleFailure: '本次刷新失败，下面仍是上一次读到的结果。',
  emptyTitle: '还没有 MCP 服务器',
  emptyBody: '添加一条 stdio 或 streamable-http 配置，或粘贴 Claude / Codex 的 mcpServers JSON。保存后会出现在对话标签栏「MCP」页。',
  emptyCtaAdd: '添加第一台服务器',
  emptyCtaImport: '从 JSON 导入',
  importJson: '导入 JSON',
  edit: '编辑',
  diagnose: '诊断',
  delete: '删除',
  reconnect: '重连',
  reconnecting: '连接中…',
  login: '登录',
  loggingIn: '登录中…',
  authTitle: '需要登录',
  authBody: '服务器返回 401。将走 OAuth 2.1（authorization code + PKCE），Token 写回 Authorization 头。',
  toolsTitle: '工具',
  toolsHintPrefix: '模型侧名称形如 mcp__',
  toolsHintSuffix: '__*',
  toolsUnavailableTitle: '工具列表不可用',
  toolsUnavailableBody: '完成登录并刷新后，这里会列出工具。',
  toolsDownBody: '服务暂时连不上。点「重连」再试一次，或打开「诊断」看完整日志。',
  toolsCountOnlyTitlePrefix: '已注册 ',
  toolsCountOnlyTitleSuffix: ' 个工具',
  toolsCountOnlyBody: '名称与描述还没加载到详情。请完全重启 DeepSeek Harness（不只是刷新网页）后再点「刷新」。',
  toolsSearchPlaceholder: '搜索工具名称或描述',
  toolsNoMatch: '没有匹配的工具',
  toolsParamsEmpty: '无参数',
  toolsParamsExpand: '展开 schema',
  toolsParamsCollapse: '收起 schema',
  toolsMatchPrefix: '显示 ',
  toolsMatchMid: ' / ',
  toolsMatchSuffix: ' 个',
  permTitle: '工具权限',
  permAllow: '放行',
  permAsk: '问我',
  permDeny: '禁止',
  permBulkAllow: '全部放行',
  permBulkAsk: '全部问我',
  permBulkDeny: '全部禁止',
  permDefaultDeny: '新工具默认禁止',
  permDefaultBody: '以后新增的工具自动藏起来，不会自己变成可用。',
  permDefaultPrefix: '默认 · ',
  permDefaultTitlePrefix: '新工具默认',
  permDefaultDenyBody: '以后新增的工具自动藏起来，不会自己变成可用。',
  permDefaultAllowBody: '以后新增的工具直接可用。要收紧就点「全部禁止」。',
  permDefaultAskBody: '以后新增的工具，每次调用都要你确认一次。',
  permUnnamedPrefix: '未点名 ',
  permCountsMid: ' · ',
  permAllowPrefix: '放行 ',
  permAskPrefix: '问我 ',
  permDenyPrefix: '禁止 ',
  fieldTransport: '传输',
  fieldCommand: '命令',
  fieldArgs: '参数',
  fieldEnv: '环境变量',
  fieldCwd: '工作目录',
  fieldUrl: 'URL',
  fieldHeaders: '请求头',
  fieldTimeout: '调用超时',
  fieldReconnect: '自动重连',
  reconnectOn: '开',
  reconnectOff: '关',
  namespacePrefix: 'mcp__',
  configIdPrefix: '配置 id：',
  nsPrefix: '工具命名空间 ',
  formAddTitle: '添加服务器',
  formEditTitle: '编辑服务器',
  formDesc: '写入当前 profile 的 cordis.patch.yml；serverName 在同一作用域内唯一。',
  cancel: '取消',
  save: '保存',
  saving: '保存中…',
  labelName: 'serverName',
  hintName: '仅 [A-Za-z0-9_-]，最长 32；工具名会变成 mcp__<name>__*',
  labelTransport: '传输',
  transportStdio: 'stdio',
  transportHttp: 'streamable-http',
  labelCommand: '命令',
  labelArgs: '参数（每行一个）',
  labelEnv: '环境变量（KEY=VALUE，每行一个）',
  hintEnv: '支持字面量或 $VAR；保存后密钥默认遮罩显示',
  labelCwd: '工作目录（可选）',
  labelUrl: 'URL',
  labelHeaders: '请求头（KEY=VALUE，每行一个）',
  advanced: '高级',
  labelTimeout: '调用超时 ms',
  labelReconnect: '自动重连',
  enabled: '启用',
  previewTitle: '将写入的片段',
  formNoteTitle: '注意',
  formNoteBody: '保存后热应用到 loader。HTTP 若返回 401，详情页会出现「登录」；Token 明文写入 patch，请勿分享该文件。',
  diagnoseTitle: '诊断',
  diagnoseDesc: '一次性探测：stdio 抓取约 6 秒 stdout/stderr；HTTP 跑 initialize + tools/list。',
  diagnoseBack: '← ',
  copyLog: '复制日志',
  rerun: '重新诊断',
  diagnosing: '诊断中…',
  diagnoseTarget: '目标',
  diagnoseNoteTitle: '说明',
  diagnoseNoteBody: '诊断是一次性探针，不会留下常驻连接。HTTP 若 401，transcript 会附带 OAuth 元数据；密钥在日志里始终遮罩。',
  importTitle: '导入 JSON',
  importDesc: '粘贴 Claude / Codex 的 mcpServers JSON，或服务器数组 / 名称映射。',
  importPlaceholder: '{\n  "mcpServers": {\n    "github": { "command": "npx", "args": ["-y", "@modelcontextprotocol/server-github"] }\n  }\n}',
  importRun: '导入',
  importing: '导入中…',
  exportTitle: '导出',
  exportCopied: '已复制到剪贴板',
  exportDownload: '下载 JSON',
  exportCopy: '复制',
  stateOnline: '已连接',
  stateAuth: '需鉴权',
  stateIdle: '启动中',
  stateDown: '不可用',
  stateOff: '已禁用',
  confirmDelete: '确定删除服务器「',
  confirmDeleteSuffix: '」吗？会从 cordis.patch.yml 移除。',
  confirmDiscard: '放弃未保存的修改？',
  noSelection: '点击左侧服务器查看详情。',
  noMatch: '没有匹配的服务器。',
  unauthorizedHint: '未设置 · 登录后写入 Bearer Token',
  unmanagedTitlePrefix: '检测到 ',
  unmanagedTitleSuffix: ' 台未纳管的服务器',
  unmanagedBody: '它们是 cordis.patch.yml 里管理块之外的手写行，本页看不到、也管不了。',
  adoptRun: '收编',
  adopting: '收编中…',
  adoptConfirmCrumb: '收编未纳管服务器',
  adoptConfirmTitlePrefix: '把 ',
  adoptConfirmTitleSuffix: ' 台服务器移入管理',
  adoptBody: '手写的行会从 cordis.patch.yml 的原位置删除，原文移入 dsh-session-map 管理块：配置一字不动（含 Authorization），行 ID 保持不变，loader 加载的还是同一批条目，服务不会断线。',
  adoptWriteLabel: '写入',
  adoptGo: '确认收编',
  adoptDonePrefix: '已收编 ',
  adoptDoneNamesMid: ' 台：',
  adoptDoneSuffix: ' 现在由本页管理',
  adoptSkippedMid: '；',
  adoptSkippedSuffix: '，已跳过',
  adoptNoneFound: '没有发现可收编的服务器',
} as const

/** List filter chips. */
type FilterKind = 'all' | 'online' | 'auth' | 'off'

/** Top-level view modes inside the tab. */
type ViewMode =
  | { readonly kind: 'list' }
  | { readonly kind: 'form'; readonly editing: McpServerView | null }
  | { readonly kind: 'diagnose'; readonly server: McpServerView }
  | { readonly kind: 'import' }
  | { readonly kind: 'export'; readonly text: string }

/** Everything the tab needs from its Host. */
export interface McpManagerRuntime {
  /** Read the assembled MCP manager state; `fresh` bypasses the probe cache. */
  loadState(signal: AbortSignal, fresh?: boolean): Promise<McpManagerState>
  /** Create or update one server. */
  saveServer(input: McpServerInput, signal: AbortSignal): Promise<void>
  /** Enable or disable one server by name. */
  toggleServer(name: string, enabled: boolean, signal: AbortSignal): Promise<void>
  /** Retry one server: re-probe and re-apply its loader entry. */
  reconnect(name: string, signal: AbortSignal): Promise<McpManagerState>
  /** Remove one server by name. */
  removeServer(name: string, signal: AbortSignal): Promise<void>
  /** Adopt out-of-block rows into the managed block. */
  adoptUnmanaged(
    names: readonly string[] | undefined,
    signal: AbortSignal,
  ): Promise<McpAdoptResult>
  /** Import Claude/Codex-style JSON text. */
  importText(text: string, signal: AbortSignal): Promise<void>
  /** Export current servers as mcpServers JSON. */
  exportText(signal: AbortSignal): Promise<McpExportResult>
  /** Run a one-shot diagnose probe. */
  diagnose(name: string, signal: AbortSignal): Promise<McpDiagnoseResult>
  /** Start an OAuth flow for an HTTP server. */
  oauthStart(name: string, signal: AbortSignal): Promise<McpOAuthStartResult>
  /** Poll an OAuth flow until done/error. */
  oauthPoll(flowId: string, signal: AbortSignal): Promise<McpOAuthPollResult>
  /** Answer one tool of one server. */
  setToolPermission(
    name: string,
    tool: string,
    permission: ToolPermission,
    signal: AbortSignal,
  ): Promise<McpManagerState>
  /** Answer every tool of one server at once. */
  setAllToolPermissions(
    name: string,
    permission: ToolPermission,
    signal: AbortSignal,
  ): Promise<McpManagerState>
}

/** One Host request description. */
interface HostRequest {
  readonly method: 'GET' | 'POST'
  readonly body?: unknown
}

/** Absolute same-origin URL, or the path under SSR/tests. */
function routeUrl(path: string): string {
  const base = typeof document === 'undefined' ? undefined : document.baseURI
  return base === undefined ? path : new URL(path, base).toString()
}

/** Whether an unknown thrown value is an abort. */
function isAbortError(error: unknown): boolean {
  return typeof error === 'object' && error !== null
    && (error as { readonly name?: unknown }).name === 'AbortError'
}

/** Whether the caller's signal cancelled the request. */
function aborted(signal: AbortSignal, error: unknown): boolean {
  return signal.aborted || isAbortError(error)
}

/** Untyped body to one envelope type after a shape guard. */
function envelopeOf<T>(body: unknown): T {
  if (typeof body !== 'object' || body === null) {
    throw new Error('Host 返回的 MCP 数据格式不正确')
  }
  return body as T
}

/** Fetch one Host route and decode its JSON body. */
async function requestHost(path: string, request: HostRequest, signal: AbortSignal): Promise<unknown> {
  try {
    const init: RequestInit = { method: request.method, cache: 'no-store', signal }
    if (request.method === 'POST') {
      init.headers = { 'Content-Type': 'application/json' }
      if (request.body !== undefined) init.body = JSON.stringify(request.body)
    }
    const response = await fetch(routeUrl(path), init)
    const text = await response.text()
    if (text === '') {
      throw new Error(`Host 没有返回 MCP 数据（HTTP ${response.status}）`)
    }
    try {
      return JSON.parse(text) as unknown
    } catch {
      throw new Error(`Host 返回了无法解析的响应（HTTP ${response.status}）`)
    }
  } catch (error) {
    if (aborted(signal, error)) throw error
    throw error instanceof Error ? error : new Error(String(error))
  }
}

/**
 * Build the tab runtime over the running page.
 * @param _ctx - browser root context (unused; same-origin HTTP only).
 */
export function createMcpManagerRuntime(_ctx: Context): McpManagerRuntime {
  return {
    async loadState(signal, fresh) {
      const query = fresh === true ? '?fresh=1' : ''
      const body = await requestHost(`${MCP_MANAGER_ROUTE}/state${query}`, { method: 'GET' }, signal)
      return stateFromEnvelope(envelopeOf<McpStateEnvelope>(body))
    },
    async saveServer(input, signal) {
      const body = await requestHost(
        `${MCP_MANAGER_ROUTE}/server`,
        { method: 'POST', body: input },
        signal,
      )
      checkOkEnvelope(envelopeOf<McpOkEnvelope>(body))
    },
    async toggleServer(name, enabled, signal) {
      const body = await requestHost(
        `${MCP_MANAGER_ROUTE}/toggle`,
        { method: 'POST', body: { name, enabled } },
        signal,
      )
      checkOkEnvelope(envelopeOf<McpOkEnvelope>(body))
    },
    async reconnect(name, signal) {
      const body = await requestHost(
        `${MCP_MANAGER_ROUTE}/reconnect`,
        { method: 'POST', body: { name } },
        signal,
      )
      return stateFromEnvelope(envelopeOf<McpStateEnvelope>(body))
    },
    async removeServer(name, signal) {
      const body = await requestHost(
        `${MCP_MANAGER_ROUTE}/remove`,
        { method: 'POST', body: { name } },
        signal,
      )
      checkOkEnvelope(envelopeOf<McpOkEnvelope>(body))
    },
    async adoptUnmanaged(names, signal) {
      const body = await requestHost(
        `${MCP_MANAGER_ROUTE}/adopt`,
        { method: 'POST', body: names === undefined ? {} : { names } },
        signal,
      )
      return adoptFromEnvelope(envelopeOf<McpAdoptEnvelope>(body))
    },
    async importText(text, signal) {
      const body = await requestHost(
        `${MCP_MANAGER_ROUTE}/import`,
        { method: 'POST', body: { text } },
        signal,
      )
      checkOkEnvelope(envelopeOf<McpOkEnvelope>(body))
    },
    async exportText(signal) {
      const body = await requestHost(`${MCP_MANAGER_ROUTE}/export`, { method: 'GET' }, signal)
      return exportFromEnvelope(envelopeOf<McpExportEnvelope>(body))
    },
    async diagnose(name, signal) {
      const body = await requestHost(
        `${MCP_MANAGER_ROUTE}/diagnose`,
        { method: 'POST', body: { name } },
        signal,
      )
      return diagnoseFromEnvelope(envelopeOf<McpDiagnoseEnvelope>(body))
    },
    async oauthStart(name, signal) {
      const body = await requestHost(
        `${MCP_MANAGER_ROUTE}/oauth/start`,
        { method: 'POST', body: { name } },
        signal,
      )
      return oauthStartFromEnvelope(envelopeOf<McpOAuthStartEnvelope>(body))
    },
    async oauthPoll(flowId, signal) {
      const query = new URLSearchParams({ flowId })
      const body = await requestHost(
        `${MCP_MANAGER_ROUTE}/oauth/poll?${query.toString()}`,
        { method: 'GET' },
        signal,
      )
      return oauthPollFromEnvelope(envelopeOf<McpOAuthPollEnvelope>(body))
    },
    async setToolPermission(name, tool, permission, signal) {
      const body = await requestHost(
        `${MCP_MANAGER_ROUTE}/tools`,
        { method: 'POST', body: { name, tool, permission } },
        signal,
      )
      return stateFromEnvelope(envelopeOf<McpStateEnvelope>(body))
    },
    async setAllToolPermissions(name, permission, signal) {
      const body = await requestHost(
        `${MCP_MANAGER_ROUTE}/tools`,
        { method: 'POST', body: { name, bulk: permission } },
        signal,
      )
      return stateFromEnvelope(envelopeOf<McpStateEnvelope>(body))
    },
  }
}

/** Format one ISO timestamp as local wall-clock time. */
function formatClock(iso: string | null): string | null {
  if (iso === null) return null
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return null
  return date.toLocaleTimeString('zh-CN', { hour12: false })
}

/** Human label for a connection state. */
function stateLabel(state: McpServerState): string {
  switch (state) {
    case 'online': return COPY.stateOnline
    case 'auth': return COPY.stateAuth
    case 'idle': return COPY.stateIdle
    case 'down': return COPY.stateDown
    case 'off': return COPY.stateOff
  }
}

/** One-line meta under a list row. */
function serverMeta(server: McpServerView): string {
  const endpoint = server.transport === 'http'
    ? server.url
    : [server.command, ...server.args].filter(Boolean).join(' ')
  const parts = [endpoint]
  if (server.state === 'online' && server.tools > 0) parts.push(`工具 ${server.tools}`)
  if (server.message !== '') parts.push(server.message)
  else parts.push(stateLabel(server.state))
  return parts.filter(Boolean).join(' · ')
}

/** Format KEY=VALUE map for display / form seed. */
function mapToLines(map: Readonly<Record<string, string>>): string {
  return Object.entries(map).map(([key, value]) => `${key}=${value}`).join('\n')
}

/** Parse KEY=VALUE lines into a string map. */
function linesToMap(text: string): Record<string, string> {
  const out: Record<string, string> = {}
  for (const raw of text.split('\n')) {
    const line = raw.trim()
    if (line === '') continue
    const eq = line.indexOf('=')
    if (eq <= 0) continue
    const key = line.slice(0, eq).trim()
    if (key === '') continue
    out[key] = line.slice(eq + 1)
  }
  return out
}

/** Seed a form draft from an existing server or empty defaults. */
function draftFromServer(server: McpServerView | null): FormDraft {
  if (server === null) {
    return {
      id: undefined,
      name: '',
      transport: 'stdio',
      enabled: true,
      command: '',
      argsText: '',
      envText: '',
      cwd: '',
      url: '',
      headersText: '',
      timeoutMs: String(MCP_DEFAULT_TIMEOUT_MS),
      reconnectEnabled: true,
    }
  }
  return {
    id: server.id,
    name: server.name,
    transport: server.transport,
    enabled: server.enabled,
    command: server.command,
    argsText: server.args.join('\n'),
    envText: mapToLines(server.env),
    cwd: server.cwd,
    url: server.url,
    headersText: mapToLines(server.headers),
    timeoutMs: String(server.timeoutMs),
    reconnectEnabled: server.reconnectEnabled,
  }
}

/** Controlled form draft. */
interface FormDraft {
  readonly id: string | undefined
  readonly name: string
  readonly transport: McpTransport
  readonly enabled: boolean
  readonly command: string
  readonly argsText: string
  readonly envText: string
  readonly cwd: string
  readonly url: string
  readonly headersText: string
  readonly timeoutMs: string
  readonly reconnectEnabled: boolean
}

/** Build a normalize-ready payload from the draft. */
function inputFromDraft(draft: FormDraft): McpServerInput {
  const timeoutRaw = Number(draft.timeoutMs)
  const timeoutMs = Number.isFinite(timeoutRaw) && timeoutRaw > 0 ? Math.round(timeoutRaw) : undefined
  if (draft.transport === 'http') {
    return normalizeServerInput({
      ...(draft.id !== undefined ? { id: draft.id } : {}),
      name: draft.name,
      transport: 'http',
      enabled: draft.enabled,
      url: draft.url,
      headers: linesToMap(draft.headersText),
      ...(timeoutMs !== undefined ? { timeoutMs } : {}),
      reconnectEnabled: draft.reconnectEnabled,
    })
  }
  return normalizeServerInput({
    ...(draft.id !== undefined ? { id: draft.id } : {}),
    name: draft.name,
    transport: 'stdio',
    enabled: draft.enabled,
    command: draft.command,
    args: draft.argsText.split('\n').map(line => line.trim()).filter(line => line.length > 0),
    env: linesToMap(draft.envText),
    cwd: draft.cwd,
    ...(timeoutMs !== undefined ? { timeoutMs } : {}),
    reconnectEnabled: draft.reconnectEnabled,
  })
}

/** YAML-ish preview fragment for the form side panel. */
function previewYaml(draft: FormDraft): string {
  const id = draft.id ?? `${MCP_ROW_ID_PREFIX}${draft.name || '…'}`
  const lines = [
    `- id: ${id}`,
    `  name: '${MCP_CLIENT_PACKAGE}'`,
  ]
  if (!draft.enabled) lines.push('  disabled: true')
  lines.push('  config:')
  lines.push(`    serverName: ${draft.name || '…'}`)
  if (draft.transport === 'http') {
    lines.push('    transport: streamable-http')
    lines.push(`    url: ${draft.url || '…'}`)
  } else {
    lines.push('    transport: stdio')
    lines.push(`    command: ${draft.command || '…'}`)
    const args = draft.argsText.split('\n').map(line => line.trim()).filter(Boolean)
    if (args.length > 0) {
      lines.push('    args:')
      for (const arg of args.slice(0, 4)) lines.push(`      - ${arg}`)
      if (args.length > 4) lines.push(`      # … +${args.length - 4}`)
    }
  }
  return lines.join('\n')
}

/** Whether a server matches the search box. */
function matchesSearch(server: McpServerView, query: string): boolean {
  if (query === '') return true
  const hay = [
    server.name,
    server.command,
    server.url,
    ...server.args,
    server.message,
  ].join(' ').toLowerCase()
  return hay.includes(query.toLowerCase())
}

/** Whether a server matches a filter chip. */
function matchesFilter(server: McpServerView, filter: FilterKind): boolean {
  switch (filter) {
    case 'all': return true
    case 'online': return server.state === 'online'
    case 'auth': return server.state === 'auth' || server.oauth
    case 'off': return !server.enabled || server.state === 'off'
  }
}

/** Count servers for one filter chip. */
function filterCount(servers: readonly McpServerView[], filter: FilterKind): number {
  return servers.filter(server => matchesFilter(server, filter)).length
}

/** Status dot element. */
function StatusDot(props: { readonly state: McpServerState; readonly large?: boolean }): React.ReactElement {
  return React.createElement('span', {
    className: props.large ? 'mcp-dot mcp-dot--lg' : 'mcp-dot',
    'data-state': props.state,
    'aria-hidden': true,
  })
}

/** Transport badge. */
function TransportBadge(props: { readonly transport: McpTransport }): React.ReactElement {
  const http = props.transport === 'http'
  return React.createElement(
    'span',
    { className: http ? 'mcp-badge mcp-badge--http' : 'mcp-badge mcp-badge--stdio' },
    http ? 'HTTP' : 'stdio',
  )
}

/** Enable toggle switch. */
function EnableSwitch(props: {
  readonly enabled: boolean
  readonly disabled?: boolean
  readonly onChange: (enabled: boolean) => void
}): React.ReactElement {
  return React.createElement('button', {
    type: 'button',
    className: 'mcp-switch',
    'data-on': props.enabled ? 'true' : 'false',
    'aria-pressed': props.enabled,
    'aria-label': COPY.enabled,
    disabled: props.disabled,
    onClick: (event: React.MouseEvent) => {
      event.stopPropagation()
      props.onChange(!props.enabled)
    },
  })
}

/** One field row in the detail card. */
function FieldRow(props: {
  readonly label: string
  readonly value: string
  readonly soft?: boolean
  readonly last?: boolean
}): React.ReactElement {
  return React.createElement(
    'div',
    {
      className: [
        'mcp-field',
        props.soft ? 'mcp-field--soft' : '',
        props.last ? 'mcp-field--last' : '',
      ].filter(Boolean).join(' '),
    },
    React.createElement('span', { className: 'mcp-fieldLabel' }, props.label),
    React.createElement('span', { className: 'mcp-fieldValue', title: props.value }, props.value),
  )
}

/** List row card. */
function ServerRow(props: {
  readonly server: McpServerView
  readonly active: boolean
  readonly busy: boolean
  readonly onSelect: () => void
  readonly onToggle: (enabled: boolean) => void
}): React.ReactElement {
  const { server, active, busy, onSelect, onToggle } = props
  return React.createElement(
    'button',
    {
      type: 'button',
      className: server.enabled ? 'mcp-row' : 'mcp-row mcp-row--off',
      'data-active': active ? 'true' : 'false',
      onClick: onSelect,
    },
    React.createElement(
      'div',
      { className: 'mcp-rowTop' },
      React.createElement(
        'div',
        { className: 'mcp-rowId' },
        React.createElement(StatusDot, { state: server.state }),
        React.createElement('span', { className: 'mcp-rowName' }, server.name),
        React.createElement(TransportBadge, { transport: server.transport }),
      ),
      React.createElement(EnableSwitch, {
        enabled: server.enabled,
        disabled: busy,
        onChange: onToggle,
      }),
    ),
    React.createElement('div', { className: 'mcp-rowMeta' }, serverMeta(server)),
  )
}

/**
 * Bottom reserve for the measured tool list, in px. The session composer and
 * the page's own bottom padding sit below the list; without this the last row
 * ends up flush against the edge or under the composer.
 */
const TOOL_LIST_BOTTOM_GAP = 56

/** Floor for the measured tool list, so it stays usable on a short window. */
const TOOL_LIST_MIN_HEIGHT = 160

/** Display order of the three answers, weakest permission last. */
const PERMISSIONS: readonly ToolPermission[] = ['allow', 'ask', 'deny']

/** Localized label for one permission. */
function permissionLabel(permission: ToolPermission): string {
  if (permission === 'allow') return COPY.permAllow
  if (permission === 'ask') return COPY.permAsk
  return COPY.permDeny
}

/**
 * Three-state control for one tool.
 *
 * Deliberately NOT a checkbox: the middle answer is a different kind of thing
 * (it runs, but only after a human says so), and a switch would hide that.
 */
function PermissionControl(props: {
  readonly value: ToolPermission
  readonly disabled: boolean
  readonly onChange: (next: ToolPermission) => void
}): React.ReactElement {
  return React.createElement(
    'div',
    { className: 'mcp-perm', role: 'group' },
    ...PERMISSIONS.map(permission => React.createElement(
      'button',
      {
        key: permission,
        type: 'button',
        className: 'mcp-permSeg',
        'data-permission': permission,
        'data-active': permission === props.value ? 'true' : 'false',
        disabled: props.disabled,
        onClick: () => {
          if (permission !== props.value) props.onChange(permission)
        },
      },
      permissionLabel(permission),
    )),
  )
}

/** Localized explanation of what a server's fallback does to future tools. */
function defaultBody(fallback: ToolPermission): string {
  if (fallback === 'deny') return COPY.permDefaultDenyBody
  if (fallback === 'ask') return COPY.permDefaultAskBody
  return COPY.permDefaultAllowBody
}

/** Detail pane for the selected server. */
function ServerDetail(props: {
  readonly server: McpServerView | null
  readonly oauthBusy: boolean
  readonly actionBusy: boolean
  readonly permBusy: boolean
  readonly onEdit: () => void
  readonly onDiagnose: () => void
  readonly onDelete: () => void
  readonly onLogin: () => void
  readonly onReconnect: () => void
  readonly onToolPermission: (tool: string, permission: ToolPermission) => void
  readonly onAllToolPermissions: (permission: ToolPermission) => void
}): React.ReactElement {
  const {
    server,
    oauthBusy,
    actionBusy,
    permBusy,
    onEdit,
    onDiagnose,
    onDelete,
    onLogin,
    onReconnect,
    onToolPermission,
    onAllToolPermissions,
  } = props
  const [toolQuery, setToolQuery] = React.useState('')
  const [expandedTools, setExpandedTools] = React.useState<ReadonlySet<string>>(() => new Set())
  /**
   * Measured cap for the tool list. The tab is document-flow, so no ancestor
   * hands this page a height a flex ratio could use; measuring where the list
   * starts is exact where a CSS constant would only guess.
   */
  const [listCap, setListCap] = React.useState<number | null>(null)
  const listRef = React.useRef<HTMLDivElement | null>(null)

  React.useEffect(() => {
    setToolQuery('')
    setExpandedTools(new Set())
  }, [server?.id])

  const fitToolList = React.useCallback((): void => {
    const element = listRef.current
    if (element === null || typeof window === 'undefined') return
    const top = element.getBoundingClientRect().top
    // Keep the last tool clear of whatever sits at the bottom of the window
    // (the session composer, the page's own padding): a list that ends flush
    // against the edge hides its final row.
    const available = Math.floor(window.innerHeight - top - TOOL_LIST_BOTTOM_GAP)
    setListCap(Math.max(TOOL_LIST_MIN_HEIGHT, available))
  }, [])

  React.useEffect(() => {
    fitToolList()
    if (typeof window === 'undefined') return undefined
    window.addEventListener('resize', fitToolList)
    return () => { window.removeEventListener('resize', fitToolList) }
  }, [fitToolList, server?.id, server?.state, server?.tools, toolQuery, expandedTools])

  if (server === null) {
    return React.createElement(
      'div',
      { className: 'mcp-detailEmpty' },
      COPY.noSelection,
    )
  }

  const needsAuth = server.state === 'auth' || server.oauth
  const toolList = server.toolList ?? []
  /** Absent until the gate manages this server; present once any answer was set. */
  const policy = server.policy
  const toolsKnownButUnlisted = toolList.length === 0 && server.tools > 0
  const query = toolQuery.trim().toLowerCase()
  const filteredTools = query === ''
    ? toolList
    : toolList.filter((tool) => {
        const haystack = `${tool.name}\n${tool.description}\n${formatParameterSummary(tool.parameters)}`.toLowerCase()
        return haystack.includes(query)
      })

  const fields: React.ReactElement[] = []
  fields.push(React.createElement(FieldRow, {
    key: 'transport',
    label: COPY.fieldTransport,
    value: server.transport === 'http' ? 'streamable-http' : 'stdio',
    soft: true,
  }))
  if (server.transport === 'http') {
    fields.push(React.createElement(FieldRow, {
      key: 'url',
      label: COPY.fieldUrl,
      value: server.url || '—',
    }))
    const authHeader = server.headers.Authorization ?? server.headers.authorization
    fields.push(React.createElement(FieldRow, {
      key: 'headers',
      label: 'Authorization',
      value: authHeader ?? COPY.unauthorizedHint,
      soft: true,
      last: true,
    }))
  } else {
    fields.push(React.createElement(FieldRow, {
      key: 'command',
      label: COPY.fieldCommand,
      value: [server.command, ...server.args].filter(Boolean).join(' ') || '—',
    }))
    const envEntries = Object.entries(server.env)
    fields.push(React.createElement(FieldRow, {
      key: 'env',
      label: COPY.fieldEnv,
      value: envEntries.length === 0
        ? '—'
        : envEntries.map(([key, value]) => `${key} = ${value}`).join(' · '),
      soft: true,
    }))
    if (server.cwd !== '') {
      fields.push(React.createElement(FieldRow, {
        key: 'cwd',
        label: COPY.fieldCwd,
        value: server.cwd,
      }))
    }
    fields.push(React.createElement(FieldRow, {
      key: 'timeout',
      label: COPY.fieldTimeout,
      value: `${server.timeoutMs.toLocaleString('en-US')} ms · 自动重连${server.reconnectEnabled ? COPY.reconnectOn : COPY.reconnectOff}`,
      last: true,
    }))
  }

  return React.createElement(
    'div',
    { className: 'mcp-detail' },
    needsAuth
      ? React.createElement(
        'div',
        { className: 'mcp-authBanner', role: 'status' },
        React.createElement(
          'div',
          { className: 'mcp-authText' },
          React.createElement('div', { className: 'mcp-authTitle' }, COPY.authTitle),
          React.createElement('div', { className: 'mcp-authBody' }, COPY.authBody),
        ),
        React.createElement(
          'button',
          {
            type: 'button',
            className: 'mcp-btn mcp-btn--auth',
            disabled: oauthBusy || actionBusy,
            onClick: onLogin,
          },
          oauthBusy ? COPY.loggingIn : COPY.login,
        ),
      )
      : null,
    React.createElement(
      'div',
      { className: 'mcp-detailHead' },
      React.createElement(
        'div',
        { className: 'mcp-detailTitle' },
        React.createElement(
          'div',
          { className: 'mcp-detailNameRow' },
          React.createElement(StatusDot, { state: server.state, large: true }),
          React.createElement('h2', { className: 'mcp-detailName' }, server.name),
          React.createElement(
            'span',
            { className: 'mcp-statusPill', 'data-state': server.state },
            stateLabel(server.state),
          ),
        ),
        React.createElement(
          'div',
          { className: 'mcp-detailSub' },
          `${COPY.namespacePrefix}${server.name}${COPY.toolsHintSuffix} · ${COPY.configIdPrefix}${server.id} · ${COPY.nsPrefix}${server.name}`,
        ),
      ),
      React.createElement(
        'div',
        { className: 'mcp-detailActions' },
        server.enabled && (server.state === 'down' || server.state === 'idle')
          ? React.createElement(
            'button',
            {
              type: 'button',
              className: 'mcp-btn mcp-btn--primary',
              disabled: actionBusy,
              onClick: onReconnect,
            },
            COPY.reconnect,
          )
          : null,
        React.createElement(
          'button',
          { type: 'button', className: 'mcp-btn', disabled: actionBusy, onClick: onEdit },
          COPY.edit,
        ),
        React.createElement(
          'button',
          { type: 'button', className: 'mcp-btn', disabled: actionBusy, onClick: onDiagnose },
          COPY.diagnose,
        ),
        React.createElement(
          'button',
          { type: 'button', className: 'mcp-btn mcp-btn--danger', disabled: actionBusy, onClick: onDelete },
          COPY.delete,
        ),
      ),
    ),
    React.createElement('div', { className: 'mcp-fields' }, ...fields),
    policy === undefined
      ? null
      : React.createElement(
        'div',
        { className: 'mcp-default' },
        React.createElement(
          'div',
          { className: 'mcp-defaultText' },
          React.createElement(
            'span',
            { className: 'mcp-defaultTitle' },
            `${COPY.permDefaultTitlePrefix}${permissionLabel(policy.fallback)}`,
          ),
          React.createElement('span', { className: 'mcp-defaultBody' }, defaultBody(policy.fallback)),
        ),
        React.createElement(
          'span',
          { className: 'mcp-defaultPill', 'data-fallback': policy.fallback },
          `${COPY.permDefaultPrefix}${permissionLabel(policy.fallback)}`,
        ),
      ),
    React.createElement(
      'div',
      { className: 'mcp-tools' },
      React.createElement(
        'div',
        { className: 'mcp-toolsHead' },
        React.createElement(
          'span',
          { className: 'mcp-toolsTitle' },
          `${policy === undefined ? COPY.toolsTitle : COPY.permTitle} ${toolList.length > 0 ? toolList.length : server.tools}`,
        ),
        policy === undefined
          ? React.createElement(
            'span',
            { className: 'mcp-toolsHint' },
            toolList.length > 0 && query !== ''
              ? `${COPY.toolsMatchPrefix}${filteredTools.length}${COPY.toolsMatchMid}${toolList.length}${COPY.toolsMatchSuffix}`
              : `${COPY.toolsHintPrefix}${server.name}${COPY.toolsHintSuffix}`,
          )
          : React.createElement(
            'div',
            { className: 'mcp-toolsBulk' },
            ...PERMISSIONS.map(permission => React.createElement(
              'button',
              {
                key: permission,
                type: 'button',
                className: `mcp-bulk mcp-bulk--${permission}`,
                disabled: actionBusy || permBusy,
                onClick: () => onAllToolPermissions(permission),
              },
              permission === 'allow'
                ? COPY.permBulkAllow
                : permission === 'ask' ? COPY.permBulkAsk : COPY.permBulkDeny,
            )),
          ),
      ),
      policy === undefined
        ? null
        : React.createElement(
          'span',
          { className: 'mcp-toolsHint' },
          `${COPY.permAllowPrefix}${policy.allow}${COPY.permCountsMid}${COPY.permAskPrefix}${policy.ask}`
          + `${COPY.permCountsMid}${COPY.permDenyPrefix}${policy.deny}`
          + `${COPY.permCountsMid}${COPY.permUnnamedPrefix}${policy.unnamed}`,
        ),
      toolList.length === 0
        ? React.createElement(
          'div',
          { className: 'mcp-toolsEmpty' },
          React.createElement(
            'div',
            { className: 'mcp-toolsEmptyTitle' },
            toolsKnownButUnlisted
              ? `${COPY.toolsCountOnlyTitlePrefix}${server.tools}${COPY.toolsCountOnlyTitleSuffix}`
              : COPY.toolsUnavailableTitle,
          ),
          React.createElement(
            'div',
            { className: 'mcp-toolsEmptyBody' },
            needsAuth
              ? `完成登录并刷新后，这里会列出 mcp__${server.name}__* 工具`
              : toolsKnownButUnlisted
                ? `${COPY.toolsCountOnlyBody}（mcp__${server.name}__*）`
                : server.state === 'down'
                  ? COPY.toolsDownBody
                  : COPY.toolsUnavailableBody,
          ),
        )
        : React.createElement(
          React.Fragment,
          null,
          React.createElement('input', {
            className: 'mcp-toolSearch',
            type: 'search',
            value: toolQuery,
            placeholder: COPY.toolsSearchPlaceholder,
            onChange: (event: React.ChangeEvent<HTMLInputElement>) => setToolQuery(event.target.value),
          }),
          filteredTools.length === 0
            ? React.createElement('div', { className: 'mcp-toolsNoMatch' }, COPY.toolsNoMatch)
            : React.createElement(
              'div',
              {
                className: 'mcp-toolList',
                ref: listRef,
                style: listCap === null ? undefined : { maxHeight: `${String(listCap)}px` },
              },
              ...filteredTools.map((tool: McpToolSummary, index) => {
                const paramSummary = formatParameterSummary(tool.parameters)
                const expanded = expandedTools.has(tool.name)
                const canExpand = tool.parameters !== undefined
                return React.createElement(
                  'div',
                  {
                    key: tool.name,
                    className: index % 2 === 1 ? 'mcp-tool mcp-tool--soft' : 'mcp-tool',
                  },
                  React.createElement(
                    'div',
                    { className: 'mcp-toolTop' },
                    React.createElement('div', { className: 'mcp-toolName' }, tool.name),
                    tool.permission === undefined
                      ? null
                      : React.createElement(PermissionControl, {
                        value: tool.permission,
                        disabled: actionBusy || permBusy,
                        onChange: (next: ToolPermission) => onToolPermission(tool.name, next),
                      }),
                  ),
                  tool.description === ''
                    ? null
                    : React.createElement('div', { className: 'mcp-toolDesc' }, tool.description),
                  React.createElement(
                    'div',
                    { className: 'mcp-toolParams' },
                    React.createElement(
                      'span',
                      { className: 'mcp-toolParamsSummary' },
                      paramSummary === '' ? COPY.toolsParamsEmpty : paramSummary,
                    ),
                    canExpand
                      ? React.createElement(
                        'button',
                        {
                          type: 'button',
                          className: 'mcp-toolParamsToggle',
                          onClick: () => {
                            setExpandedTools((current) => {
                              const next = new Set(current)
                              if (next.has(tool.name)) next.delete(tool.name)
                              else next.add(tool.name)
                              return next
                            })
                          },
                        },
                        expanded ? COPY.toolsParamsCollapse : COPY.toolsParamsExpand,
                      )
                      : null,
                  ),
                  expanded && canExpand
                    ? React.createElement(
                      'pre',
                      { className: 'mcp-toolSchema' },
                      JSON.stringify(tool.parameters, null, 2),
                    )
                    : null,
                )
              }),
            ),
        ),
    ),
  )
}

/** Add / edit form page. */
function FormPage(props: {
  readonly draft: FormDraft
  readonly onChange: (next: FormDraft) => void
  readonly editing: boolean
  readonly saving: boolean
  readonly failure: string | null
  readonly onCancel: () => void
  readonly onSave: () => void
}): React.ReactElement {
  const { draft, onChange, editing, saving, failure, onCancel, onSave } = props
  const set = <K extends keyof FormDraft>(key: K, value: FormDraft[K]): void => {
    onChange({ ...draft, [key]: value })
  }
  const http = draft.transport === 'http'
  return React.createElement(
    'div',
    { className: 'mcp-page mcp-page--form' },
    React.createElement('style', null, MCP_MANAGER_CSS),
    React.createElement(
      'div',
      { className: 'mcp-formHead' },
      React.createElement(
        'div',
        { className: 'mcp-head' },
        React.createElement('h1', { className: 'mcp-title' }, editing ? COPY.formEditTitle : COPY.formAddTitle),
        React.createElement('p', { className: 'mcp-desc' }, COPY.formDesc),
      ),
      React.createElement(
        'div',
        { className: 'mcp-toolbar' },
        React.createElement(
          'button',
          { type: 'button', className: 'mcp-btn', onClick: onCancel, disabled: saving },
          COPY.cancel,
        ),
        React.createElement(
          'button',
          {
            type: 'button',
            className: 'mcp-btn mcp-btn--primary',
            onClick: onSave,
            disabled: saving || !MCP_SERVER_NAME_RE.test(draft.name.trim()),
          },
          saving ? COPY.saving : COPY.save,
        ),
      ),
    ),
    failure === null
      ? null
      : React.createElement(
        'div',
        { className: 'mcp-status mcp-status--error', role: 'alert' },
        React.createElement('div', { className: 'mcp-statusTitle' }, failure),
      ),
    React.createElement(
      'div',
      { className: 'mcp-formBody' },
      React.createElement(
        'div',
        { className: 'mcp-formCard' },
        React.createElement(
          'label',
          { className: 'mcp-label' },
          COPY.labelName,
          React.createElement('input', {
            className: 'mcp-input',
            value: draft.name,
            spellCheck: false,
            disabled: editing,
            onChange: (event: React.ChangeEvent<HTMLInputElement>) => {
              set('name', event.currentTarget.value)
            },
          }),
          React.createElement('span', { className: 'mcp-hint' }, COPY.hintName),
        ),
        React.createElement(
          'div',
          { className: 'mcp-label' },
          COPY.labelTransport,
          React.createElement(
            'div',
            { className: 'mcp-seg' },
            React.createElement(
              'button',
              {
                type: 'button',
                className: 'mcp-segBtn',
                'data-active': !http ? 'true' : 'false',
                onClick: () => { set('transport', 'stdio') },
              },
              COPY.transportStdio,
            ),
            React.createElement(
              'button',
              {
                type: 'button',
                className: 'mcp-segBtn',
                'data-active': http ? 'true' : 'false',
                onClick: () => { set('transport', 'http') },
              },
              COPY.transportHttp,
            ),
          ),
        ),
        http
          ? React.createElement(
            React.Fragment,
            null,
            React.createElement(
              'label',
              { className: 'mcp-label' },
              COPY.labelUrl,
              React.createElement('input', {
                className: 'mcp-input',
                value: draft.url,
                spellCheck: false,
                placeholder: 'https://…',
                onChange: (event: React.ChangeEvent<HTMLInputElement>) => {
                  set('url', event.currentTarget.value)
                },
              }),
            ),
            React.createElement(
              'label',
              { className: 'mcp-label' },
              COPY.labelHeaders,
              React.createElement('textarea', {
                className: 'mcp-textarea',
                value: draft.headersText,
                spellCheck: false,
                rows: 4,
                onChange: (event: React.ChangeEvent<HTMLTextAreaElement>) => {
                  set('headersText', event.currentTarget.value)
                },
              }),
            ),
          )
          : React.createElement(
            React.Fragment,
            null,
            React.createElement(
              'label',
              { className: 'mcp-label' },
              COPY.labelCommand,
              React.createElement('input', {
                className: 'mcp-input',
                value: draft.command,
                spellCheck: false,
                onChange: (event: React.ChangeEvent<HTMLInputElement>) => {
                  set('command', event.currentTarget.value)
                },
              }),
            ),
            React.createElement(
              'label',
              { className: 'mcp-label' },
              COPY.labelArgs,
              React.createElement('textarea', {
                className: 'mcp-textarea',
                value: draft.argsText,
                spellCheck: false,
                rows: 4,
                onChange: (event: React.ChangeEvent<HTMLTextAreaElement>) => {
                  set('argsText', event.currentTarget.value)
                },
              }),
            ),
            React.createElement(
              'label',
              { className: 'mcp-label' },
              COPY.labelEnv,
              React.createElement('textarea', {
                className: 'mcp-textarea',
                value: draft.envText,
                spellCheck: false,
                rows: 3,
                onChange: (event: React.ChangeEvent<HTMLTextAreaElement>) => {
                  set('envText', event.currentTarget.value)
                },
              }),
              React.createElement('span', { className: 'mcp-hint' }, COPY.hintEnv),
            ),
            React.createElement(
              'label',
              { className: 'mcp-label' },
              COPY.labelCwd,
              React.createElement('input', {
                className: 'mcp-input',
                value: draft.cwd,
                spellCheck: false,
                onChange: (event: React.ChangeEvent<HTMLInputElement>) => {
                  set('cwd', event.currentTarget.value)
                },
              }),
            ),
          ),
        React.createElement(
          'div',
          { className: 'mcp-advanced' },
          React.createElement('div', { className: 'mcp-advancedTitle' }, COPY.advanced),
          React.createElement(
            'div',
            { className: 'mcp-advancedRow' },
            React.createElement(
              'label',
              { className: 'mcp-label' },
              COPY.labelTimeout,
              React.createElement('input', {
                className: 'mcp-input',
                value: draft.timeoutMs,
                inputMode: 'numeric',
                onChange: (event: React.ChangeEvent<HTMLInputElement>) => {
                  set('timeoutMs', event.currentTarget.value)
                },
              }),
            ),
            React.createElement(
              'div',
              { className: 'mcp-label' },
              COPY.labelReconnect,
              React.createElement(
                'div',
                { className: 'mcp-reconnectRow' },
                React.createElement(
                  'span',
                  null,
                  draft.reconnectEnabled ? '开启' : '关闭',
                ),
                React.createElement(EnableSwitch, {
                  enabled: draft.reconnectEnabled,
                  onChange: (enabled) => { set('reconnectEnabled', enabled) },
                }),
              ),
            ),
          ),
          React.createElement(
            'label',
            { className: 'mcp-check' },
            React.createElement('input', {
              type: 'checkbox',
              checked: draft.enabled,
              onChange: (event: React.ChangeEvent<HTMLInputElement>) => {
                set('enabled', event.currentTarget.checked)
              },
            }),
            COPY.enabled,
          ),
        ),
      ),
      React.createElement(
        'aside',
        { className: 'mcp-formSide' },
        React.createElement(
          'div',
          { className: 'mcp-previewCard' },
          React.createElement('div', { className: 'mcp-previewTitle' }, COPY.previewTitle),
          React.createElement('pre', { className: 'mcp-previewCode' }, previewYaml(draft)),
        ),
        React.createElement(
          'div',
          { className: 'mcp-noteCard' },
          React.createElement('div', { className: 'mcp-noteTitle' }, COPY.formNoteTitle),
          React.createElement('div', { className: 'mcp-noteBody' }, COPY.formNoteBody),
        ),
      ),
    ),
  )
}

/** Diagnose transcript page. */
function DiagnosePage(props: {
  readonly server: McpServerView
  readonly text: string
  readonly loading: boolean
  readonly failure: string | null
  readonly onBack: () => void
  readonly onRerun: () => void
  readonly onCopy: () => void
}): React.ReactElement {
  const { server, text, loading, failure, onBack, onRerun, onCopy } = props
  return React.createElement(
    'div',
    { className: 'mcp-page mcp-page--diag' },
    React.createElement('style', null, MCP_MANAGER_CSS),
    React.createElement(
      'div',
      { className: 'mcp-formHead' },
      React.createElement(
        'div',
        { className: 'mcp-head' },
        React.createElement(
          'div',
          { className: 'mcp-crumb' },
          React.createElement(
            'button',
            { type: 'button', className: 'mcp-back', onClick: onBack },
            COPY.diagnoseBack + server.name,
          ),
          React.createElement('span', { className: 'mcp-crumbSep' }, '/'),
          React.createElement('h1', { className: 'mcp-title' }, COPY.diagnoseTitle),
        ),
        React.createElement('p', { className: 'mcp-desc' }, COPY.diagnoseDesc),
      ),
      React.createElement(
        'div',
        { className: 'mcp-toolbar' },
        React.createElement(
          'button',
          { type: 'button', className: 'mcp-btn', onClick: onCopy, disabled: text === '' },
          COPY.copyLog,
        ),
        React.createElement(
          'button',
          {
            type: 'button',
            className: 'mcp-btn mcp-btn--primary',
            onClick: onRerun,
            disabled: loading,
          },
          loading ? COPY.diagnosing : COPY.rerun,
        ),
      ),
    ),
    failure === null
      ? null
      : React.createElement(
        'div',
        { className: 'mcp-status mcp-status--error', role: 'alert' },
        React.createElement('div', { className: 'mcp-statusTitle' }, failure),
      ),
    React.createElement(
      'div',
      { className: 'mcp-diagBody' },
      React.createElement(
        'div',
        { className: 'mcp-diagMain' },
        React.createElement(
          'div',
          { className: 'mcp-log' },
          React.createElement(
            'div',
            { className: 'mcp-logHead' },
            React.createElement(
              'span',
              null,
              `transcript · ${server.transport === 'http' ? 'HTTP' : 'stdio'}`,
            ),
            React.createElement(
              'span',
              null,
              loading ? COPY.diagnosing : (text === '' ? '—' : `${text.split('\n').length} 行`),
            ),
          ),
          React.createElement(
            'pre',
            { className: 'mcp-logBody' },
            loading && text === '' ? COPY.diagnosing : (text === '' ? '（无输出）' : text),
          ),
        ),
      ),
      React.createElement(
        'aside',
        { className: 'mcp-diagSide' },
        React.createElement(
          'div',
          { className: 'mcp-noteCard' },
          React.createElement('div', { className: 'mcp-noteTitle' }, COPY.diagnoseTarget),
          React.createElement(FieldRow, { label: 'serverName', value: server.name, soft: true }),
          React.createElement(FieldRow, {
            label: COPY.fieldTransport,
            value: server.transport === 'http' ? 'streamable-http' : 'stdio',
          }),
          React.createElement(FieldRow, {
            label: server.transport === 'http' ? COPY.fieldUrl : COPY.fieldCommand,
            value: server.transport === 'http'
              ? server.url
              : [server.command, ...server.args].filter(Boolean).join(' '),
            last: true,
          }),
        ),
        React.createElement(
          'div',
          { className: 'mcp-noteCard' },
          React.createElement('div', { className: 'mcp-noteTitle' }, COPY.diagnoseNoteTitle),
          React.createElement('div', { className: 'mcp-noteBody' }, COPY.diagnoseNoteBody),
        ),
      ),
    ),
  )
}

/** Import paste page. */
function ImportPage(props: {
  readonly text: string
  readonly onChange: (text: string) => void
  readonly busy: boolean
  readonly failure: string | null
  readonly onCancel: () => void
  readonly onImport: () => void
}): React.ReactElement {
  return React.createElement(
    'div',
    { className: 'mcp-page mcp-page--form' },
    React.createElement('style', null, MCP_MANAGER_CSS),
    React.createElement(
      'div',
      { className: 'mcp-formHead' },
      React.createElement(
        'div',
        { className: 'mcp-head' },
        React.createElement('h1', { className: 'mcp-title' }, COPY.importTitle),
        React.createElement('p', { className: 'mcp-desc' }, COPY.importDesc),
      ),
      React.createElement(
        'div',
        { className: 'mcp-toolbar' },
        React.createElement(
          'button',
          { type: 'button', className: 'mcp-btn', onClick: props.onCancel, disabled: props.busy },
          COPY.cancel,
        ),
        React.createElement(
          'button',
          {
            type: 'button',
            className: 'mcp-btn mcp-btn--primary',
            onClick: props.onImport,
            disabled: props.busy || props.text.trim() === '',
          },
          props.busy ? COPY.importing : COPY.importRun,
        ),
      ),
    ),
    props.failure === null
      ? null
      : React.createElement(
        'div',
        { className: 'mcp-status mcp-status--error', role: 'alert' },
        React.createElement('div', { className: 'mcp-statusTitle' }, props.failure),
      ),
    React.createElement('textarea', {
      className: 'mcp-textarea mcp-textarea--import',
      value: props.text,
      spellCheck: false,
      placeholder: COPY.importPlaceholder,
      onChange: (event: React.ChangeEvent<HTMLTextAreaElement>) => {
        props.onChange(event.currentTarget.value)
      },
    }),
  )
}

/** Export preview page. */
function ExportPage(props: {
  readonly text: string
  readonly onBack: () => void
  readonly onCopy: () => void
  readonly onDownload: () => void
}): React.ReactElement {
  return React.createElement(
    'div',
    { className: 'mcp-page mcp-page--form' },
    React.createElement('style', null, MCP_MANAGER_CSS),
    React.createElement(
      'div',
      { className: 'mcp-formHead' },
      React.createElement(
        'div',
        { className: 'mcp-head' },
        React.createElement('h1', { className: 'mcp-title' }, COPY.exportTitle),
        React.createElement('p', { className: 'mcp-desc' }, 'Claude / Codex 兼容的 mcpServers JSON。'),
      ),
      React.createElement(
        'div',
        { className: 'mcp-toolbar' },
        React.createElement(
          'button',
          { type: 'button', className: 'mcp-btn', onClick: props.onBack },
          COPY.cancel,
        ),
        React.createElement(
          'button',
          { type: 'button', className: 'mcp-btn', onClick: props.onCopy },
          COPY.exportCopy,
        ),
        React.createElement(
          'button',
          { type: 'button', className: 'mcp-btn mcp-btn--primary', onClick: props.onDownload },
          COPY.exportDownload,
        ),
      ),
    ),
    React.createElement('pre', { className: 'mcp-logBody mcp-exportBody' }, props.text),
  )
}

/** Empty state when the profile has no servers. */
function EmptyState(props: {
  readonly onAdd: () => void
  readonly onImport: () => void
}): React.ReactElement {
  return React.createElement(
    'div',
    { className: 'mcp-empty' },
    React.createElement(
      'div',
      { className: 'mcp-emptyCard' },
      React.createElement('div', { className: 'mcp-emptyIcon' }, 'MCP'),
      React.createElement('div', { className: 'mcp-emptyTitle' }, COPY.emptyTitle),
      React.createElement('div', { className: 'mcp-emptyBody' }, COPY.emptyBody),
      React.createElement(
        'div',
        { className: 'mcp-emptyActions' },
        React.createElement(
          'button',
          { type: 'button', className: 'mcp-btn mcp-btn--primary', onClick: props.onAdd },
          COPY.emptyCtaAdd,
        ),
        React.createElement(
          'button',
          { type: 'button', className: 'mcp-btn', onClick: props.onImport },
          COPY.emptyCtaImport,
        ),
      ),
    ),
  )
}

/**
 * Unmanaged-rows banner: the dashed discovery card, and the solid confirm
 * card that replaces it in place after「收编 N 台」.
 */
function UnmanagedBanner(props: {
  readonly unmanaged: readonly McpUnmanagedView[]
  readonly busy: boolean
  readonly patchFile: string
  readonly onAdopt: () => void
}): React.ReactElement {
  const { unmanaged, busy, patchFile, onAdopt } = props
  const [confirming, setConfirming] = React.useState(false)
  const adoptable = unmanaged.filter((row) => row.conflict === undefined)

  if (confirming && adoptable.length > 0) {
    return React.createElement(
      'div',
      { className: 'mcp-adpt' },
      React.createElement('div', { className: 'mcp-adptCrumb' }, COPY.adoptConfirmCrumb),
      React.createElement(
        'div',
        { className: 'mcp-adptTitle' },
        `${COPY.adoptConfirmTitlePrefix}${adoptable.length}${COPY.adoptConfirmTitleSuffix}`,
      ),
      React.createElement('div', { className: 'mcp-adptBody' }, COPY.adoptBody),
      ...adoptable.map((row) => React.createElement(
        'div',
        { key: `${row.id}|${row.name}`, className: 'mcp-adptEntry' },
        React.createElement(
          'div',
          { className: 'mcp-adptEntryTop' },
          React.createElement('span', { className: 'mcp-adptEntryName' }, row.name),
          React.createElement(TransportBadge, { transport: row.transport }),
          React.createElement('span', { className: 'mcp-adptEntryId', title: row.id }, row.id),
        ),
        React.createElement(
          'div',
          { className: 'mcp-adptEndpoint' },
          row.endpoint === '' ? '(未配置地址)' : row.endpoint,
        ),
      )),
      React.createElement(
        'div',
        { className: 'mcp-adptPath' },
        React.createElement('span', null, COPY.adoptWriteLabel),
        React.createElement('span', { className: 'mcp-adptPathFile' }, patchFile),
      ),
      React.createElement(
        'div',
        { className: 'mcp-adptActions' },
        React.createElement(
          'button',
          {
            type: 'button',
            className: 'mcp-btn',
            disabled: busy,
            onClick: () => { setConfirming(false) },
          },
          COPY.cancel,
        ),
        React.createElement(
          'button',
          {
            type: 'button',
            className: 'mcp-btn mcp-btn--primary',
            disabled: busy,
            onClick: onAdopt,
          },
          busy ? COPY.adopting : COPY.adoptGo,
        ),
      ),
    )
  }

  return React.createElement(
    'div',
    { className: 'mcp-unmanaged' },
    React.createElement(
      'div',
      { className: 'mcp-unHead' },
      React.createElement(
        'div',
        { className: 'mcp-unHeadText' },
        React.createElement(
          'div',
          { className: 'mcp-unTitle' },
          `${COPY.unmanagedTitlePrefix}${unmanaged.length}${COPY.unmanagedTitleSuffix}`,
        ),
        React.createElement('div', { className: 'mcp-unBody' }, COPY.unmanagedBody),
      ),
      React.createElement('span', { className: 'mcp-unCount' }, String(unmanaged.length)),
    ),
    ...unmanaged.map((row) => React.createElement(
      'div',
      { key: `${row.id}|${row.name}`, className: 'mcp-unRow' },
      React.createElement(
        'div',
        { className: 'mcp-unRowTop' },
        React.createElement('span', { className: 'mcp-dot', 'aria-hidden': true }),
        React.createElement('span', { className: 'mcp-unName' }, row.name),
        React.createElement(TransportBadge, { transport: row.transport }),
        React.createElement('span', { className: 'mcp-unId', title: row.id }, row.id),
      ),
      row.conflict === undefined
        ? null
        : React.createElement('div', { className: 'mcp-unConflict' }, row.conflict),
    )),
    adoptable.length === 0
      ? null
      : React.createElement(
        'div',
        { className: 'mcp-unActions' },
        React.createElement(
          'button',
          {
            type: 'button',
            className: 'mcp-btn mcp-btn--primary',
            disabled: busy,
            onClick: () => { setConfirming(true) },
          },
          `${COPY.adoptRun} ${adoptable.length} 台`,
        ),
      ),
  )
}

/** Master-detail list page. */
function ListPage(props: {
  readonly state: McpManagerState
  readonly selectedName: string | null
  readonly search: string
  readonly filter: FilterKind
  readonly refreshing: boolean
  readonly updatedAt: string | null
  readonly staleFailure: string | null
  readonly actionFailure: string | null
  readonly actionBusy: boolean
  readonly oauthBusy: boolean
  readonly adoptNotice: string | null
  readonly onSearch: (value: string) => void
  readonly onFilter: (filter: FilterKind) => void
  readonly onRefresh: () => void
  readonly onSelect: (name: string) => void
  readonly onToggle: (server: McpServerView, enabled: boolean) => void
  readonly onAdopt: () => void
  readonly onAdd: () => void
  readonly onImport: () => void
  readonly onExport: () => void
  readonly onEdit: () => void
  readonly onDiagnose: () => void
  readonly onDelete: () => void
  readonly onLogin: () => void
  readonly onReconnect: (server: McpServerView) => void
  readonly permBusy: boolean
  readonly onToolPermission: (server: McpServerView, tool: string, permission: ToolPermission) => void
  readonly onAllToolPermission: (server: McpServerView, permission: ToolPermission) => void
}): React.ReactElement {
  const {
    state,
    selectedName,
    search,
    filter,
    refreshing,
    updatedAt,
    staleFailure,
    actionFailure,
    actionBusy,
    oauthBusy,
    adoptNotice,
    onSearch,
    onFilter,
    onRefresh,
    onSelect,
    onToggle,
    onAdopt,
    onAdd,
    onImport,
    onExport,
    onEdit,
    onDiagnose,
    onDelete,
    onLogin,
    onReconnect,
    permBusy,
    onToolPermission,
    onAllToolPermission,
  } = props

  const filtered = state.servers.filter(
    server => matchesFilter(server, filter) && matchesSearch(server, search),
  )
  const selected = filtered.find(server => server.name === selectedName)
    ?? state.servers.find(server => server.name === selectedName)
    ?? null
  const updated = formatClock(updatedAt ?? state.updatedAt)
  const showEmpty = state.servers.length === 0 && search === '' && filter === 'all'

  const chips: Array<{ readonly id: FilterKind; readonly label: string }> = [
    { id: 'all', label: COPY.filterAll },
    { id: 'online', label: COPY.filterOnline },
    { id: 'auth', label: COPY.filterAuth },
    { id: 'off', label: COPY.filterOff },
  ]

  return React.createElement(
    'div',
    { className: 'mcp-page' },
    React.createElement('style', null, MCP_MANAGER_CSS),
    React.createElement(
      'div',
      { className: 'mcp-shell' },
      React.createElement(
        'div',
        { className: 'mcp-header' },
        React.createElement(
          'div',
          { className: 'mcp-head' },
          React.createElement('h1', { className: 'mcp-title' }, COPY.title),
          React.createElement('p', { className: 'mcp-desc' }, COPY.description),
        ),
      ),
      staleFailure === null
        ? null
        : React.createElement(
          'div',
          { className: 'mcp-status mcp-status--warn', role: 'status' },
          React.createElement('div', { className: 'mcp-statusTitle' }, COPY.staleFailure),
          React.createElement('div', { className: 'mcp-statusPath' }, staleFailure),
        ),
      state.unmanaged.length === 0
        ? null
        : React.createElement(UnmanagedBanner, {
          unmanaged: state.unmanaged,
          busy: actionBusy,
          patchFile: state.patchFile,
          onAdopt,
        }),
      actionFailure === null
        ? null
        : React.createElement(
          'div',
          { className: 'mcp-status mcp-status--error', role: 'alert' },
          React.createElement('div', { className: 'mcp-statusTitle' }, actionFailure),
        ),
      showEmpty
        ? React.createElement(EmptyState, { onAdd, onImport })
        : React.createElement(
          'div',
          { className: 'mcp-split' },
          React.createElement(
            'div',
            { className: 'mcp-master' },
            React.createElement(
              'div',
              { className: 'mcp-masterTools' },
              React.createElement(
                'div',
                { className: 'mcp-toolbar' },
                React.createElement(
                  'button',
                  {
                    type: 'button',
                    className: 'mcp-btn mcp-btn--primary',
                    onClick: onAdd,
                    disabled: actionBusy,
                  },
                  COPY.add,
                ),
                React.createElement(
                  'button',
                  { type: 'button', className: 'mcp-btn', onClick: onImport, disabled: actionBusy },
                  COPY.import,
                ),
                React.createElement(
                  'button',
                  { type: 'button', className: 'mcp-btn', onClick: onExport, disabled: actionBusy },
                  COPY.export,
                ),
                updated === null
                  ? null
                  : React.createElement(
                    'span',
                    { className: 'mcp-updated' },
                    COPY.updatedPrefix + updated,
                  ),
              ),
              React.createElement(
                'div',
                { className: 'mcp-toolbarRow' },
                React.createElement('input', {
                  className: 'mcp-search',
                  value: search,
                  placeholder: COPY.searchPlaceholder,
                  onChange: (event: React.ChangeEvent<HTMLInputElement>) => {
                    onSearch(event.currentTarget.value)
                  },
                }),
                React.createElement(
                  'button',
                  {
                    type: 'button',
                    className: 'mcp-btn',
                    onClick: onRefresh,
                    disabled: refreshing,
                  },
                  refreshing ? COPY.refreshing : COPY.refresh,
                ),
              ),
              React.createElement(
                'div',
                { className: 'mcp-chips' },
                ...chips.map(chip => React.createElement(
                  'button',
                  {
                    key: chip.id,
                    type: 'button',
                    className: 'mcp-chip',
                    'data-active': filter === chip.id ? 'true' : 'false',
                    onClick: () => { onFilter(chip.id) },
                  },
                  `${chip.label} ${filterCount(state.servers, chip.id)}`,
                )),
              ),
            ),
            adoptNotice === null
              ? null
              : React.createElement(
                'div',
                { className: 'mcp-stripOk', role: 'status' },
                React.createElement('span', {
                  className: 'mcp-dot',
                  'data-state': 'online',
                  'aria-hidden': true,
                }),
                adoptNotice,
              ),
            filtered.length === 0
              ? React.createElement('div', { className: 'mcp-noMatch' }, COPY.noMatch)
              : filtered.map(server => React.createElement(ServerRow, {
                key: server.id,
                server,
                active: selected?.name === server.name,
                busy: actionBusy,
                onSelect: () => { onSelect(server.name) },
                onToggle: (enabled) => { onToggle(server, enabled) },
              })),
          ),
          React.createElement(
            'aside',
            { className: 'mcp-detailPane' },
            React.createElement(ServerDetail, {
              server: selected,
              oauthBusy,
              actionBusy,
              permBusy,
              onEdit,
              onDiagnose,
              onDelete,
              onLogin,
              onReconnect: () => {
                if (selected !== null) onReconnect(selected)
              },
              onToolPermission: (tool: string, permission: ToolPermission) => {
                if (selected !== null) onToolPermission(selected, tool, permission)
              },
              onAllToolPermissions: (permission: ToolPermission) => {
                if (selected !== null) onAllToolPermission(selected, permission)
              },
            }),
          ),
        ),
    ),
  )
}

/**
 * Build the Conversation tab body.
 *
 * Controllers: list refresh, mutate/diagnose, and OAuth poll each own an
 * AbortController. Unmount aborts all three.
 * @param runtime - Host capabilities.
 */
export function createMcpManagerTab(
  runtime: McpManagerRuntime,
): (props: { readonly sessionId: string }) => React.ReactElement {
  function McpManagerTab(_props: { readonly sessionId: string }): React.ReactElement {
    const [state, setState] = React.useState<McpManagerState | null>(null)
    const [failure, setFailure] = React.useState<string | null>(null)
    const [staleFailure, setStaleFailure] = React.useState<string | null>(null)
    const [actionFailure, setActionFailure] = React.useState<string | null>(null)
    const [refreshing, setRefreshing] = React.useState(false)
    const [updatedAt, setUpdatedAt] = React.useState<string | null>(null)
    const [selectedName, setSelectedName] = React.useState<string | null>(null)
    const [search, setSearch] = React.useState('')
    const [filter, setFilter] = React.useState<FilterKind>('all')
    const [view, setView] = React.useState<ViewMode>({ kind: 'list' })
    const [draft, setDraft] = React.useState<FormDraft>(draftFromServer(null))
    const [draftDirty, setDraftDirty] = React.useState(false)
    const [importText, setImportText] = React.useState('')
    const [diagText, setDiagText] = React.useState('')
    const [diagLoading, setDiagLoading] = React.useState(false)
    const [diagFailure, setDiagFailure] = React.useState<string | null>(null)
    const [formFailure, setFormFailure] = React.useState<string | null>(null)
    const [saving, setSaving] = React.useState(false)
    const [actionBusy, setActionBusy] = React.useState(false)
    const [oauthBusy, setOauthBusy] = React.useState(false)
    const [permBusy, setPermBusy] = React.useState(false)
    const [adoptNotice, setAdoptNotice] = React.useState<string | null>(null)

    const listInFlight = React.useRef<AbortController | null>(null)
    const actionInFlight = React.useRef<AbortController | null>(null)
    const oauthInFlight = React.useRef<AbortController | null>(null)
    const permInFlight = React.useRef<AbortController | null>(null)
    const hasData = React.useRef(false)

    const readState = React.useCallback(async (
      quiet: boolean,
      fresh = false,
    ): Promise<McpManagerState | null> => {
      listInFlight.current?.abort()
      const controller = new AbortController()
      listInFlight.current = controller
      setRefreshing(!quiet)
      try {
        const next = await runtime.loadState(controller.signal, fresh)
        if (controller.signal.aborted) return null
        hasData.current = true
        setState(next)
        setFailure(null)
        setStaleFailure(null)
        setUpdatedAt(next.updatedAt || new Date().toISOString())
        setSelectedName((current) => {
          if (current !== null && next.servers.some(server => server.name === current)) return current
          return next.servers[0]?.name ?? null
        })
        return next
      } catch (error) {
        if (controller.signal.aborted || isAbortError(error)) return null
        const message = `MCP 读取失败：${errorText(error)}`
        if (hasData.current) setStaleFailure(message)
        else setFailure(message)
        return null
      } finally {
        if (listInFlight.current === controller) {
          listInFlight.current = null
          if (!quiet) setRefreshing(false)
        }
      }
    }, [runtime])

    React.useEffect(() => {
      hasData.current = false
      setState(null)
      setFailure(null)
      setStaleFailure(null)
      setActionFailure(null)
      setAdoptNotice(null)
      setUpdatedAt(null)
      setView({ kind: 'list' })
      void readState(false)
      return () => {
        listInFlight.current?.abort()
        actionInFlight.current?.abort()
        oauthInFlight.current?.abort()
        permInFlight.current?.abort()
      }
    }, [readState])

    /**
     * Write one answer, or one server's whole set, and adopt the state the
     * Host returns: the write and the gate's new view come back together, so a
     * permission can never render without being enforced.
     */
    function submitPermission(
      server: McpServerView,
      tool: string | null,
      permission: ToolPermission,
    ): void {
      const controller = new AbortController()
      permInFlight.current?.abort()
      permInFlight.current = controller
      setPermBusy(true)
      setActionFailure(null)
      void (async (): Promise<void> => {
        try {
          const next = tool === null
            ? await runtime.setAllToolPermissions(server.name, permission, controller.signal)
            : await runtime.setToolPermission(server.name, tool, permission, controller.signal)
          if (controller.signal.aborted) return
          setState(next)
          setUpdatedAt(next.updatedAt || new Date().toISOString())
        } catch (error) {
          if (controller.signal.aborted || isAbortError(error)) return
          setActionFailure(errorText(error))
        } finally {
          if (permInFlight.current === controller) {
            permInFlight.current = null
            setPermBusy(false)
          }
        }
      })()
    }

    function setToolPermission(
      server: McpServerView,
      tool: string,
      permission: ToolPermission,
    ): void {
      submitPermission(server, tool, permission)
    }

    function setAllToolPermissions(server: McpServerView, permission: ToolPermission): void {
      if (permission === 'deny' && typeof window !== 'undefined') {
        const count = server.toolList?.length ?? server.tools
        if (!window.confirm(`${COPY.permBulkDeny} ${String(count)} 个工具？此操作会覆盖这些工具现在的设置。`)) return
      }
      submitPermission(server, null, permission)
    }

    function openForm(editing: McpServerView | null): void {
      setDraft(draftFromServer(editing))
      setDraftDirty(false)
      setFormFailure(null)
      setView({ kind: 'form', editing })
    }

    function changeDraft(next: FormDraft): void {
      setDraft(next)
      setDraftDirty(true)
    }

    function leaveForm(): void {
      if (draftDirty && typeof window !== 'undefined' && !window.confirm(COPY.confirmDiscard)) return
      setView({ kind: 'list' })
      setFormFailure(null)
      setDraftDirty(false)
    }

    function saveForm(): void {
      if (saving) return
      let input: McpServerInput
      try {
        input = inputFromDraft(draft)
      } catch (error) {
        setFormFailure(errorText(error))
        return
      }
      const controller = new AbortController()
      actionInFlight.current?.abort()
      actionInFlight.current = controller
      setSaving(true)
      setFormFailure(null)
      void (async (): Promise<void> => {
        try {
          await runtime.saveServer(input, controller.signal)
          if (controller.signal.aborted) return
          setDraftDirty(false)
          setView({ kind: 'list' })
          setSelectedName(input.name)
          await readState(true)
        } catch (error) {
          if (controller.signal.aborted || isAbortError(error)) return
          setFormFailure(errorText(error))
        } finally {
          if (actionInFlight.current === controller) {
            actionInFlight.current = null
            setSaving(false)
          }
        }
      })()
    }

    function toggle(server: McpServerView, enabled: boolean): void {
      const controller = new AbortController()
      actionInFlight.current?.abort()
      actionInFlight.current = controller
      setActionBusy(true)
      setActionFailure(null)
      void (async (): Promise<void> => {
        try {
          await runtime.toggleServer(server.name, enabled, controller.signal)
          if (controller.signal.aborted) return
          await readState(true)
        } catch (error) {
          if (controller.signal.aborted || isAbortError(error)) return
          setActionFailure(errorText(error))
        } finally {
          if (actionInFlight.current === controller) {
            actionInFlight.current = null
            setActionBusy(false)
          }
        }
      })()
    }

    function removeSelected(): void {
      const server = state?.servers.find(item => item.name === selectedName)
      if (server === undefined || actionBusy) return
      if (
        typeof window !== 'undefined'
        && !window.confirm(`${COPY.confirmDelete}${server.name}${COPY.confirmDeleteSuffix}`)
      ) return
      const controller = new AbortController()
      actionInFlight.current?.abort()
      actionInFlight.current = controller
      setActionBusy(true)
      setActionFailure(null)
      void (async (): Promise<void> => {
        try {
          await runtime.removeServer(server.name, controller.signal)
          if (controller.signal.aborted) return
          setSelectedName(null)
          await readState(true)
        } catch (error) {
          if (controller.signal.aborted || isAbortError(error)) return
          setActionFailure(errorText(error))
        } finally {
          if (actionInFlight.current === controller) {
            actionInFlight.current = null
            setActionBusy(false)
          }
        }
      })()
    }

    function reconnect(server: McpServerView): void {
      if (actionBusy) return
      const controller = new AbortController()
      actionInFlight.current?.abort()
      actionInFlight.current = controller
      setActionBusy(true)
      setActionFailure(null)
      void (async (): Promise<void> => {
        try {
          const next = await runtime.reconnect(server.name, controller.signal)
          if (controller.signal.aborted) return
          hasData.current = true
          setState(next)
          setFailure(null)
          setStaleFailure(null)
          setUpdatedAt(next.updatedAt || new Date().toISOString())
        } catch (error) {
          if (controller.signal.aborted || isAbortError(error)) return
          setActionFailure(errorText(error))
        } finally {
          if (actionInFlight.current === controller) {
            actionInFlight.current = null
            setActionBusy(false)
          }
        }
      })()
    }

    function adopt(): void {
      if (actionBusy) return
      const controller = new AbortController()
      actionInFlight.current?.abort()
      actionInFlight.current = controller
      setActionBusy(true)
      setActionFailure(null)
      void (async (): Promise<void> => {
        try {
          const result = await runtime.adoptUnmanaged(undefined, controller.signal)
          if (controller.signal.aborted) return
          const adoptedText = result.adopted.length > 0
            ? `${COPY.adoptDonePrefix}${result.adopted.length}${COPY.adoptDoneNamesMid}${result.adopted.join('、')}${COPY.adoptDoneSuffix}`
            : ''
          const skippedText = result.skipped.length > 0
            ? `${result.adopted.length > 0 ? COPY.adoptSkippedMid : ''}${result.skipped.map((item) => `${item.name} ${item.reason}`).join('、')}${COPY.adoptSkippedSuffix}`
            : ''
          setAdoptNotice(
            adoptedText === '' && skippedText === ''
              ? COPY.adoptNoneFound
              : `${adoptedText}${skippedText}`,
          )
          await readState(true)
        } catch (error) {
          if (controller.signal.aborted || isAbortError(error)) return
          setActionFailure(errorText(error))
        } finally {
          if (actionInFlight.current === controller) {
            actionInFlight.current = null
            setActionBusy(false)
          }
        }
      })()
    }

    function runDiagnose(server: McpServerView): void {
      setView({ kind: 'diagnose', server })
      setDiagText('')
      setDiagFailure(null)
      const controller = new AbortController()
      actionInFlight.current?.abort()
      actionInFlight.current = controller
      setDiagLoading(true)
      void (async (): Promise<void> => {
        try {
          const result = await runtime.diagnose(server.name, controller.signal)
          if (controller.signal.aborted) return
          setDiagText(result.text)
        } catch (error) {
          if (controller.signal.aborted || isAbortError(error)) return
          setDiagFailure(errorText(error))
        } finally {
          if (actionInFlight.current === controller) {
            actionInFlight.current = null
            setDiagLoading(false)
          }
        }
      })()
    }

    function startLogin(): void {
      const server = state?.servers.find(item => item.name === selectedName)
      if (server === undefined || oauthBusy) return
      const controller = new AbortController()
      oauthInFlight.current?.abort()
      oauthInFlight.current = controller
      setOauthBusy(true)
      setActionFailure(null)
      void (async (): Promise<void> => {
        try {
          const start = await runtime.oauthStart(server.name, controller.signal)
          if (controller.signal.aborted) return
          if (typeof window !== 'undefined') {
            window.open(start.authorizationUrl, '_blank', 'noopener,noreferrer')
          }
          for (;;) {
            if (controller.signal.aborted) return
            await new Promise<void>((resolve) => {
              const timer = setTimeout(resolve, 1500)
              controller.signal.addEventListener('abort', () => {
                clearTimeout(timer)
                resolve()
              }, { once: true })
            })
            if (controller.signal.aborted) return
            const poll = await runtime.oauthPoll(start.flowId, controller.signal)
            if (controller.signal.aborted) return
            if (poll.status === 'pending') continue
            if (poll.status === 'error') {
              setActionFailure(poll.message ?? 'OAuth 失败')
              break
            }
            await readState(true)
            break
          }
        } catch (error) {
          if (controller.signal.aborted || isAbortError(error)) return
          setActionFailure(errorText(error))
        } finally {
          if (oauthInFlight.current === controller) {
            oauthInFlight.current = null
            setOauthBusy(false)
          }
        }
      })()
    }

    function runImport(): void {
      if (saving) return
      const controller = new AbortController()
      actionInFlight.current?.abort()
      actionInFlight.current = controller
      setSaving(true)
      setFormFailure(null)
      void (async (): Promise<void> => {
        try {
          await runtime.importText(importText, controller.signal)
          if (controller.signal.aborted) return
          setImportText('')
          setView({ kind: 'list' })
          await readState(true)
        } catch (error) {
          if (controller.signal.aborted || isAbortError(error)) return
          setFormFailure(errorText(error))
        } finally {
          if (actionInFlight.current === controller) {
            actionInFlight.current = null
            setSaving(false)
          }
        }
      })()
    }

    function runExport(): void {
      const controller = new AbortController()
      actionInFlight.current?.abort()
      actionInFlight.current = controller
      setActionBusy(true)
      setActionFailure(null)
      void (async (): Promise<void> => {
        try {
          const result = await runtime.exportText(controller.signal)
          if (controller.signal.aborted) return
          setView({ kind: 'export', text: result.text })
        } catch (error) {
          if (controller.signal.aborted || isAbortError(error)) return
          setActionFailure(errorText(error))
        } finally {
          if (actionInFlight.current === controller) {
            actionInFlight.current = null
            setActionBusy(false)
          }
        }
      })()
    }

    async function copyText(text: string): Promise<void> {
      try {
        if (typeof navigator !== 'undefined' && navigator.clipboard?.writeText) {
          await navigator.clipboard.writeText(text)
        }
      } catch {
        // Clipboard can be denied; silent — the text is still on screen.
      }
    }

    function downloadText(text: string): void {
      if (typeof document === 'undefined') return
      const blob = new Blob([text], { type: 'application/json;charset=utf-8' })
      const url = URL.createObjectURL(blob)
      const anchor = document.createElement('a')
      anchor.href = url
      anchor.download = 'mcpServers.json'
      anchor.click()
      URL.revokeObjectURL(url)
    }

    if (state === null) {
      return React.createElement(
        'div',
        { className: 'mcp-page' },
        React.createElement('style', null, MCP_MANAGER_CSS),
        React.createElement(
          'div',
          { className: 'mcp-shell' },
          React.createElement(
            'div',
            { className: 'mcp-header' },
            React.createElement(
              'div',
              { className: 'mcp-head' },
              React.createElement('h1', { className: 'mcp-title' }, COPY.title),
              React.createElement('p', { className: 'mcp-desc' }, COPY.description),
            ),
          ),
          failure === null
            ? React.createElement('div', { className: 'mcp-loading', role: 'status' }, COPY.loading)
            : React.createElement(
              'div',
              { className: 'mcp-status mcp-status--error', role: 'alert' },
              React.createElement('div', { className: 'mcp-statusTitle' }, failure),
              React.createElement(
                'div',
                { className: 'mcp-statusActions' },
                React.createElement(
                  'button',
                  {
                    type: 'button',
                    className: 'mcp-btn',
                    onClick: () => { void readState(false) },
                  },
                  COPY.retry,
                ),
              ),
            ),
        ),
      )
    }

    if (view.kind === 'form') {
      return React.createElement(FormPage, {
        draft,
        onChange: changeDraft,
        editing: view.editing !== null,
        saving,
        failure: formFailure,
        onCancel: leaveForm,
        onSave: saveForm,
      })
    }

    if (view.kind === 'diagnose') {
      return React.createElement(DiagnosePage, {
        server: view.server,
        text: diagText,
        loading: diagLoading,
        failure: diagFailure,
        onBack: () => { setView({ kind: 'list' }) },
        onRerun: () => { runDiagnose(view.server) },
        onCopy: () => { void copyText(diagText) },
      })
    }

    if (view.kind === 'import') {
      return React.createElement(ImportPage, {
        text: importText,
        onChange: setImportText,
        busy: saving,
        failure: formFailure,
        onCancel: () => {
          setView({ kind: 'list' })
          setFormFailure(null)
        },
        onImport: runImport,
      })
    }

    if (view.kind === 'export') {
      return React.createElement(ExportPage, {
        text: view.text,
        onBack: () => { setView({ kind: 'list' }) },
        onCopy: () => { void copyText(view.text) },
        onDownload: () => { downloadText(view.text) },
      })
    }

    const selected = state.servers.find(server => server.name === selectedName) ?? null

    return React.createElement(ListPage, {
      state,
      selectedName,
      search,
      filter,
      refreshing,
      updatedAt,
      staleFailure,
      actionFailure,
      actionBusy,
      oauthBusy,
      permBusy,
      adoptNotice,
      onSearch: setSearch,
      onFilter: setFilter,
      onRefresh: () => {
        setAdoptNotice(null)
        // A manual refresh re-probes: it must not answer "still down" from the
        // 45s probe cache, which is what made the old button look inert.
        void readState(false, true)
      },
      onSelect: setSelectedName,
      onToggle: toggle,
      onAdopt: adopt,
      onReconnect: reconnect,
      onToolPermission: setToolPermission,
      onAllToolPermission: setAllToolPermissions,
      onAdd: () => { openForm(null) },
      onImport: () => {
        setImportText('')
        setFormFailure(null)
        setView({ kind: 'import' })
      },
      onExport: runExport,
      onEdit: () => {
        if (selected !== null) openForm(selected)
      },
      onDiagnose: () => {
        if (selected !== null) runDiagnose(selected)
      },
      onDelete: removeSelected,
      onLogin: startLogin,
    })
  }

  return McpManagerTab
}

/**
 * Component-local stylesheet; every color is a Harness theme token.
 *
 * Visual rules match session-map / agent-instructions: 0.5px hairlines for
 * internal dividers, 1px card outlines, brand color only for selection.
 */
export const MCP_MANAGER_CSS = `
.mcp-page { box-sizing: border-box; height: 100%; color: var(--dsw-alias-label-primary); font-size: 13px; line-height: 1.55; font-family: inherit; }
.mcp-page * { box-sizing: border-box; }
.mcp-shell { display: flex; flex-direction: column; gap: 12px; height: 100%; min-height: 0; padding: 0 0 16px; }
.mcp-header { display: flex; flex-direction: column; gap: 12px; padding: 18px 24px 14px; border-bottom: 0.5px solid var(--dsw-alias-border-l2); background: var(--dsw-alias-bg-layer-1); }
.mcp-head { display: flex; flex-direction: column; gap: 4px; min-width: 0; }
.mcp-title { margin: 0; font-size: 16px; font-weight: 600; line-height: 1.4; }
.mcp-desc { margin: 0; color: var(--dsw-alias-label-secondary); font-size: 12.5px; }
.mcp-toolbar, .mcp-toolbarRow, .mcp-detailActions, .mcp-emptyActions, .mcp-statusActions { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
.mcp-toolbarRow { gap: 10px; }
.mcp-btn { flex: none; height: 32px; padding: 0 12px; border: 0.5px solid var(--dsw-alias-border-l2); border-radius: 8px; background: var(--dsw-alias-bg-layer-1); color: var(--dsw-alias-label-primary); font: inherit; font-size: 12.5px; cursor: pointer; white-space: nowrap; }
.mcp-btn:hover:not(:disabled) { border-color: var(--dsw-alias-label-secondary); background: var(--dsw-alias-bg-layer-2); }
.mcp-btn:focus-visible { outline: 2px solid var(--dsw-alias-brand-primary); outline-offset: 1px; }
.mcp-btn:disabled { cursor: default; opacity: 0.5; }
/*
 * Filled primary: brand fill + bg-base text (brand is light on dark themes).
 * Re-assert background/color on hover — the generic .mcp-btn:hover otherwise
 * paints bg-layer-2 and leaves bg-base text, which vanishes on dark themes.
 */
.mcp-btn--primary,
.mcp-btn--primary:hover:not(:disabled),
.mcp-btn--primary:focus-visible {
  border-color: var(--dsw-alias-brand-primary);
  background: var(--dsw-alias-brand-primary);
  color: var(--dsw-alias-bg-base);
}
.mcp-btn--primary:hover:not(:disabled) { filter: brightness(1.08); }
.mcp-btn--danger { color: var(--dsw-alias-state-error-primary); border-color: color-mix(in srgb, var(--dsw-alias-state-error-primary) 35%, var(--dsw-alias-border-l2)); }
.mcp-btn--auth { border: none; background: #b45309; color: #fff; }
.mcp-btn--auth:hover:not(:disabled) { filter: brightness(1.05); }
.mcp-updated { color: var(--dsw-alias-label-secondary); font-size: 11px; white-space: nowrap; }
.mcp-search { flex: 1 1 180px; min-width: 140px; height: 34px; padding: 0 12px; border: 0.5px solid var(--dsw-alias-border-l2); border-radius: 8px; background: var(--dsw-alias-bg-layer-2); color: var(--dsw-alias-label-primary); font: inherit; font-size: 12.5px; }
.mcp-search:focus-visible { outline: none; border-color: var(--dsw-alias-brand-primary); }
.mcp-chips { display: flex; align-items: center; gap: 6px; flex-wrap: wrap; }
.mcp-chip { height: 28px; padding: 0 10px; border: 0.5px solid var(--dsw-alias-border-l2); border-radius: 999px; background: var(--dsw-alias-bg-layer-1); color: var(--dsw-alias-label-secondary); font: inherit; font-size: 12px; cursor: pointer; }
.mcp-chip[data-active="true"] { border-color: transparent; background: color-mix(in srgb, var(--dsw-alias-brand-primary) 16%, transparent); color: var(--dsw-alias-brand-primary); font-weight: 600; }
.mcp-split { display: flex; flex: 1 1 auto; min-height: 0; overflow: hidden; border-top: 0.5px solid var(--dsw-alias-border-l2); }
.mcp-master { display: flex; flex-direction: column; gap: 10px; width: min(420px, 42%); flex-shrink: 0; padding: 14px; overflow: auto; border-right: 0.5px solid var(--dsw-alias-border-l2); background: var(--dsw-alias-bg-layer-2); }
/*
 * List controls live above the rows they act on: create/import/export, then
 * search + refresh, then the filter chips. Slightly tighter than the shared
 * .mcp-btn size so three actions plus a timestamp fit a 420px column.
 */
.mcp-masterTools { display: flex; flex-direction: column; gap: 9px; padding: 0 0 11px; border-bottom: 0.5px solid var(--dsw-alias-border-l2); }
.mcp-masterTools .mcp-toolbar { gap: 7px; }
.mcp-masterTools .mcp-toolbarRow { gap: 7px; flex-wrap: nowrap; }
.mcp-masterTools .mcp-btn { height: 30px; padding: 0 10px; }
.mcp-masterTools .mcp-btn--primary { padding: 0 11px; }
.mcp-masterTools .mcp-search { height: 32px; padding: 0 11px; }
.mcp-masterTools .mcp-chips { gap: 6px; }
.mcp-masterTools .mcp-chip { height: 26px; padding: 0 9px; font-size: 11.5px; }
.mcp-masterTools .mcp-updated { margin: 0 0 0 auto; }
/*
 * This page sits in a document-flow tab (like the skills and usage pages), so
 * no ancestor hands it a height: a flex ratio cannot bound the tool list here.
 * The list therefore gets a viewport-relative cap instead of a fixed 360px —
 * it still grows with the window, and it always has a scrollbar of its own.
 */
.mcp-detailPane { display: flex; flex-direction: column; flex: 1 1 auto; min-width: 0; min-height: 0; overflow: auto; padding: 18px 22px; background: var(--dsw-alias-bg-layer-1); }
.mcp-row { display: flex; flex-direction: column; gap: 8px; width: 100%; padding: 12px 14px; border: 0.5px solid var(--dsw-alias-border-l2); border-radius: 12px; background: var(--dsw-alias-bg-layer-1); color: inherit; font: inherit; text-align: left; cursor: pointer; }
.mcp-row:hover { border-color: var(--dsw-alias-label-secondary); }
.mcp-row[data-active="true"] { border-color: var(--dsw-alias-brand-primary); box-shadow: 0 0 0 1px var(--dsw-alias-brand-primary); }
.mcp-row--off { opacity: 0.72; }
.mcp-rowTop { display: flex; align-items: center; justify-content: space-between; gap: 10px; }
.mcp-rowId { display: flex; align-items: center; gap: 8px; min-width: 0; }
.mcp-rowName { font-size: 14px; font-weight: 650; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.mcp-rowMeta { color: var(--dsw-alias-label-secondary); font-size: 12px; line-height: 1.45; overflow-wrap: anywhere; }
.mcp-dot { width: 8px; height: 8px; border-radius: 999px; flex: none; background: var(--dsw-alias-label-secondary); }
.mcp-dot--lg { width: 10px; height: 10px; }
.mcp-dot[data-state="online"] { background: var(--dsw-alias-state-success-primary); }
.mcp-dot[data-state="auth"] { background: var(--dsw-alias-state-warn-primary); }
.mcp-dot[data-state="idle"] { background: var(--dsw-alias-label-secondary); }
.mcp-dot[data-state="down"] { background: var(--dsw-alias-state-error-primary); }
.mcp-dot[data-state="off"] { background: var(--dsw-alias-border-l2); }
.mcp-badge { flex: none; padding: 2px 8px; border-radius: 999px; font-size: 11px; font-weight: 650; }
.mcp-badge--stdio { background: color-mix(in srgb, var(--dsw-alias-brand-primary) 14%, transparent); color: var(--dsw-alias-brand-primary); }
.mcp-badge--http { background: color-mix(in srgb, #c2410c 14%, transparent); color: #c2410c; }
.mcp-switch { width: 36px; height: 20px; border: none; border-radius: 999px; padding: 2px; background: var(--dsw-alias-border-l2); cursor: pointer; position: relative; flex: none; }
.mcp-switch::after { content: ''; position: absolute; top: 2px; left: 2px; width: 16px; height: 16px; border-radius: 999px; background: #fff; transition: transform 120ms ease; box-shadow: 0 1px 2px rgba(0,0,0,.25); }
.mcp-switch[data-on="true"] { background: var(--dsw-alias-state-success-primary); }
.mcp-switch[data-on="true"]::after { transform: translateX(16px); }
.mcp-switch:disabled { opacity: 0.5; cursor: default; }
.mcp-detail { display: flex; flex-direction: column; gap: 14px; min-height: 0; }
.mcp-detailEmpty, .mcp-noMatch, .mcp-loading { color: var(--dsw-alias-label-secondary); font-size: 12.5px; padding: 20px 4px; }
.mcp-detailHead { display: flex; align-items: flex-start; justify-content: space-between; gap: 14px; flex-wrap: wrap; }
.mcp-detailTitle { display: flex; flex-direction: column; gap: 6px; min-width: 0; }
.mcp-detailNameRow { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; }
.mcp-detailName { margin: 0; font-size: 18px; font-weight: 700; }
.mcp-detailSub { color: var(--dsw-alias-label-secondary); font-size: 12.5px; overflow-wrap: anywhere; }
.mcp-statusPill { padding: 3px 8px; border-radius: 999px; font-size: 12px; font-weight: 600; background: var(--dsw-alias-bg-layer-2); color: var(--dsw-alias-label-secondary); }
.mcp-statusPill[data-state="online"] { background: color-mix(in srgb, var(--dsw-alias-state-success-primary) 16%, transparent); color: var(--dsw-alias-state-success-primary); }
.mcp-statusPill[data-state="auth"] { background: color-mix(in srgb, var(--dsw-alias-state-warn-primary) 16%, transparent); color: var(--dsw-alias-state-warn-primary); }
.mcp-statusPill[data-state="down"] { background: color-mix(in srgb, var(--dsw-alias-state-error-primary) 16%, transparent); color: var(--dsw-alias-state-error-primary); }
.mcp-authBanner { display: flex; align-items: center; justify-content: space-between; gap: 14px; padding: 12px 14px; border: 0.5px solid color-mix(in srgb, var(--dsw-alias-state-warn-primary) 45%, var(--dsw-alias-border-l2)); border-radius: 12px; background: color-mix(in srgb, var(--dsw-alias-state-warn-primary) 10%, transparent); }
.mcp-authText { display: flex; flex-direction: column; gap: 4px; min-width: 0; }
.mcp-authTitle { font-weight: 700; color: var(--dsw-alias-state-warn-primary); }
.mcp-authBody { font-size: 12px; color: var(--dsw-alias-state-warn-primary); }
.mcp-fields, .mcp-toolList { display: flex; flex-direction: column; border: 1px solid var(--dsw-alias-border-l2); border-radius: 12px; overflow: hidden; background: var(--dsw-alias-bg-layer-1); }
.mcp-field { display: flex; align-items: flex-start; justify-content: space-between; gap: 16px; padding: 11px 14px; border-bottom: 0.5px solid var(--dsw-alias-border-l2); }
.mcp-field--soft { background: var(--dsw-alias-bg-layer-2); }
.mcp-field--last, .mcp-tool:last-child { border-bottom: 0; }
.mcp-fieldLabel { flex: none; font-size: 12px; font-weight: 650; color: var(--dsw-alias-label-secondary); }
.mcp-fieldValue { text-align: right; font-size: 13px; overflow-wrap: anywhere; }
.mcp-tools { display: flex; flex-direction: column; gap: 8px; min-height: 0; }
.mcp-toolsHead { display: flex; align-items: center; justify-content: space-between; gap: 10px; flex-wrap: wrap; }
.mcp-toolsTitle { font-size: 13.5px; font-weight: 700; }
.mcp-toolsHint { color: var(--dsw-alias-label-secondary); font-size: 12px; }
.mcp-toolSearch { width: 100%; height: 34px; padding: 0 12px; border: 0.5px solid var(--dsw-alias-border-l2); border-radius: 8px; background: var(--dsw-alias-bg-layer-2); color: var(--dsw-alias-label-primary); font: inherit; font-size: 12.5px; }
.mcp-toolSearch:focus-visible { outline: none; border-color: var(--dsw-alias-brand-primary); }
/* Grows with the window instead of sitting at a fixed 360px, and scrolls on its
 * own; the search box above it stays put. */
.mcp-toolList { max-height: clamp(220px, calc(100vh - 520px), 880px); overflow: auto; overscroll-behavior: contain; }
/*
 * Tail gap after the last tool. A pseudo-element rather than padding: the page
 * is border-box, so padding would shorten the visible list by the same amount
 * all the time, while this only extends how far the list scrolls.
 */
.mcp-toolList::after { content: ''; display: block; flex: 0 0 100px; }
.mcp-toolsNoMatch { padding: 18px 14px; border: 0.5px dashed var(--dsw-alias-border-l2); border-radius: 12px; color: var(--dsw-alias-label-secondary); font-size: 12.5px; text-align: center; background: var(--dsw-alias-bg-layer-2); }
.mcp-tool { display: flex; flex-direction: column; gap: 4px; padding: 11px 14px; border-bottom: 0.5px solid var(--dsw-alias-border-l2); }
.mcp-tool--soft { background: var(--dsw-alias-bg-layer-2); }
/* The tail gap would otherwise expose the last row's own rule. */
.mcp-tool:last-child { border-bottom: none; }
.mcp-toolName { font-size: 13px; font-weight: 600; font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; }
/* The name and its permission control share one line, so a long tool name
 * wraps under the control instead of pushing it away. */
.mcp-toolTop { display: flex; align-items: flex-start; justify-content: space-between; gap: 10px; }
.mcp-toolTop .mcp-toolName { min-width: 0; overflow-wrap: anywhere; }
/* Three answers, one control. Deliberately not a switch: "ask" is a different
 * kind of answer (it runs, but only after a human agrees), not a degree of on. */
.mcp-perm { display: flex; align-items: center; gap: 2px; flex: none; padding: 2px; background: var(--dsw-alias-bg-base); border: 0.5px solid var(--dsw-alias-border-l2); border-radius: 8px; }
.mcp-permSeg { padding: 0 9px; height: 24px; border: 0; border-radius: 6px; background: transparent; color: var(--dsw-alias-label-secondary); font: inherit; font-size: 11.5px; white-space: nowrap; cursor: pointer; }
.mcp-permSeg:disabled { cursor: default; opacity: 0.5; }
.mcp-permSeg:focus-visible { outline: 2px solid var(--dsw-alias-brand-primary); outline-offset: 1px; }
.mcp-permSeg[data-active="true"] { font-weight: 600; }
.mcp-permSeg[data-active="true"][data-permission="allow"] { background: color-mix(in srgb, var(--dsw-alias-state-success-primary) 16%, transparent); color: var(--dsw-alias-state-success-primary); }
.mcp-permSeg[data-active="true"][data-permission="ask"] { background: color-mix(in srgb, var(--dsw-alias-state-warn-primary) 18%, transparent); color: var(--dsw-alias-state-warn-primary); }
.mcp-permSeg[data-active="true"][data-permission="deny"] { background: color-mix(in srgb, var(--dsw-alias-state-error-primary) 16%, transparent); color: var(--dsw-alias-state-error-primary); }
.mcp-toolsBulk { display: flex; align-items: center; gap: 6px; flex-wrap: wrap; }
.mcp-bulk { padding: 0 10px; height: 26px; border: 0.5px solid var(--dsw-alias-border-l2); border-radius: 8px; background: var(--dsw-alias-bg-layer-1); font: inherit; font-size: 11.5px; font-weight: 600; white-space: nowrap; cursor: pointer; }
.mcp-bulk:hover:not(:disabled) { border-color: var(--dsw-alias-label-secondary); }
.mcp-bulk:disabled { opacity: 0.5; cursor: default; }
.mcp-bulk--allow { color: var(--dsw-alias-state-success-primary); }
.mcp-bulk--ask { color: var(--dsw-alias-state-warn-primary); }
.mcp-bulk--deny { color: var(--dsw-alias-state-error-primary); }
.mcp-default { display: flex; align-items: center; justify-content: space-between; gap: 14px; padding: 11px 14px; border: 0.5px solid var(--dsw-alias-border-l2); border-radius: 12px; background: var(--dsw-alias-bg-layer-2); }
.mcp-defaultText { display: flex; flex-direction: column; gap: 3px; min-width: 0; }
.mcp-defaultTitle { font-size: 13px; font-weight: 600; }
.mcp-defaultBody { font-size: 12px; color: var(--dsw-alias-label-secondary); }
.mcp-defaultPill { flex: none; padding: 3px 9px; border-radius: 999px; font-size: 11.5px; font-weight: 600; background: var(--dsw-alias-bg-layer-1); color: var(--dsw-alias-label-secondary); }
.mcp-defaultPill[data-fallback="deny"] { background: color-mix(in srgb, var(--dsw-alias-state-error-primary) 16%, transparent); color: var(--dsw-alias-state-error-primary); }
.mcp-defaultPill[data-fallback="ask"] { background: color-mix(in srgb, var(--dsw-alias-state-warn-primary) 18%, transparent); color: var(--dsw-alias-state-warn-primary); }
.mcp-defaultPill[data-fallback="allow"] { background: color-mix(in srgb, var(--dsw-alias-state-success-primary) 16%, transparent); color: var(--dsw-alias-state-success-primary); }
.mcp-toolDesc { color: var(--dsw-alias-label-secondary); font-size: 12px; line-height: 1.45; }
.mcp-toolParams { display: flex; align-items: flex-start; justify-content: space-between; gap: 10px; }
.mcp-toolParamsSummary { min-width: 0; color: var(--dsw-alias-label-secondary); font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; font-size: 11.5px; line-height: 1.45; overflow-wrap: anywhere; }
.mcp-toolParamsToggle { flex: none; padding: 0; border: 0; background: none; color: var(--dsw-alias-brand-primary); font: inherit; font-size: 11.5px; cursor: pointer; white-space: nowrap; }
.mcp-toolParamsToggle:focus-visible { outline: 2px solid var(--dsw-alias-brand-primary); outline-offset: 2px; border-radius: 4px; }
.mcp-toolSchema { margin: 2px 0 0; padding: 10px 12px; border-radius: 8px; background: var(--dsw-alias-bg-base); color: var(--dsw-alias-label-primary); font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; font-size: 11.5px; line-height: 1.45; overflow: auto; max-height: 220px; white-space: pre; }
.mcp-toolsEmpty { display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 6px; padding: 28px 16px; border: 0.5px dashed var(--dsw-alias-border-l2); border-radius: 12px; background: var(--dsw-alias-bg-layer-2); text-align: center; }
.mcp-toolsEmptyTitle { font-weight: 700; }
.mcp-toolsEmptyBody { color: var(--dsw-alias-label-secondary); font-size: 12px; }
.mcp-empty { flex: 1; display: flex; align-items: center; justify-content: center; padding: 32px 20px; }
.mcp-emptyCard { display: flex; flex-direction: column; align-items: center; gap: 12px; width: min(520px, 100%); padding: 32px 24px; border: 1px solid var(--dsw-alias-border-l2); border-radius: 16px; background: var(--dsw-alias-bg-layer-1); text-align: center; }
.mcp-emptyIcon { display: flex; align-items: center; justify-content: center; width: 52px; height: 52px; border-radius: 999px; background: color-mix(in srgb, var(--dsw-alias-brand-primary) 14%, transparent); color: var(--dsw-alias-brand-primary); font-weight: 700; }
.mcp-emptyTitle { font-size: 16px; font-weight: 700; }
.mcp-emptyBody { color: var(--dsw-alias-label-secondary); font-size: 12.5px; line-height: 1.55; }
.mcp-status { display: flex; flex-direction: column; gap: 4px; margin: 0 24px; padding: 10px 12px; border: 0.5px solid var(--dsw-alias-border-l2); border-radius: 10px; background: var(--dsw-alias-bg-layer-1); font-size: 12px; }
.mcp-statusTitle { font-weight: 500; }
.mcp-status--warn { border-color: var(--dsw-alias-state-warn-primary); }
.mcp-status--warn .mcp-statusTitle { color: var(--dsw-alias-state-warn-primary); }
.mcp-status--error { border-color: var(--dsw-alias-state-error-primary); }
.mcp-status--error .mcp-statusTitle { color: var(--dsw-alias-state-error-primary); }
.mcp-statusPath { color: var(--dsw-alias-label-secondary); font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; font-size: 11px; overflow-wrap: anywhere; }
.mcp-page--form, .mcp-page--diag { padding: 20px 24px 28px; display: flex; flex-direction: column; gap: 14px; min-height: 100%; }
.mcp-formHead { display: flex; align-items: flex-start; justify-content: space-between; gap: 12px; flex-wrap: wrap; }
.mcp-formBody { display: flex; gap: 18px; align-items: flex-start; flex-wrap: wrap; }
.mcp-formCard { display: flex; flex-direction: column; gap: 14px; flex: 1 1 420px; max-width: 720px; padding: 18px; border: 1px solid var(--dsw-alias-border-l2); border-radius: 12px; background: var(--dsw-alias-bg-layer-1); }
.mcp-formSide { display: flex; flex-direction: column; gap: 12px; width: min(320px, 100%); flex: 0 1 320px; }
.mcp-label { display: flex; flex-direction: column; gap: 7px; font-size: 12px; font-weight: 700; color: var(--dsw-alias-label-secondary); }
.mcp-hint { font-weight: 400; color: var(--dsw-alias-label-secondary); font-size: 11.5px; }
.mcp-input, .mcp-textarea { width: 100%; border: 0.5px solid var(--dsw-alias-border-l2); border-radius: 8px; background: var(--dsw-alias-bg-layer-2); color: var(--dsw-alias-label-primary); font: inherit; font-size: 13px; font-weight: 500; }
.mcp-input { height: 38px; padding: 0 12px; }
.mcp-textarea { min-height: 88px; padding: 10px 12px; resize: vertical; line-height: 1.5; }
.mcp-textarea--import { min-height: 320px; font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; font-size: 12px; }
.mcp-input:focus-visible, .mcp-textarea:focus-visible { outline: none; border-color: var(--dsw-alias-brand-primary); }
.mcp-seg { display: flex; gap: 8px; }
.mcp-segBtn { height: 34px; padding: 0 14px; border: 0.5px solid var(--dsw-alias-border-l2); border-radius: 8px; background: var(--dsw-alias-bg-layer-1); color: var(--dsw-alias-label-primary); font: inherit; font-size: 12.5px; cursor: pointer; }
.mcp-segBtn[data-active="true"],
.mcp-segBtn[data-active="true"]:hover {
  border-color: transparent;
  background: var(--dsw-alias-brand-primary);
  color: var(--dsw-alias-bg-base);
  font-weight: 700;
}
.mcp-advanced { display: flex; flex-direction: column; gap: 10px; padding: 12px; border: 0.5px solid var(--dsw-alias-border-l2); border-radius: 12px; background: var(--dsw-alias-bg-layer-2); }
.mcp-advancedTitle { font-size: 13px; font-weight: 700; color: var(--dsw-alias-label-primary); }
.mcp-advancedRow { display: flex; gap: 12px; flex-wrap: wrap; }
.mcp-advancedRow > * { flex: 1 1 140px; }
.mcp-reconnectRow { display: flex; align-items: center; justify-content: space-between; height: 38px; padding: 0 12px; border: 0.5px solid var(--dsw-alias-border-l2); border-radius: 8px; background: var(--dsw-alias-bg-layer-1); color: var(--dsw-alias-label-primary); font-weight: 500; }
.mcp-check { display: inline-flex; align-items: center; gap: 8px; font-weight: 500; color: var(--dsw-alias-label-primary); }
.mcp-previewCard, .mcp-noteCard { display: flex; flex-direction: column; gap: 8px; padding: 14px; border: 1px solid var(--dsw-alias-border-l2); border-radius: 12px; background: var(--dsw-alias-bg-layer-1); }
.mcp-previewTitle, .mcp-noteTitle { font-size: 13px; font-weight: 700; }
.mcp-noteBody { color: var(--dsw-alias-label-secondary); font-size: 12px; line-height: 1.5; }
.mcp-previewCode { margin: 0; padding: 12px; border-radius: 8px; background: #0f172a; color: #e2e8f0; font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; font-size: 12px; line-height: 1.55; white-space: pre-wrap; overflow: auto; }
.mcp-crumb { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
.mcp-back { padding: 0; border: 0; background: none; color: var(--dsw-alias-brand-primary); font: inherit; font-size: 13px; cursor: pointer; }
.mcp-back:hover { text-decoration: underline; text-underline-offset: 2px; }
.mcp-crumbSep { color: var(--dsw-alias-label-secondary); }
.mcp-diagBody { display: flex; gap: 14px; align-items: stretch; min-height: 0; flex: 1; flex-wrap: wrap; }
.mcp-diagMain { flex: 1 1 420px; min-width: 0; display: flex; flex-direction: column; }
.mcp-diagSide { width: min(300px, 100%); flex: 0 1 300px; display: flex; flex-direction: column; gap: 12px; }
.mcp-log { display: flex; flex-direction: column; flex: 1; min-height: 360px; border: 1px solid var(--dsw-alias-border-l2); border-radius: 12px; overflow: hidden; background: #0f172a; }
.mcp-logHead { display: flex; align-items: center; justify-content: space-between; gap: 10px; padding: 10px 14px; border-bottom: 1px solid #1e293b; background: #111827; color: #94a3b8; font-size: 12px; font-weight: 650; }
.mcp-logBody, .mcp-exportBody { flex: 1; margin: 0; padding: 12px 14px; overflow: auto; color: #e2e8f0; font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; font-size: 12px; line-height: 1.7; white-space: pre-wrap; word-break: break-word; }
.mcp-exportBody { min-height: 360px; border: 1px solid var(--dsw-alias-border-l2); border-radius: 12px; background: var(--dsw-alias-bg-layer-2); color: var(--dsw-alias-label-primary); }
.mcp-unmanaged { display: flex; flex-direction: column; gap: 10px; margin: 12px 24px 0; padding: 14px; border: 1px dashed color-mix(in srgb, var(--dsw-alias-state-warn-primary) 55%, var(--dsw-alias-border-l2)); border-radius: 12px; background: color-mix(in srgb, var(--dsw-alias-state-warn-primary) 9%, transparent); }
.mcp-unHead { display: flex; align-items: flex-start; justify-content: space-between; gap: 10px; }
.mcp-unTitle { font-weight: 700; color: var(--dsw-alias-state-warn-primary); font-size: 13px; }
.mcp-unBody { color: var(--dsw-alias-label-secondary); font-size: 11.5px; line-height: 1.5; }
.mcp-unCount { flex: none; height: 24px; line-height: 24px; padding: 0 10px; border-radius: 999px; font-size: 11px; font-weight: 650; color: var(--dsw-alias-state-warn-primary); background: color-mix(in srgb, var(--dsw-alias-state-warn-primary) 16%, transparent); }
.mcp-unRow { display: flex; flex-direction: column; gap: 3px; padding: 9px 12px; border: 0.5px solid var(--dsw-alias-border-l2); border-radius: 8px; background: var(--dsw-alias-bg-layer-1); }
.mcp-unRowTop { display: flex; align-items: center; gap: 8px; }
.mcp-unName { font-size: 13px; font-weight: 650; }
.mcp-unId { flex: 1 1 auto; min-width: 0; text-align: right; font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; font-size: 11px; color: var(--dsw-alias-label-secondary); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.mcp-unConflict { color: var(--dsw-alias-state-warn-primary); font-size: 11px; line-height: 1.45; }
.mcp-unActions { display: flex; justify-content: flex-end; }
.mcp-adpt { display: flex; flex-direction: column; gap: 12px; margin: 12px 24px 0; padding: 16px 14px; border: 1px solid color-mix(in srgb, var(--dsw-alias-state-warn-primary) 55%, var(--dsw-alias-border-l2)); border-radius: 12px; background: var(--dsw-alias-bg-layer-1); }
.mcp-adptCrumb { font-size: 11px; font-weight: 650; color: var(--dsw-alias-state-warn-primary); }
.mcp-adptTitle { font-size: 15px; font-weight: 700; }
.mcp-adptBody { font-size: 11.5px; line-height: 1.55; color: var(--dsw-alias-label-secondary); }
.mcp-adptEntry { display: flex; flex-direction: column; gap: 4px; padding: 10px 12px; border: 0.5px solid var(--dsw-alias-border-l2); border-radius: 8px; background: var(--dsw-alias-bg-layer-2); }
.mcp-adptEntryTop { display: flex; align-items: center; gap: 8px; }
.mcp-adptEntryName { font-size: 13px; font-weight: 650; }
.mcp-adptEntryId { flex: 1 1 auto; min-width: 0; text-align: right; font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; font-size: 11px; color: var(--dsw-alias-label-secondary); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.mcp-adptEndpoint { font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; font-size: 11px; color: var(--dsw-alias-label-secondary); line-height: 1.5; overflow-wrap: anywhere; }
.mcp-adptPath { display: flex; align-items: center; gap: 6px; font-size: 11px; color: var(--dsw-alias-label-secondary); }
.mcp-adptPathFile { font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; font-size: 11px; overflow-wrap: anywhere; }
.mcp-adptActions { display: flex; justify-content: flex-end; gap: 8px; }
.mcp-stripOk { display: flex; align-items: center; gap: 8px; padding: 10px 12px; border: 0.5px solid color-mix(in srgb, var(--dsw-alias-state-success-primary) 45%, var(--dsw-alias-border-l2)); border-radius: 10px; background: color-mix(in srgb, var(--dsw-alias-state-success-primary) 10%, transparent); font-size: 12.5px; line-height: 1.45; }
@media (max-width: 960px) {
  .mcp-split { flex-direction: column; }
  .mcp-master { width: 100%; border-right: 0; border-bottom: 0.5px solid var(--dsw-alias-border-l2); max-height: 52vh; }
}
`
