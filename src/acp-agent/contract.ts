/**
 * Structural views of the three Host seams the ACP agent route consumes.
 *
 * This package's profile never carries `@deepseek-ai/*` (see `../acp/contract.ts`),
 * so a value import would fail at load and a type-only import would only work
 * while the product packages happen to be checked out next to this repository.
 * Both seams are duck-typed at the boundary, so local declarations ARE the
 * contract. What P0 established, and what each shape below therefore encodes:
 *
 * - `ctx.llm.registerAdapter(providers, adapter)` binds its Cordis effect to the
 *   **`llm` service's own context**, not the caller's, so registering from a
 *   preset scope would outlive that scope and be rejected by the preset
 *   activation audit. This route is therefore registered once at root scope.
 * - `registerAdapter` calls `providerInfo` and `providerRetryPolicy`
 *   unconditionally, so a duck-typed adapter must implement both.
 * - The chunk protocol is delta-tolerant: no `block-start`/`block-end` is
 *   required, and reasoning/text/tool-call blocks assemble in stream order.
 *
 * Provenance, and the list that must stay in sync:
 * - llm adapter + chunk protocol: `@deepseek-ai/dsh-llm`, `src/index.ts`
 *   (`LlmRuntime.registerAdapter`), `src/types.ts` (`StreamChunk`,
 *   `GenerateOptions`, `LlmResolvedModelInfo`), `src/assembler.ts`
 *   (`BlockAssembler`, the delta-tolerant assembly this route relies on).
 * - tool definition: `@deepseek-ai/dsh-tools`, `src/index.ts`
 *   (`ToolDefinition`), `src/schema.ts` (`defineTool`, whose returned object
 *   this route builds by hand because `defineTool` needs the product's schema
 *   DSL, which is not importable here).
 * - agent registry, used only to read one Session's cwd: `@deepseek-ai/dsh-agent`,
 *   `src/index.ts` (`AgentRegistry.get`).
 * - subprocess seam: `@deepseek-ai/dsh-subprocess`, `src/types.ts`
 *   (`SubprocessSpawnSpec`, `SubprocessHandle`).
 *
 * @module dsh-session-map/acp-agent/contract
 */
import type { Readable, Writable } from 'node:stream'
import type { PresetRegistry } from './presets'

/**
 * The raw chunk protocol this route emits. Only the variants an ACP update maps
 * onto are modelled; `block-start`/`block-end` are omitted on purpose because
 * the assembler derives blocks from deltas alone.
 */
export type StreamChunk =
  | { type: 'text-delta'; index: number; text: string }
  | { type: 'reasoning-delta'; index: number; text: string }
  | { type: 'tool-call-delta'; index: number; id: string; name: string; argumentsDelta: string }
  | { type: 'usage'; usage: { inputTokens: number; outputTokens: number } }
  | { type: 'finish'; reason: FinishReason }

/** The terminal reasons this route can produce. */
export type FinishReason =
  | { kind: 'stop' }
  | { kind: 'tool-calls' }
  | { kind: 'max-tokens' }
  | { kind: 'aborted'; failure: { message: string; code: string } }
  | { kind: 'error'; failure: { message: string; code: string } }

/**
 * One request-role message as this route reads it.
 *
 * `source.form` is the discriminator that matters. The Host injects its own
 * runtime context and skill catalog as user-role messages, so "the last user
 * message" is NOT the user's input: a producer-supplied `form`
 * (`snapshot`, `catalog`, `instructions`, `notice`) marks Host-authored context,
 * while a real input carries `kind: 'user'` with no `form` — or no `source` at
 * all, which is the shape of a freshly admitted prompt.
 */
export interface RequestMessage {
  readonly role?: string
  readonly content?: readonly { readonly type?: string; readonly text?: string }[]
  readonly source?: { readonly kind?: string; readonly form?: string }
}

/** The request fields this route reads. */
export interface GenerateOptions {
  readonly provider: string
  readonly model: string
  /** `compaction`/`session-title` reuse the Session route; see {@link import('./adapter.ts')}. */
  readonly purpose?: 'compaction' | 'session-title'
  readonly sessionId?: string
  readonly messages?: readonly RequestMessage[]
  readonly signal?: AbortSignal
}

/** Adapter metadata for one route, validated by `registerAdapter`. */
export interface ProviderInfo {
  readonly id: string
  readonly name: string
}

/** One model the catalog should offer for a route. */
export interface ModelInfo {
  readonly provider: string
  readonly id: string
  readonly name: string
  readonly description?: string
}

/** Resolved model metadata handed back to the runtime. */
export interface ResolvedModelInfo extends ModelInfo {
  readonly context?: { readonly contextWindow: number }
}

/** The bound call handle `prepareCall` returns. */
export interface PreparedCall {
  readonly model: ResolvedModelInfo
  stream(options: GenerateOptions): AsyncIterable<StreamChunk>
}

/** A live subprocess and its provider-managed process range. */
export interface SubprocessHandle {
  readonly stdin: Writable | undefined
  readonly stdout: Readable | undefined
  readonly done: Promise<{ exitCode: number | null; signal: string | null }>
  terminate(): void
  waitForExit(signal?: AbortSignal): Promise<boolean>
}

/** The fully specified spawn request; the seam applies no defaults. */
export interface SubprocessSpawnSpec {
  readonly argv: readonly string[]
  readonly cwd: string
  readonly stdio: { readonly stdin: 'pipe'; readonly stdout: 'pipe'; readonly stderr: 'inherit' }
  readonly graceMs: number
  readonly env: Record<string, string>
}

