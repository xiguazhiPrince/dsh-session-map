/**
 * Canvas construction: the fork tree over every listed Session, the outgoing
 * wire each Session's turns are threaded on, and the fold capsules that stand
 * in for turns shown elsewhere.
 *
 * Everything here is a pure function of the listed Sessions, the Workspace
 * membership, and the line/fold switches, so equal inputs always produce an
 * equal layout and the Views can rebuild it on every render.
 *
 * @module dsh-session-map/client/graph
 */
import {
  BEAD_GAP,
  BEAD_H,
  BEAD_LEAD,
  BEAD_PITCH,
  BEAD_PITCH_Y,
  BEAD_W,
  BRANCH_GAP,
  CAPTION_H,
  COLUMN_GAP,
  COLUMN_PITCH,
  GAP_Y,
  MARKER_W,
  NODE_H,
  NODE_W,
  PAD,
  ROW,
  TREE_GAP,
  type EdgeKind,
} from './constants'

/** One listed Session as the map reads it: the Session list row, narrowed. */
export interface SessionSummary {
  readonly id: string
  readonly displayTitle: string
  readonly parentId?: string | undefined
  readonly origin?: 'subagent' | undefined
  readonly running?: boolean | undefined
  readonly completed?: boolean | undefined
  readonly updatedAt?: number | undefined
  /**
   * Retention counts by holder, as the Session controller publishes them. The
   * foreground Session is the one the main view retains; see
   * {@link mainSessionId}.
   */
  readonly retainedBy?: Readonly<Record<string, number>> | undefined
  /** Host-computed projection values; every field is wire data and re-checked before use. */
  readonly projectionValues?: Readonly<Record<string, unknown>> | null | undefined
}

/**
 * The Session the app is showing, taken from the listed rows.
 *
 * The Session list snapshot carries no `current` field: the controller publishes
 * `{ ids, byId, phase, projectionsBySession }` and every shipped package derives
 * the foreground Session as the row the main view retains. A row without
 * retention counts is not it, so a list that has not been adopted yet answers
 * `undefined` rather than naming an arbitrary Session.
 * @param byId - listed Session summaries, in host order.
 * @returns the retained Session's id, or `undefined` when nothing retains one.
 */
export function mainSessionId(byId: Readonly<Record<string, SessionSummary>>): string | undefined {
  for (const id of Object.keys(byId)) {
    if ((byId[id]?.retainedBy?.mainView ?? 0) > 0) return id
  }
  return undefined
}

/**
 * The root of one listed Session's fork tree: the last ancestor the row map
 * still lists.
 *
 * A tree on this canvas is the connected component of the parent links, so its
 * root is the node whose own parent is absent or unlisted. The walk stops at an
 * already-visited id as well, so a Session whose ancestry loops answers with
 * itself rather than never returning; that is the same fallback
 * {@link buildGraph}'s own parent walk takes.
 * @param id - the Session to resolve.
 * @param byId - listed Session summaries.
 * @returns the root ancestor's id, which is `id` itself for a root.
 */
export function treeRootId(id: string, byId: Readonly<Record<string, SessionSummary>>): string {
  const seen: Record<string, true> = {}
  seen[id] = true
  let current = id
  let parentId = byId[current]?.parentId
  while (parentId !== undefined && seen[parentId] !== true) {
    if (byId[parentId] === undefined) return current
    seen[parentId] = true
    current = parentId
    parentId = byId[current]?.parentId
  }
  return current
}

/** One Workspace group as the map reads it, for tree order and captions. */
export interface WorkspaceGroup {
  readonly sessionIds: readonly string[]
  readonly title?: string | undefined
  readonly path?: string | undefined
}

/** Which lines are open, as the two override sets the toolbar switch reads through. */
export interface LineState {
  /** The global switch: every line is open unless it was explicitly collapsed. */
  readonly global: boolean
  /** Lines explicitly opened while the switch is off. */
  readonly opened: ReadonlySet<string>
  /** Lines explicitly collapsed while the switch is on. */
  readonly collapsed: ReadonlySet<string>
}

