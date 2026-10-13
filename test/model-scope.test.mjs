/**
 * Tests for P10's per-Session model scope.
 *
 * The feature is a patch on another plugin's method (`modelDirectories.directoryFor`)
 * and a filter over the snapshot its store hands the composer, so the properties
 * worth testing are not visual: that the filter is right, that an unchanged list
 * keeps its object identity (or `useSyncExternalStore` re-renders forever), that a
 * Session whose preset cannot be read is left alone, that an unrecognized shape is
 * returned untouched, and that disposal puts the original method back.
 *
 * Everything runs against fakes through the built `lib/model-scope.js`, which is
 * why the installer takes its collaborators as arguments.
 */
import assert from 'node:assert/strict'
import { test } from 'node:test'

const {
  DEFAULT_MODEL_SCOPE,
  MODEL_SCOPE_KEY,
  agentFromPresetId,
  createSnapshotScope,
  installModelScope,
  isAcpPreset,
  needsAgentSelection,
  planReconciliation,
  readModelScopeMode,
  scopeGroups,
  scopeSnapshot,
  sessionAgent,
} = await import('../lib/model-scope.js')

/**
 * A minimal observable with the shape a directory store and a projection face share.
 * @param initial - the starting value.
 * @returns the source, plus `set` to publish a new one and a live listener count.
 */
function observable(initial) {
  let value = initial
  const listeners = new Set()
  return {
    getSnapshot: () => value,
    subscribe: (listener) => {
      listeners.add(listener)
      return () => { listeners.delete(listener) }
    },
    set: (next) => {
      value = next
      for (const listener of [...listeners]) listener()
    },
    listenerCount: () => listeners.size,
  }
}

/**
 * One directory in the shape the product's resolver returns.
 * @param groups - the provider groups the catalog holds.
 * @returns the directory, its store, and the calls it received.
 */
function fakeDirectory(groups) {
  const store = observable({ groups, current: null, status: 'ready' })
  const calls = { load: 0, select: [] }
  return {
    store,
    calls,
    directory: {
      store,
      load: () => {
        calls.load += 1
        return store.getSnapshot()
      },
      select: (selection) => {
        calls.select.push(selection)
        return { ok: true }
      },
    },
  }
}

/** Two provider groups, one of them ours. */
function groups() {
  return [
    { id: 'deepseek-official', models: [{ id: 'deepseek-v4-pro' }] },
    { id: 'acp', models: [{ id: 'cursor' }, { id: 'cursor::gpt-5' }] },
  ]
}

/**
 * Install the scope over a fake runtime.
 * @param sessions - session id → `{ directory, preset }`.
 * @param options - mode and warn overrides.
 * @returns the installed runtime and the disposer.
 */
function install(sessions, options = {}) {
  const models = { directoryFor: (sessionId) => sessions[sessionId]?.directory }
  const warnings = []
  const writes = []
  const host = {
    models,
    presetFaceOf: (sessionId) => sessions[sessionId]?.preset,
  }
  if (options.selectModel !== false) {
    host.selectModel = (request) => {
      writes.push(request)
      return options.selectModelError === undefined
        ? Promise.resolve({ ok: true })
        : Promise.reject(options.selectModelError)
    }
  }
  const dispose = installModelScope(host, {
    mode: () => options.mode ?? DEFAULT_MODEL_SCOPE,
    warn: (message, detail) => { warnings.push([message, detail]) },
  })
  return { models, warnings, writes, dispose }
}

test('only this package\'s preset ids are ACP ones', () => {
  assert.equal(isAcpPreset('acp-cursor'), true)
  assert.equal(isAcpPreset('acp-'), true, 'the prefix is the contract, not the agent name')
  assert.equal(isAcpPreset('acp'), false, 'a bare "acp" is not one of our cards')
  assert.equal(isAcpPreset('minimal'), false)
  assert.equal(isAcpPreset(undefined), false)
  assert.equal(isAcpPreset(7), false)
})

test('a Session with no projection to read is unknown, not "not ACP"', () => {
  assert.equal(sessionAgent(undefined), 'unknown')
  assert.equal(sessionAgent(observable('acp-cursor')), 'acp')
  assert.equal(sessionAgent(observable('minimal')), 'other')
  assert.equal(sessionAgent(observable(undefined)), 'other', 'a readable projection that says nothing means no ACP preset')
  assert.equal(sessionAgent({ getSnapshot: () => { throw new Error('boom') }, subscribe: () => () => {} }), 'unknown')
})

