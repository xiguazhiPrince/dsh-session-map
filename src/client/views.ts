/**
 * The three View bodies: the plain Session overview (Conversation tab and
 * right-column tab), the launcher button, and the fork-tree canvas factory.
 *
 * They receive everything through their composed props and a {@link
 * SessionMapRuntime}; `ctx` never crosses this boundary, so a body can be
 * rendered by a test or by the slot renderer without a runtime.
 *
 * @module dsh-session-map/client/views
 */
import * as React from 'react'
import {
  BASE_ZOOM,
  BEAD_H,
  BEAD_W,
  EDGE_CLASS,
  MAP_KIND,
  MARKER_W,
  MAX_ZOOM,
  MENU_H,
  MENU_INSET,
  MENU_W,
  MIN_ZOOM,
  NODE_H,
  NODE_W,
  OVERVIEW_KIND,
  PAD,
  WHEEL_LINE,
  WHEEL_ZOOM_BASE,
  WHEEL_ZOOM_MAX_STEP,
} from './constants'
import { buildGraph, mainSessionId, type GraphNode, type LineState, type SessionSummary, type WorkspaceGroup } from './graph'
import { useFlag, withMember, type Flag } from './flags'
import { clampNumber, errorText, formatCount, formatMs } from './format'

// The toolbar's keyboard glyph. A dynamic package carries no icon library, so
// the shape is drawn inline.
const KEYBOARD_GLYPH = React.createElement(
  'svg',
  { width: 14, height: 14, viewBox: '0 0 16 16', 'aria-hidden': 'true', focusable: 'false' },
  React.createElement('rect', {
    x: 1, y: 3.5, width: 14, height: 9, rx: 2,
    fill: 'none', stroke: 'currentColor', strokeWidth: 1.2,
  }),
  React.createElement('path', {
    d: 'M3.5 6.5h1M6 6.5h1M8.5 6.5h1M11 6.5h1.5M4 9.5h8',
    fill: 'none', stroke: 'currentColor', strokeWidth: 1.2, strokeLinecap: 'round',
  }),
)

/** Session list state, narrowed to the fields the canvas reads. */
export interface SessionListState {
  readonly ids: readonly string[]
  readonly byId: Readonly<Record<string, SessionSummary>>
  /**
   * Foreground Session id, when the build publishes one. The 0.1.7 Session list
   * snapshot dropped it, so the canvas derives it with
   * {@link mainSessionId} instead; see {@link foregroundSessionId}.
   */
  readonly current?: string | undefined
}

/** The seat's own Session lifecycle state, narrowed to the fields the overview reads. */
export interface SessionState {
  readonly running: boolean
  /**
   * Submissions admitted but not consumed yet, as the current builds name them.
   * Both names stay declared because the snapshot the seat publishes is wire
   * data, not a type this plugin controls; see {@link waitingCount}.
   */
  readonly pendingSubmissions?: readonly unknown[] | undefined
  /** The name older builds gave the same list. */
  readonly queue?: readonly unknown[] | undefined
  readonly hasMore: boolean
}

/** Workspace list state, narrowed to the groups the canvas orders trees by. */
export interface WorkspaceListState {
  readonly items: readonly WorkspaceGroup[]
}

/** The `sessionStats` projection the Host computes for one Session. */
export interface SessionStatsView {
  readonly turns: number
  readonly steps: number
  readonly llmMs: number
  readonly toolMs: number
  readonly decodeTokens: number
}

/**
 * The Host-computed projection reader the seat supplies, narrowed to the two
 * keys this plugin reads. Either key is absent until the Host's projection unit
 * for it has landed a baseline.
 */
export interface ProjectionReader {
  (key: 'title'): string | null | undefined
  (key: 'sessionStats'): SessionStatsView | undefined
}

/**
 * Composed props one Session-scoped seat hands its body: the framework hooks
 * for the Session list, the Workspace list, the seat's own Session and its
 * projection values, plus the identity of the Session being drawn.
 */
export interface SessionViewProps {
  /** Session this seat is drawing. */
  readonly sessionId: string
  useSessions<Selected>(select: (state: SessionListState) => Selected): Selected
  useWorkspaces<Selected>(select: (state: WorkspaceListState) => Selected): Selected
  useSession<Selected>(select: (state: SessionState) => Selected): Selected
  useProjection: ProjectionReader
}

/** The right column's navigation operations this plugin calls. */
export interface SidebarRightFace {
  openTab(kind: string): void
  active(): { readonly kind: string; readonly id: string } | undefined
  close(tabId: string): void
}

/**
 * What the bodies call back into the plugin with. Every member resolves its
 * service when it is called, so a mounted body never holds a service handle.
 */