/** One placed Session card. */
export interface GraphNode {
  readonly id: string
  readonly title: string
  /** The hosting Session this node hangs from, resolved past unlisted ancestors. */
  parentId: string | undefined
  readonly running: boolean
  readonly completed: boolean
  readonly subagent: boolean
  /** Turns this Session's own outline reports. */
  beadCount: number
  /** Leading turns this Session's log inherited from its parent. */
  inheritedCount: number
  /** Whether this Session's turns are currently drawn on its wire. */
  turnsOpen: boolean
  readonly updatedAt: number
  /** Direct children drawn under this card. */
  childCount: number
  /** Band the card occupies across the tree's growth axis; turns never take one. */
  band: number
  x: number
  y: number
  /** Where the card's wire ends, measured along the tree's growth axis. */
  outAlong: number
}

/** One drawn connector. */
export interface GraphEdge {
  readonly key: string
  readonly kind: EdgeKind
  readonly d: string
}

/** One user turn as a clickable bead on its Session's wire. */
export interface GraphBead {
  readonly id: string
  /** Session this turn belongs to. */
  readonly owner: string
  /** One-based turn number. */
  readonly ordinal: number
  readonly x: number
  readonly y: number
  readonly title: string
}

/**
 * One line-state or inherited-prefix capsule: either this Session's turns are
 * hidden and it carries a plus count, or they are drawn and it carries a minus
 * count that collapses them again.
 */
export interface GraphMarker {
  readonly id: string
  readonly kind: 'line' | 'fold'
  readonly sessionId: string
  readonly x: number
  readonly y: number
  readonly count: number
  readonly open: boolean
}

/** One tree's caption. */
export interface GraphCaption {
  readonly key: string
  readonly x: number
  readonly y: number
  readonly text: string
}

/** The positioned canvas: everything the View draws, plus the bar's figures. */
export interface Graph {
  readonly nodes: readonly GraphNode[]
  readonly beads: readonly GraphBead[]
  readonly markers: readonly GraphMarker[]
  readonly edges: readonly GraphEdge[]
  readonly captions: readonly GraphCaption[]
  /** Listed Sessions drawn on the canvas. */
  readonly sessionCount: number
  /** Turns the listed Sessions' outlines report in total. */
  readonly outlineCount: number
  /** Lines currently drawn open. */
  readonly openCount: number
  readonly width: number
  readonly height: number
  /** Fork trees on the canvas. */
  readonly treeCount: number
  /**
   * The Session the canvas was restricted to, or `undefined` when every listed
   * Session was drawn. A request the list cannot satisfy — its Session is not
   * among the rows — draws everything and reports `undefined` here.
   */
  readonly scopeSessionId: string | undefined
}

/** Which way a fork tree grows across the canvas. */
export type TreeDirection = 'vertical' | 'horizontal'

/**
 * The two screen axes one direction lays a tree out on, plus the sizes that
 * belong to them.
 *
 * A tree is a depth axis and a band axis: every card sits one branch further
 * along than its parent, and siblings occupy bands across that axis. Growing
 * downward puts depth on y and bands on x; growing rightward swaps the two. The
 * layout below is written once, in `along` and `across`, and only these numbers
 * and the final box swap tell the two directions apart — the walk, the wires,
 * the capsules and the figures are the same code.
 */
