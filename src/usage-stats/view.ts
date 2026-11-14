/**
 * Pure presentation of Settings → 用量统计: the toolbar, the contribution heat
 * map, the KPI tiles, the hourly bars, and the detail tables, plus the
 * scanning, empty, and failure states. Every input arrives through props, so
 * the server renderer can exercise the whole tree in tests; fetching and
 * polling live in `client.ts`.
 *
 * @module dsh-session-map/usage-stats/view
 */
import * as React from 'react'
import { USAGE_CSS } from './css'
import {
  buildCalendar,
  daySeries,
  levelOf,
  mondayIndex,
  quartileCuts,
  seriesHighlights,
  type DayValue,
  type HeatMetric,
  type OriginFilter,
  type RangeKind,
  type ScanProgress,
  type SkippedLog,
  type UsageReport,
} from './model'

const h = React.createElement

/** Page copy; the plugin is Chinese-first like its other seats. */
export const COPY = {
  title: '用量统计',
  description: '从本机会话日志汇总 AI 的代码改动、对话与 Token 用量。只在本机计算，不上传。',
  overview: '概览',
  details: '明细',
  refresh: '刷新',
  retry: '重试',
  scanningTitle: '正在扫描会话日志…',
  scanningText: '第一次打开需要读完全部日志，之后只增量读取有变化的会话。',
  emptyTitle: '还没有可统计的记录',
  emptyText: '当前时间范围内没有会话活动。换一个时间范围，或先在任意会话里让 Agent 改点东西。',
  showAll: '查看全部时间',
  errorTitle: '统计读取失败',
  staleFailure: '本次刷新失败，下面仍是上一次读到的结果。',
  footnote: '统计 edit / write 工具的改动；bash 里改的文件不计入',
} as const

/** Range choices, in menu order. */
export const RANGE_OPTIONS: ReadonlyArray<{ readonly value: RangeKind; readonly label: string }> = [
  { value: '365', label: '近一年' },
  { value: '180', label: '近半年' },
  { value: '90', label: '近 90 天' },
  { value: '30', label: '近 30 天' },
  { value: 'all', label: '全部时间' },
]

/** Heat-map metric choices. */
const METRIC_OPTIONS: ReadonlyArray<{ readonly value: HeatMetric; readonly label: string }> = [
  { value: 'lines', label: 'AI 改动行数' },
  { value: 'tokens', label: 'Token（输入 + 输出）' },
  { value: 'turns', label: '对话轮次' },
  { value: 'time', label: 'Agent 运行时长' },
]

/** Origin filter choices. */
const ORIGIN_OPTIONS: ReadonlyArray<{ readonly value: OriginFilter; readonly label: string }> = [
  { value: 'all', label: '全部' },
  { value: 'root', label: '主会话' },
  { value: 'subagent', label: '子代理' },
]

/** Monday-first weekday names. */
const WEEKDAYS = ['一', '二', '三', '四', '五', '六', '日'] as const

/** Row caps of the detail tables; the rest folds into one row. */
export const TABLE_LIMITS = { projects: 10, models: 10, tools: 12, exts: 10 } as const

// ---------------------------------------------------------------------------
// Formatting
// ---------------------------------------------------------------------------

/** Thousands-separated integer. */
export function formatInt(value: number): string {
  return Math.round(value).toLocaleString('en-US')
}

/** Compact count: 994.6K, 161.4M, 12.87B. */
export function formatCompact(value: number): string {
  const abs = Math.abs(value)
  if (abs >= 1e9) return `${(value / 1e9).toFixed(2)}B`
  if (abs >= 1e6) return `${(value / 1e6).toFixed(1)}M`
  if (abs >= 1e3) return `${(value / 1e3).toFixed(1)}K`
  return formatInt(value)
}

/** Duration in the largest readable unit. */
export function formatDuration(ms: number): string {
  const minutes = ms / 60_000
  if (minutes < 1) return ms <= 0 ? '0 分钟' : '不到 1 分钟'
  if (minutes < 60) return `${minutes.toFixed(minutes < 10 ? 1 : 0)} 分钟`
  const hours = minutes / 60
  return `${hours < 10 ? hours.toFixed(1) : formatInt(hours)} 小时`
}

/** Percentage with one decimal. */
export function formatPercent(part: number, whole: number): string {
  if (whole <= 0) return '0%'
  return `${((part / whole) * 100).toFixed(1)}%`
}

/** One value of a heat-map metric, with its unit. */
function formatMetric(metric: HeatMetric, value: number): string {
  switch (metric) {
    case 'lines': return `${formatInt(value)} 行`
    case 'tokens': return formatCompact(value)
    case 'turns': return `${formatInt(value)} 轮`
    case 'time': return formatDuration(value)
  }
}