test('the scope keeps the list identity whenever it removes nothing', () => {
  const all = groups()
  assert.equal(scopeGroups(all, 'off', 'acp'), all)
  assert.equal(scopeGroups(all, 'scoped', 'unknown'), all, 'an unreadable preset must not filter')
  assert.equal(scopeGroups(all, 'pinned', 'other'), all)

  const acpOnly = [all[1]]
  assert.equal(scopeGroups(acpOnly, 'scoped', 'acp'), acpOnly, 'nothing to remove, nothing to allocate')
  assert.equal(scopeGroups(acpOnly, 'pinned', 'acp'), acpOnly)

  const noAcp = [all[0]]
  assert.equal(scopeGroups(noAcp, 'scoped', 'other'), noAcp)
})

test('the scope rules, mode by mode', () => {
  const all = groups()
  assert.deepEqual(scopeGroups(all, 'scoped', 'acp').map((group) => group.id), ['acp'])
  assert.deepEqual(scopeGroups(all, 'scoped', 'other').map((group) => group.id), ['deepseek-official'])
  assert.deepEqual(scopeGroups(all, 'pinned', 'acp').map((group) => group.id), ['acp'])
  assert.deepEqual(scopeGroups(all, 'pinned', 'other').map((group) => group.id), ['deepseek-official', 'acp'])
  assert.deepEqual(scopeGroups(all, 'off', 'acp').map((group) => group.id), ['deepseek-official', 'acp'])
})

test('a scoped snapshot keeps every other field and its identity when unchanged', () => {
  const snapshot = { groups: groups(), current: { provider: 'acp', model: 'cursor' }, status: 'ready' }
  const scoped = scopeSnapshot(snapshot, 'scoped', 'other')
  assert.deepEqual(scoped.groups.map((group) => group.id), ['deepseek-official'])
  assert.deepEqual(scoped.current, snapshot.current)
  assert.equal(scoped.status, 'ready')
  assert.equal(scopeSnapshot(snapshot, 'off', 'acp'), snapshot)
  assert.equal(scopeSnapshot({ status: 'loading' }, 'scoped', 'acp').status, 'loading', 'a shapeless snapshot passes through')
})

test('the reader hands back the same object while its inputs are unchanged', () => {
  const read = createSnapshotScope()
  const snapshot = { groups: groups() }
  const first = read(snapshot, 'scoped', 'other')
  assert.equal(read(snapshot, 'scoped', 'other'), first, 'same inputs must not allocate')
  assert.notEqual(read(snapshot, 'scoped', 'acp'), first, 'a different agent is a different list')
  assert.notEqual(read(snapshot, 'off', 'other'), first, 'a different mode is a different list')
  assert.notEqual(read({ groups: groups() }, 'scoped', 'other'), first, 'a new snapshot is re-read')
})

test('the recorded preference is honoured, and anything else falls back', () => {
  const storage = (value) => ({ getItem: (key) => (key === MODEL_SCOPE_KEY ? value : null) })
  assert.equal(readModelScopeMode(storage('off')), 'off')
  assert.equal(readModelScopeMode(storage('pinned')), 'pinned')
  assert.equal(readModelScopeMode(storage('scoped')), 'scoped')
  assert.equal(readModelScopeMode(storage('nonsense')), DEFAULT_MODEL_SCOPE)
  assert.equal(readModelScopeMode(storage(null)), DEFAULT_MODEL_SCOPE)
  assert.equal(readModelScopeMode({ getItem: () => { throw new Error('denied') } }), DEFAULT_MODEL_SCOPE)
  assert.equal(readModelScopeMode(undefined), DEFAULT_MODEL_SCOPE, 'no storage at all is the shipped default')
})

test('an install without the service is a no-op that says so once', () => {
  const warnings = []
  const dispose = installModelScope({ models: {} }, { mode: () => 'scoped', warn: (m, d) => warnings.push([m, d]) })
  assert.equal(typeof dispose, 'function')
  assert.equal(warnings.length, 1)
  dispose()
})

