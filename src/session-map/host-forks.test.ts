/**
 * Host-adapter tests for the fork ledger: path resolution, tolerant file IO,
 * the merge/prune rules, and the route family's read/write/trust handling.
 * The ledger lives in a temporary directory, so no DSH home or Cordis context is
 * touched.
 *
 * @module dsh-session-map/session-map/host-forks.test
 */
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { Context } from '@deepseek-ai/cordis'
import { afterEach, describe, expect, it } from 'vitest'
import {
  installSessionForkHost,
  loadForkLedger,
  mergeForkRecords,
  pruneForkRecords,
  resolveForkLedgerPath,
  saveForkLedger,
  type SessionQueryService,
} from './host-forks'
import { SESSION_FORK_ROUTE, type SessionForkRecord } from './forks'

/** Temporary directories created by one test. */
const created: string[] = []

/**
 * Create a temporary directory and remember it for cleanup.
 * @returns the absolute temporary root.
 */
async function makeTemp(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'dsh-session-forks-'))
  created.push(root)
  return root
}

afterEach(async () => {
  await Promise.all(created.splice(0).map(async root => await rm(root, { recursive: true, force: true })))
})

/** One captured route registration. */
interface CapturedRoute {
  readonly kind: 'exact' | 'prefix'
  readonly path: string
  readonly handler: (request: unknown, response: unknown) => void | Promise<void>
}

/** Build a fake Cordis context carrying the fake services and web server. */
function fakeContext(registry: Record<string, unknown>, route: { current?: CapturedRoute }): Context {
  const webServer = {
    register: (captured: CapturedRoute) => {
      route.current = captured
      return () => {}
    },
  }
  return {
    get: (name: string) => name === 'webServer' ? webServer : registry[name],
    effect: (callback: () => unknown) => callback(),
  } as unknown as Context
}

/** Response stub that records what the handler wrote. */
function fakeResponse(): { response: unknown; status: number; body: unknown } {
  const result = {
    status: 0,
    body: undefined as unknown,
    response: {
      writeHead: (status: number) => { result.status = status },
      end: (chunk?: string) => { result.body = chunk === undefined ? undefined : JSON.parse(chunk) as unknown },
    },
  }
  return result
}

/**
 * One fake request with the headers the trust gate reads.
 * @param options - method, target, body, and whether the peer is on this machine.
 * @returns the request stub.
 */
function fakeRequest(options: {
  readonly method: string
  readonly url: string
  readonly body?: unknown
  readonly rawBody?: string
  readonly trusted?: boolean
}): unknown {
  const listeners = new Map<string, ((...args: never[]) => void)[]>()
  const on = (event: string, listener: (...args: never[]) => void): unknown => {
    const list = listeners.get(event) ?? []
    list.push(listener)
    listeners.set(event, list)
    if (event === 'data' && (options.body !== undefined || options.rawBody !== undefined)) {
      const text = options.rawBody ?? JSON.stringify(options.body)
      queueMicrotask(() => { (listener as (chunk: Uint8Array) => void)(new TextEncoder().encode(text)) })
    }
    if (event === 'end') queueMicrotask(() => { (listener as () => void)() })
    return request
  }
  const request = {
    method: options.method,
    url: options.url,
    headers: options.trusted === false
      ? { host: '127.0.0.1:3080', origin: 'http://127.0.0.1:3080' }
      : { host: '127.0.0.1:3080', origin: 'http://127.0.0.1:3080' },
    socket: { remoteAddress: options.trusted === false ? '10.1.2.3' : '127.0.0.1' },
    on,
  }
  return request
}

/** One ledger row. */
function record(childId: string, parentId: string, recordedAt: number): SessionForkRecord {
  return { childId, parentId, recordedAt }
}