interface GrowthAxis {
  /** Whether the tree grows downward, i.e. along the screen's y axis. */
  readonly vertical: boolean
  /** Extent of one Session card along the growth axis. */
  readonly nodeAlong: number
  /** Extent of one Session card across the growth axis. */
  readonly nodeAcross: number
  /** Extent of one turn bead along the growth axis. */
  readonly beadAlong: number
  /** Extent of one turn bead across the growth axis. */
  readonly beadAcross: number
  /** Distance between the starts of two consecutive beads. */
  readonly beadPitch: number
  /** Extent of one line or fold capsule along the growth axis. */
  readonly markerAlong: number
  /** Extent of one line or fold capsule across the growth axis. */
  readonly markerAcross: number
  /** Gap between a card's far edge and the first capsule on its wire. */
  readonly lead: number
  /** Distance between two adjacent bands across the growth axis. */
  readonly bandPitch: number
  /** Gap left over inside the last band, before the next tree starts. */
  readonly bandSlack: number
  /** Gap kept between the far edge of one tree and the next tree. */
  readonly treeGap: number
}

/** Trees that grow rightward: depth along x, sibling bands down y. */
const RIGHTWARD: GrowthAxis = {
  vertical: false,
  nodeAlong: NODE_W,
  nodeAcross: NODE_H,
  beadAlong: BEAD_W,
  beadAcross: BEAD_H,
  beadPitch: BEAD_PITCH,
  markerAlong: MARKER_W,
  markerAcross: BEAD_H,
  lead: BEAD_LEAD,
  bandPitch: ROW,
  // The slack the last row leaves inside its band: the same gap the next tree
  // used to be pushed down by.
  bandSlack: GAP_Y,
  treeGap: TREE_GAP,
}

/** Trees that grow downward: depth along y, sibling bands across x. */
const DOWNWARD: GrowthAxis = {
  vertical: true,
  nodeAlong: NODE_H,
  nodeAcross: NODE_W,
  beadAlong: BEAD_H,
  beadAcross: BEAD_W,
  beadPitch: BEAD_PITCH_Y,
  markerAlong: BEAD_H,
  markerAcross: MARKER_W,
  lead: BEAD_LEAD,
  bandPitch: COLUMN_PITCH,
  bandSlack: COLUMN_GAP,
  treeGap: TREE_GAP,
}

/** One stage rectangle. */
interface Box {
  readonly x: number
  readonly y: number
  readonly w: number
  readonly h: number
}

/**
 * Place one box given its position and size on the growth and band axes.
 * @param axis - the direction in force.
 * @param along - position along the growth axis.
 * @param across - position across the growth axis.
 * @param alongSize - extent along the growth axis.
 * @param acrossSize - extent across the growth axis.
 * @returns the same rectangle in stage coordinates.
 */
function boxOf(axis: GrowthAxis, along: number, across: number, alongSize: number, acrossSize: number): Box {
  return axis.vertical
    ? { x: across, y: along, w: acrossSize, h: alongSize }
    : { x: along, y: across, w: alongSize, h: acrossSize }
}

/**
 * The line one card's wire is threaded on: the middle of the edge its turns
 * leave from.
 * @param axis - the direction in force.
 * @param node - the placed card.
 * @returns the wire's coordinate across the growth axis.
 */
function crossCentre(axis: GrowthAxis, node: GraphNode): number {
  return axis.vertical ? node.x + NODE_W / 2 : node.y + NODE_H / 2
}

/**
 * The card edge its own wire leaves from.
 * @param axis - the direction in force.
 * @param node - the placed card.
 * @returns the coordinate along the growth axis.
 */
function farEdge(axis: GrowthAxis, node: GraphNode): number {
  return axis.vertical ? node.y + NODE_H : node.x + NODE_W
}

/**
 * The card edge a branch arrives at.
 * @param axis - the direction in force.
 * @param node - the placed card.
 * @returns the coordinate along the growth axis.
 */
function nearEdge(axis: GrowthAxis, node: GraphNode): number {
  return axis.vertical ? node.y : node.x
}

/**
 * The straight run from a card's far edge to the end of its wire.
 * @param axis - the direction in force.
 * @param node - the placed card.
 * @returns the path data.
 */
function wirePath(axis: GrowthAxis, node: GraphNode): string {
  const centre = crossCentre(axis, node)
  const from = farEdge(axis, node)
  return axis.vertical
    ? 'M ' + centre + ' ' + from + ' L ' + centre + ' ' + node.outAlong
    : 'M ' + from + ' ' + centre + ' L ' + node.outAlong + ' ' + centre
}

