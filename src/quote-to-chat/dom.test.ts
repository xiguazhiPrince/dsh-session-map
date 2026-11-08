/**
 * 行号解析：纯文本预览按 `data-textpreview-line` 读绝对行号，代码预览按
 * `pre .line` 顺序（与产品跳行一致）索引；Markdown 预览不给行号。
 *
 * 用最小假元素树覆盖这些分支，不引入 jsdom。
 *
 * @module dsh-session-map/quote-to-chat/dom.test
 */
import { describe, expect, it } from 'vitest'
import { selectionLineRange, type ElementLike, type QueryRootLike } from './dom'

/** 一个只实现 dom.ts 用到的切片元素的假节点。 */
class FakeElement {
  readonly children: FakeElement[] = []
  parentElement: FakeElement | null = null
  previousElementSibling: FakeElement | null = null
  private readonly tokens: string[]

  constructor(
    readonly tagName: string,
    private readonly attrs: Record<string, string> = {},
    className = '',
  ) {
    this.tokens = className.split(/\s+/u).filter(token => token !== '')
  }

  getAttribute(name: string): string | null {
    return name in this.attrs ? this.attrs[name] ?? null : null
  }

  matches(selector: string): boolean {
    return selector === '.line' ? this.tokens.includes('line') : false
  }

  append(...children: FakeElement[]): this {
    for (const child of children) {
      child.parentElement = this
      child.previousElementSibling = this.children.at(-1) ?? null
      this.children.push(child)
    }
    return this
  }
}

/** 假文本节点：只有父元素这一件事对解析有用。 */
function text(parent: FakeElement): { readonly parentElement: FakeElement } {
  return { parentElement: parent }
}

/** 把行数组包成一个可查询的根。 */
function rootOf(rows: readonly FakeElement[]): QueryRootLike {
  return {
    querySelectorAll: (selector: string): ArrayLike<ElementLike> =>
      selector === 'pre .line' ? rows : [],
  }
}

/** 假选区：只带行号解析读的字段。 */
function selection(
  startContainer: unknown,
  endContainer: unknown,
  endOffset: number,
): Range {
  return { startContainer, startOffset: 0, endContainer, endOffset } as unknown as Range
}

/** 造一行纯文本预览行。 */
function plainRow(line: number): FakeElement {
  return new FakeElement('DIV', { 'data-textpreview-line': String(line) })
}

/** 造一行代码预览行。 */
function codeRow(): FakeElement {
  return new FakeElement('SPAN', {}, 'line')
}

describe('selectionLineRange / prose', () => {
  it('reads both endpoints from the row attributes', () => {
    const start = plainRow(12)
    const end = plainRow(14)
    const range = selection(text(start), text(end), 3)
    expect(selectionLineRange(range, 'prose', null)).toEqual({ start: 12, end: 14 })
  })

  it('reports the previous row when the selection ends at a line start', () => {
    const start = plainRow(12)
    const middle = plainRow(13)
    const next = plainRow(14)
    const parent = new FakeElement('PRE').append(start, middle, next)
    const range = selection(text(start), text(next), 0)
    expect(parent.children).toHaveLength(3)
    expect(selectionLineRange(range, 'prose', null)).toEqual({ start: 12, end: 13 })
  })

  it('returns no range when the renderer exposes no row attributes', () => {
    // Markdown 渲染器也走 prose 形态，但它的 DOM 是渲染后的 HTML，没有行号属性。
    const start = new FakeElement('P')
    const end = new FakeElement('P')
    new FakeElement('DIV').append(start, end)
    expect(selectionLineRange(selection(text(start), text(end), 3), 'prose', null)).toBeUndefined()
  })
})

describe('selectionLineRange / code', () => {
  it('indexes rows the same way the product jump-to-line does', () => {
    const first = codeRow()
    const second = codeRow()
    const third = codeRow()
    new FakeElement('PRE').append(first, second, third)
    const root = rootOf([first, second, third])
    const range = selection(text(second), text(third), 4)
    expect(selectionLineRange(range, 'code', root)).toEqual({ start: 2, end: 3 })
  })

  it('drops the trailing row when the selection ends at its very start', () => {
    const first = codeRow()
    const second = codeRow()
    const third = codeRow()
    new FakeElement('PRE').append(first, second, third)
    const root = rootOf([first, second, third])
    const range = selection(text(first), text(third), 0)
    expect(selectionLineRange(range, 'code', root)).toEqual({ start: 1, end: 2 })
  })

  it('returns no range without a code root', () => {
    const row = codeRow()
    expect(selectionLineRange(selection(text(row), text(row), 1), 'code', null)).toBeUndefined()
  })
})
