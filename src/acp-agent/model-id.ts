/**
 * The model-id codec for the `acp` route.
 *
 * One agent is one model route, but an agent can also advertise a *model
 * selector* of its own (`configOptions`, category `model`). The route surfaces
 * both through the one string the Host calls a model id, so the encoding has to
 * be reversible and has to keep every id that already exists working:
 *
 * - `<agent>` — the agent's own default. This is what P1 shipped, what presets
 *   pin, and what a profile's `agent-default-model` row already holds, so it can
 *   never be repurposed.
 * - `<agent>::<value>` — one value the agent advertised for that selector, e.g.
 *   `cursor::grok-4.6[effort=high,fast=true]`.
 *
 * The split is on the **last** separator: an agent name may not contain one
 * (`resolveAgentName` below rejects it, and `../acp-agent/config.ts` applies
 * that check), while a real model value demonstrably does — Cursor's values
 * carry bracketed parameters and commas (measured: `.dsh-dev/config-options.json`).
 *
 * @module dsh-session-map/acp-agent/model-id
 */

/** Separates an agent name from one of the models it advertises. */
export const MODEL_ID_SEPARATOR = '::'

/** One decoded route: which agent, and which of its models it should use. */
export interface DecodedModelId {
  /** The configured agent name, i.e. the model id a legacy profile holds. */
  readonly agent: string
  /** The agent-advertised value, or `undefined` for the agent's own default. */
  readonly value: string | undefined
}

/**
 * @param agent - the configured agent name.
 * @param value - one value the agent advertised for its model selector; omit
 *   (or pass `''`) for the agent's own default.
 * @returns the model id the Host stores.
 */
export function encodeModelId(agent: string, value?: string): string {
  return value === undefined || value === '' ? agent : `${agent}${MODEL_ID_SEPARATOR}${value}`
}

/**
 * @param id - a model id from a request, a profile, or the catalog.
 * @returns the agent and the optional advertised value.
 */
export function decodeModelId(id: string): DecodedModelId {
  const index = id.lastIndexOf(MODEL_ID_SEPARATOR)
  if (index < 0) return { agent: id, value: undefined }
  const value = id.slice(index + MODEL_ID_SEPARATOR.length)
  return { agent: id.slice(0, index), value: value === '' ? undefined : value }
}

/**
 * Refuse an agent name that would make its own model ids ambiguous.
 *
 * Checked when the row is resolved rather than when an id is decoded: a name
 * containing the separator would silently make `a::b` mean either "agent a,
 * model b" or "agent a::b, its default", and no later code can tell which the
 * author meant.
 * @param prefix - the diagnostic prefix.
 * @param name - the configured agent name.
 * @param where - the config key the name came from, for the message.
 */
export function assertAgentNameUnambiguous(prefix: string, name: string, where: string): void {
  if (name.includes(MODEL_ID_SEPARATOR)) {
    throw new Error(`${prefix}: \`${where}\` must not contain "${MODEL_ID_SEPARATOR}" — it separates an agent from one of its models`)
  }
}
