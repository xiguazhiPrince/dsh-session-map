/**
 * 把一段 DOM 片段投影成「看得见的文本」。
 *
 * 浏览器自带的 `Selection.toString()` 会带上渲染器的装饰与块边界差异，跨
 * 渲染器不稳定：纯文本预览的每一行自带 `\n`，代码预览的每一行是独立的
 * block 元素（没有 `\n` 字符），Markdown 预览则是一堆段落。这个模块用一条
 * 明确的规则把它们统一：
 *
 * - 文本节点原样拼接；
 * - `<br>` 记一个换行；
 * - 代码预览的行（`.line`）之间补一个换行，空行因此不会丢；
 * - 纯文本预览的行（`[data-textpreview-line]`）已自带换行，直接拼接；
 * - 其余块级元素（段落、列表项、标题、表格行……）之间补一个换行；
 * - 被隐藏、惰性或标注了 `data-text-interaction-exclude` 的子树整段跳过。
 *
 * 逻辑只依赖结构化的最小 DOM 接口，因此单测可以用普通对象搭出一棵树。
 *
 * @module dsh-session-map/quote-to-chat/project
 */

import type { QuoteKind } from './format'

/** 投影需要的 DOM 切片；真实的 `Node` 结构上满足它。 */
export interface DomNodeLike {
  /** `Node.nodeType`；3 是文本节点。 */
  readonly nodeType: number
  /** 文本节点的内容。 */
  readonly data?: string | undefined
  /** 元素节点的标签名（HTML 下是大写）。 */
  readonly tagName?: string | undefined
  /** HTML 元素的 class 字符串；SVG 等为对象，这里只认字符串。 */
  readonly className?: unknown
  readonly childNodes?: ArrayLike<DomNodeLike> | undefined
  getAttribute?(name: string): string | null | undefined
}

/** 文本节点标记，与 DOM 的 `Node.TEXT_NODE` 对齐。 */
const TEXT_NODE = 3

/** 项目符号/分栏等块级标签：它们之间需要一个换行。 */
const BLOCK_TAGS = new Set([
  'ADDRESS', 'ARTICLE', 'ASIDE', 'BLOCKQUOTE', 'CAPTION', 'DD', 'DETAILS', 'DIV', 'DL', 'DT',
  'FIELDSET', 'FIGCAPTION', 'FIGURE', 'FOOTER', 'FORM', 'H1', 'H2', 'H3', 'H4', 'H5', 'H6',
  'HEADER', 'HR', 'LI', 'MAIN', 'NAV', 'OL', 'P', 'PRE', 'SECTION', 'SUMMARY', 'TABLE', 'TBODY',
  'TD', 'TFOOT', 'TH', 'THEAD', 'TR', 'UL',
])

/** 元素是否处在一个「不可引用」的子树上。 */
function excluded(node: DomNodeLike): boolean {
  const getAttribute = node.getAttribute
  if (getAttribute === undefined) return false
  const hidden = getAttribute.call(node, 'hidden')
  if (hidden !== null && hidden !== undefined) return true
  const inert = getAttribute.call(node, 'inert')
  if (inert !== null && inert !== undefined) return true
  const excludedFlag = getAttribute.call(node, 'data-text-interaction-exclude')
  if (excludedFlag !== null && excludedFlag !== undefined) return true
  // 代码块横幅是渲染器 chrome（语言标签、复制/换行按钮），不是正文：
  // Markdown 预览的选区里混进「代码块」这类标签会让源码映射匹配不上。
  const banner = getAttribute.call(node, 'data-code-block-banner')
  if (banner !== null && banner !== undefined) return true
  return getAttribute.call(node, 'aria-hidden') === 'true'
}

/** 元素的 class 是否含有给定的 token。 */
function hasClassToken(node: DomNodeLike, token: string): boolean {
  const className = node.className
  if (typeof className !== 'string') return false
  return className.split(/\s+/u).includes(token)
}

/** 代码预览的一行（产品的 CodeBlock 用 `.line` 包一行源码）。 */
function isCodeLine(node: DomNodeLike): boolean {
  return (node.tagName ?? '').toUpperCase() === 'SPAN' && hasClassToken(node, 'line')
}

/** 纯文本预览的一行（产品在行元素上标了 1-based 源码行号）。 */
function isPlainRow(node: DomNodeLike): boolean {
  const line = node.getAttribute?.('data-textpreview-line')
  return line !== null && line !== undefined
}

/** 元素是否为块级：标签在块级集合里，或属于两种预览的行。 */
function isBlock(node: DomNodeLike): boolean {
  if (node.nodeType !== 1) return false
  return BLOCK_TAGS.has((node.tagName ?? '').toUpperCase()) || isCodeLine(node) || isPlainRow(node)
}

/** 元素节点的子节点列表（文本节点为空）。 */
function childrenOf(node: DomNodeLike): DomNodeLike[] {
  if (node.childNodes === undefined) return []
  return Array.from(node.childNodes)
}

/**
 * 按块边界拼接一组兄弟节点：块级兄弟之间补一个换行，文本节点直接相连。
 * @param children - 兄弟节点。
 * @returns 拼接后的文本。
 */
function projectChildren(children: DomNodeLike[]): string {
  let text = ''
  let previous: DomNodeLike | null = null
  for (const child of children) {
    const piece = project(child)
    if (piece !== '' && previous !== null && text !== '') {
      const block = isBlock(child) || isBlock(previous)
      if (block && !text.endsWith('\n') && !piece.startsWith('\n')) text += '\n'
    }
    text += piece
    if (piece !== '') previous = child
  }
  return text
}

/**
 * 投影一个节点。
 * @param node - 片段或子树。
 * @returns 可见文本；行尾为 `\n`，未经裁剪。
 */
function project(node: DomNodeLike): string {
  if (node.nodeType === TEXT_NODE) return node.data ?? ''
  if (node.nodeType !== 1) {
    // 文档片段（nodeType 11）没有标签，但同级块边界规则与元素一致。
    return projectChildren(childrenOf(node))
  }
  if (excluded(node)) return ''
  if ((node.tagName ?? '').toUpperCase() === 'BR') return '\n'
  const children = childrenOf(node)
  if (children.length === 0) return ''
  // 纯文本预览：行自带换行，拼起来即可（空行也是 `\n`）。
  if (children.every(isPlainRow)) return children.map(child => project(child)).join('')
  // 代码预览：每行是独立元素、自身不带换行，用换行连接（空行因此保留）。
  if (children.every(isCodeLine)) return children.map(child => project(child)).join('\n')
  return projectChildren(children)
}

/**
 * 把一个选区克隆出来的片段投影成可引用文本。
 * @param fragment - `Range.cloneContents()` 的结果（或任意子树）。
 * @returns 可见文本；行尾为 `\n`，首尾空行未裁剪。
 */
export function projectVisibleText(fragment: DomNodeLike): string {
  return project(fragment)
}

/**
 * 选区文本的投影入口：片段 → 文本。
 *
 * 投影规则按结构自适应，两种形态走同一套规则；`kind` 参数保留给未来分形态
 * 微调（例如给 Markdown 保留空行）。
 * @param fragment - 选区克隆片段。
 * @param _kind - 引用形态。
 * @returns 可见文本。
 */
export function projectSelectionText(fragment: DomNodeLike, _kind: QuoteKind): string {
  return project(fragment)
}
