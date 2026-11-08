/**
 * DOM 投影规则：块边界、<br>、代码行/纯文本行的换行、以及被标注为不可引用的
 * 子树。用普通对象搭一棵最小 DOM 树来断言，不依赖浏览器环境。
 *
 * @module dsh-session-map/quote-to-chat/project.test
 */
import { describe, expect, it } from 'vitest'
import { projectSelectionText, projectVisibleText, type DomNodeLike } from './project'

/** 造一个元素节点。 */
function el(
  tagName: string,
  options: { readonly className?: string; readonly attrs?: Record<string, string> } = {},
  children: readonly DomNodeLike[] = [],
): DomNodeLike {
  const attrs = options.attrs ?? {}
  return {
    nodeType: 1,
    tagName,
    className: options.className,
    childNodes: children,
    getAttribute: (name: string) => (name in attrs ? attrs[name] ?? '' : null),
  }
}

/** 造一个文本节点。 */
function txt(data: string): DomNodeLike {
  return { nodeType: 3, data }
}

/** 造一个文档片段（nodeType 11）。 */
function fragment(children: readonly DomNodeLike[]): DomNodeLike {
  return { nodeType: 11, childNodes: children }
}

/** 造一个代码行（产品 CodeBlock 的 `.line`）。 */
function codeLine(contents: readonly DomNodeLike[]): DomNodeLike {
  return el('SPAN', { className: 'line' }, contents)
}

/** 造一个纯文本预览行（自带行号属性，行尾带显式换行）。 */
function plainRow(line: number, text: string): DomNodeLike {
  return el('DIV', { attrs: { 'data-textpreview-line': String(line) } }, [txt(text), txt('\n')])
}

describe('projectVisibleText', () => {
  it('concatenates text and inline elements without adding breaks', () => {
    const tree = el('DIV', {}, [txt('const '), el('SPAN', {}, [txt('a')]), txt(' = 1')])
    expect(projectVisibleText(tree)).toBe('const a = 1')
  })

  it('separates block siblings with one newline', () => {
    const tree = el('DIV', {}, [el('P', {}, [txt('first')]), el('P', {}, [txt('second')])])
    expect(projectVisibleText(tree)).toBe('first\nsecond')
  })

  it('turns a <br> into a newline', () => {
    const tree = el('P', {}, [txt('a'), el('BR'), txt('b')])
    expect(projectVisibleText(tree)).toBe('a\nb')
  })

  it('joins code lines with newlines and keeps empty lines', () => {
    const tree = el('CODE', {}, [codeLine([txt('a')]), codeLine([]), codeLine([txt('b')])])
    expect(projectVisibleText(tree)).toBe('a\n\nb')
  })

  it('keeps code lines that tokenize into nested spans', () => {
    const tree = el('CODE', {}, [
      codeLine([el('SPAN', {}, [txt('const')]), txt(' a')]),
      codeLine([txt('const b')]),
    ])
    expect(projectVisibleText(tree)).toBe('const a\nconst b')
  })

  it('concatenates plain rows as-is because they carry their own newlines', () => {
    const tree = el('PRE', {}, [plainRow(1, 'one'), plainRow(2, ''), plainRow(3, 'three')])
    expect(projectVisibleText(tree)).toBe('one\n\nthree\n')
  })

  it('treats pages of a plain document as siblings without doubling their newlines', () => {
    const tree = el('DIV', {}, [
      el('PRE', { attrs: { 'data-textpreview-page': '1' } }, [plainRow(1, 'a'), plainRow(2, 'b')]),
      el('PRE', { attrs: { 'data-textpreview-page': '3' } }, [plainRow(3, 'c')]),
    ])
    expect(projectVisibleText(tree)).toBe('a\nb\nc\n')
  })

  it('drops subtrees marked as hidden, inert, or interaction-excluded', () => {
    const tree = el('DIV', {}, [
      el('SPAN', { attrs: { 'aria-hidden': 'true' } }, [txt('icon')]),
      el('SPAN', { attrs: { hidden: '' } }, [txt('hidden')]),
      el('SPAN', { attrs: { inert: '' } }, [txt('inert')]),
      el('SPAN', { attrs: { 'data-text-interaction-exclude': '' } }, [txt('chrome')]),
      el('SPAN', {}, [txt('kept')]),
    ])
    expect(projectVisibleText(tree)).toBe('kept')
  })

  it('drops a code block banner, whose language label is renderer chrome', () => {
    const tree = el('DIV', {}, [
      el('DIV', { attrs: { 'data-code-block-banner': '' } }, [
        el('SPAN', {}, [txt('代码块')]),
        el('BUTTON', {}, [el('SPAN', { attrs: { 'aria-hidden': 'true' } }, [])]),
      ]),
      el('PRE', {}, [el('CODE', {}, [codeLine([txt('const a = 1')])])]),
    ])
    expect(projectVisibleText(tree)).toBe('const a = 1')
  })

  it('projects a document fragment by joining its children', () => {
    expect(projectVisibleText(fragment([el('P', {}, [txt('a')]), el('P', {}, [txt('b')])]))).toBe('a\nb')
  })

  it('returns an empty string for an empty fragment', () => {
    expect(projectVisibleText(fragment([]))).toBe('')
  })
})

describe('projectSelectionText', () => {
  it('uses the same projection for both quote kinds', () => {
    const tree = el('DIV', {}, [el('P', {}, [txt('a')]), el('P', {}, [txt('b')])])
    expect(projectSelectionText(tree, 'prose')).toBe('a\nb')
    expect(projectSelectionText(tree, 'code')).toBe('a\nb')
  })
})
