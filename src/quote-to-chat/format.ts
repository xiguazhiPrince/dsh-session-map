/**
 * 「把文件预览里选中的文本引用到对话」的纯文本层。
 *
 * 一次引用由四段信息拼成：选区内容、文件身份（**宿主机绝对路径**）、行号范围、
 * 文件类型。这里只做字符串运算——不碰 DOM、不碰 React、不碰 ctx——因此单测可以
 * 直接覆盖每一条格式规则；浏览器侧只负责把 DOM 选区与源码喂进来、把结果交给
 * 输入框。
 *
 * 插入形态（来源坐标永远在最前面，内容在后）：
 * - Markdown / 纯文本预览：首行 `绝对路径:起止行`，空行，Markdown 引用块内容；
 * - 代码预览：围栏代码块，信息行同样是 `绝对路径:起止行`，正文是代码。
 *
 * 内容优先取**源码原文**（Markdown 的 `**`、缩进等都保留），拿不到源码时才退回
 * 渲染后的可见文本。超长选区在 {@link SELECTION_LIMIT} 处截断，并在正文后留下
 * 明确的截断说明，不静默丢内容。
 *
 * @module dsh-session-map/quote-to-chat/format
 */

/** 引用形态：代码围栏，还是 Markdown 引用块。 */
export type QuoteKind = 'prose' | 'code'

/** 1-based 行号范围，闭区间；起止相同表示单行。 */
export interface LineRange {
  readonly start: number
  readonly end: number
}

/** 一次引用插入所需的全部输入。 */
export interface QuoteInput {
  /** 引用形态，决定载荷是引用块还是围栏。 */
  readonly kind: QuoteKind
  /** 选区原文（已从 DOM 投影出来，行尾为 `\n`）。 */
  readonly text: string
  /** 来源坐标里的路径：优先宿主机绝对路径，拿不到时才退化。 */
  readonly path: string
  /** 能可靠映射回源码时的行号范围；拿不到时省略。 */
  readonly lines?: LineRange | undefined
}

/** 一次载荷构造的结果：真正插入的文本，以及截断信息。 */
export interface QuotePayload {
  /** 可直接交给输入框的完整文本。 */
  readonly text: string
  /** 选区是否被 {@link SELECTION_LIMIT} 截断。 */
  readonly truncated: boolean
  /** 选区原始字符数（未截断时等于 text 的字符数，不含格式）。 */
  readonly total: number
}

/**
 * 单次引用的最大字符数（UTF-16 code unit，即 JS `.length`）。
 *
 * 需求：引用内容只是「酌情」的摘要，来源坐标才是主信息，因此上限压到 100 字；
 * 超出时在行边界截断并把行号范围收窄到实际引用的行，再注明原文总字数。
 */
/**
 * 引用插入后的收尾：空行 + 一级分隔线 + **两个换行**。
 *
 * 第二个换行让光标停在分割线下面隔一行的地方，用户开始写自己的问题时不会
 * 紧贴横线；发送后渲染成一条水平线，把「引用的原文」和「我的问题」分开。
 */
export const QUOTE_DIVIDER = '\n\n---\n\n'

export const SELECTION_LIMIT = 100

/** 文件资源地址的固定前缀；地址形如 `dsh-resource://file/session/<sessionId>/<path>`。 */
export const FILE_ADDRESS_PREFIX = 'dsh-resource://file/'

/** 会话文件地址里路径段的标记。 */
const SESSION_SEGMENT = 'session'

/**
 * 可引用预览的渲染器 id：文档预览包把每个预览实现注册成
 * `@deepseek-ai/dsh-client-ui-sidebar-documentpreview/<名字>`。
 *
 * 这里需要完整 id 而不是后缀，因为源码旁路要按 keyed slot 的 key 精确注册。
 */
export const MARKDOWN_RENDERER_ID = '@deepseek-ai/dsh-client-ui-sidebar-documentpreview/markdown'

/** 纯文本预览渲染器 id。 */
export const TEXT_RENDERER_ID = '@deepseek-ai/dsh-client-ui-sidebar-documentpreview/text'

