/**
 * Host tests for usage statistics: the scanning → ready lifecycle, incremental
 * rescans through the persistent cache, skipped logs, query parsing, and the
 * route's trust and path handling. Sessions and cache live in a temporary
 * directory, so no DSH home is touched.
 *
 * @module dsh-session-map/usage-stats/host.test
 */
import { mkdir, mkdtemp, readFile, rm, utimes, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { zstdCompressSync } from 'node:zlib'
import type { Context } from '@deepseek-ai/cordis'
import { afterEach, describe, expect, it } from 'vitest'
import { loadUsageCache, resolveDshHome } from './cache'
import { installUsageStatsHost, parseQuery, UsageStatsStore } from './host'
import { USAGE_STATS_ROUTE, type UsageStatsEnvelope } from './model'

/** Temporary directories created by one test. */
const created: string[] = []

/** Create a temporary directory and remember it for cleanup. */
async function makeTemp(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'dsh-usage-host-'))
  created.push(root)
  return root
}

afterEach(async () => {
  await Promise.all(created.splice(0).map(async root => await rm(root, { recursive: true, force: true })))
})

const T0 = Date.UTC(2026, 10, 14, 4)

/** Write one compressed Session log whose single edit adds `lines` lines. */
async function writeSession(root: string, id: string, lines: number, extra: Record<string, unknown> = {}): Promise<string> {
  const dir = join(root, '--w-proj', id)
  await mkdir(dir, { recursive: true })
  const text = [
    { type: 'session', version: 4, id, createdAt: T0, cwd: '/w/proj', isSeeded: false, ...extra },
    { type: 'turn/start', seq: 0, time: T0, data: { turn: 1 } },
    { type: 'tool/call', seq: 1, time: T0, data: { callId: 'c', name: 'write', arguments: JSON.stringify({ file_path: '/w/proj/a.md', content: 'x\n'.repeat(lines) }) } },
    { type: 'tool/result', seq: 2, time: T0, data: { message: { toolCallId: 'c', isError: false }, meta: { operation: 'create', diffs: [] } } },
    { type: 'turn/end', seq: 3, time: T0 + 1000, data: { turn: 1, reason: { kind: 'completed' } } },
  ].map(record => `${JSON.stringify(record)}\n`).join('')
  const path = join(dir, 'session.v4.jsonl.zstd')
  await writeFile(path, zstdCompressSync(Buffer.from(text)))
  return path
}

/** Read until the store answers `ready`. */
async function readReady(store: UsageStatsStore, refresh = false): Promise<Extract<UsageStatsEnvelope, { status: 'ready' }>> {
  let envelope = store.read({ range: '365', timeZone: 'Asia/Shanghai', refresh })
  await store.startScan()
  envelope = store.read({ range: '365', timeZone: 'Asia/Shanghai', refresh: false })
  if (!envelope.ok || envelope.status !== 'ready') throw new Error(`not ready: ${JSON.stringify(envelope)}`)
  return envelope
}

describe('resolveDshHome', () => {
  it('uses a non-blank DSH_HOME and falls back to <home>/.dsh', () => {
    expect(resolveDshHome({ DSH_HOME: '/custom' }, '/home/u')).toBe('/custom')
    expect(resolveDshHome({ DSH_HOME: ' ' }, '/home/u')).toBe('/home/u/.dsh')
  })
})

describe('parseQuery', () => {
  it('defaults the range and falls back on an unknown zone', () => {
    const url = new URL('http://x/plugin-usage-stats/state?range=bogus&tz=Not/AZone&refresh=1')
    expect(parseQuery(url, 'UTC')).toEqual({ range: '365', timeZone: 'UTC', refresh: true })
    expect(parseQuery(new URL('http://x/?range=all&tz=Asia/Tokyo'), 'UTC'))
      .toEqual({ range: 'all', timeZone: 'Asia/Tokyo', refresh: false })
  })
})