export interface SessionMapRuntime {
  /**
   * The right column.
   * @returns the navigation face.
   * @throws when no service provides `sidebarRight`.
   */
  sidebarRight(): SidebarRightFace
  /**
   * Select a Session in the app, through whichever navigation service is present.
   * @param sessionId - the Session to show.
   */
  openSession(sessionId: string): void
}

/** The overview's read of one Session. */
interface OverviewData {
  readonly title: string | null | undefined
  readonly stats: SessionStatsView | undefined
  readonly running: boolean
  readonly queueLength: number
  readonly hasMore: boolean
}

/** The canvas transform: scale plus the stage's translation inside the panel. */
interface ViewState {
  readonly zoom: number
  readonly x: number
  readonly y: number
}

/** One in-flight pan, anchored at the pointer and at the translation it started from. */
interface DragState {
  readonly pointerX: number
  readonly pointerY: number
  readonly x: number
  readonly y: number
}

/** The canvas popover's target: one Session card or one turn bead. */
interface MenuTarget {
  readonly kind: 'node' | 'bead'
  readonly id: string
}

/** The panel's inner box, in pixels. */
interface PanelSize {
  readonly width: number
  readonly height: number
}

/** What the toolbar's two switches and the three per-line sets hold. */
export interface MapFlags {
  readonly showPrompts: Flag<boolean>
  readonly hideSubagents: Flag<boolean>
  readonly openedLines: Flag<Set<string>>
  readonly collapsedLines: Flag<Set<string>>
  readonly expandedInherited: Flag<Set<string>>
}

/**
 * Resolve the Session the app is showing, for one seat.
 *
 * A build that publishes `current` on the list snapshot is trusted first. The
 * 0.1.7 snapshot carries only `{ ids, byId, phase, projectionsBySession }`, so
 * the row the main view retains answers instead — the same derivation every
 * shipped package uses. The seat's own Session is the last resort, which is what
 * a right column bound to a Session reports while nothing holds a main view.
 *
 * Without this the id was simply `undefined`, which silently degraded every
 * "current" answer: no card drew the current ring, and {@link
 * SessionMapView}'s placement and 定位当前 both fell through to fitting the whole
 * graph instead of centering on the Session being read.
 * @param state - the Session list snapshot.
 * @param sessionId - the Session this seat is drawing.
 * @returns the foreground Session id, or `undefined` when none can be named.
 */
function foregroundSessionId(state: SessionListState, sessionId: string): string | undefined {
  return state.current ?? mainSessionId(state.byId) ?? sessionId
}

/**
 * One overview card.
 * @param key - React key.
 * @param label - the card's caption.
 * @param value - the formatted figure.
 * @returns the card element.
 */
function card(key: string, label: string, value: string): React.ReactElement {
  return React.createElement(
    'div',
    { className: 'dsv-ov__card', key },
    React.createElement('div', { className: 'dsv-ov__cardLabel' }, label),
    React.createElement('div', { className: 'dsv-ov__cardValue' }, value),
  )
}

/**
 * How many submissions one Session is holding.
 *
 * The current builds publish the list as `pendingSubmissions`; the `queue` field
 * this overview was written against is gone, and reading `.length` off it threw
 * while the overview rendered. Taking whichever field is really an array keeps
 * both builds working and reports "nothing waiting" instead of crashing when
 * neither is present.
 * @param session - the seat's Session snapshot.
 * @returns the number of waiting submissions.
 */
function waitingCount(session: SessionState): number {
  if (Array.isArray(session.pendingSubmissions)) return session.pendingSubmissions.length
  if (Array.isArray(session.queue)) return session.queue.length
  return 0
}

/**
 * Read everything the overview shows from the seat's props.
 * @param props - composed slot props.
 * @returns the projected title and stats plus the live Session figures.
 */
function useOverview(props: SessionViewProps): OverviewData {
  const title = props.useProjection('title')
  const stats = props.useProjection('sessionStats')
  const running = props.useSession(s => s.running)
  const queueLength = props.useSession(s => waitingCount(s))
  const hasMore = props.useSession(s => s.hasMore)
  return { title, stats, running, queueLength, hasMore }
}

/**
 * The overview's title block.
 * @param data - values from {@link useOverview}.
 * @param subtitle - the seat-specific line under the title.
 * @returns the header element.
 */
function overviewHead(data: OverviewData, subtitle: string): React.ReactElement {
  return React.createElement(
    'div',
    null,
    React.createElement('div', { className: 'dsv-ov__head' }, data.title || '未命名会话'),
    React.createElement('div', { className: 'dsv-ov__sub' }, subtitle),
  )
}

/**
 * The overview's figure grid.
 * @param data - values from {@link useOverview}.
 * @returns the grid element.
 */
