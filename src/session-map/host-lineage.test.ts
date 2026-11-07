/**
 * Host-adapter tests for the Session-map seed route: the header-only listing it
 * serves, the row filtering, and the route's method/path/failure handling.
 * Services are faked structurally, so no Cordis context or Session backend is
 * needed.
 *
 * @module dsh-session-map/session-map/host-lineage.test
 */
import type { Context } from '@deepseek-ai/cordis'
import { describe, expect, it } from 'vitest'
import {
  installSessionLineageHost,
  readSessionLineage,
  type SessionQueryRecord,
  type SessionQueryService,
} from './host-lineage'
import { SESSION_LINEAGE_ROUTE } from './lineage'

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

/** A fake Session query service listing the given records. */
function fakeQuery(records: readonly SessionQueryRecord[]): SessionQueryService & { calls: number } {
  const service = {
    calls: 0,
    async listSessions(): Promise<readonly SessionQueryRecord[]> {
      service.calls += 1
      return records
    },
  }
  return service
}

describe('readSessionLineage', () => {
  it('publishes id, creation time and seeded flag and drops unusable rows', async () => {
    const envelope = await readSessionLineage(fakeQuery([
      { header: { id: 'a', createdAt: 100, isSeeded: false } },
      { header: { id: 'b', createdAt: 200, isSeeded: true } },
      { header: { id: '', createdAt: 1 } },
      { header: { id: 'c', createdAt: Number.NaN } },
      { header: {} },
      {},
    ]))

    expect(envelope).toEqual({
      ok: true,
      sessions: [
        { id: 'a', createdAt: 100, isSeeded: false },
        { id: 'b', createdAt: 200, isSeeded: true },
      ],
    })
  })

  it('answers an empty list when the composition mounts no Session query', async () => {
    expect(await readSessionLineage(undefined)).toEqual({ ok: true, sessions: [] })
  })
})

describe('installSessionLineageHost', () => {
  it('serves the seed read and rejects other methods and paths', async () => {
    const route: { current?: CapturedRoute } = {}
    const query = fakeQuery([{ header: { id: 'a', createdAt: 100, isSeeded: false } }])
    installSessionLineageHost(fakeContext({ sessionQuery: query }, route))

    expect(route.current?.path).toBe(SESSION_LINEAGE_ROUTE)
    expect(route.current?.kind).toBe('prefix')
    const handler = route.current?.handler
    expect(handler).toBeTypeOf('function')
    if (handler === undefined) return

    const ok = fakeResponse()
    await handler({ method: 'GET', url: `${SESSION_LINEAGE_ROUTE}/state` }, ok.response)
    expect(ok.status).toBe(200)
    expect(ok.body).toEqual({
      ok: true,
      sessions: [{ id: 'a', createdAt: 100, isSeeded: false }],
    })
    expect(query.calls).toBe(1)

    const method = fakeResponse()
    await handler({ method: 'POST', url: `${SESSION_LINEAGE_ROUTE}/state` }, method.response)
    expect(method.status).toBe(405)

    const missing = fakeResponse()
    await handler({ method: 'GET', url: `${SESSION_LINEAGE_ROUTE}/other` }, missing.response)
    expect(missing.status).toBe(404)
  })

  it('reports a listing failure as an internal route failure', async () => {
    const route: { current?: CapturedRoute } = {}
    installSessionLineageHost(fakeContext({
      sessionQuery: {
        listSessions: async () => { throw new Error('backend down') },
      },
    }, route))
    const handler = route.current?.handler
    if (handler === undefined) throw new Error('route was not registered')

    const failed = fakeResponse()
    await handler({ method: 'GET', url: `${SESSION_LINEAGE_ROUTE}/state` }, failed.response)
    expect(failed.status).toBe(500)
    expect((failed.body as { error?: { message?: string } }).error?.message).toContain('backend down')
  })

  it('answers an empty list without a Session query service', async () => {
    const route: { current?: CapturedRoute } = {}
    installSessionLineageHost(fakeContext({}, route))
    const handler = route.current?.handler
    if (handler === undefined) throw new Error('route was not registered')

    const ok = fakeResponse()
    await handler({ method: 'GET', url: `${SESSION_LINEAGE_ROUTE}/state` }, ok.response)
    expect(ok.status).toBe(200)
    expect(ok.body).toEqual({ ok: true, sessions: [] })
  })
})
