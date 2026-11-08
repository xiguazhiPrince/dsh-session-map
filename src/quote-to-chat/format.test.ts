/**
 * 引用载荷的纯文本规则：形态识别、地址解析、来源坐标、引用块/围栏构造、
 * 截断与插入分隔。这些都是可以直接断言的字符串行为，因此是回归的主要防线。
 *
 * @module dsh-session-map/quote-to-chat/format.test
 */
import { describe, expect, it } from 'vitest'
import {
  buildQuotePayload,
  clipQuoteText,
  FILE_ADDRESS_PREFIX,
  formatLocation,
  insertionPrefix,
  isMarkdownRenderer,
  lineRangeOf,
  normalizeQuoteText,
  parseFileAddress,
  pathOfFileAddress,
  QUOTE_DIVIDER,
  quoteKindOf,
  SELECTION_LIMIT,
} from './format'

describe('quoteKindOf', () => {
  it('recognizes the Markdown and plain-text renderers as prose', () => {
    expect(quoteKindOf('@deepseek-ai/dsh-client-ui-sidebar-documentpreview/markdown')).toBe('prose')
    expect(quoteKindOf('@deepseek-ai/dsh-client-ui-sidebar-documentpreview/text')).toBe('prose')
  })

  it('recognizes the code renderer', () => {
    expect(quoteKindOf('@deepseek-ai/dsh-client-ui-sidebar-documentpreview/code')).toBe('code')
  })

  it('rejects renderers without selectable source text', () => {
    expect(quoteKindOf('@deepseek-ai/dsh-client-ui-sidebar-documentpreview/html')).toBeUndefined()
    expect(quoteKindOf('@deepseek-ai/dsh-client-ui-sidebar-documentpreview/pdf')).toBeUndefined()
    expect(quoteKindOf('')).toBeUndefined()
    expect(quoteKindOf(null)).toBeUndefined()
    expect(quoteKindOf(undefined)).toBeUndefined()
  })
})

describe('pathOfFileAddress', () => {
  it('decodes a session file address into a workspace-relative path', () => {
    expect(pathOfFileAddress(`${FILE_ADDRESS_PREFIX}session/session-1/src/deep/a.ts`)).toBe('src/deep/a.ts')
  })

  it('decodes per-segment escapes so spaces and quotes come back as themselves', () => {
    expect(pathOfFileAddress(`${FILE_ADDRESS_PREFIX}session/s1/docs/read%20me.md`)).toBe('docs/read me.md')
    expect(pathOfFileAddress(`${FILE_ADDRESS_PREFIX}session/s1/docs/a%22b.md`)).toBe('docs/a"b.md')
  })

  it('rejects addresses this plugin cannot turn into a path', () => {
    expect(pathOfFileAddress(undefined)).toBeUndefined()
    expect(pathOfFileAddress('')).toBeUndefined()
    expect(pathOfFileAddress('dsh-resource://file/absolute/Downloads/a.png')).toBeUndefined()
    expect(pathOfFileAddress(`${FILE_ADDRESS_PREFIX}session/s1`)).toBeUndefined()
    expect(pathOfFileAddress(`${FILE_ADDRESS_PREFIX}session/s1/`)).toBeUndefined()
  })
})

describe('parseFileAddress', () => {
  it('returns both the content session and the decoded relative path', () => {
    expect(parseFileAddress(`${FILE_ADDRESS_PREFIX}session/session-9/docs/a%20b.md`)).toEqual({
      sessionId: 'session-9',
      path: 'docs/a b.md',
    })
  })

  it('rejects a non-session or incomplete address', () => {
    expect(parseFileAddress(undefined)).toBeUndefined()
    expect(parseFileAddress(`${FILE_ADDRESS_PREFIX}absolute/x/y`)).toBeUndefined()
    expect(parseFileAddress(`${FILE_ADDRESS_PREFIX}session//a.md`)).toBeUndefined()
    expect(parseFileAddress(`${FILE_ADDRESS_PREFIX}session/s1`)).toBeUndefined()
  })
})

