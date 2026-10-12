/**
 * The LLM adapter that makes a remote ACP agent look like a model route.
 *
 * This is the whole trick of the route, and it is worth stating why it is the
 * right seam rather than a clever hack. The Host's Session — its log, its
 * projections, its persistence, fork, titles, workspace diffing and Chat UI —
 * belongs to the Agent loop, not to any model. The loop reaches a model through
 * exactly one contract, `ctx.llm`. Putting ACP behind that contract therefore
 * gives the conversation every Host feature for free, instead of reimplementing
 * a second conversation surface inside a plugin.
 *
 * The one place the metaphor strains is the turn model: ACP runs a whole turn
 * per prompt, while the loop expects a call to end at each tool call. The
 * adapter resolves that by consuming the channel's signal queue and cutting the
 * stream at each newly seen remote tool call. See `./channel.ts` for the state
 * that makes the cut safe.
 *
 * @module dsh-session-map/acp-agent/adapter
 */
import type { ResolvedAgent } from '../acp-core/config'
import { resolveChildCwd } from '../acp-core/resolve'
import { AcpChannel, AcpChannelFailure, type ChannelSignal, type ToolCallRecord } from './channel'
import type { ApprovalMode, FsMode, UtilityRoute } from './config'
import type {
  GenerateOptions,
  HostContext,
  ModelInfo,
  PreparedCall,
  ProviderInfo,
  ResolvedModelInfo,
  StreamChunk,
} from './contract'

/**
 * The context window reported for an ACP route. A remote agent does not publish
 * one, and the Host uses this value only to decide when to compact, so a
 * conservative figure is safer than an optimistic one.
 */
const ASSUMED_CONTEXT_WINDOW = 128_000

/** Resolved configuration for the whole route. */
export interface AdapterOptions {
  /** The plugin's diagnostic prefix. */
  readonly prefix: string
  /** The provider route this adapter owns; used to refuse a self-referential utility route. */
  readonly provider: string
  /** Every enabled agent, from the row's shared `agents` list. */
  readonly agents: readonly ResolvedAgent[]
  /** EOF grace before platform termination. */
  readonly disposeEofGraceMs: number
  /** Grace between termination tiers. */
  readonly disposeGraceMs: number
  /** Reap an idle channel after this long; 0 disables the reaper. */
  readonly idleDisposeMs: number
  /** Where Host utility calls go, or undefined to decline them. */
  readonly utility: UtilityRoute | undefined
  /** How ACP permission requests are answered: the row policy, or the Host's approval service. */
  readonly approval: ApprovalMode
  /** Whether the Host filesystem is advertised to the remote agent. */
  readonly fs: FsMode
}

/**
 * Map an ACP terminal reason onto the Host's finish vocabulary. An unrecognized
 * reason must never be reported as a clean stop: a silent `stop` would make a
 * failed remote turn look like a finished answer.
 * @param stopReason - the remote agent's terminal reason.
 * @returns the finish reason the loop consumes.
 */
function toFinish(stopReason: string): StreamChunk {
  switch (stopReason) {
    case 'end_turn':
      return { type: 'finish', reason: { kind: 'stop' } }
    case 'max_tokens':
      return { type: 'finish', reason: { kind: 'max-tokens' } }
    case 'cancelled':
      return { type: 'finish', reason: { kind: 'aborted', failure: { message: 'the remote ACP turn was cancelled', code: 'acp/cancelled' } } }
    default:
      return {
        type: 'finish',
        reason: { kind: 'error', failure: { message: `the remote ACP turn ended with "${stopReason}"`, code: 'acp/stop-reason' } },
      }
  }
}

/**
 * Read the admitted user text out of one assembled request.
 *
 * The request is not just the conversation: the Host appends its runtime context
 * and skill catalog as user-role messages AFTER the real input, so taking the
 * last user message forwards Host bookkeeping to the remote agent and drops the
 * task. A producer-supplied `source.form` marks that context; a real input has
 * `kind: 'user'` with no `form`, or no `source` at all.
 * @param options - the assembled request.
 * @returns the text to send, or `''` when this call opens no turn.
 */