/** `2026-10-05` → `2026.10.05`. */
function dottedDate(date: string): string {
  return date.replaceAll('-', '.')
}

/** Local wall-clock `HH:MM` of an ISO time. */
export function formatClock(iso: string): string {
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return ''
  return date.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit', hour12: false })
}

// ---------------------------------------------------------------------------
// Shared pieces
// ---------------------------------------------------------------------------

/** A segmented control of mutually exclusive buttons. */
function Segmented<T extends string>(props: {
  readonly options: ReadonlyArray<{ readonly value: T; readonly label: string }>
  readonly value: T
  readonly onChange: (next: T) => void
  readonly label: string
  readonly plain?: boolean
  readonly className?: string
}): React.ReactElement {
  return h(
    'div',
    {
      className: ['us-seg', props.plain === true ? 'us-seg--plain' : '', props.className ?? ''].filter(Boolean).join(' '),
      role: 'group',
      'aria-label': props.label,
    },
    ...props.options.map(option => h(
      'button',
      {
        key: option.value,
        type: 'button',
        className: 'us-segBtn',
        'aria-pressed': option.value === props.value,
        onClick: () => { props.onChange(option.value) },
      },
      option.label,
    )),
  )
}

/** Small inline SVG icons used by the state cards. */
function Icon({ kind }: { readonly kind: 'chart' | 'alert' }): React.ReactElement {
  const paths = kind === 'chart'
    ? [h('path', { key: 'a', d: 'M3 3v18h18' }), h('path', { key: 'b', d: 'M8 17v-5' }), h('path', { key: 'c', d: 'M13 17V7' }), h('path', { key: 'd', d: 'M18 17v-8' })]
    : [h('circle', { key: 'a', cx: 12, cy: 12, r: 10 }), h('path', { key: 'b', d: 'M12 8v4' }), h('path', { key: 'c', d: 'M12 16h.01' })]
  return h(
    'svg',
    {
      className: kind === 'alert' ? 'us-stateIcon us-stateIcon--error' : 'us-stateIcon',
      viewBox: '0 0 24 24',
      fill: 'none',
      stroke: 'currentColor',
      strokeWidth: 2,
      strokeLinecap: 'round',
      strokeLinejoin: 'round',
      'aria-hidden': true,
    },
    ...paths,
  )
}

/** Scanning progress card. */
export function ScanningCard({ progress }: { readonly progress: ScanProgress }): React.ReactElement {
  const percent = progress.total === 0 ? 0 : Math.round((progress.done / progress.total) * 100)
  return h(
    'div',
    { className: 'us-card us-state', role: 'status', 'aria-live': 'polite' },
    h('div', { className: 'us-spinner', 'aria-hidden': true }),
    h('div', { className: 'us-stateTitle' }, COPY.scanningTitle),
    h('div', { className: 'us-stateText' }, COPY.scanningText),
    progress.total === 0
      ? null
      : h(
        'div',
        {
          className: 'us-progress',
          role: 'progressbar',
          'aria-valuemin': 0,
          'aria-valuemax': progress.total,
          'aria-valuenow': progress.done,
        },
        h('div', { className: 'us-progressFill', style: { width: `${String(percent)}%` } }),
      ),
    progress.total === 0
      ? null
      : h('div', { className: 'us-sub us-mono' }, `已读 ${formatInt(progress.done)} / ${formatInt(progress.total)} 个会话`),
  )
}

/** Empty-range card. */
export function EmptyCard(props: { readonly range: RangeKind; readonly onShowAll: () => void }): React.ReactElement {
  return h(
    'div',
    { className: 'us-card us-state' },
    h(Icon, { kind: 'chart' }),
    h('div', { className: 'us-stateTitle' }, COPY.emptyTitle),
    h('div', { className: 'us-stateText' }, COPY.emptyText),
    props.range === 'all'
      ? null
      : h('button', { type: 'button', className: 'us-btn', onClick: props.onShowAll }, COPY.showAll),
  )
}

/** Failure card shown when no numbers exist yet. */
export function ErrorCard(props: { readonly message: string; readonly onRetry: () => void }): React.ReactElement {
  return h(
    'div',
    { className: 'us-card us-state', role: 'alert' },
    h(Icon, { kind: 'alert' }),
    h('div', { className: 'us-stateTitle' }, COPY.errorTitle),
    h('div', { className: 'us-stateText' }, props.message),
    h('button', { type: 'button', className: 'us-btn', onClick: props.onRetry }, COPY.retry),
  )
}

