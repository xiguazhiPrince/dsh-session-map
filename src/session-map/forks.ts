/**
 * Shared wire contract for the plugin's fork ledger, plus the browser side of
 * it.
 *
 * A current Harness forks each child into an independent seeded Session and
 * keeps no source id anywhere — not in the header, not in an event, not in the
 * `session/created` payload — so no Host signal can name a fork's parent. The
 * call that creates it still names the source, though: both the shipped
 * conversation "fork here" action and this plugin's BTW go through the public
 * client `sessions.fork({ sessionId, atSeq })`. This ledger is the plugin's own
 * observation layer: the browser half wraps that call (`./fork-recorder`),
 * remembers `source -> child` locally, and reports it to the Host route family
 * here, where it is persisted so every tab, restart, and later page shares one
 * authoritative edge set.
 *
 * The ledger never replaces the prefix inference in `./graph`; it is consulted
 * first because an observed fork is exact, and the inference stays as the
 * fallback for forks made before this ledger existed, by another DSH instance,
 * or by a host-internal path that never touches the client service.
 *
 * The read is optional on the Host side too: a composition without the route
 * answers an empty set and the canvas keeps the inferred lineage.
 *
 * @module dsh-session-map/session-map/forks
 */

/** Route family shared by the Host ledger routes and the browser half. */
export const SESSION_FORK_ROUTE = '/plugin-session-forks'

/** On-disk and wire version of the ledger record set. */
export const SESSION_FORK_VERSION = 1

/** One observed fork edge. */
export interface SessionForkRecord {
  readonly childId: string
  readonly parentId: string
  /** The inclusive source event seq the child inherited through, when the caller chose one. */
  readonly atSeq?: number
  /** Host clock time the ledger accepted the edge. */
  readonly recordedAt: number
}

/** Success body of the ledger read. */
export interface SessionForkEnvelope {
  readonly ok: true
  readonly version: typeof SESSION_FORK_VERSION
  readonly forks: readonly SessionForkRecord[]
}

/** One browser report of an observed fork. */
export interface SessionForkRequest {
  readonly childId: string
  readonly parentId: string
  readonly atSeq?: number
}

/**
 * Extract the child -> parent edges from one unknown ledger body.
 *
 * Every field is re-checked: the body is wire data, and a truncated or foreign
 * answer must degrade to "no observed forks" instead of throwing. The last
 * record for a child wins, mirroring the Host's own merge rule.
 * @param value - parsed response body.
 * @returns parent id by child id; empty when the body carries none.
 */
export function forkParentsFromEnvelope(value: unknown): Readonly<Record<string, string>> {
  const envelope: unknown = typeof value === 'object' && value !== null ? value : undefined
  const forks: unknown = envelope === undefined
    ? undefined
    : (envelope as { readonly forks?: unknown }).forks
  if (!Array.isArray(forks)) return {}
  const parents: Record<string, string> = {}
  for (const raw of forks) {
    if (typeof raw !== 'object' || raw === null) continue
    const childId: unknown = (raw as { readonly childId?: unknown }).childId
    const parentId: unknown = (raw as { readonly parentId?: unknown }).parentId
    if (typeof childId !== 'string' || childId === '') continue
    if (typeof parentId !== 'string' || parentId === '' || parentId === childId) continue
    parents[childId] = parentId
  }
  return parents
}

/** Edges this page observed itself; newer than any read and never overwritten by one. */
const observed: Record<string, string> = {}

/** Edges the Host ledger last answered. */
let fetched: Readonly<Record<string, string>> = {}

/** Merged view, rebuilt only after a change. */
let snapshot: Readonly<Record<string, string>> = {}

/** Whether {@link snapshot} predates the latest change. */
let stale = true

/** One in-flight ledger read shared by every mounted canvas. */
let inflight: Promise<void> | undefined

/** Mounted readers to wake after a change. */
const listeners = new Set<() => void>()

/** Rebuild the merged snapshot after a change and wake the mounted readers. */
function changed(): void {
  stale = true
  for (const listener of listeners) {
    try {
      listener()
    } catch {
      // A reader's own render failure is the shell's business, not ours.
    }
  }
}

/**
 * Read the current child -> parent edge map.
 *
 * A locally observed edge wins over the same child in a ledger read: the page
 * that made the fork knows it before the Host round-trip can land.
 * @returns the merged, reference-stable edge map.
 */
export function currentForkParents(): Readonly<Record<string, string>> {
  if (stale) {
    snapshot = Object.freeze({ ...fetched, ...observed })
    stale = false
  }
  return snapshot
}

/**
 * Observe one change in the merged edge map.
 * @param listener - callback run after each change.
 * @returns the unsubscribe function.
 */
export function subscribeSessionForks(listener: () => void): () => void {
  listeners.add(listener)
  return () => { listeners.delete(listener) }
}

/**
 * Remember one edge on this page without waiting for the Host.
 * @param request - the observed fork edge.
 */
export function rememberFork(request: SessionForkRequest): void {
  observed[request.childId] = request.parentId
  changed()
}

/**
 * Report one observed fork: remember it locally and persist it through the
 * Host ledger. Persistence is best-effort; a missing route or a failed request
 * only costs the next page its exact edge, which the inference then recovers.
 * @param request - the observed fork edge.
 */
export function recordFork(request: SessionForkRequest): void {
  // The recorder and a caller that knows its own fork (BTW) can both report the
  // same edge; report it once.
  if (currentForkParents()[request.childId] === request.parentId) return
  rememberFork(request)
  try {
    void fetch(new URL(`${SESSION_FORK_ROUTE}/record`, document.baseURI), {
      method: 'POST',
      headers: { 'content-type': 'application/json', accept: 'application/json' },
      body: JSON.stringify(request),
    }).catch(() => {
      // The local edge already guides this page; the Host ledger retries on the
      // next observed fork that reaches it.
    })
  } catch {
    // Not a browser, or no base URI: the observation still guides this page.
  }
}

/**
 * Read the Host ledger and merge it into the page's edge map.
 *
 * Concurrent callers share one request. A failure leaves the previous edges in
 * place, so a transient Host restart never clears what the page already knows.
 * @returns completion of the read.
 */
export function refreshSessionForks(): Promise<void> {
  if (inflight !== undefined) return inflight
  const request = (async (): Promise<void> => {
    try {
      const response = await fetch(new URL(`${SESSION_FORK_ROUTE}/state`, document.baseURI), {
        method: 'GET',
        headers: { accept: 'application/json' },
      })
      if (!response.ok) return
      fetched = forkParentsFromEnvelope(await response.json())
      changed()
    } catch {
      // Keep the previous edges; the canvas falls back to inference for the rest.
    } finally {
      inflight = undefined
    }
  })()
  inflight = request
  return request
}

/** Drop the page state; a test or a manual reset can start over. */
export function resetSessionForks(): void {
  for (const key of Object.keys(observed)) delete observed[key]
  fetched = {}
  snapshot = {}
  stale = true
  inflight = undefined
  changed()
}
