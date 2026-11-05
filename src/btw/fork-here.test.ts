/**
 * "btw from the current progress" flow tests: which event seq becomes the cut,
 * the order of fork → read-only → navigate, and every failure the button must
 * report instead of landing the user in a writable Session.
 *
 * @module dsh-session-map/btw/fork-here.test
 */
import { describe, expect, it } from 'vitest'
import {
  composeBtwTitle,
  describeFailure,
  forkHere,
  lastDurableSeq,
  type BtwEventEntry,
  type BtwRemoteFailure,
  type BtwRemoteResult,
  type BtwSessionsFace,
} from './fork-here'

/** One durable event at a given seq. */
function event(seq: number): BtwEventEntry {
  return { type: 'event', event: { type: 'assistant/message', seq } }
}

/** One in-flight (not yet durable) event at a given seq. */
function transient(seq: number): BtwEventEntry {
  return { type: 'transient', event: { type: 'assistant/live-chunk', seq } }
}

/** The command reply one fake run hands back. */
interface CommandReply {
  readonly ok?: boolean
  readonly matched?: boolean
  readonly error?: BtwRemoteFailure
}

/** What one fake Session service should answer. */
interface FakeOptions {
  readonly entries?: readonly BtwEventEntry[]
  readonly boundaryFailure?: Error
  readonly forkFailure?: Error
  readonly forkResult?: string
  readonly commandReply?: CommandReply
  /** How many times `retain(child)` throws before it succeeds (the list reconcile race). */
  readonly childRetainFailures?: number
  /** The source Session's row title, as the client list snapshot carries it. */
  readonly sourceTitle?: string
}

/**
 * Build the narrow Session service with every call recorded in order.
 * @param options - the failure and reply knobs each test flips.
 * @returns the service plus its call log.
 */
function fakeSessions(options: FakeOptions): {
  readonly sessions: BtwSessionsFace
  readonly calls: string[]
  readonly forkOptions: unknown[]
  readonly commandLines: string[]
  readonly titles: string[]
} {
  const calls: string[] = []
  const forkOptions: unknown[] = []
  const commandLines: string[] = []
  const titles: string[] = []
  let childRetainAttempts = 0

  const sessions: BtwSessionsFace = {
    retain(target) {
      calls.push(`retain:${target}`)
      if (target === 'child' && childRetainAttempts < (options.childRetainFailures ?? 0)) {
        childRetainAttempts += 1
        throw new Error(`sessions.retain: unknown session ${target}`)
      }
      const ready = target === 'parent' && options.boundaryFailure !== undefined
        ? Promise.reject(options.boundaryFailure)
        : Promise.resolve({
          session: {
            async rename(title: string): Promise<BtwRemoteResult<{ readonly title: string; readonly seq: number }>> {
              calls.push(`rename:${target}`)
              titles.push(title)
              return { ok: true, value: { title, seq: 0 } }
            },
            async command(line: string): Promise<BtwRemoteResult<{ readonly matched: boolean }>> {
              calls.push(`command:${target}`)
              commandLines.push(line)
              const reply = options.commandReply ?? { ok: true, matched: true }
              const result: BtwRemoteResult<{ readonly matched: boolean }> = {
                ok: reply.ok ?? true,
                value: { matched: reply.matched ?? true },
                ...reply.error === undefined ? {} : { error: reply.error },
              }
              return result
            },
          },
          eventSource: { getSnapshot: () => ({ entries: options.entries ?? [] }) },
        })
      return {
        sessionId: target,
        ready,
        release() { calls.push(`release:${target}`) },
      }
    },
    async fork(given) {
      calls.push('fork')
      forkOptions.push(given)
      if (options.forkFailure !== undefined) throw options.forkFailure
      return options.forkResult ?? 'child'
    },
    list: {
      getSnapshot: () => ({
        byId: options.sourceTitle === undefined
          ? {}
          : { parent: { title: options.sourceTitle } },
      }),
    },
  }
  return { sessions, calls, forkOptions, commandLines, titles }
}

describe('lastDurableSeq', () => {
  it('keeps the greatest durable seq and ignores in-flight frames', () => {
    expect(lastDurableSeq({ entries: [event(2), transient(9), event(7), transient(11)] })).toBe(7)
  })

  it('answers undefined for an empty window', () => {
    expect(lastDurableSeq({ entries: [] })).toBeUndefined()
  })

  it('ignores entries without a finite seq', () => {
    const broken = { type: 'event', event: { type: 'assistant/message', seq: Number.NaN } } as unknown as BtwEventEntry
    expect(lastDurableSeq({ entries: [event(4), broken] })).toBe(4)
  })
})

describe('describeFailure', () => {
  it('prefers an Error message, then a wire message, then the raw value', () => {
    expect(describeFailure(new Error('boom'))).toBe('boom')
    expect(describeFailure({ message: 'wire', code: 'session/fork-unavailable' })).toBe('wire')
    expect(describeFailure({ code: 'session/not-found' })).toBe('session/not-found')
    expect(describeFailure('plain')).toBe('plain')
  })
})

