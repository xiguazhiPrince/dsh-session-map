/**
 * Render tests for the usage statistics page: every body state, both tabs, the
 * row caps, and the number formatting. The report comes from the real
 * aggregator over folded fixture logs, so the view is exercised against the
 * exact shape the Host sends.
 *
 * @module dsh-session-map/usage-stats/client.test
 */
import { renderToStaticMarkup } from 'react-dom/server'
import * as React from 'react'
import { describe, expect, it } from 'vitest'
import { aggregateUsage, summarizeLines, type SessionSummary, type UsageReport } from './model'
import {
  formatCompact,
  formatDuration,
  formatPercent,
  HEAT_CELL_MAX,
  HEAT_CELL_MIN,
  heatGridWidth,
  UsageStatsPage,
  type UsageBody,
  type UsageStatsPageProps,
} from './view'

/** 2026-11-14T04:00:00Z — noon in Shanghai. */
const T0 = Date.UTC(2026, 10, 14, 4)
const DAY = 86_400_000

/** Fold one fixture Session whose write adds `lines` lines `daysAgo` days back. */
function session(id: string, daysAgo: number, lines: number, tool = 'write', extra: Record<string, unknown> = {}): SessionSummary {
  const time = T0 - daysAgo * DAY
  const records = [
    { type: 'session', version: 4, id, createdAt: time, cwd: `/w/${id}`, isSeeded: false, ...extra },
    { type: 'user/message', seq: 0, time, data: { source: { kind: 'user' }, message: { role: 'user', content: [] } } },
    { type: 'turn/start', seq: 1, time, data: { turn: 1 } },
    { type: 'assistant/message', seq: 2, time, data: { message: { role: 'assistant', source: { provider: 'p', model: 'm-1' } }, usage: { inputTokens: 1000, outputTokens: 200, cacheReadTokens: 9000 } } },
    { type: 'tool/call', seq: 3, time, data: { callId: 'c', name: tool, arguments: JSON.stringify({ file_path: `/w/${id}/a.ts`, content: 'x\n'.repeat(lines) }) } },
    { type: 'tool/result', seq: 4, time, data: { message: { toolCallId: 'c', isError: false }, meta: { operation: 'create', diffs: [] } } },
    { type: 'turn/end', seq: 5, time: time + 90_000, data: { turn: 1, reason: { kind: 'completed' } } },
  ]
  const result = summarizeLines(records.map(record => JSON.stringify(record)))
  if (!result.ok) throw new Error(result.reason)
  return result.summary
}

/** A report over a few days, a subagent, and many projects and tools. */
function fixtureReport(): UsageReport {
  const summaries = [
    session('alpha', 0, 120),
    session('beta', 3, 40),
    session('gamma', 40, 7, 'write', { origin: 'subagent' }),
    ...Array.from({ length: 12 }, (_, index) => session(`p${String(index)}`, 10, 1, `tool${String(index)}`)),
  ]
  return aggregateUsage(summaries, { timeZone: 'Asia/Shanghai', range: '365', now: T0 })
}

/** Render the page for one body. */
function render(body: UsageBody, overrides: Partial<UsageStatsPageProps> = {}): string {
  const noop = (): void => {}
  return renderToStaticMarkup(React.createElement(UsageStatsPage, {
    body,
    tab: 'overview',
    onTab: noop,
    range: '365',
    onRange: noop,
    metric: 'lines',
    onMetric: noop,
    origin: 'all',
    onOrigin: noop,
    onRefresh: noop,
    busy: false,
    staleFailure: null,
    ...overrides,
  }))
}

/** A ready body over the fixture report. */
function ready(report = fixtureReport(), skipped: Array<{ path: string; reason: string }> = []): UsageBody {
  return { kind: 'ready', report, scannedAt: new Date(T0).toISOString(), refreshing: false, skipped }
}

describe('formatters', () => {
  it('compacts counts and durations', () => {
    expect(formatCompact(994_600)).toBe('994.6K')
    expect(formatCompact(161_400_000)).toBe('161.4M')
    expect(formatCompact(12_870_000_000)).toBe('12.87B')
    expect(formatCompact(42)).toBe('42')
    expect(formatDuration(5.4 * 60_000)).toBe('5.4 分钟')
    expect(formatDuration(272 * 3_600_000)).toBe('272 小时')
    expect(formatPercent(1, 0)).toBe('0%')
  })
})