function overviewGrid(data: OverviewData): React.ReactElement {
  const stats = data.stats
  return React.createElement('div', { className: 'dsv-ov__grid' }, [
    card('turns', '轮次', stats ? formatCount(stats.turns) : '—'),
    card('steps', '步骤', stats ? formatCount(stats.steps) : '—'),
    card('llm', '模型耗时', stats ? formatMs(stats.llmMs) : '—'),
    card('tool', '工具耗时', stats ? formatMs(stats.toolMs) : '—'),
    card('tokens', '输出 token', stats ? formatCount(stats.decodeTokens) : '—'),
    card('state', '状态', data.running ? '运行中' : '空闲'),
  ])
}

/**
 * The overview's footer: which Session this is and how much history is loaded.
 * @param data - values from {@link useOverview}.
 * @param sessionId - the Session being drawn.
 * @returns the footer element.
 */
function overviewFoot(data: OverviewData, sessionId: string): React.ReactElement {
  return React.createElement(
    'div',
    { className: 'dsv-ov__foot' },
    '会话 ' + String(sessionId)
    + ' · 排队 ' + String(data.queueLength)
    + (data.hasMore ? ' · 仍有更早历史未载入' : ' · 历史已全部载入'),
  )
}

/**
 * One row of the shortcut list behind the keyboard glyph.
 * @param key - the shortcut's key column.
 * @param text - what the shortcut does.
 * @returns the row element.
 */
function helpRow(key: string, text: string): React.ReactElement {
  return React.createElement(
    'div',
    { className: 'dsm__helpRow', key },
    React.createElement('span', { className: 'dsm__helpKey' }, key),
    React.createElement('span', { className: 'dsm__helpText' }, text),
  )
}

/**
 * Open one right-sidebar tab type.
 * @param runtime - the plugin's live service accessors.
 * @param kind - the tab kind to open.
 */
function openInRightbar(runtime: SessionMapRuntime, kind: string): void {
  runtime.sidebarRight().openTab(kind)
}

/**
 * Whether the right column is drawing the map right now.
 *
 * Asked before a jump, where it is the user's intent for this navigation; after
 * the switch the same question is about the target Session's own layout.
 * @param runtime - the plugin's live service accessors.
 * @returns true while the map is the active tab.
 */
function sidebarShowsMap(runtime: SessionMapRuntime): boolean {
  try {
    return runtime.sidebarRight().active()?.kind === MAP_KIND
  } catch {
    // No right column in this composition, so the jump simply does not follow.
    return false
  }
}

/**
 * Re-open the map in the Session a jump just switched to.
 *
 * The controller acts on whichever Session surface is bound, and the switch
 * rebinds it asynchronously, so opening immediately would land in the Session
 * being left. While that one is still bound its column is drawing the map, so
 * waiting for the map to disappear is what proves the target's own layout — the
 * per-Session seed — is in place. A target that already has the map open never
 * satisfies that test and is left as it is.
 * @param runtime - the plugin's live service accessors.
 */
function followMapIntoNextSession(runtime: SessionMapRuntime): void {
  let attempts = 0
  const tick = (): void => {
    attempts += 1
    try {
      const sidebarRight = runtime.sidebarRight()
      if (sidebarRight.active()?.kind !== MAP_KIND) {
        sidebarRight.openTab(MAP_KIND)
        return
      }
    } catch {
      // Nothing is bound yet; the next frame decides.
    }
    if (attempts < 20) window.requestAnimationFrame(tick)
  }
  window.requestAnimationFrame(tick)
}

/**
 * The right column's own copy of the overview: same figures, panel spacing, and
 * no way to open a second copy of what is already on screen.
 * @param props - composed slot props.
 * @returns the panel body.
 */
export function SidebarOverviewBody(props: SessionViewProps): React.ReactElement {
  const data = useOverview(props)
  return React.createElement(
    'div',
    { className: 'dsv-ov dsv-ov--panel' },
    overviewHead(data, 'sidebar.right.pane.tab · 由动态 Cordis 插件注册'),
    overviewGrid(data),
    overviewFoot(data, props.sessionId),
  )
}

/**
 * Build the Conversation tab's overview body.
 * @param runtime - the plugin's live service accessors.
 * @returns the registered body component.
 */
