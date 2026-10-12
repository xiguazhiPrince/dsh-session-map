/**
 * The Tool row this plugin claims for its own mirrored ACP calls.
 *
 * Why this exists at all is worth stating, because it corrects an assumption
 * made when the mirrored calls were first emitted. A tool's host-side
 * `presentCall` does NOT reach this card: the browser builds a tool row from
 * `toolTitleKey(toolName)` — a fixed locale-key table — and a summary derived
 * from the raw arguments, so an unknown wire name falls to the generic title and
 * the row reads `acp_read · session-…::cursor#3`. The only place a plugin can
 * change that is the keyed `tool.call.toolview` slot, whose key domain is open by
 * contract ("Any name is allowed, including tools registered by your package").
 *
 * So this view renders the remote agent's own words: its title for the call, the
 * category it reported, and the file it touched. It is drawn with `createElement`
 * and this plugin's own classes because the product's row primitives are not
 * importable from a standalone package; the styling rides the same theme tokens
 * the rest of this plugin uses.
 *
 * @module dsh-session-map/client/acp-tool-row
 */
import { createElement, type ReactElement } from 'react'

/**
 * The wire names the ACP route registers, one per ACP tool kind. Kept in step
 * with `acp-agent/channel.ts`'s `TOOL_KINDS` by hand: the two halves are built
 * for different runtimes and share no module.
 */
export const ACP_TOOL_KEYS: readonly string[] = [
  'acp_read',
  'acp_edit',
  'acp_delete',
  'acp_move',
  'acp_search',
  'acp_execute',
  'acp_think',
  'acp_fetch',
  'acp_switch_mode',
  'acp_other',
]

/**
 * Category labels. Hard-coded Chinese, like every other string this plugin
 * ships; the locale service would add a namespace and a dictionary per language
 * for ten short words.
 */
const KIND_LABELS: Record<string, string> = {
  read: '读取',
  edit: '编辑',
  delete: '删除',
  move: '移动',
  search: '搜索',
  execute: '执行',
  think: '思考',
  fetch: '获取',
  switch_mode: '切换模式',
  other: '工具',
}

/** One file location the remote agent reported. */
interface AcpLocation {
  readonly path: string
  readonly line?: number
}

/** The arguments this route puts on a mirrored call. */
interface AcpArgs {
  readonly title?: string
  readonly kind?: string
  readonly rawInput?: unknown
  readonly locations?: readonly AcpLocation[]
}

/** One content block of a settled tool result. */
interface ContentBlockLike {
  readonly type?: string
  readonly text?: string
}

/**
 * The owner currency this view reads. Typed locally: the product's slot types
 * live in packages this one cannot import.
 */
export interface AcpToolRowProps {
  readonly callId: string
  readonly toolName: string
  readonly cwd?: string | undefined
  readonly phase: 'preparing' | 'start' | 'result'
  readonly block: Record<string, unknown>
  readonly useDisclosure: () => {
    readonly expanded: boolean
    readonly toggle: () => void
  }
  readonly openFile?: ((path: string, options?: unknown) => void) | undefined
}

/**
 * Read the call's raw argument JSON for whichever stage this render is in.
 * @param props - the owner currency.
 * @returns the JSON text, or `''` before arguments exist.
 */
function argsRawOf(props: AcpToolRowProps): string {
  if (props.phase === 'start') {
    return typeof props.block['argsRaw'] === 'string' ? props.block['argsRaw'] : ''
  }
  if (props.phase === 'result') {
    const call = props.block['call'] as { argsRaw?: unknown } | null | undefined
    return typeof call?.argsRaw === 'string' ? call.argsRaw : ''
  }
  return ''
}

/**
 * Parse the argument JSON, tolerating anything. A malformed payload must render
 * as a plain row, never as a crash inside the conversation.
 * @param raw - the argument JSON text.
 * @returns the parsed arguments, or an empty object.
 */
function parseArgs(raw: string): AcpArgs {
  if (raw === '') return {}
  try {
    const parsed: unknown = JSON.parse(raw)
    return parsed !== null && typeof parsed === 'object' ? parsed as AcpArgs : {}
  } catch {
    return {}
  }
}

/**
 * The settled result's text, if it has any.
 * @param props - the owner currency.
 * @returns the joined text, or undefined while running or when blank.
 */
