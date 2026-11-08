/**
 * 工具栏条目本身的渲染契约：它只画一个隐藏锚点（浮层由浏览器事件驱动），
 * 渲染期不读写输入框、不发起插入。
 *
 * @module dsh-session-map/quote-to-chat/action.test
 */
import * as React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'
import { createQuoteToChatAction, type QuoteActionProps } from './action'

/** 渲染一次条目。 */
function render(props: QuoteActionProps = {}): string {
  const Action = createQuoteToChatAction()
  return renderToStaticMarkup(React.createElement(Action, props))
}

describe('QuoteToChatAction', () => {
  it('renders only the hidden anchor, never the bubble itself', () => {
    const markup = render()
    expect(markup).toContain('dsm-quote__anchor')
    expect(markup).toContain('hidden')
    expect(markup).not.toContain('class="dsm-quote"')
  })

  it('does not touch the composer while rendering', () => {
    const captureInsertion = vi.fn()
    const insertText = vi.fn()
    render({ absolutePath: '/repo/src/a.ts', inputActions: { captureInsertion, insertText } })
    expect(captureInsertion).not.toHaveBeenCalled()
    expect(insertText).not.toHaveBeenCalled()
  })

  it('renders without optional props', () => {
    expect(render({ absolutePath: undefined })).toContain('dsm-quote__anchor')
  })
})
