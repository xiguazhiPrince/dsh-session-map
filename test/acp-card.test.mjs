/**
 * The ACP agents settings card's pure model: draft conversion, validation, list
 * edits, and the schema marker the card uses to find its own namespace.
 *
 * The React layer above this module only renders; every decision is here, which
 * is why this file needs no DOM and no React.
 */
import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  addAgent,
  defaultToolName,
  draftsFromValue,
  emptyAgent,
  formatPairs,
  isAcpNamespace,
  moveAgent,
  parseArgs,
  parsePairs,
  patchAgent,
  removeAgent,
  selectAcpNamespace,
  validateDrafts,
  valueFromDrafts,
} from '../lib/acp-model.js'

/** A complete, valid draft. */
function draft(overrides = {}) {
  return { ...emptyAgent(), name: 'cursor', command: 'cursor-agent', ...overrides }
}

test('a stored agent becomes a draft and back without losing anything', () => {
  const stored = {
    agents: [{
      name: 'cursor',
      command: 'cursor-agent',
      args: ['acp', '--flag'],
      mode: 'plan',
      permission: 'reject',
      toolName: 'subagent_cursor',
      cwd: 'C:\\work',
      env: { CURSOR_API_KEY: 'secret' },
      configOptions: { model: 'fast', verbose: true },
      enabled: false,
    }],
  }
  const { drafts, problems } = draftsFromValue(stored)
  assert.deepEqual(problems, [])
  assert.deepEqual(drafts, [{
    name: 'cursor',
    command: 'cursor-agent',
    args: 'acp --flag',
    mode: 'plan',
    permission: 'reject',
    toolName: 'subagent_cursor',
    cwd: 'C:\\work',
    env: 'CURSOR_API_KEY=secret',
    configOptions: 'model=fast\nverbose=true',
    enabled: false,
  }])

  const written = valueFromDrafts(drafts)
  assert.equal(written.ok, true)
  assert.deepEqual(written.value, [{
    name: 'cursor',
    command: 'cursor-agent',
    args: ['acp', '--flag'],
    mode: 'plan',
    permission: 'reject',
    toolName: 'subagent_cursor',
    cwd: 'C:\\work',
    env: { CURSOR_API_KEY: 'secret' },
    configOptions: { model: 'fast', verbose: 'true' },
    enabled: false,
  }])
})

test('the write drops empty optionals and every default', () => {
  const written = valueFromDrafts([draft()])
  assert.equal(written.ok, true)
  assert.deepEqual(written.value, [{ name: 'cursor', command: 'cursor-agent' }],
    'only the two required fields survive an otherwise default agent')
  assert.deepEqual(valueFromDrafts([draft({ args: '' })]).value, [{ name: 'cursor', command: 'cursor-agent' }])
})

test('an empty stored value is an empty card, not an error', () => {
  for (const value of [undefined, {}, { agents: [] }]) {
    assert.deepEqual(draftsFromValue(value).drafts, [])
  }
  assert.deepEqual(draftsFromValue({ agents: [null] }).problems, [{ index: 0, message: '这一项不是有效的 agent 配置' }])
})

test('validation mirrors what the backend enforces', () => {
  assert.deepEqual(validateDrafts([draft()]), [])
  assert.match(validateDrafts([draft({ name: '' })])[0].message, /名称必填/)
  assert.match(validateDrafts([draft({ command: '  ' })])[0].message, /命令必填/)
  assert.match(validateDrafts([draft({ name: 'a b' })])[0].message, /名称只能用/)
  assert.match(validateDrafts([draft({ toolName: 'Subagent Cursor' })])[0].message, /工具名只能用/)
  assert.deepEqual(
    validateDrafts([draft(), draft({ command: 'other' })]).map(problem => problem.index),
    [1],
    'only the second of two identically named agents is flagged',
  )
  assert.match(validateDrafts([draft({ env: 'no separator' })])[0].message, /环境变量：第 1 行不是 KEY=VALUE/)
  assert.match(validateDrafts([draft({ configOptions: 'a=1\na=2' })])[0].message, /会话选项：第 2 行的键 a 重复/)
  assert.deepEqual(valueFromDrafts([draft({ name: '' })]).ok, false, 'an invalid draft is never written')
})

test('a disabled agent still parses, so a half-written draft is not lost', () => {
  const written = valueFromDrafts([draft({ enabled: false })])
  assert.equal(written.ok, true)
  assert.deepEqual(written.value, [{ name: 'cursor', command: 'cursor-agent', enabled: false }])
})