/**
 * The bezier joining one card's wire end to a child card's near edge.
 * @param axis - the direction in force.
 * @param from - the parent card.
 * @param to - the child card.
 * @returns the path data.
 */
function edgePath(axis: GrowthAxis, from: GraphNode, to: GraphNode): string {
  const x1 = axis.vertical ? crossCentre(axis, from) : from.outAlong
  const y1 = axis.vertical ? from.outAlong : crossCentre(axis, from)
  const x2 = axis.vertical ? crossCentre(axis, to) : nearEdge(axis, to)
  const y2 = axis.vertical ? nearEdge(axis, to) : crossCentre(axis, to)
  const bend = axis.vertical ? Math.max(18, (y2 - y1) / 2) : Math.max(18, (x2 - x1) / 2)
  return axis.vertical
    ? 'M ' + x1 + ' ' + y1 + ' C ' + x1 + ' ' + (y1 + bend) + ' ' + x2 + ' ' + (y2 - bend) + ' ' + x2 + ' ' + y2
    : 'M ' + x1 + ' ' + y1 + ' C ' + (x1 + bend) + ' ' + y1 + ' ' + (x2 - bend) + ' ' + y2 + ' ' + x2 + ' ' + y2
}

/** One turn's compared identity: the two bounded previews the Host projected. */
interface TurnPreview {
  readonly prompt: string
  readonly response: string
}

/** The label a Session card shows: its projected title, or its id when it has none. */
function sessionLabel(summary: SessionSummary, id: string): string {
  const title = summary.displayTitle
  if (typeof title === 'string' && title !== '') return title
  return String(id)
}

/** One turn's compared identity: the two bounded previews the Host projected. */
function previewOf(entry: unknown): TurnPreview {
  const record: unknown = typeof entry === 'object' && entry !== null ? entry : undefined
  const prompt = record === undefined ? undefined : (record as { readonly prompt?: unknown }).prompt
  const response = record === undefined ? undefined : (record as { readonly response?: unknown }).response
  return {
    prompt: typeof prompt === 'string' ? prompt : '',
    response: typeof response === 'string' ? response : '',
  }
}

/** Whether two outlines carry the same turn at one position. */
function sameTurn(left: TurnPreview | undefined, right: TurnPreview | undefined): boolean {
  if (left === undefined || right === undefined) return false
  return left.prompt === right.prompt && left.response === right.response
}

/** The turn outline a listed Session's own projection values carry, if any. */
function outlineOf(summary: SessionSummary | undefined): readonly unknown[] | undefined {
  if (summary === undefined) return undefined
  const values = summary.projectionValues
  if (values === undefined || values === null) return undefined
  const outline = values.turnOutline
  if (!Array.isArray(outline)) return undefined
  const entries: readonly unknown[] = outline
  return entries
}

/**
 * Build the canvas: nodes, their wire, the turn beads, and the fold markers.
 * @param ids - listed Session ids in host order.
 * @param byId - listed Session summaries.
 * @param workspaces - Workspace membership, for tree order and captions.
 * @param hideSubagents - whether subagent-origin Sessions are filtered out.
 * @param lines - global bead switch plus each per-line override set.
 * @param expandedInherited - Session ids whose inherited prefix is expanded.
 * @param scopeSessionId - when given, draw only this Session's own tree; an id
 * the row map does not carry is ignored and every listed Session is drawn.
 * @param direction - which way the trees grow.
 * @returns the positioned graph.
 */
