/**
 * End-to-end tests for the ACP subagent driver, driven through the built plugin
 * artifact and the Host seam contract. Nothing here is vendor-specific: a
 * scripted ACP agent stands in for whichever CLI a row names, so the same suite
 * covers every provider this component is configured for.
 */
import assert from 'node:assert/strict'
import { join } from 'node:path'
import { test } from 'node:test'
import {
  createHost,
  mockConfig,
  readRecords,
  removeDir,
  requestRecord,
  startRequest,
  tempDir,
} from './support/harness.mjs'

const { apply } = await import('../lib/acp.js')

/**
 * Run one scenario to completion.
 * @param scenario - the mock agent's scenario.
 * @param options - `config` overrides and an optional explicit `cwd`.
 * @returns the directory, records, result, and run handle (caller disposes).
 */
async function runScenario(scenario, options = {}) {
  const dir = options.cwd ?? tempDir(scenario)
  const recordPath = join(dir, 'record.jsonl')
  const host = createHost()
  await apply(host.ctx, mockConfig(recordPath, scenario, { cwd: dir, ...options.config }))
  const provider = host.provider()
  assert.ok(provider, 'the plugin must register a provider')
  const controller = new AbortController()
  const request = startRequest(dir, options.text ?? 'hello', controller.signal)
  const run = await provider.start(request)
  return { dir, recordPath, host, provider, run, controller, records: () => readRecords(recordPath) }
}

test('happy path: handshake, prompt, folded answer, and a child that really exits', async () => {
  const dir = tempDir('happy')
  const recordPath = join(dir, 'record.jsonl')
  const host = createHost()
  await apply(host.ctx, mockConfig(recordPath, 'happy'))
  const provider = host.provider()
  assert.equal(provider.name, 'acp', 'the default registry name matches the Host generic ACP backend')
  assert.deepEqual(provider.capabilities, {
    agentOptions: false, outputSchema: false, depthLimit: false, toolFilter: false, persona: false,
  })
  assert.equal(provider.inheritsParentContext, false)

  // No `cwd` in the config: the child inherits the delegating session's cwd.
  const run = await provider.start(startRequest(dir, 'do the thing'))
  assert.equal(typeof run.id, 'string')
  assert.equal(run.localAgent, undefined)

  const result = await run.result
  assert.deepEqual(result, { output: [{ type: 'text', text: 'pong' }], stopReason: 'completed' })

  await run.dispose()
  const records = readRecords(recordPath)
  assert.equal(requestRecord(records, 'initialize').params.protocolVersion, 1)
  assert.deepEqual(requestRecord(records, 'initialize').params.clientCapabilities, {})
  assert.equal(requestRecord(records, 'initialize').params.clientInfo.name, 'dsh-session-map/acp')
  assert.equal(requestRecord(records, 'session/new').params.cwd, dir)
  assert.deepEqual(requestRecord(records, 'session/new').params.mcpServers, [])
  assert.deepEqual(requestRecord(records, 'session/prompt').params.prompt, [{ type: 'text', text: 'do the thing' }])
  assert.equal(
    records.some(record => record.method === 'session/set_mode'), false,
    'no mode configured means the agent keeps its own default',
  )
  assert.equal(records.at(-1).kind, 'exit', 'the child process must be gone after dispose')
  removeDir(dir)
})

test('non-text prompt blocks are dropped', async () => {
  const dir = tempDir('mixed')
  const recordPath = join(dir, 'record.jsonl')
  const host = createHost()
  await apply(host.ctx, mockConfig(recordPath, 'happy', { cwd: dir }))
  const request = startRequest(dir)
  request.prompt = [
    { type: 'image', data: 'not-forwarded' },
    { type: 'text', text: 'only text' },
    'not-a-block',
    { type: 'text', text: ' survives' },
  ]
  const run = await host.provider().start(request)
  await run.result
  await run.dispose()
  assert.deepEqual(requestRecord(readRecords(recordPath), 'session/prompt').params.prompt, [
    { type: 'text', text: 'only text' },
    { type: 'text', text: ' survives' },
  ])
  removeDir(dir)
})

test('permission: allow picks the one-shot approval and finishes', async () => {
  const { run, records, dir } = await runScenario('permission', { config: { permission: 'allow' } })
  const result = await run.result
  assert.equal(result.stopReason, 'completed')
  await run.dispose()
  const answer = records().find(record => record.kind === 'permission-answer')
  assert.deepEqual(answer.answer.result, { outcome: { outcome: 'selected', optionId: 'opt-once' } })
  removeDir(dir)
})

test('permission: reject declines instead of approving', async () => {
  const { run, records, dir } = await runScenario('permission', { config: { permission: 'reject' } })
  const result = await run.result
  assert.equal(result.stopReason, 'completed')
  await run.dispose()
  const answer = records().find(record => record.kind === 'permission-answer')
  assert.deepEqual(answer.answer.result, { outcome: { outcome: 'cancelled' } })
  removeDir(dir)
})