test('a directory whose store cannot be read is returned untouched', () => {
  const { models } = install({ s1: { directory: { load: () => {} }, preset: undefined } })
  const encountered = models.directoryFor('s1')
  assert.deepEqual(Object.keys(encountered), ['load'], 'fail-open: the caller gets exactly what it passed us')
})

test('the wrap scopes the list, forwards the rest, and is memoized', () => {
  const { store, calls, directory } = fakeDirectory(groups())
  const preset = observable('acp-cursor')
  const { models, dispose } = install({ s1: { directory, preset } })

  const first = models.directoryFor('s1')
  const second = models.directoryFor('s1')
  assert.equal(first, second, 'a re-render must not build a new wrapper')
  assert.equal(store.listenerCount(), 1, 'and must not stack subscriptions')

  assert.deepEqual(first.store.getSnapshot().groups.map((group) => group.id), ['acp'])
  assert.equal(first.store.getSnapshot(), first.store.getSnapshot(), 'uSES: unchanged reads share an object')

  assert.equal(first.load(), directory.store.getSnapshot())
  assert.equal(calls.load, 1)
  first.select({ provider: 'acp', model: 'cursor' })
  assert.deepEqual(calls.select, [{ provider: 'acp', model: 'cursor' }])

  dispose()
  assert.equal(models.directoryFor, models.directoryFor, 'restored method is still callable')
  assert.equal(models.directoryFor('s1'), directory, 'disposal gives the caller the real directory again')
  assert.equal(store.listenerCount(), 0)
})

test('a preset that lands after the first read still re-scopes the list', () => {
  const { store, directory } = fakeDirectory(groups())
  const preset = observable(undefined)
  const seen = []
  const { models, dispose } = install({ s1: { directory, preset } })

  const scoped = models.directoryFor('s1')
  scoped.store.subscribe(() => { seen.push(scoped.store.getSnapshot().groups.map((group) => group.id)) })
  assert.deepEqual(scoped.store.getSnapshot().groups.map((group) => group.id), ['deepseek-official'])

  // The projection lands: this Session is an ACP one after all.
  preset.set('acp-cursor')
  assert.deepEqual(seen.at(-1), ['acp'], 'the subscriber was told, and the list flipped')

  // A catalog change re-reads through the same scope.
  store.set({ groups: groups(), status: 'ready' })
  assert.equal(seen.length, 2)
  dispose()
})

test('a non-ACP Session loses the ACP group when the catalog changes', () => {
  const { store, directory } = fakeDirectory(groups())
  const { models } = install({ s1: { directory, preset: observable('minimal') } })
  const scoped = models.directoryFor('s1').store
  assert.deepEqual(scoped.getSnapshot().groups.map((group) => group.id), ['deepseek-official'])
  store.set({ groups: [...groups(), { id: 'other-provider', models: [] }] })
  assert.deepEqual(scoped.getSnapshot().groups.map((group) => group.id), ['deepseek-official', 'other-provider'])
})

test('the agent a card names is the preset id without its prefix', () => {
  assert.equal(agentFromPresetId('acp-cursor'), 'cursor')
  assert.equal(agentFromPresetId('acp-opencode'), 'opencode')
  assert.equal(agentFromPresetId('acp-'), undefined, 'a card with no agent names nothing')
  assert.equal(agentFromPresetId('minimal'), undefined)
  assert.equal(agentFromPresetId(undefined), undefined)
})

test('a card Session is pulled onto its agent only when its selection points elsewhere', () => {
  assert.equal(needsAgentSelection({ provider: 'deepseek-official', model: 'deepseek-flash' }, 'cursor'), true)
  assert.equal(needsAgentSelection({ provider: 'acp', model: 'opencode' }, 'cursor'), true, 'another agent is still elsewhere')
  assert.equal(needsAgentSelection({ provider: 'acp', model: 'cursor' }, 'cursor'), false)
  assert.equal(
    needsAgentSelection({ provider: 'acp', model: 'cursor::gpt-5' }, 'cursor'),
    false,
    'an inner model of this agent is a person\'s choice, not a mismatch',
  )
  assert.equal(needsAgentSelection({ provider: 'acp', model: 'cursorish' }, 'cursor'), true, 'a shared prefix is not a match')
  assert.equal(needsAgentSelection(undefined, 'cursor'), false, 'nothing to compare yet')
  assert.equal(needsAgentSelection(null, 'cursor'), false)
  assert.equal(needsAgentSelection({ provider: 'deepseek-official', model: 'x' }, undefined), false, 'not our card')
})

