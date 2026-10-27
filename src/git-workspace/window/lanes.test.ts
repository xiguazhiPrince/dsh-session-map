/**
 * Client-side graph tests: lane continuity across merges and missing parents.
 * @module dsh-session-map/git-workspace/window/lanes.test
 */
import { describe, expect, it } from 'vitest'
import type { CommitRow } from '../git-types'
import { computeGraph, laneColour, LANE_COLOURS } from './lanes'

/** Build one commit row with only the fields lanes read. */
function row(oid: string, parents: readonly string[]): CommitRow {
  return {
    oid,
    shortOid: oid.slice(0, 7),
    parents,
    author: { name: 'A', email: 'a@example.com', date: '2026-10-27T00:00:00+08:00' },
    committer: { name: 'A', email: 'a@example.com', date: '2026-10-27T00:00:00+08:00' },
    subject: oid,
    decorations: [],
    refs: { branches: [], remoteBranches: [], tags: [] },
  }
}

describe('computeGraph', () => {
  it('draws a linear history in one lane', () => {
    const rows = computeGraph([row('c', ['b']), row('b', ['a']), row('a', [])])
    expect(rows.map(entry => entry.lane)).toEqual([0, 0, 0])
    expect(rows[0]?.before).toEqual([])
    expect(rows[1]?.before).toEqual(['b'])
    expect(rows[2]?.after).toEqual([])
  })

  it('opens a second lane for a merge parent', () => {
    const rows = computeGraph([
      row('m', ['a', 'b']),
      row('a', ['root']),
      row('b', ['root']),
      row('root', []),
    ])
    expect(rows[0]?.merged).toBe(true)
    expect(rows[0]?.after).toEqual(['a', 'b'])
    expect(rows[1]?.lane).toBe(0)
    expect(rows[2]?.lane).toBe(1)
    expect(rows[3]?.lane).toBe(0)
  })

  it('keeps a lane when a parent was already seen', () => {
    const rows = computeGraph([
      row('m', ['a', 'a']),
      row('a', []),
    ])
    expect(rows[0]?.after).toEqual(['a'])
    expect(rows[1]?.lane).toBe(0)
  })

  it('handles pages that start mid-history', () => {
    const rows = computeGraph([row('x', ['y'])])
    expect(rows[0]?.lane).toBe(0)
    expect(rows[0]?.before).toEqual([])
  })

  it('keeps lane colours in range', () => {
    for (const lane of [-2, 0, 3, LANE_COLOURS, LANE_COLOURS + 2]) {
      expect(laneColour(lane)).toBeGreaterThanOrEqual(0)
      expect(laneColour(lane)).toBeLessThan(LANE_COLOURS)
    }
  })
})