describe('isMarkdownRenderer', () => {
  it('recognizes only the Markdown previewer', () => {
    expect(isMarkdownRenderer('@deepseek-ai/dsh-client-ui-sidebar-documentpreview/markdown')).toBe(true)
    expect(isMarkdownRenderer('@deepseek-ai/dsh-client-ui-sidebar-documentpreview/text')).toBe(false)
    expect(isMarkdownRenderer('@deepseek-ai/dsh-client-ui-sidebar-documentpreview/code')).toBe(false)
    expect(isMarkdownRenderer(undefined)).toBe(false)
  })
})

describe('formatLocation', () => {
  it('writes the path alone when the renderer exposes no line numbers', () => {
    expect(formatLocation('src/a.ts')).toBe('src/a.ts')
  })

  it('writes a single line as path:line and a range as path:start-end', () => {
    expect(formatLocation('src/a.ts', { start: 12, end: 12 })).toBe('src/a.ts:12')
    expect(formatLocation('src/a.ts', { start: 12, end: 15 })).toBe('src/a.ts:12-15')
  })

  it('normalizes a reversed or fractional range', () => {
    expect(formatLocation('a.ts', { start: 9.7, end: 4.2 })).toBe('a.ts:9')
  })
})

describe('lineRangeOf', () => {
  it('returns a usable range in ascending order', () => {
    expect(lineRangeOf(3, 7)).toEqual({ start: 3, end: 7 })
    expect(lineRangeOf(7, 3)).toEqual({ start: 3, end: 7 })
  })

  it('treats a missing or out-of-range endpoint as unknown', () => {
    expect(lineRangeOf(undefined, 3)).toBeUndefined()
    expect(lineRangeOf(3, undefined)).toBeUndefined()
    expect(lineRangeOf(0, 3)).toBeUndefined()
    expect(lineRangeOf(Number.NaN, 3)).toBeUndefined()
  })
})

describe('normalizeQuoteText', () => {
  it('normalizes line endings and trims blank edges', () => {
    expect(normalizeQuoteText('\r\n\r\nabc\r\ndef\r\n\r\n')).toBe('abc\ndef')
  })

  it('strips trailing whitespace per line but keeps leading indentation', () => {
    expect(normalizeQuoteText('    indented   \n\tnext\t')).toBe('    indented\n\tnext')
  })

  it('keeps an interior blank line', () => {
    expect(normalizeQuoteText('a\n\n\nb')).toBe('a\n\n\nb')
  })
})

describe('QUOTE_DIVIDER', () => {
  it('leaves a blank line under the horizontal rule for the follow-up input', () => {
    expect(QUOTE_DIVIDER).toBe('\n\n---\n\n')
  })
})

describe('SELECTION_LIMIT', () => {
  it('is the agreed 100 characters', () => {
    expect(SELECTION_LIMIT).toBe(100)
  })
})

describe('clipQuoteText', () => {
  it('leaves text under the limit untouched', () => {
    expect(clipQuoteText('abc', 10)).toEqual({ text: 'abc', truncated: false, total: 3 })
  })

  it('cuts at a line boundary in the second half of the limit', () => {
    const text = 'aaaaaaaaaa\nbbbbbbbbbb\ncccccccccc'
    const clipped = clipQuoteText(text, 24)
    expect(clipped.truncated).toBe(true)
    expect(clipped.text).toBe('aaaaaaaaaa\nbbbbbbbbbb')
    expect(clipped.total).toBe(text.length)
  })

  it('hard-cuts when no line boundary is available', () => {
    expect(clipQuoteText('abcdefghij', 4)).toEqual({ text: 'abcd', truncated: true, total: 10 })
  })
})

