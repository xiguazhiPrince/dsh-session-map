/**
 * P11 unit suite: the ACP mode vocabulary both halves share.
 *
 * The composer control reads the agent's modes from the text a command settles with,
 * so that text is a wire format with two readers in two processes. These tests pin
 * it: what a writer emits, what a reader recovers, and how a line that names an agent
 * is split.
 */
import assert from 'node:assert/strict'
import test from 'node:test'

const {
  EMPTY_ACP_MODES,
  MODE_REPORT_PREFIX,
  formatModeReport,
  parseModeArgv,
  parseModeReport,
  readModeState,
  readModeView,
} = await import('../lib/acp-mode-model.js')

/** What `cursor-agent` actually advertises, captured by the P11 probe. */
const CURSOR_MODES = {
  currentModeId: 'agent',
  availableModes: [
    { id: 'agent', name: 'Agent', description: 'Full agent capabilities with tool access' },
    { id: 'plan', name: 'Plan', description: 'Read-only mode for planning and designing before implementation' },
    { id: 'ask', name: 'Ask', description: 'Q&A mode - no edits or command execution' },
  ],
}

test('an agent’s advertised modes are read into the shared vocabulary', () => {
  assert.deepEqual(readModeState(CURSOR_MODES), {
    available: [
      { id: 'agent', name: 'Agent', description: 'Full agent capabilities with tool access' },
      { id: 'plan', name: 'Plan', description: 'Read-only mode for planning and designing before implementation' },
      { id: 'ask', name: 'Ask', description: 'Q&A mode - no edits or command execution' },
    ],
    current: 'agent',
  })
  assert.equal(readModeState(undefined), undefined)
  assert.equal(readModeState({ availableModes: [] }), undefined, 'an empty roster is not a choice')
  assert.equal(readModeState({ availableModes: [{ name: 'nameless' }, { id: 'has space' }] }), undefined)
  assert.deepEqual(
    readModeState({ availableModes: [{ id: 'plan' }, { id: 'agent' }], currentModeId: 'gone' }),
    { available: [{ id: 'plan', name: 'plan' }, { id: 'agent', name: 'agent' }], current: 'plan' },
    'a client must never be handed a value it cannot select',
  )
  assert.equal(readModeView({ available: [{ id: 'plan', name: 'Plan' }], current: 'plan' }).current, 'plan')
  assert.equal(readModeView(EMPTY_ACP_MODES), undefined)
})

test('the report text round-trips, and a name cannot break it', () => {
  const state = readModeState(CURSOR_MODES)
  const line = formatModeReport(state)
  assert.equal(line, 'ACP mode: agent=Agent (current), plan=Plan, ask=Ask')
  assert.ok(line.startsWith(MODE_REPORT_PREFIX))
  assert.deepEqual(
    parseModeReport(line).available.map((mode) => mode.id),
    ['agent', 'plan', 'ask'],
  )
  assert.deepEqual(parseModeReport(line).current, 'agent')

  // A separator inside a name would make the line ambiguous; the id survives.
  const awkward = readModeState({
    availableModes: [{ id: 'plan', name: 'Plan, but = weird' }, { id: 'ask', name: 'Ask' }],
    currentModeId: 'ask',
  })
  const awkwardLine = formatModeReport(awkward)
  const parsed = parseModeReport(awkwardLine)
  assert.deepEqual(parsed.available.map((mode) => mode.id), ['plan', 'ask'])
  assert.equal(parsed.current, 'ask')

  assert.deepEqual(parseModeReport('ACP mode: plan').available, [{ id: 'plan', name: 'plan' }])
  assert.equal(parseModeReport('something else'), undefined)
  assert.equal(parseModeReport(undefined), undefined)
  assert.equal(parseModeReport('ACP mode: '), undefined)
})

test('a command line splits into an optional agent and an optional mode', () => {
  assert.deepEqual(parseModeArgv(''), {})
  assert.deepEqual(parseModeArgv('  plan '), { modeId: 'plan' })
  assert.deepEqual(parseModeArgv('@cursor'), { agent: 'cursor' })
  assert.deepEqual(parseModeArgv('@cursor plan'), { agent: 'cursor', modeId: 'plan' })
  assert.deepEqual(parseModeArgv('plan @cursor'), { agent: 'cursor', modeId: 'plan' }, 'order does not matter')
  assert.deepEqual(parseModeArgv('plan extra'), { modeId: 'plan' }, 'only the first bare token is a mode')
})
