/**
 * Tests for the ACP route's model list.
 *
 * An ACP agent can advertise a model selector of its own, and the only way a DSH
 * user can reach it is through the model ids this route publishes. That makes the
 * behaviour under test *wire* behaviour — which requests go out, in what order,
 * and what the route makes of the option set that comes back — so these tests
 * drive the real `AcpAgentAdapter`/`AcpChannel` from `lib/acp-agent.js` against
 * the scripted agent in `./mock-acp-agent.mjs`, over a real child process, and
 * assert on the frames the scripted agent recorded.
 *
 * The properties that matter, and why:
 *
 * - discovery is opt-in per call and never spawns in `off`;
 * - a discovery failure degrades to the legacy entry instead of failing a turn;
 * - a selected model reaches the agent BEFORE the prompt that depends on it;
 * - a selection the agent already reports as current costs no request;
 * - the legacy id restores the row's configured default rather than whatever was
 *   last selected;
 * - an agent that publishes a config-option update mid-turn does not have it
 *   mistaken for assistant content.
 */
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { fileURLToPath } from 'node:url'

const {
  AcpAgentAdapter,
  decodeModelId,
  encodeModelId,
  parseConfigOptions,
  resolveRouteOptions,
} = await import('../lib/acp-agent.js')

const MOCK_PATH = fileURLToPath(new URL('./mock-acp-agent.mjs', import.meta.url))

/**
 * One throwaway directory.
 * @param label - names the directory, for a failing run's readability.
 * @returns its absolute path.
 */
function workdir(label) {
  return mkdtempSync(join(tmpdir(), `dsh-model-options-${label}-`))
}

/**
 * Every frame the scripted agent observed, in arrival order.
 * @param path - the record file.
 * @returns the parsed entries.
 */
function frames(path) {
  let text = ''
  try {
    text = readFileSync(path, 'utf8')
  } catch {
    return []
  }
  return text.split('\n').filter(Boolean).map((line) => JSON.parse(line))
}

/**
 * The client-request methods the scripted agent saw, in order.
 * @param path - the record file.
 * @returns the method names.
 */
function requestMethods(path) {
  return frames(path)
    .filter((entry) => entry.kind === 'request')
    .map((entry) => entry.method)
}

/**
 * The `session/set_config_option` requests the scripted agent saw.
 * @param path - the record file.
 * @returns their params, in order.
 */
function configWrites(path) {
  return frames(path)
    .filter((entry) => entry.kind === 'request' && entry.method === 'session/set_config_option')
    .map((entry) => [entry.params?.configId, entry.params?.value])
}

/**
 * The subprocess seam, backed by a real child process.
 *
 * It mirrors what the Host's seam does for this route: piped protocol streams, one
 * managed process range, `done` for the exit, and a kill escalation for the
 * teardown ladder. `waitForExit` reports whether the range is empty, which is
 * what decides if the ladder escalates.
 * @returns the seam.
 */
function subprocessSeam() {
  return {
    spawn(spec) {
      const child = spawn(spec.argv[0], spec.argv.slice(1), {
        cwd: spec.cwd,
        stdio: ['pipe', 'pipe', 'inherit'],
        env: { ...process.env, ...spec.env },
        windowsHide: true,
      })
      const done = new Promise((resolve) => {
        child.on('exit', (exitCode, signal) => { resolve({ exitCode, signal }) })
        child.on('error', () => { resolve({ exitCode: null, signal: null }) })
      })
      return {
        stdin: child.stdin,
        stdout: child.stdout,
        done,
        terminate: () => { child.kill() },
        waitForExit: (signal) => new Promise((resolve) => {
          let settled = false
          const finish = (value) => {
            if (settled) return
            settled = true
            resolve(value)
          }
          void done.then(() => { finish(true) })
          if (signal === undefined) return
          if (signal.aborted) {
            finish(false)
            return
          }
          signal.addEventListener('abort', () => { finish(false) }, { once: true })
        }),
      }
    },
  }
}

