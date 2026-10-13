/**
 * Model scope: which providers one Session's model card may offer.
 *
 * An ACP Session belongs to an agent, but the product's model card offers every
 * registered provider to every Session — the catalog it reads is global by
 * construction, and there is no per-Session filter in the product (the measured
 * evidence is in `docs/p10-acp-model-scope.md`). This module closes that gap
 * **without touching the card**: it wraps the one per-Session data entry both
 * model pickers share, `modelDirectories.directoryFor(sessionId)`, and scopes the
 * list that comes back.
 *
 * It also settles the disagreement that gap exposes. A preset card cannot write
 * the Session's model selection (`PresetDefinition` has no model, and the
 * selection is installed before the preset mounts), so a card Session routes to
 * its agent while the composer still shows the profile default. The same wrapper
 * therefore keeps the stored selection in step with the preset — onto the agent
 * when the Session is composed with one, and back off it when the Session leaves,
 * which is the direction a half-measure would miss.
 *
 * Three properties are what make wrapping someone else's method acceptable here:
 *
 * - **Fail-open.** Any shape this module does not recognize — no service, no
 *   `directoryFor`, a directory whose store is unreadable — returns the original
 *   value untouched. The worst outcome of a product change is that the scope
 *   stops applying, never that the composer breaks.
 * - **Reversible.** The patch is a single property assignment, undone by the
 *   disposer the plugin fiber owns.
 * - **uSES-safe.** The card reads through `useSyncExternalStore`, which requires
 *   an unchanged snapshot to be the *same object* or React re-renders forever.
 *   The scope therefore memoizes on (underlying snapshot, mode, agent) and hands
 *   back the previous object whenever the scoped list did not change.
 *
 * The filter is pure and the installer takes its collaborators as arguments, both
 * so the Node suite can drive the whole thing without a DOM or a Host.
 *
 * @module dsh-session-map/client/model-scope
 */

/** The provider route this package's agents are models of. */
export const ACP_PROVIDER = 'acp'

/** The preset-id prefix this package's cards use: `acp-<agent>`. */
export const ACP_PRESET_PREFIX = 'acp-'

/**
 * Separates an agent from one of the models it advertised.
 *
 * Spelled here rather than imported: the browser half must not pull the Host
 * half's graph into its bundle, and the canonical definition is
 * `src/acp-agent/model-id.ts` — the two must agree on this one string.
 */
export const MODEL_ID_SEPARATOR = '::'

/** The browser-local preference holding the mode. */
export const MODEL_SCOPE_KEY = 'dsh.session-map.acpModelScope'

/**
 * How a Session's model card is scoped to its agent.
 *
 * `scoped` is the shipped mode and the decision this phase implements: an ACP
 * Session offers only its own provider, and every other Session offers no ACP
 * entry at all — which is what retires "pick ACP like any other model". `pinned`
 * keeps the first half only (an ACP Session is scoped, others are untouched), and
 * `off` restores the unfiltered catalog.
 */
export type ModelScopeMode = 'off' | 'scoped' | 'pinned'

/** The shipped mode. */
export const DEFAULT_MODEL_SCOPE: ModelScopeMode = 'scoped'

/**
 * A value no projection can equal, so a Session's first read always settles as a
 * fresh preset value rather than as a repeat of an absent one.
 */
const UNSETTLED = Symbol('unsettled')

/** What one Session's preset projection says about its agent. */
export type SessionAgent = 'acp' | 'other' | 'unknown'

/** One provider group, as far as this module reads it. */
export interface ModelGroupLike {
  readonly id?: unknown
  readonly models?: unknown
}

/** One directory snapshot, as far as this module reads it. */
export interface ModelSnapshotLike {
  readonly groups?: readonly ModelGroupLike[]
}

/** The observable shape a directory store and a projection face both have. */
export interface ObservableLike<T> {
  getSnapshot(): T
  subscribe(listener: () => void): () => void
}

