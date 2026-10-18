/**
 * Canvas construction: the union tree of user turns over the listed Sessions,
 * the session heads that anchor turns-less Sessions, and the folded runs that
 * keep long chains readable.
 *
 * A Session is not a node here: it is a colour, a label on its first own turn,
 * and — when it has no own turn at all — a head chip. A fork child's log begins
 * with a copy of its parent's turns, so those leading turns are matched against
 * the parent's outline and drawn ONCE, on the ancestor's chain; the child's head
 * hangs from the turn the fork actually happened at.
 *
 * Everything here is a pure function of the listed Sessions, the Workspace
 * membership, and the fold switches, so equal inputs always produce an equal
 * layout and the Views can rebuild it on every render.
 *
 * @module dsh-session-map/client/graph
 */
import {
  CAPTION_H,
  COLUMN_GAP,
  COLUMN_PITCH,
  GAP_Y,
  MARKER_H,
  MARKER_W,
  NODE_GAP,
  NODE_H,
  NODE_W,
  PAD,
  ROW,
  RUN_FOLD_MIN,
  RUN_KEEP_HEAD,
  RUN_KEEP_TAIL,
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
 * itself rather than never returning.
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

/** Which way a turn tree grows across the canvas. */
export type TreeDirection = 'vertical' | 'horizontal'

/** One turn's compared identity and displayed facts. */
interface TurnEntry {
  /** Host-assigned turn number; `index + 1` only when the wire omitted it. */
  readonly turn: number
  /** The turn's `turn/start` seq, kept for diagnostics; not part of the match. */
  readonly seq: number | undefined
  readonly prompt: string
  readonly response: string
}

/** What one Session's projection reports, or `missing` when it reports nothing. */
interface Outline {
  readonly entries: readonly TurnEntry[]
  readonly missing: boolean
}

/**
 * One human message from a Session's loaded event window. The client can read
 * these only for the open Session and its ancestors; the map uses them to add
 * steering inputs after their turn's outline prompt.
 */
export interface TurnMessage {
  readonly seq: number
  readonly text: string
}

/**
 * One placed canvas node: a user turn, a steering input in that turn, or the
 * head chip of a Session that has no own turn to put its label on.
 */
export interface GraphNode {
  readonly id: string
  readonly kind: 'turn' | 'head'
  /** Session that produced this turn; for a head chip, the Session itself. */
  readonly sessionId: string
  readonly turn: number | null
  readonly prompt: string
  readonly response: string
  /** Whether the Session tag renders here (first own turn, or the head chip). */
  readonly isHead: boolean
  /** Child Sessions whose heads hang from this node. */
  forkCount: number
  /** Tree parent: the turn or head chip this node hangs from. */
  parentId: string | undefined
  /** Inherited turns omitted because the parent Session is filtered out. */
  hiddenInherited: number
  /** This Session's outline projection was absent. */
  readonly outlineMissing: boolean
  band: number
  x: number
  y: number
  /** Far edge of the card along the tree's growth axis. */
  outAlong: number
}

/** One Session as the canvas draws it: a colour, a label and its own turns. */
export interface GraphSession {
  readonly id: string
  readonly title: string
  /** Per-canvas label ordinal shown as `会话N`. */
  readonly ordinal: number
  /** Stable 0..7 tone index derived from the id. */
  readonly tone: number
  readonly parentSessionId: string | undefined
  readonly parentTitle: string | undefined
  readonly running: boolean
  readonly completed: boolean
  readonly subagent: boolean
  /** Leading turns this Session's log inherited from its parent. */
  readonly inheritedCount: number
  /** Turns this Session's outline reports after that prefix. */
  readonly ownCount: number
  readonly outlineMissing: boolean
  /** Inherited turns left undrawn because an ancestor is filtered out. */
  readonly hiddenInherited: number
  readonly headNodeId: string
  /** Own turn nodes currently drawn (a folded run omits its middle). */
  readonly ownNodeIds: readonly string[]
  /** Visible shared-prefix nodes on this Session's inherited path. */
  readonly inheritedNodeIds: readonly string[]
}

/** One drawn connector. */
export interface GraphEdge {
  readonly key: string
  readonly kind: EdgeKind
  readonly d: string
}

/** One folded-run capsule: the plus count that expands a long straight chain. */
export interface GraphMarker {
  readonly id: string
  readonly kind: 'run'
  readonly runKey: string
  readonly count: number
  readonly x: number
  readonly y: number
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
  readonly sessions: readonly GraphSession[]
  readonly sessionsById: Readonly<Record<string, GraphSession>>
  readonly edges: readonly GraphEdge[]
  readonly markers: readonly GraphMarker[]
  readonly captions: readonly GraphCaption[]
  /** Listed Sessions drawn on the canvas. */
  readonly sessionCount: number
  /** Unique turn nodes, counted before long runs are folded. */
  readonly turnCount: number
  /** Fork trees on the canvas. */
  readonly treeCount: number
  readonly width: number
  readonly height: number
  /**
   * The Session the canvas was restricted to, or `undefined` when every listed
   * Session was drawn. A request the list cannot satisfy — its Session is not
   * among the rows — draws everything and reports `undefined` here.
   */
  readonly scopeSessionId: string | undefined
}

/** One Session's build-time plan; kept out of the returned Graph. */
interface SessionPlan {
  readonly id: string
  readonly summary: SessionSummary
  readonly title: string
  readonly outline: readonly TurnEntry[]
  readonly outlineMissing: boolean
  readonly directParentId: string | undefined
  hostedParent: SessionPlan | undefined
  inheritedCount: number
  hiddenInherited: number
  ownCount: number
  headNode: GraphNode | undefined
  ownNodes: GraphNode[]
  /** Outline index -> the shared ancestor node, an own node, or `undefined` when hidden. */
  nodeByIndex: (GraphNode | undefined)[]
  inheritedNodeIds: string[]
  ordinal: number
  tone: number
  tailAnchor: GraphNode | undefined
  inboundKind: EdgeKind
  readonly children: SessionPlan[]
}

/** The tone palette size; the CSS sheet defines one rule per index. */
const TONE_COUNT = 8

/**
 * A stable 0..7 tone for one Session id.
 * @param id - the Session id.
 * @returns the tone index.
 */
function toneOf(id: string): number {
  let hash = 2166136261
  for (let index = 0; index < id.length; index += 1) {
    hash ^= id.charCodeAt(index)
    hash = Math.imul(hash, 16777619)
  }
  return (hash >>> 0) % TONE_COUNT
}

/**
 * The label a Session shows: its projected title, or its id when it has none.
 * @param summary - the listed row, when it is listed.
 * @param id - the Session id used as the fallback.
 * @returns the display label.
 */
function sessionLabel(summary: SessionSummary | undefined, id: string): string {
  if (summary === undefined) return String(id)
  const title = summary.displayTitle
  if (typeof title === 'string' && title !== '') return title
  return String(id)
}

/**
 * Normalise one wire outline entry. Every field is re-checked: the projection is
 * wire data, not a type this plugin controls.
 * @param entry - the entry the Host projected.
 * @param index - its position, used only when `turn` is absent.
 * @returns the compared identity and displayed previews.
 */
function turnEntry(entry: unknown, index: number): TurnEntry {
  const record: unknown = typeof entry === 'object' && entry !== null ? entry : undefined
  const turn: unknown = record === undefined ? undefined : (record as { readonly turn?: unknown }).turn
  const seq: unknown = record === undefined ? undefined : (record as { readonly seq?: unknown }).seq
  const prompt: unknown = record === undefined ? undefined : (record as { readonly prompt?: unknown }).prompt
  const response: unknown = record === undefined ? undefined : (record as { readonly response?: unknown }).response
  return {
    turn: typeof turn === 'number' ? turn : index + 1,
    seq: typeof seq === 'number' ? seq : undefined,
    prompt: typeof prompt === 'string' ? prompt : '',
    response: typeof response === 'string' ? response : '',
  }
}

/**
 * Whether two outlines carry the same turn at one position.
 *
 * The child's inherited prefix is a copy of the parent's events, so the turn
 * number and both bounded previews agree. `seq` is deliberately not required:
 * a seed may renumber it, while the turn number is host-assigned and copied.
 * @param left - the child's entry.
 * @param right - the parent's entry.
 * @returns true when the entries are the same turn.
 */
function sameTurn(left: TurnEntry | undefined, right: TurnEntry | undefined): boolean {
  if (left === undefined || right === undefined) return false
  return left.turn === right.turn && left.prompt === right.prompt && left.response === right.response
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
 * Normalise one Session's outline and remember whether the projection existed.
 * @param summary - the listed row, when it is listed.
 * @returns the entries, plus whether the projection was absent.
 */
function outlineFor(summary: SessionSummary | undefined): Outline {
  const outline = outlineOf(summary)
  if (outline === undefined) return { entries: [], missing: true }
  return { entries: outline.map((entry, index) => turnEntry(entry, index)), missing: false }
}

/**
 * Longest common prefix of two outlines, by {@link sameTurn}.
 * @param left - the child's entries.
 * @param right - the parent's entries.
 * @returns the matched length.
 */
function commonPrefix(left: readonly TurnEntry[], right: readonly TurnEntry[]): number {
  let shared = 0
  while (shared < left.length && shared < right.length && sameTurn(left[shared], right[shared])) shared += 1
  return shared
}

/**
 * Collapse whitespace the way the Host's bounded preview does, for comparing a
 * loaded message with the turn prompt the outline already carries.
 * @param text - the raw message or preview.
 * @returns the normalised text.
 */
function normalizedMessageText(text: string): string {
  return text.replace(/\s+/g, ' ').trim()
}

/**
 * Whether one loaded human message is the turn's first prompt.
 *
 * The outline prompt is a bounded preview: it may be clipped with an ellipsis
 * and its whitespace is collapsed. A prefix comparison in either direction
 * keeps the full loaded message and the preview comparable without treating a
 * steering message as the prompt.
 * @param text - the loaded message text.
 * @param prompt - the outline's prompt preview.
 * @returns true when the message is the prompt.
 */
function matchesTurnPrompt(text: string, prompt: string): boolean {
  const message = normalizedMessageText(text)
  const preview = normalizedMessageText(prompt).replace(/…$/, '')
  if (preview === '') return message === ''
  if (message === '') return false
  const head = preview.slice(0, Math.min(24, preview.length))
  return message.startsWith(head) || preview.startsWith(message.slice(0, Math.min(24, message.length)))
}

/**
 * Group loaded human messages by the turn whose `turn/start` seq precedes them.
 *
 * Inherited turns are skipped: their nodes belong to the ancestor. The first
 * message of an own turn is the prompt the outline already carries; every later
 * message is a steering input and earns its own node.
 * @param plan - the Session's build plan.
 * @param messages - human messages from the Session's loaded event window.
 * @returns steering messages by outline index; absent turns have none.
 */
function turnMessagesFor(plan: SessionPlan, messages: readonly TurnMessage[]): Map<number, TurnMessage[]> {
  const byTurn = new Map<number, TurnMessage[]>()
  if (messages.length === 0) return byTurn
  // The event window is ordered, but sorting a copy makes the grouping total.
  const sorted = [...messages].sort((left, right) => left.seq - right.seq)
  let turnIndex = -1
  let cursor = 0
  for (const message of sorted) {
    while (cursor < plan.outline.length) {
      const entry = plan.outline[cursor]
      const start = entry?.seq
      if (start === undefined || start > message.seq) break
      turnIndex = cursor
      cursor += 1
    }
    if (turnIndex < plan.inheritedCount) continue
    const list = byTurn.get(turnIndex)
    if (list === undefined) byTurn.set(turnIndex, [message])
    else list.push(message)
  }
  // The first human message in a turn is the prompt; the outline already draws
  // it. Only the first entry is a candidate, so a later steering message that
  // happens to start with the prompt words is not swallowed.
  for (const [index, list] of byTurn) {
    const entry = plan.outline[index]
    if (entry === undefined) continue
    const first = list[0]
    if (first !== undefined && matchesTurnPrompt(first.text, entry.prompt)) list.shift()
  }
  return byTurn
}

/**
 * The two screen axes one direction lays a tree out on, plus the sizes that
 * belong to them.
 *
 * A tree is a depth axis and a band axis: every card sits one child further
 * along than its parent, and siblings occupy bands across that axis. Growing
 * downward puts depth on y and bands on x; growing rightward swaps the two. The
 * layout below is written once, in `along` and `across`, and only these numbers
 * and the final box swap tell the two directions apart.
 */
interface GrowthAxis {
  /** Whether the tree grows downward, i.e. along the screen's y axis. */
  readonly vertical: boolean
  /** Extent of one card along the growth axis. */
  readonly nodeAlong: number
  /** Extent of one card across the growth axis. */
  readonly nodeAcross: number
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
  bandPitch: ROW,
  bandSlack: GAP_Y,
  treeGap: TREE_GAP,
}

/** Trees that grow downward: depth along y, sibling bands across x. */
const DOWNWARD: GrowthAxis = {
  vertical: true,
  nodeAlong: NODE_H,
  nodeAcross: NODE_W,
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
 * The middle of a card across the growth axis.
 * @param axis - the direction in force.
 * @param node - the placed card.
 * @returns the card's centre coordinate across the axis.
 */
function crossCentre(axis: GrowthAxis, node: GraphNode): number {
  return axis.vertical ? node.x + NODE_W / 2 : node.y + NODE_H / 2
}

/**
 * The card edge its children leave from.
 * @param axis - the direction in force.
 * @param node - the placed card.
 * @returns the coordinate along the growth axis.
 */
function farEdge(axis: GrowthAxis, node: GraphNode): number {
  return axis.vertical ? node.y + NODE_H : node.x + NODE_W
}

/**
 * The card edge a child arrives at.
 * @param axis - the direction in force.
 * @param node - the placed card.
 * @returns the coordinate along the growth axis.
 */
function nearEdge(axis: GrowthAxis, node: GraphNode): number {
  return axis.vertical ? node.y : node.x
}

/**
 * The run from one turn to the next turn of the same Session. A centered parent
 * may sit between two fork branches, so the child can be in another band; the
 * line then runs diagonally instead of pretending both cards share a centre.
 * @param axis - the direction in force.
 * @param from - the parent card.
 * @param to - the child card.
 * @returns the path data.
 */
function chainPath(axis: GrowthAxis, from: GraphNode, to: GraphNode): string {
  const x1 = axis.vertical ? crossCentre(axis, from) : farEdge(axis, from)
  const y1 = axis.vertical ? farEdge(axis, from) : crossCentre(axis, from)
  const x2 = axis.vertical ? crossCentre(axis, to) : nearEdge(axis, to)
  const y2 = axis.vertical ? nearEdge(axis, to) : crossCentre(axis, to)
  return 'M ' + x1 + ' ' + y1 + ' L ' + x2 + ' ' + y2
}

/**
 * The bezier joining a node's far edge to a fork child's near edge.
 * @param axis - the direction in force.
 * @param from - the parent card.
 * @param to - the child card.
 * @returns the path data.
 */
function forkPath(axis: GrowthAxis, from: GraphNode, to: GraphNode): string {
  const x1 = axis.vertical ? crossCentre(axis, from) : from.outAlong
  const y1 = axis.vertical ? from.outAlong : crossCentre(axis, from)
  const x2 = axis.vertical ? crossCentre(axis, to) : nearEdge(axis, to)
  const y2 = axis.vertical ? nearEdge(axis, to) : crossCentre(axis, to)
  const bend = axis.vertical ? Math.max(18, (y2 - y1) / 2) : Math.max(18, (x2 - x1) / 2)
  return axis.vertical
    ? 'M ' + x1 + ' ' + y1 + ' C ' + x1 + ' ' + (y1 + bend) + ' ' + x2 + ' ' + (y2 - bend) + ' ' + x2 + ' ' + y2
    : 'M ' + x1 + ' ' + y1 + ' C ' + (x1 + bend) + ' ' + y1 + ' ' + (x2 - bend) + ' ' + y2 + ' ' + x2 + ' ' + y2
}

/**
 * Read a Session plan's head, which is always created before the plan is used.
 * @param plan - the plan.
 * @returns its head node.
 */
function headOf(plan: SessionPlan): GraphNode {
  const head = plan.headNode
  if (head === undefined) throw new Error('session plan has no head: ' + plan.id)
  return head
}

/**
 * The nearest defined outline node at or before one index.
 * @param plan - the Session whose outline map to scan.
 * @param index - the outline index to start from.
 * @returns the nearest node, or `undefined` when the prefix starts hidden.
 */
function nearestNodeAtOrBefore(plan: SessionPlan, index: number): GraphNode | undefined {
  let cursor = Math.min(index, plan.nodeByIndex.length - 1)
  while (cursor >= 0) {
    const node = plan.nodeByIndex[cursor]
    if (node !== undefined) return node
    cursor -= 1
  }
  return undefined
}

/** One folded run as the layout needs it. */
interface FoldPlan {
  readonly runKey: string
  readonly count: number
  readonly head: GraphNode
  readonly tail: GraphNode
  gap: number
}

/**
 * Build the canvas: turn nodes, session head chips, folded runs and edges.
 * @param ids - listed Session ids in host order.
 * @param byId - listed Session summaries.
 * @param workspaces - Workspace membership, for tree order and captions.
 * @param hideSubagents - whether subagent-origin Sessions are filtered out.
 * @param foldRuns - whether long straight runs collapse their middle stretch.
 * @param expandedRuns - run keys the reader has expanded.
 * @param scopeSessionId - when given, draw only this Session's own tree; an id
 * the row map does not carry is ignored and every listed Session is drawn.
 * @param direction - which way the trees grow.
 * @param messagesBySession - human messages from the loaded event windows of the
 * current Session and its ancestors; turns outside those windows keep one node.
 * @returns the positioned graph.
 */
export function buildGraph(
  ids: readonly string[],
  byId: Readonly<Record<string, SessionSummary>>,
  workspaces: readonly WorkspaceGroup[],
  hideSubagents: boolean,
  foldRuns: boolean,
  expandedRuns: ReadonlySet<string>,
  scopeSessionId: string | undefined,
  direction: TreeDirection,
  messagesBySession: Readonly<Record<string, readonly TurnMessage[]>> = {},
): Graph {
  // The canvas draws either every listed Session or one Session's whole tree.
  // The tree is the connected component of the parent links, so the Session
  // being read keeps its ancestors, every branch forked off beside it, and all
  // of their descendants. A scope the list cannot satisfy falls back to
  // everything rather than to an empty canvas.
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

  const candidateIds: string[] = []
  for (const id of drawnIds) {
    const summary = byId[id]
    if (summary === undefined) continue
    if (hideSubagents && summary.origin === 'subagent') continue
    candidateIds.push(id)
  }

  // Plans first: outline, direct parent, and the nearest drawn ancestor. The
  // hosted parent is the tree parent for ordering; the direct parent is what
  // the inherited prefix is matched against, even when that row is filtered.
  const plans = new Map<string, SessionPlan>()
  const planOrder: SessionPlan[] = []
  const outlineCache = new Map<string, Outline>()
  const outlineOfSession = (id: string | undefined): Outline => {
    if (id === undefined) return { entries: [], missing: true }
    const cached = outlineCache.get(id)
    if (cached !== undefined) return cached
    const value = outlineFor(byId[id])
    outlineCache.set(id, value)
    return value
  }

  for (const id of candidateIds) {
    const summary = byId[id]
    if (summary === undefined) continue
    const outline = outlineOfSession(id)
    const plan: SessionPlan = {
      id,
      summary,
      title: sessionLabel(summary, id),
      outline: outline.entries,
      outlineMissing: outline.missing,
      directParentId: summary.parentId,
      hostedParent: undefined,
      inheritedCount: 0,
      hiddenInherited: 0,
      ownCount: 0,
      headNode: undefined,
      ownNodes: [],
      nodeByIndex: [],
      inheritedNodeIds: [],
      ordinal: 0,
      tone: toneOf(id),
      tailAnchor: undefined,
      inboundKind: 'fork',
      children: [],
    }
    plans.set(id, plan)
    planOrder.push(plan)
  }

  // Nearest drawn ancestor: skip filtered and unlisted Sessions. A cycle is
  // treated as no parent, so the plan becomes a root instead of looping.
  const hostedParentIdFor = (id: string): string | undefined => {
    const seen = new Set<string>()
    seen.add(id)
    let parentId = byId[id]?.parentId
    while (parentId !== undefined) {
      if (seen.has(parentId)) return undefined
      seen.add(parentId)
      if (plans.has(parentId)) return parentId
      const parent = byId[parentId]
      if (parent === undefined) return undefined
      parentId = parent.parentId
    }
    return undefined
  }

  const rootPlans: SessionPlan[] = []
  for (const plan of planOrder) {
    const hostedId = hostedParentIdFor(plan.id)
    const hosted = hostedId === undefined ? undefined : plans.get(hostedId)
    plan.hostedParent = hosted
    if (hosted === undefined) rootPlans.push(plan)
    else hosted.children.push(plan)
  }

  // Tree order mirrors the left sidebar's own derivation (ui-workspace
  // tree.ts): Workspace groups in their stored order, and inside a group the
  // most recently active Session first. Sessions no Workspace accounts for
  // trail last, newest first.
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
  rootPlans.sort((left, right) => {
    const groupLeft = rankOf(left.id)
    const groupRight = rankOf(right.id)
    if (groupLeft !== groupRight) return groupLeft - groupRight
    const updatedLeft = typeof left.summary.updatedAt === 'number' ? left.summary.updatedAt : 0
    const updatedRight = typeof right.summary.updatedAt === 'number' ? right.summary.updatedAt : 0
    if (updatedLeft !== updatedRight) return updatedRight - updatedLeft
    return left.id < right.id ? -1 : 1
  })

  // Pre-order assigns the per-canvas `会话N` label and guarantees every parent
  // has its outline-to-node map ready before a child needs it.
  const ordered: SessionPlan[] = []
  const visitedSessions = new Set<string>()
  let ordinal = 0
  const visitSession = (plan: SessionPlan): void => {
    if (visitedSessions.has(plan.id)) return
    visitedSessions.add(plan.id)
    ordinal += 1
    plan.ordinal = ordinal
    ordered.push(plan)
    for (const child of plan.children) visitSession(child)
  }
  for (const root of rootPlans) visitSession(root)
  // A cycle can leave a component without a root; promote it rather than drop it.
  for (const plan of planOrder) visitSession(plan)

  const usedNodeIds = new Set<string>()
  const turnNodeId = (sessionId: string, entry: TurnEntry, index: number): string => {
    let id = 'turn:' + sessionId + ':' + String(entry.turn)
    if (usedNodeIds.has(id)) id = id + ':' + String(index)
    usedNodeIds.add(id)
    return id
  }
  const headChipId = (sessionId: string): string => {
    const id = 'head:' + sessionId
    usedNodeIds.add(id)
    return id
  }
  const turnMessageNodeId = (sessionId: string, turn: number, seq: number, turnIndex: number): string => {
    let id = 'turn:' + sessionId + ':' + String(turn) + ':msg:' + String(seq)
    if (usedNodeIds.has(id)) id = id + ':' + String(turnIndex)
    usedNodeIds.add(id)
    return id
  }

  const allNodes: GraphNode[] = []
  const forkChildrenOf: Record<string, GraphNode[]> = {}
  const processed = new Set<string>()
  let turnCount = 0

  for (const plan of ordered) {
    const directParent = plan.directParentId === undefined ? undefined : plans.get(plan.directParentId)
    const directParentReady = directParent === undefined || processed.has(directParent.id)
    let inheritedCount = 0
    if (plan.directParentId !== undefined && plan.directParentId !== plan.id && directParentReady) {
      const parentOutline = outlineOfSession(plan.directParentId)
      inheritedCount = commonPrefix(plan.outline, parentOutline.entries)
    }
    plan.inheritedCount = inheritedCount
    plan.ownCount = plan.outline.length - inheritedCount

    const ownNodes: GraphNode[] = []
    plan.nodeByIndex = new Array<GraphNode | undefined>(plan.outline.length)
    const loadedMessages = messagesBySession[plan.id] ?? []
    const messagesByTurn = turnMessagesFor(plan, loadedMessages)
    const makeTurnNode = (
      id: string,
      turn: number,
      prompt: string,
      response: string,
      isHead: boolean,
    ): GraphNode => ({
      id,
      kind: 'turn',
      sessionId: plan.id,
      turn,
      prompt,
      response,
      isHead,
      forkCount: 0,
      parentId: undefined,
      hiddenInherited: 0,
      outlineMissing: false,
      band: 0,
      x: 0,
      y: 0,
      outAlong: 0,
    })

    for (let index = inheritedCount; index < plan.outline.length; index += 1) {
      const entry = plan.outline[index]
      if (entry === undefined) continue
      const turnNodes: GraphNode[] = [
        makeTurnNode(
          turnNodeId(plan.id, entry, index),
          entry.turn,
          entry.prompt,
          entry.response,
          index === inheritedCount,
        ),
      ]
      for (const message of messagesByTurn.get(index) ?? []) {
        turnNodes.push(makeTurnNode(
          turnMessageNodeId(plan.id, entry.turn, message.seq, index),
          entry.turn,
          message.text,
          '',
          false,
        ))
      }
      for (const node of turnNodes) ownNodes.push(node)
      const last = turnNodes[turnNodes.length - 1]
      // Children fork after the turn's LAST input, not after its outline prompt:
      // the steering messages are part of the inherited turn too.
      if (last !== undefined) plan.nodeByIndex[index] = last
      turnCount += 1
    }
    plan.ownNodes = ownNodes

    let head: GraphNode
    const firstOwn = ownNodes[0]
    if (firstOwn !== undefined) {
      head = firstOwn
    } else {
      head = {
        id: headChipId(plan.id),
        kind: 'head',
        sessionId: plan.id,
        turn: null,
        prompt: '',
        response: '',
        isHead: true,
        forkCount: 0,
        parentId: undefined,
        hiddenInherited: 0,
        outlineMissing: plan.outlineMissing,
        band: 0,
        x: 0,
        y: 0,
        outAlong: 0,
      }
      allNodes.push(head)
    }
    plan.headNode = head
    allNodes.push(...ownNodes)

    // A hidden direct parent still carries the outline that says where the
    // child's own turns begin; the visible shared prefix is the part already
    // drawn on the nearest drawn ancestor.
    const hosted = plan.hostedParent
    const hiddenDirectParent = plan.directParentId !== undefined
      && plan.directParentId !== plan.id
      && directParent === undefined
    const sharedWithHosted = hiddenDirectParent && hosted !== undefined
      ? commonPrefix(plan.outline, hosted.outline)
      : 0

    for (let index = 0; index < inheritedCount; index += 1) {
      let mapped: GraphNode | undefined
      if (directParent !== undefined && processed.has(directParent.id)) {
        mapped = directParent.nodeByIndex[index]
      } else if (hiddenDirectParent && hosted !== undefined && index < sharedWithHosted) {
        mapped = hosted.nodeByIndex[index]
      }
      if (mapped !== undefined) plan.nodeByIndex[index] = mapped
    }

    const inheritedIds: string[] = []
    const seenIds = new Set<string>()
    let hiddenInherited = 0
    for (let index = 0; index < inheritedCount; index += 1) {
      const node = plan.nodeByIndex[index]
      if (node === undefined) {
        hiddenInherited += 1
        continue
      }
      if (!seenIds.has(node.id)) {
        seenIds.add(node.id)
        inheritedIds.push(node.id)
      }
    }
    plan.hiddenInherited = hiddenInherited
    plan.inheritedNodeIds = inheritedIds
    head.hiddenInherited = hiddenInherited

    // Attach the head to the turn the fork actually happened at. A parent with
    // no own turn is a head chip, and its children hang from that chip so an
    // empty Session's own lineage survives.
    let attach: GraphNode | undefined
    if (directParent !== undefined && processed.has(directParent.id)) {
      const parentHead = headOf(directParent)
      if (directParent.ownCount === 0) {
        attach = parentHead
      } else if (plan.summary.origin === 'subagent' && inheritedCount === 0) {
        attach = directParent.tailAnchor ?? parentHead
      } else {
        attach = nearestNodeAtOrBefore(directParent, inheritedCount - 1) ?? parentHead
      }
    } else if (hiddenDirectParent && hosted !== undefined && processed.has(hosted.id)) {
      const hostedHead = headOf(hosted)
      if (hosted.ownCount === 0) {
        attach = hostedHead
      } else {
        attach = nearestNodeAtOrBefore(hosted, sharedWithHosted - 1) ?? hostedHead
      }
    }

    if (attach !== undefined) {
      head.parentId = attach.id
      attach.forkCount += 1
      const siblings = forkChildrenOf[attach.id]
      if (siblings === undefined) forkChildrenOf[attach.id] = [head]
      else siblings.push(head)
      plan.inboundKind = plan.summary.origin === 'subagent' ? 'sub' : 'fork'
    } else {
      plan.inboundKind = plan.summary.origin === 'subagent' ? 'sub' : 'fork'
    }
    plan.tailAnchor = ownNodes[ownNodes.length - 1] ?? head
    processed.add(plan.id)
  }

  const axis = direction === 'vertical' ? DOWNWARD : RIGHTWARD
  const markerAlong = axis.vertical ? MARKER_H : MARKER_W
  const markerAcross = axis.vertical ? MARKER_W : MARKER_H
  const runGap = Math.max(NODE_GAP, markerAlong + 16)

  // Fold each Session's own chain independently. A run ends at a fork turn (it
  // must stay visible) or at the Session's last turn; the next run starts right
  // after the fork turn. Only the middle of a run is hidden, never a head, a
  // fork point, or a tail.
  const hiddenNodes = new Set<string>()
  const folds: FoldPlan[] = []
  const foldByHead: Record<string, FoldPlan> = {}
  const runKeyOf = (node: GraphNode): string => 'run:' + node.id
  for (const plan of ordered) {
    const own = plan.ownNodes
    let start = 0
    while (start < own.length) {
      const first = own[start]
      if (first === undefined) break
      let end = start
      while (end + 1 < own.length) {
        const current = own[end]
        if (current === undefined) break
        if ((forkChildrenOf[current.id]?.length ?? 0) > 0) break
        end += 1
      }
      const length = end - start + 1
      const runKey = runKeyOf(first)
      if (foldRuns && length > RUN_FOLD_MIN && !expandedRuns.has(runKey)) {
        const keepHead = Math.min(RUN_KEEP_HEAD, length)
        const keepTail = Math.min(RUN_KEEP_TAIL, Math.max(0, length - keepHead))
        const visibleHeadIndex = start + keepHead - 1
        const visibleTailIndex = end - keepTail + 1
        const visibleHead = own[visibleHeadIndex]
        const visibleTail = own[visibleTailIndex]
        const hiddenCount = length - keepHead - keepTail
        if (visibleHead !== undefined && visibleTail !== undefined
          && visibleHead !== visibleTail && hiddenCount > 0) {
          for (let index = start + keepHead; index < visibleTailIndex; index += 1) {
            const node = own[index]
            if (node !== undefined) hiddenNodes.add(node.id)
          }
          const fold: FoldPlan = {
            runKey,
            count: hiddenCount,
            head: visibleHead,
            tail: visibleTail,
            gap: runGap,
          }
          folds.push(fold)
          foldByHead[visibleHead.id] = fold
        }
      }
      start = end + 1
    }
  }

  const visibleOwnBySession = new Map<string, GraphNode[]>()
  const visibleChainOf = new Map<string, GraphNode>()
  const chainGapOf = new Map<string, number>()
  for (const plan of ordered) {
    const visible = plan.ownNodes.filter(node => !hiddenNodes.has(node.id))
    visibleOwnBySession.set(plan.id, visible)
    for (let index = 0; index + 1 < visible.length; index += 1) {
      const from = visible[index]
      const to = visible[index + 1]
      if (from === undefined || to === undefined) continue
      visibleChainOf.set(from.id, to)
      chainGapOf.set(from.id, foldByHead[from.id] === undefined ? NODE_GAP : runGap)
    }
  }

  const visibleNodes = allNodes.filter(node => !hiddenNodes.has(node.id))
  const visibleNodesById = new Map<string, GraphNode>()
  for (const node of visibleNodes) visibleNodesById.set(node.id, node)

  // Roots are heads that were not attached. A pathological cycle may leave no
  // root; promote one head so its component is still laid out.
  const layoutRoots = ordered.filter(plan => headOf(plan).parentId === undefined)
  if (layoutRoots.length === 0 && ordered.length > 0) {
    const promoted = ordered[0]
    if (promoted !== undefined) {
      const head = headOf(promoted)
      const parentId = head.parentId
      if (parentId !== undefined) {
        const parent = visibleNodesById.get(parentId)
        if (parent !== undefined) {
          parent.forkCount = Math.max(0, parent.forkCount - 1)
          const siblings = forkChildrenOf[parent.id]
          if (siblings !== undefined) {
            const index = siblings.indexOf(head)
            if (index >= 0) siblings.splice(index, 1)
          }
        }
        head.parentId = undefined
      }
      layoutRoots.push(promoted)
    }
  }

  const edges: GraphEdge[] = []
  const markers: GraphMarker[] = []
  const captions: GraphCaption[] = []
  let treeCursor = 0
  let alongMax = 0
  let treeIndex = 0

  for (const plan of layoutRoots) {
    const root = headOf(plan)
    let bandCursor = 0
    const visitedBands = new Set<string>()
    const assignBands = (node: GraphNode): void => {
      if (visitedBands.has(node.id)) return
      visitedBands.add(node.id)
      const chain = visibleChainOf.get(node.id)
      const forks = forkChildrenOf[node.id] ?? []
      const children: GraphNode[] = []
      if (chain !== undefined) {
        // The Session's own continuation sits between its fork branches, so the
        // parent is centered and the branches fan out on both sides. With an odd
        // number of forks the split is arbitrary but still balanced as far as
        // possible.
        const before = Math.floor(forks.length / 2)
        for (let index = 0; index < before; index += 1) {
          const fork = forks[index]
          if (fork !== undefined) children.push(fork)
        }
        children.push(chain)
        for (let index = before; index < forks.length; index += 1) {
          const fork = forks[index]
          if (fork !== undefined) children.push(fork)
        }
      } else {
        for (const fork of forks) children.push(fork)
      }
      for (const child of children) assignBands(child)
      if (children.length === 0) {
        node.band = bandCursor
        bandCursor += 1
        return
      }
      const first = children[0]
      const last = children[children.length - 1]
      if (first !== undefined && last !== undefined) {
        node.band = (first.band + last.band) / 2
      }
    }
    assignBands(root)

    const acrossBase = axis.vertical ? treeCursor : treeCursor + CAPTION_H
    const alongStart = axis.vertical ? CAPTION_H : PAD
    const placed = new Set<string>()
    const place = (node: GraphNode, along: number): void => {
      if (placed.has(node.id)) return
      placed.add(node.id)
      const across = acrossBase + node.band * axis.bandPitch
      const box = boxOf(axis, along, across, axis.nodeAlong, axis.nodeAcross)
      node.x = box.x
      node.y = box.y
      node.outAlong = along + axis.nodeAlong
      if (node.outAlong > alongMax) alongMax = node.outAlong
      const chain = visibleChainOf.get(node.id)
      if (chain !== undefined) {
        const gap = chainGapOf.get(node.id) ?? NODE_GAP
        place(chain, node.outAlong + gap)
      }
      const forks = forkChildrenOf[node.id] ?? []
      for (const fork of forks) place(fork, node.outAlong + NODE_GAP)
    }
    place(root, alongStart)

    const owner = workspaces.find(item => item.sessionIds.indexOf(plan.id) >= 0)
    const ownerTitle = owner === undefined ? '' : String(owner.title || owner.path)
    captions.push({
      key: 'caption-' + plan.id,
      x: axis.vertical ? treeCursor : PAD,
      y: axis.vertical ? 0 : treeCursor,
      text: '会话树 ' + String(treeIndex + 1) + (ownerTitle === '' ? ' · 未归属工作区' : ' · ' + ownerTitle),
    })
    treeIndex += 1
    treeCursor = acrossBase + bandCursor * axis.bandPitch - axis.bandSlack + axis.treeGap
  }

  for (const fold of folds) {
    const node = fold.head
    const centre = crossCentre(axis, node)
    const along = node.outAlong + (fold.gap - markerAlong) / 2
    const box = boxOf(axis, along, centre - markerAcross / 2, markerAlong, markerAcross)
    markers.push({
      id: 'marker:' + fold.runKey,
      kind: 'run',
      runKey: fold.runKey,
      count: fold.count,
      x: box.x,
      y: box.y,
    })
  }

  // Chain edges connect consecutive visible turns of the same Session; a folded
  // run's head and tail are consecutive after filtering, and its capsule sits on
  // that straight edge. Fork edges connect a parent turn to a child Session's
  // head, and a subagent's edge is the same shape with the dashed treatment.
  for (const plan of ordered) {
    const visible = visibleOwnBySession.get(plan.id) ?? []
    for (let index = 0; index + 1 < visible.length; index += 1) {
      const from = visible[index]
      const to = visible[index + 1]
      if (from === undefined || to === undefined) continue
      edges.push({ key: 'chain:' + from.id + '>' + to.id, kind: 'chain', d: chainPath(axis, from, to) })
    }
  }
  for (const plan of ordered) {
    const head = headOf(plan)
    if (head.parentId === undefined) continue
    const parent = visibleNodesById.get(head.parentId)
    if (parent === undefined) continue
    edges.push({
      key: plan.inboundKind + ':' + parent.id + '>' + head.id,
      kind: plan.inboundKind,
      d: forkPath(axis, parent, head),
    })
  }

  const sessions: GraphSession[] = []
  const sessionsById: Record<string, GraphSession> = {}
  for (const plan of ordered) {
    const head = headOf(plan)
    const visibleOwn = visibleOwnBySession.get(plan.id) ?? []
    const parentSummary = plan.directParentId === undefined ? undefined : byId[plan.directParentId]
    const session: GraphSession = {
      id: plan.id,
      title: plan.title,
      ordinal: plan.ordinal,
      tone: plan.tone,
      parentSessionId: plan.directParentId,
      parentTitle: plan.directParentId === undefined
        ? undefined
        : sessionLabel(parentSummary, plan.directParentId),
      running: plan.summary.running === true,
      completed: plan.summary.completed === true,
      subagent: plan.summary.origin === 'subagent',
      inheritedCount: plan.inheritedCount,
      ownCount: plan.ownCount,
      outlineMissing: plan.outlineMissing,
      hiddenInherited: plan.hiddenInherited,
      headNodeId: head.id,
      ownNodeIds: visibleOwn.map(node => node.id),
      inheritedNodeIds: plan.inheritedNodeIds.filter(id => !hiddenNodes.has(id)),
    }
    sessions.push(session)
    sessionsById[session.id] = session
  }

  return {
    nodes: visibleNodes,
    sessions,
    sessionsById,
    edges,
    markers,
    captions,
    sessionCount: sessions.length,
    turnCount,
    treeCount: layoutRoots.length,
    // The canvas spans what the trees span: for rightward trees that is the
    // furthest node end across x and the last tree's bands down y; the downward
    // direction swaps the two.
    width: Math.max(axis.vertical ? treeCursor - axis.treeGap : alongMax, 0) + PAD * 2,
    height: Math.max(axis.vertical ? alongMax : treeCursor - axis.treeGap, 0) + PAD * 2,
    scopeSessionId: scopeId,
  }
}
