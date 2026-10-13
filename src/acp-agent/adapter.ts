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
import { AcpChannel, AcpChannelFailure, MODEL_CATEGORY, type ChannelSignal, type ConfigOption, type ToolCallRecord } from './channel'
import { DEFAULT_BACKGROUND_DISCOVERY_TIMEOUT_MS, DEFAULT_DISCOVERY_FAILURE_TTL_MS, type ApprovalMode, type FsMode, type ModelDiscoveryMode, type UtilityRoute } from './config'
import { decodeModelId, encodeModelId } from './model-id'
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
  /** Whether the route may spawn an agent to read its own model list. */
  readonly modelDiscovery: ModelDiscoveryMode
  /** Upper bound on one discovery handshake, in milliseconds. */
  readonly discoveryTimeoutMs: number
  /** How long a discovered model list is reused, in milliseconds. */
  readonly discoveryTtlMs: number
}

/** One agent's cached model-list outcome. */
type Discovery =
  | { readonly ok: true; readonly options: readonly ConfigOption[]; readonly at: number }
  | { readonly ok: false; readonly at: number }

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
  /** Each agent's own model list, read once per TTL from a throwaway session. */
  private readonly discovered = new Map<string, Discovery>()
  /** In-flight discovery per agent, so concurrent catalog reads spawn one probe. */
  private readonly discovering = new Map<string, Promise<readonly ConfigOption[]>>()
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
   * The models this route offers.
   *
   * Every agent contributes its own model id first — the id P1 shipped, which
   * means "whatever this agent's own default is" and is what a preset card pins.
   * When the agent advertises a model selector, each of its values follows as
   * `<agent>::<value>`, which is what makes an agent's inner models selectable in
   * the Host's own model picker without a second UI.
   *
   * Discovery is deliberately not on this path in the default mode: the list is
   * answered from cache, and a cold entry warms in the background so that no
   * caller — the Host's catalog, a settings page, a picker opening — ever waits
   * on an agent process.
   * @param provider - the route being listed.
   * @returns the legacy entry per agent, plus whatever models are known right now.
   */
  async listModels(provider: string): Promise<ModelInfo[]> {
    const models: ModelInfo[] = []
    for (const agent of this.options.agents) {
      models.push({
        provider,
        id: encodeModelId(agent.providerName),
        name: `ACP · ${agent.providerName}`,
        description: `${agent.command} ${agent.args.join(' ')}`.trim(),
      })
      if (this.options.modelDiscovery === 'off') continue

      const cached = this.freshDiscovery(agent.providerName)
      if (cached?.ok === true) {
        models.push(...this.modelEntries(provider, agent, cached.options))
        continue
      }
      // A fresh failure is honoured too: respawning on every read is exactly the
      // cost the negative cache exists to bound.
      if (cached !== undefined) continue

      if (this.options.modelDiscovery === 'eager') {
        models.push(...this.modelEntries(provider, agent, await this.discover(agent, this.options.discoveryTimeoutMs)))
        continue
      }
      void this.discover(agent, DEFAULT_BACKGROUND_DISCOVERY_TIMEOUT_MS)
    }
    return models
  }

  /**
   * @param provider - the route being resolved.
   * @param model - the agent name, optionally followed by one of its model values.
   * @returns resolved metadata for the exact route.
   */
  async resolveModel(provider: string, model: string): Promise<ResolvedModelInfo> {
    const { agent: agentName, value } = decodeModelId(model)
    const agent = this.agentFor(agentName)
    return {
      provider,
      id: model,
      name: value === undefined
        ? `ACP · ${agent.providerName}`
        : `ACP · ${agent.providerName} · ${value}`,
      description: `${agent.command} ${agent.args.join(' ')}`.trim(),
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

  /**
   * One agent's model list, from cache when it is still fresh.
   * @param agentName - the configured agent name.
   * @returns the entry, or `undefined` when nothing fresh is known.
   */
  private freshDiscovery(agentName: string): Discovery | undefined {
    const entry = this.discovered.get(agentName)
    if (entry === undefined) return undefined
    const ttl = entry.ok ? this.options.discoveryTtlMs : DEFAULT_DISCOVERY_FAILURE_TTL_MS
    return Date.now() - entry.at < ttl ? entry : undefined
  }

  /**
   * Turn one agent's advertised options into catalog entries.
   * @param provider - the route.
   * @param agent - the agent they came from.
   * @param options - the agent's advertised options.
   * @returns one entry per value of its model selector; none when it has none.
   */
  private modelEntries(provider: string, agent: ResolvedAgent, options: readonly ConfigOption[]): ModelInfo[] {
    const selector = options.find((option) => option.category === MODEL_CATEGORY && option.type === 'select')
    if (selector === undefined) return []
    const command = `${agent.command} ${agent.args.join(' ')}`.trim()
    return selector.choices.map((choice) => ({
      provider,
      id: encodeModelId(agent.providerName, choice.value),
      // The group label leads, because an agent that grouped its values meant
      // the group to be part of how a value is told apart.
      name: `ACP · ${agent.providerName} · ${choice.group === undefined ? choice.name : `${choice.group} · ${choice.name}`}`,
      description: `${command} · ${selector.name}`,
    }))
  }

  /**
   * Read one agent's model list, at most once at a time.
   * @param agent - the agent to interrogate.
   * @param timeoutMs - the bound for this probe.
   * @returns its options, or `[]` when the probe failed or timed out.
   */
  private discover(agent: ResolvedAgent, timeoutMs: number): Promise<readonly ConfigOption[]> {
    const existing = this.discovering.get(agent.providerName)
    if (existing !== undefined) return existing
    const run = this.probe(agent, timeoutMs).finally(() => { this.discovering.delete(agent.providerName) })
    this.discovering.set(agent.providerName, run)
    return run
  }

  /**
   * Open a throwaway session purely to read what the agent advertises.
   *
   * It reuses `AcpChannel` rather than speaking ACP here so that spawning,
   * handshaking, environment scrubbing and the teardown ladder are the same code
   * the conversation path uses — and it is deliberately NOT entered into
   * {@link channels} and gets its own tool-call registry, so a probe can never
   * collide with a Session's channel or publish a mirror tool call.
   *
   * Every failure is a fact about the agent, not an error to raise: an agent that
   * is not logged in, is slow, or advertises no selector simply contributes its
   * legacy entry, and the negative result is remembered briefly so a catalog read
   * loop cannot turn into a spawn loop.
   *
   * The working directory is the agent's own, else the Host's launching directory:
   * a catalog read has no Session to inherit one from, and the launching directory
   * is the same meaning a relative `cwd` already carries at load. Nothing is
   * prompted on this session, so the directory is where the agent starts, not
   * somewhere it is asked to work.
   * @param agent - the agent to interrogate.
   * @param timeoutMs - the bound on its handshake.
   * @returns its options, or `[]`.
   */
  private async probe(agent: ResolvedAgent, timeoutMs: number): Promise<readonly ConfigOption[]> {
    const key = `discovery::${agent.providerName}`
    const channel = new AcpChannel(this.ctx, {
      prefix: this.options.prefix,
      config: agent,
      disposeEofGraceMs: this.options.disposeEofGraceMs,
      disposeGraceMs: this.options.disposeGraceMs,
      idleDisposeMs: 0,
      cwd: resolveChildCwd(this.options.prefix, agent.cwd, process.cwd()),
      sessionId: key,
      approval: this.options.approval,
      fs: this.options.fs,
      key,
      records: new Map(),
    })
    const startup = channel.ensureReady()
    // A timed-out probe abandons this promise while the teardown below kills the
    // process underneath it; without a handler that late rejection surfaces as an
    // unhandled rejection rather than as the outcome already recorded.
    startup.catch(() => {})
    try {
      await this.withTimeout(startup, timeoutMs)
      const options = channel.configOptionState()
      this.discovered.set(agent.providerName, { ok: true, options, at: Date.now() })
      return options
    } catch (error: unknown) {
      this.discovered.set(agent.providerName, { ok: false, at: Date.now() })
      this.ctx.logger.debug(
        `${this.options.prefix}: could not read the model list of agent "${agent.providerName}": %o`,
        error,
      )
      return []
    } finally {
      await channel.dispose()
    }
  }

  /**
   * @param work - the operation to bound.
   * @param ms - the bound in milliseconds.
   * @returns the operation's result.
   * @throws when the bound elapses first.
   */
  private async withTimeout<T>(work: Promise<T>, ms: number): Promise<T> {
    let timer: ReturnType<typeof setTimeout> | undefined
    try {
      return await Promise.race([
        work,
        new Promise<never>((_resolve, reject) => {
          timer = setTimeout(() => { reject(new Error(`the ACP handshake exceeded ${String(ms)}ms`)) }, ms)
          timer.unref?.()
        }),
      ])
    } finally {
      if (timer !== undefined) clearTimeout(timer)
    }
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

    const { agent: agentName, value: modelValue } = decodeModelId(options.model)
    const agent = this.agentFor(agentName)
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
      // The model can only change between turns, and a channel keeps whatever it
      // was last put on, so the requested value is reconciled here: a turn that
      // does not change it costs no request, and one that does reaches the agent
      // before the prompt that depends on it. A refused value fails this turn
      // rather than silently answering from a model nobody asked for.
      try {
        await channel.applyModel(modelValue)
      } catch (error: unknown) {
        const described = this.describe(agent.providerName, error)
        yield { type: 'finish', reason: { kind: 'error', failure: { message: described.message, code: described.code } } }
        return
      }
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
