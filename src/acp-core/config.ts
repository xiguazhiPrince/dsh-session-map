/**
 * The vendor- and platform-shaped core of an ACP client: the agent LIST, its
 * schema, and how one entry resolves.
 *
 * This module is deliberately route-neutral. It knows what an ACP CLI agent is
 * — how it is launched, what a permission policy means, which defaults apply —
 * and nothing about what a Session does with one. The conversational route in
 * `../acp-agent` layers its own fields on top of {@link agentSchema} and reads
 * the resolved agents through {@link resolveOptions}.
 *
 * The shape is a list rather than one row per agent because a list is the only
 * shape a configuration editor can grow: the Harness settings service edits the
 * config of an EXISTING profile entry, and nothing in the plugin-manager surface
 * can create a new row.
 *
 * `agents` is `.volatile()`: the settings service exposes only volatile fields
 * as editable, and a volatile write is committed into the running reference
 * without remounting the plugin, so a route re-syncs live on an edit.
 *
 * The schema is schemastery — the same library the Harness uses — because the
 * settings service derives its forms by reading the schema's metadata. It is
 * BUNDLED (a devDependency) rather than installed with the plugin, which is why
 * this file imports a value from `@deepseek-ai/schemastery` while the rest of
 * the package carries no `@deepseek-ai/*` runtime import: the schema never
 * crosses the process boundary, it is read structurally by the Host.
 *
 * @module dsh-session-map/acp-core/config
 */
import { resolve as resolvePath } from 'node:path'
import z from '@deepseek-ai/schemastery'
import { assertUsableCwd } from './resolve'

/**
 * A schemastery `.volatile()` field as the Loader hands it to a plugin: a live
 * reference whose contents are committed in place on every edit, so re-reading it
 * is how a live change is observed. Declared structurally rather than imported —
 * this package carries no `@deepseek-ai/*` runtime import, and the only member
 * used is `get`.
 */
export interface VolatileRef<T> {
  /** @returns the value committed by the most recent accepted update. */
  get(): T
}

/**
 * How to auto-answer the child's `session/request_permission` prompts:
 * `allow` approves through the first `allow_once` option (falling back to
 * `allow_always`), `reject` declines every prompt. No prompt reaches a human.
 */
export type PermissionPolicy = 'allow' | 'reject'

/** One configured ACP agent, as a form or a patch author writes it. */
export interface AcpAgentConfig {
  /** Model id on the `acp` route, and the name used in diagnostics. Unique per row. */
  name?: string
  /** The ACP agent to launch: a CLI name on `PATH`, or an explicit executable path. */
  command?: string
  /** Arguments passed to the resolved command (default `['acp']`). */
  args?: string[]
  /** Working directory override; a relative path resolves against the Harness launch directory once, at load. */
  cwd?: string
  /** Session mode to select when the agent advertises it. Omitted leaves the agent's own default. */
  mode?: string
  /** Session configuration options applied after `session/new`, keyed by the option id the agent advertised. */
  configOptions?: Record<string, string | number | boolean>
  /** Permission auto-answer policy (default `allow`). */
  permission?: PermissionPolicy
  /** Extra environment entries for the child, merged after the process seam's credential scrub. */
  env?: Record<string, string>
  /** Whether this agent is offered at all (default `true`). */
  enabled?: boolean
}

/** The row configuration as a patch author writes it. */
export interface Options {
  /** The configured agents. Volatile, so a live settings write is committed in place. */
  agents?: VolatileRef<AcpAgentConfig[]> | AcpAgentConfig[]
  /** Grace (ms) for a child's stdin-EOF quiesce before termination escalates. */
  disposeEofGraceMs?: number
  /** Failure-observation and termination-escalation grace (ms). */
  disposeGraceMs?: number
}

/** The agent schema, shared by the row schema and the settings form projection. */
export const agentSchema = z.object({
  name: z.string().required(),
  command: z.string().required(),
  args: z.array(z.string()).default(['acp']),
  cwd: z.string(),
  mode: z.string(),
  configOptions: z.dict(z.union([z.string(), z.number(), z.boolean()])),
  permission: z.union(['allow', 'reject'] as const).default('allow'),
  env: z.dict(z.string()),
  enabled: z.boolean().default(true),
})

/**
 * The plugin's Config schema. `agents` is volatile so the settings service
 * offers it as a live-editable field; the graces stay ordinary.
 */
export const Config = z.object({
  agents: z.array(agentSchema).default([]).volatile(),
  disposeEofGraceMs: z.number(),
  disposeGraceMs: z.number(),
})

/** Diagnostic prefix for configuration failures this schema reports. */
export const CONFIG_PREFIX = 'dsh-session-map/acp-agent'

/** Permission policy used when a row does not set one. */
export const DEFAULT_PERMISSION: PermissionPolicy = 'allow'