/** Warning banner listing logs the scan could not count. */
function SkippedBanner({ skipped }: { readonly skipped: readonly SkippedLog[] }): React.ReactElement {
  const shown = skipped.slice(0, 3)
  return h(
    'div',
    { className: 'us-banner', role: 'status' },
    h('div', { className: 'us-bannerTitle' }, `有 ${formatInt(skipped.length)} 个会话日志无法读取，已跳过；其余数据照常显示。`),
    ...shown.map(item => h('div', { key: item.path, className: 'us-bannerPath', title: item.reason }, `${item.path} — ${item.reason}`)),
    skipped.length > shown.length
      ? h('div', { className: 'us-bannerPath' }, `…等 ${formatInt(skipped.length)} 个`)
      : null,
  )
}

// ---------------------------------------------------------------------------
// Heat map
// ---------------------------------------------------------------------------

/** Hovered cell and its tooltip anchor inside the card. */
interface Hover {
  readonly date: string
  readonly x: number
  readonly y: number
}

/** Props of the heat-map card. */
export interface HeatmapCardProps {
  readonly report: UsageReport
  readonly metric: HeatMetric
  readonly onMetric: (next: HeatMetric) => void
  readonly origin: OriginFilter
  readonly onOrigin: (next: OriginFilter) => void
}

/** The big number at the top of the heat-map card. */
function HeatTotal(props: { readonly metric: HeatMetric; readonly series: ReadonlyMap<string, DayValue> }): React.ReactElement {
  let value = 0
  let added = 0
  let removed = 0
  for (const day of props.series.values()) {
    value += day.value
    added += day.added
    removed += day.removed
  }
  const big = props.metric === 'lines' ? formatInt(value)
    : props.metric === 'tokens' ? formatCompact(value)
      : props.metric === 'turns' ? formatInt(value)
        : formatDuration(value)
  return h(
    'div',
    { className: 'us-bigRow' },
    h('span', { className: 'us-big' }, big),
    props.metric === 'lines'
      ? h('span', { className: 'us-mono' }, h('span', { className: 'us-add' }, `+${formatInt(added)}`), ' ', h('span', { className: 'us-del' }, `−${formatInt(removed)}`))
      : null,
  )
}

/** Narrowest heat cell before the grid scrolls instead of shrinking further. */
export const HEAT_CELL_MIN = 5

/** Widest heat cell; a short range stays compact instead of blowing cells up. */
export const HEAT_CELL_MAX = 14

/** Gap between heat cells, both directions (mirrors `.us-cells` in css.ts). */
const HEAT_GAP = 2

/** Weekday label column, including its right padding (mirrors `.us-heatGrid`). */
const HEAT_LABEL_COLUMN = 24

/**
 * Width of the heat grid when every cell is `cell` px wide. The columns are
 * `1fr` squares, so the grid fits its card: clamping this width between the
 * two cell sizes is the whole layout.
 * @param weeks - week columns.
 * @param cell - cell edge in px.
 * @returns grid width in px.
 */
export function heatGridWidth(weeks: number, cell: number): number {
  return HEAT_LABEL_COLUMN + weeks * cell + Math.max(0, weeks - 1) * HEAT_GAP
}

/**
 * GitHub-style contribution card: metric and origin switches, the week grid,
 * four highlights, and the legend.
 * @param props - report and the two switches.
 * @returns the card.
 */