describe('UsageStatsStore', () => {
  it('answers scanning first, then ready from the fold', async () => {
    const root = await makeTemp()
    await writeSession(join(root, 'sessions'), 's1', 3)
    await writeSession(join(root, 'sessions'), 's2', 4, { origin: 'subagent' })
    const store = new UsageStatsStore({ sessionsRoot: join(root, 'sessions'), cachePath: join(root, 'cache.json'), now: () => T0 })
    const first = store.read({ range: '365', timeZone: 'Asia/Shanghai', refresh: false })
    expect(first).toMatchObject({ ok: true, status: 'scanning' })
    const ready = await readReady(store)
    expect(ready.report.sessions).toEqual({ total: 2, root: 1, subagent: 1 })
    expect(ready.report.totals.added).toBe(7)
    expect(ready.report.totals.writeLines).toBe(7)
    expect(ready.refreshing).toBe(false)
    expect((await loadUsageCache(join(root, 'cache.json'))).size).toBe(2)
  })

  it('reuses unchanged cache entries and re-folds changed logs', async () => {
    const root = await makeTemp()
    const sessions = join(root, 'sessions')
    await writeSession(sessions, 's1', 3)
    const path = await writeSession(sessions, 's2', 4)
    const cachePath = join(root, 'cache.json')
    await readReady(new UsageStatsStore({ sessionsRoot: sessions, cachePath, now: () => T0 }))

    // Poison s1's cached fold: a fresh store must reuse it untouched.
    const cache = JSON.parse(await readFile(cachePath, 'utf8')) as { entries: Record<string, { summary: { cwd: string } }> }
    const s1 = Object.keys(cache.entries).find(rel => rel.includes('s1')) ?? ''
    const entry = cache.entries[s1]
    if (entry !== undefined) entry.summary.cwd = '/from/cache'
    await writeFile(cachePath, JSON.stringify(cache))
    await writeSession(sessions, 's2', 10)
    expect(path).toContain('s2')

    const ready = await readReady(new UsageStatsStore({ sessionsRoot: sessions, cachePath, now: () => T0 }))
    expect(ready.report.projects.map(row => row.cwd).sort()).toEqual(['/from/cache', '/w/proj'])
    expect(ready.report.totals.added).toBe(13)
  })

  it('reports logs it cannot read and keeps the rest', async () => {
    const root = await makeTemp()
    const sessions = join(root, 'sessions')
    await writeSession(sessions, 's1', 3)
    await mkdir(join(sessions, '--w-proj', 'bad'), { recursive: true })
    const bad = join(sessions, '--w-proj', 'bad', 'session.v4.jsonl.zstd')
    await writeFile(bad, 'not zstd at all')
    // Settled: last written well before the scan.
    await utimes(bad, new Date(T0 - 3_600_000), new Date(T0 - 3_600_000))
    await mkdir(join(sessions, '--w-proj', 'fork'), { recursive: true })
    const fork = join(sessions, '--w-proj', 'fork', 'session.v4.jsonl.zstd')
    await writeFile(fork, 'still being written')
    await utimes(fork, new Date(T0 - 1000), new Date(T0 - 1000))
    await mkdir(join(sessions, '--w-proj', 'new'), { recursive: true })
    await writeFile(join(sessions, '--w-proj', 'new', 'session.v4.jsonl.zstd'), '')
    const ready = await readReady(new UsageStatsStore({ sessionsRoot: sessions, cachePath: join(root, 'cache.json'), now: () => T0 }))
    expect(ready.report.totals.added).toBe(3)
    expect(ready.skipped).toHaveLength(1)
    expect(ready.skipped[0]?.path).toBe(join('--w-proj', 'bad', 'session.v4.jsonl.zstd'))
  })

  it('rescans in the background once the snapshot is stale', async () => {
    const root = await makeTemp()
    const sessions = join(root, 'sessions')
    await writeSession(sessions, 's1', 3)
    let clock = T0
    const store = new UsageStatsStore({ sessionsRoot: sessions, cachePath: join(root, 'cache.json'), now: () => clock, staleMs: 1000 })
    await readReady(store)
    await writeSession(sessions, 's2', 5)
    clock += 2000
    const stale = store.read({ range: '365', timeZone: 'Asia/Shanghai', refresh: false })
    expect(stale).toMatchObject({ status: 'ready', refreshing: true })
    await store.startScan()
    const fresh = store.read({ range: '365', timeZone: 'Asia/Shanghai', refresh: false })
    expect(fresh).toMatchObject({ status: 'ready', refreshing: false })
    if (fresh.ok && fresh.status === 'ready') expect(fresh.report.totals.added).toBe(8)
  })

  it('keeps memoized reports across a rescan that changed nothing', async () => {
    const root = await makeTemp()
    const sessions = join(root, 'sessions')
    await writeSession(sessions, 's1', 3)
    const store = new UsageStatsStore({ sessionsRoot: sessions, cachePath: join(root, 'cache.json'), now: () => T0 })
    const first = await readReady(store)
    const second = await readReady(store, true)
    expect(second.report).toBe(first.report)
  })

  it('queues one more pass when a refresh arrives mid-scan', async () => {
    const root = await makeTemp()
    const sessions = join(root, 'sessions')
    await writeSession(sessions, 's1', 3)
    const store = new UsageStatsStore({ sessionsRoot: sessions, cachePath: join(root, 'cache.json'), now: () => T0 })
    store.read({ range: '365', timeZone: 'UTC', refresh: false })
    // The running pass may already have listed the directory.
    await writeSession(sessions, 's2', 5)
    store.read({ range: '365', timeZone: 'UTC', refresh: true })
    await store.startScan()
    const ready = store.read({ range: '365', timeZone: 'UTC', refresh: false })
    expect(ready).toMatchObject({ status: 'ready', refreshing: false })
    if (ready.ok && ready.status === 'ready') expect(ready.report.totals.added).toBe(8)
  })

  it('reports a failed first scan instead of scanning forever', async () => {
    const root = await makeTemp()
    const store = new UsageStatsStore({ sessionsRoot: join(root, 'sessions'), cachePath: join(root, 'cache.json'), now: () => T0 })
    ;(store as unknown as { scan: () => Promise<void> }).scan = async () => { throw new Error('disk on fire') }
    store.read({ range: '365', timeZone: 'UTC', refresh: false })
    await store.startScan()
    expect(store.read({ range: '365', timeZone: 'UTC', refresh: false }))
      .toEqual({ ok: false, error: { code: 'scan-failed', message: 'disk on fire' } })
    // An explicit retry scans again.
    expect(store.read({ range: '365', timeZone: 'UTC', refresh: true })).toMatchObject({ ok: true, status: 'scanning' })
  })

  it('drops malformed cache entries instead of failing every read', async () => {
    const root = await makeTemp()
    const sessions = join(root, 'sessions')
    await writeSession(sessions, 's1', 3)
    const cachePath = join(root, 'cache.json')
    await readReady(new UsageStatsStore({ sessionsRoot: sessions, cachePath, now: () => T0 }))
    const cache = JSON.parse(await readFile(cachePath, 'utf8')) as { entries: Record<string, { summary: Record<string, unknown> }> }
    for (const entry of Object.values(cache.entries)) delete entry.summary.cwd
    await writeFile(cachePath, JSON.stringify(cache))
    expect((await loadUsageCache(cachePath)).size).toBe(0)
    const ready = await readReady(new UsageStatsStore({ sessionsRoot: sessions, cachePath, now: () => T0 }))
    expect(ready.report.totals.added).toBe(3)
  })

  it('keeps hostile names as plain keys', async () => {
    const root = await makeTemp()
    const sessions = join(root, 'sessions')
    const dir = join(sessions, '--w-proj', 'evil')
    await mkdir(dir, { recursive: true })
    const text = [
      { type: 'session', version: 4, id: 'evil', createdAt: T0, cwd: '/w/proj', isSeeded: false },
      { type: 'assistant/message', seq: 0, time: T0, data: { message: { role: 'assistant', source: { provider: 'p', model: 'constructor' } } } },
      { type: 'tool/call', seq: 1, time: T0, data: { callId: 'c', name: '__proto__', arguments: JSON.stringify({ file_path: '/w/__proto__', content: 'x\n' }) } },
      { type: 'tool/result', seq: 2, time: T0, data: { message: { toolCallId: 'c', isError: false }, meta: { operation: 'create', diffs: [] } } },
    ].map(record => `${JSON.stringify(record)}\n`).join('')
    await writeFile(join(dir, 'session.v4.jsonl'), text)
    const cachePath = join(root, 'cache.json')
    const ready = await readReady(new UsageStatsStore({ sessionsRoot: sessions, cachePath, now: () => T0 }))
    expect(ready.report.models.map(row => row.model)).toEqual(['constructor'])
    expect(ready.report.tools.map(row => row.name)).toEqual(['__proto__'])
    expect(ready.report.exts.map(row => row.ext)).toEqual(['__proto__'])
    expect(({} as Record<string, unknown>).calls).toBeUndefined()
    expect(({} as Record<string, unknown>).added).toBeUndefined()
    // The same names survive a round trip through the cache file.
    const reread = await readReady(new UsageStatsStore({ sessionsRoot: sessions, cachePath, now: () => T0 }))
    expect(reread.report.tools).toEqual(ready.report.tools)
    expect(({} as Record<string, unknown>).calls).toBeUndefined()
  })
})

