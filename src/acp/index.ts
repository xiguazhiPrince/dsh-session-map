/**
 * Host half: the ACP subagent backend.
 *
 * One row carries the whole configuration — a LIST of agents — and this module
 * derives everything else from it: one `ctx.subagents` provider per enabled
 * agent, and one delegation-tool row per agent (see `./mount.ts` for why the
 * tools must be mounted here). Nothing is vendor-specific, so the same component
 * serves any ACP agent.
 *
 * `agents` is a volatile field, so the settings card can grow the list while the
 * Harness runs: the loader commits a volatile write into the running reference
 * and emits `loader/volatile-update`, and {@link apply} re-syncs providers and
 * tool rows against the new list. Syncs are serialized and generation-fenced, so
 * two quick edits can never interleave into a half-mounted state.
 *
 * This module deliberately imports nothing from the Host at runtime except the
 * bundled Config schema (see `./contract.ts`), and uses named exports only: a
 * `default` export would make the Loader collapse the module and drop `inject`,
 * leaving the plugin unable to see `subagents` and `subprocess` at all.
 *
 * @module dsh-session-map/acp
 */
import type {
  HostContext,
  SubagentCapabilities,
  SubagentProvider,
  SubagentRun,
  SubagentStartRequest,
} from './contract'
import { PLUGIN_ID, resolveOptions, type Options, type ResolvedAgent, type ResolvedOptions } from './config'
import { mountToolRows } from './mount'
import { resolveAcpCommand, resolveChildCwd } from './resolve'
import { startAcpRun } from './run'

export { Config } from './config'
export type { AcpAgentConfig, Options, ResolvedAgent } from './config'

/** Plugin name the Loader reports. */
export const name = 'acp'

/** Hard dependencies: the provider registry, the process seam, and the entry tree the tool rows are mounted into. */
export const inject = ['subagents', 'subprocess', 'loader']

/**
 * One configured ACP agent. Advertises NO start-time capabilities: an
 * out-of-process child cannot honour `agentOptions`/`outputSchema`/`maxDepth`/
 * `toolFilter`/`persona`, and the Host service rejects a request needing any of
 * them before `start` runs rather than accepting and ignoring it.
 */
class AcpProvider implements SubagentProvider {
  readonly capabilities: SubagentCapabilities = {
    agentOptions: false,
    outputSchema: false,
    depthLimit: false,
    toolFilter: false,
    persona: false,
  }

  /** An out-of-process child starts fresh: no parent conversation crosses the process boundary. */
  readonly inheritsParentContext = false

  constructor(
    readonly name: string,
    private readonly ctx: HostContext,
    private readonly agent: ResolvedAgent,
    private readonly graces: Pick<ResolvedOptions, 'disposeEofGraceMs' | 'disposeGraceMs'>,
  ) {}

  /**
   * Resolve the child's workspace and command, then publish one run. A
   * resolution failure is reported with its own message and rethrown unchanged:
   * it names config keys and the deployment's own paths — the same facts the
   * delegating model already holds — so it is safe to surface and far more
   * useful than a fixed line. Protocol, transport, and process failures are
   * flattened to fixed facts by `run.ts`.
   * @param request - the Host start request.
   * @returns the published run handle.
   */
  async start(request: SubagentStartRequest): Promise<SubagentRun> {
    const { agent } = this
    if (request.signal.aborted) {
      throw new Error(`${PLUGIN_ID}: subagent request was aborted before the "${this.name}" ACP child started`)
    }
    let cwd: string
    let argv: readonly string[]
    try {
      cwd = resolveChildCwd(this.name, agent.cwd, request.parent.session.header.cwd)
      argv = resolveAcpCommand(
        this.name,
        { command: agent.command, args: agent.args },
        process.platform,
        process.env,
      )
    } catch (error: unknown) {
      this.ctx.logger.warn(`${PLUGIN_ID} "${this.name}": child start failed: %o`, error)
      throw error
    }
    return startAcpRun(request, {
      providerName: this.name,
      argv,
      cwd,
      mode: agent.mode,
      configOptions: agent.configOptions,
      permission: agent.permission,
      env: agent.env,
      disposeEofGraceMs: this.graces.disposeEofGraceMs,
      disposeGraceMs: this.graces.disposeGraceMs,
      spawn: spec => this.ctx.subprocess.spawn(spec),
      onError: (error, stopReason) => {
        // The seam forbids `result` rejecting, so a child-level failure is
        // flattened to a stop reason — keep the original Error visible here.
        this.ctx.logger.warn(`${PLUGIN_ID} "${this.name}": child run failed (${stopReason}): %o`, error)
      },
    })
  }
}

/**
 * Register the configured agents and mount their delegation tools, re-syncing
 * whenever the agent list changes.
 *
 * A rejected configuration (a duplicate name, a missing `command`, an
 * unreachable `cwd`) is logged and leaves the previous generation mounted rather
 * than tearing the backend down: a settings draft that is momentarily invalid
 * must not silently remove a working delegation path.
 * @param ctx - the Host context (must provide `subagents`, `subprocess`, and `loader`).
 * @param config - the row configuration, whose volatile fields are read live.
 * @returns settlement of the sync started here. The Loader awaits an async
 *   `apply`, so this is also the plugin's activation barrier.
 */
export function apply(ctx: HostContext, config?: Options): Promise<void> {
  let mounted: (() => void) | undefined
  let queue: Promise<void> = Promise.resolve()
  let generation = 0

  const teardown = (): void => {
    const dispose = mounted
    mounted = undefined
    dispose?.()
  }

  const sync = (): void => {
    const mine = ++generation
    queue = queue.then(async () => {
      if (mine !== generation) return
      let resolved: ResolvedOptions
      try {
        resolved = resolveOptions(config)
      } catch (error: unknown) {
        ctx.logger.warn(`${PLUGIN_ID}: configuration rejected, keeping the running agents: %o`, error)
        return
      }
      const disposers: Array<() => void> = []
      try {
        for (const agent of resolved.agents) {
          disposers.push(ctx.subagents.registerProvider(new AcpProvider(agent.providerName, ctx, agent, resolved)))
        }
        // Mounting adds entries to the tree we are being activated from. One
        // macrotask of separation keeps that off the activation turn, so a
        // loader that serializes entry startup can never wait on itself.
        await new Promise<void>((resolveTick) => { setImmediate(resolveTick) })
        disposers.push(await mountToolRows({ loader: ctx.loader, logger: ctx.logger }, resolved.agents))
      } catch (error: unknown) {
        // Never leave a partial generation behind: a provider without its tool
        // would be invisible to the model, and a tool without its provider would
        // fail every delegation.
        for (const dispose of disposers.reverse()) dispose()
        ctx.logger.warn(`${PLUGIN_ID}: mounting the configured agents failed: %o`, error)
        return
      }
      if (mine !== generation) {
        for (const dispose of disposers.reverse()) dispose()
        return
      }
      teardown()
      mounted = () => { for (const dispose of disposers.reverse()) dispose() }
    }).catch((error: unknown) => {
      ctx.logger.warn(`${PLUGIN_ID}: agent synchronization failed: %o`, error)
    })
  }

  ctx.effect(() => ctx.on('loader/volatile-update', sync), 'dsh-session-map/acp: agent-list changes')
  ctx.effect(() => () => {
    generation += 1
    teardown()
  }, 'dsh-session-map/acp: derived providers and tool rows')
  sync()
  return queue
}