export function HeatmapCard(props: HeatmapCardProps): React.ReactElement {
  const { report, metric, origin } = props
  const series = React.useMemo(() => daySeries(report.daily, origin, metric), [report, origin, metric])
  const calendar = React.useMemo(() => buildCalendar(report.start, report.end), [report.start, report.end])
  const values = [...series.values()].map(day => day.value)
  const cuts = quartileCuts(values)
  const max = values.length === 0 ? 0 : Math.max(...values)
  const highlights = seriesHighlights(series, report.start, report.end)
  const [hover, setHover] = React.useState<Hover | null>(null)
  const cardRef = React.useRef<HTMLDivElement | null>(null)
  const scrollRef = React.useRef<HTMLDivElement | null>(null)
  const weeks = calendar.weeks.length

  // The grid only scrolls when cells would drop below HEAT_CELL_MIN; then the
  // newest weeks matter most, so it starts scrolled to today.
  React.useEffect(() => {
    const scroller = scrollRef.current
    if (scroller !== null) scroller.scrollLeft = scroller.scrollWidth
  }, [weeks])

  const onPointer = (event: React.MouseEvent<HTMLDivElement>): void => {
    const target = event.target as HTMLElement
    const date = target.dataset.date
    const card = cardRef.current
    // Gaps between cells carry no date: keep the tooltip instead of flickering.
    if (date === undefined || card === null) return
    const cell = target.getBoundingClientRect()
    const box = card.getBoundingClientRect()
    const center = cell.left + cell.width / 2 - box.left
    const x = box.width > 180 ? Math.min(Math.max(center, 90), box.width - 90) : box.width / 2
    setHover(previous => previous?.date === date ? previous : { date, x, y: cell.top - box.top })
  }

  const hovered = hover === null ? undefined : series.get(hover.date)
  const cellNodes: React.ReactElement[] = []
  calendar.weeks.forEach((week, column) => {
    week.forEach((cell, row) => {
      const key = `${String(column)}-${String(row)}`
      if (cell === null || !cell.inRange) {
        cellNodes.push(h('div', { key, className: 'us-cell us-cell--void' }))
        return
      }
      const level = levelOf(series.get(cell.date)?.value ?? 0, cuts, max)
      const classes = ['us-cell']
      if (level > 0) classes.push(`us-cell--${String(level)}`)
      if (hover?.date === cell.date) classes.push('us-cell--hover')
      cellNodes.push(h('div', { key, className: classes.join(' '), 'data-date': cell.date }))
    })
  })

  const endYear = report.end.slice(0, 4)
  const monthLabel = (month: string): string => {
    const [year, mm] = month.split('-')
    return year === endYear ? `${String(Number(mm))}月` : `${year ?? ''}年${String(Number(mm))}月`
  }
  const current = highlights.current
  const summary = `${report.start} 至 ${report.end}，${formatInt(series.size)} 天有记录`

  return h(
    'div',
    { className: 'us-card', ref: cardRef },
    h(
      'div',
      { className: 'us-heatHead' },
      h(
        'div',
        { className: 'us-heatTotals' },
        h(
          'select',
          {
            className: 'us-metric',
            'aria-label': '热力图指标',
            value: metric,
            onChange: (event: React.ChangeEvent<HTMLSelectElement>) => { props.onMetric(event.target.value as HeatMetric) },
          },
          ...METRIC_OPTIONS.map(option => h('option', { key: option.value, value: option.value }, option.label)),
        ),
        h(HeatTotal, { metric, series }),
      ),
      h(Segmented<OriginFilter>, {
        options: ORIGIN_OPTIONS,
        value: origin,
        onChange: props.onOrigin,
        label: '会话来源',
        plain: true,
        className: 'us-originSeg',
      }),
    ),
    h(
      'div',
      { className: 'us-heatScroll', ref: scrollRef },
      h(
        'div',
        {
          className: 'us-heatGrid',
          style: {
            '--us-weeks': String(weeks),
            minWidth: `${String(heatGridWidth(weeks, HEAT_CELL_MIN))}px`,
            maxWidth: `${String(heatGridWidth(weeks, HEAT_CELL_MAX))}px`,
          } as React.CSSProperties,
        },
        h('div', { className: 'us-corner', 'aria-hidden': true }),
        h(
          'div',
          { className: 'us-months', 'aria-hidden': true, style: { gridRow: 1 } },
          ...calendar.months.map(label => h(
            'span',
            { key: `${String(label.year)}-${String(label.month)}`, className: 'us-month', style: { gridColumnStart: label.column + 1 } },
            `${String(label.month)}月`,
          )),
        ),
        h(
          'div',
          { className: 'us-weekdays', 'aria-hidden': true, style: { gridRow: 2 } },
          ...WEEKDAYS.map((day, index) => h('span', { key: day }, index % 2 === 0 ? day : '')),
        ),
        h(
          'div',
          {
            className: 'us-cells',
            style: { gridRow: 2 },
            role: 'img',
            'aria-label': summary,
            onMouseOver: onPointer,
            onMouseLeave: () => { setHover(null) },
          },
          ...cellNodes,
        ),
      ),
    ),
    hover === null
      ? null
      : h(
        'div',
        { className: 'us-tip', style: { left: `${String(hover.x)}px`, top: `${String(hover.y)}px` } },
        h('div', { className: 'us-tipSub' }, `${hover.date} 周${WEEKDAYS[mondayIndex(hover.date)] ?? ''}`),
        h(
          'div',
          null,
          h('span', { className: 'us-tipValue' }, hovered === undefined ? '没有记录' : formatMetric(metric, hovered.value)),
          hovered !== undefined && metric === 'lines'
            ? h('span', { className: 'us-tipSub' }, `  +${formatInt(hovered.added)} −${formatInt(hovered.removed)}`)
            : null,
        ),
      ),
    h(
      'div',
      { className: 'us-highlights' },
      h(
        'div',
        { className: 'us-hl' },
        h('span', { className: 'us-label' }, '最活跃月份'),
        h('span', { className: 'us-hlValue' }, highlights.topMonth === null ? '—' : monthLabel(highlights.topMonth.month)),
        h('span', { className: 'us-sub' }, highlights.topMonth === null ? ' ' : formatMetric(metric, highlights.topMonth.value)),
      ),
      h(
        'div',
        { className: 'us-hl' },
        h('span', { className: 'us-label' }, '最活跃的一天'),
        h('span', { className: 'us-hlValue' }, highlights.topDay === null ? '—' : dottedDate(highlights.topDay.date)),
        h('span', { className: 'us-sub' }, highlights.topDay === null ? ' ' : formatMetric(metric, highlights.topDay.value)),
      ),
      h(
        'div',
        { className: 'us-hl' },
        h('span', { className: 'us-label' }, '最长连续'),
        h('span', { className: 'us-hlValue' }, `${formatInt(highlights.longest?.length ?? 0)} 天`),
        h('span', { className: 'us-sub' }, highlights.longest === null
          ? ' '
          : highlights.longest.from === highlights.longest.to
            ? dottedDate(highlights.longest.from)
            : `${dottedDate(highlights.longest.from).slice(5)} – ${dottedDate(highlights.longest.to).slice(5)}`),
      ),
      h(
        'div',
        { className: 'us-hl' },
        h('span', { className: 'us-label' }, '当前连续'),
        h('span', { className: 'us-hlValue' }, `${formatInt(current.length)} 天`),
        h('span', { className: 'us-sub' }, current.length === 0 ? '今天还没有记录' : current.endsToday ? '截至今天' : '截至昨天'),
      ),
    ),
    h(
      'div',
      { className: 'us-heatFoot' },
      h(
        'span',
        { className: 'us-legend', 'aria-hidden': true },
        h('span', null, '少'),
        ...[0, 1, 2, 3, 4].map(level => h('i', { key: level, className: level === 0 ? 'us-cell' : `us-cell us-cell--${String(level)}` })),
        h('span', null, '多'),
      ),
      h('span', { className: 'us-footNote' }, `ⓘ ${COPY.footnote}`),
    ),
  )
}

