/**
 * Tests for command resolution, config validation, and the spawn spec the
 * driver hands the Host process seam. These use a recording spawn stub, so the
 * resolved argv can be asserted without launching anything.
 */
import assert from 'node:assert/strict'
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { test } from 'node:test'
import { createHost, readRecords, removeDir, startRequest, tempDir } from './support/harness.mjs'

const { apply } = await import('../lib/acp.js')

const WINDOWS = process.platform === 'win32'
const START_FAILED = /ACP failure \(provider: acp; stage: process; category: process-start\)/

/**
 * A spawn stub that records the spec and refuses to launch anything.
 * @param captured - array the specs are pushed into.
 * @returns the spawn function.
 */
function recordingSpawn(captured) {
  return (spec) => {
    captured.push(spec)
    throw new Error('spawn stub: refusing to spawn')
  }
}

/**
 * Run one row to the point where it hands a spec to the process seam.
 * @param config - the row configuration.
 * @param cwd - the delegating parent session cwd.
 * @returns the captured spec.
 */
async function captureSpawn(config, cwd) {
  const captured = []
  const host = createHost({ spawn: recordingSpawn(captured) })
  await apply(host.ctx, { agents: [{ name: 'acp', ...config, cwd }] })
  await assert.rejects(host.provider().start(startRequest(cwd)), START_FAILED)
  assert.equal(captured.length, 1, 'exactly one spawn attempt')
  return captured[0]
}

/**
 * Run one row and return the error it failed with instead of asserting a spawn.
 * @param config - the row configuration.
 * @param cwd - the delegating parent session cwd.
 * @returns the rejection.
 */
async function captureStartError(config, cwd) {
  const host = createHost({ spawn: recordingSpawn([]) })
  await apply(host.ctx, { agents: [{ name: 'acp', ...config, cwd }] })
  try {
    await host.provider().start(startRequest(cwd))
  } catch (error) {
    return error
  }
  throw new Error('expected the start to reject')
}

test('the provider takes the defaults when the row declares only a command', async () => {
  const dir = tempDir('defaults')
  const captured = []
  const host = createHost({ spawn: recordingSpawn(captured) })
  await apply(host.ctx, { agents: [{ name: 'acp', command: process.execPath, cwd: dir }] })
  assert.equal(host.provider().name, 'acp')
  await assert.rejects(host.provider().start(startRequest(dir)), START_FAILED)
  assert.deepEqual(captured[0].argv, [process.execPath, 'acp'], 'the ACP subcommand is the default argument')
  assert.equal(captured[0].graceMs, 3000)
  assert.deepEqual(captured[0].env, {})
  removeDir(dir)
})

test('an explicit command and args win over every discovery rule', async () => {
  const dir = tempDir('explicit')
  const spec = await captureSpawn(
    { command: process.execPath, args: ['acp', '--flag'], env: { A: 1, B: false } },
    dir,
  )
  assert.deepEqual(spec.argv, [process.execPath, 'acp', '--flag'])
  assert.deepEqual(spec.stdio, { stdin: 'pipe', stdout: 'pipe', stderr: 'inherit' })
  assert.equal(spec.cwd, dir)
  assert.deepEqual(spec.env, { A: '1', B: 'false' })
  removeDir(dir)
})

test('the parent session cwd is the child workspace when none is configured', async () => {
  const dir = tempDir('parent-cwd')
  const spec = await captureSpawn({ command: process.execPath }, dir)
  assert.equal(spec.cwd, dir)
  removeDir(dir)
})

test('a parent session without a cwd fails loud instead of guessing', async () => {
  const host = createHost({ spawn: recordingSpawn([]) })
  await apply(host.ctx, { agents: [{ name: 'acp', command: process.execPath }] })
  const request = { signal: new AbortController().signal, prompt: [], parent: { session: { header: {} } } }
  await assert.rejects(host.provider().start(request), /no working directory for the child/)
})

test('windows resolves a known launcher to its real entry point', { skip: !WINDOWS }, async () => {
  const root = tempDir('win-known')
  const versions = join(root, 'cursor-agent', 'versions')
  for (const [name, complete] of [['2026.01.01-old', true], ['2026.02.02-new', true], ['2026.03.03-partial', false]]) {
    mkdirSync(join(versions, name), { recursive: true })
    writeFileSync(join(versions, name, 'node.exe'), '')
    if (complete) writeFileSync(join(versions, name, 'index.js'), '')
  }
  const previous = process.env['LOCALAPPDATA']
  process.env['LOCALAPPDATA'] = root
  try {
    const spec = await captureSpawn({ command: 'cursor-agent' }, root)
    const expected = join(versions, '2026.02.02-new')
    assert.deepEqual(spec.argv, [join(expected, 'node.exe'), join(expected, 'index.js'), 'acp'])
  } finally {
    restoreEnv('LOCALAPPDATA', previous)
    removeDir(root)
  }
})

