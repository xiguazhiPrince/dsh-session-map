/**
 * Usage statistics vocabulary shared by both halves of the Settings → 用量统计
 * page, plus every pure rule the numbers depend on.
 *
 * The Host half feeds Session log events through {@link SessionSummarizer},
 * which folds one log into sparse 15-minute UTC buckets. Fifteen minutes is the
 * finest granularity any IANA zone offset needs (+05:45, +08:45, …), so the
 * cached buckets never depend on a time zone: {@link aggregateUsage} re-bins
 * them into the viewer's local days and hours at query time.
 *
 * The browser half reads the {@link UsageReport} and derives the heat map from
 * it with {@link buildCalendar}, {@link quartileCuts}, and
 * {@link seriesHighlights} — all here, so every counting rule has one home and
 * one test file.
 *
 * Nothing here touches Node or the DOM.
 *
 * @module dsh-session-map/usage-stats/model
 */

/** Route family shared by both halves. */
export const USAGE_STATS_ROUTE = '/plugin-usage-stats'

/** Wire version of {@link UsageStatsEnvelope}. */
export const USAGE_STATS_VERSION = 1

/**
 * Version of the counting rules. Bump it whenever {@link SessionSummarizer}
 * changes what it counts, so every cached summary is rebuilt once.
 */
export const SUMMARY_RULES_VERSION = 2

/** Width of one cached time bucket. */
export const BUCKET_MS = 15 * 60 * 1000

/** Longest single turn counted toward Agent time; longer gaps are clock damage. */
const MAX_TURN_MS = 24 * 60 * 60 * 1000

/** Myers search bound: beyond this edit distance the trimmed counts are used. */
const MAX_DIFF_DISTANCE = 4000

/** Which kind of Session a log belongs to, from its header's `origin`. */
export type SessionOrigin = 'root' | 'subagent'

/** Per-model counters inside one bucket. */
export interface ModelCounter {
  /** Provider ids seen for this model name. */
  providers: string[]
  /** Assistant replies (one per model step). */
  steps: number
  /** Replies that carried a usage record. */
  withUsage: number
  inputTokens: number
  outputTokens: number
  cacheReadTokens: number
  cacheWriteTokens: number
}

/** Per-tool counters inside one bucket. */
export interface ToolCounter {
  calls: number
  failures: number
}

/** Per-file-type line counters inside one bucket. */
export interface ExtCounter {
  added: number
  removed: number
}

/** Everything counted in one 15-minute UTC bucket of one Session. */
export interface Bucket {
  /** Lines added by file-editing tools. */
  added: number
  /** Lines removed by file-editing tools. */
  removed: number
  /** Changed lines (added + removed) that came from tools other than `write`. */
  editLines: number
  /** Changed lines that came from the `write` tool. */
  writeLines: number
  /** Turns started. */
  turns: number
  /** Turns that ended with `error`. */
  turnErrors: number
  /** Turns that ended `aborted` or `interrupted`. */
  turnAborted: number
  /** Turn wall time, attributed to the bucket the turn started in. */
  activeMs: number
  /** Messages the user typed (source kind `user`). */
  userMessages: number
  /** Assistant replies. */
  steps: number
  inputTokens: number
  outputTokens: number
  cacheReadTokens: number
  cacheWriteTokens: number
  /** Tool calls issued. */
  toolCalls: number
  /** Tool results marked as errors. */
  toolFailures: number
  /** Counters by model name. */
  models: Record<string, ModelCounter>
  /** Counters by tool name. */
  tools: Record<string, ToolCounter>
  /** Line counters by file type. */
  exts: Record<string, ExtCounter>
}

/** The cached fold of one Session log. */
export interface SessionSummary {
  /** Session id from the header. */
  id: string
  /** Working directory from the header; empty when the header has none. */
  cwd: string
  /** Root Session or delegated subagent. */
  origin: SessionOrigin
  /** Header creation time, epoch ms. */
  createdAt: number
  /** Non-empty buckets keyed by `floor(time / BUCKET_MS)`. */
  buckets: Record<string, Bucket>
}

/** Result of folding one log. */
export type SummarizeResult =
  | { readonly ok: true; readonly summary: SessionSummary }
  | { readonly ok: false; readonly reason: string }

/**
 * A string-keyed table without a prototype. Model, tool, and file names come
 * from logs: a name like `constructor` or `__proto__` must stay an ordinary key
 * instead of reaching `Object.prototype` in the long-lived Host process.
 */
export function table<V>(): Record<string, V> {
  return Object.create(null) as Record<string, V>
}

/** Create one empty bucket. */
export function emptyBucket(): Bucket {
  return {
    added: 0,
    removed: 0,
    editLines: 0,
    writeLines: 0,
    turns: 0,
    turnErrors: 0,
    turnAborted: 0,
    activeMs: 0,
    userMessages: 0,
    steps: 0,
    inputTokens: 0,
    outputTokens: 0,
    cacheReadTokens: 0,
    cacheWriteTokens: 0,
    toolCalls: 0,
    toolFailures: 0,
    models: table(),
    tools: table(),
    exts: table(),
  }
}

// ---------------------------------------------------------------------------
// Line counting
// ---------------------------------------------------------------------------

/**
 * Split text into lines the way an editor counts them: a trailing newline ends
 * the last line instead of opening an empty one.
 * @param text - file content or snippet.
 * @returns the lines; empty text has none.
 */
