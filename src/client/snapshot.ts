/**
 * The one React subscription helper the browser half uses.
 *
 * Two surfaces render from plain `getSnapshot`/`subscribe` stores the product
 * hands out — the settings page reads the describe mirror and one namespace form,
 * the composer's ACP notice reads the same two plus the code-tools preference.
 * None of those is a React store, so each surface needs the same bridge; keeping
 * it in one place means the two cannot drift on when they re-read.
 *
 * @module dsh-session-map/client/snapshot
 */
import { useEffect, useState } from 'react'

/** A synchronous store a component can render from. */
export interface SnapshotSource<T> {
  /** @returns the current value. */
  getSnapshot(): T
  /**
   * @param listener - invoked after each change.
   * @returns the disposer removing this listener.
   */
  subscribe(listener: () => void): () => void
}

/**
 * Subscribe one component to a snapshot source.
 * @param source - the store.
 * @returns the current snapshot, re-rendering on change.
 */
export function useSnapshot<T>(source: SnapshotSource<T>): T {
  const [snapshot, setSnapshot] = useState(() => source.getSnapshot())
  useEffect(() => {
    setSnapshot(() => source.getSnapshot())
    return source.subscribe(() => { setSnapshot(() => source.getSnapshot()) })
  }, [source])
  return snapshot
}
