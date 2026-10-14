/**
 * P11 unit suite: the ACP collaboration-mode surface.
 *
 * The interesting parts of this phase are decisions rather than I/O: whether a switch
 * goes to a live channel or is held for the first one, and what a `/acp-mode` line
 * means. Those are driven here against the built artifact, with a fake Host context
 * standing in for the command registry.
 *
 * The Session-projection design this phase started with is deliberately absent: a
 * projection needs a Session event, and the read path refuses a type outside the
 * build's catalogue without an `ignorable` marker `Session.append` cannot set. The
 * surface goes through the one supported path, a command.
 */
import assert from 'node:assert/strict'
import test from 'node:test'

const {
  ACP_MODE_COMMAND,
  EMPTY_ACP_MODES,
  installAcpModes,
  planModeSwitch,
  readModeState,
} = await import('../lib/acp-modes.js')

/** What `cursor-agent` actually advertises, captured by the P11 probe. */
const CURSOR_MODES = {
  currentModeId: 'agent',
  availableModes: [
    { id: 'agent', name: 'Agent', description: 'Full agent capabilities with tool access' },
    { id: 'plan', name: 'Plan', description: 'Read-only mode for planning and designing before implementation' },
    { id: 'ask', name: 'Ask', description: 'Q&A mode - no edits or command execution' },
  ],
}

/**
 * A Host context that records what the surface registers.
 * @returns the fake context and its observables.
 */
function fakeHost() {
  const warnings = []
  const commands = []
  const ctx = {
    logger: {
      warn: (message, ...rest) => { warnings.push([message, ...rest]) },
      debug: () => {},
    },
    inject: (services, callback) => {
      const scope = {}
      if (services.includes('commands')) {
        scope.commands = { register: (definition) => { commands.push(definition); return () => {} } }
      }
      callback(scope)
    },
    effect: (callback) => { callback() },
    get: () => undefined,
    on: () => () => {},
  }
  return { ctx, warnings, commands }
}

test('the command grammar reports, switches, or refuses by name', () => {
  const state = readModeState(CURSOR_MODES)
  assert.deepEqual(planModeSwitch(state, undefined), {
    kind: 'report',
    text: 'ACP mode: agent=Agent (current), plan=Plan, ask=Ask',
  })
  assert.deepEqual(planModeSwitch(state, 'plan'), { kind: 'set', modeId: 'plan' })
  assert.deepEqual(planModeSwitch(state, 'nope'), {
    kind: 'error',
    text: 'Unknown ACP mode "nope". Available: agent, plan, ask',
  })
  assert.equal(planModeSwitch(EMPTY_ACP_MODES, 'plan').kind, 'error')
  assert.match(planModeSwitch(EMPTY_ACP_MODES, undefined).text, /no connected ACP agent/)
})

test('the surface registers one command and switches the attached channel', async () => {
  const host = fakeHost()
  const surface = installAcpModes(host.ctx)
  assert.equal(host.commands.length, 1, 'exactly one command')
  assert.equal(host.commands[0].name, ACP_MODE_COMMAND)
  assert.equal(host.commands[0].input.hint, '[@agent] [mode]')
  const handler = host.commands[0].handler

  const asked = []
  let current = readModeState(CURSOR_MODES)
  const session = { header: { id: 's1' } }
  surface.attach(session, {
    modeState: () => current,
    setMode: async (modeId) => { asked.push(modeId); current = { ...current, current: modeId } },
  })

  assert.deepEqual(await handler({ agent: { session }, rawInput: '@cursor' }), {
    kind: 'success',
    text: 'ACP mode: agent=Agent (current), plan=Plan, ask=Ask',
  })
  assert.deepEqual(await handler({ agent: { session }, rawInput: '@cursor plan' }), {
    kind: 'success',
    text: 'ACP mode: plan',
  })
  assert.deepEqual(asked, ['plan'])
  assert.equal((await handler({ agent: { session }, rawInput: '@cursor bogus' })).kind, 'error')
  assert.equal(asked.length, 1, 'a refused id never reaches the agent')

  const refusing = { header: { id: 's2' } }
  surface.attach(refusing, {
    modeState: () => current,
    setMode: async () => { throw new Error('session/refused') },
  })
  assert.deepEqual(await handler({ agent: { session: refusing }, rawInput: '@cursor ask' }), {
    kind: 'error',
    text: 'The agent refused mode "ask".',
  })
  assert.equal(host.warnings.length, 1, 'the refusal is reported once, in the Host log')
})

test('without a channel the report comes from the route probe and a pick is held', async () => {
  const host = fakeHost()
  const probed = []
  const surface = installAcpModes(host.ctx, {
    probe: async (agentName) => { probed.push(agentName); return readModeState(CURSOR_MODES) },
  })
  const handler = host.commands[0].handler
  const session = { header: { id: 's1' } }

  // What the composer control does on mount, before the Session's first message.
  assert.deepEqual(await handler({ agent: { session }, rawInput: '@cursor' }), {
    kind: 'success',
    text: 'ACP mode: agent=Agent (current), plan=Plan, ask=Ask',
  })
  assert.deepEqual(probed, ['cursor'])

  assert.deepEqual(await handler({ agent: { session }, rawInput: '@cursor plan' }), {
    kind: 'success',
    text: 'ACP mode: plan (applies when the agent connects)',
  })
  assert.equal(surface.takeWanted(session), 'plan', 'the first channel adopts it')
  assert.equal(surface.takeWanted(session), undefined, 'and only once')

  // A line that names no agent has nothing to report from.
  assert.match((await handler({ agent: { session }, rawInput: '' })).text, /no connected ACP agent/)
})

test('a probe that finds nothing is reported as a failure, not as a mode', async () => {
  const host = fakeHost()
  installAcpModes(host.ctx, { probe: async () => undefined })
  const handler = host.commands[0].handler
  const session = { header: { id: 's1' } }
  assert.equal((await handler({ agent: { session }, rawInput: '@cursor' })).kind, 'error')
  assert.equal((await handler({ agent: { session }, rawInput: '@cursor plan' })).kind, 'error')
})
