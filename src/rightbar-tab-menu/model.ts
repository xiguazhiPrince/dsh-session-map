/**
 * Pure decisions and one read of the rendered strip, behind the right column's
 * bulk-close menu rows.
 *
 * The kit that draws the right column owns the per-tab context menu and
 * contributes only its own "close" row; the `sidebar.right.tab.menu.item` slot
 * appends embedder rows. Those rows get the clicked `tab` record and a
 * `dismiss` callback and nothing else — the tab record names the tab but not
 * the pane holding it, and the pane's strip order is not part of any service
 * face. Visual order is therefore read from the rendered strip: the kit marks
 * every pane's chip row with `data-dockkit-strip-tabs` and every chip with
 * `data-dockkit-tab`, and it draws the chips in layout order, so DOM order is
 * tab order. Both markers belong to the kit's public chip markup (its own focus
 * and drag code queries the same ones), so they are stable enough to read and
 * cheap to lose gracefully: when the strip cannot be found the caller falls
 * back to the session-wide record list, which supports "close others" without
 * claiming an order it does not know.
 *
 * The rows act on the clicked tab's own strip only. "Close others" therefore
 * means the other tabs of that pane, and "left"/"right" mean the tabs drawn on
 * either side of the clicked one; a split pane's tabs are not closed from the
 * other pane's menu, which keeps every surviving pane non-empty.
 *
 * @module dsh-session-map/rightbar-tab-menu/model
 */

/** The three bulk-close rows one tab's menu can offer. */
export type TabCloseScope = 'others' | 'left' | 'right'

/** The tabs each bulk-close row would close for one clicked tab. */
export interface TabMenuPlan {
  /** Every other tab of the clicked tab's strip. */
  readonly others: readonly string[]
  /** The tabs drawn left of the clicked one, in strip order. */
  readonly left: readonly string[]
  /** The tabs drawn right of the clicked one, in strip order. */
  readonly right: readonly string[]
}

/** The plan of a tab with no strip order: only "close others" has a meaning, and it has no ids here. */
const NO_ORDER: TabMenuPlan = { others: [], left: [], right: [] }

/**
 * Split one strip order around the clicked tab.
 * @param tabId - the tab whose menu is open.
 * @param order - the chip ids of that tab's strip, in layout order.
 * @returns what each row would close; empty slices when the order is unknown or the tab is not in it.
 */
export function planTabMenu(tabId: string, order: readonly string[] | undefined): TabMenuPlan {
  if (order === undefined) return NO_ORDER
  const at = order.indexOf(tabId)
  if (at < 0) return NO_ORDER
  return {
    others: order.filter(id => id !== tabId),
    left: order.slice(0, at),
    right: order.slice(at + 1),
  }
}

/**
 * The narrow element surface the strip read needs.
 *
 * A real `Element` satisfies it; tests supply plain objects. Keeping the
 * surface this small lets the ordering rule be exercised without a DOM.
 */
export interface TabStripElement {
  /** Read one attribute, such as the chip's tab id. */
  getAttribute(name: string): string | null
  /** Walk up to the nearest ancestor matching a selector, such as the chip's strip. */
  closest(selectors: string): TabStripElement | null
  /** Read the matching descendants of this element, such as a strip's chips. */
  querySelectorAll(selectors: string): ArrayLike<TabStripElement>
}

/** The narrow document surface the strip read needs; a real `Document` satisfies it. */
export interface TabStripDocument {
  /** The matching descendants of the document: the mounted right panels, then chips when none is marked. */
  querySelectorAll(selectors: string): ArrayLike<TabStripElement>
}

/** The kit's attribute carrying one tab chip's tab id. */
export const TAB_CHIP_ATTRIBUTE = 'data-dockkit-tab'

/** The kit's attribute carrying one pane's chip row. */
export const TAB_STRIP_ATTRIBUTE = 'data-dockkit-strip-tabs'

/** The right column's mounted panel attribute; the search starts there so another dock surface's chips cannot answer. */
export const RIGHT_PANEL_ATTRIBUTE = 'data-sidebar-right-session'

/**
 * Read one tab's strip order from the rendered right column.
 * @param doc - the page document, or a stand-in with the same three reads.
 * @param tabId - the tab whose menu is open.
 * @param sessionId - the Session whose column the menu was opened in, when known.
 * @returns the strip's chip ids in layout order, or `undefined` when the panel, the chip, or its strip is absent.
 */
export function stripOrder(
  doc: TabStripDocument,
  tabId: string,
  sessionId?: string,
): readonly string[] | undefined {
  // One Session's seat draws one panel, but a frame that keeps a previous
  // Session's panel mounted would put two chip rows on the page and give two
  // tabs the same id. Prefer the panel of the menu's own Session; the fallbacks
  // only cover a host that does not mount that attribute yet.
  const panels = Array.from(doc.querySelectorAll(`[${RIGHT_PANEL_ATTRIBUTE}]`))
  const own = sessionId === undefined
    ? undefined
    : panels.find(panel => panel.getAttribute(RIGHT_PANEL_ATTRIBUTE) === sessionId)
  const scope = own ?? panels[0]
  return stripOrderIn(scope ?? doc, tabId)
}

/**
 * Read one tab's strip order inside one search scope.
 * @param scope - a mounted right panel, or the whole document when none is marked.
 * @param tabId - the tab whose menu is open.
 * @returns the strip's chip ids in layout order, or `undefined` when the chip or its strip is absent.
 */
function stripOrderIn(
  scope: TabStripDocument | TabStripElement,
  tabId: string,
): readonly string[] | undefined {
  const chip = Array.from(scope.querySelectorAll(`[${TAB_CHIP_ATTRIBUTE}]`))
    .find(element => element.getAttribute(TAB_CHIP_ATTRIBUTE) === tabId)
  if (chip === undefined) return undefined
  const strip = chip.closest(`[${TAB_STRIP_ATTRIBUTE}]`)
  if (strip === null) return undefined
  const order = Array.from(strip.querySelectorAll(`[${TAB_CHIP_ATTRIBUTE}]`))
    .map(element => element.getAttribute(TAB_CHIP_ATTRIBUTE))
    .filter((id): id is string => id !== null && id !== '')
  // A chip whose own strip does not list it means the markup moved under this
  // reading; an order without the clicked tab is not a safe basis for slicing.
  return order.includes(tabId) ? order : undefined
}
