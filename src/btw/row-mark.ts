/**
 * `sidebar.session.row.leading`: the brand bubble that marks a Session created
 * by the composer's `btw` action.
 *
 * The product owns that 16px cell: it is the seat its own status dot uses, and
 * a row with a higher-priority state (pending interaction, unread message, live
 * activity) replaces this occupant with that dot. So the mark appears exactly
 * when the row has nothing louder to say — which is the right moment for "this
 * one is a btw fork" to be readable.
 *
 * The occupant receives only the row's `sessionId`; everything else comes from
 * the plugin-run marker store.
 *
 * @module dsh-session-map/btw/row-mark
 */
import * as React from 'react'
import { createBtwGlyph } from './glyph'
import type { BtwMarkersFace } from './markers'

/** The owner props a Session row hands this seat. */
export interface BtwRowMarkProps {
  /** The Session this row shows. */
  readonly sessionId?: string | undefined
}

/** Tooltip text: what the mark means in one sentence. */
const MARK_TITLE = 'btw 旁注会话：从某个会话的当前进度分叉出来的只读会话'

/**
 * Build the row mark over one marker store.
 * @param markers - the btw session ids.
 * @returns the component to register into `sidebar.session.row.leading`.
 */
export function createBtwRowMark(
  markers: BtwMarkersFace,
): (props: BtwRowMarkProps) => React.ReactElement | null {
  const glyph = createBtwGlyph('dsm-btw-mark__glyph', 12)

  function BtwRowMark(props: BtwRowMarkProps): React.ReactElement | null {
    const sessionId = props.sessionId
    const [marked, setMarked] = React.useState(() => sessionId !== undefined && markers.has(sessionId))

    React.useEffect(() => {
      if (sessionId === undefined) {
        setMarked(false)
        return undefined
      }
      setMarked(markers.has(sessionId))
      return markers.subscribe(() => { setMarked(markers.has(sessionId)) })
    }, [sessionId])

    if (sessionId === undefined || !marked) return null
    return React.createElement(
      'span',
      { className: 'dsm-btw-mark', title: MARK_TITLE, 'aria-label': MARK_TITLE },
      glyph,
    )
  }
  return BtwRowMark
}
