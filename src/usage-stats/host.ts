/**
 * Host half of Settings → 用量统计: scan the local Session logs into cached
 * summaries and answer one read route.
 *
 * - `GET /plugin-usage-stats/state?range=365|180|90|30|all&tz=<IANA>&refresh=0|1`
 *
 * The scan is single-flight and incremental. The first request starts it and
 * answers `scanning` with progress until the first snapshot exists; later
 * requests answer from the newest snapshot at once and start a background
 * rescan when the snapshot is older than {@link STALE_MS} or the page asked for
 * a refresh (stale-while-revalidate). A rescan re-folds only the logs whose
 * size or mtime changed, so it usually costs milliseconds.
 *
 * Logs are read directly from `$DSH_HOME/sessions` rather than through the
 * Session query service: the counters need every tool result's diff payload,
 * which the query service only returns by materializing whole Sessions.
 *
 * Session logs hold the user's prompts and code, so the route is loopback-gated
 * like the package's write routes even though it only reads.
 *
 * @module dsh-session-map/usage-stats/host
 */
import type { Context } from '@deepseek-ai/cordis'
import { join } from 'node:path'
import { errorMessage } from '../git-workspace/git'
import {
  isTrustedRequest,
  sendJson,
  type RouteRequest,
  type RouteResponse,
  type WebServerService,
} from '../git-workspace/host-http'
import { defaultCachePath, loadUsageCache, resolveDshHome, saveUsageCache, type CacheEntry } from './cache'
import {
  aggregateUsage,
  isValidTimeZone,
  localSlot,
  parseRange,
  USAGE_STATS_ROUTE,
  USAGE_STATS_VERSION,
  type RangeKind,
  type ScanProgress,
  type SessionSummary,
  type SkippedLog,
  type UsageReport,
  type UsageStatsEnvelope,
} from './model'
import { listSessionLogs, Slicer, summarizeLogFile } from './scan'

/** Snapshot age after which a read starts a background rescan. */
export const STALE_MS = 30_000

/** Shortest gap between two cache writes; a lost write only costs a re-read. */
export const SAVE_INTERVAL_MS = 60_000

/**
 * Age under which a log that cannot be counted is assumed to be mid-write (a
 * fork whose first batch has not landed yet) and is not reported as skipped.
 */
export const SETTLE_MS = 120_000

/** Install seams a test or a deployment override. */
export interface UsageStatsHostOptions {
  /** Sessions root; defaults to `$DSH_HOME/sessions`. */
  readonly sessionsRoot?: string | undefined
  /** Cache file; defaults to `$DSH_HOME/session-map/usage-stats.v<rules>.json`. */
  readonly cachePath?: string | undefined
  /** Clock, epoch ms. */
  readonly now?: (() => number) | undefined
  /** Snapshot age that triggers a rescan. */
  readonly staleMs?: number | undefined
}

/** One finished scan. */
interface Snapshot {
  readonly generation: number
  readonly summaries: readonly SessionSummary[]
  readonly skipped: readonly SkippedLog[]
  readonly scannedAt: number
}

/** Parameters of one read. */
export interface UsageStatsQuery {
  readonly range: RangeKind
  readonly timeZone: string
  readonly refresh: boolean
}

/** Scan state plus the snapshot every read is answered from. */
export class UsageStatsStore {
  private readonly sessionsRoot: string
  private readonly cachePath: string
  private readonly now: () => number
  private readonly staleMs: number
  private readonly controller = new AbortController()
  private cache: Map<string, CacheEntry> | undefined
  private snapshot: Snapshot | undefined
  private running: Promise<void> | undefined
  private progress: ScanProgress = { done: 0, total: 0 }
  private lastError: string | undefined
  private rescanRequested = false
  private dirty = false
  private rebuiltCache = false
  private lastSavedAt = Number.NEGATIVE_INFINITY
  private generation = 0
  private readonly reports = new Map<string, UsageReport>()

  /** @param options - install seams. */
  constructor(options: UsageStatsHostOptions = {}) {
    const dshHome = resolveDshHome()
    this.sessionsRoot = options.sessionsRoot ?? join(dshHome, 'sessions')
    this.cachePath = options.cachePath ?? defaultCachePath(dshHome)
    this.now = options.now ?? Date.now
    this.staleMs = options.staleMs ?? STALE_MS
  }