test('blocking extension requests are answered and never stall the run', async () => {
  const { run, records, dir } = await runScenario('extension')
  const result = await run.result
  assert.equal(result.stopReason, 'completed')
  assert.deepEqual(result.output, [{ type: 'text', text: 'pong' }])
  await run.dispose()
  const answers = records()
  assert.deepEqual(answers.find(record => record.kind === 'ask-question-answer').answer.result, {})
  assert.deepEqual(answers.find(record => record.kind === 'create-plan-answer').answer.result, {})
  removeDir(dir)
})

test('a configured mode is switched to when the agent advertises it', async () => {
  const { run, records, dir } = await runScenario('mode', { config: { mode: 'plan' } })
  const result = await run.result
  assert.equal(result.stopReason, 'completed')
  await run.dispose()
  const setMode = requestRecord(records(), 'session/set_mode')
  assert.deepEqual(setMode.params, { sessionId: 'mock-session-1', modeId: 'plan' })
  removeDir(dir)
})

test('a mode the agent does not advertise is left alone and reported in the diagnostic', async () => {
  const { run, records, dir } = await runScenario('mode-missing', { config: { mode: 'plan' } })
  const result = await run.result
  await run.dispose()
  assert.equal(records().some(record => record.method === 'session/set_mode'), false)
  assert.match(result.diagnostic, /ACP mode unavailable \(requested: plan; the agent kept its own\)/)
  removeDir(dir)
})

test('configured session options are applied to the new session', async () => {
  const { run, records, dir } = await runScenario('config-options', {
    config: { configOptions: { model: 'mock/fast', verbose: true } },
  })
  const result = await run.result
  assert.equal(result.stopReason, 'completed')
  await run.dispose()
  const applied = records().filter(record => record.method === 'session/set_config_option')
  assert.deepEqual(applied.map(record => record.params), [
    { sessionId: 'mock-session-1', configId: 'model', value: 'mock/fast' },
    { sessionId: 'mock-session-1', configId: 'verbose', type: 'boolean', value: true },
  ])
  removeDir(dir)
})

test('a session option the agent refuses fails startup and names the option', async () => {
  const dir = tempDir('config-option-rejected')
  const recordPath = join(dir, 'record.jsonl')
  const host = createHost()
  await apply(host.ctx, mockConfig(recordPath, 'config-option-rejected', { cwd: dir, configOptions: { model: 'nope' } }))
  await assert.rejects(
    host.provider().start(startRequest(dir)),
    /dsh-session-map\/acp: ACP failure \(provider: acp; stage: new-session; category: configuration; config option: model\)/,
  )
  assert.equal(readRecords(recordPath).at(-1).kind, 'exit', 'the unpublished child must be reaped')
  removeDir(dir)
})

test('a stray non-frame line on stdout does not break the conversation', async () => {
  const { run, dir } = await runScenario('noise')
  const result = await run.result
  await run.dispose()
  assert.equal(result.stopReason, 'completed')
  assert.deepEqual(result.output, [{ type: 'text', text: 'pong' }])
  removeDir(dir)
})