describe('heat map layout', () => {
  it('fits a full year into the Settings modal without scrolling', () => {
    // The Settings content column is about 560px; the card padding takes 34px.
    expect(heatGridWidth(53, HEAT_CELL_MIN)).toBeLessThanOrEqual(560 - 34)
    expect(heatGridWidth(53, 7)).toBeLessThanOrEqual(560 - 34)
    expect(heatGridWidth(5, HEAT_CELL_MAX)).toBe(24 + 5 * 14 + 4 * 2)
  })

  it('renders the grid with fitted bounds and a sticky label column', () => {
    const html = render(ready())
    expect(html).toContain(`min-width:${String(heatGridWidth(53, HEAT_CELL_MIN))}px`)
    expect(html).toContain('us-corner')
  })
})

describe('UsageStatsPage', () => {
  it('shows scan progress before the first snapshot', () => {
    const html = render({ kind: 'scanning', progress: { done: 272, total: 468 } })
    expect(html).toContain('正在扫描会话日志')
    expect(html).toContain('已读 272 / 468 个会话')
    expect(html).toContain('aria-valuenow="272"')
  })

  it('shows the failure with a retry when nothing was read yet', () => {
    const html = render({ kind: 'error', message: 'boom' })
    expect(html).toContain('统计读取失败')
    expect(html).toContain('boom')
    expect(html).toContain('重试')
  })

  it('offers the whole history when a range is empty', () => {
    const empty = aggregateUsage([], { timeZone: 'UTC', range: '30', now: T0 })
    const html = render(ready(empty), { range: '30' })
    expect(html).toContain('还没有可统计的记录')
    expect(html).toContain('查看全部时间')
    const emptyAll = aggregateUsage([], { timeZone: 'UTC', range: 'all', now: T0 })
    expect(render(ready(emptyAll), { range: 'all' })).not.toContain('查看全部时间')
  })

  it('labels and dims the previous range while a switch is loading', () => {
    const html = render(ready(), { range: '30', busy: true })
    expect(html).toContain('显示的是「近一年」的数据 · 正在切换…')
    expect(html).toContain('class="us-dim"')
    expect(render(ready())).not.toContain('class="us-dim"')
  })

  it('renders the overview: totals, heat cells, highlights, KPIs, hours', () => {
    const html = render(ready())
    expect(html).toContain('15 个会话')
    // 120 + 40 + 7 plus twelve one-line creates: any tool's create result counts.
    expect(html).toContain('>179<')
    expect(html).toContain('+179')
    expect(html).toContain('data-date="2026-11-14"')
    expect(html).toContain('us-cell--4')
    expect(html).toContain('最活跃的一天')
    expect(html).toContain('2026.11.14')
    expect(html).toContain('主会话 14 · 子代理 1')
    expect(html).toContain('命中率 90.0%')
    expect(html).toContain('高峰 12:00')
    expect(html).toContain('bash 里改的文件不计入')
  })

  it('filters the heat map by origin', () => {
    const html = render(ready(), { origin: 'subagent' })
    expect(html).toContain('>7<')
  })

  it('renders the detail tables with row caps and the counting rules', () => {
    const html = render(ready(), { tab: 'details' })
    expect(html).toContain('按项目')
    expect(html).toContain('共 15 个工作目录')
    expect(html).toContain('其余 5 项')
    expect(html).toContain('按模型')
    expect(html).toContain('m-1')
    expect(html).toContain('按工具')
    expect(html).toContain('其余 1 项')
    expect(html).toContain('按文件类型')
    expect(html).toContain('.ts')
    expect(html).toContain('统计口径')
    expect(html).toContain('Asia/Shanghai')
  })

  it('keeps older numbers under a stale failure and lists skipped logs', () => {
    const html = render(ready(fixtureReport(), [{ path: 'a/b/session.v4.jsonl.zstd', reason: '解压失败' }]), { staleFailure: 'HTTP 500' })
    expect(html).toContain('本次刷新失败')
    expect(html).toContain('有 1 个会话日志无法读取')
    expect(html).toContain('a/b/session.v4.jsonl.zstd')
    expect(html).toContain('us-heatGrid')
  })
})