describe('resolveForkLedgerPath', () => {
  it('uses DSH_HOME when set and falls back to <home>/.dsh', () => {
    expect(resolveForkLedgerPath({ DSH_HOME: '/custom/dsh' }, '/home/user'))
      .toBe('/custom/dsh/session-map/forks.json')
    expect(resolveForkLedgerPath({}, '/home/user'))
      .toBe('/home/user/.dsh/session-map/forks.json')
    expect(resolveForkLedgerPath({ DSH_HOME: '   ' }, '/home/user'))
      .toBe('/home/user/.dsh/session-map/forks.json')
  })
})

describe('fork ledger file', () => {
  it('round-trips records and tolerates a missing or corrupt file', async () => {
    const root = await makeTemp()
    const path = join(root, 'session-map', 'forks.json')

    expect(await loadForkLedger(path)).toEqual([])
    await saveForkLedger(path, [record('child', 'parent', 5)])
    expect(await loadForkLedger(path)).toEqual([record('child', 'parent', 5)])

    await writeFile(path, '{not json', 'utf8')
    expect(await loadForkLedger(path)).toEqual([])

    await writeFile(path, JSON.stringify({ version: 1, forks: [{ childId: '', parentId: 'p', recordedAt: 1 }, 'row'] }), 'utf8')
    expect(await loadForkLedger(path)).toEqual([])
  })

  it('writes a private, versioned ledger document', async () => {
    const root = await makeTemp()
    const path = join(root, 'session-map', 'forks.json')
    await saveForkLedger(path, [record('child', 'parent', 5)])

    const parsed = JSON.parse(await readFile(path, 'utf8')) as { version?: unknown; forks?: unknown }
    expect(parsed.version).toBe(1)
    expect(parsed.forks).toEqual([record('child', 'parent', 5)])
  })
})

describe('mergeForkRecords', () => {
  it('replaces one child, drops expired rows, and sorts by age', () => {
    const now = 10_000
    const merged = mergeForkRecords([
      record('old', 'p0', now - 400 * 24 * 60 * 60 * 1000),
      record('child', 'p1', now - 10),
      record('other', 'p2', now - 5),
    ], record('child', 'p3', now), now)

    expect(merged).toEqual([record('other', 'p2', now - 5), record('child', 'p3', now)])
  })
})

describe('pruneForkRecords', () => {
  it('drops edges with an unlisted endpoint', () => {
    const kept = pruneForkRecords(
      [record('a', 'b', 1), record('a', 'gone', 1), record('gone', 'b', 1)],
      new Set(['a', 'b']),
    )
    expect(kept).toEqual([record('a', 'b', 1)])
  })
})

