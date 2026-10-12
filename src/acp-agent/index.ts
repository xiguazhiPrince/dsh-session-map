/**
 * Host half: the ACP agent route.
 *
 * This row makes a remote ACP CLI agent (Cursor, opencode, …) selectable in two
 * places at once: as a **model route** inside an ordinary DSH Session
 * (`ctx.llm`, one model per configured agent) and as a **preset card** in the
 * new-task picker (one card per configured agent, each pinning the route). Both
 * derive from the same `agents` list, so they cannot disagree.
 *
 * Nothing about the Session changes: its log, projections, persistence, fork,
 * titles and Chat UI are the Agent loop's. See `./adapter.ts` for why the `llm`
 * seam is the right one and `./channel.ts` for how a whole remote turn is
 * reconciled with the loop's step model.
 *
 * Three things this module is careful about, each established by the P0 probe:
 *
 * - **The adapter is registered once at root scope.** `registerAdapter` binds
 *   its effect to the `llm` service rather than to the caller, so registering it
 *   from a preset scope would outlive that scope and be rejected by the preset
 *   activation audit. Only the preset's own `agent/request` listener lives in
 *   the preset scope.
 * - **A re-sync releases the previous generation BEFORE claiming the route.**
 *   `registerAdapter` throws on a duplicate provider, so registering first would
 *   collide with the predecessor it is replacing.
 * - **Preset cards are registered opportunistically.** A base-only composition
 *   has no `agentPresets` service, so the cards simply do not appear there
 *   instead of failing the row.
 *
 * The `agents` list, its schema and its validation are shared with the ACP
 * client core in `../acp-core`, so the vendor-shaped facts (how a CLI is
 * launched, what the permission vocabulary is) have exactly one home.
 *
 * @module dsh-session-map/acp-agent
 */
import { type ResolvedAgent } from '../acp-core/config'
import { AcpAgentAdapter } from './adapter'
import { Config, PREFIX, resolveRouteOptions, type ResolvedRouteOptions } from './config'
import type { HostContext } from './contract'
import { presetDefinitionFor, type PresetRegistry } from './presets'
import { mirrorToolDefinitions } from './tools'

export { Config }
export type { AcpAgentConfig, Options, ResolvedAgent } from '../acp-core/config'
export { AcpChannel, AcpChannelFailure, ToolCallRecord, toolNameForKind, TOOL_KINDS } from './channel'
export { DEFAULT_IDLE_DISPOSE_MS, PREFIX } from './config'
export { PRESET_ORDER, presetIdFor } from './presets'
// The vendor- and platform-shaped core, re-exported so the Node-side suite can
// exercise it directly against the built artifact. Command resolution in
// particular is the most platform-sensitive code in this package (Windows
// launcher tables, `.cmd` shims, PATH scans) and is worth reaching without
// standing up a Host composition.
export { agentSchema, resolveOptions } from '../acp-core/config'
export { assertUsableCwd, resolveAcpCommand, resolveChildCwd } from '../acp-core/resolve'

/** Plugin name the Loader reports. */
export const name = 'acp-agent'

/** Hard dependencies: the adapter registry, the tool registry, and the process seam. */
export const inject = ['llm', 'tools', 'subprocess']

/**
 * The single provider route this row owns. Every configured agent is a model id
 * under it, so adding an agent never changes the selected provider.
 */
const PROVIDER = 'acp'

/**
 * Mount the route and its preset cards, and re-mount both when the volatile
 * `agents` list is committed.
 *
 * Configuration that cannot be resolved is reported and dropped rather than
 * thrown: a half-written draft must not take down the row, and the previously
 * mounted route stays untouched.
 * @param ctx - Host context carrying `llm`, `tools` and `subprocess`.
 * @param config - the row's raw configuration.
 * @returns settlement of the initial mount, so the Loader can await activation.
 */