test('a card Session whose selection is elsewhere is moved onto its agent, exactly once', async () => {
  const { directory, store } = fakeDirectory(groups())
  store.set({ groups: groups(), current: { provider: 'deepseek-official', model: 'deepseek-flash' } })
  const { models, writes, dispose } = install({ s1: { directory, preset: observable('acp-cursor') } })

  const scoped = models.directoryFor('s1').store
  scoped.getSnapshot()
  scoped.getSnapshot()
  scoped.getSnapshot()
  await Promise.resolve()
  assert.deepEqual(writes, [{ sessionId: 's1', provider: 'acp', model: 'cursor' }])
  dispose()
})

test('nothing is written when the Session is already right, or is not a card Session', async () => {
  const already = fakeDirectory(groups())
  already.store.set({ groups: groups(), current: { provider: 'acp', model: 'cursor::gpt-5' } })
  const inner = install({ s1: { directory: already.directory, preset: observable('acp-cursor') } })
  inner.models.directoryFor('s1').store.getSnapshot()
  assert.deepEqual(inner.writes, [], 'an inner model of the right agent is left alone')
  inner.dispose()

  const plain = fakeDirectory(groups())
  plain.store.set({ groups: groups(), current: { provider: 'deepseek-official', model: 'deepseek-flash' } })
  const other = install({ s1: { directory: plain.directory, preset: observable('minimal') } })
  other.models.directoryFor('s1').store.getSnapshot()
  assert.deepEqual(other.writes, [], 'a Session that is not ours is never written to')
  other.dispose()

  // No projection at all: "cannot tell" must not turn into a write either.
  const unknown = fakeDirectory(groups())
  const blind = install({ s1: { directory: unknown.directory, preset: undefined } })
  blind.models.directoryFor('s1').store.getSnapshot()
  assert.deepEqual(blind.writes, [])
  blind.dispose()
})

test('a refused write is reported once and never retried', async () => {
  const { directory, store } = fakeDirectory(groups())
  store.set({ groups: groups(), current: { provider: 'deepseek-official', model: 'deepseek-flash' } })
  const { models, writes, warnings, dispose } = install(
    { s1: { directory, preset: observable('acp-cursor') } },
    { selectModelError: new Error('session/writer-held') },
  )

  const scoped = models.directoryFor('s1').store
  scoped.getSnapshot()
  scoped.getSnapshot()
  await Promise.resolve()
  await Promise.resolve()
  assert.equal(writes.length, 1, 'one attempt per Session')
  assert.equal(warnings.length, 1, 'and one report')
  dispose()
})

test('a runtime that cannot write leaves the Session usable and the question open', () => {
  const { directory, store } = fakeDirectory(groups())
  store.set({ groups: groups(), current: { provider: 'deepseek-official', model: 'deepseek-flash' } })
  const { models, warnings, dispose } = install({ s1: { directory, preset: observable('acp-cursor') } }, { selectModel: false })
  const scoped = models.directoryFor('s1').store
  assert.deepEqual(scoped.getSnapshot().groups.map((group) => group.id), ['acp'])
  assert.deepEqual(warnings, [])
  dispose()
})

