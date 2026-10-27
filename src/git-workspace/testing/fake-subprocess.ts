/**
 * Scripted `subprocess` seam for Host and safety tests.
 *
 * The plugin never shells out directly: every git call goes through a
 * fully-specified spawn request. Tests therefore assert the exact argv, cwd,
 * env, stdio caps and abort signal the Host would hand the real seam, then
 * replay a scripted exit code / output — no real git process is involved.
 *
 * Test-only module: it is never imported by a build entry, so it does not ship.
 *
 * @module dsh-session-map/git-workspace/testing/fake-subprocess
 */

/** One recorded spawn request, narrowed to what the Git runner reads. */
export interface FakeSpawnSpec {
  readonly argv: readonly string[]
  readonly cwd: string
  readonly stdio: {
    readonly stdin: unknown
    readonly stdout: unknown
    readonly stderr: unknown
    readonly control?: unknown
  }
  readonly graceMs: number
  readonly signal?: AbortSignal | undefined
  readonly env?: Readonly<Record<string, string | undefined>> | undefined
}

/** One offset-based read of a collected stream. */
export interface FakeReadResult {
  readonly text: string
  readonly nextOffset: number
  readonly lossy: boolean
}

/** One collected stream reader. */
export interface FakeReader {
  readFrom(fromByte: number): FakeReadResult
}

/** Exit facts of one scripted process. */
export interface FakeOutcome {
  readonly exitCode: number | null
  readonly signal: string | null
}

/** One queued process result. */
export interface ScriptedOutcome {
  /** Exit code; defaults to 0. Use `null` for "killed by signal". */
  readonly exitCode?: number | null
  /** Terminating signal; defaults to null. */
  readonly signal?: string | null
  /** Text the collected stdout returns. */
  readonly stdout?: string
  /** Text the collected stderr returns. */
  readonly stderr?: string
  /** Marks both collected streams as having dropped their head. */
  readonly truncated?: boolean
  /** Delay before the process settles. */
  readonly delayMs?: number
  /** Reject `done` instead of resolving (spawn/provider failure). */
  readonly rejectWith?: Error
  /** Keep the process running until the spec's abort signal fires. */
  readonly holdUntilAbort?: boolean
}

/** The exclusive minimum a Git runner needs from one handle. */
export interface FakeHandle {
  readonly done: Promise<FakeOutcome>
  readonly collected: {
    readonly stdout?: FakeReader
    readonly stderr?: FakeReader
  }
  terminate(): void
  waitForExit(): Promise<boolean>
}

/** Build an offset reader over one settled stream. */
function readerOf(text: string, truncated: boolean): FakeReader {
  return {
    readFrom(fromByte: number): FakeReadResult {
      const start = Math.max(0, Math.min(fromByte, text.length))
      return { text: text.slice(start), nextOffset: text.length, lossy: truncated }
    },
  }
}

/** Wait one macrotask so abort listeners observe the signal. */
function immediate(): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, 0))
}

/** One open scripted process. */
class ScriptedHandle implements FakeHandle {
  readonly done: Promise<FakeOutcome>
  readonly collected: { readonly stdout?: FakeReader; readonly stderr?: FakeReader }
  private settle: ((outcome: FakeOutcome) => void) | null = null
  private reject: ((error: Error) => void) | null = null

  constructor(spec: FakeSpawnSpec, outcome: ScriptedOutcome) {
    const stdout = outcome.stdout ?? ''
    const stderr = outcome.stderr ?? ''
    const truncated = outcome.truncated === true
    this.collected = {
      stdout: readerOf(stdout, truncated),
      stderr: readerOf(stderr, truncated),
    }

    this.done = new Promise<FakeOutcome>((resolve, reject) => {
      this.settle = resolve
      this.reject = reject
    })

    const resolveWith = (outcome: FakeOutcome): void => {
      if (this.settle === null) return
      this.settle(outcome)
      this.settle = null
      this.reject = null
    }

    const finish = (): void => {
      resolveWith({ exitCode: outcome.exitCode ?? 0, signal: outcome.signal ?? null })
    }

    const settleAborted = (): void => {
      resolveWith({ exitCode: null, signal: 'SIGTERM' })
    }

    const fail = (error: Error): void => {
      if (this.reject === null) return
      this.reject(error)
      this.settle = null
      this.reject = null
    }

    if (outcome.rejectWith !== undefined) {
      const timer = setTimeout(() => fail(outcome.rejectWith as Error), outcome.delayMs ?? 0)
      timer.unref?.()
      return
    }

    if (outcome.holdUntilAbort === true) {
      if (spec.signal?.aborted === true) {
        void immediate().then(settleAborted)
      } else {
        spec.signal?.addEventListener('abort', settleAborted, { once: true })
      }
      return
    }

    const timer = setTimeout(finish, outcome.delayMs ?? 0)
    timer.unref?.()
  }

  terminate(): void {
    if (this.settle === null) return
    this.settle({ exitCode: null, signal: 'SIGTERM' })
    this.settle = null
    this.reject = null
  }

  async waitForExit(): Promise<boolean> {
    await this.done.catch(() => undefined)
    return true
  }
}

/** The scripted subprocess service; implements the structural seam the Host reads. */
export class FakeSubprocess {
  readonly spawns: FakeSpawnSpec[] = []
  private readonly queue: ScriptedOutcome[] = []
  private readonly gitPath: string
  private readonly platform: 'posix' | 'windows'
  private readonly failResolve: boolean

  constructor(options: {
    readonly gitPath?: string | undefined
    readonly platform?: 'posix' | 'windows' | undefined
    readonly failResolve?: boolean | undefined
  } = {}) {
    this.gitPath = options.gitPath ?? (options.platform === 'windows' ? 'C:\\git\\cmd\\git.exe' : '/usr/bin/git')
    this.platform = options.platform ?? 'posix'
    this.failResolve = options.failResolve === true
  }

  /** Queue results in spawn order; the last one repeats when exhausted. */
  queueOutcome(...outcomes: ScriptedOutcome[]): this {
    this.queue.push(...outcomes)
    return this
  }

  /** The last argv the Host asked for. */
  lastArgv(): readonly string[] | undefined {
    return this.spawns[this.spawns.length - 1]?.argv
  }

  async resolveExecutable(command: string): Promise<string> {
    if (this.failResolve) throw new Error(`executable not found: ${command}`)
    return this.gitPath
  }

  async terminalEnvironment(): Promise<{ platform: 'posix' | 'windows' }> {
    return { platform: this.platform }
  }

  spawn(spec: FakeSpawnSpec): FakeHandle {
    this.spawns.push(spec)
    const outcome = this.queue.length > 1 ? (this.queue.shift() as ScriptedOutcome) : (this.queue[0] ?? {})
    return new ScriptedHandle(spec, outcome)
  }
}
