/**
 * Discovery latency: the two read paths the composer and the model picker take.
 *
 * Nothing here is about what an agent advertises — `model-options.test.mjs` covers
 * that. These tests are about *when* an answer arrives, because both ACP reads are
 * gated behind a spawn + `initialize` + `session/new` handshake that ACP offers no
 * cheaper form of. Measured against `cursor-agent` on this machine:
 *
 * ```
 *   initialize answered at 1.0 s, session/new at 8.6 s, child exit at 14.7 s
 * ```
 *
 * So the properties under test are the ones that decide whether a user waits for
 * the handshake, or for something that is not the handshake at all:
 *
 * - a read settles when its answer lands, not when the child finally exits (the
 *   EOF grace is teardown's business);
 * - a waiter's own deadline applies even to a probe someone else started, and a
 *   waiter that gives up does not cancel the probe for the next reader;
 * - a list that outlived its TTL is still served rather than withdrawn;
 * - a Session that connected is a discovery result in its own right;
 * - a discovery that changed the list announces exactly one catalog refresh, which
 *   is the only way a `lazy` probe's models ever reach the browser (the client
 *   caches one catalog per host generation and re-reads on that event).
 */
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { fileURLToPath } from 'node:url'

const { AcpAgentAdapter } = await import('../lib/acp-agent.js')

const MOCK_PATH = fileURLToPath(new URL('./mock-acp-agent.mjs', import.meta.url))

/**
 * One throwaway directory.
 * @param label - names the directory, for a failing run's readability.
 * @returns its absolute path.
 */
function workdir(label) {
  return mkdtempSync(join(tmpdir(), `dsh-discovery-${label}-`))
}

/**
 * Every record the scripted agent appended, in order.
 * @param path - the record file.
 * @returns the parsed entries.
 */
function records(path) {
  try {
    return readFileSync(path, 'utf8').split('\n').filter(Boolean).map((line) => JSON.parse(line))
  } catch {
    return []
  }
}

/**
 * The subprocess seam, backed by a real child process, counting every spawn.
 *
 * The count is the point for two of these tests: "did this read start a process?"
 * is the difference between a warm cache and a user waiting on an agent.
 * @param counter - receives `count`.
 * @returns the seam.
 */
