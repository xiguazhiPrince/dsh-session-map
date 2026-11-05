/**
 * Session-row mark tests: the bubble appears only for a remembered btw fork and
 * only where the row hands it a Session id.
 *
 * @module dsh-session-map/btw/row-mark.test
 */
import * as React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { createBtwMarkers, type BtwMarkersFace } from './markers'
import { createBtwRowMark } from './row-mark'

/**
 * Build markers already holding one id.
 * @param ids - remembered Session ids.
 * @returns the store.
 */
function markersHolding(ids: readonly string[]): BtwMarkersFace {
  const markers = createBtwMarkers(undefined)
  for (const id of ids) markers.add(id)
  return markers
}

/**
 * Render the mark for one row.
 * @param ids - remembered Session ids.
 * @param sessionId - the row's Session, if any.
 * @returns the static markup.
 */
function render(ids: readonly string[], sessionId?: string): string {
  const Mark = createBtwRowMark(markersHolding(ids))
  return renderToStaticMarkup(React.createElement(Mark, sessionId === undefined ? {} : { sessionId }))
}

describe('BtwRowMark', () => {
  it('renders the brand bubble for a btw Session', () => {
    const markup = render(['child'], 'child')
    expect(markup).toContain('dsm-btw-mark')
    expect(markup).toContain('dsm-btw-mark__glyph')
    expect(markup).toContain('title="btw 旁注会话：从某个会话的当前进度分叉出来的只读会话"')
  })

  it('renders nothing for an ordinary Session', () => {
    expect(render(['child'], 'other')).toBe('')
  })

  it('renders nothing without a Session id', () => {
    expect(render(['child'])).toBe('')
  })
})
