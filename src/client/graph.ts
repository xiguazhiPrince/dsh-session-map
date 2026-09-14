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
  BRANCH_GAP,
  CAPTION_H,
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
  /** Host-computed projection values; every field is wire data and re-checked before use. */
  readonly projectionValues?: Readonly<Record<string, unknown>> | null | undefined
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
  /** Row band the card occupies; turns never take one. */
  row: number
  x: number
  y: number
  /** Right edge of the card's wire, where its branches leave from. */
  outX: number
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

/** The bezier joining one card's wire end to a child card's left edge. */
function edgePath(from: GraphNode, to: GraphNode): string {
  const x1 = from.outX
  const y1 = from.y + NODE_H / 2
  const x2 = to.x
  const y2 = to.y + NODE_H / 2
  const bend = Math.max(18, (x2 - x1) / 2)
  return 'M ' + x1 + ' ' + y1 + ' C ' + (x1 + bend) + ' ' + y1 + ' ' + (x2 - bend) + ' ' + y2 + ' ' + x2 + ' ' + y2
}

/**
 * Build the canvas: nodes, their wire, the turn beads, and the fold markers.
 * @param ids - listed Session ids in host order.
 * @param byId - listed Session summaries.
 * @param workspaces - Workspace membership, for tree order and captions.
 * @param hideSubagents - whether subagent-origin Sessions are filtered out.
 * @param lines - global bead switch plus each per-line override set.
 * @param expandedInherited - Session ids whose inherited prefix is expanded.
 * @returns the positioned graph.
 */
export function buildGraph(
  ids: readonly string[],
  byId: Readonly<Record<string, SessionSummary>>,
  workspaces: readonly WorkspaceGroup[],
  hideSubagents: boolean,
  lines: LineState,
  expandedInherited: ReadonlySet<string>,
): Graph {
  const nodes: Record<string, GraphNode> = {}
  const ordered: GraphNode[] = []
  const outlines: Record<string, readonly TurnPreview[]> = {}
  let outlineCount = 0
  for (const id of ids) {
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
      row: 0,
      x: 0,
      y: 0,
      outX: 0,
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

  // A pure fork tree: turns never take a row, so opening one leaves the
  // vertical layout exactly as it was.
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
  // most recently active Session first (the browser's default 按更新时间).
  // Sessions no Workspace accounts for trail last, newest first. The sidebar's
  // live mode and its drag order sit in ui-workspace's private store, which a
  // plugin cannot read, so 手动排序 and 平铺 are not followed.
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
  const edges: GraphEdge[] = []
  const captions: GraphCaption[] = []
  const beads: GraphBead[] = []
  const markers: GraphMarker[] = []
  let cursorY = 0
  let width = 0

  for (let index = 0; index < roots.length; index += 1) {
    const root = roots[index]
    if (root === undefined) continue
    const visited: Record<string, boolean> = {}
    const collected: GraphNode[] = []
    let rowCursor = 0
    const walk = (node: GraphNode): void => {
      if (visited[node.id] === true) return
      visited[node.id] = true
      collected.push(node)
      const kids = children(node.id).filter(kid => visited[kid.id] !== true)
      if (kids.length === 0) {
        node.row = rowCursor
        rowCursor += 1
        return
      }
      for (const kid of kids) walk(kid)
      const first = kids[0]
      const last = kids[kids.length - 1]
      // `kids` is non-empty here, so the guard is total rather than reachable.
      node.row = first !== undefined && last !== undefined ? (first.row + last.row) / 2 : node.row
    }
    walk(root)

    const top = cursorY + CAPTION_H
    // Columns are no longer a fixed grid: a Session's children start after its
    // own chain, so a long history pushes its branches right rather than
    // opening a parallel column. Pre-order visit puts every parent before its
    // children, so `outX` is always resolved when a child reads it.
    for (const node of collected) {
      const parent = node.parentId === undefined ? undefined : nodes[node.parentId]
      node.x = parent === undefined ? PAD : parent.outX + BRANCH_GAP
      node.y = top + node.row * ROW

      let right = node.x + NODE_W
      const outline = outlines[node.id]
      if (outline !== undefined && outline.length > 0) {
        const beadY = node.y + NODE_H / 2 - BEAD_H / 2
        let cursor = right + BEAD_LEAD
        markers.push({
          id: node.id + '::line',
          kind: 'line',
          sessionId: node.id,
          x: cursor,
          y: beadY,
          count: outline.length,
          open: node.turnsOpen,
        })
        cursor += MARKER_W + BEAD_GAP
        right = cursor - BEAD_GAP
        if (node.turnsOpen) {
          // The inherited prefix is folded whenever the line is open, in either
          // mode: the capsule naming the count is itself the way back to those
          // turns, so collapsing them never puts them out of reach.
          const foldInherited = node.inheritedCount > 0
          const inheritedOpen = foldInherited && expandedInherited.has(node.id)
          let from = 0
          if (foldInherited) {
            markers.push({
              id: node.id + '::fold',
              kind: 'fold',
              sessionId: node.id,
              x: cursor,
              y: beadY,
              count: node.inheritedCount,
              open: inheritedOpen,
            })
            cursor += MARKER_W + BEAD_GAP
            right = cursor - BEAD_GAP
            if (!inheritedOpen) from = node.inheritedCount
          }
          for (let turn = from; turn < outline.length; turn += 1) {
            const preview = outline[turn]
            const prompt = preview === undefined ? '' : preview.prompt
            beads.push({
              id: String(node.id) + '::turn::' + String(turn),
              owner: node.id,
              ordinal: turn + 1,
              x: cursor,
              y: beadY,
              title: (turn + 1) + '. ' + (prompt === '' ? '(无提示预览)' : prompt),
            })
            cursor += BEAD_PITCH
            right = cursor - BEAD_GAP
          }
        }
      }
      node.outX = right
      if (node.outX > width) width = node.outX
    }
    for (const node of collected) {
      if (node.outX > node.x + NODE_W) {
        const cy = node.y + NODE_H / 2
        edges.push({
          key: node.id + '>wire',
          kind: 'wire',
          d: 'M ' + (node.x + NODE_W) + ' ' + cy + ' L ' + node.outX + ' ' + cy,
        })
      }
      for (const kid of children(node.id)) {
        if (visited[kid.id] !== true) continue
        edges.push({ key: node.id + '>' + kid.id, kind: kid.subagent ? 'sub' : 'branch', d: edgePath(node, kid) })
      }
    }

    const owner = workspaces.find(item => item.sessionIds.indexOf(root.id) >= 0)
    const ownerTitle = owner === undefined ? '' : String(owner.title || owner.path)
    captions.push({
      key: 'caption-' + root.id,
      x: PAD,
      y: cursorY,
      text: '会话树 ' + (index + 1) + (ownerTitle === '' ? ' · 未归属工作区' : ' · ' + ownerTitle),
    })
    cursorY = top + rowCursor * ROW - GAP_Y + TREE_GAP
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
    width: width + PAD * 2,
    height: Math.max(cursorY - TREE_GAP, 0) + PAD * 2,
    treeCount: roots.length,
  }
}