test('windows launches a PATH shim through the command interpreter', { skip: !WINDOWS }, async () => {
  const root = tempDir('win-shim')
  const shim = join(root, 'dsh-acp-test-cli.cmd')
  writeFileSync(shim, '@echo off\r\n')
  const previous = process.env['PATH']
  process.env['PATH'] = `${root};${previous ?? ''}`
  try {
    const spec = await captureSpawn({ command: 'dsh-acp-test-cli' }, root)
    const comspec = process.env['COMSPEC'] ?? 'cmd.exe'
    assert.equal(spec.argv[0], comspec)
    assert.deepEqual(spec.argv.slice(1, 4), ['/d', '/s', '/c'])
    assert.match(spec.argv[4], /dsh-acp-test-cli\.cmd/)
    assert.match(spec.argv[4], /\bacp\b/)
  } finally {
    restoreEnv('PATH', previous)
    removeDir(root)
  }
})

test('windows resolves an npm shim to the binary it declares', { skip: !WINDOWS }, async () => {
  const root = tempDir('win-shim-exe')
  const target = join(root, 'node_modules', 'fake-cli', 'bin', 'fake-cli.exe')
  mkdirSync(join(root, 'node_modules', 'fake-cli', 'bin'), { recursive: true })
  writeFileSync(target, '')
  writeFileSync(join(root, 'dsh-acp-test-exe.cmd'), `@ECHO off\r\n"%dp0%\\node_modules\\fake-cli\\bin\\fake-cli.exe"   %*\r\n`)
  const previous = process.env['PATH']
  process.env['PATH'] = `${root};${previous ?? ''}`
  try {
    const spec = await captureSpawn({ command: 'dsh-acp-test-exe' }, root)
    assert.deepEqual(spec.argv, [target, 'acp'], 'a declared binary is spawned directly, with no interpreter hop')
  } finally {
    restoreEnv('PATH', previous)
    removeDir(root)
  }
})

test('windows puts a runtime in front of a shim that declares a script target', { skip: !WINDOWS }, async () => {
  const root = tempDir('win-shim-script')
  const target = join(root, 'node_modules', 'fake-cli', 'bin', 'fake-cli.js')
  mkdirSync(join(root, 'node_modules', 'fake-cli', 'bin'), { recursive: true })
  writeFileSync(target, '')
  writeFileSync(
    join(root, 'dsh-acp-test-script.cmd'),
    `@ECHO off\r\nendLocal & "%_prog%"  "%dp0%\\node_modules\\fake-cli\\bin\\fake-cli.js" %*\r\n`,
  )
  const previous = process.env['PATH']
  process.env['PATH'] = `${root};${previous ?? ''}`
  try {
    const spec = await captureSpawn({ command: 'dsh-acp-test-script' }, root)
    assert.match(spec.argv[0], /node\.exe$/i)
    assert.equal(spec.argv[1], target)
    assert.equal(spec.argv[2], 'acp')
  } finally {
    restoreEnv('PATH', previous)
    removeDir(root)
  }
})

test('windows runs a whole conversation through a real command-interpreter shim', { skip: !WINDOWS }, async () => {
  const dir = tempDir('win-shim-e2e')
  const recordPath = join(dir, 'record.jsonl')
  // A launcher with no parseable target, forwarding to the scripted agent: the
  // only route left is the interpreter, and this proves the JSON-RPC stream
  // survives it.
  writeFileSync(
    join(dir, 'dsh-acp-test-forward.cmd'),
    `@ECHO off\r\nnode "${join(process.cwd(), 'test', 'mock-acp-agent.mjs')}" happy %*\r\n`,
  )
  const previousPath = process.env['PATH']
  process.env['PATH'] = `${dir};${previousPath ?? ''}`
  try {
    const host = createHost()
    await apply(host.ctx, {
      agents: [{
        name: 'forward',
        command: 'dsh-acp-test-forward',
        args: [],
        cwd: dir,
        env: { MOCK_ACP_RECORD: recordPath },
      }],
    })
    const run = await host.provider().start(startRequest(dir, 'through a shim'))
    const result = await run.result
    await run.dispose()
    assert.equal(result.stopReason, 'completed')
    assert.deepEqual(result.output, [{ type: 'text', text: 'pong' }])
    assert.equal(readRecords(recordPath).at(-1).kind, 'exit')
  } finally {
    restoreEnv('PATH', previousPath)
    removeDir(dir)
  }
})

test('windows prefers a real executable when a bare name resolves to a path shim', { skip: !WINDOWS }, async () => {
  const dir = tempDir('win-node')
  const spec = await captureSpawn({ command: 'node' }, dir)
  assert.match(spec.argv[0], /node\.exe$/i)
  assert.equal(spec.argv[1], 'acp')
  removeDir(dir)
})