  /**
   * Answer one read, starting a scan when needed.
   * @param query - range, zone, and refresh flag.
   * @returns the wire envelope.
   */
  read(query: UsageStatsQuery): UsageStatsEnvelope {
    const snapshot = this.snapshot
    if (snapshot === undefined) {
      // A failed first scan is reported until the page asks again explicitly;
      // restarting it here would answer `scanning 0/0` forever.
      if (this.running === undefined && this.lastError !== undefined && !query.refresh) {
        return { ok: false, error: { code: 'scan-failed', message: this.lastError } }
      }
      void this.startScan(query.refresh)
      return this.scanningEnvelope()
    }
    if (query.refresh || this.now() - snapshot.scannedAt > this.staleMs) void this.startScan(query.refresh)
    let report: UsageReport
    try {
      report = this.report(snapshot, query)
    } catch (error: unknown) {
      // A damaged cache entry can break aggregation: drop every cached fold and
      // read the logs again, once. A second failure is a real fault.
      if (this.rebuiltCache) {
        return { ok: false, error: { code: 'aggregate-failed', message: errorMessage(error) } }
      }
      this.rebuiltCache = true
      this.cache = new Map()
      this.snapshot = undefined
      this.reports.clear()
      this.lastSavedAt = Number.NEGATIVE_INFINITY
      void this.startScan(true)
      return this.scanningEnvelope()
    }
    return {
      ok: true,
      version: USAGE_STATS_VERSION,
      status: 'ready',
      refreshing: this.running !== undefined,
      scannedAt: new Date(snapshot.scannedAt).toISOString(),
      report,
      skipped: [...snapshot.skipped],
    }
  }

  private scanningEnvelope(): UsageStatsEnvelope {
    return { ok: true, version: USAGE_STATS_VERSION, status: 'scanning', progress: { ...this.progress } }
  }

  /**
   * Start a scan unless one is running (single-flight).
   *
   * A running scan may already have passed the log a refresh is about: an
   * explicit refresh during a scan queues exactly one more pass, which starts
   * when the current one ends.
   * @param explicit - whether the page asked for fresh numbers.
   * @returns the running scan, including any queued pass.
   */
  startScan(explicit = false): Promise<void> {
    if (this.running !== undefined) {
      if (explicit) this.rescanRequested = true
      return this.running
    }
    this.lastError = undefined
    this.rescanRequested = false
    const running: Promise<void> = this.scan()
      .catch((error: unknown) => {
        if (!this.controller.signal.aborted) this.lastError = errorMessage(error)
      })
      .then(async () => {
        if (!this.rescanRequested || this.controller.signal.aborted) return
        this.rescanRequested = false
        await this.scan().catch((error: unknown) => {
          if (!this.controller.signal.aborted) this.lastError = errorMessage(error)
        })
      })
      .finally(() => {
        if (this.running === running) this.running = undefined
      })
    this.running = running
    return running
  }

  /** Stop a running scan; the store answers no further scans. */
  dispose(): void {
    this.controller.abort(new Error('usage-stats: disposed'))
  }

  /** Aggregate one snapshot, memoized per generation, range, zone, and day. */
  private report(snapshot: Snapshot, query: UsageStatsQuery): UsageReport {
    const now = this.now()
    // The local date bounds move at local midnight, so today's date is part of
    // the key (an hour index would miss midnight in a +05:30 zone).
    const today = localSlot(now, query.timeZone).date
    const key = `${String(snapshot.generation)}|${query.range}|${query.timeZone}|${today}`
    let report = this.reports.get(key)
    if (report === undefined) {
      report = aggregateUsage(snapshot.summaries, { timeZone: query.timeZone, range: query.range, now })
      if (this.reports.size > 32) this.reports.clear()
      this.reports.set(key, report)
    }
    return report
  }

