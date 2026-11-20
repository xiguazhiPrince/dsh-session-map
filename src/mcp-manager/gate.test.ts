import { describe, expect, it } from 'vitest'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { Context } from '@deepseek-ai/cordis'
import { installMcpToolGate, reloadGatePolicy } from './gate'
import { writePolicy } from './policy'

/**
 * Minimal stand-ins for the pieces the gate touches.
 *
 * The one behaviour that matters here is the reason this test exists: a real
 * `tools.restrict()` emits `tools/change` SYNCHRONOUSLY, from inside the call.
 * A gate that reacts by restricting again re-enters itself forever, which is
 * what froze the Host.
 */
function harness(toolNames: readonly string[]) {
  const listeners = new Map<string, Array<(...args: unknown[]) => unknown>>()
  const calls: string[][] = []

  const emit = (name: string, ...args: unknown[]): void => {
    for (const listener of listeners.get(name) ?? []) listener(...args)
  }
  const on = (name: string, listener: (...args: unknown[]) => unknown): (() => void) => {
    const list = listeners.get(name) ?? []
    list.push(listener)
    listeners.set(name, list)
    return () => undefined
  }

  const service = {
    definitions: () => toolNames.map(name => ({ name })),
    restrict: (filter: { readonly deny?: readonly string[] }) => {
      calls.push([...(filter.deny ?? [])])
      // The real registry notifies from inside the restriction swap.
      emit('tools/change')
      return (): void => { emit('tools/change') }
    },
    guard: () => (): void => undefined,
  }

  const agent = { ctx: { get: (name: string) => (name === 'tools' ? service : undefined) } }
  const agents = { list: () => [agent] }
  const scope = {
    get: (name: string) => (name === 'tools' ? service : name === 'agents' ? agents : undefined),
    on,
    inject: (_deps: readonly string[], callback: (inner: unknown) => void) => { callback(scope) },
    effect: (callback: () => unknown) => { callback() },
  }
  return { calls, scope, emit }
}

describe('installMcpToolGate', () => {
  it('does not re-enter itself when restrict() emits tools/change synchronously', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'dsh-mcp-gate-'))
    try {
      await writePolicy(dir, {
        version: 1,
        servers: { srv: { fallback: 'deny', tools: { a: 'allow' } } },
      })
      // Load the policy first, so the install below sees a non-empty deny list
      // and therefore actually calls restrict().
      await reloadGatePolicy(dir)

      const { calls, scope } = harness(['mcp__srv__a', 'mcp__srv__b'])
      installMcpToolGate(scope as unknown as Context, dir)

      // Three passes at most: the initial apply, the change it caused, and the
      // change from replacing the previous entry. A fourth means re-entry.
      expect(calls.length).toBeGreaterThan(0)
      expect(calls.length).toBeLessThanOrEqual(3)
      expect(calls[0]).toEqual(['mcp__srv__b'])
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  it('hides a tool the policy never named, not only the ones written down', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'dsh-mcp-gate-'))
    try {
      await writePolicy(dir, {
        version: 1,
        servers: { srv: { fallback: 'deny', tools: { a: 'allow' } } },
      })
      await reloadGatePolicy(dir)

      const { calls, scope } = harness(['mcp__srv__a', 'mcp__srv__b', 'mcp__other__c'])
      installMcpToolGate(scope as unknown as Context, dir)

      // `b` is unnamed and therefore denied; `other` is not gated at all and
      // must stay untouched.
      expect(calls[0]).toEqual(['mcp__srv__b'])
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  it('hides exactly the denied tools when everything else is allowed', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'dsh-mcp-gate-'))
    try {
      await writePolicy(dir, {
        version: 1,
        servers: {
          srv: {
            fallback: 'allow',
            tools: { a: 'allow', b: 'allow', c: 'deny', d: 'ask' },
          },
        },
      })
      await reloadGatePolicy(dir)

      const { calls, scope } = harness([
        'mcp__srv__a',
        'mcp__srv__b',
        'mcp__srv__c',
        'mcp__srv__d',
      ])
      installMcpToolGate(scope as unknown as Context, dir)

      // Only `c` is hidden. `ask` stays visible on purpose: it is how the
      // model gets to raise its hand.
      expect(calls[0]).toEqual(['mcp__srv__c'])
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  it('leaves a profile with no policy completely alone', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'dsh-mcp-gate-'))
    try {
      await reloadGatePolicy(dir)
      const { calls, scope } = harness(['mcp__srv__a'])
      installMcpToolGate(scope as unknown as Context, dir)
      expect(calls).toEqual([])
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })
})