/**
 * One resolved agent entry pointed at the scripted agent.
 * @param scenario - the scripted scenario.
 * @param path - the record file the scripted agent appends to.
 * @param overrides - fields to replace.
 * @returns the agent entry.
 */
function mockAgent(scenario, path, overrides = {}) {
  return {
    providerName: 'mock',
    command: process.execPath,
    args: [MOCK_PATH, scenario],
    cwd: undefined,
    mode: undefined,
    configOptions: new Map(),
    permission: 'allow',
    env: { MOCK_ACP_RECORD: path },
    ...overrides,
  }
}

/**
 * An adapter over the given agents, wired to the test seams.
 * @param agents - the resolved agents.
 * @param options - seam and discovery overrides.
 * @returns the adapter.
 */
function adapterFor(agents, options = {}) {
  const ctx = {
    logger: { warn: () => {}, debug: () => {} },
    llm: {
      registerAdapter: () => () => {},
      listProviders: () => [],
      stream: () => { throw new Error('these tests never delegate a utility call') },
    },
    tools: { register: () => () => {} },
    subprocess: options.subprocess ?? subprocessSeam(),
    // A Host composition always has live agents, and every Session records the
    // working directory its children start in; without one the route is right to
    // refuse rather than guess, so the stub provides it.
    get: (service) => (service === 'agents'
      ? { get: () => ({ session: { header: { cwd: process.cwd() } } }) }
      : undefined),
    inject: () => undefined,
    effect: () => {},
    on: () => () => {},
  }
  return new AcpAgentAdapter(ctx, {
    prefix: 'dsh-session-map/test',
    provider: 'acp',
    agents,
    disposeEofGraceMs: 3000,
    disposeGraceMs: 1000,
    idleDisposeMs: 0,
    utility: undefined,
    approval: 'policy',
    fs: 'isolate',
    modelDiscovery: options.modelDiscovery ?? 'off',
    discoveryTimeoutMs: options.discoveryTimeoutMs ?? 30_000,
    discoveryTtlMs: options.discoveryTtlMs ?? 300_000,
  })
}

/**
 * One assembled user turn, in the shape the Host hands the adapter.
 * @param model - the model id the Host selected.
 * @returns the request options.
 */
function turn(model) {
  return {
    provider: 'acp',
    model,
    sessionId: 'session-1',
    messages: [{ role: 'user', content: [{ type: 'text', text: 'hello' }] }],
  }
}

/**
 * Drain a chunk stream.
 * @param iterable - the stream.
 * @returns its chunks.
 */
async function collect(iterable) {
  const chunks = []
  for await (const chunk of iterable) chunks.push(chunk)
  return chunks
}

test('a model id round-trips, and the split is on the last separator', () => {
  assert.equal(encodeModelId('cursor'), 'cursor')
  assert.equal(encodeModelId('cursor', ''), 'cursor', 'an empty value means the agent default')
  assert.equal(encodeModelId('cursor', 'grok-4.6[effort=high,fast=true]'), 'cursor::grok-4.6[effort=high,fast=true]')

  assert.deepEqual(decodeModelId('cursor'), { agent: 'cursor', value: undefined })
  assert.deepEqual(decodeModelId('cursor::'), { agent: 'cursor', value: undefined })
  assert.deepEqual(decodeModelId('cursor::grok-4.6[a,b]'), { agent: 'cursor', value: 'grok-4.6[a,b]' })
  // Only a *value* may contain the separator: agent names are checked below.
  assert.deepEqual(decodeModelId('cursor::a::b'), { agent: 'cursor::a', value: 'b' })
})

test('the route refuses an agent name that would make its model ids ambiguous', () => {
  assert.throws(
    () => resolveRouteOptions({ agents: [{ name: 'cursor::fast', command: 'cursor-agent' }] }),
    /must not contain "::"/,
  )
})

