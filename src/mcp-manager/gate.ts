/**
 * Host-side gate that enforces the MCP tool policy.
 *
 * Three seams, from weakest to strongest, exactly as the tools subsystem
 * intends them:
 *
 * - `ctx.tools.restrict()` removes the denied tools from ONE agent's visible
 *   set, so the model never receives their schemas. This is the "you cannot
 *   see it" half.
 * - `tools/pre-execute` answers `ask`, so a call to a gated tool stops and DSH
 *   shows its own approval card before anything reaches the server.
 * - `ctx.tools.guard()` refuses the call outright. A guard runs after the
 *   pre-execute waterfall and after an approval resolves, and no later
 *   listener can turn a denial back into permission — this is the floor that
 *   holds even if the visible set lags behind a server reconnect.
 *
 * Hidden tools are computed as a complement: every tool the registry knows for
 * a gated server, minus the ones the policy names as `allow` or `ask`. A tool
 * the server adds later therefore arrives denied, which is the property a
 * deny-list can never have.
 *
 * @module dsh-session-map/mcp-manager/gate
 */
import type { Context } from '@deepseek-ai/cordis'
import { readPolicy, permissionOf, type PolicyFile } from './policy'
import type { ToolPermission } from './model'

/** Structural face of the tool registry this gate needs. */
interface ToolsLike {
  definitions(scope?: unknown): readonly { readonly name: string }[]
  restrict(filter: {
    readonly allow?: readonly string[]
    readonly deny?: readonly string[]
  }): () => void
  guard(
    guard: (exec: ToolCallLike) => string | { readonly reason: string } | undefined,
  ): () => void
}

/** One pending call as the policy seams see it. */
interface ToolCallLike {
  readonly name: string
  readonly arguments?: unknown
}

/** Structural face of the agent registry. */
interface AgentsLike {
  list(): readonly AgentLike[]
}

/** One live agent. */
interface AgentLike {
  readonly ctx: Context
}

/** Structural face of a scoped context's service lookup. */
interface ServiceLocator {
  get(name: string): unknown
}

/** Read one optional service from a context without an inject requirement. */
function lookup<T>(ctx: Context, name: string): T | undefined {
  return (ctx as unknown as ServiceLocator).get(name) as T | undefined
}

/** A disposer that does nothing; used while an entry is being replaced. */
function noop(): void {}

/**
 * Read the tool registry from one agent's own scope.
 *
 * The scoped read matters: `restrict()` reads the CALLING context's scope, so
 * a registry taken from anywhere else would restrict the wrong view.
 *
 * @param agent - the agent whose visible set is being narrowed.
 */
function scopedTools(agent: AgentLike): ToolsLike | undefined {
  try {
    return lookup<ToolsLike>(agent.ctx, 'tools')
  } catch {
    return undefined
  }
}

/** Register one event listener on a context without widening its event map. */
function onEvent<A extends unknown[]>(
  ctx: Context,
  name: string,
  listener: (...args: A) => void,
): () => void {
  return (ctx as unknown as {
    on(event: string, handler: (...args: A) => void): () => void
  }).on(name, listener)
}

/** The policy every gate in this process reads. */
let POLICY: PolicyFile = { version: 1, servers: {} }

/** Sinks that re-apply the policy after it changes. */
const GATES = new Set<() => void>()

/** Serialises policy reloads so two route writes cannot interleave. */
let loading: Promise<void> | undefined

/**
 * Reload the policy and re-apply it to every live agent.
 *
 * The tool seams are synchronous (`guard` in particular cannot await), so the
 * policy is kept in memory and refreshed here whenever the file changes.
 *
 * @param profileDir - profile directory holding the policy file.
 */
export function reloadGatePolicy(profileDir: string): Promise<void> {
  loading = (loading ?? Promise.resolve())
    .then(async () => {
      POLICY = await readPolicy(profileDir)
      for (const apply of GATES) apply()
    })
    .catch(() => undefined)
  return loading
}

/** Re-apply the current in-memory policy without touching the filesystem. */
export function refreshGates(): void {
  for (const apply of GATES) apply()
}

/**
 * Read the permission that decides one registered tool.
 * @param name - model-facing tool name (`mcp__<server>__<tool>`).
 * @returns the decision, or `undefined` when no policy governs this tool.
 */
function decisionFor(name: string): {
  readonly server: string
  readonly tool: string
  readonly permission: ToolPermission
} | undefined {
  for (const server of Object.keys(POLICY.servers)) {
    const prefix = `mcp__${server}__`
    if (!name.startsWith(prefix)) continue
    const tool = name.slice(prefix.length)
    const permission = permissionOf(POLICY, server, tool)
    if (permission === undefined) return undefined
    return { server, tool, permission }
  }
  return undefined
}

/**
 * Render the arguments the approval card shows as one readable line.
 *
 * The approval request itself carries no arguments, so whatever the human
 * needs to judge has to arrive inside the text we hand it.
 *
 * @param value - parsed call arguments.
 * @returns up to three `key=value` pairs, or an empty string.
 */
