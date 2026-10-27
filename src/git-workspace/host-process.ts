/**
 * Host subprocess seam contracts plus the one git runner every route uses.
 *
 * The runner owns the parts that must be identical for every command: resolving
 * the executable once, per-invocation timeouts, external cancellation, collected
 * output limits, and the redacted command receipt the console renders.
 *
 * @module dsh-session-map/git-workspace/host-process
 */
import type { GitWindowErrorCode } from './git-types'
import {
  receiptOf,
  type GitInvocation,
} from './git-command'

/** Exit facts of one closed process. */
export interface SubprocessOutcome {
  readonly exitCode: number | null
  readonly signal: string | null
}

/** One offset-based read of a collected stream. */
export interface SubprocessOutputReader {
  readFrom(fromByte: number): { readonly text: string; readonly nextOffset?: number; readonly lossy?: boolean }
}

/** One spawned process, as far as the git runner needs. */
export interface SubprocessHandle {
  readonly done: Promise<SubprocessOutcome>
  readonly collected: {
    readonly stdout?: SubprocessOutputReader | undefined
    readonly stderr?: SubprocessOutputReader | undefined
  }
  terminate(): void
  waitForExit(signal?: AbortSignal): Promise<boolean>
}

/** Per-stream dispositions; every git invocation collects both outputs. */
export interface SubprocessStdio {
  readonly stdin: 'ignore'
  readonly stdout: { readonly maxBytes: number }
  readonly stderr: { readonly maxBytes: number }
}

/** A fully specified spawn request. */
export interface SubprocessSpawnSpec {
  readonly argv: readonly string[]
  readonly cwd: string
  readonly stdio: SubprocessStdio
  readonly graceMs: number
  readonly signal?: AbortSignal | undefined
  readonly env?: Readonly<Record<string, string | undefined>> | undefined
}

/** The subprocess seam this plugin calls. */
export interface SubprocessService {
  resolveExecutable(command: string, env?: Readonly<Record<string, string>>, signal?: AbortSignal): Promise<string>
  terminalEnvironment(signal?: AbortSignal): Promise<{ readonly platform: 'posix' | 'windows' }>
  spawn(spec: SubprocessSpawnSpec): SubprocessHandle
}

/** One failed git run, already classified for the response envelope. */
export class GitRunError extends Error {
  readonly code: GitWindowErrorCode
  readonly detail: string | undefined

  constructor(code: GitWindowErrorCode, message: string, detail?: string) {
    super(message)
    this.name = 'GitRunError'
    this.code = code
    this.detail = detail
  }
}

/** One finished git run. */
export interface GitRunResult {
  readonly stdout: string
  readonly stderr: string
  readonly exitCode: number | null
  readonly signal: string | null
  readonly ms: number
  readonly truncated: boolean
  readonly receipt: ReturnType<typeof receiptOf>
}

/** Grace period handed to the provider's termination procedure. */
const TERMINATION_GRACE_MS = 2_000

/** Stderr cap; diagnostics do not need the full stream. */
const STDERR_MAX_BYTES = 128 * 1024

/** The shared git runner. */
export class GitRunner {
  private readonly subprocess: SubprocessService
  private resolvedGit: string | undefined

  constructor(subprocess: SubprocessService) {
    this.subprocess = subprocess
  }

  /**
   * Resolve the git executable once per Host lifetime.
   * @returns the absolute executable path.
   * @throws GitRunError with `git-not-found` when no git exists.
   */
  async gitPath(): Promise<string> {
    if (this.resolvedGit !== undefined) return this.resolvedGit
    try {
      this.resolvedGit = await this.subprocess.resolveExecutable('git')
      return this.resolvedGit
    } catch (error) {
      throw new GitRunError(
        'git-not-found',
        'the git executable was not found on this machine',
        error instanceof Error ? error.message : String(error),
      )
    }
  }

