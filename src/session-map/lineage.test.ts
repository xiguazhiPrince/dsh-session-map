/**
 * Tests for the fork-lineage seed read: the response parser, the page-lifetime
 * cache, and the failure fallback that keeps the canvas direction-free.
 *
 * @module dsh-session-map/session-map/lineage.test
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  SESSION_LINEAGE_ROUTE,
  createdAtFromLineage,
  loadSessionCreatedAt,
  resetSessionLineage,
} from './lineage'

/** One captured fetch call. */
interface FetchCall {
  readonly url: URL
  readonly init: RequestInit | undefined
}

afterEach(() => {
  resetSessionLineage()
  vi.unstubAllGlobals()
})

/**
 * Stub the browser globals the loader reads and return the captured calls.
 * @param response - what the stubbed fetch resolves to.
 * @returns the captured fetch calls.
 */
function stubFetch(response: unknown): FetchCall[] {
  const calls: FetchCall[] = []
  vi.stubGlobal('document', { baseURI: 'http://127.0.0.1:3080/' })
  vi.stubGlobal('fetch', async (url: URL, init?: RequestInit) => {
    calls.push({ url, init })
    return response
  })
  return calls
}

describe('createdAtFromLineage', () => {
  it('keeps every usable row and skips the rest', () => {
    expect(createdAtFromLineage({
      ok: true,
      sessions: [
        { id: 'a', createdAt: 100, isSeeded: false },
        { id: 'b', createdAt: 200, isSeeded: true },
        { id: '', createdAt: 300 },
        { id: 'c', createdAt: Number.NaN },
        { id: 'd' },
        null,
        'row',
      ],
    })).toEqual({ a: 100, b: 200 })
  })

  it('answers an empty map for a foreign or missing body', () => {
    expect(createdAtFromLineage(undefined)).toEqual({})
    expect(createdAtFromLineage(null)).toEqual({})
    expect(createdAtFromLineage('nope')).toEqual({})
    expect(createdAtFromLineage({ sessions: 'nope' })).toEqual({})
    expect(createdAtFromLineage({ sessions: [] })).toEqual({})
  })
})

describe('loadSessionCreatedAt', () => {
  it('reads the route once and caches the success', async () => {
    const calls = stubFetch({
      ok: true,
      json: async () => ({ ok: true, sessions: [{ id: 'a', createdAt: 100, isSeeded: false }] }),
    })

    const first = await loadSessionCreatedAt()
    const second = await loadSessionCreatedAt()

    expect(first).toEqual({ a: 100 })
    expect(second).toBe(first)
    expect(calls).toHaveLength(1)
    expect(calls[0]?.url.pathname).toBe(`${SESSION_LINEAGE_ROUTE}/state`)
  })

  it('shares one in-flight read between mounted canvases', async () => {
    const calls = stubFetch({
      ok: true,
      json: async () => ({ ok: true, sessions: [{ id: 'a', createdAt: 100, isSeeded: false }] }),
    })

    const [first, second] = await Promise.all([loadSessionCreatedAt(), loadSessionCreatedAt()])
    expect(first).toBe(second)
    expect(calls).toHaveLength(1)
  })

  it('does not cache a missing route so the next mount retries', async () => {
    const calls = stubFetch({ ok: false, status: 404, json: async () => ({}) })

    expect(await loadSessionCreatedAt()).toEqual({})
    expect(await loadSessionCreatedAt()).toEqual({})
    expect(calls).toHaveLength(2)
  })

  it('does not cache a transport failure', async () => {
    vi.stubGlobal('document', { baseURI: 'http://127.0.0.1:3080/' })
    vi.stubGlobal('fetch', async () => { throw new Error('offline') })

    expect(await loadSessionCreatedAt()).toEqual({})
    expect(await loadSessionCreatedAt()).toEqual({})
  })
})