/** 代码预览渲染器 id。 */
export const CODE_RENDERER_ID = '@deepseek-ai/dsh-client-ui-sidebar-documentpreview/code'

/** 截断说明的模板：数量写在里面，避免「为什么变短了」的疑问。 */
const TRUNCATED_NOTE = '（选区过长，已截断：原文共 {total} 字）'

/**
 * 识别预览实现 id 对应的引用形态。
 *
 * 预览实现 id 是文档预览包注册的完整包内路径，例如
 * `@deepseek-ai/dsh-client-ui-sidebar-documentpreview/markdown`。只按**后缀**判断，
 * 不锁死包名：预览实现可能随产品升级换包，但「末尾是 markdown/text/code」
 * 这条约定来自它自己的实现注册。
 * @param rendererId - 预览根节点上的 `data-document-preview` 值。
 * @returns 引用形态；该预览没有可引用文本时返回 `undefined`。
 */
export function quoteKindOf(rendererId: string | null | undefined): QuoteKind | undefined {
  if (rendererId === null || rendererId === undefined || rendererId === '') return undefined
  if (rendererId.endsWith('/markdown') || rendererId.endsWith('/text')) return 'prose'
  if (rendererId.endsWith('/code')) return 'code'
  return undefined
}

/**
 * 从文件资源地址里取出工作区相对路径。
 *
 * 地址是 `dsh-resource://file/session/<sessionId>/<path>`，路径段逐段
 * `encodeURIComponent`（保留 `:` 供盘符使用），所以这里逐段解码回去。
 * 非会话地址（绝对地址等）返回 `undefined`，由调用方退化到绝对路径。
 * @param address - 预览根节点上的 `data-textpreview-url` 值。
 * @returns 相对路径；解析失败时为 `undefined`。
 */
export function pathOfFileAddress(address: string | null | undefined): string | undefined {
  return parseFileAddress(address)?.path
}

/** 会话文件地址解析出的两段：内容所属会话与工作区相对路径。 */
export interface ParsedFileAddress {
  /** 地址里自带的会话 id：文件属于这个会话的工作区，不一定等于右栏所在会话。 */
  readonly sessionId: string
  /** 工作区相对路径。 */
  readonly path: string
}

/**
 * 解析会话文件地址：`dsh-resource://file/session/<sessionId>/<path>`。
 *
 * 路径段逐段 `encodeURIComponent`（保留 `:` 供盘符使用），这里逐段解码回去。
 * 不是会话范围的 `file` 地址（例如绝对地址）返回 `undefined`。
 * @param address - 预览根节点上的 `data-textpreview-url` 值。
 * @returns 会话 id 与相对路径；解析失败时为 `undefined`。
 */
export function parseFileAddress(address: string | null | undefined): ParsedFileAddress | undefined {
  if (address === null || address === undefined || !address.startsWith(FILE_ADDRESS_PREFIX)) return undefined
  const rest = address.slice(FILE_ADDRESS_PREFIX.length)
  const segments = rest.split('/')
  if (segments.length < 3 || segments[0] !== SESSION_SEGMENT) return undefined
  const sessionId = segments[1]
  if (sessionId === undefined || sessionId === '') return undefined
  const decoded: string[] = []
  for (const segment of segments.slice(2)) {
    try {
      decoded.push(decodeURIComponent(segment))
    } catch {
      return undefined
    }
  }
  const path = decoded.join('/')
  return path === '' ? undefined : { sessionId, path }
}

/**
 * 是否 Markdown 预览：它把源码渲染成 HTML，行号要回源码里找。
 * @param rendererId - 预览根节点上的 `data-document-preview` 值。
 * @returns 是 Markdown 渲染器时为 true。
 */
export function isMarkdownRenderer(rendererId: string | null | undefined): boolean {
  return typeof rendererId === 'string' && rendererId.endsWith('/markdown')
}

/**
 * 拼「路径 + 行号」的来源坐标：单行写 `path:12`，多行写 `path:12-15`，
 * 行号未知时只写路径。
 * @param path - 文件路径（相对或绝对）。
 * @param lines - 行号范围。
 * @returns 来源坐标文本。
 */