function lastUserText(options: GenerateOptions): string {
  const messages = options.messages ?? []
  let fallback = ''
  for (let i = messages.length - 1; i >= 0; i -= 1) {
    const message = messages[i]
    if (message?.role !== 'user') continue
    const text = (message.content ?? [])
      .filter((block) => block.type === 'text' && typeof block.text === 'string')
      .map((block) => block.text as string)
      .join('')
    if (text === '') continue
    const source = message.source
    if (source?.form === undefined && (source?.kind === undefined || source.kind === 'user')) return text
    if (fallback === '') fallback = text
  }
  return fallback
}

/** The ACP-backed model route. */
export class AcpAgentAdapter {
  private readonly channels = new Map<string, AcpChannel>()
  /** Per-channel set of remote tool calls already emitted as tool-call blocks. */
  private readonly emitted = new Map<string, Set<string>>()
  private disposed = false

  /**
   * Every open remote tool call, shared with the mirror tools so a `tool/result`
   * can find the record its call id names.
   */
  readonly records = new Map<string, ToolCallRecord>()

  /**
   * @param ctx - Host context carrying the process seam and the LLM registry.
   * @param options - resolved route configuration.
   */
  constructor(
    private readonly ctx: HostContext,
    private readonly options: AdapterOptions,
  ) {}

  /**
   * @param provider - the route being described.
   * @returns the metadata `registerAdapter` validates.
   */
  providerInfo(provider: string): ProviderInfo {
    return { id: provider, name: 'ACP agents (Cursor, opencode, …)' }
  }

  /** No provider-specific retry policy: the registry's default applies. */
  providerRetryPolicy(): undefined {
    return undefined
  }

  /** No image pricing: this route does not price request images. */
  imageRequestPricing(): undefined {
    return undefined
  }

  /**
   * @param provider - the route being listed.
   * @returns one model per configured agent; the model id IS the agent name.
   */
  async listModels(provider: string): Promise<ModelInfo[]> {
    return this.options.agents.map((agent) => ({
      provider,
      id: agent.providerName,
      name: `ACP · ${agent.providerName}`,
      description: `${agent.command} ${agent.args.join(' ')}`.trim(),
    }))
  }

  /**
   * @param provider - the route being resolved.
   * @param model - the agent name.
   * @returns resolved metadata for the exact route.
   */
  async resolveModel(provider: string, model: string): Promise<ResolvedModelInfo> {
    const agent = this.agentFor(model)
    return {
      provider,
      id: model,
      name: `ACP · ${agent.providerName}`,
      context: { contextWindow: ASSUMED_CONTEXT_WINDOW },
    }
  }

  /**
   * Bind one call to this registration.
   * @param provider - the route being prepared.
   * @param model - the agent name.
   * @returns the resolved model plus the stream entry point.
   */
  async prepareCall(provider: string, model: string): Promise<PreparedCall> {
    const resolved = await this.resolveModel(provider, model)
    return { model: resolved, stream: (options: GenerateOptions) => this.stream(options) }
  }

  private agentFor(model: string): ResolvedAgent {
    const agent = this.options.agents.find((candidate) => candidate.providerName === model)
    if (agent === undefined) {
      const known = this.options.agents.map((candidate) => candidate.providerName).join(', ')
      throw new Error(`${this.options.prefix}: no configured ACP agent named "${model}" (configured: ${known || 'none'})`)
    }
    return agent
  }

  /**
   * One failure, in the fixed-line form this route is allowed to surface.
   *
   * A channel failure carries only driver-owned facts, so it becomes a stable
   * line naming the agent, stage and category; the original error — which may
   * hold stderr, a path or a protocol payload — stays on the cause chain and in
   * the Host log. A plain error here is the configuration resolver's own message,
   * which exists precisely to be read.
   * @param agentName - the agent the failure belongs to.
   * @param error - the failure.
   * @returns the model-facing failure fact.
   */
  private describe(agentName: string, error: unknown): { message: string; code: string } {
    if (error instanceof AcpChannelFailure) {
      this.ctx.logger.warn(
        `${this.options.prefix}: ACP failure (agent: ${agentName}; stage: ${error.stage}; category: ${error.category}): %o`,
        error.cause ?? error,
      )
      return {
        message: `ACP failure (agent: ${agentName}; stage: ${error.stage}; category: ${error.category})`,
        code: `acp/${error.category}`,
      }
    }
    return {
      message: error instanceof Error ? error.message : String(error),
      code: 'acp/configuration',
    }
  }