/** The ACP subcommand most CLIs use; a row overrides it when its CLI differs. */
export const DEFAULT_ARGS: readonly string[] = ['acp']

/** EOF grace for child flush and nested-process teardown; wider than the signal grace below. */
export const DEFAULT_DISPOSE_EOF_GRACE_MS = 6_000

/** Grace between termination tiers, matching the sibling ACP backend's default. */
export const DEFAULT_DISPOSE_GRACE_MS = 3_000

/**
 * The largest delay a Node timer can hold. The Host's own timer service asserts
 * the same bound; declaring it here keeps this package free of a runtime import.
 */
export const MAX_TIMER_DELAY_MS = 2_147_483_647

/** One agent after resolution: every default applied, `cwd` already validated. */
export interface ResolvedAgent {
  /**
   * The agent's configured `name`. Consumers address an agent by it: it is the
   * model id on the `acp` route and the stem of that agent's preset card.
   */
  readonly providerName: string
  readonly command: string
  readonly args: readonly string[]
  readonly cwd: string | undefined
  readonly mode: string | undefined
  readonly configOptions: ReadonlyMap<string, string | number | boolean>
  readonly permission: PermissionPolicy
  readonly env: Record<string, string>
}

/** The row after resolution. */
export interface ResolvedOptions {
  readonly agents: readonly ResolvedAgent[]
  readonly disposeEofGraceMs: number
  readonly disposeGraceMs: number
}

/**
 * Read a schemastery `.volatile()` field. The loader hands a volatile field to
 * the plugin as a live reference, so the current value is read through `get()`;
 * a caller that constructs the config directly (a test, a spike) may pass the
 * plain value instead, and both are accepted.
 * @param field - the raw volatile field.
 * @returns the current value, or `undefined`.
 */
export function readVolatile<T>(field: VolatileRef<T> | T | undefined): T | undefined {
  if (field === undefined || field === null) return undefined
  if (typeof field === 'object' && typeof (field as { get?: unknown }).get === 'function') {
    return (field as { get(): T }).get()
  }
  return field as T
}

/**
 * Read a non-empty string.
 * @param raw - the value as parsed (untrusted).
 * @param key - the config key, for the diagnostic.
 * @returns the value, or `undefined` when absent.
 */
function optionalString(raw: unknown, key: string): string | undefined {
  if (raw === undefined || raw === null) return undefined
  if (typeof raw !== 'string' || raw === '') {
    throw new Error(`${CONFIG_PREFIX}: \`${key}\` must be a non-empty string`)
  }
  return raw
}

/**
 * Read a positive finite millisecond bound that fits a Node timer.
 * @param raw - the value as parsed (untrusted).
 * @param key - the config key, for the diagnostic.
 * @param fallback - the default applied when absent.
 * @returns the validated bound.
 */
function grace(raw: unknown, key: string, fallback: number): number {
  if (raw === undefined || raw === null) return fallback
  if (typeof raw !== 'number' || !Number.isFinite(raw) || raw <= 0 || raw > MAX_TIMER_DELAY_MS) {
    throw new Error(`${CONFIG_PREFIX}: \`${key}\` must be a positive finite number no greater than ${MAX_TIMER_DELAY_MS}`)
  }
  return raw
}

/**
 * Read one of a closed set of string values.
 * @param raw - the value as parsed (untrusted).
 * @param key - the config key, for the diagnostic.
 * @param allowed - the accepted values.
 * @param fallback - the default applied when absent.
 * @returns the validated value.
 */
function oneOf<T extends string>(raw: unknown, key: string, allowed: readonly T[], fallback: T): T {
  if (raw === undefined || raw === null) return fallback
  const match = allowed.find(value => value === raw)
  if (match === undefined) throw new Error(`${CONFIG_PREFIX}: \`${key}\` must be one of ${allowed.join(', ')}`)
  return match
}

/**
 * Read a string list, preserving order.
 * @param raw - the value as parsed (untrusted).
 * @param key - the config key, for the diagnostic.
 * @returns the list, or `undefined` when absent.
 */
function stringList(raw: unknown, key: string): string[] | undefined {
  if (raw === undefined || raw === null) return undefined
  if (!Array.isArray(raw) || raw.some(item => typeof item !== 'string')) {
    throw new Error(`${CONFIG_PREFIX}: \`${key}\` must be an array of strings`)
  }
  return raw as string[]
}

/**
 * Read a map of scalars, coercing YAML scalars to text where the target is an
 * environment entry.
 * @param raw - the value as parsed (untrusted).
 * @param key - the config key, for the diagnostic.
 * @param coerce - whether numbers and booleans are stringified.
 * @returns the resolved map.
 */
