import { describe, expect, it } from 'vitest'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  EMPTY_POLICY,
  parsePolicy,
  permissionOf,
  policyPath,
  readPolicy,
  summarize,
  updateServerPolicy,
  writePolicy,
} from './policy'

describe('parsePolicy', () => {
  it('treats unreadable text as "nothing is gated"', () => {
    expect(parsePolicy('not json')).toEqual(EMPTY_POLICY)
    expect(parsePolicy('[]')).toEqual(EMPTY_POLICY)
    expect(parsePolicy('{"servers": 3}')).toEqual(EMPTY_POLICY)
  })

  it('defaults a missing or bogus fallback to deny', () => {
    expect(parsePolicy('{"servers":{"a":{"tools":{}}}}')).toEqual({
      version: 1,
      servers: { a: { fallback: 'deny', tools: {} } },
    })
    expect(parsePolicy('{"servers":{"a":{"fallback":"nope"}}}').servers.a?.fallback).toBe('deny')
  })

  it('drops answers that are not one of the three', () => {
    const parsed = parsePolicy('{"servers":{"a":{"fallback":"ask","tools":{"t1":"yes","t2":"allow"}}}}')
    expect(parsed.servers.a).toEqual({ fallback: 'ask', tools: { t2: 'allow' } })
  })
})

describe('permissionOf', () => {
  const policy = {
    version: 1,
    servers: { yunxiao: { fallback: 'deny' as const, tools: { list: 'allow' as const } } },
  }

  it('prefers the explicit answer', () => {
    expect(permissionOf(policy, 'yunxiao', 'list')).toBe('allow')
  })

  it('falls back for a tool nobody named', () => {
    expect(permissionOf(policy, 'yunxiao', 'merge')).toBe('deny')
  })

  it('answers undefined for a server that is not gated at all', () => {
    expect(permissionOf(policy, 'github', 'anything')).toBeUndefined()
  })
})

describe('summarize', () => {
  it('counts named answers separately from inherited ones', () => {
    const entry = {
      fallback: 'deny' as const,
      tools: { a: 'allow' as const, b: 'ask' as const, c: 'deny' as const },
    }
    expect(summarize(['a', 'b', 'c', 'd', 'e'], entry)).toEqual({
      allow: 1,
      ask: 1,
      deny: 1,
      unnamed: 2,
    })
  })

  it('reports nothing for an ungated server', () => {
    expect(summarize(['a'], undefined)).toEqual({ allow: 0, ask: 0, deny: 0, unnamed: 0 })
  })
})

describe('policy storage', () => {
  it('round-trips and merges one server edit without touching the others', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'dsh-mcp-policy-'))
    try {
      await writePolicy(dir, {
        version: 1,
        servers: {
          first: { fallback: 'deny', tools: { read: 'allow' } },
          second: { fallback: 'allow', tools: {} },
        },
      })

      const next = await updateServerPolicy(dir, 'first', current => ({
        fallback: current.fallback,
        tools: { ...current.tools, write: 'ask' },
      }))

      expect(next.servers.first?.tools).toEqual({ read: 'allow', write: 'ask' })
      expect(next.servers.second).toEqual({ fallback: 'allow', tools: {} })
      expect(await readPolicy(dir)).toEqual(next)
      expect(policyPath(dir)).toBe(join(dir, 'mcp-tool-policy.json'))
      expect((await readFile(policyPath(dir), 'utf8')).endsWith('\n')).toBe(true)
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  it('reads a missing file as the empty policy', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'dsh-mcp-policy-'))
    try {
      expect(await readPolicy(dir)).toEqual(EMPTY_POLICY)
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  it('creates a server entry from nothing without hiding its other tools', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'dsh-mcp-policy-'))
    try {
      const next = await updateServerPolicy(dir, 'fresh', current => ({
        fallback: current.fallback,
        tools: { ...current.tools, one: 'ask' },
      }))
      // Open by default: touching one tool must not silently deny the rest.
      expect(next.servers.fresh).toEqual({ fallback: 'allow', tools: { one: 'ask' } })
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })
})