export function splitLines(text: string): string[] {
  if (text === '') return []
  const lines = text.split('\n')
  if (lines[lines.length - 1] === '') lines.pop()
  return lines
}

/**
 * Count the lines one text has.
 * @param text - file content.
 * @returns its line count.
 */
export function countLines(text: string): number {
  return splitLines(text).length
}

/**
 * Shortest insert/delete edit distance between two line sequences — Myers'
 * O((N+M)·D) greedy search, keeping only the furthest-reaching frontier, so
 * memory is O(D). Only the distance is needed: added and removed follow from
 * it and the two lengths.
 * @param a - old lines.
 * @param b - new lines.
 * @param maxDistance - search bound.
 * @returns the distance, or undefined when it exceeds the bound.
 */
function myersDistance(a: readonly number[], b: readonly number[], maxDistance: number): number | undefined {
  const n = a.length
  const m = b.length
  const limit = Math.min(n + m, maxDistance)
  const offset = limit + 1
  const v = new Int32Array(2 * limit + 3)
  for (let d = 0; d <= limit; d += 1) {
    for (let k = -d; k <= d; k += 2) {
      const down = k === -d || (k !== d && (v[offset + k - 1] ?? 0) < (v[offset + k + 1] ?? 0))
      let x = down ? (v[offset + k + 1] ?? 0) : (v[offset + k - 1] ?? 0) + 1
      let y = x - k
      while (x < n && y < m && a[x] === b[y]) {
        x += 1
        y += 1
      }
      v[offset + k] = x
      if (x >= n && y >= m) return d
    }
  }
  return undefined
}

/**
 * Lines added and removed between two texts.
 *
 * The classic approach in two steps: trim the common prefix and suffix (cheap,
 * and the whole answer for a typical in-place edit), then run Myers on the
 * differing middle. A middle whose edit distance exceeds the bound — a whole
 * file rewritten — falls back to counting every middle line as changed, which
 * is what the trim alone would say.
 * @param oldText - text before the edit.
 * @param newText - text after the edit.
 * @returns added and removed line counts.
 */
export function lineDiff(oldText: string, newText: string): ExtCounter {
  const before = splitLines(oldText)
  const after = splitLines(newText)
  let start = 0
  while (start < before.length && start < after.length && before[start] === after[start]) start += 1
  let endBefore = before.length
  let endAfter = after.length
  while (endBefore > start && endAfter > start && before[endBefore - 1] === after[endAfter - 1]) {
    endBefore -= 1
    endAfter -= 1
  }
  const n = endBefore - start
  const m = endAfter - start
  if (n === 0 || m === 0) return { added: m, removed: n }

  // Intern lines so the inner loop compares integers.
  const ids = new Map<string, number>()
  const intern = (line: string): number => {
    let id = ids.get(line)
    if (id === undefined) {
      id = ids.size
      ids.set(line, id)
    }
    return id
  }
  const a = before.slice(start, endBefore).map(intern)
  const b = after.slice(start, endAfter).map(intern)
  const distance = myersDistance(a, b, MAX_DIFF_DISTANCE)
  if (distance === undefined) return { added: m, removed: n }
  // distance = added + removed, and added − removed = m − n.
  return { added: (distance + m - n) / 2, removed: (distance - m + n) / 2 }
}

/**
 * File type of one path: the lower-cased extension, a dotfile's own name, or
 * the bare file name when there is no extension (`Dockerfile`).
 * @param path - file path, or undefined when the log names none.
 * @returns the type label.
 */
export function fileType(path: string | undefined): string {
  if (path === undefined || path === '') return '(未知)'
  const base = path.slice(Math.max(path.lastIndexOf('/'), path.lastIndexOf('\\')) + 1)
  if (base === '') return '(未知)'
  const dot = base.lastIndexOf('.')
  if (dot <= 0) return base.startsWith('.') ? base.toLowerCase() : base
  return base.slice(dot).toLowerCase()
}

// ---------------------------------------------------------------------------
// Log folding
// ---------------------------------------------------------------------------

/** Event types the summarizer reads; every other line is skipped unparsed. */
const COUNTED_TYPES = new Set([
  'session',
  'session/end-seed',
  'turn/start',
  'turn/end',
  'user/message',
  'assistant/message',
  'tool/call',
  'tool/result',
])

/**
 * Read the `type` of one JSONL record without parsing it. Persisted records
 * start with `{"type":"…"`; anything else answers undefined and is parsed.
 * @param line - one JSONL line.
 * @returns the record type, or undefined when the prefix does not show it.
 */
export function peekEventType(line: string): string | undefined {
  const prefix = '{"type":"'
  if (!line.startsWith(prefix)) return undefined
  const end = line.indexOf('"', prefix.length)
  return end === -1 ? undefined : line.slice(prefix.length, end)
}

/** Narrow an unknown value to a plain record. */
function asRecord(value: unknown): Record<string, unknown> | undefined {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined
}

/** A finite number, or zero. */
function num(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : 0
}

/** A non-empty string, or undefined. */
function str(value: unknown): string | undefined {
  return typeof value === 'string' && value !== '' ? value : undefined
}

/** Tool-call arguments: a JSON string in current logs, an object in some older ones. */
function parseArguments(value: unknown): Record<string, unknown> | undefined {
  if (typeof value === 'string') {
    try {
      return asRecord(JSON.parse(value))
    } catch {
      return undefined
    }
  }
  return asRecord(value)
}