function scalarMap(raw: unknown, key: string, coerce: boolean): Record<string, string> {
  if (raw === undefined || raw === null) return {}
  if (typeof raw !== 'object' || Array.isArray(raw)) {
    throw new Error(`${CONFIG_PREFIX}: \`${key}\` must be a mapping`)
  }
  const result: Record<string, string> = {}
  for (const [name, value] of Object.entries(raw as Record<string, unknown>)) {
    if (typeof value === 'string') { result[name] = value; continue }
    if (coerce && (typeof value === 'number' || typeof value === 'boolean')) { result[name] = String(value); continue }
    throw new Error(`${CONFIG_PREFIX}: \`${key}.${name}\` must be ${coerce ? 'a string, number, or boolean' : 'a string'}`)
  }
  return result
}

/**
 * Read session configuration options. Values stay typed: a boolean option is a
 * different ACP request shape than a select option.
 * @param raw - the value as parsed (untrusted).
 * @param key - the config key, for the diagnostic.
 * @returns the options in declaration order.
 */
function configOptions(raw: unknown, key: string): ReadonlyMap<string, string | number | boolean> {
  if (raw === undefined || raw === null) return new Map()
  if (typeof raw !== 'object' || Array.isArray(raw)) {
    throw new Error(`${CONFIG_PREFIX}: \`${key}\` must be a mapping of option ids to values`)
  }
  const options = new Map<string, string | number | boolean>()
  for (const [name, value] of Object.entries(raw as Record<string, unknown>)) {
    if (typeof value !== 'string' && typeof value !== 'number' && typeof value !== 'boolean') {
      throw new Error(`${CONFIG_PREFIX}: \`${key}.${name}\` must be a string, number, or boolean`)
    }
    options.set(name, value)
  }
  return options
}

/**
 * Resolve one configured agent.
 * @param raw - the agent entry as parsed (untrusted).
 * @param index - its position, for the diagnostic.
 * @returns the resolved agent.
 */
function resolveAgent(raw: unknown, index: number): ResolvedAgent {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    throw new Error(`${CONFIG_PREFIX}: \`agents[${index}]\` must be a mapping`)
  }
  const record = raw as Record<string, unknown>
  const where = (key: string): string => `agents[${index}].${key}`
  const name = optionalString(record['name'], where('name'))
  if (name === undefined) throw new Error(`${CONFIG_PREFIX}: \`${where('name')}\` is required`)
  const command = optionalString(record['command'], where('command'))
  if (command === undefined) throw new Error(`${CONFIG_PREFIX}: \`${where('command')}\` is required`)
  const cwd = optionalString(record['cwd'], where('cwd'))
  return {
    providerName: name,
    command,
    args: stringList(record['args'], where('args')) ?? DEFAULT_ARGS,
    cwd: cwd === undefined ? undefined : assertUsableCwd(CONFIG_PREFIX, `config ${where('cwd')}`, resolvePath(cwd)),
    mode: optionalString(record['mode'], where('mode')),
    configOptions: configOptions(record['configOptions'], where('configOptions')),
    permission: oneOf(record['permission'], where('permission'), ['allow', 'reject'] as const, DEFAULT_PERMISSION),
    env: scalarMap(record['env'], where('env'), true),
  }
}

/**
 * Resolve the row configuration into the agents to mount.
 *
 * Unknown keys are refused rather than ignored: an unrecognized key in a YAML
 * patch or a settings draft is almost always a typo whose silently-ignored form
 * is a run that behaves nothing like the author intended. Disabled agents are
 * parsed and then dropped, so a half-written draft is still a load-time error
 * rather than a surprise at the first turn.
 * @param raw - the configuration the Loader or a settings write produced.
 * @returns the resolved options.
 */
export function resolveOptions(raw: unknown): ResolvedOptions {
  const record = (raw ?? {}) as Record<string, unknown>
  if (typeof record !== 'object' || Array.isArray(record)) {
    throw new Error(`${CONFIG_PREFIX}: config must be a mapping`)
  }
  const agentsField = readVolatile(record['agents'] as AcpAgentConfig[] | undefined) ?? []
  if (!Array.isArray(agentsField)) throw new Error(`${CONFIG_PREFIX}: \`agents\` must be an array`)
  const seen = new Set<string>()
  const agents: ResolvedAgent[] = []
  for (const [index, entry] of agentsField.entries()) {
    const agent = resolveAgent(entry, index)
    if (seen.has(agent.providerName)) {
      throw new Error(`${CONFIG_PREFIX}: duplicate agent name "${agent.providerName}" — every agent needs its own \`name\``)
    }
    seen.add(agent.providerName)
    if ((entry as { enabled?: unknown }).enabled === false) continue
    agents.push(agent)
  }
  return {
    agents,
    disposeEofGraceMs: grace(record['disposeEofGraceMs'], 'disposeEofGraceMs', DEFAULT_DISPOSE_EOF_GRACE_MS),
    disposeGraceMs: grace(record['disposeGraceMs'], 'disposeGraceMs', DEFAULT_DISPOSE_GRACE_MS),
  }
}
