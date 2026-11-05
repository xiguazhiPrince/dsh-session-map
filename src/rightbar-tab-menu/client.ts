/**
 * Right-column tab actions: three extra rows in the kit's per-tab context menu.
 *
 * The kit that draws the right column owns that menu and contributes only its
 * own "close" row; it appends whatever plugins register into
 * `sidebar.right.tab.menu.item`. Those rows are what turns "close one tab" into
 * the three bulk gestures a tabbed surface is expected to offer — close the
 * others, close the ones to the left, close the ones to the right — for the
 * product's own tabs and for every tab a plugin contributes, because the
 * registration is per menu occurrence rather than per tab type.
 *
 * Only the clicked tab's `TabRecord` and a `dismiss` callback reach a row; the
 * pane and the strip order come from `./model`, which reads the rendered strip.
 * Closing goes through `ctx.sidebarRight`, whose `close` applies the kit's own
 * closability rule (a lone docked guide stays), so this module never has to
 * restate which tabs may disappear.
 *
 * The slot lives in another package and is declared only while its panel is
 * mounted, so the registration waits on it with `slots.inject` instead of
 * reading it at activation. A host without that slot — an older release, or a
 * composition without the right column — simply never calls the callback, and
 * this module stays inert.
 *
 * @module dsh-session-map/rightbar-tab-menu/client
 */
import type { Context } from '@deepseek-ai/cordis'
import * as React from 'react'
import { lookup, type SlotsService } from '../session-map/sidebar-right'
import { CSS } from './css'
import {
  planTabMenu,
  stripOrder,
  type TabCloseScope,
  type TabMenuPlan,
  type TabStripDocument,
} from './model'

/** The slot a tab's context menu appends embedder rows into. */
export const TAB_MENU_SLOT = 'sidebar.right.tab.menu.item'

/** This plugin's cell in that list slot: a fresh id, so the kit's own row is untouched. */
export const TAB_MENU_ENTRY_ID = 'session-map:rightbar-tab-actions'

/** Order among the menu's extra rows; the rows this module renders sort together. */
export const TAB_MENU_ENTRY_ORDER = 20

/** One tab's menu occurrence, as the slot supplies it and this module reads it. */
export interface RightbarTabMenuProps {
  /** The tab whose menu is open. */
  readonly tab: {
    readonly id: string
    readonly kind: string
  }
  /** Close the kit's menu. The slot requires every acting row to call it. */
  readonly dismiss: () => void
  /** The Session whose right column is on screen; supplied as a standard slot prop. */
  readonly sessionId: string
}

/** The right column's close operations, as far as bulk closing needs them. */
interface RightbarTabCloseFace {
  /** Close one tab of the on-screen Session, under the kit's closability rule. */
  close(tabId: string): void
  /** Every open record of one Session; absent on a host that only exposes the commands. */
  tabsIn?(sessionId: string): readonly { readonly id: string }[]
}

/** One row: which slice of the plan it closes, and the text it shows. */
const ROWS: readonly { readonly scope: TabCloseScope; readonly label: string }[] = [
  { scope: 'others', label: '关闭其他标签' },
  { scope: 'left', label: '关闭左侧其他标签' },
  { scope: 'right', label: '关闭右侧其他标签' },
]

/**
 * Resolve what each bulk-close row would do for one clicked tab.
 *
 * The strip read is the normal path. Without it (a float's title menu, or markup
 * this version does not know) the session's open records still answer "close
 * others"; order-dependent rows stay empty rather than guessing an order.
 * @param tabId - the tab whose menu is open.
 * @param sessionId - the Session whose column is on screen.
 * @param face - the right column's close face, when it is provided.
 * @returns the ids each row would close.
 */
export function tabMenuPlan(
  tabId: string,
  sessionId: string,
  face: RightbarTabCloseFace | undefined,
): TabMenuPlan {
  if (typeof document !== 'undefined') {
    const order = stripOrder(document as unknown as TabStripDocument, tabId, sessionId)
    if (order !== undefined) return planTabMenu(tabId, order)
  }
  const open = face?.tabsIn?.(sessionId) ?? []
  return { others: open.map(tab => tab.id).filter(id => id !== tabId), left: [], right: [] }
}

/**
 * Build the registered row component over one plugin context.
 *
 * The component resolves the service on every render instead of capturing it at
 * registration: the menu can open before this plugin's fiber sees the service,
 * and a captured `undefined` would hide the rows for the rest of the page's
 * life.
 * @param ctx - browser root context carrying the right-column service.
 * @returns the component for the `sidebar.right.tab.menu.item` slot.
 */
function createTabMenuRows(ctx: Context): (props: RightbarTabMenuProps) => React.ReactElement | null {
  return function RightbarTabMenuRows(props: RightbarTabMenuProps): React.ReactElement | null {
    const face = lookup<RightbarTabCloseFace>(ctx, 'sidebarRight')
    const plan = tabMenuPlan(props.tab.id, props.sessionId, face)
    // A row that would close nothing is not offered: a single-tab pane keeps
    // the menu it had, and a float's menu keeps only the kit's close.
    const rows = ROWS.filter(row => plan[row.scope].length > 0)
    if (face === undefined || rows.length === 0) return null
    return React.createElement(
      React.Fragment,
      null,
      ...rows.map(row => React.createElement(
        'button',
        {
          key: row.scope,
          type: 'button',
          role: 'menuitem',
          className: 'dsm-tabmenu__item',
          'data-rightbar-tab-action': row.scope,
          onClick: () => {
            // Re-read at click time: the plan the row rendered with is only a
            // visibility decision, and the ids acted on should be the strip's
            // current ones.
            const ids = tabMenuPlan(props.tab.id, props.sessionId, face)[row.scope]
            props.dismiss()
            for (const id of ids) face.close(id)
          },
        },
        row.label,
      )),
    )
  }
}

/**
 * Register the bulk-close rows and their stylesheet.
 * @param ctx - browser root context carrying the slot registry.
 */
export function installRightbarTabMenu(ctx: Context): void {
  const slots = lookup<SlotsService>(ctx, 'slots')
  if (slots === undefined) return

  // The rows live in a menu the kit portals to the document body, outside every
  // page this plugin draws, so their rules travel with this module instead of
  // the map's sheet. Same one-element-per-apply pattern: removed with the fiber.
  ctx.effect(() => {
    if (typeof document === 'undefined') return () => undefined
    const element = document.createElement('style')
    element.textContent = CSS
    document.head.appendChild(element)
    return () => { element.remove() }
  }, 'rightbar-tab-menu: stylesheet')

  const Rows = createTabMenuRows(ctx)
  ctx.effect(() => slots.inject(TAB_MENU_SLOT, () => slots.register<RightbarTabMenuProps>(
    { name: TAB_MENU_SLOT, id: TAB_MENU_ENTRY_ID, order: TAB_MENU_ENTRY_ORDER },
    Rows,
  )), 'rightbar-tab-menu: context-menu rows')
}
