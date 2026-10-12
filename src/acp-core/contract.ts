/**
 * The process seam, as both ACP routes consume it.
 *
 * This package's profile never carries `@deepseek-ai/*`, so a value import would
 * fail at load and a type-only import would only work while the product packages
 * happen to be checked out next to this repository. The seam is duck-typed at
 * the boundary, so these local declarations ARE the contract.
 *
 * Provenance, and the list that must stay in sync: `@deepseek-ai/dsh-subprocess`,
 * `src/types.ts` ({@link SubprocessSpawnSpec}), `src/index.ts`.
 *
 * @module dsh-session-map/acp-core/contract
 */
import type { Readable, Writable } from 'node:stream'

/** The full spawn request. The seam applies no defaults, so every field is explicit. */
export interface SubprocessSpawnSpec {
  /** Executable and arguments; `argv[0]` is the program, never shell-interpreted. */
  readonly argv: readonly string[]
  /** Working directory for the child. */
  readonly cwd: string
  /** Per-stream dispositions: the protocol owns stdin and stdout, stderr is inherited. */
  readonly stdio: {
    readonly stdin: 'pipe'
    readonly stdout: 'pipe'
    readonly stderr: 'inherit'
  }
  /** Positive finite grace for the provider's termination procedure. */
  readonly graceMs: number
  /** Explicit entries merged onto the implementation's scrubbed parent environment. */
  readonly env: Record<string, string>
}

/** Exit facts of one closed process. */
export interface SubprocessOutcome {
  /** Exit code; `null` when the process died from a signal. */
  readonly exitCode: number | null
  /** Terminating signal; `null` on a normal exit. */
  readonly signal: string | null
}

/** A live subprocess and its provider-managed process range. */
export interface SubprocessHandle {
  /** The child's stdin, present iff spawned with `stdin: 'pipe'`. */
  readonly stdin: Writable | undefined
  /** The child's raw stdout, present iff spawned with `stdout: 'pipe'`. */
  readonly stdout: Readable | undefined
  /** Resolves with exit facts; rejects for spawn or provider failures. */
  readonly done: Promise<SubprocessOutcome>
  /** Begin the provider's termination procedure. Idempotent. */
  terminate(): void
  /**
   * Wait until the managed range is empty.
   * @param signal - optional bound for the wait.
   * @returns `true` when the range is empty, `false` when the signal aborted first.
   */
  waitForExit(signal?: AbortSignal): Promise<boolean>
}
