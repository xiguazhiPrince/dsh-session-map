#!/usr/bin/env node
/**
 * A scripted ACP agent for the driver tests.
 *
 * It speaks newline-delimited JSON-RPC 2.0 on stdout/stdin exactly as
 * `cursor-agent acp` does, so the driver under test can be exercised end to end
 * without Cursor, a login, or a network. The scenario is chosen by argv[2]; the
 * process appends every frame it receives (and what it resolved for its own
 * outbound requests) to `MOCK_ACP_RECORD` as JSONL, which the test asserts
 * against. A final `{"kind":"exit"}` record proves the process really left.
 */
import { appendFileSync } from 'node:fs'

const scenario = process.argv[2] ?? 'happy'
const recordPath = process.env['MOCK_ACP_RECORD']
const SESSION_ID = 'mock-session-1'

/** Append one observable fact for the test to assert on. */
function record(entry) {
  if (recordPath !== undefined) appendFileSync(recordPath, `${JSON.stringify(entry)}\n`)
}

let nextId = 1
const pending = new Map()
let buffer = ''

/** Write one frame. */
function send(message) {
  process.stdout.write(`${JSON.stringify(message)}\n`)
}

/** Answer a client request. */
function respond(id, result) {
  send({ jsonrpc: '2.0', id, result })
}

/** Fail a client request with a JSON-RPC error. */
function respondError(id, code, message) {
  send({ jsonrpc: '2.0', id, error: { code, message } })
}

/** Emit a session/update notification. */
function update(updatePayload) {
  send({ jsonrpc: '2.0', method: 'session/update', params: { sessionId: SESSION_ID, update: updatePayload } })
}

/** Ask the client something and resolve with its response frame. */
function request(method, params) {
  const id = nextId++
  const promise = new Promise((resolve) => { pending.set(id, resolve) })
  send({ jsonrpc: '2.0', id, method, params })
  return promise
}

/** The permission options every scenario offers; `allow_once` is deliberately first. */
const PERMISSION_OPTIONS = [
  { optionId: 'opt-once', name: 'Allow once', kind: 'allow_once' },
  { optionId: 'opt-always', name: 'Allow always', kind: 'allow_always' },
  { optionId: 'opt-no', name: 'Reject', kind: 'reject_once' },
]

/**
 * The option set the current session published, replaced on every `session/new`.
 *
 * It is mutated by `session/set_config_option` and re-published in the response,
 * because that is what a real agent does (measured against cursor-agent): the
 * response carries the FULL new option set, which is the only way a client
 * learns what its selection actually resolved to.
 */
let configOptions = []

/** The scripted option set for this scenario. */
function initialConfigOptions() {
  const modes = [{ value: 'agent', name: 'Agent' }, { value: 'plan', name: 'Plan' }]
  if (scenario === 'no-model-option') {
    return [{ id: 'mode', name: 'Mode', category: 'mode', type: 'select', currentValue: 'agent', options: modes }]
  }
  if (scenario === 'model-list' || scenario === 'config-update') {
    return [
      { id: 'mode', name: 'Mode', category: 'mode', type: 'select', currentValue: 'agent', options: modes },
      {
        id: 'model',
        name: 'Model',
        category: 'model',
        type: 'select',
        currentValue: 'mock/one',
        options: [
          { value: 'mock/one', name: 'Mock One', description: 'the scripted first model' },
          // A group, in the shape ACP defines (`{group, name, options}` — a group
          // has no `value` of its own), so the client's flattening is exercised
          // rather than assumed.
          { group: 'grouped', name: 'Grouped Values', options: [{ value: 'mock/two', name: 'Mock Two' }] },
          { value: 'mock/three', name: 'Mock Three' },
        ],
      },
      { id: 'verbose', name: 'Verbose', category: 'thought_level', type: 'boolean', currentValue: false },
    ]
  }
  return [{ id: 'model', name: 'Model', category: 'model', type: 'select', currentValue: 'mock/default', options: [] }]
}

/** Emit a final assistant chunk, then answer the prompt. */
async function answerPrompt(id) {
  if (scenario === 'config-update') {
    // The agent re-publishes its whole option set mid-turn, as a real one does
    // when something else changed the selection. It carries no assistant content,
    // so a client that mistook it for content would append an empty text block.
    update({
      sessionUpdate: 'config_option_update',
      configOptions: configOptions.map((entry) => (entry.id === 'model' ? { ...entry, currentValue: 'mock/three' } : entry)),
    })
  }
  const text = scenario === 'empty' ? '' : 'pong'
  if (text !== '') {
    update({ sessionUpdate: 'agent_thought_chunk', content: { type: 'text', text: 'thinking' } })
    update({ sessionUpdate: 'agent_message_chunk', content: { type: 'text', text: 'po' } })
    update({ sessionUpdate: 'agent_message_chunk', content: { type: 'text', text: 'ng' } })
    update({ sessionUpdate: 'tool_call', toolCallId: 't1', title: 'ignored', kind: 'read', status: 'pending' })
  }
  if (scenario === 'max-turns' || scenario === 'mode-missing') {
    respond(id, { stopReason: 'max_turn_requests' })
    return
  }
  respond(id, { stopReason: 'end_turn' })
}