/** One issued tool call waiting for its result. */
interface PendingCall {
  readonly name: string
  readonly arguments: unknown
}

/**
 * Fold one Session log, line by line, into a {@link SessionSummary}.
 *
 * Counting rules (also shown on the page's 统计口径 card):
 * - A forked Session copies its source's events up to the last
 *   `session/end-seed` marked `inherited`; everything before that marker is
 *   discarded so a fork never counts its source again. A nested fork copies
 *   earlier markers too, so each marker resets the fold.
 * - Lines come from successful tool results that carry `meta.diffs` (one diff
 *   per changed file region), or, for a created file without diffs, from the
 *   created content. File-editing through `bash` leaves no diff and is not
 *   counted.
 * - An event without `time` inherits the last known time.
 */
export class SessionSummarizer {
  private header: { id: string; cwd: string; origin: SessionOrigin; createdAt: number; isSeeded: boolean } | undefined
  private lastTime = 0
  private buckets = new Map<number, Bucket>()
  private calls = new Map<string, PendingCall>()
  private turnStarts = new Map<number, { readonly time: number; readonly bucket: Bucket }>()
  private sawSeedEnd = false
  private malformed = 0

  /**
   * Feed one JSONL line.
   * @param line - the raw line, without its newline.
   */
  pushLine(line: string): void {
    if (line === '') return
    const type = peekEventType(line)
    if (type !== undefined && !COUNTED_TYPES.has(type)) return
    let event: unknown
    try {
      event = JSON.parse(line)
    } catch {
      this.malformed += 1
      return
    }
    this.pushEvent(event)
  }

  /**
   * Feed one parsed record.
   * @param value - the parsed JSONL record.
   */
  pushEvent(value: unknown): void {
    const event = asRecord(value)
    if (event === undefined) return
    const type = event.type
    if (type === 'session') {
      this.readHeader(event)
      return
    }
    if (this.header === undefined) return
    if (typeof event.time === 'number' && Number.isFinite(event.time)) this.lastTime = event.time
    const data = asRecord(event.data) ?? {}

    switch (type) {
      case 'session/end-seed':
        if (data.inherited === true && this.header.isSeeded) this.resetForSeed()
        return
      case 'turn/start':
        this.onTurnStart(data)
        return
      case 'turn/end':
        this.onTurnEnd(data)
        return
      case 'user/message':
        if (asRecord(data.source)?.kind === 'user') this.bucket().userMessages += 1
        return
      case 'assistant/message':
        this.onAssistant(data)
        return
      case 'tool/call':
        this.onToolCall(data)
        return
      case 'tool/result':
        this.onToolResult(data)
        return
      default:
        return
    }
  }

  /**
   * Finish the fold.
   * @returns the summary, or why this log cannot be counted.
   */
  finish(): SummarizeResult {
    if (this.header === undefined) return { ok: false, reason: '日志缺少会话头' }
    if (this.header.isSeeded && !this.sawSeedEnd) {
      return { ok: false, reason: '分叉会话缺少 session/end-seed 标记，无法区分继承的前缀' }
    }
    const buckets = table<Bucket>()
    for (const [key, bucket] of [...this.buckets.entries()].sort((left, right) => left[0] - right[0])) {
      buckets[String(key)] = bucket
    }
    return {
      ok: true,
      summary: {
        id: this.header.id,
        cwd: this.header.cwd,
        origin: this.header.origin,
        createdAt: this.header.createdAt,
        buckets,
      },
    }
  }

  /** Lines that looked like counted records but did not parse. */
  get malformedLines(): number {
    return this.malformed
  }

  private readHeader(event: Record<string, unknown>): void {
    if (this.header !== undefined) return
    const createdAt = num(event.createdAt)
    this.header = {
      id: str(event.id) ?? '',
      cwd: str(event.cwd) ?? '',
      origin: event.origin === 'subagent' ? 'subagent' : 'root',
      createdAt,
      isSeeded: event.isSeeded === true,
    }
    this.lastTime = createdAt
  }

  private resetForSeed(): void {
    this.sawSeedEnd = true
    this.buckets.clear()
    this.calls.clear()
    this.turnStarts.clear()
  }

  /** The bucket of the current event time. */
  private bucket(): Bucket {
    const key = Math.floor(this.lastTime / BUCKET_MS)
    let bucket = this.buckets.get(key)
    if (bucket === undefined) {
      bucket = emptyBucket()
      this.buckets.set(key, bucket)
    }
    return bucket
  }

  private onTurnStart(data: Record<string, unknown>): void {
    const bucket = this.bucket()
    bucket.turns += 1
    if (typeof data.turn === 'number') this.turnStarts.set(data.turn, { time: this.lastTime, bucket })
  }

  private onTurnEnd(data: Record<string, unknown>): void {
    const turn = typeof data.turn === 'number' ? data.turn : undefined
    const start = turn === undefined ? undefined : this.turnStarts.get(turn)
    if (turn !== undefined) this.turnStarts.delete(turn)
    // A turn whose start lies in the inherited prefix is not this Session's.
    if (start === undefined) return
    const kind = asRecord(data.reason)?.kind
    if (kind === 'error') start.bucket.turnErrors += 1
    else if (kind === 'aborted' || kind === 'interrupted') start.bucket.turnAborted += 1
    const elapsed = this.lastTime - start.time
    if (elapsed > 0 && elapsed <= MAX_TURN_MS) start.bucket.activeMs += elapsed
  }

