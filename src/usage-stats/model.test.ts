/**
 * Counting-rule tests for the usage statistics model: line diffs, the Session
 * log fold (seed prefix, created files, failures, missing times), local-day
 * re-binning across zones, and the heat-map helpers.
 *
 * @module dsh-session-map/usage-stats/model.test
 */
import { describe, expect, it } from 'vitest'
import {
  aggregateUsage,
  buildCalendar,
  BUCKET_MS,
  daySeries,
  fileType,
  levelOf,
  lineDiff,
  localSlot,
  mondayIndex,
  peekEventType,
  quartileCuts,
  seriesHighlights,
  stateFromEnvelope,
  summarizeLines,
  USAGE_STATS_VERSION,
  type DayValue,
  type SessionSummary,
} from './model'

/** 2026-11-14T04:00:00Z — noon in Shanghai. */
const T0 = Date.UTC(2026, 10, 14, 4, 0, 0)

/** Serialize records as JSONL lines. */
function jsonl(...records: readonly unknown[]): string[] {
  return records.map(record => JSON.stringify(record))
}

/** A Session header record. */
function header(extra: Record<string, unknown> = {}): Record<string, unknown> {
  return { type: 'session', version: 4, id: 'session-a', createdAt: T0, cwd: '/w/proj', isSeeded: false, delegationDepth: 0, ...extra }
}

/** A tool call + successful result pair. */
function toolPair(id: string, name: string, args: unknown, meta: unknown, time = T0, isError = false): unknown[] {
  return [
    { type: 'tool/call', seq: 1, time, data: { callId: id, name, arguments: JSON.stringify(args) } },
    {
      type: 'tool/result',
      seq: 2,
      time,
      data: { message: { role: 'tool', toolCallId: id, isError, content: [] }, ...(meta === undefined ? {} : { meta }) },
    },
  ]
}

/** Unwrap a successful fold. */
function summarize(lines: readonly string[]): SessionSummary {
  const result = summarizeLines(lines)
  if (!result.ok) throw new Error(result.reason)
  return result.summary
}

/** Sum one numeric bucket field over a summary. */
function sum(summary: SessionSummary, field: 'added' | 'removed' | 'turns' | 'toolCalls' | 'toolFailures' | 'activeMs' | 'userMessages' | 'writeLines' | 'editLines'): number {
  return Object.values(summary.buckets).reduce((total, bucket) => total + bucket[field], 0)
}

describe('lineDiff', () => {
  it('counts a pure insertion and a pure deletion', () => {
    expect(lineDiff('a\nb\n', 'a\nx\nb\n')).toEqual({ added: 1, removed: 0 })
    expect(lineDiff('a\nb\nc', 'a\nc')).toEqual({ added: 0, removed: 1 })
  })

  it('finds the common subsequence inside the trimmed middle', () => {
    // Trim alone would call the middle 3 removed / 3 added; Myers keeps `m`.
    expect(lineDiff('a\nx\nm\ny\nz', 'a\np\nm\nq\nz')).toEqual({ added: 2, removed: 2 })
  })

  it('treats a trailing newline as the end of the last line', () => {
    expect(lineDiff('', 'one\ntwo\n')).toEqual({ added: 2, removed: 0 })
    expect(lineDiff('same\n', 'same\n')).toEqual({ added: 0, removed: 0 })
  })

  it('falls back to counting the whole middle past the search bound', () => {
    const before = Array.from({ length: 5000 }, (_, i) => `old ${String(i)}`).join('\n')
    const after = Array.from({ length: 5000 }, (_, i) => `new ${String(i)}`).join('\n')
    expect(lineDiff(before, after)).toEqual({ added: 5000, removed: 5000 })
  })
})

describe('fileType', () => {
  it('reads extensions, dotfiles, and bare names', () => {
    expect(fileType('/a/b/Index.TS')).toBe('.ts')
    expect(fileType('/a/.gitignore')).toBe('.gitignore')
    expect(fileType('/a/Dockerfile')).toBe('Dockerfile')
    expect(fileType(undefined)).toBe('(未知)')
  })
})

describe('peekEventType', () => {
  it('reads the persisted type prefix without parsing', () => {
    expect(peekEventType('{"type":"tool/call","seq":1}')).toBe('tool/call')
    expect(peekEventType('{"seq":1,"type":"x"}')).toBeUndefined()
  })
})