export function formatLocation(path: string, lines?: LineRange | undefined): string {
  if (lines === undefined) return path
  const start = Math.max(1, Math.trunc(lines.start))
  const end = Math.max(start, Math.trunc(lines.end))
  return end > start ? `${path}:${start}-${end}` : `${path}:${start}`
}

/**
 * 把行号信息收敛成合法范围：任一端缺失或非正数视为「无行号」。
 * @param start - 选区起点行号（1-based）。
 * @param end - 选区终点行号（1-based）。
 * @returns 合法的行号范围，或 `undefined`。
 */
export function lineRangeOf(start: number | undefined, end: number | undefined): LineRange | undefined {
  if (start === undefined || end === undefined) return undefined
  if (!Number.isFinite(start) || !Number.isFinite(end)) return undefined
  if (start < 1 || end < 1) return undefined
  return end >= start ? { start, end } : { start: end, end: start }
}

/**
 * 规整选区原文：统一换行符，去掉首尾空行，并抹掉每行行尾空白。
 *
 * 代码保留行首缩进（缩进是语义的一部分），因此这里**不**做整段 `trim`，
 * 只清理首尾换行与行尾空白。
 * @param raw - 从 DOM 投影出的原始文本。
 * @returns 可放进载荷的正文。
 */
export function normalizeQuoteText(raw: string): string {
  return raw
    .replace(/\r\n?/gu, '\n')
    .replace(/^\n+/u, '')
    .replace(/[ \t]+$/gmu, '')
    .replace(/\n+$/u, '')
}

/**
 * 按上限截断正文；截断点尽量落在行边界，避免把一行代码劈成两半。
 * @param text - 规整后的正文。
 * @param limit - 字符上限，默认 {@link SELECTION_LIMIT}。
 * @returns 正文、是否截断、原始字符数。
 */
export function clipQuoteText(
  text: string,
  limit: number = SELECTION_LIMIT,
): { readonly text: string; readonly truncated: boolean; readonly total: number } {
  const total = text.length
  if (total <= limit) return { text, truncated: false, total }
  const head = text.slice(0, Math.max(0, limit))
  const lastBreak = head.lastIndexOf('\n')
  // 只有断点还在前半段时才退到行边界；否则宁可硬切，避免丢掉大半内容。
  const body = lastBreak >= limit / 2 ? head.slice(0, lastBreak) : head
  return { text: body, truncated: true, total }
}

/**
 * 计算一行 Markdown 引用：空行保留成裸 `>`，否则 `> ` 前缀。
 *
 * 源码本身可能是引用块（例如 README 里的 `> …`），先剥掉一层 `>` 再加我们的
 * 前缀，避免出现 `> > …` 的嵌套引用。
 * @param text - 正文。
 * @returns 引用块正文。
 */
function quoteBlock(text: string): string {
  return text
    .split('\n')
    .map((line) => {
      const dequoted = line.replace(/^\s{0,3}>\s?/u, '')
      return dequoted === '' ? '>' : `> ${dequoted}`
    })
    .join('\n')
}

/**
 * 选定一段代码围栏长度：至少三个反引号，并且比正文里最长的反引号串多一个。
 * @param text - 代码正文。
 * @returns 可安全包裹正文的围栏。
 */
