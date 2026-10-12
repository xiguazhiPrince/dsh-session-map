/**
 * The preset cards this route contributes.
 *
 * A card is what makes "start a new Session on Cursor" a choice in the new-task
 * picker rather than a model someone has to find in the composer. The cards are
 * derived from the SAME `agents` list that produces the model routes, so the two
 * can never disagree: adding an agent adds a model and a card, and removing one
 * removes both.
 *
 * They are registered at runtime rather than declared as
 * `@deepseek-ai/dsh-agent-preset` rows for two reasons. A base-only composition
 * carries no `agentPresets` service and no `dsh-agent-preset` package, so a
 * declared row would fail to import there; and a declared row would be a second
 * place the agent list has to be kept in sync with.
 *
 * @module dsh-session-map/acp-agent/presets
 */
import type { ResolvedAgent } from '../acp-core/config'

/** The preset registry surface this module uses (`ctx.agentPresets`). */
export interface PresetRegistry {
  /**
   * Register and eagerly load one declaration.
   * @param definition - the preset identity, roster metadata, and child rows.
   * @returns the disposer that retires this declaration.
   */
  register(definition: {
    readonly id: string
    readonly name?: string
    readonly description?: string
    readonly order?: number
    readonly plugins: readonly Record<string, unknown>[]
  }): Promise<() => Promise<void>>
}

/** The child plugin every generated preset mounts, addressed by subpath. */
export const PRESET_CHILD_SPECIFIER = 'dsh-session-map/acp-preset'

/**
 * Roster order. The shipped presets occupy the low numbers (`minimal` is 3), so
 * ACP cards sort after them instead of displacing them.
 */
export const PRESET_ORDER = 50

/**
 * @param agent - the resolved agent entry.
 * @returns the preset identity for that agent.
 */
export function presetIdFor(agent: ResolvedAgent): string {
  return `acp-${agent.providerName}`
}

/**
 * Build one preset declaration.
 * @param agent - the resolved agent entry.
 * @param provider - the provider route the agent is a model of.
 * @returns the definition to hand the registry.
 */
export function presetDefinitionFor(
  agent: ResolvedAgent,
  provider: string,
): {
  id: string
  name: string
  description: string
  order: number
  plugins: readonly Record<string, unknown>[]
} {
  return {
    id: presetIdFor(agent),
    name: `ACP · ${agent.providerName}`,
    description:
      `Runs this Session on the remote ACP agent "${agent.providerName}" (${agent.command}). `
      + 'The agent keeps its own context, model and tools, so DSH shows the whole conversation but does not '
      + 'mediate what it does: its tools run unattended in this Session\'s working directory, and the '
      + 'Host sandbox and approval policy do not apply to them.',
    order: PRESET_ORDER,
    plugins: [
      {
        id: 'acp-preset',
        name: PRESET_CHILD_SPECIFIER,
        config: { agent: agent.providerName, provider },
      },
    ],
  }
}
