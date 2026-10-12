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
import { agentSchema, resolveOptions as resolveSharedOptions, type ResolvedAgent } from '../acp-core/config'

/** This row's diagnostic prefix. */
export const PREFIX = 'dsh-session-map/acp-agent'

/**
 * How long a channel may sit idle before its process is reaped. A conversational
 * route holds one agent process per (Session × agent), and nothing else in the
 * Host knows when a Session has gone quiet, so the route reaps its own.
 */
export const DEFAULT_IDLE_DISPOSE_MS = 10 * 60 * 1000

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

  const utilityProvider = optionalString(record['utilityProvider'])
  const utilityModel = optionalString(record['utilityModel'])
  if ((utilityProvider === undefined) !== (utilityModel === undefined)) {
    throw new Error(`${PREFIX}: \`utilityProvider\` and \`utilityModel\` must be set together`)
  }

  const idle = record['idleDisposeMs']
  const idleDisposeMs = typeof idle === 'number' && Number.isFinite(idle) && idle > 0
    ? idle
    : DEFAULT_IDLE_DISPOSE_MS

  return {
    agents: shared.agents,
    disposeEofGraceMs: shared.disposeEofGraceMs,
    disposeGraceMs: shared.disposeGraceMs,
    idleDisposeMs,
    approval: record['approval'] === 'ask' ? 'ask' : 'policy',
    fs: record['fs'] === 'isolate' ? 'isolate' : 'bridge',
    utility: utilityProvider === undefined || utilityModel === undefined
      ? undefined
      : { provider: utilityProvider, model: utilityModel },
  }
}