  private onAssistant(data: Record<string, unknown>): void {
    const bucket = this.bucket()
    const source = asRecord(asRecord(data.message)?.source)
    const model = str(source?.model) ?? '(未知模型)'
    const provider = str(source?.provider)
    let counter = bucket.models[model]
    if (counter === undefined) {
      counter = { providers: [], steps: 0, withUsage: 0, inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0 }
      bucket.models[model] = counter
    }
    if (provider !== undefined && !counter.providers.includes(provider)) counter.providers.push(provider)
    counter.steps += 1
    bucket.steps += 1
    const usage = asRecord(data.usage)
    if (usage === undefined) return
    counter.withUsage += 1
    const input = num(usage.inputTokens)
    const output = num(usage.outputTokens)
    const cacheRead = num(usage.cacheReadTokens)
    const cacheWrite = num(usage.cacheWriteTokens)
    counter.inputTokens += input
    counter.outputTokens += output
    counter.cacheReadTokens += cacheRead
    counter.cacheWriteTokens += cacheWrite
    bucket.inputTokens += input
    bucket.outputTokens += output
    bucket.cacheReadTokens += cacheRead
    bucket.cacheWriteTokens += cacheWrite
  }

  private onToolCall(data: Record<string, unknown>): void {
    const name = str(data.name) ?? '(未知工具)'
    const callId = str(data.callId)
    if (callId !== undefined) this.calls.set(callId, { name, arguments: data.arguments })
    const bucket = this.bucket()
    bucket.toolCalls += 1
    const counter = bucket.tools[name] ?? { calls: 0, failures: 0 }
    counter.calls += 1
    bucket.tools[name] = counter
  }

  private onToolResult(data: Record<string, unknown>): void {
    const message = asRecord(data.message)
    const callId = str(message?.toolCallId)
    const call = callId === undefined ? undefined : this.calls.get(callId)
    if (callId !== undefined) this.calls.delete(callId)
    // A result whose call lies in the inherited prefix is not this Session's.
    if (call === undefined) return

    if (message?.isError === true || data.error !== undefined) {
      const bucket = this.bucket()
      bucket.toolFailures += 1
      const counter = bucket.tools[call.name] ?? { calls: 0, failures: 0 }
      counter.failures += 1
      bucket.tools[call.name] = counter
      return
    }

    const meta = asRecord(data.meta)
    if (meta === undefined) return
    const diffs = Array.isArray(meta.diffs) ? meta.diffs : []
    if (diffs.length === 0 && meta.operation !== 'create') return
    const args = parseArguments(call.arguments)
    const fallbackPath = str(meta.path) ?? str(args?.file_path) ?? str(args?.path)
    const isWrite = call.name === 'write'

    if (diffs.length > 0) {
      for (const candidate of diffs) {
        const diff = asRecord(candidate)
        if (diff === undefined) continue
        const oldText = typeof diff.oldText === 'string' ? diff.oldText : ''
        const newText = typeof diff.newText === 'string' ? diff.newText : ''
        const counted = lineDiff(oldText, newText)
        this.addLines(isWrite, str(diff.path) ?? fallbackPath, counted.added, counted.removed)
      }
      return
    }
    // A created file reports no diff; its content is all new.
    const content = typeof args?.content === 'string' ? args.content : ''
    this.addLines(isWrite, fallbackPath, countLines(content), 0)
  }

  private addLines(isWrite: boolean, path: string | undefined, added: number, removed: number): void {
    if (added === 0 && removed === 0) return
    // Buckets are created on first write, so a quiet result leaves none behind.
    const bucket = this.bucket()
    bucket.added += added
    bucket.removed += removed
    if (isWrite) bucket.writeLines += added + removed
    else bucket.editLines += added + removed
    const type = fileType(path)
    const counter = bucket.exts[type] ?? { added: 0, removed: 0 }
    counter.added += added
    counter.removed += removed
    bucket.exts[type] = counter
  }
}

/**
 * Fold a whole log held in memory; convenient for tests and small logs.
 * @param lines - JSONL lines, header first.
 * @returns the summary or its failure.
 */
export function summarizeLines(lines: Iterable<string>): SummarizeResult {
  const summarizer = new SessionSummarizer()
  for (const line of lines) summarizer.pushLine(line)
  return summarizer.finish()
}

// ---------------------------------------------------------------------------
// Local calendar arithmetic
// ---------------------------------------------------------------------------

/** Local wall-clock date and hour of one instant. */
export interface LocalSlot {
  /** `YYYY-MM-DD`. */
  readonly date: string
  /** 0–23. */
  readonly hour: number
}

/** Formatter per time zone. */
const formatters = new Map<string, Intl.DateTimeFormat>()

/**
 * Whether a string names a time zone this runtime knows.
 * @param timeZone - candidate IANA name.
 * @returns true when `Intl` accepts it.
 */
export function isValidTimeZone(timeZone: string): boolean {
  if (timeZone === '') return false
  try {
    new Intl.DateTimeFormat('en-US', { timeZone })
    return true
  } catch {
    return false
  }
}

/**
 * Local date and hour of one instant in one zone.
 * @param ms - epoch ms.
 * @param timeZone - IANA zone.
 * @returns the local slot.
 */