// ---------------------------------------------------------------------------
// Overview tiles and hours
// ---------------------------------------------------------------------------

/** One KPI tile. */
function Kpi(props: { readonly label: string; readonly value: string; readonly sub: string }): React.ReactElement {
  return h(
    'div',
    { className: 'us-kpi' },
    h('span', { className: 'us-label' }, props.label),
    h('span', { className: 'us-kpiValue' }, props.value),
    h('span', { className: 'us-sub' }, props.sub),
  )
}

/** The six range totals. */
export function KpiTiles({ report }: { readonly report: UsageReport }): React.ReactElement {
  const { totals, sessions } = report
  const perSession = sessions.total === 0 ? 0 : totals.turns / sessions.total
  const perTurn = totals.turns === 0 ? 0 : totals.activeMs / totals.turns
  return h(
    'div',
    { className: 'us-kpis' },
    h(Kpi, { label: '会话', value: formatInt(sessions.total), sub: `主会话 ${formatInt(sessions.root)} · 子代理 ${formatInt(sessions.subagent)}` }),
    h(Kpi, { label: '对话轮次', value: formatInt(totals.turns), sub: `平均每会话 ${perSession.toFixed(1)} 轮` }),
    h(Kpi, { label: 'Agent 运行时长', value: formatDuration(totals.activeMs), sub: `平均每轮 ${formatDuration(perTurn)}` }),
    h(Kpi, {
      label: 'Token',
      value: formatCompact(totals.inputTokens + totals.outputTokens),
      sub: `输入 ${formatCompact(totals.inputTokens)} · 输出 ${formatCompact(totals.outputTokens)}`,
    }),
    h(Kpi, {
      label: '缓存命中',
      value: formatCompact(totals.cacheReadTokens),
      sub: `命中率 ${formatPercent(totals.cacheReadTokens, totals.cacheReadTokens + totals.inputTokens)}`,
    }),
    h(Kpi, {
      label: '工具调用',
      value: formatCompact(totals.toolCalls),
      sub: `失败 ${formatInt(totals.toolFailures)} · ${formatPercent(totals.toolFailures, totals.toolCalls)}`,
    }),
  )
}

