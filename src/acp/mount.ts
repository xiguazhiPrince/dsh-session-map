/**
 * Derived delegation-tool rows.
 *
 * A subagent provider is inert: the model reaches it only through a
 * `@deepseek-ai/dsh-tool-subagent` row, and each row names exactly one provider.
 * Nothing in the plugin-manager surface can create such a row — it can install a
 * package and flip `disabled`, not write a row's name and config — so a settings
 * card could never grow the tool set on its own.
 *
 * This module closes that gap the only way the platform leaves open: the backend
 * MOUNTS the tool rows itself, at runtime, from the agent list it was configured
 * with. They are derived state, not profile content — they are created on every
 * activation (so they survive a restart) and removed when their agent goes away,
 * and they never appear in the profile patch. The product's own delegation tool
 * is reused unchanged; nothing here reimplements a model-facing contract.
 *
 * @module dsh-session-map/acp/mount
 */
import { PLUGIN_ID, TOOL_PLUGIN_NAME, type ResolvedAgent } from './config'

/** The Loader surface this module needs (structurally, so no Host import is required). */
export interface LoaderLike {
  /**
   * @param options - the row to add: plugin name plus its config.
   * @returns resolves once the row's plugin has activated.
   */
  create(options: {
    readonly name: string
    readonly config?: unknown
    readonly disabled?: boolean
  }): Promise<unknown>
  /** @param id - the row id to stop and remove. */
  remove(id: string): void
}

/** The row id one derived tool row is addressed by, for diagnostics. */
export function toolEntryId(providerName: string): string {
  return `${PLUGIN_ID}:tool:${providerName}`
}

/**
 * The config one derived tool row carries. `backgroundMode` and `maxDepth` mirror
 * the shipped Codex and Claude Code rows; `maxDepth: provider-managed` is what an
 * out-of-process backend takes, since the Host cannot count a child's own depth.
 * @param agent - the resolved agent the tool delegates to.
 * @returns the tool row config.
 */
export function toolEntryConfig(agent: ResolvedAgent): Record<string, unknown> {
  return {
    provider: agent.providerName,
    toolName: agent.toolName,
    backgroundMode: 'one-shot',
    maxDepth: 'provider-managed',
  }
}

/** What a caller must provide to mount rows. */
export interface MountHost {
  /** The Loader service. */
  readonly loader: LoaderLike
  /** Host log sink for a mount that could not be established. */
  readonly logger: {
    warn(message: string, ...rest: unknown[]): void
  }
}

/**
 * Mount one tool row per agent, removing any row this plugin previously mounted
 * that is no longer wanted.
 *
 * Mounting is best-effort per agent: one agent whose row fails to mount must not
 * take down the whole backend, so the failure is logged and the remaining agents
 * still mount. The returned disposer removes every row this call created.
 * @param host - the Loader and log sink.
 * @param agents - the resolved agents to expose.
 * @returns a disposer removing the rows this call mounted.
 */
export async function mountToolRows(host: MountHost, agents: readonly ResolvedAgent[]): Promise<() => void> {
  const mounted: string[] = []
  for (const agent of agents) {
    try {
      const created = await host.loader.create({ name: TOOL_PLUGIN_NAME, config: toolEntryConfig(agent) })
      // The entry tree mints the row id and answers with it (the Loader's
      // `create` returns the id string; a provider that answers with the entry
      // itself is accepted too). Removal must use that id, not a name we chose,
      // or a re-sync would leave the previous rows mounted forever.
      const id = typeof created === 'string'
        ? created
        : created !== null && typeof created === 'object' ? Reflect.get(created, 'id') : undefined
      if (typeof id !== 'string' || id === '') {
        host.logger.warn(`${PLUGIN_ID}: a mounted delegation tool row reported no id for agent "%s"`, agent.providerName)
        continue
      }
      mounted.push(id)
    } catch (error: unknown) {
      host.logger.warn(
        `${PLUGIN_ID}: the delegation tool for agent "%s" could not be mounted: %o`,
        agent.providerName,
        error,
      )
    }
  }
  return () => {
    for (const id of mounted.reverse()) {
      try {
        host.loader.remove(id)
      } catch (error: unknown) {
        host.logger.warn(`${PLUGIN_ID}: a derived delegation tool row could not be removed: %o`, error)
      }
    }
  }
}
