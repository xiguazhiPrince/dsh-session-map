/**
 * Tests for the ACP client core.
 *
 * These cover what is true of any ACP CLI agent regardless of what a Session
 * does with it: how a `command` becomes an argv, which working directory a child
 * gets, and how the agent list resolves. They are also the most platform-specific
 * code in the package — a Windows launcher table, `.cmd` shims, PATH scans — so
 * they are worth keeping alive on their own.
 *
 * They run against the built `lib/acp-agent.js` and call the pure functions
 * directly rather than through a Host composition. That is why they survive the
 * removal of the delegation route, which used to be the only caller: the
 * behaviour did not belong to that route, only the wiring did.
 */
import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'

const { assertUsableCwd, resolveAcpCommand, resolveChildCwd, resolveOptions } = await import('../lib/acp-agent.js')

const WINDOWS = process.platform === 'win32'
const PREFIX = 'dsh-session-map/acp-core'

/**
 * One throwaway directory.
 * @param label - names the directory, for a failing run's readability.
 * @returns its absolute path.
 */
function tempDir(label) {
  return mkdtempSync(join(tmpdir(), `dsh-core-${label}-`))
}

/**
 * Remove a directory tree.
 * @param dir - the directory.
 */
function removeDir(dir) {
  rmSync(dir, { recursive: true, force: true })
}

/**
 * Resolve an argv against a given environment.
 * @param command - the configured command.
 * @param args - the configured arguments.
 * @param env - the environment to resolve against; defaults to the real one.
 * @returns the argv.
 */
function resolve(command, args, env) {
  return resolveAcpCommand(PREFIX, { command, args }, process.platform, env ?? process.env)
}

/**
 * An environment with one variable replaced.
 * @param name - the variable.
 * @param value - its new value.
 * @returns the derived environment.
 */
function envWith(name, value) {
  return { ...process.env, [name]: value }
}

test('the defaults are the ones the schema declares', () => {
  const resolved = resolveOptions({ agents: [{ name: 'x', command: 'y' }] })
  assert.equal(resolved.agents.length, 1)
  assert.equal(resolved.agents[0].providerName, 'x')
  assert.deepEqual(resolved.agents[0].args, ['acp'], 'the ACP subcommand is the default argument')
  assert.equal(resolved.agents[0].permission, 'allow', 'permission defaults to allow')
  assert.deepEqual(resolved.agents[0].env, {})
  assert.equal(resolved.disposeGraceMs, 3000)
  assert.equal(resolved.disposeEofGraceMs, 6000)
})

test('an explicit command and args are taken verbatim', () => {
  assert.deepEqual(resolve(process.execPath, ['acp', '--flag']), [process.execPath, 'acp', '--flag'])
})

test('environment values are stringified and config options keep their type', () => {
  const [agent] = resolveOptions({
    agents: [{ name: 'x', command: 'y', env: { A: 1, B: false }, configOptions: { model: 'fast', plan: true } }],
  }).agents
  assert.deepEqual(agent.env, { A: '1', B: 'false' })
  assert.deepEqual([...agent.configOptions], [['model', 'fast'], ['plan', true]])
})

test('a disabled agent is parsed and then dropped', () => {
  const resolved = resolveOptions({
    agents: [{ name: 'x', command: 'y', enabled: false }, { name: 'z', command: 'y' }],
  })
  assert.deepEqual(resolved.agents.map(agent => agent.providerName), ['z'])
})

test('an absent or empty configuration resolves to no agents', () => {
  for (const raw of [undefined, {}, { agents: [] }]) {
    assert.deepEqual(resolveOptions(raw).agents, [])
  }
})