test('KEY=VALUE parsing is forgiving about blanks and comments and strict about the rest', () => {
  assert.deepEqual(parsePairs('').value, {})
  assert.deepEqual(parsePairs('\n# comment\nA=1\n\nB= two words \n').value, { A: '1', B: 'two words' })
  assert.deepEqual(parsePairs('A=1\nA=1').ok, false)
  assert.deepEqual(parsePairs('=1').ok, false)
  assert.equal(formatPairs({ A: 1, B: true }), 'A=1\nB=true')
  assert.equal(formatPairs(undefined), '')
  assert.equal(formatPairs([1, 2]), '')
})

test('argument text honours double quotes and keeps empty-quoted tokens', () => {
  assert.deepEqual(parseArgs('acp'), ['acp'])
  assert.deepEqual(parseArgs('  acp   --flag  '), ['acp', '--flag'])
  assert.deepEqual(parseArgs('--path "C:\\Program Files\\x" --y'), ['--path', 'C:\\Program Files\\x', '--y'])
  assert.deepEqual(parseArgs('a "" b'), ['a', '', 'b'])
  assert.deepEqual(parseArgs(''), [])
})

test('list edits are pure and bound-checked', () => {
  const one = [draft()]
  const two = addAgent(one)
  assert.equal(two.length, 2)
  assert.equal(one.length, 1, 'the input list is never mutated')
  assert.equal(removeAgent(two, 0).length, 1)
  assert.equal(patchAgent(two, 1, { name: 'opencode' })[1].name, 'opencode')
  assert.equal(patchAgent(two, 1, { name: 'opencode' })[0].name, 'cursor')

  const three = [draft({ name: 'a' }), draft({ name: 'b' }), draft({ name: 'c' })]
  assert.deepEqual(moveAgent(three, 0, 1).map(entry => entry.name), ['b', 'a', 'c'])
  assert.deepEqual(moveAgent(three, 2, -1).map(entry => entry.name), ['a', 'c', 'b'])
  assert.deepEqual(moveAgent(three, 0, -1).map(entry => entry.name), ['a', 'b', 'c'], 'a move off the front is a no-op')
  assert.deepEqual(moveAgent(three, 2, 1).map(entry => entry.name), ['a', 'b', 'c'], 'a move off the back is a no-op')
})

test('the derived tool name matches the backend rule', () => {
  assert.equal(defaultToolName('cursor'), 'subagent_cursor')
  assert.equal(defaultToolName('my-agent.v2'), 'subagent_my_agent_v2')
  assert.equal(defaultToolName(''), 'subagent_agent')
})

test('the card recognises its own namespace from the real schema', async () => {
  // The genuine article: the schema the Host serves for the ACP row, built from
  // the same Config export the Loader reads.
  const { Config } = await import('../lib/acp.js')
  const schema = JSON.parse(JSON.stringify(Config.toJSON()))
  assert.equal(isAcpNamespace({ ns: 'subagent-acp', schema }), true)
  assert.equal(isAcpNamespace({ ns: 'whatever-it-was-renamed-to', schema }), true, 'the row id does not matter')
  assert.equal(isAcpNamespace({ ns: 'subagent-acp' }), false, 'a namespace with no schema is not ours')

  const other = { ns: 'llm-pi-ai', schema: JSON.parse(JSON.stringify(Config.toJSON())) }
  // A different plugin's schema, structurally near but not ours.
  const foreignRoot = other.schema.refs[other.schema.uid]
  delete other.schema.refs[foreignRoot.dict.agents].inner
  assert.equal(isAcpNamespace(other), false, 'an agents array without agent items is not ours')
})

test('namespace selection prefers the schema marker and falls back to the shipped id', async () => {
  const { Config } = await import('../lib/acp.js')
  const schema = JSON.parse(JSON.stringify(Config.toJSON()))
  const other = { ns: 'subagent', schema: { uid: 1, refs: { 1: { type: 'object', dict: {} } } } }

  assert.equal(selectAcpNamespace([other, { ns: 'renamed', schema }], 'subagent-acp'), 'renamed')
  assert.equal(
    selectAcpNamespace([other, { ns: 'subagent-acp' }], 'subagent-acp'),
    'subagent-acp',
    'an unreadable schema still falls back to the shipped row id',
  )
  assert.equal(selectAcpNamespace([other], 'subagent-acp'), undefined, 'nothing of ours is served')
})