/** User messages by local hour. */
export function HoursCard({ report }: { readonly report: UsageReport }): React.ReactElement {
  const max = Math.max(0, ...report.hours)
  const peak = max === 0 ? -1 : report.hours.indexOf(max)
  return h(
    'div',
    { className: 'us-card' },
    h(
      'div',
      { className: 'us-cardHead' },
      h('h2', { className: 'us-cardTitle' }, '一天中的活跃时段'),
      h('span', { className: 'us-cardHint' }, peak === -1 ? '按你发出的消息数' : `按你发出的消息数 · 高峰 ${String(peak).padStart(2, '0')}:00`),
    ),
    h(
      'div',
      { className: 'us-hours', role: 'img', 'aria-label': peak === -1 ? '没有消息' : `消息最多的时段是 ${String(peak)} 点` },
      ...report.hours.map((count, hour) => h('div', {
        key: hour,
        className: hour === peak ? 'us-bar us-bar--peak' : 'us-bar',
        style: { height: max === 0 ? '2px' : `${String(Math.max(3, (count / max) * 100))}%` },
        title: `${String(hour).padStart(2, '0')}:00 · ${formatInt(count)} 条消息`,
      })),
    ),
    h(
      'div',
      { className: 'us-hourAxis', 'aria-hidden': true },
      ...report.hours.map((_, hour) => h('span', { key: hour }, hour % 3 === 0 ? String(hour) : '')),
    ),
  )
}

// ---------------------------------------------------------------------------
// Detail tables
// ---------------------------------------------------------------------------

/** One column of a detail table. */
interface Column<Row> {
  readonly title: string
  readonly right?: boolean
  readonly cell: (row: Row) => React.ReactNode
  /** Cell of the folded "其余 N 项" row. */
  readonly rest?: (rows: readonly Row[]) => React.ReactNode
  readonly className?: (row: Row) => string | undefined
}

/** One titled table card with a row cap. */
function TableCard<Row>(props: {
  readonly title: string
  readonly hint: string
  readonly rows: readonly Row[]
  readonly limit: number
  readonly rowKey: (row: Row) => string
  readonly columns: ReadonlyArray<Column<Row>>
  readonly wide?: boolean
  readonly empty: string
}): React.ReactElement {
  const shown = props.rows.slice(0, props.limit)
  const rest = props.rows.slice(props.limit)
  return h(
    'section',
    { className: props.wide === true ? 'us-card us-tableCard us-wide' : 'us-card us-tableCard' },
    h(
      'div',
      { className: 'us-cardHead' },
      h('h2', { className: 'us-cardTitle' }, props.title),
      h('span', { className: 'us-cardHint' }, props.hint),
    ),
    props.rows.length === 0
      ? h('div', { className: 'us-sub', style: { padding: '0 14px 12px' } }, props.empty)
      : h(
        'div',
        { className: 'us-tableScroll' },
        h(
          'table',
          { className: 'us-table' },
          h('thead', null, h('tr', null, ...props.columns.map(column => h('th', { key: column.title, className: column.right === true ? 'us-r' : undefined }, column.title)))),
          h(
            'tbody',
            null,
            ...shown.map(row => h(
              'tr',
              { key: props.rowKey(row) },
              ...props.columns.map((column, index) => h(
                'td',
                {
                  key: column.title,
                  className: [column.right === true ? 'us-r' : '', index === 0 ? 'us-name' : '', column.className?.(row) ?? ''].filter(Boolean).join(' ') || undefined,
                },
                column.cell(row),
              )),
            )),
            rest.length === 0
              ? null
              : h(
                'tr',
                { key: '__rest', className: 'us-rest' },
                ...props.columns.map((column, index) => h(
                  'td',
                  { key: column.title, className: column.right === true ? 'us-r' : undefined },
                  index === 0 ? `其余 ${formatInt(rest.length)} 项` : column.rest?.(rest) ?? '',
                )),
              ),
          ),
        ),
      ),
  )
}

/** Sum a numeric field over rows. */
function total<Row>(rows: readonly Row[], pick: (row: Row) => number): number {
  return rows.reduce((sum, row) => sum + pick(row), 0)
}

/** Signed added count. */
const plus = (value: number): React.ReactNode => h('span', { className: 'us-add' }, value === 0 ? '0' : `+${formatInt(value)}`)
/** Signed removed count. */
const minus = (value: number): React.ReactNode => h('span', { className: 'us-del' }, value === 0 ? '0' : `−${formatInt(value)}`)

/** Whether a tool's failure rate deserves the error color. */
function highFailure(calls: number, failures: number): boolean {
  return failures >= 3 && calls > 0 && failures / calls >= 0.05
}