test('windows resolves a known launcher to its real entry point', { skip: !WINDOWS }, () => {
  const root = tempDir('win-known')
  const versions = join(root, 'cursor-agent', 'versions')
  for (const [name, complete] of [['2026.01.01-old', true], ['2026.02.02-new', true], ['2026.03.03-partial', false]]) {
    mkdirSync(join(versions, name), { recursive: true })
    writeFileSync(join(versions, name, 'node.exe'), '')
    if (complete) writeFileSync(join(versions, name, 'index.js'), '')
  }
  try {
    const expected = join(versions, '2026.02.02-new')
    assert.deepEqual(
      resolve('cursor-agent', ['acp'], envWith('LOCALAPPDATA', root)),
      [join(expected, 'node.exe'), join(expected, 'index.js'), 'acp'],
    )
  } finally {
    removeDir(root)
  }
})

test('windows launches a PATH shim through the command interpreter', { skip: !WINDOWS }, () => {
  const root = tempDir('win-shim')
  writeFileSync(join(root, 'dsh-core-test-cli.cmd'), '@echo off\r\n')
  try {
    const argv = resolve('dsh-core-test-cli', ['acp'], envWith('PATH', `${root};${process.env['PATH'] ?? ''}`))
    const comspec = process.env['COMSPEC'] ?? 'cmd.exe'
    assert.equal(argv[0], comspec)
    assert.deepEqual(argv.slice(1, 4), ['/d', '/s', '/c'])
    assert.match(argv[4], /dsh-core-test-cli\.cmd/)
    assert.match(argv[4], /\bacp\b/)
  } finally {
    removeDir(root)
  }
})

test('windows resolves an npm shim to the binary it declares', { skip: !WINDOWS }, () => {
  const root = tempDir('win-shim-exe')
  const target = join(root, 'node_modules', 'fake-cli', 'bin', 'fake-cli.exe')
  mkdirSync(join(root, 'node_modules', 'fake-cli', 'bin'), { recursive: true })
  writeFileSync(target, '')
  writeFileSync(join(root, 'dsh-core-test-exe.cmd'), '@ECHO off\r\n"%dp0%\\node_modules\\fake-cli\\bin\\fake-cli.exe"   %*\r\n')
  try {
    const argv = resolve('dsh-core-test-exe', ['acp'], envWith('PATH', `${root};${process.env['PATH'] ?? ''}`))
    assert.deepEqual(argv, [target, 'acp'], 'a declared binary is spawned directly, with no interpreter hop')
  } finally {
    removeDir(root)
  }
})

test('windows puts a runtime in front of a shim that declares a script target', { skip: !WINDOWS }, () => {
  const root = tempDir('win-shim-script')
  const target = join(root, 'node_modules', 'fake-cli', 'bin', 'fake-cli.js')
  mkdirSync(join(root, 'node_modules', 'fake-cli', 'bin'), { recursive: true })
  writeFileSync(target, '')
  writeFileSync(
    join(root, 'dsh-core-test-script.cmd'),
    '@ECHO off\r\nendLocal & "%_prog%"  "%dp0%\\node_modules\\fake-cli\\bin\\fake-cli.js" %*\r\n',
  )
  try {
    const argv = resolve('dsh-core-test-script', ['acp'], envWith('PATH', `${root};${process.env['PATH'] ?? ''}`))
    assert.match(argv[0], /node\.exe$/i)
    assert.equal(argv[1], target)
    assert.equal(argv[2], 'acp')
  } finally {
    removeDir(root)
  }
})

test('windows prefers a real executable when a bare name resolves to a path shim', { skip: !WINDOWS }, () => {
  const argv = resolve('node', ['acp'])
  assert.match(argv[0], /node\.exe$/i)
  assert.equal(argv[1], 'acp')
})

test('windows reports a command that is nowhere on PATH', { skip: !WINDOWS }, () => {
  assert.throws(
    () => resolve('dsh-core-test-absent-cli', ['acp']),
    (error) => {
      assert.match(String(error), /"dsh-core-test-absent-cli" was not found on PATH/)
      assert.match(String(error), /Point `command` at an executable/)
      return true
    },
  )
})

test('posix spawns the named command directly', { skip: WINDOWS }, () => {
  assert.deepEqual(resolve('opencode', ['acp']), ['opencode', 'acp'])
})