test('discovery defaults to eager, with the measured handshake bound', () => {
  const resolved = resolveRouteOptions({ agents: [{ name: 'cursor', command: 'cursor-agent' }] })
  assert.equal(resolved.modelDiscovery, 'eager')
  assert.equal(resolved.discoveryTimeoutMs, 15_000)
  assert.equal(resolved.discoveryTtlMs, 300_000)
  assert.equal(resolveRouteOptions({ agents: [], modelDiscovery: 'off' }).modelDiscovery, 'off')
  assert.equal(resolveRouteOptions({ agents: [], modelDiscovery: 'lazy' }).modelDiscovery, 'lazy')
})

test('the option reader flattens groups, keeps booleans, and drops what it cannot read', () => {
  const options = parseConfigOptions([
    {
      id: 'model',
      name: 'Model',
      category: 'model',
      type: 'select',
      currentValue: 'a',
      options: [
        { value: 'a', name: 'A' },
        { value: 'group', name: 'Grouped', options: [{ value: 'b', name: 'B', description: 'second' }] },
      ],
    },
    { id: 'verbose', name: 'Verbose', type: 'boolean', currentValue: true },
    // ACP requires a client to tolerate an option kind it does not know, and an
    // option without an id is unusable.
    { id: 'future', name: 'Future', type: 'multi-select', currentValue: 'x' },
    { name: 'no id', type: 'select', currentValue: 'x' },
  ])

  assert.equal(options.length, 2)
  assert.equal(options[0].category, 'model')
  assert.deepEqual(options[0].choices.map((choice) => [choice.value, choice.group ?? null]), [
    ['a', null],
    ['b', 'Grouped'],
  ])
  assert.equal(options[1].currentValue, true)
  assert.deepEqual(parseConfigOptions(undefined), [])
})

test('modelDiscovery off lists one entry per agent and never spawns', async () => {
  const adapter = adapterFor([mockAgent('model-list', 'unused.jsonl')], {
    modelDiscovery: 'off',
    subprocess: { spawn: () => { throw new Error('a catalog read must not spawn an agent') } },
  })
  const models = await adapter.listModels('acp')
  assert.deepEqual(models.map((model) => model.id), ['mock'])
  assert.equal(models[0].name, 'ACP · mock')
  await adapter.dispose()
})

test('eager discovery publishes every advertised model, the legacy entry first', async () => {
  const dir = workdir('eager')
  const adapter = adapterFor([mockAgent('model-list', join(dir, 'record.jsonl'))], { modelDiscovery: 'eager' })
  try {
    const models = await adapter.listModels('acp')
    assert.deepEqual(models.map((model) => model.id), ['mock', 'mock::mock/one', 'mock::mock/two', 'mock::mock/three'])
    assert.equal(models[0].name, 'ACP · mock')
    assert.equal(models[2].name, 'ACP · mock · Grouped Values · Mock Two', 'a grouped value keeps its group label')
    assert.equal(models[3].name, 'ACP · mock · Mock Three')
    // The catalog may only offer what the Host can submit, so every id decodes
    // back to this agent.
    for (const model of models) assert.equal(decodeModelId(model.id).agent, 'mock')
  } finally {
    await adapter.dispose()
    rmSync(dir, { recursive: true, force: true })
  }
})

test('an agent with no model selector contributes only its own entry', async () => {
  const dir = workdir('no-selector')
  const adapter = adapterFor([mockAgent('no-model-option', join(dir, 'record.jsonl'))], { modelDiscovery: 'eager' })
  try {
    assert.deepEqual((await adapter.listModels('acp')).map((model) => model.id), ['mock'])
  } finally {
    await adapter.dispose()
    rmSync(dir, { recursive: true, force: true })
  }
})

test('a refused session is a fact about the agent, not a failure of the catalog', async () => {
  const dir = workdir('refused')
  const adapter = adapterFor([mockAgent('fail-new-session', join(dir, 'record.jsonl'))], { modelDiscovery: 'eager' })
  try {
    assert.deepEqual((await adapter.listModels('acp')).map((model) => model.id), ['mock'])
  } finally {
    await adapter.dispose()
    rmSync(dir, { recursive: true, force: true })
  }
})