/** The detail tab: projects, models, tools, file types, and the counting rules. */
export function DetailTables({ report }: { readonly report: UsageReport }): React.ReactElement {
  return h(
    'div',
    { className: 'us-tables' },
    h(TableCard<UsageReport['projects'][number]>, {
      title: '按项目',
      hint: `共 ${formatInt(report.projects.length)} 个工作目录 · 按改动行数排序`,
      rows: report.projects,
      limit: TABLE_LIMITS.projects,
      rowKey: row => row.cwd,
      wide: true,
      empty: '这个时间范围内没有会话。',
      columns: [
        { title: '项目', cell: row => h('span', { title: row.cwd }, row.name) },
        { title: '会话', right: true, cell: row => formatInt(row.sessions), rest: rows => formatInt(total(rows, row => row.sessions)) },
        { title: '轮次', right: true, cell: row => formatInt(row.turns), rest: rows => formatInt(total(rows, row => row.turns)) },
        { title: '新增', right: true, cell: row => plus(row.added), rest: rows => plus(total(rows, row => row.added)) },
        { title: '删除', right: true, cell: row => minus(row.removed), rest: rows => minus(total(rows, row => row.removed)) },
        { title: 'Token', right: true, cell: row => formatCompact(row.tokens), rest: rows => formatCompact(total(rows, row => row.tokens)) },
      ],
    }),
    h(TableCard<UsageReport['models'][number]>, {
      title: '按模型',
      hint: '每次模型回复计一步',
      rows: report.models,
      limit: TABLE_LIMITS.models,
      rowKey: row => row.model,
      wide: true,
      empty: '没有模型回复。',
      columns: [
        { title: '模型', cell: row => h('span', { title: row.providers.join(', ') }, row.model) },
        { title: '步数', right: true, cell: row => formatInt(row.steps), rest: rows => formatInt(total(rows, row => row.steps)) },
        { title: '输入', right: true, cell: row => row.withUsage === 0 ? '—' : formatCompact(row.inputTokens), rest: rows => formatCompact(total(rows, row => row.inputTokens)) },
        { title: '输出', right: true, cell: row => row.withUsage === 0 ? '—' : formatCompact(row.outputTokens), rest: rows => formatCompact(total(rows, row => row.outputTokens)) },
        { title: '缓存命中', right: true, cell: row => row.withUsage === 0 ? '—' : formatCompact(row.cacheReadTokens), rest: rows => formatCompact(total(rows, row => row.cacheReadTokens)) },
      ],
    }),
    h(TableCard<UsageReport['tools'][number]>, {
      title: '按工具',
      hint: '失败 = 工具结果标记为错误',
      rows: report.tools,
      limit: TABLE_LIMITS.tools,
      rowKey: row => row.name,
      empty: '没有工具调用。',
      columns: [
        { title: '工具', cell: row => row.name },
        { title: '调用', right: true, cell: row => formatInt(row.calls), rest: rows => formatInt(total(rows, row => row.calls)) },
        { title: '失败', right: true, cell: row => formatInt(row.failures), rest: rows => formatInt(total(rows, row => row.failures)) },
        {
          title: '失败率',
          right: true,
          cell: row => formatPercent(row.failures, row.calls),
          className: row => highFailure(row.calls, row.failures) ? 'us-del' : undefined,
          rest: rows => formatPercent(total(rows, row => row.failures), total(rows, row => row.calls)),
        },
      ],
    }),
    h(TableCard<UsageReport['exts'][number]>, {
      title: '按文件类型',
      hint: 'edit / write 改动的文件扩展名',
      rows: report.exts,
      limit: TABLE_LIMITS.exts,
      rowKey: row => row.ext,
      empty: '没有文件改动。',
      columns: [
        { title: '类型', cell: row => row.ext },
        { title: '新增', right: true, cell: row => plus(row.added), rest: rows => plus(total(rows, row => row.added)) },
        { title: '删除', right: true, cell: row => minus(row.removed), rest: rows => minus(total(rows, row => row.removed)) },
      ],
    }),
    h(
      'section',
      { className: 'us-card us-wide' },
      h('div', { className: 'us-cardHead' }, h('h2', { className: 'us-cardTitle' }, 'ⓘ 统计口径')),
      h(
        'ul',
        { className: 'us-notes' },
        h('li', null, '改动行数：edit / write 工具结果里的 diff 逐行比对出新增和删除；新建文件按写入的行数计为新增。失败的调用不计。'),
        h('li', null, '分叉会话从源会话继承的前缀不重复计入，只算分叉之后的部分。'),
        h('li', null, '主会话 / 子代理按会话头的 origin 区分；Agent Teams 的队友计入主会话。'),
        h('li', null, '通过 bash（sed -i、cat >、git apply 等）改的文件没有 diff 记录，不计入。'),
        h('li', null, '运行时长是每轮从开始到结束的时间；Token = 输入 + 输出，缓存命中单独统计。'),
        h('li', null, `按浏览器时区（${report.timeZone}）切分日期和小时。`),
      ),
    ),
  )
}

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

/** Which tab is open. */
export type UsageTab = 'overview' | 'details'

/** What the page body shows below the toolbar. */
export type UsageBody =
  | { readonly kind: 'loading' }
  | { readonly kind: 'scanning'; readonly progress: ScanProgress }
  | { readonly kind: 'error'; readonly message: string }
  | {
    readonly kind: 'ready'
    readonly report: UsageReport
    readonly scannedAt: string
    readonly refreshing: boolean
    readonly skipped: readonly SkippedLog[]
  }