test('a mis-typed agent list is refused with the key that is wrong', () => {
  const cases = [
    [{ command: 'x' }, /`agents\[0\]\.name` is required/],
    [{ name: 'x' }, /`agents\[0\]\.command` is required/],
    [{ name: 'x', command: 'y', args: 'acp' }, /`agents\[0\]\.args` must be an array of strings/],
    [{ name: 'x', command: 'y', mode: '' }, /`agents\[0\]\.mode` must be a non-empty string/],
    [{ name: 'x', command: 'y', permission: 'maybe' }, /`agents\[0\]\.permission` must be one of allow, reject/],
    [{ name: 'x', command: 'y', configOptions: { model: {} } }, /`agents\[0\]\.configOptions\.model` must be a string, number, or boolean/],
    [{ name: 'x', command: 'y', configOptions: [] }, /`agents\[0\]\.configOptions` must be a mapping of option ids to values/],
    [{ name: 'x', command: 'y', env: { A: {} } }, /`agents\[0\]\.env\.A` must be a string, number, or boolean/],
    [{ name: 'x', command: 'y', env: [] }, /`agents\[0\]\.env` must be a mapping/],
  ]
  for (const [agent, pattern] of cases) {
    assert.throws(() => resolveOptions({ agents: [agent] }), pattern, `accepted ${JSON.stringify(agent)}`)
  }
  assert.throws(
    () => resolveOptions({ agents: [{ name: 'x', command: 'y' }, { name: 'x', command: 'y' }] }),
    /duplicate agent name "x"/,
  )
  assert.throws(() => resolveOptions({ agents: 'nope' }), /`agents` must be an array/)
  assert.throws(() => resolveOptions('nope'), /config must be a mapping/)
})

test('timing bounds and a configured cwd are validated per agent', () => {
  const cases = [
    [{ disposeGraceMs: 0, agents: [{ name: 'x', command: 'y' }] }, /`disposeGraceMs` must be a positive finite number/],
    [{ disposeGraceMs: Number.POSITIVE_INFINITY, agents: [{ name: 'x', command: 'y' }] }, /`disposeGraceMs` must be a positive finite number/],
    [{ disposeEofGraceMs: 2 ** 40, agents: [{ name: 'x', command: 'y' }] }, /`disposeEofGraceMs` must be a positive finite number/],
    [{ agents: [{ name: 'x', command: 'y', cwd: '' }] }, /`agents\[0\]\.cwd` must be a non-empty string/],
    // A relative override is interpreted against the process launch directory
    // once, at resolution; a path that resolves nowhere is refused there rather
    // than at the first turn.
    [{ agents: [{ name: 'x', command: 'y', cwd: 'relative/path' }] }, /config agents\[0\]\.cwd is not an accessible directory/],
  ]
  for (const [raw, pattern] of cases) {
    assert.throws(() => resolveOptions(raw), pattern, `accepted ${JSON.stringify(raw)}`)
  }
  // A relative override that DOES exist is accepted, and resolves absolutely.
  const [agent] = resolveOptions({ agents: [{ name: 'x', command: 'y', cwd: 'src' }] }).agents
  assert.equal(agent.cwd, join(process.cwd(), 'src'))
})

test('the child working directory falls back to the parent session, and fails loud without either', () => {
  const dir = tempDir('cwd')
  try {
    assert.equal(resolveChildCwd(PREFIX, undefined, dir), dir, 'the parent session cwd is the child workspace')
    assert.equal(resolveChildCwd(PREFIX, dir, '/somewhere/else'), dir, 'a configured cwd wins')
    assert.throws(
      () => resolveChildCwd(PREFIX, undefined, undefined),
      /no working directory for the child/,
    )
    assert.throws(() => assertUsableCwd(PREFIX, 'probe', join(dir, 'absent')), /is not an accessible directory/)
    assert.throws(() => assertUsableCwd(PREFIX, 'probe', 'relative/path'), /must be an absolute path/)
    assert.equal(assertUsableCwd(PREFIX, 'probe', dir), dir)
  } finally {
    removeDir(dir)
  }
})
