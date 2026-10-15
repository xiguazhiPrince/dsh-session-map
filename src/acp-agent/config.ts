/**
 * This row's configuration: the shared `agents` list plus the fields the
 * conversational route adds on top of it.
 *
 * `agentSchema` and agent resolution live in `src/acp-core` because they are
 * vendor-shaped facts rather than properties of this route — the command a CLI
 * is launched by, the permission vocabulary, the defaults. This module only adds
 * what is specific to keeping a Session alive on top of one agent.
 *
 * @module dsh-session-map/acp-agent/config
 */
import z from '@deepseek-ai/schemastery'
import {
  agentSchema,
  MAX_TIMER_DELAY_MS,
  resolveOptions as resolveSharedOptions,
  type ResolvedAgent,
} from '../acp-core/config'
import { assertAgentNameUnambiguous } from './model-id'

/** This row's diagnostic prefix. */
export const PREFIX = 'dsh-session-map/acp-agent'

/**
 * How long a channel may sit idle before its process is reaped. A conversational
 * route holds one agent process per (Session × agent), and nothing else in the
 * Host knows when a Session has gone quiet, so the route reaps its own.
 */
export const DEFAULT_IDLE_DISPOSE_MS = 10 * 60 * 1000

/**
 * How long an `eager` model-list read may wait for one agent's handshake.
 *
 * Measured on this machine: `cursor-agent acp` takes 7–14 s from spawn to a
 * published model list, almost all of it `session/new`, so a timeout much below
 * this would make `eager` a guaranteed fallback rather than a choice. It is also
 * the bound the composer's mode control uses for its own read, whatever
 * `modelDiscovery` says; the shared probe underneath both carries the longer
 * {@link DEFAULT_BACKGROUND_DISCOVERY_TIMEOUT_MS} instead.
 */
export const DEFAULT_DISCOVERY_TIMEOUT_MS = 15_000

/** How long a discovered model list stays usable before it is probed again. */
export const DEFAULT_DISCOVERY_TTL_MS = 5 * 60 * 1000

/**
 * The bound the shared discovery probe gets.
 *
 * Nothing waits on the probe itself — every caller bounds its own wait with
 * {@link DEFAULT_DISCOVERY_TIMEOUT_MS} and walks away — so it gets the generous
 * bound a slow agent needs. Measured against cursor-agent: 7–14 s typically, one
 * 37.6 s outlier, and one transient `session/new` failure out of five handshakes,
 * which is why a failed or timed-out probe must degrade rather than fail
 * anything.
 */
export const DEFAULT_BACKGROUND_DISCOVERY_TIMEOUT_MS = 60 * 1000

/**
 * How a failed discovery is remembered. Short, because the usual cause is a
 * transient one (no login yet, a busy agent) and a stale negative would hide a
 * model list that has since become available.
 */
export const DEFAULT_DISCOVERY_FAILURE_TTL_MS = 60 * 1000

/** When the route may spawn an agent just to read its model list. */
export type ModelDiscoveryMode = 'off' | 'lazy' | 'eager'

/**
 * The shipped discovery mode.
 *
 * `eager`, so the model picker is **complete the first time it opens** instead of
 * starting with one entry and growing a few seconds later: `listModels` waits for
 * the handshake inside {@link DEFAULT_DISCOVERY_TIMEOUT_MS} and answers with the
 * agent's own entries in that same read.
 *
 * The price is stated plainly because it is paid on the render path: a catalog
 * read now blocks on an agent process — 7–14 s for `cursor-agent`, one 37.6 s
 * outlier, and one transient `session/new` failure in five handshakes. The wait is
 * bounded, and a timeout degrades to the legacy entry rather than failing the
 * read, so the worst case is the old behaviour.
 *
 * This constant was `lazy` through P9–P12. That mode remains the right choice for
 * a deployment that will not block a read on a process: it answers instantly,
 * warms the same cache in the background, and the route then announces the
 * enriched list so the browser re-reads it (P12).
 */
export const DEFAULT_MODEL_DISCOVERY: ModelDiscoveryMode = 'eager'

/**
 * The plugin's Config schema. `agents` stays volatile so the settings service
 * offers it as a live-editable field.
 */
export const Config = z.object({
  agents: z.array(agentSchema).default([]).volatile(),
  disposeEofGraceMs: z.number(),
  disposeGraceMs: z.number(),
  idleDisposeMs: z.number(),
  utilityProvider: z.string(),
  utilityModel: z.string(),
  approval: z.union(['ask', 'policy'] as const),
  fs: z.union(['bridge', 'isolate'] as const),
  modelDiscovery: z.union(['off', 'lazy', 'eager'] as const),
  discoveryTimeoutMs: z.number(),
  discoveryTtlMs: z.number(),
})

/** How the route answers an ACP `session/request_permission`. */
export type ApprovalMode = 'ask' | 'policy'

/**
 * Whether the Host filesystem is offered to the remote agent.
 *
 * `bridge` advertises `fs/read_text_file` and `fs/write_text_file` and serves
 * them through `ctx.fs`, so the agent's file access obeys this Session's sandbox
 * and its writes are ordinary Host writes. `isolate` advertises nothing and
 * leaves the agent's own filesystem alone, which is what every phase before this
 * one did.
 */
export type FsMode = 'bridge' | 'isolate'

/** One utility route the Host may borrow for compaction and title generation. */
export interface UtilityRoute {
  readonly provider: string
  readonly model: string
}

