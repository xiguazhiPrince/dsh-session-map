/**
 * Canvas rendering smoke tests: build the real View over a fixed Session list
 * and render it with React's server renderer. This catches a broken element
 * tree or a bad graph/view contract that the pure layout tests cannot see.
 *
 * @module dsh-session-map/session-map/views.test
 */
import * as React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createFlag } from './flags'
import { MAP_KIND, OVERVIEW_KIND } from './constants'
import {
  createMapView,
  DEFAULT_FOLD_RUNS,
  lineageScanSessionIds,
  outlineReadStateOf,
  outlineRefreshQueue,
  rearmDiscardedOutlines,
  toggleMapRightbar,
  userMessagesOf,
  type MapFlags,
  type SessionEventEntryFace,
  type SessionEventsFace,
  type SessionListState,
  type SessionMapRuntime,
  type SessionProjectionSnapshot,
  type SessionState,
  type SessionViewProps,
  type SidebarRightFace,
  type WorkspaceListState,
} from './views'
import type { SessionSummary } from './graph'

/** One outline entry the Host's `turnOutline` projection would serve. */
function turn(turnNumber: number, prompt: string): {
  readonly turn: number
  readonly seq: number
  readonly prompt: string
  readonly response: string
} {
  return { turn: turnNumber, seq: turnNumber, prompt, response: '' }
}

/** One listed Session row with a complete outline. */
function summary(id: string, turns: readonly unknown[], parentId?: string): SessionSummary {
  return {
    id,
    displayTitle: id,
    parentId,
    projectionValues: { turnOutline: turns },
  }
}

/** Render the canvas View with a fixed list and fresh plugin flags. */
function renderCanvas(
  summaries: readonly SessionSummary[],
  options: {
    readonly foldRuns?: boolean
    readonly projectionsBySession?: Readonly<Record<string, SessionProjectionSnapshot>>
    readonly sessions?: () => SessionEventsFace | undefined
  } = {},
): string {
  const ids = summaries.map(item => item.id)
  const byId = Object.fromEntries(summaries.map(item => [item.id, item]))
  const props: SessionViewProps = {
    sessionId: 'root',
    useSessions: <Selected,>(select: (state: SessionListState) => Selected): Selected => (
      select({
        ids,
        byId,
        ...(options.projectionsBySession === undefined ? {} : { projectionsBySession: options.projectionsBySession }),
      })
    ),
    useWorkspaces: <Selected,>(select: (state: WorkspaceListState) => Selected): Selected => (
      select({ items: [] })
    ),
    useSession: <Selected,>(select: (state: SessionState) => Selected): Selected => (
      select({ running: false, hasMore: false })
    ),
    useProjection: ((key: 'title' | 'sessionStats') => (
      key === 'title' ? 'root' : undefined
    )) as SessionViewProps['useProjection'],
  }
  const flags: MapFlags = {
    scope: createFlag('current'),
    direction: createFlag('vertical'),
    foldRuns: createFlag(options.foldRuns ?? DEFAULT_FOLD_RUNS),
    expandedRuns: createFlag(new Set<string>()),
    hideSubagents: createFlag(false),
  }
  const runtime: SessionMapRuntime = {
    sidebarRight: () => { throw new Error('right column is not part of this render') },
    openSession: () => {},
    ...(options.sessions === undefined ? {} : { sessions: options.sessions }),
  }
  const View = createMapView(runtime, flags, true)
  return renderToStaticMarkup(React.createElement(View, props))
}

/** How many turn/head cards a rendered canvas carries. */
function cardCount(html: string): number {
  return (html.match(/data-dsm-hit="node"/g) ?? []).length
}

// The canvas places its view in a layout effect; React's server renderer cannot
// run it and warns. The test only checks the element tree, so that one warning
// is noise; every other console error still surfaces.
const originalError = console.error
beforeEach(() => {
  console.error = (...args: unknown[]) => {
    if (typeof args[0] === 'string' && args[0].includes('useLayoutEffect does nothing on the server')) return
    originalError.apply(console, args)
  }
})
afterEach(() => { console.error = originalError })