  /** One incremental scan of every Session log. */
  private async scan(): Promise<void> {
    const signal = this.controller.signal
    const slicer = new Slicer(signal)
    this.cache ??= await loadUsageCache(this.cachePath)
    const files = await listSessionLogs(this.sessionsRoot, signal)
    this.progress = { done: 0, total: files.length }

    const previous = this.cache
    const next = new Map<string, CacheEntry>()
    let changed = previous.size !== files.length
    for (const file of files) {
      let entry = previous.get(file.rel)
      if (entry === undefined || entry.size !== file.size || entry.mtimeMs !== file.mtimeMs) {
        changed = true
        try {
          const result = await summarizeLogFile(file.path, slicer)
          entry = result.ok
            ? { size: file.size, mtimeMs: file.mtimeMs, summary: result.summary }
            : { size: file.size, mtimeMs: file.mtimeMs, summary: null, reason: result.reason }
        } catch (error: unknown) {
          if (signal.aborted) throw error
          entry = { size: file.size, mtimeMs: file.mtimeMs, summary: null, reason: errorMessage(error) }
        }
      }
      next.set(file.rel, entry)
      this.progress = { done: this.progress.done + 1, total: files.length }
      await slicer.maybeYield()
    }

    this.cache = next
    const scannedAt = this.now()
    const summaries: SessionSummary[] = []
    const skipped: SkippedLog[] = []
    for (const [rel, entry] of next) {
      if (entry.summary !== null) summaries.push(entry.summary)
      // An empty log is a Session created a moment ago, and a recently written
      // one that cannot be counted is usually a fork mid-write: neither is a
      // failure yet.
      else if (entry.size > 0 && scannedAt - entry.mtimeMs >= SETTLE_MS) {
        skipped.push({ path: rel, reason: entry.reason ?? '无法读取' })
      }
    }
    const previousSnapshot = this.snapshot
    const sameSkipped = previousSnapshot !== undefined
      && previousSnapshot.skipped.length === skipped.length
      && previousSnapshot.skipped.every((item, index) => item.path === skipped[index]?.path)
    // A rescan that changed nothing keeps the generation, so memoized reports
    // stay valid and the page's 800 ms polls do not re-aggregate.
    if (changed || !sameSkipped || previousSnapshot === undefined) {
      this.generation += 1
      this.reports.clear()
    }
    this.snapshot = { generation: this.generation, summaries, skipped, scannedAt }
    if (changed) this.dirty = true
    if (this.dirty && scannedAt - this.lastSavedAt >= SAVE_INTERVAL_MS) {
      this.dirty = false
      this.lastSavedAt = scannedAt
      // The cache only saves time; a failed write must not fail the scan.
      await saveUsageCache(this.cachePath, next).catch(() => undefined)
    }
  }
}

/**
 * Parse one read's query string.
 * @param url - request URL.
 * @param fallbackZone - zone used when the page sent none or an unknown one.
 * @returns the read parameters.
 */
export function parseQuery(url: URL, fallbackZone: string): UsageStatsQuery {
  const zone = url.searchParams.get('tz') ?? ''
  return {
    range: parseRange(url.searchParams.get('range')),
    timeZone: isValidTimeZone(zone) ? zone : fallbackZone,
    refresh: url.searchParams.get('refresh') === '1',
  }
}

/**
 * Build the route handler over one store.
 * @param store - scan state.
 * @returns the request handler.
 */
export function createUsageStatsHandler(
  store: UsageStatsStore,
): (request: RouteRequest, response: RouteResponse) => void {
  const hostZone = Intl.DateTimeFormat().resolvedOptions().timeZone
  return (request, response) => {
    try {
      if (!isTrustedRequest(request)) {
        sendJson(response, 403, {
          ok: false,
          error: { code: 'forbidden', message: 'usage statistics are only served to this machine' },
        })
        return
      }
      const url = new URL(request.url ?? '/', 'http://localhost')
      const method = (request.method ?? 'GET').toUpperCase()
      if (url.pathname !== `${USAGE_STATS_ROUTE}/state`) {
        sendJson(response, 404, {
          ok: false,
          error: { code: 'not-found', message: `unknown endpoint: ${method} ${url.pathname}` },
        })
        return
      }
      if (method !== 'GET') {
        sendJson(response, 405, { ok: false, error: { code: 'method-not-allowed', message: 'use GET' } })
        return
      }
      sendJson(response, 200, store.read(parseQuery(url, hostZone)))
    } catch (error: unknown) {
      sendJson(response, 500, { ok: false, error: { code: 'internal', message: errorMessage(error) } })
    }
  }
}

/** Structural view of the context's untyped service lookup. */
interface ServiceLocator {
  get(name: string): unknown
}

/**
 * Install the usage statistics route.
 *
 * Call this from a context that already provides `webServer`. The scan starts
 * on the first read, not at install, so a Harness that never opens the page
 * never pays for it.
 * @param ctx - plugin context carrying the web server.
 * @param options - install seams.
 */
export function installUsageStatsHost(ctx: Context, options: UsageStatsHostOptions = {}): void {
  const webServer = (ctx as unknown as ServiceLocator).get('webServer') as WebServerService | undefined
  if (webServer === undefined) return
  ctx.effect(() => {
    const store = new UsageStatsStore(options)
    const unregister = webServer.register({ kind: 'prefix', path: USAGE_STATS_ROUTE, handler: createUsageStatsHandler(store) })
    return () => {
      unregister()
      store.dispose()
    }
  }, 'usage-stats: state route')
}