export function createOverviewTab(runtime: SessionMapRuntime): (props: SessionViewProps) => React.ReactElement {
  function OverviewTab(props: SessionViewProps): React.ReactElement {
    const data = useOverview(props)
    const [error, setError] = React.useState<string | null>(null)
    const onClick = (): void => {
      try {
        openInRightbar(runtime, OVERVIEW_KIND)
        setError(null)
      } catch (cause) {
        setError(errorText(cause))
      }
    }
    return React.createElement(
      'div',
      { className: 'dsv-ov' },
      overviewHead(data, '对话视图；同样的内容可在右侧栏作为独立标签页打开'),
      overviewGrid(data),
      React.createElement(
        'div',
        { className: 'dsv-ov__actions' },
        React.createElement('button', { type: 'button', className: 'dsv-ov__button', onClick }, '在右侧栏打开'),
        error === null ? null : React.createElement('span', { className: 'dsv-ov__error' }, error),
      ),
      overviewFoot(data, props.sessionId),
    )
  }
  return OverviewTab
}

/**
 * Build the Session header's launcher button.
 *
 * The tab row cannot host a launcher: every conversation.view cell IS a View,
 * and the header's tab button calls selectView(id) unconditionally. A View also
 * cannot read the previously selected id (that lives in ui-conversation's
 * private store), so it cannot bounce back precisely. A header utility is a
 * real button and leaves the View selection alone. It toggles instead of only
 * opening: `active()` reports the tab the active pane is drawing, and
 * TabRecord.kind names its type, so "the map is the active tab" is decidable
 * without any extra state.
 * @param runtime - the plugin's live service accessors.
 * @returns the registered header utility component.
 */
export function createMapLauncher(runtime: SessionMapRuntime): () => React.ReactElement {
  function MapLauncher(): React.ReactElement {
    // A rejected toggle used to reach only the console, which reads as a dead
    // button; the reason is shown beside it instead.
    const [error, setError] = React.useState<string | null>(null)
    const onClick = (): void => {
      try {
        const sidebarRight = runtime.sidebarRight()
        const active = sidebarRight.active()
        if (active !== undefined && active.kind === MAP_KIND) {
          sidebarRight.close(active.id)
          setError(null)
          return
        }
        sidebarRight.openTab(MAP_KIND)
        setError(null)
      } catch (cause) {
        const message = errorText(cause)
        // console.error lines are mirrored into this Run's diagnostics.
        console.error('会话图谱：切换右侧栏失败', message)
        setError(message)
      }
    }
    return React.createElement(
      'span',
      { className: 'dsm-launchWrap' },
      React.createElement(
        'button',
        {
          type: 'button',
          className: 'dsm-launch',
          title: '在右侧栏打开或关闭会话图谱',
          onClick,
        },
        '会话图谱',
      ),
      error === null ? null : React.createElement('span', { className: 'dsm__error' }, error),
    )
  }
  return MapLauncher
}

/**
 * Build one canvas body. One implementation, two seats; `showRightbarButton`
 * only hides the explicit "在右侧栏打开" control where the View already IS the
 * right column.
 * @param runtime - the plugin's live service accessors.
 * @param flags - the switches and per-line sets the plugin run owns.
 * @param showRightbarButton - whether to offer the "open in the right column" control.
 * @returns the registered canvas component.
 */
