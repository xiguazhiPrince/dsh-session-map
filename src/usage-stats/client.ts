/**
 * Browser half of Settings → 用量统计: read the Host route with the viewer's
 * time zone, poll while the first scan runs, and keep the last good numbers on
 * screen when a later read fails.
 *
 * Presentation lives in `view.ts`; every counting rule lives in `model.ts`.
 *
 * @module dsh-session-map/usage-stats/client
 */
import type { Context } from '@deepseek-ai/cordis'
import * as React from 'react'
import {
  stateFromEnvelope,
  USAGE_STATS_ROUTE,
  type HeatMetric,
  type OriginFilter,
  type RangeKind,
  type UsageStatsState,
} from './model'
import { UsageStatsPage, type UsageBody, type UsageTab } from './view'

/** Poll interval while the Host is scanning. */
export const POLL_MS = 800

/** One read request. */
export interface UsageStatsRequest {
  readonly range: RangeKind
  readonly timeZone: string
  readonly refresh: boolean
}

/** Everything the page needs from its Host. */
export interface UsageStatsRuntime {
  /** Read the statistics; the abort releases the page's request. */
  load(request: UsageStatsRequest, signal?: AbortSignal): Promise<UsageStatsState>
  /** The viewer's IANA time zone. */
  timeZone(): string
}

/** One request to the Host route on the page's own origin. */
async function requestState(request: UsageStatsRequest, signal?: AbortSignal): Promise<UsageStatsState> {
  const url = new URL(`${USAGE_STATS_ROUTE}/state`, document.baseURI)
  url.searchParams.set('range', request.range)
  url.searchParams.set('tz', request.timeZone)
  if (request.refresh) url.searchParams.set('refresh', '1')
  const response = await fetch(url, { method: 'GET', cache: 'no-store', ...(signal === undefined ? {} : { signal }) })
  const text = await response.text()
  let body: unknown
  try {
    body = text === '' ? undefined : JSON.parse(text) as unknown
  } catch {
    // A Host started before this plugin version has no such route.
    throw new Error(response.status === 404
      ? '没有找到统计接口，请重启 DSH 后再打开'
      : `Host 返回了无法解析的响应（HTTP ${String(response.status)}）`)
  }
  if (body === undefined) throw new Error(`Host 没有返回统计数据（HTTP ${String(response.status)}）`)
  return stateFromEnvelope(body)
}

/**
 * Build the page runtime over the running page.
 * @param _ctx - browser root context; the route is same-origin, so no service is read.
 * @returns the runtime the settings page calls.
 */
export function createUsageStatsRuntime(_ctx: Context): UsageStatsRuntime {
  return {
    async load(request, signal) {
      return await requestState(request, signal)
    },
    timeZone() {
      try {
        return Intl.DateTimeFormat().resolvedOptions().timeZone
      } catch {
        return 'UTC'
      }
    },
  }
}

/** Whether an unknown thrown value is the abort of a page-owned request. */
function isAbortError(error: unknown): boolean {
  return typeof error === 'object' && error !== null && (error as { name?: unknown }).name === 'AbortError'
}

/** Printable text for an unknown thrown value. */
function errorText(error: unknown): string {
  if (error instanceof Error) return error.message
  return String(error)
}

/**
 * Build the Settings section body.
 * @param runtime - Host and browser capabilities.
 * @returns a slot component rendering the usage statistics page.
 */
export function createUsageStatsSettings(runtime: UsageStatsRuntime): () => React.ReactElement {
  return function UsageStatsSettings(): React.ReactElement {
    const [body, setBody] = React.useState<UsageBody>({ kind: 'loading' })
    const [tab, setTab] = React.useState<UsageTab>('overview')
    const [range, setRange] = React.useState<RangeKind>('365')
    const [metric, setMetric] = React.useState<HeatMetric>('lines')
    const [origin, setOrigin] = React.useState<OriginFilter>('all')
    const [busy, setBusy] = React.useState(false)
    const [staleFailure, setStaleFailure] = React.useState<string | null>(null)
    const inFlight = React.useRef<AbortController | null>(null)
    const timer = React.useRef<ReturnType<typeof setTimeout> | null>(null)
    const hasData = React.useRef(false)
    const rangeRef = React.useRef(range)
    rangeRef.current = range

    const read = React.useCallback(async (refresh: boolean): Promise<void> => {
      if (timer.current !== null) clearTimeout(timer.current)
      timer.current = null
      inFlight.current?.abort()
      const controller = new AbortController()
      inFlight.current = controller
      setBusy(true)
      let again = false
      try {
        const next = await runtime.load({ range: rangeRef.current, timeZone: runtime.timeZone(), refresh }, controller.signal)
        if (controller.signal.aborted) return
        setStaleFailure(null)
        if (next.status === 'scanning') {
          // Keep older numbers on screen when a range switch races a rescan.
          if (!hasData.current) setBody({ kind: 'scanning', progress: next.progress })
          again = true
        } else {
          hasData.current = true
          setBody({ kind: 'ready', report: next.report, scannedAt: next.scannedAt, refreshing: next.refreshing, skipped: next.skipped })
          again = next.refreshing
        }
      } catch (error: unknown) {
        if (isAbortError(error) || controller.signal.aborted) return
        const message = errorText(error)
        if (hasData.current) {
          setStaleFailure(message)
          // Polling stops here, so the shown snapshot is no longer updating.
          setBody(previous => previous.kind === 'ready' && previous.refreshing ? { ...previous, refreshing: false } : previous)
        } else {
          setBody({ kind: 'error', message })
        }
      } finally {
        if (inFlight.current === controller) {
          inFlight.current = null
          setBusy(false)
          if (again) timer.current = setTimeout(() => { void read(false) }, POLL_MS)
        }
      }
    }, [])

    React.useEffect(() => {
      void read(false)
    }, [read, range])

    React.useEffect(() => () => {
      inFlight.current?.abort()
      if (timer.current !== null) clearTimeout(timer.current)
    }, [])

    return React.createElement(UsageStatsPage, {
      body,
      tab,
      onTab: setTab,
      range,
      onRange: setRange,
      metric,
      onMetric: setMetric,
      origin,
      onOrigin: setOrigin,
      onRefresh: () => { void read(true) },
      busy,
      staleFailure,
    })
  }
}
