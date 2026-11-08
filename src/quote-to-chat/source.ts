/**
 * 把 Markdown 预览里的选区映射回源码行号，并把内容换成源码原文。
 *
 * Markdown 预览渲染的是 HTML：`#`、`**`、链接目标、列表标记都不在 DOM 里，
 * 因此 DOM 本身给不出行号。这里走反方向：把**源码**投影成「渲染后的可见
 * 文本 + 每个字符的源码行号」，再用同一套规则投影选区，做一次子串匹配。
 *
 * 投影规则与 `project.ts` 的 DOM 投影对齐：
 * - 行内标记（`**` `_` `` ` `` `~~`）不可见，去掉；转义字符保留被转义的那个；
 * - 链接/图片只保留可见文本，自动链接保留 URL；
 * - 行首的标题/引用/列表标记去掉；表格竖线变成空格；
 * - 代码围栏行本身不可见，块内代码原样保留；
 * - 分隔线（`---`、`***`、表格分隔行）不产生文本；
 * - 所有空白折叠成一个空格（渲染后的段落换行、DOM 块边界都表现为空白）。
 *
 * 匹配失败时退回「前后两段文字」定位；仍然失败就返回 `undefined`，由调用方
 * 降级为不带行号。
 *
 * @module dsh-session-map/quote-to-chat/source
 */

import { lineRangeOf, type LineRange } from './format'

/** 源码投影：匹配用文本 + 每个字符对应的 1-based 源码行号。 */
export interface SourceProjection {
  /** 折叠空白后的可见文本。 */
  readonly text: string
  /** 与 `text` 等长的源码行号。 */
  readonly lines: readonly number[]
}

/** 代码围栏的开头/结尾标记：三个以上的反引号或波浪线。 */
const FENCE_LINE_RE = /^\s{0,3}(`{3,}|~{3,})/u

/** 分隔线 / setext 下划线：渲染后没有对应文本。 */
const RULE_LINE_RE = /^\s{0,3}([-=*_])(?:\s*\1){2,}\s*$/u

/** 表格分隔行（`| --- | :--: |`）。 */
const TABLE_SEPARATOR_RE = /^\s*\|?[\s:|-]+\|?\s*$/u

/** 标题标记。 */
const HEADING_RE = /^\s{0,3}#{1,6}\s+/u

/** 引用标记；可能连续多层。 */
const BLOCKQUOTE_RE = /^\s{0,3}>\s?/u

/** 列表项标记。 */
const LIST_MARKER_RE = /^\s{0,3}(?:[-*+]|\d{1,9}[.)])\s+/u

/** 自动链接：保留 URL 本身。 */
const AUTOLINK_RE = /<((?:https?|mailto):[^>]*)>/giu

/** 普通 HTML 标签：渲染后没有文本。 */
const HTML_TAG_RE = /<\/?[a-zA-Z][^>]*>/gu

/** 行内代码/强调标记本身。 */
const INLINE_MARK_RE = /[*_~`]/gu

