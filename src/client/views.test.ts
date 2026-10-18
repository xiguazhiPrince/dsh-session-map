/**
 * Canvas rendering smoke tests: build the real View over a fixed Session list
 * and render it with React's server renderer. This catches a broken element
 * tree or a bad graph/view contract that the pure layout tests cannot see.
 *
 * @module dsh-session-map/client/views.test
 */
import * as React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createFlag } from './flags'
import {
  createMapView,
  DEFAULT_FOLD_RUNS,
  userMessagesOf,
  type MapFlags,
  type SessionEventEntryFace,
  type SessionListState,
  type SessionMapRuntime,
  type SessionState,
  type SessionViewProps,
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
  options: { readonly foldRuns?: boolean } = {},
): string {
  const ids = summaries.map(item => item.id)
  const byId = Object.fromEntries(summaries.map(item => [item.id, item]))
  const props: SessionViewProps = {
    sessionId: 'root',
    useSessions: <Selected,>(select: (state: SessionListState) => Selected): Selected => (
      select({ ids, byId })
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
