/**
 * Turn-tree layout tests: the fork point, empty-Session head chips, folding,
 * direction, scope, and the hidden-parent fallback. The builder is pure, so
 * these are ordinary value assertions rather than a rendered-DOM test.
 *
 * @module dsh-session-map/session-map/graph.test
 */
import { describe, expect, it } from 'vitest'
import {
  buildGraph,
  type Graph,
  type SessionSummary,
  type TreeDirection,
  type TurnMessage,
} from './graph'

/** One outline entry the Host's `turnOutline` projection would serve. */
function turn(turnNumber: number, prompt: string, response = ''): {
  readonly turn: number
  readonly seq: number
  readonly prompt: string
  readonly response: string
} {
  return { turn: turnNumber, seq: turnNumber, prompt, response }
}

/**
 * One Session list row. `turns === null` models an absent `turnOutline`
 * projection; an empty array models a Session whose outline is genuinely empty.
 */
function summary(
  id: string,
  turns: readonly unknown[] | null,
  parentId?: string,
  extra: Partial<SessionSummary> = {},
): SessionSummary {
  return {
    id,
    displayTitle: id,
    parentId,
    ...(turns === null ? {} : { projectionValues: { turnOutline: turns } }),
    ...extra,
  }
}

/** Build a row map and the host-order id list from summaries. */
function listing(summaries: readonly SessionSummary[]): {
  readonly ids: readonly string[]
  readonly byId: Readonly<Record<string, SessionSummary>>
} {
  return {
    ids: summaries.map(item => item.id),
    byId: Object.fromEntries(summaries.map(item => [item.id, item])),
  }
}

/** Build one graph with the test defaults. */
function build(
  summaries: readonly SessionSummary[],
  options: {
    readonly hideSubagents?: boolean
    readonly foldRuns?: boolean
    readonly expandedRuns?: ReadonlySet<string>
    readonly scopeSessionId?: string
    readonly direction?: TreeDirection
    readonly messages?: Readonly<Record<string, readonly TurnMessage[]>>
  } = {},
): Graph {
  const { ids, byId } = listing(summaries)
  return buildGraph(
    ids,
    byId,
    [],
    options.hideSubagents ?? false,
    options.foldRuns ?? true,
    options.expandedRuns ?? new Set<string>(),
    options.scopeSessionId,
    options.direction ?? 'vertical',
    options.messages ?? {},
  )
}

/** One drawn Session, failing loudly when it is absent. */
function sessionOf(graph: Graph, id: string) {
  const session = graph.sessionsById[id]
  if (session === undefined) throw new Error('missing session ' + id)
  return session
}

/** One drawn node, failing loudly when it is absent. */
function nodeOf(graph: Graph, id: string) {
  const node = graph.nodes.find(candidate => candidate.id === id)
  if (node === undefined) throw new Error('missing node ' + id)
  return node
}

/** The node a Session's tag renders on. */
function headNodeOf(graph: Graph, id: string) {
  return nodeOf(graph, sessionOf(graph, id).headNodeId)
}

/** One turn node, or `undefined` when the turn is not drawn. */
function turnNodeOf(graph: Graph, sessionId: string, turnNumber: number) {
  return graph.nodes.find(node => node.kind === 'turn'
    && node.sessionId === sessionId
    && node.turn === turnNumber)
}