describe('installUsageStatsHost route', () => {
  /** Register the route against a fake web server. */
  function install(options: { sessionsRoot: string; cachePath: string }): (request: unknown, response: unknown) => void {
    let handler: ((request: unknown, response: unknown) => void) | undefined
    const ctx = {
      get: (name: string) => name === 'webServer'
        ? { register: (route: { handler: (request: unknown, response: unknown) => void }) => { handler = route.handler; return () => {} } }
        : undefined,
      effect: (callback: () => unknown) => callback(),
    } as unknown as Context
    installUsageStatsHost(ctx, { ...options, now: () => T0 })
    if (handler === undefined) throw new Error('route was not registered')
    return handler
  }

  /** Call the handler and capture the JSON answer. */
  function call(handler: (request: unknown, response: unknown) => void, url: string, trusted = true): { status: number; body: unknown } {
    const result = { status: 0, body: undefined as unknown }
    handler(
      {
        method: 'GET',
        url,
        headers: { host: '127.0.0.1:3080' },
        socket: { remoteAddress: trusted ? '127.0.0.1' : '10.0.0.2' },
        on: () => undefined,
      },
      {
        writeHead: (status: number) => { result.status = status },
        end: (body?: string) => { result.body = body === undefined ? undefined : JSON.parse(body) as unknown },
        on: () => undefined,
      },
    )
    return result
  }

  it('gates on the loopback peer and answers only /state', async () => {
    const root = await makeTemp()
    const handler = install({ sessionsRoot: join(root, 'sessions'), cachePath: join(root, 'cache.json') })
    expect(call(handler, `${USAGE_STATS_ROUTE}/state`, false).status).toBe(403)
    expect(call(handler, `${USAGE_STATS_ROUTE}/other`).status).toBe(404)
    const scanning = call(handler, `${USAGE_STATS_ROUTE}/state?tz=UTC`)
    expect(scanning.status).toBe(200)
    expect(scanning.body).toMatchObject({ ok: true, status: 'scanning' })
  })
})