  /** One terminal failure chunk. */
  private failure(code: string, message: string): StreamChunk {
    return { type: 'finish', reason: { kind: 'error', failure: { message, code } } }
  }

  /**
   * The chunk stream for one loop step.
   *
   * `purpose` marks a Host utility call that reuses the Session's route —
   * compaction and session-title generation. Those are not conversation turns
   * and must not be forwarded to the remote agent, whose own context has nothing
   * to do with summarising this one. When a `utilityProvider`/`utilityModel` pair
   * is configured they are delegated to that route; otherwise they are declined,
   * which leaves the Host's own pre-request fallback standing (a truncated user
   * message for a title) instead of replacing it with something worse.
   * @param options - the assembled request.
   * @returns the chunks in stream order.
   */
  async *stream(options: GenerateOptions): AsyncIterable<StreamChunk> {
    if (this.disposed) {
      yield this.failure('acp/disposed', 'the ACP route was disposed')
      return
    }
    const sessionId = options.sessionId
    if (sessionId === undefined) {
      yield this.failure('acp/no-session', 'the ACP route requires a Session identity')
      return
    }

    if (options.purpose !== undefined) {
      const utility = this.options.utility
      if (utility === undefined) {
        yield this.failure(
          'acp/unsupported-purpose',
          `the ACP route does not serve "${options.purpose}" requests and no utilityProvider/utilityModel is configured`,
        )
        return
      }
      yield* this.delegate(options, utility)
      return
    }

    const agent = this.agentFor(options.model)
    const key = `${sessionId}::${agent.providerName}`
    let channel = this.channels.get(key)
    if (channel === undefined || !channel.usable) {
      if (channel !== undefined) await channel.dispose()
      channel = new AcpChannel(this.ctx, {
        prefix: this.options.prefix,
        config: agent,
        disposeEofGraceMs: this.options.disposeEofGraceMs,
        disposeGraceMs: this.options.disposeGraceMs,
        idleDisposeMs: this.options.idleDisposeMs,
        cwd: this.cwdFor(sessionId, agent),
        sessionId,
        approval: this.options.approval,
        fs: this.options.fs,
        key,
        records: this.records,
      })
      this.channels.set(key, channel)
      this.emitted.set(key, new Set())
    }

    try {
      await channel.ensureReady()
    } catch (error: unknown) {
      this.channels.delete(key)
      this.emitted.delete(key)
      await channel.dispose()
      const described = this.describe(agent.providerName, error)
      yield { type: 'finish', reason: { kind: 'error', failure: { message: described.message, code: 'acp/startup' } } }
      return
    }

    // A continuation step ends with the tool result this route's own mirror tool
    // produced; a fresh turn ends with the user's text.
    const continuing = (options.messages ?? []).at(-1)?.role === 'tool'
    if (!continuing) {
      const text = lastUserText(options)
      if (text === '') {
        yield { type: 'finish', reason: { kind: 'stop' } }
        return
      }
      this.emitted.set(key, new Set())
      try {
        channel.beginTurn(text, options.signal)
      } catch (error: unknown) {
        const described = this.describe(agent.providerName, error)
        yield { type: 'finish', reason: { kind: 'error', failure: { message: described.message, code: described.code } } }
        return
      }
    }

    yield* this.consume(channel, key, options.signal, agent.providerName)
  }

  /**
   * Re-dispatch a Host utility call to the configured route.
   *
   * The re-dispatch goes back through the same registry with a different provider,
   * so the utility model keeps its own adapter, retry policy and pricing.
   * Declining a self-referential configuration rather than recursing is the one
   * guard that matters here.
   * @param options - the Host's utility request.
   * @param utility - the configured provider/model pair.
   * @returns the delegated chunk stream.
   */
  private async *delegate(options: GenerateOptions, utility: UtilityRoute): AsyncIterable<StreamChunk> {
    const purpose = String(options.purpose)
    if (utility.provider === this.options.provider) {
      yield this.failure(
        'acp/utility-loop',
        `utilityProvider must not be the ACP route itself (provider: ${utility.provider})`,
      )
      return
    }
    try {
      for await (const chunk of this.ctx.llm.stream({
        ...options,
        provider: utility.provider,
        model: utility.model,
      })) {
        yield chunk as StreamChunk
      }
    } catch (error: unknown) {
      this.ctx.logger.warn(
        `${this.options.prefix}: delegated "${purpose}" request failed (provider: ${utility.provider}): %o`,
        error,
      )
      yield this.failure(
        'acp/utility-failed',
        `the delegated ${purpose} route failed (provider: ${utility.provider}; model: ${utility.model})`,
      )
    }
  }

