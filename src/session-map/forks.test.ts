/**
 * Tests for the fork ledger's browser half: the response parser, the local
 * observation store, the Host round-trip, and the merge rule that lets a local
 * observation outrank an older ledger read.
 *
 * @module dsh-session-map/session-map/forks.test
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  SESSION_FORK_ROUTE,
  currentForkParents,
  forkParentsFromEnvelope,
  recordFork,
  refreshSessionForks,
  rememberFork,
  resetSessionForks,
  subscribeSessionForks,
} from './forks'

/** One captured request. */
interface Captured {
  readonly url: URL
  readonly init: RequestInit | undefined
}

afterEach(() => {
  resetSessionForks()
  vi.unstubAllGlobals()
})

/**
 * Stub the browser globals the module reads and capture its requests.
 * @param responder - per-request result.
 * @returns the captured requests.
 */
function stubFetch(responder: (url: URL) => unknown): Captured[] {
  const calls: Captured[] = []
  vi.stubGlobal('document', { baseURI: 'http://127.0.0.1:3080/' })
  vi.stubGlobal('fetch', async (url: URL, init?: RequestInit) => {
    calls.push({ url, init })
    return responder(url)
  })
  return calls
}

describe('forkParentsFromEnvelope', () => {
  it('keeps the last usable edge per child and skips foreign rows', () => {
    expect(forkParentsFromEnvelope({
      ok: true,
      version: 1,
      forks: [
        { childId: 'c1', parentId: 'p1', recordedAt: 1 },
        { childId: 'c1', parentId: 'p2', recordedAt: 2 },
        { childId: '', parentId: 'p' },
        { childId: 'c2', parentId: 'c2' },
        { childId: 'c3', parentId: '' },
        null,
      ],
    })).toEqual({ c1: 'p2' })
  })

  it('answers an empty map for a foreign or missing body', () => {
    expect(forkParentsFromEnvelope(undefined)).toEqual({})
    expect(forkParentsFromEnvelope(null)).toEqual({})
    expect(forkParentsFromEnvelope({ forks: 'nope' })).toEqual({})
  })
})

describe('local observations', () => {
  it('merges observed edges and wakes subscribers', () => {
    let wakes = 0
    const unsubscribe = subscribeSessionForks(() => { wakes += 1 })
    expect(currentForkParents()).toEqual({})

    rememberFork({ childId: 'child', parentId: 'parent' })
    expect(currentForkParents()).toEqual({ child: 'parent' })
    expect(wakes).toBe(1)

    // The snapshot is reference-stable while nothing changes.
    const stable = currentForkParents()
    expect(currentForkParents()).toBe(stable)

    unsubscribe()
    rememberFork({ childId: 'other', parentId: 'parent' })
    expect(wakes).toBe(1)
  })

  it('reports one edge once when two observers see the same fork', () => {
    const calls = stubFetch(() => ({ ok: true }))

    recordFork({ childId: 'child', parentId: 'parent' })
    recordFork({ childId: 'child', parentId: 'parent' })

    expect(calls).toHaveLength(1)
  })

  it('reports an observed fork to the Host ledger and remembers it at once', () => {
    const calls = stubFetch(() => ({ ok: true }))

    recordFork({ childId: 'child', parentId: 'parent', atSeq: 42 })

    expect(currentForkParents()).toEqual({ child: 'parent' })
    expect(calls).toHaveLength(1)
    expect(calls[0]?.url.pathname).toBe(`${SESSION_FORK_ROUTE}/record`)
    expect(calls[0]?.init?.method).toBe('POST')
    expect(JSON.parse(String(calls[0]?.init?.body))).toEqual({ childId: 'child', parentId: 'parent', atSeq: 42 })
  })
})

describe('ledger reads', () => {
  it('merges the Host edges and lets local observations win', async () => {
    stubFetch(() => ({
      ok: true,
      json: async () => ({ ok: true, version: 1, forks: [{ childId: 'remote', parentId: 'p1', recordedAt: 1 }] }),
    }))
    rememberFork({ childId: 'local', parentId: 'p2' })

    await refreshSessionForks()

    expect(currentForkParents()).toEqual({ remote: 'p1', local: 'p2' })
  })

  it('does not overwrite a local observation with the same child from the ledger', async () => {
    stubFetch(() => ({
      ok: true,
      json: async () => ({ ok: true, version: 1, forks: [{ childId: 'child', parentId: 'older', recordedAt: 1 }] }),
    }))
    rememberFork({ childId: 'child', parentId: 'newer' })

    await refreshSessionForks()

    expect(currentForkParents()).toEqual({ child: 'newer' })
  })

  it('keeps the previous edges when the read fails', async () => {
    stubFetch(() => ({ ok: false, status: 404, json: async () => ({}) }))
    rememberFork({ childId: 'local', parentId: 'p' })

    await refreshSessionForks()

    expect(currentForkParents()).toEqual({ local: 'p' })
  })

  it('shares one in-flight read', async () => {
    const calls = stubFetch(() => ({
      ok: true,
      json: async () => ({ ok: true, version: 1, forks: [] }),
    }))

    await Promise.all([refreshSessionForks(), refreshSessionForks()])

    expect(calls).toHaveLength(1)
  })
})
