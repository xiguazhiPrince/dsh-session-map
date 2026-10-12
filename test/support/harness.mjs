/**
 * Shared fixtures for the Cursor ACP driver tests.
 *
 * The tests drive the BUILT artifact (`lib/cursor-acp.js`) through the plugin's
 * public surface — `apply(ctx, config)` then `provider.start(request)` — against
 * a stub Host context and a real child process running the scripted ACP agent.
 * That keeps the assertions on the seam contract (what the driver sends, what it
 * returns, whether the child really exits) rather than on internal helpers.
 */
import { spawn } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

/** Absolute path of the scripted ACP agent. */
export const MOCK_AGENT = fileURLToPath(new URL('../mock-acp-agent.mjs', import.meta.url))

/**
 * Create a throwaway directory.
 * @param label - marker included in the directory name.
 * @returns the absolute path.
 */
export function tempDir(label) {
  return mkdtempSync(join(tmpdir(), `dsh-cursor-acp-${label}-`))
}

/**
 * Remove a throwaway directory, ignoring failure.
 * @param dir - the directory to remove.
 */
export function removeDir(dir) {
  try {
    rmSync(dir, { recursive: true, force: true })
  } catch {
    // A leftover temp directory is not a test failure.
  }
}

/**
 * Read the mock agent's JSONL recording.
 * @param path - the recording path.
 * @returns the parsed records, or `[]` when nothing was written.
 */
export function readRecords(path) {
  try {
    return readFileSync(path, 'utf8')
      .split('\n')
      .filter(line => line !== '')
      .map(line => JSON.parse(line))
  } catch {
    return []
  }
}

/**
 * Spawn a real child and expose it through the Host subprocess handle shape.
 * @param spec - the spawn request the driver produced.
 * @returns a handle with `stdin`, `stdout`, `done`, `terminate`, and `waitForExit`.
 */
export function spawnChild(spec) {
  const [command, ...args] = spec.argv
  const child = spawn(command, args, {
    cwd: spec.cwd,
    env: { ...process.env, ...spec.env },
    stdio: ['pipe', 'pipe', 'inherit'],
  })
  let exited = false
  child.once('exit', () => { exited = true })
  return {
    stdin: child.stdin,
    stdout: child.stdout,
    done: new Promise((resolve, reject) => {
      child.once('error', reject)
      child.once('close', (code, signal) => resolve({ exitCode: code, signal }))
    }),
    terminate() {
      child.kill()
    },
    waitForExit(signal) {
      if (exited) return Promise.resolve(true)
      return new Promise((resolve) => {
        const onExit = () => {
          signal?.removeEventListener('abort', onAbort)
          resolve(true)
        }
        const onAbort = () => {
          child.removeListener('exit', onExit)
          resolve(false)
        }
        child.once('exit', onExit)
        signal?.addEventListener('abort', onAbort, { once: true })
      })
    },
  }
}

/**
 * Build a stub Host context that captures every registered provider and every
 * mounted loader entry, and can emit the Loader's volatile-update event.
 * @param options - an optional spawn override (defaults to a real child).
 * @returns the context, collected log lines, and provider/entry accessors.
 */
export function createHost(options = {}) {
  const warnings = []
  const providers = []
  const entries = []
  const listeners = new Map()
  const effects = []
  let entrySeq = 0
  const ctx = {
    logger: {
      warn(message, ...rest) { warnings.push([String(message), ...rest]) },
    },
    subagents: {
      registerProvider(candidate) {
        providers.push(candidate)
        return () => {
          const index = providers.indexOf(candidate)
          if (index >= 0) providers.splice(index, 1)
        }
      },
    },
    subprocess: { spawn: options.spawn ?? spawnChild },
    loader: {
      async create(entry) {
        // The real Loader's `create` resolves to the minted row id (a string).
        const id = `derived-${++entrySeq}`
        entries.push({ id, name: entry.name, config: entry.config })
        return id
      },
      remove(id) {
        const index = entries.findIndex(entry => entry.id === id)
        if (index >= 0) entries.splice(index, 1)
      },
    },
    on(event, listener) {
      const set = listeners.get(event) ?? new Set()
      set.add(listener)
      listeners.set(event, set)
      return () => { set.delete(listener) }
    },
    effect(callback) {
      effects.push(callback())
    },
  }
  return {
    ctx,
    warnings,
    /** @returns the last registered provider. */
    provider: () => providers.at(-1),
    /** @returns every registered provider, in registration order. */
    providers: () => [...providers],
    /** @returns every mounted loader row, in mount order. */
    entries: () => entries.map(entry => ({ ...entry })),
    /** Emit one Loader volatile-update. */
    emitVolatileUpdate() {
      for (const listener of listeners.get('loader/volatile-update') ?? []) listener()
    },
    /** Run every registered effect disposer, as fiber disposal would. */
    dispose() {
      for (const dispose of effects.reverse()) dispose()
    },
    /** Await the deferred sync work the plugin scheduled (a macrotask plus its queue). */
    async settled() {
      for (let turn = 0; turn < 5; turn += 1) await new Promise((resolve) => { setImmediate(resolve) })
    },
  }
}

/**
 * Build a start request with one text prompt.
 * @param cwd - the delegating parent session's workspace.
 * @param text - the task text.
 * @param signal - the cancellation signal (defaults to a fresh, never-aborted one).
 * @returns the request the provider's `start` consumes.
 */
export function startRequest(cwd, text = 'hello', signal = new AbortController().signal) {
  return {
    signal,
    prompt: [{ type: 'text', text }],
    parent: { session: { header: { cwd } } },
  }
}

/**
 * Build the config for one mock-agent row.
 * @param recordPath - where the mock agent records what it saw.
 * @param scenario - the mock agent's scenario.
 * @param agent - additional per-agent config fields (`name` defaults to `acp`).
 * @returns the row config.
 */
export function mockConfig(recordPath, scenario, agent = {}) {
  return {
    agents: [
      {
        name: 'acp',
        command: process.execPath,
        args: [MOCK_AGENT, scenario],
        env: { MOCK_ACP_RECORD: recordPath },
        ...agent,
      },
    ],
  }
}

/**
 * Find the first record with a `method`, or throw.
 * @param records - the parsed recording.
 * @param method - the ACP method to find.
 * @returns the record.
 */
export function requestRecord(records, method) {
  const found = records.find(record => record.kind === 'request' && record.method === method)
  if (found === undefined) throw new Error(`no recorded request for ${method}: ${JSON.stringify(records)}`)
  return found
}