export function apply(ctx: HostContext, config: unknown): Promise<void> {
  let generation = 0
  let mounted: (() => void) | undefined
  let presetsMounted: (() => void) | undefined
  let presetsSeen = false
  let queue = Promise.resolve()

  const teardownRoute = (): void => {
    const dispose = mounted
    mounted = undefined
    dispose?.()
  }

  const teardownPresets = (): void => {
    const dispose = presetsMounted
    presetsMounted = undefined
    dispose?.()
  }

  const mountPresets = async (presets: PresetRegistry, agents: readonly ResolvedAgent[]): Promise<void> => {
    const disposers: Array<() => Promise<void>> = []
    for (const agent of agents) {
      try {
        disposers.push(await presets.register(presetDefinitionFor(agent, PROVIDER)))
      } catch (error: unknown) {
        ctx.logger.warn(`${PREFIX}: could not register the preset for agent "${agent.providerName}": %o`, error)
      }
    }
    presetsMounted = () => { for (const dispose of disposers) void dispose() }
    ctx.logger.warn(`${PREFIX}: registered ${disposers.length} preset card(s) for ${agents.map((agent) => presetDefinitionFor(agent, PROVIDER).id).join(', ')}`)
  }

  const sync = (): void => {
    const mine = ++generation
    queue = queue.then(async () => {
      if (mine !== generation) return
      let resolved: ResolvedRouteOptions
      try {
        resolved = resolveRouteOptions(config)
      } catch (error: unknown) {
        ctx.logger.warn(`${PREFIX}: configuration rejected, keeping the running route: %o`, error)
        return
      }

      // Release the previous generation before claiming anything back.
      teardownPresets()
      teardownRoute()

      if (resolved.agents.length === 0) {
        // The shipped default. Debug rather than warn: an empty agent list is the
        // normal state of a fresh install, not a misconfiguration.
        ctx.logger.debug(`${PREFIX}: no enabled agents configured; the "${PROVIDER}" route is not registered`)
        return
      }

      const adapter = new AcpAgentAdapter(ctx, {
        prefix: PREFIX,
        provider: PROVIDER,
        agents: resolved.agents,
        disposeEofGraceMs: resolved.disposeEofGraceMs,
        disposeGraceMs: resolved.disposeGraceMs,
        idleDisposeMs: resolved.idleDisposeMs,
        utility: resolved.utility,
        approval: resolved.approval,
        fs: resolved.fs,
      })
      const disposers: Array<() => void> = []
      try {
        disposers.push(ctx.llm.registerAdapter([PROVIDER], adapter))
        for (const definition of mirrorToolDefinitions(adapter.records, PREFIX)) {
          disposers.push(ctx.tools.register(definition))
        }
      } catch (error: unknown) {
        // Never leave a partial generation behind: a route without its mirror
        // tools would fail every remote tool call, and tools without the route
        // would be dead entries in the model's declaration list.
        for (const dispose of disposers.reverse()) dispose()
        await adapter.dispose()
        ctx.logger.warn(`${PREFIX}: mounting the configured agents failed: %o`, error)
        return
      }

      if (mine !== generation) {
        for (const dispose of disposers.reverse()) dispose()
        await adapter.dispose()
        return
      }
      mounted = () => {
        for (const dispose of disposers.reverse()) dispose()
        void adapter.dispose()
      }

      const presets = ctx.get('agentPresets')
      if (presets !== undefined) {
        presetsSeen = true
        await mountPresets(presets, resolved.agents)
      }
    }).catch((error: unknown) => {
      ctx.logger.warn(`${PREFIX}: agent synchronization failed: %o`, error)
    })
  }

  ctx.effect(() => ctx.on('loader/volatile-update', sync), `${PREFIX}: agent-list changes`)
  ctx.effect(() => () => {
    generation += 1
    teardownPresets()
    teardownRoute()
  }, `${PREFIX}: registered route, mirror tools and preset cards`)
  // A composition without the preset registry mounts no cards. Pick the registry
  // up if it activates later, without re-running a sync that already saw it.
  ctx.inject(['agentPresets'], () => { if (!presetsSeen) sync() })
  sync()
  return queue
}