export function localSlot(ms: number, timeZone: string): LocalSlot {
  let formatter = formatters.get(timeZone)
  if (formatter === undefined) {
    formatter = new Intl.DateTimeFormat('en-US', {
      timeZone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      hourCycle: 'h23',
    })
    formatters.set(timeZone, formatter)
  }
  const parts: Record<string, string> = {}
  for (const part of formatter.formatToParts(new Date(ms))) parts[part.type] = part.value
  const hour = Number(parts.hour ?? '0') % 24
  return { date: `${parts.year ?? '1970'}-${parts.month ?? '01'}-${parts.day ?? '01'}`, hour }
}

/** Epoch day number of a `YYYY-MM-DD` date (UTC arithmetic, no zone). */
function dayNumber(date: string): number {
  const [y, m, d] = date.split('-').map(Number)
  return Math.floor(Date.UTC(y ?? 1970, (m ?? 1) - 1, d ?? 1) / 86_400_000)
}

/** `YYYY-MM-DD` of an epoch day number. */
function dateOfDay(day: number): string {
  return new Date(day * 86_400_000).toISOString().slice(0, 10)
}

/**
 * Shift a calendar date by whole days.
 * @param date - `YYYY-MM-DD`.
 * @param days - signed offset.
 * @returns the shifted date.
 */
export function addDays(date: string, days: number): string {
  return dateOfDay(dayNumber(date) + days)
}

/**
 * Days from one date to another.
 * @param from - earlier date.
 * @param to - later date.
 * @returns `to − from` in days.
 */
export function daysBetween(from: string, to: string): number {
  return dayNumber(to) - dayNumber(from)
}

/**
 * Weekday of a date, Monday first.
 * @param date - `YYYY-MM-DD`.
 * @returns 0 for Monday through 6 for Sunday.
 */
export function mondayIndex(date: string): number {
  // Epoch day 0 (1970-01-01) was a Thursday.
  return (((dayNumber(date) + 3) % 7) + 7) % 7
}

// ---------------------------------------------------------------------------
// Aggregation
// ---------------------------------------------------------------------------

/** Time ranges the page offers. */
export const RANGE_KINDS = ['365', '180', '90', '30', 'all'] as const

/** One time range. */
export type RangeKind = typeof RANGE_KINDS[number]

/** Parse a range query value. */
export function parseRange(value: string | null | undefined): RangeKind {
  return (RANGE_KINDS as readonly string[]).includes(value ?? '') ? value as RangeKind : '365'
}

/** Daily numbers the heat map can show, for one origin. */
export interface DayMetrics {
  added: number
  removed: number
  turns: number
  /** Input + output tokens; cache reads are reported separately. */
  tokens: number
  activeMs: number
}

/** One local day with any activity. */
export interface DayRow {
  readonly date: string
  readonly root: DayMetrics
  readonly subagent: DayMetrics
}

/** Range totals. */
export interface UsageTotals {
  added: number
  removed: number
  editLines: number
  writeLines: number
  turns: number
  turnErrors: number
  turnAborted: number
  activeMs: number
  userMessages: number
  steps: number
  inputTokens: number
  outputTokens: number
  cacheReadTokens: number
  cacheWriteTokens: number
  toolCalls: number
  toolFailures: number
}

/** Session counts for the range. */
export interface SessionCounts {
  total: number
  root: number
  subagent: number
}

/** One working directory row. */
export interface ProjectRow {
  readonly cwd: string
  readonly name: string
  sessions: number
  turns: number
  added: number
  removed: number
  tokens: number
}

/** One model row. */
export interface ModelRow {
  readonly model: string
  providers: string[]
  steps: number
  /** Replies with a usage record; zero means the token columns are unknown. */
  withUsage: number
  inputTokens: number
  outputTokens: number
  cacheReadTokens: number
  cacheWriteTokens: number
}

/** One tool row. */
export interface ToolRow {
  readonly name: string
  calls: number
  failures: number
}

/** One file-type row. */
export interface ExtRow {
  readonly ext: string
  added: number
  removed: number
}

/** Everything the page renders for one range and zone. */
export interface UsageReport {
  readonly timeZone: string
  readonly range: RangeKind
  /** First local date of the range. */
  readonly start: string
  /** Last local date of the range: today. */
  readonly end: string
  /** Active days in date order. */
  readonly daily: DayRow[]
  readonly totals: UsageTotals
  readonly sessions: SessionCounts
  /** User messages by local hour, 24 entries. */
  readonly hours: number[]
  readonly projects: ProjectRow[]
  readonly models: ModelRow[]
  readonly tools: ToolRow[]
  readonly exts: ExtRow[]
}

/** Options of one aggregation. */
export interface AggregateOptions {
  readonly timeZone: string
  readonly range: RangeKind
  /** Clock, epoch ms. */
  readonly now: number
}

/** Zeroed daily metrics. */
export function emptyDayMetrics(): DayMetrics {
  return { added: 0, removed: 0, turns: 0, tokens: 0, activeMs: 0 }
}

/** Zeroed totals. */
function emptyTotals(): UsageTotals {
  return {
    added: 0,
    removed: 0,
    editLines: 0,
    writeLines: 0,
    turns: 0,
    turnErrors: 0,
    turnAborted: 0,
    activeMs: 0,
    userMessages: 0,
    steps: 0,
    inputTokens: 0,
    outputTokens: 0,
    cacheReadTokens: 0,
    cacheWriteTokens: 0,
    toolCalls: 0,
    toolFailures: 0,
  }
}

