/**
 * The one glyph the `btw` feature draws in two places: the composer action and
 * the Session row mark.
 *
 * A speech bubble with three dots — the affordance is "ask a side question";
 * forking at the current progress is only how it is implemented. The product
 * ships no icon library, so the shape is inline; it inherits `currentColor` so
 * both seats theme themselves.
 *
 * @module dsh-session-map/btw/glyph
 */
import * as React from 'react'

/**
 * Build the bubble glyph at one CSS class and pixel size.
 * @param className - the CSS class to tag the `<svg>` with.
 * @param size - square edge length in px.
 * @returns the immutable SVG element.
 */
export function createBtwGlyph(className: string, size: number): React.ReactElement {
  return React.createElement(
    'svg',
    {
      className,
      width: size,
      height: size,
      viewBox: '0 0 13 13',
      fill: 'none',
      'aria-hidden': 'true',
      focusable: 'false',
    },
    React.createElement('path', {
      d: 'M2.6 2.4h7.8a1.1 1.1 0 0 1 1.1 1.1v3.9a1.1 1.1 0 0 1-1.1 1.1H6.3L4 10.9V8.5H2.6a1.1 1.1 0 0 1-1.1-1.1V3.5a1.1 1.1 0 0 1 1.1-1.1Z',
      stroke: 'currentColor',
      strokeWidth: 1.2,
      strokeLinejoin: 'round',
    }),
    React.createElement('circle', { cx: 4.2, cy: 5.9, r: 0.6, fill: 'currentColor' }),
    React.createElement('circle', { cx: 6.5, cy: 5.9, r: 0.6, fill: 'currentColor' }),
    React.createElement('circle', { cx: 8.8, cy: 5.9, r: 0.6, fill: 'currentColor' }),
  )
}