describe('installSessionForkHost', () => {
  it('serves the ledger and records an observed fork', async () => {
    const root = await makeTemp()
    const ledgerPath = join(root, 'forks.json')
    const route: { current?: CapturedRoute } = {}
    installSessionForkHost(fakeContext({}, route), { ledgerPath })

    expect(route.current?.path).toBe(SESSION_FORK_ROUTE)
    expect(route.current?.kind).toBe('prefix')
    const handler = route.current?.handler
    if (handler === undefined) throw new Error('route was not registered')

    const empty = fakeResponse()
    await handler(fakeRequest({ method: 'GET', url: `${SESSION_FORK_ROUTE}/state` }), empty.response)
    expect(empty.status).toBe(200)
    expect(empty.body).toEqual({ ok: true, version: 1, forks: [] })

    const written = fakeResponse()
    await handler(fakeRequest({
      method: 'POST',
      url: `${SESSION_FORK_ROUTE}/record`,
      body: { childId: 'child', parentId: 'parent', atSeq: 42 },
    }), written.response)
    expect(written.status).toBe(200)

    const read = fakeResponse()
    await handler(fakeRequest({ method: 'GET', url: `${SESSION_FORK_ROUTE}/state` }), read.response)
    const body = read.body as { forks?: SessionForkRecord[] }
    expect(body.forks).toHaveLength(1)
    expect(body.forks?.[0]).toMatchObject({ childId: 'child', parentId: 'parent', atSeq: 42 })
  })

  it('serializes concurrent reports instead of losing one', async () => {
    const root = await makeTemp()
    const ledgerPath = join(root, 'forks.json')
    const route: { current?: CapturedRoute } = {}
    installSessionForkHost(fakeContext({}, route), { ledgerPath })
    const handler = route.current?.handler
    if (handler === undefined) throw new Error('route was not registered')

    const first = fakeResponse()
    const second = fakeResponse()
    await Promise.all([
      handler(fakeRequest({ method: 'POST', url: `${SESSION_FORK_ROUTE}/record`, body: { childId: 'c1', parentId: 'p1' } }), first.response),
      handler(fakeRequest({ method: 'POST', url: `${SESSION_FORK_ROUTE}/record`, body: { childId: 'c2', parentId: 'p2' } }), second.response),
    ])

    const read = fakeResponse()
    await handler(fakeRequest({ method: 'GET', url: `${SESSION_FORK_ROUTE}/state` }), read.response)
    const forks = (read.body as { forks?: SessionForkRecord[] }).forks ?? []
    expect(forks.map(row => row.childId).sort()).toEqual(['c1', 'c2'])
  })

  it('prunes edges of Sessions the list no longer carries', async () => {
    const root = await makeTemp()
    const ledgerPath = join(root, 'forks.json')
    await saveForkLedger(ledgerPath, [record('a', 'b', 1), record('c', 'd', 1)])
    const sessionQuery: SessionQueryService = {
      listSessions: async () => [{ header: { id: 'a' } }, { header: { id: 'b' } }],
    }
    const route: { current?: CapturedRoute } = {}
    installSessionForkHost(fakeContext({ sessionQuery }, route), { ledgerPath })
    const handler = route.current?.handler
    if (handler === undefined) throw new Error('route was not registered')

    const read = fakeResponse()
    await handler(fakeRequest({ method: 'GET', url: `${SESSION_FORK_ROUTE}/state` }), read.response)
    expect((read.body as { forks?: SessionForkRecord[] }).forks).toEqual([record('a', 'b', 1)])
  })

  it('rejects an off-machine writer and a malformed body', async () => {
    const root = await makeTemp()
    const route: { current?: CapturedRoute } = {}
    installSessionForkHost(fakeContext({}, route), { ledgerPath: join(root, 'forks.json') })
    const handler = route.current?.handler
    if (handler === undefined) throw new Error('route was not registered')

    const forbidden = fakeResponse()
    await handler(fakeRequest({
      method: 'POST',
      url: `${SESSION_FORK_ROUTE}/record`,
      body: { childId: 'c', parentId: 'p' },
      trusted: false,
    }), forbidden.response)
    expect(forbidden.status).toBe(403)

    const malformed = fakeResponse()
    await handler(fakeRequest({
      method: 'POST',
      url: `${SESSION_FORK_ROUTE}/record`,
      rawBody: '{nope',
    }), malformed.response)
    expect(malformed.status).toBe(400)

    const invalid = fakeResponse()
    await handler(fakeRequest({
      method: 'POST',
      url: `${SESSION_FORK_ROUTE}/record`,
      body: { childId: 'c', parentId: '' },
    }), invalid.response)
    expect(invalid.status).toBe(400)
  })

  it('rejects wrong methods and unknown paths', async () => {
    const root = await makeTemp()
    const route: { current?: CapturedRoute } = {}
    installSessionForkHost(fakeContext({}, route), { ledgerPath: join(root, 'forks.json') })
    const handler = route.current?.handler
    if (handler === undefined) throw new Error('route was not registered')

    const method = fakeResponse()
    await handler(fakeRequest({ method: 'POST', url: `${SESSION_FORK_ROUTE}/state` }), method.response)
    expect(method.status).toBe(405)

    const missing = fakeResponse()
    await handler(fakeRequest({ method: 'GET', url: `${SESSION_FORK_ROUTE}/other` }), missing.response)
    expect(missing.status).toBe(404)
  })
})