describe('canvas rendering', () => {
  it('renders a shared trunk plus an empty Session head chip', () => {
    const html = renderCanvas([
      summary('root', [turn(1, 'r1'), turn(2, 'r2')]),
      summary('child', [turn(1, 'r1'), turn(2, 'r2')], 'root'),
    ])

    expect(html).toContain('dsm__node')
    expect(html).toContain('dsm__tagText">root</span>')
    expect(html).toContain('dsm__tagText">child</span>')
    expect(html).toContain('尚无输入')
    expect(html).toContain('data-kind="head"')
    expect(html).not.toContain('dsm__bead')
    expect(cardCount(html)).toBe(3)
  })

  it('renders a folded long run and its plus count', () => {
    const turns = Array.from({ length: 12 }, (_, index) => turn(index + 1, 'p' + String(index + 1)))
    const html = renderCanvas([summary('root', turns)])

    expect(html).toContain('dsm__marker')
    expect(html).toContain('+ 9 条输入')
    expect(cardCount(html)).toBe(3)
  })

  it('renders every turn when folding is off', () => {
    const turns = Array.from({ length: 12 }, (_, index) => turn(index + 1, 'p' + String(index + 1)))
    const html = renderCanvas([summary('root', turns)], { foldRuns: false })

    expect(html).not.toContain('dsm__marker')
    expect(cardCount(html)).toBe(12)
  })

  it('shows the Session title in the tag and keeps the fork suffix when long', () => {
    const title = '会话图谱默认显示当前会话树 (1)'
    const html = renderCanvas([{
      id: 'long',
      displayTitle: title,
      projectionValues: { turnOutline: [turn(1, 'hi')] },
    }])

    expect(html).toContain('dsm__tagText">会话图谱默认显… (1)</span>')
    expect(html).toContain('title="会话1 · ' + title + '"')
  })

  it('joins parentless forks that copied the same turn prefix into one tree', () => {
    const html = renderCanvas([
      summary('root', [turn(1, 'q1'), turn(2, 'q2')]),
      summary('fork', [turn(1, 'q1'), turn(2, 'q2'), turn(3, 'own')]),
    ], { foldRuns: false })

    expect(html).toContain('2 个会话')
    expect(html).toContain('1 棵树')
    expect(html).toContain('dsm__tagText">root</span>')
    expect(html).toContain('dsm__tagText">fork</span>')
    expect(cardCount(html)).toBe(3)
  })
})

/** A controller face that answers projection reads and opens no history. */
function projectionOnlySessions(): SessionEventsFace {
  return {
    retain: () => { throw new Error('this render opens no event window') },
    refreshProjections: async () => {},
  }
}

describe('outline projection reads', () => {
  it('classifies one Session outline read', () => {
    expect(outlineReadStateOf(false, undefined, true)).toBe('loaded')
    expect(outlineReadStateOf(true, { values: { turnOutline: [] }, state: 'ready' }, true)).toBe('loaded')
    expect(outlineReadStateOf(true, undefined, true)).toBe('loading')
    expect(outlineReadStateOf(true, { values: {}, state: 'loading' }, true)).toBe('loading')
    expect(outlineReadStateOf(true, { values: {}, state: 'error' }, true)).toBe('failed')
    expect(outlineReadStateOf(true, { values: {}, state: 'ready' }, true)).toBe('absent')
    expect(outlineReadStateOf(true, { values: {}, state: 'migration-required' }, true)).toBe('absent')
    // A host with no projection read keeps the old "the list carries no
    // outline" reading instead of pretending a read is running.
    expect(outlineReadStateOf(true, undefined, false)).toBe('absent')
  })

  it('queues only missing, unrequested, readable outlines', () => {
    const sessions = [
      { id: 'root', outlineMissing: false },
      { id: 'cold', outlineMissing: true },
      { id: 'asked', outlineMissing: true },
      { id: 'running', outlineMissing: true },
      { id: 'failed', outlineMissing: true },
    ]
    const projections = {
      root: { values: { turnOutline: [] }, state: 'ready' },
      asked: { values: {}, state: 'loading' },
      running: { values: {}, state: 'loading' },
      failed: { values: {}, state: 'error' },
    }

    expect(outlineRefreshQueue(sessions, projections, new Set(['asked']))).toEqual(['cold'])
    expect(outlineRefreshQueue(sessions, projections, new Set(['asked']), true)).toEqual(['cold', 'failed'])
    expect(outlineRefreshQueue(sessions, projections, new Set(['cold', 'asked', 'running', 'failed']))).toEqual([])
  })

  it('re-arms reads a reconnect discarded', () => {
    const requested = new Set(['kept', 'reset'])
    rearmDiscardedOutlines(requested, {
      kept: { values: { turnOutline: [] }, state: 'ready' },
      reset: { values: {}, state: 'idle' },
    })
    expect([...requested]).toEqual(['kept'])
  })

  it('reads as loading while the projection read is in flight', () => {
    const html = renderCanvas([{ id: 'cold', displayTitle: 'cold' }], {
      projectionsBySession: { cold: { values: {}, state: 'loading' } },
      sessions: projectionOnlySessions,
    })

    expect(cardCount(html)).toBe(1)
    expect(html).toContain('正在读取 1 个会话的轮次投影')
    expect(html).not.toContain('没有轮次投影')
  })

  it('offers a retry when an outline read failed', () => {
    const html = renderCanvas([{ id: 'cold', displayTitle: 'cold' }], {
      projectionsBySession: { cold: { values: {}, state: 'error' } },
      sessions: projectionOnlySessions,
    })

    expect(html).toContain('1 个会话的轮次投影读取失败')
    expect(html).toContain('dsm__retry')
  })

  it('keeps the missing-outline note on a host without a projection read', () => {
    const html = renderCanvas([{ id: 'cold', displayTitle: 'cold' }])

    expect(html).toContain('列表里没有 turnOutline 投影，只能显示会话头')
  })

  it('leaves an older host whose rows already carry the outline untouched', () => {
    // Pre-0.2.2 list snapshots carried every cached projection on each row and
    // exposed no `projectionsBySession` on the state this View reads; the new
    // read path must stay inert there, with no loading note or missing note.
    const html = renderCanvas([summary('root', [turn(1, 'r1')])], {
      sessions: projectionOnlySessions,
    })

    expect(cardCount(html)).toBe(1)
    expect(html).not.toContain('轮次投影')
  })
})

