/**
 * The parts of an ACP client that are true regardless of what the session is
 * for: how permission prompts are auto-answered, which extension methods must be
 * answered so a turn cannot hang, and how a spawned agent is reaped.
 *
 * These are exactly the pieces that would otherwise be re-derived by every route
 * that speaks ACP; anything shaped by what a route does with the agent belongs
 * in that route, not here.
 *
 * Provenance: `@agentclientprotocol/sdk` (`PermissionOption`,
 * `RequestPermissionResponse`) and `@deepseek-ai/dsh-subprocess`
 * (`SubprocessHandle`, `SubprocessSpawnSpec`).
 *
 * @module dsh-session-map/acp-core/client
 */
import type { PermissionOption, RequestPermissionResponse } from '@agentclientprotocol/sdk'
import type { PermissionPolicy } from './config'
import type { SubprocessHandle } from './contract'

/**
 * Blocking extension requests: an agent whose protocol is not pure ACP asks the
 * client to answer and waits for the response. Cursor's are the ones known
 * today. Each is answered with {@link DECLINED_EXTENSION_RESPONSE} so a turn
 * that would otherwise wait for a human still terminates. A method NOT listed
 * here receives the transport's method-not-found response, which is also a valid
 * decline — entries exist so the decline is visible rather than implicit.
 */
export const BLOCKING_EXTENSION_METHODS: readonly string[] = [
  'cursor/ask_question',
  'cursor/create_plan',
]

/**
 * Notification-only extension methods. They need no response, but registering a
 * no-op handler keeps them out of the transport's unknown-method path and makes
 * the accepted surface explicit.
 */
export const NOTIFICATION_EXTENSION_METHODS: readonly string[] = [
  'cursor/update_todos',
  'cursor/task',
  'cursor/generate_image',
]

/**
 * The response given to a blocking extension request. An empty object is the
 * most permissive "nothing to contribute" answer: it neither approves a plan nor
 * fabricates an answer, and it lets the agent decide how to continue with an
 * unanswered question rather than surfacing a protocol error that would discard
 * the turn's work.
 */
export const DECLINED_EXTENSION_RESPONSE: Record<string, unknown> = {}

/** Normalize an unknown thrown value to an Error (the catch binding is `unknown`). */
export function toError(value: unknown): Error {
  return value instanceof Error ? value : new Error(String(value))
}

/**
 * Auto-answer one permission request. `allow` prefers a one-shot approval so a
 * session cannot widen the agent's own persisted permission state; a request
 * that offers no allow option at all is declined rather than guessed at.
 * @param policy - the configured policy.
 * @param options - the options the agent offered, in its own order.
 * @returns the response and the decision recorded for diagnostics.
 */
export function decidePermission(
  policy: PermissionPolicy,
  options: readonly PermissionOption[],
): { readonly response: RequestPermissionResponse; readonly decision: 'allowed' | 'denied' } {
  if (policy === 'allow') {
    const allow = options.find(option => option.kind === 'allow_once')
      ?? options.find(option => option.kind === 'allow_always')
    if (allow !== undefined) {
      return {
        response: { outcome: { outcome: 'selected', optionId: allow.optionId } },
        decision: 'allowed',
      }
    }
  }
  return { response: { outcome: { outcome: 'cancelled' } }, decision: 'denied' }
}

/**
 * Cooperative teardown ladder: stdin EOF (the child's window to flush
 * persistence and reap its own descendants), then the seam's terminate
 * escalation and its whole-range exit proof.
 * @param child - the spawned child's handle.
 * @param eofGraceMs - tier-1 window after stdin EOF.
 */
export async function disposeAcpChild(child: SubprocessHandle, eofGraceMs: number): Promise<void> {
  const failures: Error[] = []
  child.stdin?.end()
  let exited = false
  try {
    exited = await waitForExitWithin(child, eofGraceMs)
  } catch (error: unknown) {
    failures.push(toError(error))
  }
  if (!exited) {
    child.terminate()
    try {
      await child.waitForExit()
    } catch (error: unknown) {
      failures.push(toError(error))
    }
  }
  if (failures.length === 1) throw failures[0] as Error
  if (failures.length > 1) throw new AggregateError(failures, 'ACP subprocess teardown failed')
}

/** Bounded managed-range exit wait: observes the handle's range until empty or `ms` elapses. */
async function waitForExitWithin(child: SubprocessHandle, ms: number): Promise<boolean> {
  const controller = new AbortController()
  const timer = setTimeout(() => { controller.abort() }, ms)
  try {
    return await child.waitForExit(controller.signal)
  } finally {
    clearTimeout(timer)
  }
}