/** Props of the pure page. */
export interface UsageStatsPageProps {
  readonly body: UsageBody
  readonly tab: UsageTab
  readonly onTab: (next: UsageTab) => void
  readonly range: RangeKind
  readonly onRange: (next: RangeKind) => void
  readonly metric: HeatMetric
  readonly onMetric: (next: HeatMetric) => void
  readonly origin: OriginFilter
  readonly onOrigin: (next: OriginFilter) => void
  /** Ask the Host for a fresh scan. */
  readonly onRefresh: () => void
  /** Whether a read is in flight. */
  readonly busy: boolean
  /** Failure of the last read while older numbers are still shown. */
  readonly staleFailure: string | null
}

/**
 * The whole page for one state.
 * @param props - body state and every control's value and callback.
 * @returns the page element.
 */
export function UsageStatsPage(props: UsageStatsPageProps): React.ReactElement {
  const { body } = props
  const ready = body.kind === 'ready' ? body : null
  // After a range switch the previous range's numbers stay until the new ones
  // arrive; say whose numbers they are rather than label them with the new range.
  const otherRange = ready !== null && ready.report.range !== props.range
    ? RANGE_OPTIONS.find(option => option.value === ready.report.range)?.label ?? ready.report.range
    : null
  const meta = ready === null
    ? null
    : otherRange !== null
      ? `显示的是「${otherRange}」的数据${props.busy ? ' · 正在切换…' : ''}`
      : `${formatInt(ready.report.sessions.total)} 个会话 · ${ready.refreshing ? '正在更新…' : `更新于 ${formatClock(ready.scannedAt)}`}`

  let content: React.ReactNode
  if (body.kind === 'loading') {
    content = h(ScanningCard, { progress: { done: 0, total: 0 } })
  } else if (body.kind === 'scanning') {
    content = h(ScanningCard, { progress: body.progress })
  } else if (body.kind === 'error') {
    content = h(ErrorCard, { message: body.message, onRetry: props.onRefresh })
  } else if (body.report.sessions.total === 0) {
    content = h(EmptyCard, { range: body.report.range, onShowAll: () => { props.onRange('all') } })
  } else if (props.tab === 'overview') {
    content = [
      h(HeatmapCard, {
        key: 'heat',
        report: body.report,
        metric: props.metric,
        onMetric: props.onMetric,
        origin: props.origin,
        onOrigin: props.onOrigin,
      }),
      h(KpiTiles, { key: 'kpi', report: body.report }),
      h(HoursCard, { key: 'hours', report: body.report }),
    ]
  } else {
    content = h(DetailTables, { report: body.report })
  }

  return h(
    'div',
    { className: 'us-page' },
    h('style', null, USAGE_CSS),
    h(
      'div',
      { className: 'us-inner' },
      h(
        'header',
        { className: 'us-head' },
        h('h1', { className: 'us-title' }, COPY.title),
        h('p', { className: 'us-desc' }, COPY.description),
      ),
      h(
        'div',
        { className: 'us-toolbar' },
        h(Segmented<UsageTab>, {
          options: [{ value: 'overview', label: COPY.overview }, { value: 'details', label: COPY.details }],
          value: props.tab,
          onChange: props.onTab,
          label: '视图',
        }),
        h(
          'div',
          { className: 'us-toolbarEnd' },
          meta === null ? null : h('span', { className: 'us-meta' }, meta),
          h(
            'select',
            {
              className: 'us-select',
              'aria-label': '时间范围',
              value: props.range,
              onChange: (event: React.ChangeEvent<HTMLSelectElement>) => { props.onRange(event.target.value as RangeKind) },
            },
            ...RANGE_OPTIONS.map(option => h('option', { key: option.value, value: option.value }, option.label)),
          ),
          h(
            'button',
            { type: 'button', className: 'us-btn', onClick: props.onRefresh, disabled: props.busy || body.kind === 'scanning' },
            props.busy ? '读取中…' : COPY.refresh,
          ),
        ),
      ),
      props.staleFailure === null
        ? null
        : h(
          'div',
          { className: 'us-banner us-banner--error', role: 'alert' },
          h('div', { className: 'us-bannerTitle' }, COPY.staleFailure),
          h('div', { className: 'us-bannerPath' }, props.staleFailure),
        ),
      ready !== null && ready.skipped.length > 0 ? h(SkippedBanner, { skipped: ready.skipped }) : null,
      otherRange === null ? content : h('div', { className: 'us-dim' }, content),
    ),
  )
}