/** One Session's agent-preset projection. */
export type PresetFace = ObservableLike<unknown>

/** The client service that owns one model directory per Session. */
export interface ModelDirectoriesLike {
  directoryFor(sessionId: string): unknown
}

/** What the installer needs from the client runtime. */
export interface ModelScopeHost {
  /** The service owning the per-Session directories. */
  readonly models: ModelDirectoriesLike
  /**
   * One Session's preset projection, or `undefined` while the Session is not
   * retained (or the composition carries no preset projection at all). The
   * difference matters: an absent face means "cannot tell", an absent *value*
   * means "this Session has no ACP preset".
   */
  readonly presetFaceOf?: (sessionId: string) => PresetFace | undefined
  /**
   * Writes one Session's model selection — the same Remote the shipped picker
   * calls when a person chooses a model. Absent when the runtime does not expose
   * it, in which case the reconciliation below simply does not happen.
   */
  readonly selectModel?: (request: { sessionId: string; provider: string; model: string }) => unknown
}

/** What the installer needs from the plugin. */
export interface ModelScopeControls {
  /**
   * The mode in force, read at every decision rather than captured, so a
   * preference change applies to the next read without reinstalling anything.
   */
  readonly mode: () => ModelScopeMode
  /** Reports an unexpected shape once. Never fatal; the caller keeps working. */
  readonly warn?: (message: string, detail: unknown) => void
}

/**
 * @param preset - a Session's projected preset id.
 * @returns true when it names one of this package's agent cards.
 */
export function isAcpPreset(preset: unknown): boolean {
  return typeof preset === 'string' && preset.startsWith(ACP_PRESET_PREFIX)
}

/**
 * The agent one of this package's preset ids names.
 *
 * A preset card does not — and cannot — write a model selection: `PresetDefinition`
 * carries no model, and the Session's own selection is installed before the preset
 * is mounted (P0). So a Session started from a card routes to its agent while its
 * *stored* selection is still whatever the profile default was, and the composer
 * legitimately disagrees with the traffic. This is the value the reconciliation
 * below needs to end that disagreement.
 * @param preset - the Session's projected preset id.
 * @returns the agent name, or `undefined` when the value is not one of our cards.
 */
export function agentFromPresetId(preset: unknown): string | undefined {
  if (!isAcpPreset(preset)) return undefined
  const agent = (preset as string).slice(ACP_PRESET_PREFIX.length)
  return agent === '' ? undefined : agent
}

/**
 * Whether a Session's stored selection has to be pulled onto its agent.
 *
 * Conservative in both directions: a selection that cannot be read yet (`null`,
 * or a shape this module does not know) is *not* a reason to write, and a
 * selection already naming this agent — `cursor` or `cursor::<one of its models>`
 * — is left exactly as the user left it.
 * @param selection - the projected model selection (`{provider, model}`).
 * @param agent - the agent the Session's preset names, when it names one.
 * @returns true only when the Session is ours and its selection points elsewhere.
 */
export function needsAgentSelection(selection: unknown, agent: string | undefined): boolean {
  if (agent === undefined) return false
  if (selection === null || typeof selection !== 'object') return false
  const record = selection as { provider?: unknown; model?: unknown }
  if (record.provider !== ACP_PROVIDER) return true
  if (typeof record.model !== 'string') return true
  return record.model !== agent && !record.model.startsWith(`${agent}${MODEL_ID_SEPARATOR}`)
}

/** One provider/model pair this module is willing to write. */
export interface ModelSelectionLike {
  readonly provider: string
  readonly model: string
}

/** What the reconciliation should do about one Session's selection. */
export type ReconcilePlan =
  /** Nothing usable to compare yet (or no target to move to): decide again later. */
  | { readonly kind: 'idle' }
  /** This preset value is settled; the selection already agrees with it. */
  | { readonly kind: 'none' }
  /** Write this selection, and remember what it replaced. */
  | {
    readonly kind: 'move'
    readonly provider: string
    readonly model: string
    readonly remember?: ModelSelectionLike
  }

