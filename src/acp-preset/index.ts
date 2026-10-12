/**
 * Preset child plugin: pin one Session's model route to a remote ACP agent.
 *
 * This is the half of "select ACP when you start a new Session" that a preset
 * can actually do. P0 established that a preset does **not** carry a model
 * route: `PresetDefinition` has no such field, and `api-session` installs its
 * own selection before `presets.mount` runs. So the preset contributes its own
 * `agent/request` listener and the route is reconciled by waterfall order —
 * which is why this listener registers with `prepend`.
 *
 * Two details are load-bearing:
 *
 * - **The inherited reasoning effort is dropped.** The ACP route advertises no
 *   reasoning efforts, and the runtime rejects an explicit effort for a model
 *   that declares none, so passing one through would fail every request.
 * - **Nothing is registered on a root service.** The preset activation audit
 *   rejects services that leak out of the preset scope, and P0 confirmed
 *   `ctx.llm.registerAdapter` would do exactly that. The adapter therefore lives
 *   in the root row; this plugin only listens inside the Agent's own context.
 *
 * @module dsh-session-map/acp-preset
 */
import z from '@deepseek-ai/schemastery'

/** Plugin name the Loader reports. */
export const name = 'acp-preset'

/** The row's configuration: which agent, under which provider route. */
export const Config = z.object({
  agent: z.string().required(),
  provider: z.string().default('acp'),
})

/** One resolved provider/model pair. */
interface LlmCallConfig {
  provider: string
  model: string
  reasoningEffort?: string
}

/** The Agent-scoped surface this plugin uses. */
interface PresetContext {
  /**
   * @param event - the request waterfall event.
   * @param listener - receives the resolved config from the inner listeners.
   * @param options - `prepend` places this listener outermost, so its result is
   *   the one the runtime keeps.
   * @returns the disposer removing this listener.
   */
  on(
    event: 'agent/request',
    listener: (payload: unknown, next: () => Promise<LlmCallConfig>) => Promise<LlmCallConfig>,
    options?: { prepend?: boolean },
  ): () => void
  /** @param callback - returns the disposer to run at fiber disposal. */
  effect(callback: () => () => void, name?: string): void
}

/**
 * Bind this Session's requests to the configured ACP agent.
 * @param ctx - the Agent's own scoped context.
 * @param config - resolved row configuration.
 */
export function apply(ctx: PresetContext, config: { agent: string; provider?: string }): void {
  const provider = config.provider ?? 'acp'
  const model = config.agent
  ctx.effect(() => ctx.on('agent/request', async (_payload, next) => {
    const resolved = await next()
    // An effort the ACP route cannot honour must not survive the override.
    const { reasoningEffort: _inheritedEffort, ...rest } = resolved as LlmCallConfig & Record<string, unknown>
    return { ...rest, provider, model } as LlmCallConfig
  }, { prepend: true }), `${name}: pinned route ${provider}/${model}`)
}