/**
 * Whether a bucket recorded anything. Every counter counts: a long tool call
 * can fail in a later quarter-hour whose bucket holds nothing but that failure.
 */
function bucketHasActivity(bucket: Bucket): boolean {
  return bucket.turns > 0 || bucket.turnErrors > 0 || bucket.turnAborted > 0 || bucket.activeMs > 0
    || bucket.steps > 0 || bucket.toolCalls > 0 || bucket.toolFailures > 0 || bucket.userMessages > 0
    || bucket.added > 0 || bucket.removed > 0
}

/** Last path segment of a working directory. */
export function projectName(cwd: string): string {
  if (cwd === '') return '(未知目录)'
  const trimmed = cwd.replace(/[\\/]+$/, '')
  const base = trimmed.slice(Math.max(trimmed.lastIndexOf('/'), trimmed.lastIndexOf('\\')) + 1)
  return base === '' ? cwd : base
}

/**
 * Re-bin cached summaries into one range of local days.
 * @param summaries - every counted Session log.
 * @param options - zone, range, and clock.
 * @returns the report the page renders.
 */
export function aggregateUsage(summaries: readonly SessionSummary[], options: AggregateOptions): UsageReport {
  const { timeZone, range, now } = options
  const end = localSlot(now, timeZone).date
  const slots = new Map<number, LocalSlot>()
  const slotOf = (key: number): LocalSlot => {
    let slot = slots.get(key)
    if (slot === undefined) {
      slot = localSlot(key * BUCKET_MS, timeZone)
      slots.set(key, slot)
    }
    return slot
  }

  let start: string
  if (range === 'all') {
    start = end
    for (const summary of summaries) {
      for (const [key, bucket] of Object.entries(summary.buckets)) {
        if (!bucketHasActivity(bucket)) continue
        const date = slotOf(Number(key)).date
        if (date < start) start = date
      }
    }
  } else {
    start = addDays(end, -(Number(range) - 1))
  }

  const days = new Map<string, DayRow>()
  const totals = emptyTotals()
  const sessions: SessionCounts = { total: 0, root: 0, subagent: 0 }
  const hours = Array.from({ length: 24 }, () => 0)
  const projects = new Map<string, ProjectRow>()
  const models = new Map<string, ModelRow>()
  const tools = new Map<string, ToolRow>()
  const exts = new Map<string, ExtRow>()

  for (const summary of summaries) {
    let counted = false
    let project: ProjectRow | undefined
    for (const [key, bucket] of Object.entries(summary.buckets)) {
      const slot = slotOf(Number(key))
      if (slot.date < start || slot.date > end) continue
      if (!bucketHasActivity(bucket)) continue
      if (!counted) {
        counted = true
        sessions.total += 1
        sessions[summary.origin] += 1
        project = projects.get(summary.cwd)
        if (project === undefined) {
          project = { cwd: summary.cwd, name: projectName(summary.cwd), sessions: 0, turns: 0, added: 0, removed: 0, tokens: 0 }
          projects.set(summary.cwd, project)
        }
        project.sessions += 1
      }

      let day = days.get(slot.date)
      if (day === undefined) {
        day = { date: slot.date, root: emptyDayMetrics(), subagent: emptyDayMetrics() }
        days.set(slot.date, day)
      }
      const metrics = day[summary.origin]
      const tokens = bucket.inputTokens + bucket.outputTokens
      metrics.added += bucket.added
      metrics.removed += bucket.removed
      metrics.turns += bucket.turns
      metrics.tokens += tokens
      metrics.activeMs += bucket.activeMs

      totals.added += bucket.added
      totals.removed += bucket.removed
      totals.editLines += bucket.editLines
      totals.writeLines += bucket.writeLines
      totals.turns += bucket.turns
      totals.turnErrors += bucket.turnErrors
      totals.turnAborted += bucket.turnAborted
      totals.activeMs += bucket.activeMs
      totals.userMessages += bucket.userMessages
      totals.steps += bucket.steps
      totals.inputTokens += bucket.inputTokens
      totals.outputTokens += bucket.outputTokens
      totals.cacheReadTokens += bucket.cacheReadTokens
      totals.cacheWriteTokens += bucket.cacheWriteTokens
      totals.toolCalls += bucket.toolCalls
      totals.toolFailures += bucket.toolFailures
      hours[slot.hour] = (hours[slot.hour] ?? 0) + bucket.userMessages

      if (project !== undefined) {
        project.turns += bucket.turns
        project.added += bucket.added
        project.removed += bucket.removed
        project.tokens += tokens
      }
      for (const [name, counter] of Object.entries(bucket.models)) {
        let row = models.get(name)
        if (row === undefined) {
          row = { model: name, providers: [], steps: 0, withUsage: 0, inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0 }
          models.set(name, row)
        }
        for (const provider of counter.providers) if (!row.providers.includes(provider)) row.providers.push(provider)
        row.steps += counter.steps
        row.withUsage += counter.withUsage
        row.inputTokens += counter.inputTokens
        row.outputTokens += counter.outputTokens
        row.cacheReadTokens += counter.cacheReadTokens
        row.cacheWriteTokens += counter.cacheWriteTokens
      }
      for (const [name, counter] of Object.entries(bucket.tools)) {
        const row = tools.get(name) ?? { name, calls: 0, failures: 0 }
        row.calls += counter.calls
        row.failures += counter.failures
        tools.set(name, row)
      }
      for (const [ext, counter] of Object.entries(bucket.exts)) {
        const row = exts.get(ext) ?? { ext, added: 0, removed: 0 }
        row.added += counter.added
        row.removed += counter.removed
        exts.set(ext, row)
      }
    }
  }

  const byName = (left: string, right: string): number => (left < right ? -1 : left > right ? 1 : 0)
  return {
    timeZone,
    range,
    start,
    end,
    daily: [...days.values()].sort((left, right) => byName(left.date, right.date)),
    totals,
    sessions,
    hours,
    projects: [...projects.values()].sort((left, right) =>
      (right.added + right.removed) - (left.added + left.removed)
      || right.tokens - left.tokens
      || right.sessions - left.sessions
      || byName(left.cwd, right.cwd)),
    models: [...models.values()].sort((left, right) => right.steps - left.steps || byName(left.model, right.model)),
    tools: [...tools.values()].sort((left, right) => right.calls - left.calls || byName(left.name, right.name)),
    exts: [...exts.values()].sort((left, right) =>
      (right.added + right.removed) - (left.added + left.removed) || byName(left.ext, right.ext)),
  }
}

