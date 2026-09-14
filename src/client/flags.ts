/**
 * Plugin-run flags: state that outlives one mounted View.
 *
 * Both seats (the Conversation tab and the right column's tab) are
 * session-scoped, so switching Session unmounts the View and would re-run a
 * `React.useState` initializer. A flag lives on the plugin run instead, and its
 * subscription keeps two simultaneously mounted instances in step.
 *
 * @module dsh-session-map/client/flags
 */
import * as React from 'react'

/** One piece of plugin-run state plus the subscription that mirrors it into React. */
export interface Flag<T> {
  /**
   * Read the current value.
   * @returns the value as of this call.
   */
  get(): T
  /**
   * Replace the value, notifying every subscriber when it actually moved.
   * @param next - the new value.
   */
  set(next: T): void
  /**
   * Observe later changes.
   * @param listener - called after each accepted change.
   * @returns unsubscribe callback.
   */
  subscribe(listener: () => void): () => void
}

/**
 * A flag that belongs to the plugin run, not to one mounted View.
 * @param initial - value before the first change.
 * @returns getter, setter, and subscribe.
 */
export function createFlag<T>(initial: T): Flag<T> {
  let value = initial
  const listeners = new Set<() => void>()
  return {
    get: () => value,
    set: (next) => {
      if (next === value) return
      value = next
      for (const listener of [...listeners]) listener()
    },
    subscribe: (listener) => {
      listeners.add(listener)
      return () => { listeners.delete(listener) }
    },
  }
}

/**
 * Read one plugin-run flag as component state.
 * @param flag - the flag created in the plugin body.
 * @returns current value and a setter.
 */
export function useFlag<T>(flag: Flag<T>): readonly [T, (next: T) => void] {
  const [value, setValue] = React.useState(flag.get())
  React.useEffect(() => flag.subscribe(() => { setValue(flag.get()) }), [])
  return [value, (next: T) => { flag.set(next) }]
}

/**
 * Copy a Set with one id added or removed.
 * @param set - the set to copy.
 * @param id - the member to add or remove.
 * @param present - whether the member belongs in the copy.
 * @returns a new set; the input is left alone.
 */
export function withMember<T>(set: ReadonlySet<T>, id: T, present: boolean): Set<T> {
  const next = new Set(set)
  if (present) next.add(id)
  else next.delete(id)
  return next
}