/**
 * Build a runtime whose only working surface is the fake right column.
 * @param face - the right-column face the launcher calls.
 * @returns the runtime the launcher reads.
 */
function launcherRuntime(face: SidebarRightFace): SessionMapRuntime {
  return { sidebarRight: () => face, openSession: () => {} }
}

describe('map launcher toggle', () => {
  it('opens instead of closing when the collapsed column still reports the map', () => {
    const close = vi.fn()
    const openTab = vi.fn()
    const result = toggleMapRightbar(launcherRuntime({
      active: () => ({ id: 'tab-map', kind: MAP_KIND }),
      close,
      openTab,
      isExpanded: () => false,
    }))
    expect(result).toBe('opened')
    expect(openTab).toHaveBeenCalledWith(MAP_KIND)
    expect(close).not.toHaveBeenCalled()
  })

  it('closes the map only while it is on screen', () => {
    const close = vi.fn()
    const openTab = vi.fn()
    const result = toggleMapRightbar(launcherRuntime({
      active: () => ({ id: 'tab-map', kind: MAP_KIND }),
      close,
      openTab,
      isExpanded: () => true,
    }))
    expect(result).toBe('closed')
    expect(close).toHaveBeenCalledWith('tab-map')
    expect(openTab).not.toHaveBeenCalled()
  })

  it('opens when another tab is active', () => {
    const close = vi.fn()
    const openTab = vi.fn()
    const result = toggleMapRightbar(launcherRuntime({
      active: () => ({ id: 'tab-overview', kind: OVERVIEW_KIND }),
      close,
      openTab,
      isExpanded: () => true,
    }))
    expect(result).toBe('opened')
    expect(openTab).toHaveBeenCalledWith(MAP_KIND)
    expect(close).not.toHaveBeenCalled()
  })

  it('keeps the previous toggle when the host cannot report expansion', () => {
    const close = vi.fn()
    const result = toggleMapRightbar(launcherRuntime({
      active: () => ({ id: 'tab-map', kind: MAP_KIND }),
      close,
      openTab: vi.fn(),
    }))
    expect(result).toBe('closed')
    expect(close).toHaveBeenCalledWith('tab-map')
  })
})

describe('loaded event window', () => {
  it('extracts only human user messages, in order', () => {
    const entries: SessionEventEntryFace[] = [
      { type: 'transient', event: { type: 'assistant/live-chunk', seq: 1 } },
      { type: 'event', event: { type: 'turn/start', seq: 2, data: { turn: 1 } } },
      {
        type: 'event',
        event: {
          type: 'user/message',
          seq: 3,
          data: { source: { kind: 'user' }, content: [{ type: 'text', text: 'hi' }] },
        },
      },
      {
        type: 'event',
        event: {
          type: 'user/message',
          seq: 4,
          data: { source: { kind: 'system-prompt' }, content: [{ type: 'text', text: 'system' }] },
        },
      },
      {
        type: 'event',
        event: {
          type: 'user/message',
          seq: 5,
          data: {
            source: { kind: 'user' },
            content: [{ type: 'text', text: 'also' }, { type: 'image', url: 'x' }, { type: 'text', text: 'there' }],
          },
        },
      },
    ]

    expect(userMessagesOf(entries)).toEqual([
      { seq: 3, text: 'hi' },
      { seq: 5, text: 'also there' },
    ])
  })
})

describe('lineage scan', () => {
  const row = (id: string, extra: Partial<SessionSummary> = {}): SessionSummary => ({
    id,
    displayTitle: id,
    ...extra,
  })

  it('reads every listed Session for the all-Sessions scope, minus hidden subagents', () => {
    const byId = {
      a: row('a'),
      b: row('b'),
      sub: row('sub', { origin: 'subagent' }),
    }
    const ids = ['a', 'b', 'sub']

    expect(lineageScanSessionIds('all', 'a', ids, byId, [], false)).toEqual(['a', 'b', 'sub'])
    expect(lineageScanSessionIds('all', 'a', ids, byId, [], true)).toEqual(['a', 'b'])
  })

  it('stays inside the current Workspace and follows recorded children', () => {
    const byId = {
      a: row('a'),
      b: row('b'),
      elsewhere: row('elsewhere'),
      child: row('child', { parentId: 'a' }),
    }
    const ids = ['a', 'b', 'elsewhere', 'child']
    const workspaces = [{ sessionIds: ['a', 'b'] }]

    expect(lineageScanSessionIds('current', 'a', ids, byId, workspaces, false)).toEqual(['a', 'b', 'child'])
  })

  it('falls back to the whole list when no Workspace owns the current Session', () => {
    const byId = { a: row('a'), b: row('b') }

    expect(lineageScanSessionIds('current', 'ghost', ['a', 'b'], byId, [], false)).toEqual(['a', 'b'])
  })
})