// ---------------------------------------------------------------------------
// Heat map
// ---------------------------------------------------------------------------

/** Metrics the heat map can show. */
export type HeatMetric = 'lines' | 'tokens' | 'turns' | 'time'

/** Which Sessions the heat map counts. */
export type OriginFilter = 'all' | SessionOrigin

/** One day's value for the selected metric and origin. */
export interface DayValue {
  readonly value: number
  readonly added: number
  readonly removed: number
}

/**
 * Value of one metric for one day.
 * @param metrics - one origin's daily numbers.
 * @param metric - selected metric.
 * @returns the value.
 */
export function metricValue(metrics: DayMetrics, metric: HeatMetric): number {
  switch (metric) {
    case 'lines': return metrics.added + metrics.removed
    case 'tokens': return metrics.tokens
    case 'turns': return metrics.turns
    case 'time': return metrics.activeMs
  }
}

/**
 * Day values for one metric and origin.
 * @param daily - the report's active days.
 * @param origin - origin filter.
 * @param metric - selected metric.
 * @returns values by date; days with a zero value are omitted.
 */
export function daySeries(daily: readonly DayRow[], origin: OriginFilter, metric: HeatMetric): Map<string, DayValue> {
  const series = new Map<string, DayValue>()
  for (const day of daily) {
    const parts = origin === 'all' ? [day.root, day.subagent] : [day[origin]]
    let value = 0
    let added = 0
    let removed = 0
    for (const part of parts) {
      value += metricValue(part, metric)
      added += part.added
      removed += part.removed
    }
    if (value > 0) series.set(day.date, { value, added, removed })
  }
  return series
}

/** One heat-map cell. */
export interface CalendarCell {
  readonly date: string
  /** False for the padding days before the range start. */
  readonly inRange: boolean
}

/** The heat-map grid: Monday-first week columns. */
export interface Calendar {
  /** Columns of seven cells; `null` marks days after the range end. */
  readonly weeks: Array<Array<CalendarCell | null>>
  /** Month labels: the column a month starts in. */
  readonly months: Array<{ readonly column: number; readonly month: number; readonly year: number }>
}

/**
 * Lay a date range out as GitHub-style week columns, Monday first.
 * @param start - first date of the range.
 * @param end - last date of the range (today).
 * @returns week columns and month labels.
 */
export function buildCalendar(start: string, end: string): Calendar {
  const first = addDays(start, -mondayIndex(start))
  const weeks: Array<Array<CalendarCell | null>> = []
  const months: Array<{ column: number; month: number; year: number }> = []
  const label = (column: number, date: string): void => {
    const [year, month] = date.split('-').map(Number)
    months.push({ column, month: month ?? 1, year: year ?? 1970 })
  }
  for (let monday = first, column = 0; monday <= end; monday = addDays(monday, 7), column += 1) {
    const week: Array<CalendarCell | null> = []
    for (let offset = 0; offset < 7; offset += 1) {
      const date = addDays(monday, offset)
      if (date > end) {
        week.push(null)
        continue
      }
      const inRange = date >= start
      week.push({ date, inRange })
      if (inRange && date.endsWith('-01') && date !== start) label(column, date)
    }
    weeks.push(week)
  }
  // The range's own first month is labelled only when the next month's label
  // leaves room for it (three columns), so labels never overlap.
  const next = months[0]
  if (next === undefined || next.column >= 3) {
    months.unshift({ column: 0, month: Number(start.slice(5, 7)), year: Number(start.slice(0, 4)) })
  }
  return { weeks, months }
}

/**
 * Quartile cut points of the non-zero values (GitHub's contribution scale).
 * The distribution is heavily skewed — one bulk-write day can be a hundred
 * times a quiet one — so a linear scale would paint almost every day pale.
 * @param values - day values.
 * @returns three ascending cut points; empty when every value is zero.
 */
export function quartileCuts(values: Iterable<number>): number[] {
  const sorted = [...values].filter(value => value > 0).sort((left, right) => left - right)
  if (sorted.length === 0) return []
  const at = (p: number): number => sorted[Math.min(sorted.length - 1, Math.max(0, Math.ceil(p * sorted.length) - 1))] ?? 0
  return [at(0.25), at(0.5), at(0.75)]
}