export function buildGraph(
  ids: readonly string[],
  byId: Readonly<Record<string, SessionSummary>>,
  workspaces: readonly WorkspaceGroup[],
  hideSubagents: boolean,
  lines: LineState,
  expandedInherited: ReadonlySet<string>,
  scopeSessionId: string | undefined,
  direction: TreeDirection,
): Graph {
  // The canvas draws either every listed Session or one Session's whole tree.
  // The tree is the connected component of the parent links, so the Session
  // being read keeps its ancestors, every branch forked off beside it, and all
  // of their descendants. A scope the list cannot satisfy — the foreground
  // Session is not among the rows — falls back to everything rather than to an
  // empty canvas, and `scopeId` reports which of the two happened.
  let drawnIds = ids
  let scopeId: string | undefined
  if (scopeSessionId !== undefined && byId[scopeSessionId] !== undefined) {
    const root = treeRootId(scopeSessionId, byId)
    const members = ids.filter(id => treeRootId(id, byId) === root)
    if (members.length > 0) {
      drawnIds = members
      scopeId = scopeSessionId
    }
  }

  const nodes: Record<string, GraphNode> = {}
  const ordered: GraphNode[] = []
  const outlines: Record<string, readonly TurnPreview[]> = {}
  let outlineCount = 0
  for (const id of drawnIds) {
    const summary = byId[id]
    if (summary === undefined) continue
    if (hideSubagents && summary.origin === 'subagent') continue
    const node: GraphNode = {
      id,
      title: sessionLabel(summary, id),
      parentId: summary.parentId,
      running: summary.running === true,
      completed: summary.completed === true,
      subagent: summary.origin === 'subagent',
      beadCount: 0,
      inheritedCount: 0,
      turnsOpen: false,
      updatedAt: typeof summary.updatedAt === 'number' ? summary.updatedAt : 0,
      childCount: 0,
      band: 0,
      x: 0,
      y: 0,
      outAlong: 0,
    }
    nodes[id] = node
    ordered.push(node)
    // Outlines are read whether or not a line is currently open: a closed line
    // still needs its turn count for the marker that opens it.
    const outline = outlineOf(summary)
    if (outline === undefined) continue
    outlines[id] = outline.map(previewOf)
    node.beadCount = outline.length
    outlineCount += outline.length
  }

  // A fork child's log BEGINS with a copy of its parent's events, so its turn
  // outline opens with every turn the parent already had. Those leading turns
  // are already drawn on the parent's own chain; folding them needs no boundary
  // from the Host, only a positional match against the parent's outline.
  for (const node of ordered) {
    const id = node.id
    const summary = byId[id]
    const own = outlines[id]
    const parentId = summary === undefined ? undefined : summary.parentId
    if (own === undefined || parentId === undefined) continue
    const parentOutline = outlines[parentId]
    if (parentOutline === undefined) continue
    let shared = 0
    while (shared < own.length && shared < parentOutline.length && sameTurn(own[shared], parentOutline[shared])) {
      shared += 1
    }
    node.inheritedCount = shared
  }

  // Openness is decided per line by the mode in force. A closed line records
  // an explicit open, an open one an explicit collapse, so flipping the global
  // switch restores what the other mode had, instead of inverting it.
  for (const node of ordered) {
    node.turnsOpen = lines.global ? !lines.collapsed.has(node.id) : lines.opened.has(node.id)
  }

  // A pure fork tree: turns never take a band, so opening one leaves the
  // layout exactly as it was.
  const hostingParent = (node: GraphNode): string | undefined => {
    const seen: Record<string, boolean> = {}
    seen[node.id] = true
    let parentId = node.parentId
    while (parentId !== undefined) {
      if (seen[parentId] === true) return undefined
      seen[parentId] = true
      if (nodes[parentId] !== undefined) return parentId
      const parent = byId[parentId]
      if (parent === undefined) return undefined
      parentId = parent.parentId
    }
    return undefined
  }

  const childrenOf: Record<string, GraphNode[]> = {}
  const roots: GraphNode[] = []
  for (const node of ordered) {
    const parentId = hostingParent(node)
    if (parentId === undefined) {
      roots.push(node)
      continue
    }
    node.parentId = parentId
    const siblings = childrenOf[parentId]
    if (siblings === undefined) childrenOf[parentId] = [node]
    else siblings.push(node)
    const parent = nodes[parentId]
    if (parent !== undefined) parent.childCount += 1
  }

  // Tree order mirrors the left sidebar's own derivation (ui-workspace
  // tree.ts): Workspace groups in their stored order, and inside a group the
  // most recently active Session first (the browser's default sort, shown in
  // the UI as "按更新时间"). Sessions no Workspace accounts for trail last,
  // newest first. The sidebar's live mode and its drag order sit in
  // ui-workspace's private store, which a plugin cannot read, so the sidebar's
  // "手动排序" and "平铺" modes are not followed.
  const groupRank: Record<string, number> = {}
  for (const [group, workspace] of workspaces.entries()) {
    for (const member of workspace.sessionIds) {
      if (groupRank[member] === undefined) groupRank[member] = group
    }
  }
  const rankOf = (id: string): number => {
    const rank = groupRank[id]
    return rank === undefined ? workspaces.length : rank
  }
  roots.sort((left, right) => {
    const groupLeft = rankOf(left.id)
    const groupRight = rankOf(right.id)
    if (groupLeft !== groupRight) return groupLeft - groupRight
    if (left.updatedAt !== right.updatedAt) return right.updatedAt - left.updatedAt
    return left.id < right.id ? -1 : 1
  })

  const children = (id: string): readonly GraphNode[] => {
    const kids = childrenOf[id]
    return kids === undefined ? [] : kids
  }
  const axis = direction === 'vertical' ? DOWNWARD : RIGHTWARD
  const edges: GraphEdge[] = []
  const captions: GraphCaption[] = []
  const beads: GraphBead[] = []
  const markers: GraphMarker[] = []
  // The cursor that walks tree blocks: down the canvas for rightward trees,
  // across it for downward ones. `along` and `across` below are the growth axis
  // and the band axis of `axis`, in stage pixels.
  let treeCursor = 0
  let alongMax = 0

  for (let index = 0; index < roots.length; index += 1) {
    const root = roots[index]
    if (root === undefined) continue
    const visited: Record<string, boolean> = {}
    const collected: GraphNode[] = []
    let bandCursor = 0
    const walk = (node: GraphNode): void => {
      if (visited[node.id] === true) return
      visited[node.id] = true
      collected.push(node)
      const kids = children(node.id).filter(kid => visited[kid.id] !== true)
      if (kids.length === 0) {
        node.band = bandCursor
        bandCursor += 1
        return
      }
      for (const kid of kids) walk(kid)
      const first = kids[0]
      const last = kids[kids.length - 1]
      // `kids` is non-empty here, so the guard is total rather than reachable.
      node.band = first !== undefined && last !== undefined ? (first.band + last.band) / 2 : node.band
    }
    walk(root)

    // Bands are not a fixed grid either way: a Session's children start past
    // its own chain, so a long history pushes its branches further along the
    // growth axis rather than opening a parallel band. Pre-order visit puts
    // every parent before its children, so `outAlong` is always resolved when a
    // child reads it.
    const alongStart = axis.vertical ? CAPTION_H : PAD
    const acrossBase = axis.vertical ? treeCursor : treeCursor + CAPTION_H
    for (const node of collected) {
      const parent = node.parentId === undefined ? undefined : nodes[node.parentId]
      const along = parent === undefined ? alongStart : parent.outAlong + BRANCH_GAP
      const across = acrossBase + node.band * axis.bandPitch
      const card = boxOf(axis, along, across, axis.nodeAlong, axis.nodeAcross)
      node.x = card.x
      node.y = card.y
      // The wire leaves the middle of the card's far edge, so every capsule
      // hangs on the card's own centre line.
      const centre = across + axis.nodeAcross / 2
      let alongEnd = along + axis.nodeAlong
      const outline = outlines[node.id]
      if (outline !== undefined && outline.length > 0) {
        let cursor = alongEnd + axis.lead
        const line = boxOf(axis, cursor, centre - axis.markerAcross / 2, axis.markerAlong, axis.markerAcross)
        markers.push({
          id: node.id + '::line',
          kind: 'line',
          sessionId: node.id,
          x: line.x,
          y: line.y,
          count: outline.length,
          open: node.turnsOpen,
        })
        cursor += axis.markerAlong + BEAD_GAP
        alongEnd = cursor - BEAD_GAP
        if (node.turnsOpen) {
          // The inherited prefix is folded whenever the line is open, in either
          // mode: the capsule naming the count is itself the way back to those
          // turns, so collapsing them never puts them out of reach.
          const foldInherited = node.inheritedCount > 0
          const inheritedOpen = foldInherited && expandedInherited.has(node.id)
          let from = 0
          if (foldInherited) {
            const fold = boxOf(axis, cursor, centre - axis.markerAcross / 2, axis.markerAlong, axis.markerAcross)
            markers.push({
              id: node.id + '::fold',
              kind: 'fold',
              sessionId: node.id,
              x: fold.x,
              y: fold.y,
              count: node.inheritedCount,
              open: inheritedOpen,
            })
            cursor += axis.markerAlong + BEAD_GAP
            alongEnd = cursor - BEAD_GAP
            if (!inheritedOpen) from = node.inheritedCount
          }
          for (let turn = from; turn < outline.length; turn += 1) {
            const preview = outline[turn]
            const prompt = preview === undefined ? '' : preview.prompt
            const bead = boxOf(axis, cursor, centre - axis.beadAcross / 2, axis.beadAlong, axis.beadAcross)
            beads.push({
              id: String(node.id) + '::turn::' + String(turn),
              owner: node.id,
              ordinal: turn + 1,
              x: bead.x,
              y: bead.y,
              title: (turn + 1) + '. ' + (prompt === '' ? '(无提示预览)' : prompt),
            })
            cursor += axis.beadPitch
            alongEnd = cursor - BEAD_GAP
          }
        }
      }
      node.outAlong = alongEnd
      if (alongEnd > alongMax) alongMax = alongEnd
    }
    for (const node of collected) {
      if (node.outAlong > farEdge(axis, node)) {
        edges.push({ key: node.id + '>wire', kind: 'wire', d: wirePath(axis, node) })
      }
      for (const kid of children(node.id)) {
        if (visited[kid.id] !== true) continue
        edges.push({ key: node.id + '>' + kid.id, kind: kid.subagent ? 'sub' : 'branch', d: edgePath(axis, node, kid) })
      }
    }

    const owner = workspaces.find(item => item.sessionIds.indexOf(root.id) >= 0)
    const ownerTitle = owner === undefined ? '' : String(owner.title || owner.path)
    // The caption names its tree from the corner the cards grow away from:
    // above them for a rightward tree, over their left edge for a downward one.
    captions.push({
      key: 'caption-' + root.id,
      x: axis.vertical ? treeCursor : PAD,
      y: axis.vertical ? 0 : treeCursor,
      text: '会话树 ' + (index + 1) + (ownerTitle === '' ? ' · 未归属工作区' : ' · ' + ownerTitle),
    })
    treeCursor = acrossBase + bandCursor * axis.bandPitch - axis.bandSlack + axis.treeGap
  }

  return {
    nodes: ordered,
    beads,
    markers,
    edges,
    captions,
    sessionCount: ordered.length,
    outlineCount,
    openCount: markers.filter(marker => marker.kind === 'line' && marker.open).length,
    // The canvas spans what the trees span: for rightward trees that is the
    // furthest wire end across x and the last tree's bands down y; the downward
    // direction swaps the two.
    width: Math.max(axis.vertical ? treeCursor - axis.treeGap : alongMax, 0) + PAD * 2,
    height: Math.max(axis.vertical ? alongMax : treeCursor - axis.treeGap, 0) + PAD * 2,
    treeCount: roots.length,
    scopeSessionId: scopeId,
  }
}