  /**
   * Turn the channel's signal stream into chunks, cutting at each newly seen
   * remote tool call so the Host can materialize it before the turn continues.
   * @param channel - the live channel.
   * @param key - the channel key, selecting the emitted-call set.
   * @param signal - the Host's cancellation channel for this step.
   * @param agentName - the agent, for failure reporting.
   * @returns the chunks up to the cut point or the remote turn's end.
   */
  private async *consume(
    channel: AcpChannel,
    key: string,
    signal: AbortSignal | undefined,
    agentName: string,
  ): AsyncIterable<StreamChunk> {
    const emitted = this.emitted.get(key) ?? new Set<string>()
    this.emitted.set(key, emitted)
    let index = -1
    let open: 'text' | 'reasoning' | undefined
    const nextIndex = (kind: 'text' | 'reasoning'): number => {
      if (open !== kind) {
        open = kind
        index += 1
      }
      return index
    }

    for (;;) {
      const event: ChannelSignal | undefined | 'aborted' = await channel.next(signal)
      if (event === 'aborted') {
        channel.cancel()
        yield { type: 'finish', reason: { kind: 'aborted', failure: { message: 'the turn was cancelled', code: 'acp/aborted' } } }
        return
      }
      if (event === undefined) {
        yield this.failure('acp/closed', 'the ACP channel closed mid-turn')
        return
      }
      switch (event.kind) {
        case 'text':
          if (event.text !== '') yield { type: 'text-delta', index: nextIndex('text'), text: event.text }
          break
        case 'reasoning':
          if (event.text !== '') yield { type: 'reasoning-delta', index: nextIndex('reasoning'), text: event.text }
          break
        case 'tool': {
          const call = event.call
          if (emitted.has(call.dshCallId)) break
          emitted.add(call.dshCallId)
          index += 1
          open = undefined
          yield {
            type: 'tool-call-delta',
            index,
            id: call.dshCallId,
            name: call.toolName,
            argumentsDelta: JSON.stringify({
              toolCallId: call.dshCallId,
              title: call.title,
              kind: call.kind,
              rawInput: call.rawInput ?? null,
              // Carried into the arguments because the Host's pending card is
              // rendered from them alone; the path is what makes a mirrored call
              // readable at the moment it appears, before any result exists.
              ...call.locations.length === 0 ? {} : { locations: call.locations },
            }),
          }
          yield { type: 'finish', reason: { kind: 'tool-calls' } }
          return
        }
        case 'settled':
          yield toFinish(event.stopReason)
          return
        case 'failed': {
          const described = this.describe(agentName, event.error)
          yield { type: 'finish', reason: { kind: 'error', failure: { message: described.message, code: described.code } } }
          return
        }
        default:
          break
      }
    }
  }

  /**
   * Resolve the remote session's working directory: the agent's own override
   * first, then the Session's recorded cwd, then the launching process.
   * @param sessionId - the DSH Session id.
   * @param agent - the resolved agent entry.
   * @returns the absolute working directory for the remote session.
   */
  private cwdFor(sessionId: string, agent: ResolvedAgent): string {
    const agents = this.ctx.get('agents')
    const parentCwd = agents?.get(sessionId)?.session?.header?.cwd
    return resolveChildCwd(this.options.prefix, agent.cwd, parentCwd)
  }

  /** Stop every live channel and reap its process range. Idempotent. */
  async dispose(): Promise<void> {
    if (this.disposed) return
    this.disposed = true
    const channels = [...this.channels.values()]
    this.channels.clear()
    this.emitted.clear()
    this.records.clear()
    await Promise.all(channels.map(async (channel) => { await channel.dispose() }))
  }
}