/**
 * Shade level of one value.
 * @param value - day value.
 * @param cuts - from {@link quartileCuts}.
 * @param max - largest value; it always gets the darkest shade.
 * @returns 0 (empty) through 4.
 */
export function levelOf(value: number, cuts: readonly number[], max: number): 0 | 1 | 2 | 3 | 4 {
  if (value <= 0) return 0
  if (value >= max) return 4
  let level = 1
  for (const cut of cuts) if (value > cut) level += 1
  return Math.min(level, 4) as 1 | 2 | 3 | 4
}

/** The four highlights under the heat map. */
export interface SeriesHighlights {
  readonly topMonth: { readonly month: string; readonly value: number } | null
  readonly topDay: { readonly date: string; readonly value: number } | null
  readonly longest: { readonly length: number; readonly from: string; readonly to: string } | null
  /** Current streak; when today is still empty it counts back from yesterday. */
  readonly current: { readonly length: number; readonly endsToday: boolean }
}

/**
 * Busiest month and day, longest streak, and current streak of one series.
 * @param series - values by date (zero days omitted).
 * @param start - range start.
 * @param end - range end (today).
 * @returns the highlights.
 */
export function seriesHighlights(series: ReadonlyMap<string, DayValue>, start: string, end: string): SeriesHighlights {
  const monthTotals = new Map<string, number>()
  let topDay: { date: string; value: number } | null = null
  for (const [date, day] of series) {
    if (date < start || date > end) continue
    const month = date.slice(0, 7)
    monthTotals.set(month, (monthTotals.get(month) ?? 0) + day.value)
    if (topDay === null || day.value > topDay.value || (day.value === topDay.value && date > topDay.date)) {
      topDay = { date, value: day.value }
    }
  }
  let topMonth: { month: string; value: number } | null = null
  for (const [month, value] of monthTotals) {
    if (topMonth === null || value > topMonth.value || (value === topMonth.value && month > topMonth.month)) {
      topMonth = { month, value }
    }
  }

  let longest: { length: number; from: string; to: string } | null = null
  let runStart: string | undefined
  let runLength = 0
  for (let date = start; date <= end; date = addDays(date, 1)) {
    if (series.has(date)) {
      if (runLength === 0) runStart = date
      runLength += 1
      if (longest === null || runLength > longest.length) longest = { length: runLength, from: runStart ?? date, to: date }
    } else {
      runLength = 0
    }
  }

  const endsToday = series.has(end)
  let length = 0
  for (let date = endsToday ? end : addDays(end, -1); date >= start && series.has(date); date = addDays(date, -1)) length += 1
  return { topMonth, topDay, longest, current: { length, endsToday } }
}

// ---------------------------------------------------------------------------
// Wire
// ---------------------------------------------------------------------------

/** Scan progress, in Session logs. */
export interface ScanProgress {
  readonly done: number
  readonly total: number
}

/** One log the scan could not count. */
export interface SkippedLog {
  /** Path relative to the Sessions root. */
  readonly path: string
  readonly reason: string
}

/** Answer of `GET /plugin-usage-stats/state`. */
export type UsageStatsEnvelope =
  | {
    readonly ok: true
    readonly version: number
    /** The first scan is still running; no numbers yet. */
    readonly status: 'scanning'
    readonly progress: ScanProgress
  }
  | {
    readonly ok: true
    readonly version: number
    readonly status: 'ready'
    /** A newer incremental scan is still running behind these numbers. */
    readonly refreshing: boolean
    /** ISO time the numbers were read. */
    readonly scannedAt: string
    readonly report: UsageReport
    readonly skipped: SkippedLog[]
  }
  | {
    readonly ok: false
    readonly error: { readonly code: string; readonly message: string }
  }

/** What the page renders after one successful read. */
export type UsageStatsState =
  | { readonly status: 'scanning'; readonly progress: ScanProgress }
  | {
    readonly status: 'ready'
    readonly refreshing: boolean
    readonly scannedAt: string
    readonly report: UsageReport
    readonly skipped: SkippedLog[]
  }

/**
 * Validate one envelope and unwrap it.
 * @param envelope - parsed Host answer.
 * @returns the page state.
 * @throws when the Host reported a failure or answered an unknown shape.
 */
export function stateFromEnvelope(envelope: unknown): UsageStatsState {
  const value = asRecord(envelope)
  if (value === undefined) throw new Error('Host 返回了无法识别的统计数据')
  if (value.ok === false) {
    const error = asRecord(value.error)
    throw new Error(str(error?.message) ?? '统计读取失败')
  }
  if (value.ok !== true || value.version !== USAGE_STATS_VERSION) {
    throw new Error('Host 的统计接口版本与页面不一致，请重启 DSH 后刷新页面')
  }
  if (value.status === 'scanning') {
    const progress = asRecord(value.progress)
    return { status: 'scanning', progress: { done: num(progress?.done), total: num(progress?.total) } }
  }
  const report = asRecord(value.report)
  if (value.status !== 'ready' || report === undefined || !Array.isArray(report.daily)) {
    throw new Error('Host 返回了无法识别的统计数据')
  }
  return {
    status: 'ready',
    refreshing: value.refreshing === true,
    scannedAt: str(value.scannedAt) ?? new Date(0).toISOString(),
    report: report as unknown as UsageReport,
    skipped: Array.isArray(value.skipped) ? value.skipped as SkippedLog[] : [],
  }
}