function subprocessSeam(counter = { count: 0 }) {
  return {
    spawn(spec) {
      counter.count += 1
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
 * @param options - seam, discovery and notification overrides.
 * @returns the adapter.
 */
function adapterFor(agents, options = {}) {
  const llm = {
    registerAdapter: () => () => {},
    listProviders: () => [],
    stream: () => { throw new Error('these tests never delegate a utility call') },
  }
  if (options.emitAdaptersUpdated !== undefined) llm.emitAdaptersUpdated = options.emitAdaptersUpdated
  const ctx = {
    logger: { warn: () => {}, debug: () => {} },
    llm,
    tools: { register: () => () => {} },
    subprocess: options.subprocess ?? subprocessSeam(),
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
    disposeEofGraceMs: options.disposeEofGraceMs ?? 3000,
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

/** Sleep. @param ms - milliseconds. @returns when the wait elapses. */
function sleep(ms) {
  return new Promise((resolve) => { setTimeout(resolve, ms) })
}

test('a cold read answers when the handshake lands, not when the child exits', async () => {
  const dir = workdir('linger')
  const path = join(dir, 'record.jsonl')
  // The child holds the connection open past its EOF window, exactly as a real
  // agent does while it flushes its own state.
  const agent = mockAgent('linger', path, { env: { MOCK_ACP_RECORD: path, MOCK_ACP_LINGER_MS: '2000' } })
  const adapter = adapterFor([agent], { disposeEofGraceMs: 3000 })
  try {
    const started = Date.now()
    const modes = await adapter.modesFor('mock')
    const elapsed = Date.now() - started
    assert.equal(modes?.current, 'agent')
    assert.ok(elapsed < 1500, `the answer must not wait for the EOF grace (took ${elapsed}ms)`)
    assert.ok(
      !records(path).some((entry) => entry.kind === 'exit'),
      'the child is still alive: the read returned before teardown finished',
    )

    // The process range is still reaped — by the row's own disposal, not by the read.
    await adapter.dispose()
    assert.ok(records(path).some((entry) => entry.kind === 'exit'), 'disposal still waits for the exit')
  } finally {
    await adapter.dispose()
    rmSync(dir, { recursive: true, force: true })
  }
})

test("a waiter's own bound applies even to a probe someone else started", async () => {
  const dir = workdir('deadline')
  const path = join(dir, 'record.jsonl')
  const agent = mockAgent('delay-new-session', path, {
    env: { MOCK_ACP_RECORD: path, MOCK_ACP_NEW_SESSION_DELAY_MS: '1500' },
  })
  const adapter = adapterFor([agent], { modelDiscovery: 'lazy', discoveryTimeoutMs: 400 })
  try {
    // A catalog read starts the shared probe under the background bound; the mode
    // control then joins it with a much shorter one of its own.
    await adapter.listModels('acp')

    const started = Date.now()
    assert.equal(await adapter.modesFor('mock'), undefined, 'the short bound is not met')
    const elapsed = Date.now() - started
    assert.ok(elapsed < 1200, `the waiter's own deadline must apply (took ${elapsed}ms)`)

    // Giving up does not cancel the probe: its answer is recorded for the next read.
    await sleep(1800)
    const later = await adapter.modesFor('mock')
    assert.equal(later?.current, 'agent')
  } finally {
    await adapter.dispose()
    rmSync(dir, { recursive: true, force: true })
  }
})

test('a result past its TTL is served while it is re-read behind the read', async () => {
  const dir = workdir('stale')
  const path = join(dir, 'record.jsonl')
  const spawns = { count: 0 }
  const adapter = adapterFor([mockAgent('model-list', path)], {
    modelDiscovery: 'eager',
    discoveryTtlMs: 1,
    subprocess: subprocessSeam(spawns),
  })
  try {
    const first = await adapter.listModels('acp')
    assert.ok(first.some((model) => model.id.includes('::')), 'the first read discovered the inner models')
    await sleep(10)
    const before = spawns.count

    const started = Date.now()
    const second = await adapter.listModels('acp')
    const elapsed = Date.now() - started
    assert.ok(
      second.some((model) => model.id.includes('::')),
      'a catalog read must not regress to the legacy entry just because the list aged out',
    )
    assert.ok(elapsed < 200, `stale is served without waiting for a handshake (took ${elapsed}ms)`)

    // ...and the revalidation really did start behind that answer.
    for (let i = 0; i < 40 && spawns.count === before; i += 1) await sleep(50)
    assert.ok(spawns.count > before, 'the stale answer is followed by a background probe')
  } finally {
    await adapter.dispose()
    rmSync(dir, { recursive: true, force: true })
  }
})

test('a connected Session seeds the cache, so the next read spawns nothing', async () => {
  const dir = workdir('live')
  const path = join(dir, 'record.jsonl')
  const spawns = { count: 0 }
  const adapter = adapterFor([mockAgent('model-list', path)], {
    modelDiscovery: 'lazy',
    subprocess: subprocessSeam(spawns),
  })
  try {
    await collect(adapter.stream(turn('mock')))
    assert.equal(spawns.count, 1, 'the turn is the only process')

    // `lazy` would normally answer this read with the legacy entry and warm later;
    // the Session's own handshake already answered it.
    const models = await adapter.listModels('acp')
    assert.ok(models.some((model) => model.id.includes('::')), 'the connected Session warmed the catalog')
    const modes = await adapter.modesFor('mock')
    assert.equal(modes?.current, 'agent')
    assert.equal(spawns.count, 1, 'neither read spawned a probe')
  } finally {
    await adapter.dispose()
    rmSync(dir, { recursive: true, force: true })
  }
})

test('a changed model list announces exactly one catalog refresh', async () => {
  const refreshes = []
  const dir = workdir('announce')
  const path = join(dir, 'record.jsonl')
  const adapter = adapterFor([mockAgent('model-list', path)], {
    modelDiscovery: 'eager',
    emitAdaptersUpdated: () => { refreshes.push(Date.now()) },
  })
  try {
    await adapter.listModels('acp')
    assert.equal(refreshes.length, 1, 'the first discovery is what the browser is waiting for')

    // Nothing moved: a fresh cache read and a Session that advertises the same
    // selector are both silence, so a catalog refresh cannot become a loop.
    await adapter.listModels('acp')
    await collect(adapter.stream(turn('mock')))
    assert.equal(refreshes.length, 1)
  } finally {
    await adapter.dispose()
    rmSync(dir, { recursive: true, force: true })
  }
})

test('nothing is announced when there is nothing new to list', async () => {
  const refreshes = []
  const dir = workdir('silent')
  const tryOne = async (scenario) => {
    const path = join(dir, `${scenario}.jsonl`)
    const adapter = adapterFor([mockAgent(scenario, path)], {
      modelDiscovery: 'eager',
      emitAdaptersUpdated: () => { refreshes.push(Date.now()) },
    })
    try {
      await adapter.listModels('acp')
    } finally {
      await adapter.dispose()
    }
  }
  try {
    // No selector: the catalog entry was already correct, so there is no news.
    await tryOne('no-model-option')
    // Unreachable: a failure is not a changed list either.
    await tryOne('fail-new-session')
    assert.deepEqual(refreshes, [])
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})