describe('buildQuotePayload', () => {
  it('puts the absolute location on the first line, then the quoted content', () => {
    const payload = buildQuotePayload({
      kind: 'prose',
      text: 'const a = 1\n\n第二段',
      path: '/Users/me/repo/src/a.ts',
      lines: { start: 12, end: 14 },
    })
    expect(payload.truncated).toBe(false)
    expect(payload.text).toBe('/Users/me/repo/src/a.ts:12-14\n\n> const a = 1\n>\n> 第二段')
  })

  it('unwraps source blockquotes instead of nesting them', () => {
    const payload = buildQuotePayload({
      kind: 'prose',
      text: '> **版本提醒**：npm 上最新是 0.4.0。\n> 第二行',
      path: '/repo/README.md',
      lines: { start: 86, end: 87 },
    })
    expect(payload.text).toBe(
      '/repo/README.md:86-87\n\n> **版本提醒**：npm 上最新是 0.4.0。\n> 第二行',
    )
  })

  it('keeps the location line but drops line numbers when the renderer exposed none', () => {
    const payload = buildQuotePayload({ kind: 'prose', text: '一段话', path: '/Users/me/repo/docs/a.md' })
    expect(payload.text).toBe('/Users/me/repo/docs/a.md\n\n> 一段话')
  })

  it('wraps code in a fence whose info line is the source coordinate', () => {
    const payload = buildQuotePayload({
      kind: 'code',
      text: 'const a = 1\nconst b = 2',
      path: 'src/a.ts',
      lines: { start: 12, end: 13 },
    })
    expect(payload.text).toBe('```src/a.ts:12-13\nconst a = 1\nconst b = 2\n```')
  })

  it('lengthens the fence when the code itself contains a fence', () => {
    const payload = buildQuotePayload({ kind: 'code', text: '```\ninner\n```', path: 'a.md' })
    expect(payload.text).toBe('````a.md\n```\ninner\n```\n````')
  })

  it('narrows the location to the lines actually quoted after truncation', () => {
    const text = Array.from({ length: 20 }, (_, index) => `第${index + 1}行内容，这一行更长一点`).join('\n')
    const clipped = clipQuoteText(text)
    const covered = clipped.text.split('\n').length - 1
    const payload = buildQuotePayload({
      kind: 'prose',
      text,
      path: '/repo/a.md',
      lines: { start: 12, end: 31 },
    })
    expect(clipped.truncated).toBe(true)
    expect(payload.truncated).toBe(true)
    expect(payload.text.startsWith(`${formatLocation('/repo/a.md', { start: 12, end: 12 + covered })}\n\n`)).toBe(true)
  })

  it('never ends the quote inside an unclosed code fence', () => {
    const text = `${'x'.repeat(95)}\n\`\`\`\nconst a = 1`
    const payload = buildQuotePayload({ kind: 'prose', text, path: '/repo/a.md', lines: { start: 1, end: 5 } })
    expect(payload.text).not.toContain('\`\`\`')
  })

  it('appends an explicit truncation note instead of dropping content silently', () => {
    const payload = buildQuotePayload({ kind: 'prose', text: 'x'.repeat(SELECTION_LIMIT + 10), path: 'a.md' })
    expect(payload.truncated).toBe(true)
    expect(payload.total).toBe(SELECTION_LIMIT + 10)
    expect(payload.text).toContain(`（选区过长，已截断：原文共 ${SELECTION_LIMIT + 10} 字）`)
  })
})

describe('insertionPrefix', () => {
  it('adds nothing in front of an empty or whitespace-only draft', () => {
    expect(insertionPrefix('', 0)).toBe('')
    expect(insertionPrefix('   ', 3)).toBe('')
  })

  it('starts a fresh paragraph after a half-written line', () => {
    expect(insertionPrefix('解释这段代码', 6)).toBe('\n\n')
  })

  it('does not stack blank lines', () => {
    expect(insertionPrefix('abc\n', 4)).toBe('\n')
    expect(insertionPrefix('abc\n\n', 5)).toBe('')
  })

  it('only looks before the insertion point', () => {
    expect(insertionPrefix('abc', 0)).toBe('')
  })
})