describe('composeBtwTitle', () => {
  it('appends the marker to a normal title', () => {
    expect(composeBtwTitle('修复登录超时')).toBe('修复登录超时 · BTW')
  })

  it('falls back to the bare marker for an untitled Session', () => {
    expect(composeBtwTitle(undefined)).toBe('BTW')
    expect(composeBtwTitle('   ')).toBe('BTW')
  })

  it('does not stack markers when a btw Session forks again', () => {
    expect(composeBtwTitle('修复登录超时 · BTW')).toBe('修复登录超时 · BTW')
  })
})

describe('forkHere', () => {
  it('forks at the last durable seq, applies read-only, then navigates', async () => {
    const opened: string[] = []
    const { sessions, calls, forkOptions, commandLines } = fakeSessions({
      entries: [event(3), transient(8), event(5)],
    })

    const result = await forkHere({
      sessions,
      openSession: sessionId => { opened.push(sessionId) },
    }, 'parent')

    expect(result).toEqual({ ok: true, childId: 'child', atSeq: 5, readOnly: true })
    expect(forkOptions).toEqual([{ sessionId: 'parent', atSeq: 5 }])
    expect(commandLines).toEqual(['/permission read-only'])
    expect(opened).toEqual(['child'])
    // The user must never land in the child before the read-only switch settled.
    expect(calls.indexOf('fork')).toBeLessThan(calls.indexOf('retain:child'))
    expect(calls.indexOf('retain:child')).toBeLessThan(calls.indexOf('command:child'))
    expect(opened).toHaveLength(1)
  })

  it('falls back to the completed-turn boundary when the live window is empty', async () => {
    const { sessions, forkOptions } = fakeSessions({ entries: [] })

    const result = await forkHere({ sessions, openSession: () => {} }, 'parent')

    expect(result).toMatchObject({ ok: true, atSeq: undefined })
    expect(forkOptions).toEqual([{ sessionId: 'parent' }])
  })

  it('still forks at the completed-turn boundary when the live window cannot be read', async () => {
    const { sessions, forkOptions } = fakeSessions({
      entries: [event(4)],
      boundaryFailure: new Error('history unavailable'),
    })

    const result = await forkHere({ sessions, openSession: () => {} }, 'parent')

    expect(result).toMatchObject({ ok: true, atSeq: undefined })
    expect(forkOptions).toEqual([{ sessionId: 'parent' }])
  })

  it('abandons the child instead of landing in it when the read-only switch fails', async () => {
    const opened: string[] = []
    const discarded: string[] = []
    const { sessions, commandLines } = fakeSessions({
      entries: [event(1)],
      commandReply: { ok: true, matched: false },
    })

    const result = await forkHere({
      sessions,
      openSession: sessionId => { opened.push(sessionId) },
      discard: async (childId) => { discarded.push(childId) },
    }, 'parent')

    expect(result.ok).toBe(false)
    expect(result.ok ? '' : result.message).toContain('只读')
    expect(commandLines).toEqual(['/permission read-only'])
    expect(opened).toEqual([])
    expect(discarded).toEqual(['child'])
  })

  it('retries retaining the fresh child while the client list reconciles', async () => {
    const { sessions, calls } = fakeSessions({ entries: [event(2)], childRetainFailures: 2 })

    const result = await forkHere({ sessions, openSession: () => {} }, 'parent')

    expect(result).toMatchObject({ ok: true, readOnly: true })
    expect(calls.filter(call => call === 'retain:child')).toHaveLength(3)
  })

  it('names the child with the source title plus the btw suffix', async () => {
    const { sessions, titles } = fakeSessions({ entries: [event(1)], sourceTitle: '修复登录超时' })

    const result = await forkHere({ sessions, openSession: () => {} }, 'parent')

    expect(result.ok).toBe(true)
    expect(titles).toEqual(['修复登录超时 · BTW'])
  })

  it('marks the child only after the read-only switch succeeded', async () => {
    const marked: string[] = []
    const { sessions } = fakeSessions({ entries: [event(1)] })

    await forkHere({ sessions, openSession: () => {}, mark: id => { marked.push(id) } }, 'parent')

    expect(marked).toEqual(['child'])
  })

  it('does not mark a child it abandoned', async () => {
    const marked: string[] = []
    const { sessions } = fakeSessions({
      entries: [event(1)],
      commandReply: { ok: true, matched: false },
    })

    await forkHere({
      sessions,
      openSession: () => {},
      discard: () => {},
      mark: id => { marked.push(id) },
    }, 'parent')

    expect(marked).toEqual([])
  })

  it('surfaces a fork failure and never navigates', async () => {
    const opened: string[] = []
    const { sessions } = fakeSessions({
      entries: [event(2)],
      forkFailure: new Error('session/fork-unavailable: event 2 does not exist'),
    })

    const result = await forkHere({
      sessions,
      openSession: sessionId => { opened.push(sessionId) },
    }, 'parent')

    expect(result.ok).toBe(false)
    expect(result.ok ? '' : result.message).toContain('分叉失败')
    expect(result.ok ? '' : result.message).toContain('session/fork-unavailable')
    expect(opened).toEqual([])
  })

  it('uses a configured read-only preset name', async () => {
    const { sessions, commandLines } = fakeSessions({ entries: [event(0)] })

    await forkHere({
      sessions,
      openSession: () => {},
      readOnlyPreset: 'btw-read-only',
    }, 'parent')

    expect(commandLines).toEqual(['/permission btw-read-only'])
  })
})