test('max_turn_requests is a failure, not a clean finish', async () => {
  const { run, dir } = await runScenario('max-turns')
  const result = await run.result
  await run.dispose()
  assert.equal(result.stopReason, 'error')
  assert.match(result.diagnostic, /^ACP failure \(provider: acp; stage: prompt; category: remote-limit/)
  assert.match(result.diagnostic, /max_turn_requests/)
  removeDir(dir)
})

test('a failed session/new rejects startup and reaps the child', async () => {
  const dir = tempDir('fail-new-session')
  const recordPath = join(dir, 'record.jsonl')
  const host = createHost()
  await apply(host.ctx, mockConfig(recordPath, 'fail-new-session', { cwd: dir }))
  const controller = new AbortController()
  await assert.rejects(
    host.provider().start(startRequest(dir, 'hello', controller.signal)),
    /ACP failure \(provider: acp; stage: new-session; category: protocol\)/,
  )
  const records = readRecords(recordPath)
  assert.equal(records.at(-1).kind, 'exit', 'the unpublished child must be reaped')
  removeDir(dir)
})

test('a prompt failure keeps raw payloads and paths out of the diagnostic', async () => {
  const { run, dir } = await runScenario('fail-prompt')
  const result = await run.result
  await run.dispose()
  assert.equal(result.stopReason, 'error')
  assert.match(result.diagnostic, /^ACP failure \(provider: acp; stage: prompt; category: protocol\)/)
  assert.doesNotMatch(result.diagnostic, /SENTINEL_SECRET/)
  assert.doesNotMatch(result.diagnostic, /\/etc\/passwd/)
  removeDir(dir)
})

test('cancellation settles aborted without waiting for the child', async () => {
  const dir = tempDir('slow')
  const recordPath = join(dir, 'record.jsonl')
  const host = createHost()
  await apply(host.ctx, mockConfig(recordPath, 'slow', { cwd: dir }))
  const controller = new AbortController()
  const run = await host.provider().start(startRequest(dir, 'never finishes', controller.signal))
  controller.abort()
  const result = await run.result
  assert.deepEqual(result, { output: [], stopReason: 'aborted' })
  await run.dispose()
  assert.equal(readRecords(recordPath).at(-1).kind, 'exit')
  removeDir(dir)
})

test('dispose is idempotent', async () => {
  const { run, dir } = await runScenario('happy')
  await run.result
  await run.dispose()
  await run.dispose()
  removeDir(dir)
})

test('an aborted request refuses to start a child at all', async () => {
  const dir = tempDir('aborted')
  const host = createHost()
  await apply(host.ctx, mockConfig(join(dir, 'record.jsonl'), 'happy', { cwd: dir }))
  const controller = new AbortController()
  controller.abort()
  await assert.rejects(host.provider().start(startRequest(dir, 'hello', controller.signal)), /aborted before the/)
  removeDir(dir)
})

test('two agents in one row get independent providers and their own tool rows', async () => {
  const dirA = tempDir('multi-a')
  const dirB = tempDir('multi-b')
  const host = createHost()
  await apply(host.ctx, {
    agents: [
      { ...mockConfig(join(dirA, 'record.jsonl'), 'happy').agents[0], name: 'first', cwd: dirA },
      { ...mockConfig(join(dirB, 'record.jsonl'), 'max-turns').agents[0], name: 'second', cwd: dirB },
    ],
  })
  assert.deepEqual(host.providers().map(provider => provider.name), ['first', 'second'])
  assert.deepEqual(
    host.entries().map(entry => entry.config),
    [
      { provider: 'first', toolName: 'subagent_first', backgroundMode: 'one-shot', maxDepth: 'provider-managed' },
      { provider: 'second', toolName: 'subagent_second', backgroundMode: 'one-shot', maxDepth: 'provider-managed' },
    ],
    'each agent gets its own delegation tool row pointing at its own provider',
  )

  const first = await host.providers()[0].start(startRequest(dirA, 'from first'))
  assert.equal((await first.result).stopReason, 'completed')
  await first.dispose()

  const second = await host.providers()[1].start(startRequest(dirB, 'from second'))
  const secondResult = await second.result
  await second.dispose()
  assert.equal(secondResult.stopReason, 'error')
  assert.match(secondResult.diagnostic, /provider: second/, 'the diagnostic names the agent that failed')
  assert.doesNotMatch(secondResult.diagnostic, /provider: first/)
  removeDir(dirA)
  removeDir(dirB)
})

test('a live agent-list change re-syncs providers and tool rows', async () => {
  const dir = tempDir('volatile')
  const host = createHost()
  const config = mockConfig(join(dir, 'record.jsonl'), 'happy', { cwd: dir })
  await apply(host.ctx, config)
  assert.deepEqual(host.providers().map(provider => provider.name), ['acp'])
  assert.equal(host.entries().length, 1)

  // What a settings write does: the Loader commits the new value into the
  // running reference, then emits the volatile-update event.
  config.agents = [
    { ...config.agents[0], name: 'added' },
  ]
  host.emitVolatileUpdate()
  await host.settled()
  assert.deepEqual(host.providers().map(provider => provider.name), ['added'], 'the old provider is withdrawn')
  assert.deepEqual(host.entries().map(entry => entry.config.provider), ['added'], 'and the stale tool row is gone')

  host.dispose()
  assert.deepEqual(host.providers(), [], 'fiber disposal withdraws the providers')
  assert.deepEqual(host.entries(), [], 'and removes the derived tool rows')
  removeDir(dir)
})

test('a rejected agent list keeps the running agents mounted', async () => {
  const dir = tempDir('rejected')
  const host = createHost()
  const config = mockConfig(join(dir, 'record.jsonl'), 'happy', { cwd: dir })
  await apply(host.ctx, config)
  config.agents = [{ ...config.agents[0], name: '' }]
  host.emitVolatileUpdate()
  await host.settled()
  assert.deepEqual(host.providers().map(provider => provider.name), ['acp'])
  assert.match(String(host.warnings.at(-1)[0]), /configuration rejected/)
  removeDir(dir)
})

test('a disabled agent mounts nothing', async () => {
  const dir = tempDir('disabled')
  const host = createHost()
  await apply(host.ctx, mockConfig(join(dir, 'record.jsonl'), 'happy', { cwd: dir, enabled: false }))
  assert.deepEqual(host.providers(), [])
  assert.deepEqual(host.entries(), [])
  removeDir(dir)
})

test('a mounted tool row that fails to load does not take the backend down', async () => {
  const dir = tempDir('mount-failure')
  const host = createHost()
  host.ctx.loader.create = async () => { throw new Error('loader refused') }
  await apply(host.ctx, mockConfig(join(dir, 'record.jsonl'), 'happy', { cwd: dir }))
  assert.deepEqual(host.providers().map(provider => provider.name), ['acp'], 'the provider still serves')
  assert.match(String(host.warnings.at(-1)[0]), /could not be mounted/)
  removeDir(dir)
})
