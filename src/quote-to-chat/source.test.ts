/**
 * Markdown 源码投影与行号匹配：把「渲染后可见文本」反查回源码行。
 *
 * 覆盖真实预览里会遇到的形态：未解析的 CJK 强调、跨行段落、标题、链接、列表、
 * 代码围栏、行内代码，以及匹配不到时的降级。
 *
 * @module dsh-session-map/quote-to-chat/source.test
 */
import { describe, expect, it } from 'vitest'
import {
  normalizeSelectionForMatch,
  projectMarkdownSource,
  sourceLineRange,
  sourceTextOfLines,
  stripInlineMarkers,
} from './source'

describe('stripInlineMarkers', () => {
  it('drops emphasis, code and escape markers but keeps the visible characters', () => {
    expect(stripInlineMarkers('**粗体** 与 `code` 与 \\*星号\\*')).toBe('粗体 与 code 与 星号')
  })

  it('keeps link and image text and drops their targets', () => {
    expect(stripInlineMarkers('见 [设计文档](https://example.com/a)。')).toBe('见 设计文档。')
    expect(stripInlineMarkers('![截图](shot.png)')).toBe('截图')
  })

  it('keeps autolink URLs and drops ordinary HTML tags', () => {
    expect(stripInlineMarkers('<https://example.com> 与 <b>粗</b>')).toBe('https://example.com 与 粗')
  })
})

describe('projectMarkdownSource', () => {
  it('folds line wrapping into single spaces while remembering source lines', () => {
    const projection = projectMarkdownSource('第一行\n第二行\n\n第三行')
    expect(projection.text).toBe('第一行 第二行 第三行')
    expect(projection.lines).toEqual([1, 1, 1, 1, 2, 2, 2, 2, 4, 4, 4])
  })

  it('removes heading, quote and list markers', () => {
    const projection = projectMarkdownSource('# 标题\n\n> 引用\n\n- 条目一\n- 条目二')
    expect(projection.text).toBe('标题 引用 条目一 条目二')
  })

  it('keeps fenced code content but not the fence lines', () => {
    const projection = projectMarkdownSource('```ts\nconst a = 1\n```')
    expect(projection.text).toBe('const a = 1')
    expect(projection.lines).toEqual([2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2])
  })
})

describe('normalizeSelectionForMatch', () => {
  it('collapses rendered block boundaries into single spaces', () => {
    expect(normalizeSelectionForMatch('第一段\n\n第二段')).toBe('第一段 第二段')
  })
})

describe('sourceLineRange', () => {
  it('maps literal CJK emphasis back to the single source line', () => {
    const source = '**版本提醒**：npm 上最新是 **0.4.0**——Git 工具窗口、技能页都已上架。'
    const selected = '**版本提醒**：npm 上最新是 **0.4.0**——Git 工具窗口、技能页都已上架。'
    expect(sourceLineRange(source, selected)).toEqual({ start: 1, end: 1 })
  })

  it('maps a rendered paragraph back to all of its wrapped source lines', () => {
    const source = '第一行文字继续\n第二行文字继续\n第三行结束。\n\n下一段'
    const selected = '第一行文字继续 第二行文字继续 第三行结束。'
    expect(sourceLineRange(source, selected)).toEqual({ start: 1, end: 3 })
  })

  it('maps a selection spanning two paragraphs to the full line range', () => {
    const source = '第一段。\n\n第二段。'
    const selected = '第一段。\n第二段。'
    expect(sourceLineRange(source, selected)).toEqual({ start: 1, end: 3 })
  })

  it('maps link text back to its source line', () => {
    const source = '详见 [设计文档](https://example.com/doc)。'
    expect(sourceLineRange(source, '详见 设计文档。')).toEqual({ start: 1, end: 1 })
  })

  it('maps a list selection to the list item lines', () => {
    const source = '- 第一条\n- 第二条\n- 第三条'
    expect(sourceLineRange(source, '第二条\n第三条')).toEqual({ start: 2, end: 3 })
  })

  it('does not let a shorter inner fence close a longer outer fence', () => {
    const source = [
      '### 4.2 代码（围栏）',
      '',
      '````',
      '```src/deep/a.ts:12-13',
      'const a = 1',
      '```',
      '````',
      '后续正文。',
    ].join('\n')
    const selected = '4.2 代码（围栏）\n```src/deep/a.ts:12-13\nconst a = 1'
    expect(sourceLineRange(source, selected)).toEqual({ start: 1, end: 5 })
  })

  it('maps fenced code content to its source lines', () => {
    const source = '前言\n\n```ts\nconst a = 1\nconst b = 2\n```\n\n结尾'
    expect(sourceLineRange(source, 'const a = 1\nconst b = 2')).toEqual({ start: 4, end: 5 })
  })

  it('maps inline code content to its source line', () => {
    const source = '运行 `tsc --noEmit` 检查。'
    expect(sourceLineRange(source, '运行 tsc --noEmit 检查。')).toEqual({ start: 1, end: 1 })
  })

  it('degrades to the edge anchors when inline formatting breaks the full match', () => {
    // 选区里混进了一段源码没有的空白形态时，整段匹配失败，但前后两段还能定位。
    const source = '开头段落。\n\n中间 **强调** 结尾。'
    const selected = '开头段落。 中间 强调 结尾。'
    expect(sourceLineRange(source, selected)).toEqual({ start: 1, end: 3 })
  })

  it('returns undefined when the selection is not in the loaded source', () => {
    expect(sourceLineRange('# 只有标题', '别处的一段文字')).toBeUndefined()
    expect(sourceLineRange('', '文本')).toBeUndefined()
    expect(sourceLineRange('文本', '   ')).toBeUndefined()
  })
})

describe('sourceTextOfLines', () => {
  it('returns the source lines with their Markdown formatting intact', () => {
    const source = '第一行\n**第二行**\n\n第三行'
    expect(sourceTextOfLines(source, { start: 2, end: 3 })).toBe('**第二行**\n')
    expect(sourceTextOfLines(source, { start: 1, end: 2 })).toBe('第一行\n**第二行**')
  })

  it('normalizes CRLF and clamps ranges to the file', () => {
    expect(sourceTextOfLines('a\r\nb\r\nc', { start: 2, end: 99 })).toBe('b\nc')
  })

  it('returns undefined for a missing or empty range', () => {
    expect(sourceTextOfLines('a\nb', undefined)).toBeUndefined()
    expect(sourceTextOfLines('a\nb', { start: 9, end: 10 })).toBeUndefined()
    expect(sourceTextOfLines('a\nb', { start: 2, end: 1 })).toBeUndefined()
  })
})