/**
 * A selection, when the value is one this module is willing to write back.
 * @param value - the projected selection, or a remembered one.
 * @returns `{provider, model}`, or `undefined` when it is not usable.
 */
function asSelection(value: unknown): ModelSelectionLike | undefined {
  if (value === null || typeof value !== 'object') return undefined
  const record = value as { provider?: unknown; model?: unknown }
  if (typeof record.provider !== 'string' || typeof record.model !== 'string') return undefined
  return { provider: record.provider, model: record.model }
}

/**
 * The first model of the first provider that is not ours.
 *
 * The fallback when a Session has to leave an agent and there is no memory of
 * what it used before — a profile whose *default* is an ACP model, for instance.
 * @param groups - the catalog's provider groups.
 * @returns the selection, or `undefined` when no other provider offers one yet.
 */
function firstForeignSelection(groups: unknown): ModelSelectionLike | undefined {
  if (!Array.isArray(groups)) return undefined
  for (const group of groups) {
    if (group === null || typeof group !== 'object') continue
    const record = group as { id?: unknown; models?: unknown }
    if (record.id === ACP_PROVIDER || typeof record.id !== 'string') continue
    if (!Array.isArray(record.models)) continue
    for (const model of record.models) {
      if (model === null || typeof model !== 'object') continue
      const id = (model as { id?: unknown }).id
      if (typeof id === 'string') return { provider: record.id, model: id }
    }
  }
  return undefined
}

/**
 * Decide what a Session's selection should be, given the preset it is composed
 * with.
 *
 * This is the symmetric half of the feature: an agent Session is moved onto its
 * agent, and a Session that has *left* the agent is moved off it again — back to
 * the selection it displaced when we know it, else to the first model of another
 * provider. Without the second direction a Session would keep routing to an agent
 * it is no longer composed with.
 * @param presetValue - the Session's projected preset id (the face existed).
 * @param selection - the Session's projected model selection.
 * @param groups - the catalog's provider groups.
 * @param stashed - the selection this module displaced for this Session, if any.
 * @returns the plan.
 */
export function planReconciliation(
  presetValue: unknown,
  selection: unknown,
  groups: unknown,
  stashed: unknown,
): ReconcilePlan {
  const current = asSelection(selection)
  // Nothing readable yet: writing now would be guessing at what the Session holds.
  if (current === undefined) return { kind: 'idle' }

  const agent = agentFromPresetId(presetValue)
  if (agent !== undefined) {
    if (!needsAgentSelection(current, agent)) return { kind: 'none' }
    return {
      kind: 'move',
      provider: ACP_PROVIDER,
      model: agent,
      // Only a foreign selection is worth remembering; an ACP one from another
      // agent is not a place to go back to.
      ...(current.provider === ACP_PROVIDER ? {} : { remember: current }),
    }
  }

  // A preset that is not ours — including none at all.
  if (current.provider !== ACP_PROVIDER) return { kind: 'none' }
  const target = asSelection(stashed) ?? firstForeignSelection(groups)
  if (target === undefined) return { kind: 'idle' }
  return { kind: 'move', provider: target.provider, model: target.model }
}

/**
 * Classify one Session from its preset projection.
 *
 * `unknown` is reserved for "there is no projection to read", which is what keeps
 * a composition without the preset feature from having ACP hidden everywhere.
 * @param face - the Session's preset projection, when one exists.
 * @returns `acp`, `other`, or `unknown`.
 */
export function sessionAgent(face: PresetFace | undefined): SessionAgent {
  if (face === undefined) return 'unknown'
  try {
    return isAcpPreset(face.getSnapshot()) ? 'acp' : 'other'
  } catch {
    // A projection that cannot be read is not evidence about the Session.
    return 'unknown'
  }
}