function fenceFor(text: string): string {
  let longest = 0
  for (const match of text.matchAll(/`+/gu)) longest = Math.max(longest, match[0].length)
  return '`'.repeat(Math.max(3, longest + 1))
}

/**
 * 生成截断说明行；未截断时返回空串。
 * @param truncated - 是否截断。
 * @param total - 选区原始字符数。
 * @returns 说明行（不含前导换行）。
 */
function truncatedNote(truncated: boolean, total: number): string {
  return truncated ? TRUNCATED_NOTE.replace('{total}', String(total)) : ''
}

/** 行首代码围栏标记。 */
const FENCE_MARKER_RE = /^\s{0,3}(`{3,}|~{3,})/u

/**
 * 截断落在未闭合的代码围栏里时，回退到该围栏开头。
 *
 * 否则引用块里会留下一个「开着的」代码块，后面的内容（截断说明、用户接着写的
 * 问题）在渲染时可能被吞进代码块。宁可少引几行，也不留下坏结构。
 * @param text - 已截断的正文。
 * @returns 去掉未闭合围栏及其后内容的正文。
 */
function trimUnclosedFence(text: string): string {
  const lines = text.split('\n')
  let fence: { readonly char: string; readonly length: number } | undefined
  let openerIndex = -1
  for (let index = 0; index < lines.length; index++) {
    const marker = FENCE_MARKER_RE.exec(lines[index] ?? '')?.[1]
    if (marker === undefined) continue
    const char = marker.charAt(0)
    if (fence === undefined) {
      fence = { char, length: marker.length }
      openerIndex = index
      continue
    }
    if (char === fence.char && marker.length >= fence.length) {
      fence = undefined
      openerIndex = -1
    }
  }
  if (fence === undefined || openerIndex < 0) return text
  return lines.slice(0, openerIndex).join('\n')
}

/**
 * 截断后行号范围要跟着收窄：内容只留了前几行时，来源坐标不能继续声称覆盖整段
 * 选区，否则「路径:起止行」和正文对不上。
 * @param lines - 选区覆盖的原始行号范围。
 * @param kept - 截断后真正引用的正文。
 * @param truncated - 是否发生了截断。
 * @returns 与正文一致的行号范围。
 */
function effectiveLines(lines: LineRange | undefined, kept: string, truncated: boolean): LineRange | undefined {
  if (lines === undefined || !truncated) return lines
  const covered = kept.split('\n').length - 1
  return { start: lines.start, end: Math.min(lines.end, lines.start + covered) }
}

/**
 * 把一次选区构造成输入框载荷：来源坐标永远在最前面，内容在后。
 *
 * - 代码：```` ```绝对路径:12-15 ```` 围栏 + 正文 + 收尾围栏；截断说明放在围栏之后。
 * - 正文（Markdown / 纯文本）：首行 `绝对路径:12-15`，空行，`> ` 引用块内容；
 *   截断说明在最后。
 *
 * @param input - 选区与来源信息。
 * @returns 完整载荷、截断标记与原始字符数。
 */
export function buildQuotePayload(input: QuoteInput): QuotePayload {
  const normalized = normalizeQuoteText(input.text)
  const clipped = clipQuoteText(normalized)
  // 正文：截断点落在未闭合围栏里时回退到围栏开头；全被回退掉时保留截断结果兜底。
  const trimmed = clipped.truncated ? trimUnclosedFence(clipped.text).trimEnd() : clipped.text
  const kept = trimmed === '' ? clipped.text : trimmed
  const lines = effectiveLines(input.lines, kept, clipped.truncated)
  const location = formatLocation(input.path, lines)
  const note = truncatedNote(clipped.truncated, clipped.total)
  if (input.kind === 'code') {
    const fence = fenceFor(kept)
    const body = `${fence}${location}\n${kept}\n${fence}`
    return { text: note === '' ? body : `${body}\n\n${note}`, truncated: clipped.truncated, total: clipped.total }
  }
  // 来源坐标独占首行，内容在其后：模型先看到「哪一行」，再看到「原文」。
  const body = `${location}\n\n${quoteBlock(kept)}`
  return { text: note === '' ? body : `${body}\n\n${note}`, truncated: clipped.truncated, total: clipped.total }
}

/**
 * 插入前的分隔：让引用从新的一段开始，而不是接在已输入的半句话后面。
 *
 * 空草稿不加前缀；草稿在插入点前已经是空行时不重复补空行。
 * @param draft - 当前草稿全文。
 * @param at - 插入点（`captureInsertion()` 的 start）。
 * @returns 需要先插入的前缀（`''`、`'\n'` 或 `'\n\n'`）。
 */
export function insertionPrefix(draft: string, at: number): string {
  const before = draft.slice(0, Math.max(0, Math.min(at, draft.length)))
  if (before.trim() === '') return ''
  if (before.endsWith('\n\n')) return ''
  return before.endsWith('\n') ? '\n' : '\n\n'
}