function summarizeArguments(value: unknown): string {
  if (typeof value !== 'object' || value === null) return ''
  const parts: string[] = []
  for (const [key, raw] of Object.entries(value as Record<string, unknown>)) {
    if (parts.length >= 3) break
    if (typeof raw !== 'string' && typeof raw !== 'number' && typeof raw !== 'boolean') continue
    const text = String(raw)
    parts.push(`${key}=${text.length > 40 ? `${text.slice(0, 40)}…` : text}`)
  }
  return parts.join(' · ')
}

/**
 * Install the gate on a context that provides `tools` and `agents`.
 *
 * A composition without either one keeps every other seat: the gate simply
 * never activates, and MCP tools behave as they did before.
 *
 * @param ctx - plugin context.
 * @param profileDir - profile directory holding the policy file.
 */
export function installMcpToolGate(ctx: Context, profileDir: string): void {
  try {
    void reloadGatePolicy(profileDir)
    installGate(ctx)
  } catch {
    // A gate that cannot install must not take this plugin, and the Host's
    // other seats, down with it. MCP tools then simply behave as they did.
  }
}

/** Register the three seams; kept separate so one failure cannot escape `apply`. */
function installGate(ctx: Context): void {
  ctx.inject(['tools', 'agents'], (scope) => {
    const tools = lookup<ToolsLike>(scope, 'tools')
    const agents = lookup<AgentsLike>(scope, 'agents')
    if (tools === undefined || agents === undefined) return

    /** One agent's applied restriction, so a re-apply replaces instead of stacking. */
    const applied = new Map<AgentLike, { key: string; dispose: () => void }>()

    /** Hidden tool names for the current policy, from the unrestricted global view. */
    const hiddenNames = (): string[] => {
      const hidden: string[] = []
      for (const definition of tools.definitions()) {
        const decision = decisionFor(definition.name)
        if (decision !== undefined && decision.permission === 'deny') hidden.push(definition.name)
      }
      return hidden.sort()
    }

    /**
     * Re-entrancy latch.
     *
     * `restrict()` and its disposer emit `tools/change` SYNCHRONOUSLY, so the
     * listener below runs again inside the very call that is changing the
     * restriction. Without this latch the gate re-enters itself forever.
     */
    let applying = false

    /** Set once the owning scope tears down, so late emissions do nothing. */
    let toreDown = false

    /** Apply the visible-set restriction to one agent. */
    const sync = (agent: AgentLike): void => {
      if (applying || toreDown) return
      const previous = applied.get(agent)
      let deny: string[]
      try {
        deny = hiddenNames()
      } catch {
        return
      }
      const key = deny.join('\n')
      if (previous !== undefined && previous.key === key) return
      // Nothing to hide and nothing applied yet: leave the agent alone rather
      // than spend a restriction on every agent in a profile with no policy.
      if (previous === undefined && deny.length === 0) return

      applying = true
      try {
        previous?.dispose()
        // Record the intent BEFORE the call: `restrict()` emits on the way in,
        // and the listener would otherwise see the stale (or absent) entry and
        // start a second pass.
        applied.set(agent, { key, dispose: noop })
        const dispose = scopedTools(agent)?.restrict({ deny })
        if (dispose === undefined) {
          applied.delete(agent)
          return
        }
        applied.set(agent, { key, dispose })
      } catch {
        // A tool that vanished between the read and the restrict must never
        // take the agent loop down with it.
        applied.delete(agent)
      } finally {
        applying = false
      }
    }

    /** Re-apply to every agent this gate has already seen. */
    const syncAll = (): void => {
      if (applying || toreDown) return
      for (const agent of agents.list()) sync(agent)
      for (const agent of applied.keys()) sync(agent)
    }

    // 1. Visibility: the model never receives a schema for a hidden tool.
    onEvent(scope, 'agent/created', (payload: { agent: AgentLike }) => {
      sync(payload.agent)
    })
    // Tool registrations come and go (server connect, reconnect, tool-list
    // change), and asynchronously after the first agent exists.
    onEvent(scope, 'tools/change', syncAll)

    // 2. Approval: an `ask` tool stops before dispatch.
    onEvent(
      scope,
      'tools/pre-execute',
      async (
        exec: ToolCallLike,
        next: () => Promise<unknown>,
      ): Promise<unknown> => {
        const decision = decisionFor(exec.name)
        if (decision === undefined || decision.permission !== 'ask') return next()
        const summary = summarizeArguments(exec.arguments)
        const subject = summary === '' ? decision.tool : `${decision.tool} · ${summary}`
        return {
          kind: 'ask',
          reason: `mcp ${decision.server}: ${decision.tool}`,
          displayReason: {
            en: `Run ${subject} on ${decision.server}?`,
            zh: `允许在 ${decision.server} 上执行 ${subject}？`,
          },
        }
      },
    )

    // 3. Floor: a denied tool cannot run even if it is somehow still visible.
    tools.guard((exec) => {
      const decision = decisionFor(exec.name)
      if (decision === undefined) return undefined
      if (decision.permission !== 'deny') return undefined
      return { reason: `工具 ${decision.tool} 未在 ${decision.server} 上开启` }
    })

    GATES.add(syncAll)
    scope.effect(() => () => {
      // Mark the latch first: disposing a restriction emits `tools/change`,
      // and the listener is still attached while this loop runs.
      toreDown = true
      GATES.delete(syncAll)
      for (const entry of applied.values()) entry.dispose()
      applied.clear()
    })

    for (const agent of agents.list()) sync(agent)
  })
}