/** Dispatch one inbound frame. */
async function handle(message) {
  if (message.id !== undefined && message.method === undefined) {
    const resolve = pending.get(message.id)
    pending.delete(message.id)
    record({ kind: 'response', id: message.id, message })
    resolve?.(message)
    return
  }
  record({ kind: 'request', method: message.method, params: message.params })
  switch (message.method) {
    case 'initialize': {
      if (scenario === 'noise') {
        // Documented Cursor hazard: stdout is not guaranteed to carry only
        // JSON-RPC frames (the CLI can emit a large base64 wasm payload).
        process.stdout.write('NOT-JSON: a stray line that is not a frame\n')
      }
      respond(message.id, { protocolVersion: 1, authMethods: [{ id: 'cursor_login', name: 'Cursor login' }] })
      return
    }
    case 'session/new': {
      if (scenario === 'fail-new-session') {
        respondError(message.id, -32000, 'authentication required SENTINEL_SECRET')
        return
      }
      let modes = { currentModeId: 'agent', availableModes: [{ id: 'agent', name: 'Agent' }] }
      if (scenario === 'mode') {
        modes = { currentModeId: 'ask', availableModes: [{ id: 'ask', name: 'Ask' }, { id: 'plan', name: 'Plan' }] }
      }
      if (scenario === 'mode-missing') {
        modes = { currentModeId: 'ask', availableModes: [{ id: 'ask', name: 'Ask' }] }
      }
      configOptions = initialConfigOptions()
      respond(message.id, {
        sessionId: SESSION_ID,
        modes,
        configOptions,
      })
      return
    }
    case 'session/set_mode': {
      respond(message.id, {})
      return
    }
    case 'session/set_config_option': {
      if (scenario === 'config-option-rejected') {
        respondError(message.id, -32000, 'unknown config option SENTINEL_SECRET')
        return
      }
      // Accept the write and re-publish the whole set, with the selection the
      // client asked for now in force.
      const option = configOptions.find((entry) => entry.id === message.params?.configId)
      if (option !== undefined) {
        option.currentValue = option.type === 'boolean' ? message.params?.value === true : message.params?.value
      }
      respond(message.id, { configOptions })
      return
    }
    case 'session/prompt': {
      if (scenario === 'slow') return
      if (scenario === 'fail-prompt') {
        respondError(message.id, -32000, 'boom SENTINEL_SECRET /etc/passwd')
        return
      }
      if (scenario === 'permission') {
        const answer = await request('session/request_permission', {
          sessionId: SESSION_ID,
          toolCall: { toolCallId: 't1', kind: 'execute', title: 'Run a command' },
          options: PERMISSION_OPTIONS,
        })
        record({ kind: 'permission-answer', answer })
      }
      if (scenario === 'fs') {
        // Exercises the client's advertised filesystem capability: the paths come
        // from the harness so the same scenario can point at a real workspace file.
        const readPath = process.env['MOCK_ACP_READ']
        if (readPath !== undefined) {
          record({ kind: 'fs-read', answer: await request('fs/read_text_file', { sessionId: SESSION_ID, path: readPath }) })
        }
        const writePath = process.env['MOCK_ACP_WRITE']
        if (writePath !== undefined) {
          record({
            kind: 'fs-write',
            answer: await request('fs/write_text_file', {
              sessionId: SESSION_ID,
              path: writePath,
              content: 'written through the host filesystem',
            }),
          })
        }
      }
      if (scenario === 'extension') {
        const askAnswer = await request('cursor/ask_question', {
          sessionId: SESSION_ID,
          question: 'Which database?',
          options: ['postgres', 'sqlite'],
        })
        record({ kind: 'ask-question-answer', answer: askAnswer })
        const planAnswer = await request('cursor/create_plan', { sessionId: SESSION_ID, plan: 'do things' })
        record({ kind: 'create-plan-answer', answer: planAnswer })
      }
      await answerPrompt(message.id)
      return
    }
    default:
      if (message.id !== undefined) respondError(message.id, -32601, `unhandled: ${String(message.method)}`)
  }
}

process.on('exit', () => { record({ kind: 'exit' }) })

process.stdin.setEncoding('utf8')
process.stdin.on('data', (chunk) => {
  buffer += chunk
  let index
  while ((index = buffer.indexOf('\n')) >= 0) {
    const line = buffer.slice(0, index).trim()
    buffer = buffer.slice(index + 1)
    if (line === '') continue
    let message
    try {
      message = JSON.parse(line)
    } catch {
      // A non-frame line from the client is a protocol error, not our concern.
      continue
    }
    handle(message).catch((error) => { record({ kind: 'handler-error', message: String(error) }) })
  }
})

// Keep the loop alive until the client closes stdin.
process.stdin.resume()