test('a selected model is written before the prompt, and not written twice', async () => {
  const dir = workdir('reconcile')
  const path = join(dir, 'record.jsonl')
  const adapter = adapterFor([mockAgent('model-list', path)], { modelDiscovery: 'off' })
  try {
    await collect(adapter.stream(turn('mock::mock/two')))
    const observed = requestMethods(path)
    assert.equal(observed.filter((method) => method === 'session/set_config_option').length, 1)
    assert.ok(
      observed.indexOf('session/set_config_option') < observed.indexOf('session/prompt'),
      'the model must be in force before the prompt that depends on it',
    )
    assert.deepEqual(configWrites(path), [['model', 'mock/two']])

    // The agent re-published the selection as current, so a turn that does not
    // change the model costs no request at all.
    await collect(adapter.stream(turn('mock::mock/two')))
    assert.deepEqual(configWrites(path), [['model', 'mock/two']])
    assert.equal(requestMethods(path).filter((method) => method === 'session/prompt').length, 2)
  } finally {
    await adapter.dispose()
    rmSync(dir, { recursive: true, force: true })
  }
})

test('the legacy id restores the row configuration after an inner model was used', async () => {
  const dir = workdir('legacy')
  const path = join(dir, 'record.jsonl')
  const agent = mockAgent('model-list', path, { configOptions: new Map([['model', 'mock/one']]) })
  const adapter = adapterFor([agent], { modelDiscovery: 'off' })
  try {
    // The scripted agent already reports `mock/one`, so startup costs no write.
    await collect(adapter.stream(turn('mock::mock/three')))
    assert.deepEqual(configWrites(path), [['model', 'mock/three']])

    await collect(adapter.stream(turn('mock')))
    assert.deepEqual(configWrites(path), [['model', 'mock/three'], ['model', 'mock/one']])
  } finally {
    await adapter.dispose()
    rmSync(dir, { recursive: true, force: true })
  }
})

test('the client advertises the config-option capability under session', async () => {
  const dir = workdir('capability')
  const path = join(dir, 'record.jsonl')
  const adapter = adapterFor([mockAgent('model-list', path)], { modelDiscovery: 'off' })
  try {
    await collect(adapter.stream(turn('mock')))
    const initialize = frames(path).find((entry) => entry.kind === 'request' && entry.method === 'initialize')
    assert.deepEqual(initialize.params.clientCapabilities.session, { configOptions: { boolean: {} } })
    assert.equal(initialize.params.clientCapabilities.fs, undefined, 'fs is not advertised in isolate mode')
  } finally {
    await adapter.dispose()
    rmSync(dir, { recursive: true, force: true })
  }
})

test('a mid-turn option update changes state and is never mistaken for content', async () => {
  const dir = workdir('update')
  const path = join(dir, 'record.jsonl')
  const adapter = adapterFor([mockAgent('config-update', path)], { modelDiscovery: 'off' })
  try {
    const chunks = await collect(adapter.stream(turn('mock')))
    assert.equal(chunks.filter((chunk) => chunk.type === 'text-delta').map((chunk) => chunk.text).join(''), 'pong')
    assert.ok(chunks.some((chunk) => chunk.type === 'finish' && chunk.reason.kind === 'tool-calls'))
    assert.ok(!chunks.some((chunk) => chunk.type === 'finish' && chunk.reason.kind === 'error'))
    assert.deepEqual(configWrites(path), [], 'nothing was selected, so nothing was written')

    // The update put the agent on `mock/three`. Asking for exactly that now must
    // cost no write — which is only true if the update was adopted as state.
    await collect(adapter.stream(turn('mock::mock/three')))
    assert.deepEqual(configWrites(path), [])
  } finally {
    await adapter.dispose()
    rmSync(dir, { recursive: true, force: true })
  }
})
