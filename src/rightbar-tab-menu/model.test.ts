/**
 * Unit tests for the right-column bulk-close decisions and the strip read.
 *
 * The strip read is the only DOM knowledge this feature carries, and it cannot
 * be exercised in a real page from here, so the markers the kit's chip markup
 * carries are pinned by these fakes: a mismatch with the live kit shows up as a
 * failing order here instead of as three row labels that silently do nothing.
 *
 * @module dsh-session-map/rightbar-tab-menu/model.test
 */
import { describe, expect, it } from 'vitest'
import {
  planTabMenu,
  RIGHT_PANEL_ATTRIBUTE,
  stripOrder,
  TAB_CHIP_ATTRIBUTE,
  TAB_STRIP_ATTRIBUTE,
  type TabStripDocument,
  type TabStripElement,
} from './model'

/**
 * One fake chip row: chips answer the tab-id attribute and point at their strip.
 * @param ids - tab ids in layout order.
 * @param sessionId - the Session whose panel attribute this strip carries, when it is a panel.
 * @returns the strip element, whose chip row answers the chip selector.
 */
function createFakeStrip(ids: readonly string[], sessionId?: string): TabStripElement {
  const chips: TabStripElement[] = []
  const strip: TabStripElement = {
    getAttribute: name => (name === RIGHT_PANEL_ATTRIBUTE ? sessionId ?? null : null),
    closest: () => null,
    querySelectorAll: selector => (selector === `[${TAB_CHIP_ATTRIBUTE}]` ? chips : []),
  }
  for (const id of ids) {
    chips.push({
      getAttribute: name => (name === TAB_CHIP_ATTRIBUTE ? id : null),
      closest: selector => (selector === `[${TAB_STRIP_ATTRIBUTE}]` ? strip : null),
      querySelectorAll: () => [],
    })
  }
  return strip
}

/**
 * A fake document around the given strips.
 * @param strips - panels present in the document, in DOM order.
 * @param withPanelAttribute - whether those strips are marked as mounted right panels.
 * @returns the document stand-in.
 */
function createFakeDocument(strips: readonly TabStripElement[], withPanelAttribute = true): TabStripDocument {
  return {
    querySelectorAll: selector => (selector === `[${RIGHT_PANEL_ATTRIBUTE}]`
      ? (withPanelAttribute ? strips : [])
      : strips.flatMap(strip => Array.from(strip.querySelectorAll(`[${TAB_CHIP_ATTRIBUTE}]`)))),
  }
}

describe('planTabMenu', () => {
  it('splits one strip order around the clicked tab', () => {
    expect(planTabMenu('b', ['a', 'b', 'c', 'd'])).toEqual({
      others: ['a', 'c', 'd'],
      left: ['a'],
      right: ['c', 'd'],
    })
  })

  it('offers nothing when the clicked tab is alone', () => {
    expect(planTabMenu('b', ['b'])).toEqual({ others: [], left: [], right: [] })
  })

  it('offers nothing without an order or with a tab outside it', () => {
    expect(planTabMenu('b', undefined)).toEqual({ others: [], left: [], right: [] })
    expect(planTabMenu('b', ['a', 'c'])).toEqual({ others: [], left: [], right: [] })
  })
})

describe('stripOrder', () => {
  it('reads the chip row of the panel that holds the clicked tab', () => {
    const doc = createFakeDocument([createFakeStrip(['tab-1', 'tab-2', 'tab-3'], 'session-1')])
    expect(stripOrder(doc, 'tab-2', 'session-1')).toEqual(['tab-1', 'tab-2', 'tab-3'])
  })

  it('still reads the order when no chip row is marked as a right panel', () => {
    const doc = createFakeDocument([createFakeStrip(['tab-1', 'tab-2'])], false)
    expect(stripOrder(doc, 'tab-1')).toEqual(['tab-1', 'tab-2'])
  })

  it('prefers the panel of the menu\'s own Session', () => {
    const first = createFakeStrip(['tab-1', 'tab-2'], 'session-1')
    const second = createFakeStrip(['tab-2', 'tab-9'], 'session-2')
    const doc = createFakeDocument([first, second])
    expect(stripOrder(doc, 'tab-2', 'session-2')).toEqual(['tab-2', 'tab-9'])
  })

  it('reports no order for a tab whose chip is absent', () => {
    const doc = createFakeDocument([createFakeStrip(['tab-1'], 'session-1')])
    expect(stripOrder(doc, 'tab-9', 'session-1')).toBeUndefined()
  })

  it('reports no order when a chip is not listed by its own strip', () => {
    const strip = createFakeStrip(['tab-1', 'tab-2'], 'session-1')
    const chips = Array.from(strip.querySelectorAll(`[${TAB_CHIP_ATTRIBUTE}]`))
    const chip = chips[1] as TabStripElement
    // The strip answers a row without the clicked chip: the markup moved under
    // this reading, and an order that omits the tab cannot be sliced safely.
    const foreignStrip: TabStripElement = {
      getAttribute: () => null,
      closest: () => null,
      querySelectorAll: () => [chips[0] as TabStripElement],
    }
    chip.closest = () => foreignStrip
    const panel: TabStripElement = {
      getAttribute: name => (name === RIGHT_PANEL_ATTRIBUTE ? 'session-1' : null),
      closest: () => null,
      querySelectorAll: selector => (selector === `[${TAB_CHIP_ATTRIBUTE}]` ? [chip] : []),
    }
    expect(stripOrder(createFakeDocument([panel]), 'tab-2', 'session-1')).toBeUndefined()
  })
})