/** The row after resolution. */
export interface ResolvedRouteOptions {
  readonly agents: readonly ResolvedAgent[]
  readonly disposeEofGraceMs: number
  readonly disposeGraceMs: number
  readonly idleDisposeMs: number
  /**
   * Where Host utility calls (`purpose: 'compaction' | 'session-title'`) go.
   * Undefined means the route declines them and the Host's own fallback stands.
   */
  readonly utility: UtilityRoute | undefined
  /**
   * `policy` auto-answers with each agent's own `permission` setting (the core's
   * behaviour, and this row's default). `ask` routes the
   * decision to the Host's approval service so the question appears in the
   * Session's own conversation; unavailable approval falls back to `policy`.
   */
  readonly approval: ApprovalMode
  /**
   * `bridge` (the default) offers the Host filesystem to the remote agent so its
   * reads and writes are Host reads and writes, fenced by this Session's sandbox.
   * `isolate` restores the pre-bridge behaviour of advertising no file capability.
   */
  readonly fs: FsMode
  /**
   * Whether the route may spawn an agent to read the model list it advertises.
   * `off` keeps the catalog to one entry per configured agent; `lazy` warms a
   * cache in the background; `eager` — the shipped default — waits for the
   * handshake within {@link ResolvedRouteOptions.discoveryTimeoutMs}.
   */
  readonly modelDiscovery: ModelDiscoveryMode
  /** Upper bound on one discovery handshake, in milliseconds. */
  readonly discoveryTimeoutMs: number
  /** How long a discovered list is reused before it is probed again, in milliseconds. */
  readonly discoveryTtlMs: number
}

/**
 * @param raw - one raw config value.
 * @returns the trimmed string, or undefined for a non-string or empty value.
 */
function optionalString(raw: unknown): string | undefined {
  if (typeof raw !== 'string') return undefined
  const trimmed = raw.trim()
  return trimmed === '' ? undefined : trimmed
}

/**
 * Read a positive finite millisecond bound that fits a Node timer.
 * @param raw - the value as parsed (untrusted).
 * @param key - the config key, for the diagnostic.
 * @param fallback - the default applied when absent.
 * @returns the validated bound.
 */
function boundedMs(raw: unknown, key: string, fallback: number): number {
  if (raw === undefined || raw === null) return fallback
  if (typeof raw !== 'number' || !Number.isFinite(raw) || raw <= 0 || raw > MAX_TIMER_DELAY_MS) {
    throw new Error(`${PREFIX}: \`${key}\` must be a positive finite number no greater than ${MAX_TIMER_DELAY_MS}`)
  }
  return raw
}

/**
 * Resolve the row configuration.
 *
 * The agents and the disposal graces come from the shared resolver, so both ACP
 * rows accept and reject exactly the same agent entries. The utility route is
 * all-or-nothing on purpose: a provider without a model would silently borrow a
 * sibling route, which is the kind of half-configuration that looks like it works.
 * @param raw - the configuration the Loader or a settings write produced.
 * @returns the resolved options.
 */
export function resolveRouteOptions(raw: unknown): ResolvedRouteOptions {
  const shared = resolveSharedOptions(raw)
  const record = (raw ?? {}) as Record<string, unknown>

  // The model-id scheme needs this, and this is the only place it can be
  // enforced: a name containing the separator would make "agent::value"
  // ambiguous, and no later code can recover which of the two the author meant.
  // Checked over the resolved agents, which is exactly the set whose names
  // become model ids.
  for (const agent of shared.agents) {
    assertAgentNameUnambiguous(PREFIX, agent.providerName, `agents[].name "${agent.providerName}"`)
  }

  const utilityProvider = optionalString(record['utilityProvider'])
  const utilityModel = optionalString(record['utilityModel'])
  if ((utilityProvider === undefined) !== (utilityModel === undefined)) {
    throw new Error(`${PREFIX}: \`utilityProvider\` and \`utilityModel\` must be set together`)
  }

  const idle = record['idleDisposeMs']
  const idleDisposeMs = typeof idle === 'number' && Number.isFinite(idle) && idle > 0
    ? idle
    : DEFAULT_IDLE_DISPOSE_MS

  const discovery = record['modelDiscovery']

  return {
    agents: shared.agents,
    disposeEofGraceMs: shared.disposeEofGraceMs,
    disposeGraceMs: shared.disposeGraceMs,
    idleDisposeMs,
    approval: record['approval'] === 'ask' ? 'ask' : 'policy',
    fs: record['fs'] === 'isolate' ? 'isolate' : 'bridge',
    // Every value the schema accepts has to survive this. Naming only the two the
    // default is not, ever, is how an explicit `lazy` silently becomes the default
    // — which read correctly only while `lazy` *was* the default.
    modelDiscovery: discovery === 'off' || discovery === 'lazy' || discovery === 'eager'
      ? discovery
      : DEFAULT_MODEL_DISCOVERY,
    discoveryTimeoutMs: boundedMs(record['discoveryTimeoutMs'], 'discoveryTimeoutMs', DEFAULT_DISCOVERY_TIMEOUT_MS),
    discoveryTtlMs: boundedMs(record['discoveryTtlMs'], 'discoveryTtlMs', DEFAULT_DISCOVERY_TTL_MS),
    utility: utilityProvider === undefined || utilityModel === undefined
      ? undefined
      : { provider: utilityProvider, model: utilityModel },
  }
}