/** 转义序列：反斜杠不可见。 */
const ESCAPE_RE = /\\([\\`*_{}[\]()#+.!~-])/gu

/** 是否空白字符。 */
function isSpace(char: string): boolean {
  return char === ' ' || char === '\t' || char === '\n' || char === '\r'
}

/**
 * 去掉 Markdown 行内标记，只留下渲染后能看见的字符。
 *
 * 同一函数同时用于源码与选区文本：有些 CJK 场景下强调标记不会被解析（例如
 * `**文本**：`），两边同时保留/去掉同样的字符，匹配才不会因为解析差异而失败。
 * @param text - 源码行或选区文本。
 * @returns 去掉不可见标记后的文本。
 */
export function stripInlineMarkers(text: string): string {
  let value = text
  // 图片与链接只保留可见文本（引用式链接同理）。
  value = value.replace(/!?\[([^\]]*)\]\([^)]*\)/gu, '$1')
  value = value.replace(/!?\[([^\]]*)\]\[[^\]]*\]/gu, '$1')
  value = value.replace(AUTOLINK_RE, '$1')
  value = value.replace(HTML_TAG_RE, '')
  value = value.replace(ESCAPE_RE, '$1')
  value = value.replace(INLINE_MARK_RE, '')
  return value
}

/**
 * 把字符序列折叠成「空白单空格」的投影，同时保留每个字符的源码行号。
 * @param chars - 原始字符序列。
 * @param lineNumbers - 与 `chars` 等长的行号。
 * @returns 折叠后的投影。
 */
function collapse(chars: readonly string[], lineNumbers: readonly number[]): SourceProjection {
  const text: string[] = []
  const lines: number[] = []
  let previousSpace = false
  for (let index = 0; index < chars.length; index++) {
    const char = chars[index] ?? ''
    const line = lineNumbers[index] ?? 1
    if (isSpace(char)) {
      if (text.length === 0 || previousSpace) continue
      text.push(' ')
      lines.push(line)
      previousSpace = true
      continue
    }
    text.push(char)
    lines.push(line)
    previousSpace = false
  }
  // 去掉尾部空格，匹配时不会因为边界空白产生偏移。
  if (previousSpace && text.length > 0) {
    text.pop()
    lines.pop()
  }
  return { text: text.join(''), lines }
}

/**
 * 把 Markdown 源码投影成「可见文本 + 行号」。
 * @param source - 文件源码（可以只是已加载的前若干页）。
 * @returns 源码投影。
 */
export function projectMarkdownSource(source: string): SourceProjection {
  const rawLines = source.replace(/\r\n?/gu, '\n').split('\n')
  const chars: string[] = []
  const lineNumbers: number[] = []
  // 当前打开的围栏：字符与长度。CommonMark 里只有「同字符、长度不短于开启」
  // 的围栏才能关闭它，否则短围栏行只是外层围栏里的代码内容（文档里常这样
  // 嵌套示例代码）。
  let fence: { readonly char: string; readonly length: number } | undefined
  for (let index = 0; index < rawLines.length; index++) {
    const raw = rawLines[index] ?? ''
    const lineNumber = index + 1
    const marker = FENCE_LINE_RE.exec(raw)?.[1]
    if (marker !== undefined) {
      const char = marker.charAt(0)
      if (fence === undefined) {
        fence = { char, length: marker.length }
        chars.push(' ')
        lineNumbers.push(lineNumber)
        continue
      }
      if (char === fence.char && marker.length >= fence.length) {
        fence = undefined
        chars.push(' ')
        lineNumbers.push(lineNumber)
        continue
      }
      // 更短/不同字符的围栏行属于代码内容，继续往下按正文处理。
    }
    const inFence = fence !== undefined
    if (!inFence && (RULE_LINE_RE.test(raw) || TABLE_SEPARATOR_RE.test(raw))) {
      chars.push(' ')
      lineNumbers.push(lineNumber)
      continue
    }
    let body = raw
    if (!inFence) {
      body = body.replace(HEADING_RE, '')
      while (BLOCKQUOTE_RE.test(body)) body = body.replace(BLOCKQUOTE_RE, '')
      body = body.replace(LIST_MARKER_RE, '')
      body = body.replace(/\|/gu, ' ')
    }
    body = stripInlineMarkers(body)
    // 按 UTF-16 code unit 逐位入表：`text` 的 `indexOf` 下标就是 code unit
    // 下标，行号表必须与之等长，否则 emoji 之类的代理对会让行号整体漂移。
    for (let offset = 0; offset < body.length; offset++) {
      chars.push(body[offset] ?? '')
      lineNumbers.push(lineNumber)
    }
    // 行尾换成空格：段落内的换行在渲染后表现为空白，而不是换行。
    chars.push(' ')
    lineNumbers.push(lineNumber)
  }
  return collapse(chars, lineNumbers)
}

/**
 * 把选区文本投影成与源码投影同构的匹配串。
 * @param selected - 从 DOM 投影出的可见文本。
 * @returns 折叠空白后的匹配串。
 */
export function normalizeSelectionForMatch(selected: string): string {
  const chars = [...stripInlineMarkers(selected.replace(/\r\n?/gu, '\n'))]
  const lineNumbers = chars.map(() => 1)
  return collapse(chars, lineNumbers).text
}

/**
 * 在投影文本里找某个下标最近的「非空白字符」所在行。
 * @param projection - 源码投影。
 * @param index - 起点下标。
 * @param backward - 是否向前（下标递减）搜索。
 * @returns 行号；找不到时为 `undefined`。
 */
function edgeLine(projection: SourceProjection, index: number, backward: boolean): number | undefined {
  const step = backward ? -1 : 1
  for (let cursor = index; cursor >= 0 && cursor < projection.text.length; cursor += step) {
    if (!isSpace(projection.text[cursor] ?? '')) return projection.lines[cursor]
  }
  return undefined
}

/**
 * 把投影区间换算成源码行号范围。
 * @param projection - 源码投影。
 * @param start - 匹配起点下标。
 * @param end - 匹配终点下标（含）。
 * @returns 行号范围。
 */
function rangeOf(projection: SourceProjection, start: number, end: number): LineRange | undefined {
  return lineRangeOf(edgeLine(projection, start, false), edgeLine(projection, end, true))
}

/**
 * 用前后两段文字定位：整段匹配不上时（选区里混进了未解析的行内标记等），
 * 用开头/结尾片段各找一个位置。
 * @param projection - 源码投影。
 * @param needle - 归一化后的选区。
 * @returns 行号范围。
 */
function locateByEdges(projection: SourceProjection, needle: string): LineRange | undefined {
  const edge = Math.min(40, needle.length)
  if (edge < 6) return undefined
  const head = needle.slice(0, edge)
  const headAt = projection.text.indexOf(head)
  if (headAt < 0) return undefined
  const startLine = edgeLine(projection, headAt, false)
  const tail = needle.slice(-edge)
  const tailAt = projection.text.indexOf(tail, headAt + head.length)
  const endLine = tailAt < 0 ? startLine : edgeLine(projection, tailAt + tail.length - 1, true)
  return lineRangeOf(startLine, endLine)
}

/**
 * 把选中的可见文本映射回源码行号。
 * @param source - 文件源码（已加载的部分即可）。
 * @param selected - 从 DOM 投影出的选区文本。
 * @returns 行号范围；匹配不到时为 `undefined`。
 */
export function sourceLineRange(source: string, selected: string): LineRange | undefined {
  const projection = projectMarkdownSource(source)
  const needle = normalizeSelectionForMatch(selected)
  if (needle === '') return undefined
  const at = projection.text.indexOf(needle)
  if (at >= 0) return rangeOf(projection, at, at + needle.length - 1)
  return locateByEdges(projection, needle)
}

/**
 * 取源码里某段行号范围的原文（保留 Markdown 标记与缩进）。
 * @param source - 文件源码。
 * @param lines - 1-based 行号范围。
 * @returns 源码原文；范围无效时为 `undefined`。
 */
export function sourceTextOfLines(source: string, lines: LineRange | undefined): string | undefined {
  if (lines === undefined) return undefined
  const rawLines = source.replace(/\r\n?/gu, '\n').split('\n')
  const start = Math.max(1, Math.trunc(lines.start))
  const end = Math.min(rawLines.length, Math.trunc(lines.end))
  if (start > end) return undefined
  const text = rawLines.slice(start - 1, end).join('\n')
  return text === '' ? undefined : text
}