describe('buildGraph turn tree', () => {
  it('draws one shared trunk and forks at the inherited turn', () => {
    const root = summary('root', [turn(1, 'r1'), turn(2, 'r2'), turn(3, 'r3')])
    const left = summary('left', [turn(1, 'r1'), turn(2, 'r2')], 'root')
    const right = summary('right', [turn(1, 'r1'), turn(2, 'r2')], 'root')
    const grandchild = summary('grandchild', [turn(1, 'r1'), turn(2, 'r2')], 'left')
    const graph = build([root, left, right, grandchild])

    expect(graph.turnCount).toBe(3)
    expect(graph.treeCount).toBe(1)
    expect(graph.sessionCount).toBe(4)
    expect(turnNodeOf(graph, 'root', 1)).toBeDefined()
    expect(turnNodeOf(graph, 'root', 2)).toBeDefined()
    expect(turnNodeOf(graph, 'root', 3)).toBeDefined()
    expect(turnNodeOf(graph, 'left', 1)).toBeUndefined()
    expect(turnNodeOf(graph, 'right', 1)).toBeUndefined()
    expect(turnNodeOf(graph, 'grandchild', 1)).toBeUndefined()

    const forkTurn = turnNodeOf(graph, 'root', 2)
    expect(forkTurn).toBeDefined()
    expect(forkTurn?.forkCount).toBe(2)
    expect(headNodeOf(graph, 'left').kind).toBe('head')
    expect(headNodeOf(graph, 'left').parentId).toBe(forkTurn?.id)
    expect(headNodeOf(graph, 'right').parentId).toBe(forkTurn?.id)
    expect(headNodeOf(graph, 'grandchild').parentId).toBe(headNodeOf(graph, 'left').id)

    expect(sessionOf(graph, 'left').ownCount).toBe(0)
    expect(sessionOf(graph, 'left').inheritedCount).toBe(2)
    expect(sessionOf(graph, 'grandchild').ownCount).toBe(0)
    expect(graph.edges.every(edge => edge.kind !== 'chain' || edge.d !== '')).toBe(true)

    // The parent is centered over its branches: one empty chip on the left, the
    // parent's own continuation in the middle, the other chip on the right.
    const rootTurn1 = turnNodeOf(graph, 'root', 1)
    const rootTurn3 = turnNodeOf(graph, 'root', 3)
    const leftChip = headNodeOf(graph, 'left')
    const rightChip = headNodeOf(graph, 'right')
    const grandchildChip = headNodeOf(graph, 'grandchild')
    expect(forkTurn?.band).toBe(1)
    expect(rootTurn1?.x).toBe(forkTurn?.x)
    expect(rootTurn3?.x).toBe(forkTurn?.x)
    expect(forkTurn?.y).toBeGreaterThan(rootTurn1?.y ?? 0)
    expect(rootTurn3?.y).toBeGreaterThan(forkTurn?.y ?? 0)
    expect(leftChip.band).toBe(0)
    expect(rightChip.band).toBe(2)
    expect(leftChip.x).toBeLessThan(forkTurn?.x ?? 0)
    expect(rightChip.x).toBeGreaterThan(forkTurn?.x ?? 0)
    expect(grandchildChip.band).toBe(leftChip.band)
    expect(grandchildChip.x).toBe(leftChip.x)
    expect(grandchildChip.y).toBeGreaterThan(leftChip.y)
    expect(graph.edges.some(edge => edge.kind === 'fork'
      && edge.key === 'fork:' + String(forkTurn?.id) + '>' + leftChip.id)).toBe(true)
    expect(graph.edges.some(edge => edge.kind === 'chain'
      && edge.key === 'chain:' + String(forkTurn?.id) + '>' + String(rootTurn3?.id))).toBe(true)
  })

  it('puts the Session tag on its first own turn and forks from the inherited turn', () => {
    const root = summary('root', [turn(1, 'r1'), turn(2, 'r2'), turn(3, 'r3')])
    const child = summary('child', [turn(1, 'r1'), turn(2, 'r2'), turn(3, 'c3')], 'root')
    const graph = build([root, child])

    const own = turnNodeOf(graph, 'child', 3)
    expect(own).toBeDefined()
    expect(own?.isHead).toBe(true)
    expect(headNodeOf(graph, 'child').id).toBe(own?.id)
    expect(own?.parentId).toBe(turnNodeOf(graph, 'root', 2)?.id)
    expect(sessionOf(graph, 'child').ownCount).toBe(1)
    expect(graph.nodes.some(node => node.kind === 'head' && node.sessionId === 'child')).toBe(false)
  })

  it('adds a loaded steering message after its turn and forks from the last input', () => {
    const root = summary('root', [
      { turn: 1, seq: 10, prompt: '1', response: '' },
      { turn: 2, seq: 20, prompt: '2', response: '' },
      { turn: 3, seq: 30, prompt: '55', response: '' },
    ])
    const child = summary('child', [
      { turn: 1, seq: 10, prompt: '1', response: '' },
      { turn: 2, seq: 20, prompt: '2', response: '' },
    ], 'root')
    const graph = build([root, child], {
      messages: {
        root: [
          { seq: 11, text: '1' },
          { seq: 21, text: '2' },
          { seq: 25, text: '只是聊聊。' },
          { seq: 31, text: '55' },
        ],
      },
    })

    const prompt2 = turnNodeOf(graph, 'root', 2)
    expect(prompt2?.prompt).toBe('2')
    const steering = graph.nodes.find(node => node.sessionId === 'root' && node.prompt === '只是聊聊。')
    expect(steering).toBeDefined()
    expect(steering?.turn).toBe(2)
    expect(steering?.isHead).toBe(false)
    expect(prompt2?.forkCount).toBe(0)
    expect(steering?.forkCount).toBe(1)
    expect(steering?.x).toBe(prompt2?.x)
    expect(steering?.y).toBeGreaterThan(prompt2?.y ?? 0)
    expect(turnNodeOf(graph, 'root', 3)?.y).toBeGreaterThan(steering?.y ?? 0)
    expect(headNodeOf(graph, 'child').parentId).toBe(steering?.id)
    expect(sessionOf(graph, 'child').inheritedCount).toBe(2)
    expect(graph.turnCount).toBe(3)
    expect(graph.nodes.filter(node => node.kind === 'turn')).toHaveLength(4)
    expect(graph.edges.some(edge => edge.kind === 'chain'
      && edge.key === 'chain:' + String(prompt2?.id) + '>' + String(steering?.id))).toBe(true)
    expect(graph.edges.some(edge => edge.kind === 'chain'
      && edge.key === 'chain:' + String(steering?.id) + '>' + String(turnNodeOf(graph, 'root', 3)?.id))).toBe(true)
  })

  it('nests an empty Session under its empty parent chip', () => {
    const root = summary('root', [turn(1, 'r1'), turn(2, 'r2')])
    const child = summary('child', [turn(1, 'r1'), turn(2, 'r2')], 'root')
    const grandchild = summary('grandchild', [turn(1, 'r1'), turn(2, 'r2')], 'child')
    const graph = build([root, child, grandchild])

    expect(headNodeOf(graph, 'child').kind).toBe('head')
    expect(headNodeOf(graph, 'grandchild').kind).toBe('head')
    expect(headNodeOf(graph, 'child').parentId).toBe(turnNodeOf(graph, 'root', 2)?.id)
    expect(headNodeOf(graph, 'grandchild').parentId).toBe(headNodeOf(graph, 'child').id)
    expect(headNodeOf(graph, 'child').forkCount).toBe(1)
  })

  it('places two children forked at the same turn on that turn', () => {
    const root = summary('root', [turn(1, 'r1'), turn(2, 'r2'), turn(3, 'r3')])
    const first = summary('first', [turn(1, 'r1'), turn(2, 'r2')], 'root')
    const second = summary('second', [turn(1, 'r1'), turn(2, 'r2')], 'root')
    const graph = build([root, first, second])

    const forkTurn = turnNodeOf(graph, 'root', 2)
    expect(forkTurn?.forkCount).toBe(2)
    expect(headNodeOf(graph, 'first').parentId).toBe(forkTurn?.id)
    expect(headNodeOf(graph, 'second').parentId).toBe(forkTurn?.id)
  })

  it('folds only the middle of a long straight run and expands by run key', () => {
    const turns = Array.from({ length: 12 }, (_, index) => turn(index + 1, 'p' + String(index + 1)))
    const root = summary('root', turns)
    const folded = build([root])

    expect(folded.turnCount).toBe(12)
    expect(folded.nodes.filter(node => node.kind === 'turn')).toHaveLength(3)
    expect(folded.markers).toHaveLength(1)
    expect(folded.markers[0]?.count).toBe(9)
    const marker = folded.markers[0]
    expect(marker).toBeDefined()

    const expanded = build([root], { expandedRuns: new Set([marker?.runKey ?? '']) })
    expect(expanded.nodes.filter(node => node.kind === 'turn')).toHaveLength(12)
    expect(expanded.markers).toHaveLength(0)

    const unfolded = build([root], { foldRuns: false })
    expect(unfolded.nodes.filter(node => node.kind === 'turn')).toHaveLength(12)
    expect(unfolded.markers).toHaveLength(0)
  })

  it('keeps a chain in one band and swaps the axes with direction', () => {
    const first = summary('first', [turn(1, 'a1'), turn(2, 'a2')])
    const second = summary('second', [turn(1, 'b1'), turn(2, 'b2')])
    const vertical = build([first, second], { direction: 'vertical' })
    const horizontal = build([first, second], { direction: 'horizontal' })

    const v1 = turnNodeOf(vertical, 'first', 1)
    const v2 = turnNodeOf(vertical, 'first', 2)
    expect(v1).toBeDefined()
    expect(v2).toBeDefined()
    expect(v2?.y).toBeGreaterThan(v1?.y ?? 0)
    expect(v2?.x).toBe(v1?.x)

    const h1 = turnNodeOf(horizontal, 'first', 1)
    const h2 = turnNodeOf(horizontal, 'first', 2)
    expect(h2?.x).toBeGreaterThan(h1?.x ?? 0)
    expect(h2?.y).toBe(h1?.y)
    expect(vertical.treeCount).toBe(2)
  })

  it('restricts to the current Session tree and falls back to all when it is absent', () => {
    const first = summary('first', [turn(1, 'a1')])
    const second = summary('second', [turn(1, 'b1')])
    const scoped = build([first, second], { scopeSessionId: 'first' })
    expect(scoped.sessions.map(session => session.id)).toEqual(['first'])

    const all = build([first, second])
    expect(all.sessions.map(session => session.id)).toEqual(['first', 'second'])

    const fallback = build([first, second], { scopeSessionId: 'missing' })
    expect(fallback.scopeSessionId).toBeUndefined()
    expect(fallback.sessionCount).toBe(2)
  })

  it('draws a hidden parent\'s visible prefix and omits its filtered turns', () => {
    const parent = summary('parent', [turn(1, 'p1'), turn(2, 'p2')])
    const hidden = summary(
      'hidden',
      [turn(1, 'p1'), turn(2, 'p2'), turn(3, 'h3')],
      'parent',
      { origin: 'subagent' },
    )
    const child = summary(
      'child',
      [turn(1, 'p1'), turn(2, 'p2'), turn(3, 'h3'), turn(4, 'c4')],
      'hidden',
    )
    const graph = build([parent, hidden, child], { hideSubagents: true })

    expect(graph.sessions.map(session => session.id)).toEqual(['parent', 'child'])
    expect(turnNodeOf(graph, 'hidden', 3)).toBeUndefined()
    const own = turnNodeOf(graph, 'child', 4)
    expect(own).toBeDefined()
    expect(own?.parentId).toBe(turnNodeOf(graph, 'parent', 2)?.id)
    expect(sessionOf(graph, 'child').inheritedCount).toBe(3)
    expect(sessionOf(graph, 'child').hiddenInherited).toBe(1)
    expect(own?.hiddenInherited).toBe(1)
  })

  it('draws a root Session with an empty outline as its own tree', () => {
    const blank = summary('blank', [])
    const graph = build([blank])

    expect(graph.treeCount).toBe(1)
    expect(graph.sessionCount).toBe(1)
    expect(graph.nodes).toHaveLength(1)
    expect(headNodeOf(graph, 'blank').kind).toBe('head')
    expect(headNodeOf(graph, 'blank').outlineMissing).toBe(false)
    expect(graph.turnCount).toBe(0)
  })

  it('treats an unlisted parent as a root and keeps its own turns', () => {
    const orphan = summary('orphan', [turn(1, 'o1'), turn(2, 'o2')], 'missing')
    const graph = build([orphan])

    expect(graph.treeCount).toBe(1)
    expect(sessionOf(graph, 'orphan').inheritedCount).toBe(0)
    expect(turnNodeOf(graph, 'orphan', 1)?.parentId).toBeUndefined()
    expect(turnNodeOf(graph, 'orphan', 2)?.isHead).toBe(false)
  })

  it('shows a head chip when the outline projection is absent', () => {
    const parent = summary('parent', [turn(1, 'p1')])
    const child = summary('child', null, 'parent')
    const graph = build([parent, child])

    const head = headNodeOf(graph, 'child')
    expect(head.kind).toBe('head')
    expect(head.outlineMissing).toBe(true)
    expect(head.parentId).toBe(turnNodeOf(graph, 'parent', 1)?.id)
    expect(sessionOf(graph, 'child').outlineMissing).toBe(true)
  })

  it('returns stable, unique node ids across rebuilds', () => {
    const root = summary('root', [turn(1, 'r1'), turn(2, 'r2'), turn(3, 'r3')])
    const child = summary('child', [turn(1, 'r1'), turn(2, 'r2')], 'root')
    const first = build([root, child])
    const second = build([root, child])

    const ids = first.nodes.map(node => node.id)
    expect(new Set(ids).size).toBe(ids.length)
    expect(second.nodes.map(node => node.id)).toEqual(ids)
  })
})
