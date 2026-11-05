/**
 * Marker-store tests: remembering a btw fork across reloads, keeping the
 * persisted list bounded and well-formed, and notifying the row marks.
 *
 * @module dsh-session-map/btw/markers.test
 */
import { describe, expect, it, vi } from 'vitest'
import {
  BTW_MARKERS_KEY,
  createBtwMarkers,
  type BtwMarkerStorage,
} from './markers'

/**
 * Build a Map-backed storage double.
 * @param initial - raw value already stored under the marker key.
 * @returns the storage plus its backing map.
 */
function fakeStorage(initial?: string): BtwMarkerStorage & { readonly data: Map<string, string> } {
  const data = new Map<string, string>()
  if (initial !== undefined) data.set(BTW_MARKERS_KEY, initial)
  return {
    data,
    getItem: key => data.get(key) ?? null,
    setItem: (key, value) => { data.set(key, value) },
  }
}

describe('createBtwMarkers', () => {
  it('remembers an id and persists it', () => {
    const storage = fakeStorage()
    const markers = createBtwMarkers(storage)

    expect(markers.has('child')).toBe(false)
    markers.add('child')

    expect(markers.has('child')).toBe(true)
    expect(JSON.parse(storage.data.get(BTW_MARKERS_KEY) ?? '[]')).toEqual(['child'])
  })

  it('reads remembered ids back after a reload', () => {
    const storage = fakeStorage(JSON.stringify(['old-child']))
    const markers = createBtwMarkers(storage)

    expect(markers.has('old-child')).toBe(true)
  })

  it('ignores malformed stored values', () => {
    const notJson = createBtwMarkers(fakeStorage('not json'))
    expect(notJson.has('anything')).toBe(false)

    const notAnArray = createBtwMarkers(fakeStorage('{"child":true}'))
    expect(notAnArray.has('child')).toBe(false)

    const mixed = createBtwMarkers(fakeStorage('["good",42,null]'))
    expect(mixed.has('good')).toBe(true)
  })

  it('notifies subscribers once per newly added id', () => {
    const markers = createBtwMarkers(fakeStorage())
    const listener = vi.fn()
    const unsubscribe = markers.subscribe(listener)

    markers.add('child')
    markers.add('child')
    expect(listener).toHaveBeenCalledTimes(1)

    unsubscribe()
    markers.add('other')
    expect(listener).toHaveBeenCalledTimes(1)
  })

  it('keeps working without storage', () => {
    const markers = createBtwMarkers(undefined)

    markers.add('child')

    expect(markers.has('child')).toBe(true)
  })
})