describe('summarizeLines', () => {
  it('counts edit diffs and created files by type', () => {
    const summary = summarize(jsonl(
      header(),
      ...toolPair('c1', 'edit', { file_path: '/w/proj/a.ts' }, { diffs: [{ path: '/w/proj/a.ts', oldText: 'x\n', newText: 'y\nz\n' }] }),
      // Current `write` results lack meta.path; the argument names the file.
      ...toolPair('c2', 'write', { file_path: '/w/proj/b.md', content: 'l1\nl2\nl3\n' }, { operation: 'create', diffs: [] }),
    ))
    expect(sum(summary, 'added')).toBe(5)
    expect(sum(summary, 'removed')).toBe(1)
    expect(sum(summary, 'editLines')).toBe(3)
    expect(sum(summary, 'writeLines')).toBe(3)
    const bucket = Object.values(summary.buckets)[0]
    expect(bucket?.exts).toEqual({ '.ts': { added: 2, removed: 1 }, '.md': { added: 3, removed: 0 } })
    expect(bucket?.tools).toEqual({ edit: { calls: 1, failures: 0 }, write: { calls: 1, failures: 0 } })
  })

  it('counts a failed tool result as a failure, not as lines', () => {
    const summary = summarize(jsonl(
      header(),
      ...toolPair('c1', 'edit', { file_path: '/a.ts' }, { diffs: [{ path: '/a.ts', oldText: 'a', newText: 'b' }] }, T0, true),
    ))
    expect(sum(summary, 'added')).toBe(0)
    expect(sum(summary, 'toolFailures')).toBe(1)
  })

  it('keeps a failure that lands in a later quarter-hour than its call', () => {
    const late = T0 + 20 * 60_000
    const summary = summarize(jsonl(
      header(),
      { type: 'tool/call', seq: 1, time: T0, data: { callId: 'c1', name: 'bash', arguments: '{}' } },
      { type: 'tool/result', seq: 2, time: late, data: { message: { toolCallId: 'c1', isError: true } } },
      // A quiet successful result opens no bucket of its own.
      { type: 'tool/call', seq: 3, time: late + 20 * 60_000, data: { callId: 'c2', name: 'read', arguments: '{}' } },
      { type: 'tool/result', seq: 4, time: late + 40 * 60_000, data: { message: { toolCallId: 'c2', isError: false } } },
    ))
    expect(Object.keys(summary.buckets)).toHaveLength(3)
    const report = aggregateUsage([summary], { timeZone: 'UTC', range: '30', now: T0 + 3_600_000 })
    expect(report.totals.toolCalls).toBe(2)
    expect(report.totals.toolFailures).toBe(1)
    expect(report.tools.find(row => row.name === 'bash')).toEqual({ name: 'bash', calls: 1, failures: 1 })
  })

  it('skips everything a fork inherited before its seed marker', () => {
    const summary = summarize(jsonl(
      header({ isSeeded: true, parentSession: 'session-p' }),
      { type: 'turn/start', seq: 0, time: T0 - 10_000, data: { turn: 1 } },
      ...toolPair('old', 'edit', { file_path: '/a.ts' }, { diffs: [{ path: '/a.ts', oldText: '', newText: 'a\nb\n' }] }, T0 - 9_000),
      { type: 'turn/end', seq: 3, time: T0 - 8_000, data: { turn: 1, reason: { kind: 'completed' } } },
      { type: 'session/end-seed', seq: 4, time: T0 - 8_000, data: { inherited: true } },
      { type: 'turn/start', seq: 5, time: T0, data: { turn: 2 } },
      ...toolPair('new', 'edit', { file_path: '/a.ts' }, { diffs: [{ path: '/a.ts', oldText: '', newText: 'c\n' }] }),
      { type: 'turn/end', seq: 8, time: T0 + 60_000, data: { turn: 2, reason: { kind: 'error' } } },
    ))
    expect(sum(summary, 'added')).toBe(1)
    expect(sum(summary, 'turns')).toBe(1)
    expect(sum(summary, 'activeMs')).toBe(60_000)
    expect(Object.values(summary.buckets)[0]?.turnErrors).toBe(1)
  })

  it('refuses a fork without a seed marker instead of double counting', () => {
    const result = summarizeLines(jsonl(header({ isSeeded: true })))
    expect(result.ok).toBe(false)
  })

  it('carries the last known time to events without one', () => {
    const later = T0 + 2 * BUCKET_MS
    const summary = summarize(jsonl(
      header(),
      { type: 'turn/start', seq: 0, time: later, data: { turn: 1 } },
      { type: 'user/message', seq: 1, data: { source: { kind: 'user' } } },
      { type: 'user/message', seq: 2, time: later, data: { source: { kind: 'runtime-context' } } },
    ))
    expect(Object.keys(summary.buckets)).toEqual([String(Math.floor(later / BUCKET_MS))])
    expect(sum(summary, 'userMessages')).toBe(1)
  })

  it('records token usage per model and marks models without usage', () => {
    const summary = summarize(jsonl(
      header({ origin: 'subagent' }),
      {
        type: 'assistant/message',
        seq: 1,
        time: T0,
        data: {
          message: { source: { provider: 'deepseek', model: 'flash' } },
          usage: { inputTokens: 100, outputTokens: 20, cacheReadTokens: 900, totalTokens: 1020 },
        },
      },
      { type: 'assistant/message', seq: 2, time: T0, data: { message: { source: { provider: 'acp', model: 'cursor' } } } },
    ))
    expect(summary.origin).toBe('subagent')
    const models = Object.values(summary.buckets)[0]?.models
    expect(models?.flash).toMatchObject({ steps: 1, withUsage: 1, inputTokens: 100, outputTokens: 20, cacheReadTokens: 900 })
    expect(models?.cursor).toMatchObject({ steps: 1, withUsage: 0, inputTokens: 0 })
  })
})