test('the plan moves a Session onto its agent, remembers what it displaced, and moves it back', () => {
  const foreign = { provider: 'deepseek-official', model: 'deepseek-flash' }
  const catalog = groups()

  assert.deepEqual(planReconciliation('acp-cursor', foreign, catalog, undefined), {
    kind: 'move', provider: 'acp', model: 'cursor', remember: foreign,
  })
  assert.deepEqual(
    planReconciliation('acp-cursor', { provider: 'acp', model: 'opencode' }, catalog, undefined),
    { kind: 'move', provider: 'acp', model: 'cursor' },
    'another agent is not a place to go back to',
  )
  assert.deepEqual(
    planReconciliation('acp-cursor', { provider: 'acp', model: 'cursor::gpt-5' }, catalog, undefined),
    { kind: 'none' },
  )
  assert.deepEqual(planReconciliation('minimal', foreign, catalog, undefined), { kind: 'none' })
  assert.deepEqual(
    planReconciliation('minimal', { provider: 'acp', model: 'cursor' }, catalog, foreign),
    { kind: 'move', provider: 'deepseek-official', model: 'deepseek-flash' },
    'leaving the agent restores what the move displaced',
  )
  assert.deepEqual(
    planReconciliation(undefined, { provider: 'acp', model: 'cursor' }, catalog, undefined),
    { kind: 'move', provider: 'deepseek-official', model: 'deepseek-v4-pro' },
    'a Session with no preset at all is not an agent Session either',
  )
  assert.deepEqual(
    planReconciliation('minimal', { provider: 'acp', model: 'cursor' }, [{ id: 'acp', models: [] }], undefined),
    { kind: 'idle' },
    'no foreign provider yet: decide again later rather than guess',
  )
  assert.deepEqual(planReconciliation('minimal', null, catalog, undefined), { kind: 'idle' })
})

test('leaving the agent puts the Session back on the model it displaced', async () => {
  const { directory, store } = fakeDirectory(groups())
  store.set({ groups: groups(), current: { provider: 'deepseek-official', model: 'deepseek-flash' } })
  const preset = observable('acp-cursor')
  const { models, writes, dispose } = install({ s1: { directory, preset } })

  const scoped = models.directoryFor('s1').store
  scoped.getSnapshot()
  await Promise.resolve()
  assert.deepEqual(writes, [{ sessionId: 's1', provider: 'acp', model: 'cursor' }])

  // The Host applied it, and the person switches the Session to another preset.
  preset.set('minimal')
  store.set({ groups: groups(), current: { provider: 'acp', model: 'cursor' } })
  scoped.getSnapshot()
  await Promise.resolve()
  assert.equal(writes.length, 2)
  assert.deepEqual(writes[1], { sessionId: 's1', provider: 'deepseek-official', model: 'deepseek-flash' })
  dispose()
})

test('with nothing remembered, the first model of another provider stands in', async () => {
  const { directory, store } = fakeDirectory(groups())
  store.set({ groups: groups(), current: { provider: 'acp', model: 'cursor' } })
  const { models, writes, dispose } = install({ s1: { directory, preset: observable('minimal') } })
  models.directoryFor('s1').store.getSnapshot()
  await Promise.resolve()
  assert.deepEqual(writes, [{ sessionId: 's1', provider: 'deepseek-official', model: 'deepseek-v4-pro' }])
  dispose()
})

test('a restore waits for a provider to move to instead of guessing', async () => {
  const acpOnly = [{ id: 'acp', models: [{ id: 'cursor' }] }]
  const { directory, store } = fakeDirectory(acpOnly)
  store.set({ groups: acpOnly, current: { provider: 'acp', model: 'cursor' } })
  const { models, writes, dispose } = install({ s1: { directory, preset: observable('minimal') } })

  const scoped = models.directoryFor('s1').store
  scoped.getSnapshot()
  assert.deepEqual(writes, [], 'no other provider, so nowhere to move to yet')

  store.set({ groups: groups(), current: { provider: 'acp', model: 'cursor' } })
  scoped.getSnapshot()
  await Promise.resolve()
  assert.deepEqual(writes, [{ sessionId: 's1', provider: 'deepseek-official', model: 'deepseek-v4-pro' }])
  dispose()
})

test('the mode is read per decision, so a preference change applies at once', () => {
  const { directory } = fakeDirectory(groups())
  let mode = 'scoped'
  const { models } = install({ s1: { directory, preset: observable('minimal') } }, { mode: undefined })
  // `install` reads `options.mode` once; drive the getter directly instead.
  const models2 = { directoryFor: () => directory }
  const dispose = installModelScope(
    { models: models2, presetFaceOf: () => observable('minimal') },
    { mode: () => mode },
  )
  const scoped = models2.directoryFor('s1').store
  assert.deepEqual(scoped.getSnapshot().groups.map((group) => group.id), ['deepseek-official'])
  mode = 'off'
  assert.deepEqual(scoped.getSnapshot().groups.map((group) => group.id), ['deepseek-official', 'acp'])
  dispose()
  assert.equal(typeof models.directoryFor, 'function')
})