function resultText(props: AcpToolRowProps): string | undefined {
  if (props.phase !== 'result') return undefined
  const content = props.block['content']
  if (!Array.isArray(content)) return undefined
  const text = (content as ContentBlockLike[])
    .filter((block) => block?.type === 'text' && typeof block.text === 'string')
    .map((block) => block.text as string)
    .join('\n')
    .trim()
  return text === '' ? undefined : text
}

/**
 * Shorten a workspace-rooted path, so a card shows what the reader recognizes.
 * @param path - the reported path.
 * @param cwd - the session workspace root, when known.
 * @returns the path relative to the workspace, or unchanged.
 */
function displayPath(path: string, cwd: string | undefined): string {
  if (cwd === undefined || cwd === '') return path
  const normalized = path.replace(/\\/g, '/')
  const root = cwd.replace(/\\/g, '/').replace(/\/+$/, '')
  return normalized.startsWith(`${root}/`) ? normalized.slice(root.length + 1) : path
}

/**
 * One mirrored ACP tool call.
 * @param props - the Tool slot's owner currency.
 * @returns the row.
 */
export function AcpToolRow(props: AcpToolRowProps): ReactElement {
  const { expanded, toggle } = props.useDisclosure()
  const args = parseArgs(argsRawOf(props))
  const kind = typeof args.kind === 'string' && args.kind !== '' ? args.kind : 'other'
  const label = KIND_LABELS[kind] ?? KIND_LABELS['other'] as string
  const remoteTitle = typeof args.title === 'string' && args.title.trim() !== '' ? args.title : undefined
  const location = Array.isArray(args.locations) && args.locations.length > 0 ? args.locations[0] : undefined
  const path = location === undefined ? undefined : displayPath(location.path, props.cwd)
  const output = resultText(props)
  const failed = props.phase === 'result' && props.block['isError'] === true
  const state = props.phase === 'preparing' ? 'preparing' : props.phase === 'start' ? 'running' : failed ? 'error' : 'ok'
  const headline = remoteTitle ?? path ?? props.callId

  const head: ReactElement[] = [
    createElement('span', { key: 'dot', className: 'dsm-acp-tool__dot', 'data-state': state }),
    createElement('span', { key: 'kind', className: 'dsm-acp-tool__kind' }, label),
    createElement('span', { key: 'headline', className: 'dsm-acp-tool__headline', title: headline }, headline),
  ]
  if (remoteTitle !== undefined && path !== undefined) {
    head.push(createElement('span', { key: 'path', className: 'dsm-acp-tool__path', title: path }, path))
  }
  head.push(createElement('span', { key: 'chevron', className: 'dsm-acp-tool__chevron' }, expanded ? '−' : '+'))

  const body: ReactElement[] = []
  if (args.rawInput !== undefined && args.rawInput !== null) {
    body.push(createElement('div', { key: 'in', className: 'dsm-acp-tool__field' },
      createElement('span', { className: 'dsm-acp-tool__fieldLabel' }, '输入'),
      createElement('pre', { className: 'dsm-acp-tool__pre' }, JSON.stringify(args.rawInput, null, 2)),
    ))
  }
  if (args.locations !== undefined && args.locations.length > 0) {
    body.push(createElement('div', { key: 'files', className: 'dsm-acp-tool__field' },
      createElement('span', { className: 'dsm-acp-tool__fieldLabel' }, '文件'),
      createElement('div', { className: 'dsm-acp-tool__files' }, args.locations.map((entry, index) => {
        const target = displayPath(entry.path, props.cwd)
        return createElement('button', {
          key: `${entry.path}#${String(index)}`,
          type: 'button',
          className: 'dsm-acp-tool__file',
          onClick: () => { props.openFile?.(entry.path, entry.line === undefined ? undefined : { line: entry.line }) },
        }, entry.line === undefined ? target : `${target}:${String(entry.line)}`)
      })),
    ))
  }
  body.push(createElement('div', { key: 'out', className: 'dsm-acp-tool__field' },
    createElement('span', { className: 'dsm-acp-tool__fieldLabel' }, '输出'),
    createElement('pre', { className: 'dsm-acp-tool__pre' },
      output ?? (failed ? '远端调用失败。' : props.phase === 'result' ? '（远端没有返回内容）' : '运行中…')),
  ))

  return createElement('div', { className: 'dsm-acp-tool', 'data-state': state },
    createElement('button', {
      type: 'button',
      className: 'dsm-acp-tool__head',
      'aria-expanded': expanded,
      onClick: toggle,
    }, head),
    expanded ? createElement('div', { className: 'dsm-acp-tool__body' }, body) : null,
  )
}