export function createMapView(
  runtime: SessionMapRuntime,
  flags: MapFlags,
  showRightbarButton: boolean,
): (props: SessionViewProps) => React.ReactElement {
  function SessionMapView(props: SessionViewProps): React.ReactElement {
    const byId = props.useSessions(state => state.byId)
    const ids = props.useSessions(state => state.ids)
    const current = props.useSessions(state => foregroundSessionId(state, props.sessionId))
    const workspaces = props.useWorkspaces(state => state.items)

    const [hideSubagents, setHideSubagents] = useFlag(flags.hideSubagents)
    const [showPrompts, setShowPrompts] = useFlag(flags.showPrompts)
    const [openedLines, setOpenedLines] = useFlag(flags.openedLines)
    const [collapsedLines, setCollapsedLines] = useFlag(flags.collapsedLines)
    const [expandedInherited, setExpandedInherited] = useFlag(flags.expandedInherited)
    const [view, setView] = React.useState<ViewState>({ zoom: BASE_ZOOM, x: PAD, y: PAD })
    const [drag, setDrag] = React.useState<DragState | null>(null)
    const [placed, setPlaced] = React.useState(false)
    // The popover names one canvas target: a Session card or one turn bead.
    const [menuTarget, setMenuTarget] = React.useState<MenuTarget | null>(null)
    const [helpOpen, setHelpOpen] = React.useState(false)
    const [error, setError] = React.useState<string | null>(null)
    const panelRef = React.useRef<HTMLDivElement | null>(null)

    // Rebuilt only when its inputs move. Panning and zooming re-render on every
    // pointer and wheel event, so an unmemoized graph would be rebuilt at that
    // rate; the inputs are all stable references between changes (selector
    // snapshots, and the Sets this plugin replaces rather than mutates).
    const graph = React.useMemo(() => {
      const lines: LineState = { global: showPrompts, opened: openedLines, collapsed: collapsedLines }
      return buildGraph(ids, byId, workspaces, hideSubagents, lines, expandedInherited)
    }, [ids, byId, workspaces, hideSubagents, showPrompts, openedLines, collapsedLines, expandedInherited])

    const panelSize = (): PanelSize => {
      const element = panelRef.current
      if (element === null) return { width: 900, height: 520 }
      return { width: element.clientWidth, height: element.clientHeight }
    }

    const fit = (): void => {
      const size = panelSize()
      const scale = clampNumber(
        Math.min(
          (size.width - PAD * 2) / Math.max(graph.width, 1),
          (size.height - PAD * 2) / Math.max(graph.height, 1),
        ),
        MIN_ZOOM,
        BASE_ZOOM,
      )
      setView({
        zoom: scale,
        x: (size.width - graph.width * scale) / 2,
        y: (size.height - graph.height * scale) / 2,
      })
    }

    const centerOn = (node: GraphNode, zoom: number): void => {
      const size = panelSize()
      setView({
        zoom,
        x: size.width / 2 - (node.x + NODE_W / 2) * zoom,
        y: size.height / 2 - (node.y + NODE_H / 2) * zoom,
      })
    }

    // Center the canvas on the Session the app is showing and magnify it: the
    // point of the gesture is reading that neighbourhood, not seeing the whole
    // graph. Falls back to fitting when that Session has no node here (filtered
    // out, or not in the list).
    const focusCurrent = (): void => {
      const node = graph.nodes.find(candidate => candidate.id === current)
      if (node === undefined) {
        fit()
        return
      }
      centerOn(node, BASE_ZOOM)
    }

    // A toggle changes the shape of the graph under a view that was placed for
    // the old one. Declared BEFORE the placement effect so a mount places
    // exactly once, and keyed on the values so a toggle made in the other seat
    // re-places this one too.
    // Both placement effects run in the layout phase, before the browser paints.
    // The View is session-scoped, so switching Session remounts it and the
    // transform starts over at its initial value; a post-paint correction would
    // show that first frame — the graph's top-left corner at the baseline zoom —
    // before snapping to the placed one.
    React.useLayoutEffect(() => { setPlaced(false) }, [showPrompts, hideSubagents])

    React.useLayoutEffect(() => {
      if (placed || graph.nodes.length === 0) return
      setPlaced(true)
      const size = panelSize()
      const scale = Math.min(
        (size.width - PAD * 2) / Math.max(graph.width, 1),
        (size.height - PAD * 2) / Math.max(graph.height, 1),
      )
      // Show the whole graph only while it is still readable at the baseline; a
      // narrow column (the right sidebar) would otherwise shrink it to
      // unreadable type, so there it opens on the current Session instead.
      if (scale >= BASE_ZOOM) fit()
      else focusCurrent()
    })

    React.useEffect(() => {
      const element = panelRef.current
      if (element === null) return undefined
      // React registers `onWheel` on its root container as a PASSIVE listener,
      // where preventDefault() is ignored. This panel is not a scroll container,
      // so it owns the wheel outright: plain wheel pans the canvas, shifted
      // wheel pans it sideways, ctrl (or cmd) zooms.
      const onWheel = (event: WheelEvent): void => {
        // One wheel notch is a pixel delta in one browser and a line count in
        // another; normalise before using it.
        const unit = event.deltaMode === 1 ? WHEEL_LINE
          : event.deltaMode === 2 ? element.clientHeight : 1
        event.preventDefault()
        if (event.ctrlKey || event.metaKey) {
          const rect = element.getBoundingClientRect()
          const pointerX = event.clientX - rect.left
          const pointerY = event.clientY - rect.top
          // A trackpad pinch is a burst of small deltas, so the base is what its
          // sensitivity comes from; the cap only ever bites on a coarse wheel
          // notch, which would otherwise land as one big jump.
          const factor = clampNumber(
            Math.pow(WHEEL_ZOOM_BASE, -event.deltaY * unit),
            1 / WHEEL_ZOOM_MAX_STEP,
            WHEEL_ZOOM_MAX_STEP,
          )
          setView(previous => {
            const zoom = clampNumber(previous.zoom * factor, MIN_ZOOM, MAX_ZOOM)
            if (zoom === previous.zoom) return previous
            const ratio = zoom / previous.zoom
            return {
              zoom,
              x: pointerX - (pointerX - previous.x) * ratio,
              y: pointerY - (pointerY - previous.y) * ratio,
            }
          })
          return
        }
        // A browser that already reports the shifted gesture as deltaX keeps it;
        // one that only reports deltaY is read sideways.
        const sideways = event.shiftKey
        const across = (sideways && event.deltaX === 0 ? event.deltaY : event.deltaX) * unit
        const down = (sideways ? 0 : event.deltaY) * unit
        if (across === 0 && down === 0) return
        setView(previous => ({ zoom: previous.zoom, x: previous.x - across, y: previous.y - down }))
      }
      element.addEventListener('wheel', onWheel, { passive: false })
      return () => { element.removeEventListener('wheel', onWheel) }
    }, [])

    // Anchored at the panel centre, so changing the scale never moves the
    // reader to a different part of the graph.
    const zoomBy = (factor: number): void => {
      setView(previous => {
        const zoom = clampNumber(previous.zoom * factor, MIN_ZOOM, MAX_ZOOM)
        if (zoom === previous.zoom) return previous
        const size = panelSize()
        const ratio = zoom / previous.zoom
        return {
          zoom,
          x: size.width / 2 - (size.width / 2 - previous.x) * ratio,
          y: size.height / 2 - (size.height / 2 - previous.y) * ratio,
        }
      })
    }

    const setLineOpen = (sessionId: string, open: boolean): void => {
      if (showPrompts) {
        setCollapsedLines(withMember(collapsedLines, sessionId, !open))
        return
      }
      setOpenedLines(withMember(openedLines, sessionId, open))
    }

    const toggleInherited = (sessionId: string): void => {
      setExpandedInherited(withMember(expandedInherited, sessionId, !expandedInherited.has(sessionId)))
    }

    const onPointerDown = (event: React.PointerEvent<HTMLDivElement>): void => {
      const target: EventTarget = event.target
      if (target instanceof Element && target.closest('[data-dsm-hit]') !== null) return
      // A press on the canvas dismisses the popovers before it becomes a pan,
      // the same way a click outside a menu closes it.
      if (menuTarget !== null) setMenuTarget(null)
      if (helpOpen) setHelpOpen(false)
      // Cancelling the default here stops the browser from beginning a native
      // text selection for this drag. Presses that start on a target returned
      // above, so their click behavior is untouched.
      event.preventDefault()
      const element = event.currentTarget
      if (typeof element.setPointerCapture === 'function') {
        try {
          element.setPointerCapture(event.pointerId)
        } catch {
          // Pointer capture is best-effort: an id the browser already released
          // throws, and panning still works while the pointer stays inside.
        }
      }
      setDrag({ pointerX: event.clientX, pointerY: event.clientY, x: view.x, y: view.y })
    }

    const onPointerMove = (event: React.PointerEvent<HTMLDivElement>): void => {
      if (drag === null) return
      setView({
        zoom: view.zoom,
        x: drag.x + (event.clientX - drag.pointerX),
        y: drag.y + (event.clientY - drag.pointerY),
      })
    }

    const onPointerEnd = (): void => {
      if (drag !== null) setDrag(null)
    }

    const openHere = (): void => {
      try {
        openInRightbar(runtime, MAP_KIND)
        setError(null)
      } catch (cause) {
        setError(errorText(cause))
      }
    }

    // Placed in panel coordinates on every render, so it stays pinned to its
    // target while panning and keeps a legible size at any canvas scale. A
    // Session card and a turn bead share the popover, because the confirmation
    // gesture is the same for both.
    const menuTargetId = menuTarget === null ? null : menuTarget.id
    const menuNode = menuTarget !== null && menuTarget.kind === 'node'
      ? graph.nodes.find(candidate => candidate.id === menuTargetId)
      : undefined
    const menuBead = menuTarget !== null && menuTarget.kind === 'bead'
      ? graph.beads.find(candidate => candidate.id === menuTargetId)
      : undefined
    const menuAnchor = menuNode !== undefined
      ? { x: menuNode.x, y: menuNode.y, w: NODE_W, h: NODE_H, title: menuNode.title, sessionId: menuNode.id }
      : menuBead !== undefined
        ? { x: menuBead.x, y: menuBead.y, w: BEAD_W, h: BEAD_H, title: menuBead.title, sessionId: menuBead.owner }
        : undefined
    let menu: React.ReactElement | null = null
    if (menuAnchor !== undefined) {
      const panel = panelSize()
      const zoom = view.zoom
      const box = menuAnchor
      let left = view.x + (box.x + box.w) * zoom + 10
      if (left + MENU_W > panel.width - MENU_INSET) {
        left = view.x + box.x * zoom - MENU_W - 10
      }
      let top = view.y + box.y * zoom
      if (top + MENU_H > panel.height - MENU_INSET) top = panel.height - MENU_H - MENU_INSET
      if (left < MENU_INSET) left = MENU_INSET
      if (top < MENU_INSET) top = MENU_INSET

      const items: React.ReactElement[] = [React.createElement('button', {
        key: 'jump',
        type: 'button',
        className: 'dsm__menuItem',
        onClick: () => {
          setMenuTarget(null)
          // Sampled before the switch: afterwards the same question would be
          // about the Session being navigated to, not the one being left.
          const follows = sidebarShowsMap(runtime)
          runtime.openSession(box.sessionId)
          if (follows) followMapIntoNextSession(runtime)
        },
      }, '跳转到该会话')]
      if (menuNode !== undefined) {
        items.push(React.createElement('button', {
          key: 'center',
          type: 'button',
          className: 'dsm__menuItem',
          onClick: () => {
            setMenuTarget(null)
            centerOn(menuNode, view.zoom)
          },
        }, '在画布中居中'))
      }
      items.push(React.createElement('button', {
        key: 'cancel',
        type: 'button',
        className: 'dsm__menuItem',
        onClick: () => { setMenuTarget(null) },
      }, '取消'))

      menu = React.createElement(
        'div',
        {
          className: 'dsm__menu',
          style: { left: left + 'px', top: top + 'px', width: MENU_W + 'px' },
          // Keeps a press inside the popover from reaching the pan handler.
          onPointerDown: (event: React.PointerEvent<HTMLDivElement>) => { event.stopPropagation() },
        },
        React.createElement('div', { className: 'dsm__menuTitle', title: box.title }, box.title),
        items,
        menuBead === undefined ? null : React.createElement(
          'div',
          { className: 'dsm__menuNote' },
          '当前只能定位到会话，不能定位到具体轮次。',
        ),
      )
    }

    const help = React.createElement(
      'span',
      { className: 'dsm__help' },
      React.createElement(
        'button',
        {
          type: 'button',
          className: 'dsm__btn dsm__helpBtn',
          'data-open': helpOpen ? 'true' : 'false',
          title: '操作提示',
          'aria-label': '操作提示',
          'aria-expanded': helpOpen ? 'true' : 'false',
          onClick: () => { setHelpOpen(!helpOpen) },
        },
        KEYBOARD_GLYPH,
      ),
      helpOpen
        ? React.createElement(
          'div',
          { className: 'dsm__helpPanel' },
          helpRow('滚轮', '上下平移画布'),
          helpRow('Shift + 滚轮', '左右平移画布'),
          helpRow('Ctrl / ⌘ + 滚轮', '缩放'),
          helpRow('拖动空白处', '平移画布'),
          helpRow('点击节点', '打开操作菜单'),
          helpRow('点击链首标记', '展开 / 收起该线输入'),
          helpRow('点击输入珠子', '打开该轮的操作'),
        )
        : null,
    )

    const bar = React.createElement(
      'div',
      { className: 'dsm__bar' },
      React.createElement('span', { className: 'dsm__title' }, '会话图谱'),
      React.createElement(
        'span',
        { className: 'dsm__meta' },
        String(graph.sessionCount) + ' 个会话 · ' + String(graph.treeCount) + ' 棵树'
        + (graph.outlineCount > 0
          ? ' · ' + String(graph.openCount) + '/' + String(graph.sessionCount) + ' 条线展开'
          : '')
        // The toolbar's own scale: BASE_ZOOM reads as 100%.
        + ' · ' + String(Math.round(view.zoom / BASE_ZOOM * 100)) + '%',
      ),
      React.createElement('span', { className: 'dsm__spacer' }),
      showRightbarButton
        ? React.createElement('button', { type: 'button', className: 'dsm__btn', onClick: openHere }, '在右侧栏打开')
        : null,
      React.createElement(
        'label',
        { className: 'dsm__toggle', title: '一次铺开所有会话的用户输入；关闭后可以逐条线单独展开' },
        React.createElement('input', {
          type: 'checkbox',
          checked: showPrompts,
          onChange: () => { setShowPrompts(!showPrompts) },
        }),
        '全局显示用户输入',
      ),
      React.createElement(
        'label',
        { className: 'dsm__toggle' },
        React.createElement('input', {
          type: 'checkbox',
          checked: hideSubagents,
          onChange: event => { setHideSubagents(event.currentTarget.checked) },
        }),
        '隐藏子代理会话',
      ),
      React.createElement('button', { type: 'button', className: 'dsm__btn', onClick: () => { zoomBy(1 / 1.25) } }, '−'),
      React.createElement('button', { type: 'button', className: 'dsm__btn', onClick: () => { zoomBy(1.25) } }, '+'),
      React.createElement('button', { type: 'button', className: 'dsm__btn', onClick: focusCurrent }, '定位当前'),
      React.createElement('button', { type: 'button', className: 'dsm__btn', onClick: fit }, '适应窗口'),
      React.createElement('button', {
        type: 'button',
        className: 'dsm__btn',
        onClick: () => { zoomBy(BASE_ZOOM / view.zoom) },
      }, '100%'),
      help,
      showPrompts && graph.outlineCount === 0
        ? React.createElement('span', { className: 'dsm__error' }, '列表里没有 turnOutline 投影，读不到用户输入')
        : null,
      error === null ? null : React.createElement('span', { className: 'dsm__error' }, error),
    )

    const stage = graph.nodes.length === 0
      ? React.createElement('div', { className: 'dsm__empty' }, '还没有任何会话')
      : React.createElement(
        'div',
        {
          className: 'dsm__stage',
          style: {
            width: graph.width + 'px',
            height: graph.height + 'px',
            transform: 'translate(' + view.x + 'px, ' + view.y + 'px) scale(' + view.zoom + ')',
          },
        },
        React.createElement(
          'svg',
          { className: 'dsm__svg', width: graph.width, height: graph.height },
          graph.edges.map(edge => React.createElement('path', {
            key: edge.key,
            d: edge.d,
            className: EDGE_CLASS[edge.kind],
          })),
        ),
        graph.captions.map(caption => React.createElement('div', {
          key: caption.key,
          className: 'dsm__caption',
          style: { left: caption.x + 'px', top: caption.y + 'px' },
        }, caption.text)),
        graph.beads.map(bead => React.createElement(
          'button',
          {
            key: bead.id,
            type: 'button',
            'data-dsm-hit': 'bead',
            'data-menu': bead.id === menuTargetId ? 'true' : 'false',
            className: 'dsm__bead',
            style: {
              left: bead.x + 'px',
              top: bead.y + 'px',
              width: BEAD_W + 'px',
              height: BEAD_H + 'px',
            },
            title: bead.title,
            onClick: () => { setMenuTarget({ kind: 'bead', id: bead.id }) },
          },
          bead.title,
        )),
        graph.markers.map(marker => React.createElement(
          'button',
          {
            key: marker.id,
            type: 'button',
            'data-dsm-hit': marker.kind,
            'data-kind': marker.kind,
            className: 'dsm__marker',
            style: {
              left: marker.x + 'px',
              top: marker.y + 'px',
              width: MARKER_W + 'px',
              height: BEAD_H + 'px',
            },
            title: marker.kind === 'line'
              ? (marker.open
                ? '收起这条线的 ' + String(marker.count) + ' 轮用户输入'
                : '展开这条线的 ' + String(marker.count) + ' 轮用户输入')
              : ('前 ' + String(marker.count) + ' 轮继承自父会话，已显示在父会话的链上。'
                + (marker.open ? '点击折叠' : '点击展开')),
            onClick: () => {
              if (marker.kind === 'line') setLineOpen(marker.sessionId, !marker.open)
              else toggleInherited(marker.sessionId)
            },
          },
          (marker.open ? '− ' : '+ ') + String(marker.count)
          + (marker.kind === 'line' ? ' 输入' : ' 继承'),
        )),
        graph.nodes.map(node => React.createElement(
          'button',
          {
            key: node.id,
            type: 'button',
            'data-dsm-hit': 'node',
            'data-current': node.id === current ? 'true' : 'false',
            'data-subagent': node.subagent ? 'true' : 'false',
            'data-menu': node.id === menuTargetId ? 'true' : 'false',
            className: 'dsm__node',
            style: {
              left: node.x + 'px',
              top: node.y + 'px',
              width: NODE_W + 'px',
              height: NODE_H + 'px',
            },
            title: node.title,
            onClick: () => { setMenuTarget({ kind: 'node', id: node.id }) },
          },
          React.createElement('span', { className: 'dsm__nodeTitle' }, node.title),
          React.createElement(
            'span',
            { className: 'dsm__nodeMeta' },
            React.createElement('span', {
              className: 'dsm__dot',
              'data-state': node.running ? 'running' : (node.completed ? 'completed' : 'idle'),
            }),
            node.running ? '运行中' : (node.completed ? '已完成' : '空闲'),
            node.childCount > 0 ? ' · ' + node.childCount + ' 分支' : '',
            node.subagent ? ' · 子代理' : '',
            node.inheritedCount > 0 ? ' · 继承 ' + node.inheritedCount : '',
          ),
        )),
      )

    return React.createElement(
      'div',
      { className: 'dsm' },
      bar,
      React.createElement(
        'div',
        {
          className: 'dsm__panel',
          'data-dragging': drag === null ? 'false' : 'true',
          ref: panelRef,
          onPointerDown,
          onPointerMove,
          onPointerUp: onPointerEnd,
          onPointerCancel: onPointerEnd,
        },
        stage,
        menu,
      ),
    )
  }
  return SessionMapView
}