describe('localSlot and aggregateUsage', () => {
  it('re-bins one UTC bucket into different local days per zone', () => {
    // 2026-11-13T18:30Z: 02:30 on the 14th in Shanghai, 00:00 on the 14th in
    // Kolkata, still the 13th in UTC.
    const instant = Date.UTC(2026, 10, 13, 18, 30)
    expect(localSlot(instant, 'Asia/Shanghai')).toEqual({ date: '2026-11-14', hour: 2 })
    expect(localSlot(instant, 'Asia/Kolkata')).toEqual({ date: '2026-11-14', hour: 0 })
    expect(localSlot(instant, 'UTC')).toEqual({ date: '2026-11-13', hour: 18 })
  })

  const summaries: SessionSummary[] = [
    summarize(jsonl(
      header({ id: 's1', cwd: '/w/alpha' }),
      { type: 'turn/start', seq: 0, time: T0, data: { turn: 1 } },
      { type: 'user/message', seq: 1, time: T0, data: { source: { kind: 'user' } } },
      ...toolPair('c1', 'edit', { file_path: '/w/alpha/a.ts' }, { diffs: [{ path: '/w/alpha/a.ts', oldText: '', newText: 'a\nb\n' }] }),
      { type: 'turn/end', seq: 3, time: T0 + 1000, data: { turn: 1, reason: { kind: 'completed' } } },
    )),
    summarize(jsonl(
      header({ id: 's2', cwd: '/w/beta', origin: 'subagent', createdAt: T0 - 400 * 86_400_000 }),
      { type: 'turn/start', seq: 0, time: T0 - 400 * 86_400_000, data: { turn: 1 } },
    )),
  ]

  it('totals a range, splits origins, and counts only Sessions active in range', () => {
    const report = aggregateUsage(summaries, { timeZone: 'Asia/Shanghai', range: '365', now: T0 })
    expect(report.end).toBe('2026-11-14')
    expect(report.start).toBe('2025-11-15')
    expect(report.sessions).toEqual({ total: 1, root: 1, subagent: 0 })
    expect(report.totals.added).toBe(2)
    expect(report.totals.activeMs).toBe(1000)
    expect(report.hours[12]).toBe(1)
    expect(report.daily).toHaveLength(1)
    expect(report.daily[0]?.root.added).toBe(2)
    expect(report.projects.map(row => row.name)).toEqual(['alpha'])
    expect(report.exts).toEqual([{ ext: '.ts', added: 2, removed: 0 }])
  })

  it('stretches the all-time range back to the first active day', () => {
    const report = aggregateUsage(summaries, { timeZone: 'Asia/Shanghai', range: 'all', now: T0 })
    expect(report.start).toBe('2025-10-10')
    expect(report.sessions).toEqual({ total: 2, root: 1, subagent: 1 })
  })
})

