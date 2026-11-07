/**
 * Shared wire contract for the fork-lineage seed read, plus the browser read.
 *
 * A current Harness forks each child into an independent seeded Session and
 * records no parent Session, so the canvas recovers a family from the turn
 * prefix a child copied. That prefix match is symmetric; the only datum that
 * tells a source from its children is the seed metadata the Host already holds:
 * the child was created after the Session it was cut from. The Host half
 * (`./host-lineage`) answers that metadata for every listed Session, and this
 * module owns its route, its wire shape, and the page-lifetime read.
 *
 * The read is optional on both sides: a composition without the Host route, or
 * a page whose request fails, answers an empty map and the canvas keeps the
 * direction-free trunk choice. That is also what older Harness builds get, so
 * nothing here can break a map that worked before.
 *
 * @module dsh-session-map/session-map/lineage
 */

/** Route family shared by the Host half and this browser read. */
export const SESSION_LINEAGE_ROUTE = '/plugin-session-lineage'

/** One listed Session's seed metadata, as the Host publishes it. */
export interface SessionLineageRow {
  readonly id: string
  /** Session creation time in epoch milliseconds; a source predates its fork. */
  readonly createdAt: number
  /** `SessionHeader.isSeeded`: whether the Session carries a fork-inherited prefix. */
  readonly isSeeded: boolean
}

/** Success body of the seed read. */
export interface SessionLineageEnvelope {
  readonly ok: true
  readonly sessions: readonly SessionLineageRow[]
}

/**
 * Extract `createdAt` values from one unknown route body.
 *
 * Every field is re-checked: the response is wire data, and a truncated or
 * foreign body must degrade to "no direction data" instead of throwing.
 * @param value - parsed response body.
 * @returns creation times by Session id; empty when the body carries none.
 */
export function createdAtFromLineage(value: unknown): Readonly<Record<string, number>> {
  const envelope: unknown = typeof value === 'object' && value !== null ? value : undefined
  const sessions: unknown = envelope === undefined
    ? undefined
    : (envelope as { readonly sessions?: unknown }).sessions
  if (!Array.isArray(sessions)) return {}
  const createdAt: Record<string, number> = {}
  for (const raw of sessions) {
    if (typeof raw !== 'object' || raw === null) continue
    const id: unknown = (raw as { readonly id?: unknown }).id
    const time: unknown = (raw as { readonly createdAt?: unknown }).createdAt
    if (typeof id !== 'string' || id === '' || typeof time !== 'number' || !Number.isFinite(time)) continue
    createdAt[id] = time
  }
  return createdAt
}

/** Successful read kept for the life of the page; a failure is not cached. */
let loaded: Readonly<Record<string, number>> | undefined

/** One in-flight read shared by every mounted canvas. */
let inflight: Promise<Readonly<Record<string, number>>> | undefined

/**
 * Read the seed metadata of every listed Session, once per page.
 *
 * The canvas recovers a trunk only while this data is present, so a missing
 * route, an old Host, or a transport failure resolves to an empty map and lets
 * the direction-free path run. A successful answer is cached because session
 * creation times never change; a failure stays uncached so the next canvas that
 * mounts retries.
 * @returns creation times by Session id, or an empty map when unavailable.
 */
export function loadSessionCreatedAt(): Promise<Readonly<Record<string, number>>> {
  if (loaded !== undefined) return Promise.resolve(loaded)
  if (inflight !== undefined) return inflight
  const request = (async (): Promise<Readonly<Record<string, number>>> => {
    try {
      const response = await fetch(new URL(`${SESSION_LINEAGE_ROUTE}/state`, document.baseURI), {
        method: 'GET',
        headers: { accept: 'application/json' },
      })
      if (!response.ok) return {}
      const createdAt = createdAtFromLineage(await response.json())
      if (Object.keys(createdAt).length > 0) loaded = createdAt
      return createdAt
    } catch {
      // The Host half is absent, the page is offline, or the request was cut
      // short: the canvas keeps its direction-free trunk.
      return {}
    } finally {
      inflight = undefined
    }
  })()
  inflight = request
  return request
}

/** Drop the page-lifetime read; a test or a manual refresh can ask again. */
export function resetSessionLineage(): void {
  loaded = undefined
  inflight = undefined
}