  /**
   * Run one fully specified invocation.
   * @param invocation - argv, cwd, env, timeout and output caps.
   * @param external - optional caller cancellation.
   * @returns the finished stdout/stderr, exit facts and receipt.
   * @throws GitRunError for spawn failure, timeout or cancellation.
   */
  async run(
    invocation: GitInvocation,
    external?: AbortSignal,
    onProgress?: (line: string) => void,
  ): Promise<GitRunResult> {
    const controller = new AbortController()
    let timedOut = false
    let cancelled = false
    const timer = setTimeout(() => {
      timedOut = true
      controller.abort()
    }, invocation.timeoutMs)
    timer.unref?.()
    const onAbort = (): void => {
      cancelled = true
      controller.abort()
    }
    if (external?.aborted === true) onAbort()
    else external?.addEventListener('abort', onAbort, { once: true })

    const startedAt = Date.now()
    let handle: SubprocessHandle
    try {
      handle = this.subprocess.spawn({
        argv: invocation.argv,
        cwd: invocation.cwd,
        stdio: {
          stdin: 'ignore',
          stdout: { maxBytes: invocation.maxBytes },
          stderr: { maxBytes: STDERR_MAX_BYTES },
        },
        graceMs: TERMINATION_GRACE_MS,
        signal: controller.signal,
        env: invocation.env,
      })
    } catch (error) {
      clearTimeout(timer)
      external?.removeEventListener('abort', onAbort)
      throw new GitRunError('internal', 'git could not be started', error instanceof Error ? error.message : String(error))
    }

    // Progress is read incrementally from the collected streams. Fetch/push write
    // their progress to stderr, so both streams feed the same line sink; the
    // final batch read below still returns the complete output.
    let stdoutOffset = 0
    let stderrOffset = 0
    let pending = ''
    const drainProgress = (): void => {
      if (onProgress === undefined) return
      const stdoutRead = handle.collected.stdout?.readFrom(stdoutOffset)
      if (stdoutRead !== undefined) {
        stdoutOffset = stdoutRead.nextOffset ?? stdoutOffset + stdoutRead.text.length
        pending += stdoutRead.text
      }
      const stderrRead = handle.collected.stderr?.readFrom(stderrOffset)
      if (stderrRead !== undefined) {
        stderrOffset = stderrRead.nextOffset ?? stderrOffset + stderrRead.text.length
        pending += stderrRead.text
      }
      const lines = pending.split(/\r?\n/)
      pending = lines.pop() ?? ''
      for (const line of lines) {
        const trimmed = line.trim()
        if (trimmed !== '') onProgress(trimmed)
      }
    }
    const progressTimer = onProgress === undefined
      ? undefined
      : setInterval(drainProgress, 250)
    progressTimer?.unref?.()

    let outcome: SubprocessOutcome
    try {
      outcome = await handle.done
    } catch (error) {
      if (progressTimer !== undefined) clearInterval(progressTimer)
      clearTimeout(timer)
      external?.removeEventListener('abort', onAbort)
      const message = error instanceof Error ? error.message : String(error)
      if (timedOut) throw new GitRunError('timeout', 'the git command exceeded its time limit', message)
      if (cancelled) throw new GitRunError('cancelled', 'the git command was cancelled', message)
      throw new GitRunError('internal', 'the git process failed to start', message)
    } finally {
      clearTimeout(timer)
      external?.removeEventListener('abort', onAbort)
    }
    if (progressTimer !== undefined) clearInterval(progressTimer)
    drainProgress()

    const stdoutRead = handle.collected.stdout?.readFrom(0)
    const stderrRead = handle.collected.stderr?.readFrom(0)
    const truncated = stdoutRead?.lossy === true || stderrRead?.lossy === true
    const ms = Date.now() - startedAt
    if (timedOut) {
      throw new GitRunError('timeout', 'the git command exceeded its time limit', stderrRead?.text ?? '')
    }
    if (cancelled) {
      throw new GitRunError('cancelled', 'the git command was cancelled', stderrRead?.text ?? '')
    }
    return {
      stdout: stdoutRead?.text ?? '',
      stderr: stderrRead?.text ?? '',
      exitCode: outcome.exitCode,
      signal: outcome.signal,
      ms,
      truncated,
      receipt: receiptOf(invocation, outcome.exitCode, ms, { truncated }),
    }
  }
}
