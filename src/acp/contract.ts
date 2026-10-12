/**
 * Structural views of the two Host seams this driver consumes.
 *
 * Neither seam is importable here, and that is deliberate. This package is
 * installed into a profile whose `node_modules` never carries `@deepseek-ai/*`
 * — the Harness resolves its own packages from the installation directory —
 * so a value import would fail at load. A type-only import would work only
 * while the (prerelease) product packages happen to be installed in this
 * repository, which the sibling client half already refuses for the same
 * reason (see `../client/index.ts`). Both seams are duck-typed at the
 * boundary, so local declarations ARE the contract:
 *
 * - `ctx.subagents.registerProvider` reads `name`, `capabilities`,
 *   `inheritsParentContext`, and `start`; the returned handle is read for
 *   `id`, `localAgent`, `result`, and `dispose`.
 * - `ctx.subprocess.spawn` takes a fully specified spec and hands back piped
 *   streams plus the managed-range verbs.
 *
 * Provenance, and the list that must stay in sync:
 * - provider / run / result / stop reasons: `@deepseek-ai/dsh-subagent`,
 *   `src/types.ts` ({@link SubagentProvider} `:344`, {@link SubagentRun}
 *   `:308`, {@link SubagentResult} `:271`) and `src/index.ts` `:512`.
 * - spawn spec and handle: `@deepseek-ai/dsh-subprocess`, `src/types.ts`
 *   ({@link SubprocessSpawnSpec} `:77`, {@link SubprocessHandle} `:169`).
 *
 * @module dsh-session-map/acp/contract
 */
import type { Readable, Writable } from 'node:stream'

/**
 * One text content block. The Host block vocabulary is wider; this driver
 * produces text and reads text, so the narrower shape is the whole surface it
 * needs — `output` is the child's final assistant text, nothing else.
 */
export interface TextBlock {
  readonly type: 'text'
  readonly text: string
}

/**
 * The Host stop-reason vocabulary this driver can produce, mirroring
 * `SubagentStopReasonMap` in `@deepseek-ai/dsh-subagent`. That map is
 * merge-extensible, so an unrecognized ACP terminal reason must never be
 * reported as a clean finish; it maps to `'error'` instead.
 */
export type SubagentStopReason = 'completed' | 'max-tokens' | 'refusal' | 'aborted' | 'error'

/** The terminal outcome of one run, shaped for the Host's result boundary. */
export interface SubagentResult {
  /** The child's final assistant text; `[]` when it produced none. */
  readonly output: readonly TextBlock[]
  /**
   * Provider-authored, non-assistant failure detail for a non-`completed`
   * result. Never carries paths, payloads, environment values, or credentials,
   * and never exceeds 4096 UTF-8 bytes.
   */
  readonly diagnostic?: string
  /** Why the run ended. */
  readonly stopReason: SubagentStopReason
}

/** The published one-shot child handle. */
export interface SubagentRun {
  /** Parent-scoped run id, unique in the parent namespace. */
  readonly id: string
  /** Always `undefined`: an out-of-process child has no local Agent. */
  readonly localAgent: undefined
  /** Resolves with the terminal result; does not reject for a child-level failure. */
  readonly result: Promise<SubagentResult>
  /** Cancel remaining work and reach child quiescence. Idempotent. */
  dispose(): Promise<void>
}

/**
 * The advertised start-time capabilities. Every one is `false`: a child in
 * another process cannot honour a parent-enforced option, so the service must
 * reject such a request before `start` runs rather than accept-then-ignore it.
 */
export interface SubagentCapabilities {
  readonly agentOptions: boolean
  readonly outputSchema: boolean
  readonly depthLimit: boolean
  readonly toolFilter: boolean
  readonly persona: boolean
}

/** The request fields this driver reads. */
export interface SubagentStartRequest {
  /** The caller's cancellation channel. */
  readonly signal: AbortSignal
  /** The task content blocks, in order; non-text blocks are dropped. */
  readonly prompt: readonly unknown[]
  /** The delegating parent; its session header carries the default workspace. */
  readonly parent: {
    readonly session: {
      readonly header: {
        readonly cwd?: string | undefined
      }
    }
  }
}

/** One registered transport for running child agents. */
export interface SubagentProvider {
  /** Unique registry name on `ctx.subagents`. */
  readonly name: string
  /** The start-time features this provider supports. */
  readonly capabilities: SubagentCapabilities
  /** Whether the child sees the parent's completed-turn prefix. */
  readonly inheritsParentContext: boolean
  /**
   * Establish a one-shot child and return its handle after publication. Before
   * fulfillment the provider owns setup and reaps unpublished resources.
   * @param request - prompt, parent, and the cancellation signal.
   * @returns the published run handle.
   */
  start(request: SubagentStartRequest): Promise<SubagentRun>
}

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

/** The Host services this plugin injects, narrowed to what it uses. */
export interface HostContext {
  /** Host log sink; provider failures keep their original Error here. */
  readonly logger: {
    warn(message: string, ...rest: unknown[]): void
  }
  /** The subagent provider registry. */
  readonly subagents: {
    /** @param provider - the trusted provider implementation. */
    registerProvider(provider: SubagentProvider): () => void
  }
  /** The process seam: spawn, environment scrub, and managed-range teardown. */
  readonly subprocess: {
    /** @param spec - the fully specified spawn request. */
    spawn(spec: SubprocessSpawnSpec): SubprocessHandle
  }
  /**
   * The Loader's entry tree. This backend MOUNTS one derived delegation-tool row
   * per configured agent; `create` resolves once that row's plugin activated.
   */
  readonly loader: {
    /** @param options - the row to add. @returns settlement of the row's activation. */
    create(options: { readonly name: string; readonly config?: unknown; readonly disabled?: boolean }): Promise<unknown>
    /** @param id - the row id to stop and remove. */
    remove(id: string): void
  }
  /**
   * Subscribe to a loader lifecycle event. `loader/volatile-update` arrives on
   * the owning fiber when a volatile configuration field is committed in place,
   * which is the signal to re-read the agent list.
   * @param event - the event name.
   * @param listener - invoked on each emission.
   * @returns the disposer removing this listener.
   */
  on(event: 'loader/volatile-update', listener: () => void): () => void
  /**
   * Register a disposer owned by this plugin's fiber.
   * @param callback - returns the disposer to run at fiber disposal.
   * @param name - the effect's label in Cordis diagnostics.
   */
  effect(callback: () => () => void, name?: string): void
}
