/**
 * Tests for the browser fork recorder: the wrapper forwards, reports the exact
 * `{ parent, child }` pair, never double-wraps under two installers, and
 * restores the original method when it leaves.
 *
 * @module dsh-session-map/session-map/fork-recorder.test
 */
import type { Context } from '@deepseek-ai/cordis'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { installForkRecorder } from './fork-recorder'
import { resetSessionForks } from './forks'

/** One captured request. */
interface Captured {
  readonly url: URL
  readonly init: RequestInit | undefined
}

afterEach(() => {
  resetSessionForks()
  vi.unstubAllGlobals()
})

/** Stub the browser globals the ledger write reads. */
function stubFetch(): Captured[] {
  const calls: Captured[] = []
  vi.stubGlobal('document', { baseURI: 'http://127.0.0.1:3080/' })
  vi.stubGlobal('fetch', async (url: URL, init?: RequestInit) => {
    calls.push({ url, init })
    return { ok: true }
  })
  return calls
}

/**
 * A fake context exposing one service and running effects immediately.
 * @param services - service table.
 * @returns the context and its registered disposers.
 */
function fakeContext(services: Record<string, unknown>): { ctx: Context; disposers: (() => void)[] } {
  const disposers: (() => void)[] = []
  const ctx = {
    get: (name: string) => services[name],
    effect: (callback: () => unknown) => {
      const disposer = callback()
      if (typeof disposer === 'function') disposers.push(disposer as () => void)
      return disposer
    },
  } as unknown as Context
  return { ctx, disposers }
}

/** A fake client Session service that records fork calls. */
function fakeSessions(result: () => Promise<string> = async () => 'child'): {
  readonly calls: unknown[]
  fork: (request: unknown) => Promise<string>
} {
  const calls: unknown[] = []
  return {
    calls,
    async fork(request: unknown): Promise<string> {
      calls.push(request)
      return await result()
    },
  }
}

describe('installForkRecorder', () => {
  it('reports the exact parent of a successful fork and returns the child id', async () => {
    const writes = stubFetch()
    const sessions = fakeSessions()
    const { ctx } = fakeContext({ sessions })
    installForkRecorder(ctx)

    const childId = await sessions.fork({ sessionId: 'parent', atSeq: 42 })

    expect(childId).toBe('child')
    expect(sessions.calls).toEqual([{ sessionId: 'parent', atSeq: 42 }])
    expect(writes).toHaveLength(1)
    expect(JSON.parse(String(writes[0]?.init?.body))).toEqual({ childId: 'child', parentId: 'parent', atSeq: 42 })
  })

  it('reports nothing when the fork fails', async () => {
    const writes = stubFetch()
    const sessions = fakeSessions(async () => { throw new Error('denied') })
    const { ctx } = fakeContext({ sessions })
    installForkRecorder(ctx)

    await expect(sessions.fork({ sessionId: 'parent' })).rejects.toThrow('denied')
    expect(writes).toHaveLength(0)
  })

  it('forwards without adding an atSeq the caller did not pass', async () => {
    const writes = stubFetch()
    const sessions = fakeSessions()
    const { ctx } = fakeContext({ sessions })
    installForkRecorder(ctx)

    await sessions.fork({ sessionId: 'parent' })

    expect(JSON.parse(String(writes[0]?.init?.body))).toEqual({ childId: 'child', parentId: 'parent' })
  })

  it('wraps once for two installers and restores only after the last leaves', async () => {
    stubFetch()
    const sessions = fakeSessions()
    const first = fakeContext({ sessions })
    const second = fakeContext({ sessions })
    const original = sessions.fork

    installForkRecorder(first.ctx)
    installForkRecorder(second.ctx)
    expect(sessions.fork).not.toBe(original)

    first.disposers.splice(0).forEach(dispose => { dispose() })
    expect(sessions.fork).not.toBe(original)

    second.disposers.splice(0).forEach(dispose => { dispose() })
    expect(sessions.fork).toBe(original)
  })

  it('leaves a composition without the Session service alone', () => {
    const { ctx, disposers } = fakeContext({})
    expect(() => { installForkRecorder(ctx) }).not.toThrow()
    expect(disposers).toHaveLength(0)
  })
})