/**
 * The provider groups one Session may be offered.
 * @param groups - the catalog's provider groups.
 * @param mode - the scope in force.
 * @param agent - what the Session's preset projection says.
 * @returns `groups` itself whenever nothing is removed, so an unchanged list keeps
 *   the identity `useSyncExternalStore` needs.
 */
export function scopeGroups<T extends ModelGroupLike>(
  groups: readonly T[],
  mode: ModelScopeMode,
  agent: SessionAgent,
): readonly T[] {
  if (mode === 'off' || agent === 'unknown') return groups
  const isAcp = (group: T): boolean => group.id === ACP_PROVIDER
  if (agent === 'acp') {
    const kept = groups.filter(isAcp)
    return kept.length === groups.length ? groups : kept
  }
  // A non-ACP Session: `pinned` leaves the catalog alone, `scoped` is the R2 rule.
  if (mode === 'pinned') return groups
  const kept = groups.filter((group) => !isAcp(group))
  return kept.length === groups.length ? groups : kept
}

/**
 * One snapshot with its groups scoped.
 * @param snapshot - a directory snapshot.
 * @param mode - the scope in force.
 * @param agent - what the Session's preset projection says.
 * @returns the same object when nothing changes.
 */
export function scopeSnapshot<T extends ModelSnapshotLike>(
  snapshot: T,
  mode: ModelScopeMode,
  agent: SessionAgent,
): T {
  const groups = snapshot?.groups
  if (!Array.isArray(groups)) return snapshot
  const scoped = scopeGroups(groups, mode, agent)
  return scoped === groups ? snapshot : { ...snapshot, groups: scoped } as T
}

/**
 * A snapshot reader that returns the same object while its inputs are unchanged.
 *
 * Without this, every `getSnapshot()` would allocate a new scoped snapshot and
 * `useSyncExternalStore` would treat each read as a change.
 * @returns the memoized reader.
 */
export function createSnapshotScope(): (
  snapshot: ModelSnapshotLike,
  mode: ModelScopeMode,
  agent: SessionAgent,
) => ModelSnapshotLike {
  let last: ModelSnapshotLike | undefined
  let lastMode: ModelScopeMode | undefined
  let lastAgent: SessionAgent | undefined
  let lastResult: ModelSnapshotLike | undefined
  return (snapshot, mode, agent) => {
    if (snapshot === last && mode === lastMode && agent === lastAgent && lastResult !== undefined) {
      return lastResult
    }
    const result = scopeSnapshot(snapshot, mode, agent)
    last = snapshot
    lastMode = mode
    lastAgent = agent
    lastResult = result
    return result
  }
}

/**
 * Read the browser's scope preference.
 * @param storage - the storage to read; defaults to `localStorage` when the
 *   runtime has one.
 * @returns the recorded mode, or the shipped default.
 */
export function readModelScopeMode(storage?: Pick<Storage, 'getItem'>): ModelScopeMode {
  let source = storage
  if (source === undefined) {
    try {
      source = globalThis.localStorage
    } catch {
      // Storage can be denied (private mode, blocked site data).
      return DEFAULT_MODEL_SCOPE
    }
  }
  if (source === undefined) return DEFAULT_MODEL_SCOPE
  try {
    const stored = source.getItem(MODEL_SCOPE_KEY)
    if (stored === 'off' || stored === 'pinned' || stored === 'scoped') return stored
  } catch {
    // A denied read is "no preference recorded".
  }
  return DEFAULT_MODEL_SCOPE
}

/** One wrapped directory and the subscriptions that keep it live. */
interface ScopedDirectory {
  readonly facade: unknown
  dispose(): void
}

/**
 * Wrap one directory so the store it exposes is scoped.
 * @param directory - the object `directoryFor` returned.
 * @param sessionId - the Session it belongs to.
 * @param host - the client runtime the projection is read from.
 * @param controls - the mode and the diagnostic sink.
 * @returns the wrapper, or `undefined` when the shape is not one this module knows.
 */
