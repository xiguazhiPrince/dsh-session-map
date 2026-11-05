/**
 * Composer button tests: it appears only for a running Session, carries the
 * affordance title, and renders nothing otherwise — the three facts the
 * `conversation.input.left` list cell depends on.
 *
 * @module dsh-session-map/btw/button.test
 */
import * as React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { createBtwButton, type BtwRuntime } from './button'

/** A runtime whose fork action is never reached by these render-only tests. */
const runtime: BtwRuntime = {
  forkHere: () => Promise.resolve({ ok: true, childId: 'child', atSeq: 1, readOnly: true }),
}

/**
 * Render the button with one running-state answer.
 * @param running - what the injected `useSession` selector reports.
 * @param withSessionId - whether the Session prop is present at all.
 * @returns the static markup.
 */
function render(running: boolean, withSessionId: boolean = true): string {
  const Button = createBtwButton(runtime)
  return renderToStaticMarkup(React.createElement(Button, {
    ...withSessionId ? { sessionId: 'session-1' } : {},
    useSession: () => running,
  }))
}

describe('BtwButton', () => {
  it('renders nothing while the Session is idle', () => {
    expect(render(false)).toBe('')
  })

  it('renders nothing without a Session id even when the selector says running', () => {
    expect(render(true, false)).toBe('')
  })

  it('renders the labelled control while the Session runs', () => {
    const markup = render(true)
    expect(markup).toContain('dsm-btw')
    expect(markup).toContain('dsm-btw__glyph')
    expect(markup).toContain('dsm-btw__label')
    expect(markup).toContain('>BTW<')
    expect(markup).toContain('title="btw：从当前进度分叉出一个只读会话并切过去"')
    expect(markup).toContain('type="button"')
  })

  it('treats a missing selector as "not running"', () => {
    const Button = createBtwButton(runtime)
    expect(renderToStaticMarkup(React.createElement(Button, { sessionId: 'session-1' }))).toBe('')
  })
})
