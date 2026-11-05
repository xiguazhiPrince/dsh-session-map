/**
 * Which Sessions were created by the composer's `btw` action.
 *
 * The Session list row needs a cheap "is this a btw fork?" answer for every row
 * it draws, including rows loaded long after the fork. The durable title suffix
 * (`… · BTW`) answers the same question in text, but the marker is a browser
 * preference: it is written once per fork and survives the reloads where the
 * plugin itself is re-created, without another Host read per row.
 *
 * The store is deliberately tiny: a set of ids, persisted as a bounded array in
 * `localStorage`, plus the subscription the row mark uses to re-render after a
 * fork. Unreadable storage (private mode, blocked site data) degrades to an
 * in-memory set — the mark then lives for the current page only, which is the
 * same lifetime the fork itself needs.
 *
 * @module dsh-session-map/btw/markers
 */

/** The subset of `localStorage` this store uses, so tests can pass a fake. */
export interface BtwMarkerStorage {
  getItem(key: string): string | null
  setItem(key: string, value: string): void
}

/** The marker store the row mark and the fork flow share. */
export interface BtwMarkersFace {
  /**
   * Whether one Session was created by the btw action.
   * @param sessionId - the Session to test.
   * @returns true for a remembered btw fork.
   */
  has(sessionId: string): boolean
  /**
   * Remember one btw fork and notify the row marks.
   * @param sessionId - the freshly created child Session.
   */
  add(sessionId: string): void
  /**
   * Observe marker changes.
   * @param listener - called after an add.
   * @returns unsubscribe callback.
   */
  subscribe(listener: () => void): () => void
}

/** Browser-preference key holding the remembered Session ids. */
export const BTW_MARKERS_KEY = 'dsh.session-map.btw-sessions'

/** How many remembered ids are kept; older ones are dropped on persist. */
const MARKER_LIMIT = 500

/**
 * Resolve the browser's `localStorage`, or `undefined` where access throws.
 * @returns the usable storage, if any.
 */
export function btwMarkerStorage(): BtwMarkerStorage | undefined {
  try {
    if (typeof localStorage === 'undefined') return undefined
    return localStorage
  } catch {
    return undefined
  }
}

/**
 * Read the persisted id list, ignoring anything malformed.
 * @param storage - the preference storage, if any.
 * @returns the remembered ids in insertion order.
 */
function readStored(storage: BtwMarkerStorage | undefined): readonly string[] {
  if (storage === undefined) return []
  try {
    const raw = storage.getItem(BTW_MARKERS_KEY)
    if (raw === null) return []
    const parsed: unknown = JSON.parse(raw)
    if (!Array.isArray(parsed)) return []
    return parsed.filter((item): item is string => typeof item === 'string')
  } catch {
    return []
  }
}

/**
 * Build the marker store over one preference storage.
 * @param storage - where to persist ids; `undefined` keeps memory only.
 * @returns the store.
 */
export function createBtwMarkers(storage: BtwMarkerStorage | undefined): BtwMarkersFace {
  const ids = new Set<string>(readStored(storage))
  const listeners = new Set<() => void>()

  const persist = (): void => {
    if (storage === undefined) return
    try {
      storage.setItem(BTW_MARKERS_KEY, JSON.stringify([...ids].slice(-MARKER_LIMIT)))
    } catch {
      // A full or denied storage only costs the reload-persistence; the
      // in-memory set still marks the row for this page.
    }
  }

  return {
    has: sessionId => ids.has(sessionId),
    add: (sessionId) => {
      if (ids.has(sessionId)) return
      ids.add(sessionId)
      persist()
      for (const listener of [...listeners]) listener()
    },
    subscribe: (listener) => {
      listeners.add(listener)
      return () => { listeners.delete(listener) }
    },
  }
}