function createScopedDirectory(
  directory: Record<string, unknown>,
  sessionId: string,
  host: ModelScopeHost,
  controls: ModelScopeControls,
): ScopedDirectory | undefined {
  const store = directory['store'] as Partial<ObservableLike<ModelSnapshotLike>> | undefined
  if (store === undefined || typeof store.getSnapshot !== 'function' || typeof store.subscribe !== 'function') {
    return undefined
  }
  // Captured after the check: the narrowing does not survive into the closures
  // below, and these are the two members the whole wrapper depends on.
  const readSnapshot = store.getSnapshot
  const watchStore = store.subscribe

  const read = createSnapshotScope()
  const listeners = new Set<() => void>()
  const notify = (): void => {
    for (const listener of [...listeners]) listener()
  }
  const disposers: Array<() => void> = []
  let face = host.presetFaceOf?.(sessionId)
  let faceDisposer: (() => void) | undefined

  /**
   * The preset projection, resolved lazily: a Session can be read before its
   * projection has landed, and the face is worth subscribing to the moment it
   * does — otherwise the first filtered list would be the last word.
   */
  const currentFace = (): PresetFace | undefined => {
    if (face === undefined) face = host.presetFaceOf?.(sessionId)
    if (face !== undefined && faceDisposer === undefined) {
      try {
        faceDisposer = face.subscribe(notify)
      } catch (error: unknown) {
        controls.warn?.('dsh-session-map: could not watch a Session preset projection', error)
      }
    }
    return face
  }

  try {
    disposers.push(watchStore(notify))
  } catch (error: unknown) {
    controls.warn?.('dsh-session-map: could not watch the model directory store', error)
  }

  /** The preset value the current decision was made for, and whether it settled. */
  let settledFor: unknown = UNSETTLED
  let settled = false
  /** The selection this Session displaced when it was moved onto its agent. */
  let stashed: unknown

  /**
   * Keep one Session's stored selection in agreement with its preset.
   *
   * A preset card cannot write the Session's model selection — `PresetDefinition`
   * carries no model, and the selection is installed before the preset mounts — so
   * a card Session routes to its agent while the composer still shows the profile
   * default. This is the write the card would have made: `provider: acp,
   * model: <agent>`, which the preset's own listener then passes through.
   *
   * Symmetric, because one direction is not enough: a Session that has left its
   * agent must be moved off it again, or it would keep a route its preset no
   * longer asks for. The selection the move displaced is remembered, so leaving
   * the agent restores what the Session actually had; with nothing remembered the
   * first model of another provider stands in.
   *
   * Settled per preset *value* rather than once per Session: changing the preset
   * is precisely the event this exists for. Nothing to compare yet (`null` before
   * the catalog loads, or no foreign provider to fall back to) leaves the decision
   * open, and a refusal is reported and abandoned rather than retried per render.
   * @param snapshot - the current scoped snapshot.
   * @param projection - the Session's preset projection, when one exists.
   */
  const reconcile = (snapshot: ModelSnapshotLike, projection: PresetFace | undefined): void => {
    if (projection === undefined) return
    const value = projection.getSnapshot()
    if (value !== settledFor) {
      settledFor = value
      settled = false
    }
    if (settled) return
    const plan = planReconciliation(
      value,
      (snapshot as { current?: unknown }).current,
      (snapshot as { groups?: unknown }).groups,
      stashed,
    )
    if (plan.kind === 'idle') return
    const write = host.selectModel
    // A runtime that cannot write keeps the question open rather than closing it.
    if (write === undefined) return
    settled = true
    if (plan.kind === 'none') return
    if (plan.remember !== undefined) stashed = plan.remember
    try {
      void Promise.resolve(write({ sessionId, provider: plan.provider, model: plan.model }))
        .catch((error: unknown) => {
          controls.warn?.('dsh-session-map: could not move a Session onto the model its preset implies', error)
        })
    } catch (error: unknown) {
      controls.warn?.('dsh-session-map: could not move a Session onto the model its preset implies', error)
    }
  }

  const scopedStore: ObservableLike<ModelSnapshotLike> = {
    getSnapshot: () => {
      const projection = currentFace()
      const snapshot = read(readSnapshot() as ModelSnapshotLike, controls.mode(), sessionAgent(projection))
      reconcile(snapshot, projection)
      return snapshot
    },
    subscribe: (listener) => {
      listeners.add(listener)
      return () => { listeners.delete(listener) }
    },
  }

  // A Proxy rather than a hand-built object: the pickers read `store`, `load` and
  // `select` today, and anything a future member needs still reaches the real
  // directory instead of arriving as `undefined`.
  const facade = new Proxy(directory, {
    get: (target, property) => {
      if (property === 'store') return scopedStore
      const value = Reflect.get(target, property, target)
      return typeof value === 'function' ? value.bind(target) : value
    },
  })

  return {
    facade,
    dispose: () => {
      for (const dispose of disposers.reverse()) {
        try {
          dispose()
        } catch {
          // A subscription that cannot be released is reported by its own store.
        }
      }
      try {
        faceDisposer?.()
      } catch {
        // As above.
      }
      faceDisposer = undefined
      listeners.clear()
    },
  }
}