/** The Host filesystem surface this route uses. */
export interface HostFs {
  /**
   * @param path - the model- or peer-supplied path.
   * @param opts - optional cwd override and cancellation signal.
   * @returns the stable target the other calls take.
   */
  resolve(path: string, opts?: { cwd?: string; signal?: AbortSignal }): Promise<unknown>
  /**
   * @param target - a target from {@link HostFs.resolve}.
   * @param signal - aborts the read.
   * @returns the full decoded UTF-8 content.
   */
  readText(target: unknown, signal?: AbortSignal): Promise<string>
  /**
   * @param target - a target from {@link HostFs.resolve}.
   * @param content - the full new file content.
   * @param expected - write intent; omitted means unconditional.
   * @param signal - aborts before atomic publication.
   * @param sandboxPolicy - the per-call mode and workspace root to fence by.
   * @returns the write outcome.
   */
  writeText(
    target: unknown,
    content: string,
    expected?: unknown,
    signal?: AbortSignal,
    sandboxPolicy?: unknown,
  ): Promise<unknown>
}

/** The Host services this route injects, narrowed to what it uses. */
export interface HostContext {
  readonly logger: {
    warn(message: string, ...rest: unknown[]): void
    /** Used for the expected quiet states (`agents` empty is the shipped default). */
    debug(message: string, ...rest: unknown[]): void
  }
  /** The adapter registry, model catalog, and the re-dispatch entry point. */
  readonly llm: {
    registerAdapter(providers: string[], adapter: unknown): () => void
    listProviders(): readonly ProviderInfo[]
    /**
     * Re-dispatch a call to another registered route. Host utility requests
     * (compaction, session titles) reuse this Session's route; forwarding them
     * to a configured utility model goes through here so that model keeps its
     * own adapter, retry policy and pricing.
     * @param options - a full request naming the target provider and model.
     * @returns that adapter's raw chunk stream.
     */
    stream(options: unknown): AsyncIterable<unknown>
  }
  /** The tool registry the mirror tools are published through. */
  readonly tools: {
    register(definition: unknown): () => void
  }
  /** The process seam: spawn, environment scrub, and managed-range teardown. */
  readonly subprocess: {
    spawn(spec: SubprocessSpawnSpec): SubprocessHandle
  }
  /** Optional lookup; `agents` is present whenever the Agent loop is mounted. */
  get(service: 'agents'): {
    get(id: string): { readonly session?: { readonly header?: { readonly cwd?: string } } } | undefined
  } | undefined
  /**
   * Optional lookup of the preset registry. Absent in a base-only composition —
   * the registry ships with the web application — which is why the preset cards
   * are registered opportunistically rather than declared as rows.
   */
  get(service: 'agentPresets'): PresetRegistry | undefined
  /**
   * Optional lookup of the Host filesystem. Present in every practical
   * composition; its absence is what makes `fs: 'bridge'` fall back to
   * advertising no file capability at all.
   */
  get(service: 'fs'): HostFs | undefined
  /**
   * Optional lookup of the sandbox-policy service. A file write carries the
   * Session's resolved policy, so the sandbox fence is applied by the backend
   * rather than trusted to the remote agent.
   */
  get(service: 'sandboxPolicy'): {
    /**
     * @param request - the Session whose mode log supplies the override.
     * @returns the fully resolved per-call mode and absolute workspace root.
     */
    resolve(request?: { session?: unknown; mode?: string }): unknown
  } | undefined
  /**
   * Optional lookup of the approval service. Present whenever approvals are
   * composed; `approval: ask` needs it, and its absence falls back to the row's
   * own policy rather than to an unanswerable prompt.
   */
  get(service: 'approval'): {
    /**
     * Ask the composed answerers to decide one request. Requires an open turn:
     * the audit pair must sit inside the Session log's commit boundary, so an
     * idle ask rejects.
     * @param request - the pending decision.
     * @returns the closed outcome; `allowed-once` is the only grant.
     */
    request(request: {
      readonly agent: unknown
      readonly toolName: string
      readonly callId?: string
      readonly reason?: string
      readonly displayReason?: { readonly en: string; readonly [locale: string]: string }
      readonly signal?: AbortSignal
    }): Promise<'allowed-once' | 'rejected' | 'cancelled' | 'unavailable'>
  } | undefined
  /**
   * Run `callback` once the named services exist. Used to pick up a registry
   * that activates after this row.
   * @param services - service keys to wait for.
   * @param callback - receives a context in which they are available.
   */
  inject(services: string[], callback: (scoped: HostContext) => void): unknown
  /**
   * Register a disposer owned by this plugin's fiber.
   *
   * Needed explicitly here because neither registry scopes its disposer to the
   * caller: `registerAdapter` binds its effect to the `llm` service, so without
   * this the route would outlive its own row.
   * @param callback - returns the disposer to run at fiber disposal.
   * @param name - the effect's label in Cordis diagnostics.
   */
  effect(callback: () => () => void, name?: string): void
  /**
   * Subscribe to a loader lifecycle event. `loader/volatile-update` arrives when
   * a volatile configuration field (this row's `agents`) is committed in place.
   * @param event - the event name.
   * @param listener - invoked on each emission.
   * @returns the disposer removing this listener.
   */
  on(event: 'loader/volatile-update', listener: () => void): () => void
}