describe('heat map helpers', () => {
  it('starts weeks on Monday and leaves days after today empty', () => {
    expect(mondayIndex('2026-11-09')).toBe(0)
    expect(mondayIndex('2026-11-15')).toBe(6)
    const calendar = buildCalendar('2026-10-01', '2026-11-14')
    expect(calendar.weeks[0]?.[0]).toEqual({ date: '2026-09-28', inRange: false })
    expect(calendar.weeks[0]?.[3]).toEqual({ date: '2026-10-01', inRange: true })
    const last = calendar.weeks[calendar.weeks.length - 1]
    expect(last?.[5]).toEqual({ date: '2026-11-14', inRange: true })
    expect(last?.[6]).toBeNull()
    expect(calendar.months.map(label => label.month)).toEqual([10, 11])
  })

  it('lays a full year out as 53 week columns', () => {
    expect(buildCalendar('2025-11-15', '2026-11-14').weeks).toHaveLength(53)
  })

  it('drops the first month label when the next one crowds it', () => {
    const calendar = buildCalendar('2026-09-25', '2026-11-14')
    expect(calendar.months[0]?.month).toBe(10)
  })

  it('cuts quartiles over non-zero days only', () => {
    expect(quartileCuts([0, 0, 0])).toEqual([])
    expect(quartileCuts([5])).toEqual([5, 5, 5])
    expect(quartileCuts([0, 1, 2, 3, 4, 5, 6, 7, 8])).toEqual([2, 4, 6])
    const cuts = quartileCuts([1, 2, 3, 4, 5, 6, 7, 8])
    expect(levelOf(0, cuts, 8)).toBe(0)
    expect(levelOf(1, cuts, 8)).toBe(1)
    expect(levelOf(5, cuts, 8)).toBe(3)
    expect(levelOf(8, cuts, 8)).toBe(4)
    expect(levelOf(5, [5, 5, 5], 5)).toBe(4)
  })

  it('finds busiest month/day and streaks; current counts from yesterday when today is empty', () => {
    const day = (value: number): DayValue => ({ value, added: value, removed: 0 })
    const series = new Map<string, DayValue>([
      ['2026-10-01', day(5)],
      ['2026-10-02', day(50)],
      ['2026-10-03', day(5)],
      ['2026-11-12', day(1)],
      ['2026-11-13', day(1)],
    ])
    const highlights = seriesHighlights(series, '2026-01-01', '2026-11-14')
    expect(highlights.topMonth).toEqual({ month: '2026-10', value: 60 })
    expect(highlights.topDay).toEqual({ date: '2026-10-02', value: 50 })
    expect(highlights.longest).toEqual({ length: 3, from: '2026-10-01', to: '2026-10-03' })
    expect(highlights.current).toEqual({ length: 2, endsToday: false })
    expect(seriesHighlights(new Map(), '2026-01-01', '2026-11-14').current.length).toBe(0)
  })

  it('filters the series by origin and metric', () => {
    const daily = [{
      date: '2026-11-14',
      root: { added: 3, removed: 1, turns: 2, tokens: 10, activeMs: 0 },
      subagent: { added: 0, removed: 0, turns: 1, tokens: 5, activeMs: 0 },
    }]
    expect(daySeries(daily, 'all', 'lines').get('2026-11-14')).toEqual({ value: 4, added: 3, removed: 1 })
    expect(daySeries(daily, 'subagent', 'lines').size).toBe(0)
    expect(daySeries(daily, 'subagent', 'tokens').get('2026-11-14')?.value).toBe(5)
  })
})

describe('stateFromEnvelope', () => {
  it('unwraps scanning and rejects failures and version skew', () => {
    expect(stateFromEnvelope({ ok: true, version: USAGE_STATS_VERSION, status: 'scanning', progress: { done: 1, total: 4 } }))
      .toEqual({ status: 'scanning', progress: { done: 1, total: 4 } })
    expect(() => stateFromEnvelope({ ok: false, error: { code: 'internal', message: 'boom' } })).toThrow('boom')
    expect(() => stateFromEnvelope({ ok: true, version: 999, status: 'scanning' })).toThrow('版本')
  })
})
