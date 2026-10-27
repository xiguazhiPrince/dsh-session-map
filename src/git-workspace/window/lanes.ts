/**
 * Client-side commit graph lanes.
 *
 * The Host deliberately does not pass `git log --graph`: its ASCII art depends
 * on the terminal width and cannot survive pagination. The panel computes lanes
 * from `%P` instead, and this module is the pure part of that.
 *
 * @module dsh-session-map/git-workspace/window/lanes
 */
import type { CommitRow } from '../git-types'

/** One rendered row: the commit's lane plus the lanes alive before and after it. */
export interface GraphRow {
  readonly oid: string
  readonly lane: number
  /** Lanes alive before this row, by expected commit hash. */
  readonly before: readonly string[]
  /** Lanes alive after this row. */
  readonly after: readonly string[]
  /** Merge parents that spawn a new lane on this row. */
  readonly merged: boolean
}

/** Number of distinct lane colours the stylesheet defines. */
export const LANE_COLOURS = 8

/**
 * Assign one lane per commit.
 *
 * The input is expected in git order (children before parents). Each row keeps
 * the active lane vector so the renderer can draw continuous vertical lines.
 * @param commits - one page of commits.
 * @returns one graph row per commit.
 */
export function computeGraph(commits: readonly CommitRow[]): readonly GraphRow[] {
  const lanes: string[] = []
  const rows: GraphRow[] = []
  for (const commit of commits) {
    const before = lanes.slice()
    let lane = lanes.indexOf(commit.oid)
    if (lane < 0) {
      lanes.push(commit.oid)
      lane = lanes.length - 1
    }
    const firstParent = commit.parents[0]
    if (firstParent !== undefined) lanes[lane] = firstParent
    else lanes.splice(lane, 1)

    // A merge adds one lane per extra parent. Positions after the current lane
    // shift when the commit lane was removed, so insert them right after it.
    let merged = false
    for (const parent of commit.parents.slice(1)) {
      merged = true
      if (!lanes.includes(parent)) lanes.splice(lane + 1, 0, parent)
    }
    rows.push({
      oid: commit.oid,
      lane: Math.max(0, lane),
      before,
      after: lanes.slice(),
      merged,
    })
  }
  return rows
}

/**
 * Colour index for one lane.
 * @param lane - zero-based lane.
 * @returns the palette index.
 */
export function laneColour(lane: number): number {
  return ((lane % LANE_COLOURS) + LANE_COLOURS) % LANE_COLOURS
}