test('windows reports a command that is nowhere on PATH', { skip: !WINDOWS }, async () => {
  const dir = tempDir('win-missing')
  const error = await captureStartError({ command: 'dsh-acp-test-absent-cli' }, dir)
  assert.match(String(error), /"dsh-acp-test-absent-cli" was not found on PATH/)
  assert.match(String(error), /Point `command` at an executable/)
  removeDir(dir)
})

test('posix spawns the named command directly', { skip: WINDOWS }, async () => {
  const dir = tempDir('posix')
  const spec = await captureSpawn({ command: 'opencode' }, dir)
  assert.deepEqual(spec.argv, ['opencode', 'acp'])
  removeDir(dir)
})

test('a mis-typed agent is reported and mounts nothing', async () => {
  const cases = [
    [{ agents: [{ command: 'x' }] }, /agents\[0\]\.name` is required/],
    [{ agents: [{ name: 'x' }] }, /agents\[0\]\.command` is required/],
    [{ agents: [{ name: 'x', command: 'y', args: 'acp' }] }, /`agents\[0\]\.args` must be an array of strings/],
    [{ agents: [{ name: 'x', command: 'y', mode: '' }] }, /`agents\[0\]\.mode` must be a non-empty string/],
    [{ agents: [{ name: 'x', command: 'y', permission: 'maybe' }] }, /`agents\[0\]\.permission` must be one of allow, reject/],
    [{ agents: [{ name: 'x', command: 'y', configOptions: { model: {} } }] }, /`agents\[0\]\.configOptions\.model` must be a string, number, or boolean/],
    [{ agents: [{ name: 'x', command: 'y', configOptions: [] }] }, /`agents\[0\]\.configOptions` must be a mapping of option ids to values/],
    [{ agents: [{ name: 'x', command: 'y', env: { A: {} } }] }, /`agents\[0\]\.env\.A` must be a string, number, or boolean/],
    [{ agents: [{ name: 'x', command: 'y', env: [] }] }, /`agents\[0\]\.env` must be a mapping/],
    [{ agents: [{ name: 'x', command: 'y' }, { name: 'x', command: 'y' }] }, /duplicate agent name "x"/],
    [{ agents: 'nope' }, /`agents` must be an array/],
    ['nope', /config must be a mapping/],
  ]
  for (const [config, pattern] of cases) {
    const host = createHost()
    await apply(host.ctx, config)
    assert.deepEqual(host.providers(), [], `nothing mounts for ${JSON.stringify(config)}`)
    assert.deepEqual(host.entries(), [])
    assert.match(String(host.warnings.at(-1)?.[1]), pattern)
  }
})

test('timing bounds and a configured cwd are validated per agent', async () => {
  const cases = [
    [{ disposeGraceMs: 0, agents: [{ name: 'x', command: 'y' }] }, /`disposeGraceMs` must be a positive finite number/],
    [{ disposeGraceMs: Number.POSITIVE_INFINITY, agents: [{ name: 'x', command: 'y' }] }, /`disposeGraceMs` must be a positive finite number/],
    [{ disposeEofGraceMs: 2 ** 40, agents: [{ name: 'x', command: 'y' }] }, /`disposeEofGraceMs` must be a positive finite number/],
    [{ agents: [{ name: 'x', command: 'y', cwd: '' }] }, /`agents\[0\]\.cwd` must be a non-empty string/],
    // A relative override is interpreted against the Harness launch directory
    // once, at load (the same rule the sibling ACP backend applies); a path that
    // resolves nowhere is refused there rather than per delegation.
    [{ agents: [{ name: 'x', command: 'y', cwd: 'relative/path' }] }, /config agents\[0\]\.cwd is not an accessible directory/],
  ]
  for (const [config, pattern] of cases) {
    const host = createHost()
    await apply(host.ctx, config)
    assert.deepEqual(host.providers(), [])
    assert.match(String(host.warnings.at(-1)?.[1]), pattern)
  }

  const host = createHost()
  await apply(host.ctx, { agents: [{ name: 'x', command: 'y', cwd: 'src' }] })
  assert.equal(host.warnings.length, 0, 'a relative override that exists is accepted')
  assert.deepEqual(host.providers().map(provider => provider.name), ['x'])
})

test('an absent or empty row configuration mounts nothing and reports nothing', async () => {
  for (const config of [undefined, {}, { agents: [] }]) {
    const host = createHost()
    await apply(host.ctx, config)
    assert.deepEqual(host.providers(), [])
    assert.deepEqual(host.entries(), [])
    assert.deepEqual(host.warnings, [])
  }
})

/**
 * Restore one environment variable.
 * @param name - the variable name.
 * @param previous - its previous value, or `undefined`.
 */
function restoreEnv(name, previous) {
  if (previous === undefined) delete process.env[name]
  else process.env[name] = previous
}