/**
 * Install the scope by wrapping `modelDirectories.directoryFor`.
 *
 * The wrap is memoized per directory object, so the per-Session subscriptions are
 * created once no matter how often the composer re-renders.
 * @param host - the client runtime.
 * @param controls - the mode and the diagnostic sink.
 * @returns the disposer that restores the original method.
 */
export function installModelScope(host: ModelScopeHost, controls: ModelScopeControls): () => void {
  const target = host.models
  const original = target?.directoryFor
  if (target === undefined || typeof original !== 'function') {
    controls.warn?.('dsh-session-map: modelDirectories.directoryFor is unavailable; the ACP model scope is not installed', target)
    return () => {}
  }

  const scoped = new WeakMap<object, ScopedDirectory>()
  const live = new Set<ScopedDirectory>()
  let disposed = false

  const wrapper = function scopedDirectoryFor(this: unknown, sessionId: string): unknown {
    const directory = original.call(this, sessionId)
    if (directory === null || typeof directory !== 'object') return directory
    const existing = scoped.get(directory)
    if (existing !== undefined) return existing.facade
    const entry = createScopedDirectory(directory as Record<string, unknown>, sessionId, host, controls)
    if (entry === undefined) return directory
    scoped.set(directory, entry)
    live.add(entry)
    return entry.facade
  }

  // A Cordis service can be a read-only view of its instance, in which case an own
  // property never lands. The method is then patched on the prototype instead: the
  // product calls `models.directoryFor(...)`, so an inherited override is observed
  // exactly the same way. Both arms are checked by reading the value back, because
  // a proxy can accept a write and ignore it.
  let restore: (() => void) | undefined
  try {
    target.directoryFor = wrapper
    if (target.directoryFor === wrapper) restore = () => { target.directoryFor = original }
  } catch {
    // Fall through to the prototype.
  }
  if (restore === undefined) {
    const prototype = Object.getPrototypeOf(target) as ModelDirectoriesLike | null
    if (prototype !== null && typeof prototype.directoryFor === 'function') {
      try {
        prototype.directoryFor = wrapper
        if (prototype.directoryFor === wrapper) restore = () => { prototype.directoryFor = original }
      } catch {
        // Reported below.
      }
    }
  }
  if (restore === undefined) {
    controls.warn?.('dsh-session-map: modelDirectories.directoryFor could not be wrapped; the ACP model scope is not installed', target)
    return () => {}
  }

  return () => {
    if (disposed) return
    disposed = true
    restore()
    for (const entry of live) entry.dispose()
    live.clear()
  }
}
