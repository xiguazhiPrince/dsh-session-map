/**
 * 从预览 DOM 里读回选区的源码行号。
 *
 * 预览的两种可引用渲染器各自暴露了行号：
 * - 纯文本渲染器：每个行元素带 `data-textpreview-line`（页偏移后的绝对行号），
 *   产品自己的滚动定位也用它；
 * - 代码渲染器：每一行是 `pre .line`，产品自己的「跳到第 N 行」就是按这个
 *   顺序索引（`querySelectorAll("pre .line").item(line - 1)`），所以这里用同
 *   一套索引；
 * - Markdown 渲染器把源码渲染成了 HTML，行号与源码没有稳定映射，因此不给
 *   行号（来源行只写路径）。
 *
 * DOM 依赖被收成两个最小接口（{@link ElementLike}、{@link QueryRootLike}），
 * 真实元素结构上满足它们，单测可以用普通对象搭树。
 *
 * @module dsh-session-map/quote-to-chat/dom
 */

import { lineRangeOf, type LineRange, type QuoteKind } from './format'

/** 读行号需要的元素切片；真实的 `Element` 结构上满足它。 */
export interface ElementLike {
  readonly parentElement: ElementLike | null
  readonly previousElementSibling: ElementLike | null
  getAttribute(name: string): string | null
  matches(selector: string): boolean
}

/** 能按选择器枚举元素的根（`Element` 满足它）。 */
export interface QueryRootLike {
  querySelectorAll(selector: string): ArrayLike<ElementLike>
}

/** 纯文本渲染器的行号属性。 */
const PLAIN_LINE_ATTRIBUTE = 'data-textpreview-line'

/** 代码行的结构选择器：与产品自己跳行时的选择器保持一致。 */
const CODE_LINE_SELECTOR = '.line'

/** 代码行在根内的枚举选择器。 */
const CODE_LINES_QUERY = 'pre .line'

/**
 * 把一个未知节点抬成元素：元素返回自身，文本/注释节点返回其父元素。
 * @param node - 任意 DOM 节点。
 * @returns 元素切片，或 `null`。
 */
function asElement(node: unknown): ElementLike | null {
  if (node === null || typeof node !== 'object') return null
  const candidate = node as { getAttribute?: unknown; parentElement?: ElementLike | null }
  if (typeof candidate.getAttribute === 'function') return node as ElementLike
  return candidate.parentElement ?? null
}

/**
 * 读取元素上的 1-based 行号。
 * @param element - 行元素。
 * @returns 行号；元素不存在或属性非法时为 `undefined`。
 */
function lineNumberOf(element: ElementLike | null): number | undefined {
  if (element === null) return undefined
  const value = element.getAttribute(PLAIN_LINE_ATTRIBUTE)
  if (value === null || !/^\d+$/u.test(value)) return undefined
  const line = Number(value)
  return line > 0 ? line : undefined
}

/**
 * 找最近的、带源码行号的祖先行元素（纯文本渲染器）。
 * @param node - 选区端点。
 * @returns 行元素，或 `null`。
 */
function plainRowOf(node: unknown): ElementLike | null {
  let element = asElement(node)
  while (element !== null) {
    const line = element.getAttribute(PLAIN_LINE_ATTRIBUTE)
    if (line !== null) return element
    element = element.parentElement
  }
  return null
}

/** 上一个带行号的兄弟行（跨过行内的其它元素）。 */
function previousPlainRow(row: ElementLike | null): ElementLike | null {
  let sibling = row?.previousElementSibling ?? null
  while (sibling !== null) {
    if (sibling.getAttribute(PLAIN_LINE_ATTRIBUTE) !== null) return sibling
    sibling = sibling.previousElementSibling
  }
  return null
}

/**
 * 找最近的代码行元素。
 * @param node - 选区端点。
 * @returns `.line` 元素，或 `null`。
 */
function codeLineOf(node: unknown): ElementLike | null {
  let element = asElement(node)
  while (element !== null) {
    if (element.matches(CODE_LINE_SELECTOR)) return element
    element = element.parentElement
  }
  return null
}

/** 上一个代码行兄弟（跨过行内的 token 元素）。 */
function previousCodeLine(line: ElementLike | null): ElementLike | null {
  let sibling = line?.previousElementSibling ?? null
  while (sibling !== null) {
    if (sibling.matches(CODE_LINE_SELECTOR)) return sibling
    sibling = sibling.previousElementSibling
  }
  return null
}

/**
 * 代码行在根内的 1-based 行号。
 * @param root - 代码内容的容器（`[data-code-block-content]`）。
 * @param line - 行元素。
 * @returns 行号；不在枚举里时为 `undefined`。
 */
function codeLineNumberOf(root: QueryRootLike | null, line: ElementLike | null): number | undefined {
  if (root === null || line === null) return undefined
  const rows = root.querySelectorAll(CODE_LINES_QUERY)
  for (let index = 0; index < rows.length; index++) {
    if (rows[index] === line) return index + 1
  }
  return undefined
}

/** 选区是否结束在某一行的第 0 个字符之前（此时最后一字符属于上一行）。 */
function endsBeforeContent(range: Range): boolean {
  return range.endOffset === 0
}

/**
 * 解析一个选区覆盖的源码行号范围。
 *
 * 端点落在行首时（`endOffset === 0`）回退到上一行：用户把选区拖到下一行开头，
 * 实际引用的是上一行的末尾。
 *
 * @param range - 浏览器选区。
 * @param kind - 引用形态（决定按哪种行号来源读取）。
 * @param codeRoot - 代码内容容器，仅代码形态需要。
 * @returns 行号范围；渲染器不暴露行号或解析失败时为 `undefined`。
 */
export function selectionLineRange(
  range: Range,
  kind: QuoteKind,
  codeRoot: QueryRootLike | null,
): LineRange | undefined {
  if (kind === 'prose') {
    const start = lineNumberOf(plainRowOf(range.startContainer))
    let endRow = plainRowOf(range.endContainer)
    if (endsBeforeContent(range)) {
      const previous = previousPlainRow(endRow)
      if (previous !== null) endRow = previous
    }
    return lineRangeOf(start, lineNumberOf(endRow))
  }
  const start = codeLineNumberOf(codeRoot, codeLineOf(range.startContainer))
  let endLine = codeLineOf(range.endContainer)
  if (endsBeforeContent(range)) {
    const previous = previousCodeLine(endLine)
    if (previous !== null) endLine = previous
  }
  return lineRangeOf(start, codeLineNumberOf(codeRoot, endLine))
}
