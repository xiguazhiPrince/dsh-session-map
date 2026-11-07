/**
 * Browser half of the fork ledger: observe the one call that knows a fork's
 * source.
 *
 * `sessions.fork({ sessionId, atSeq })` is the public client API every shipped
 * fork entry point calls — the conversation's "fork here" action, the
 * Workspace/UI fork action, and this plugin's BTW. The Host keeps no source id,
 * so wrapping this method is the only place a browser plugin can learn the
 * exact `{ parent, child }` pair.
 *
 * The wrapper is deliberately thin and reversible: it forwards the call
 * untouched, reports the resolved child id to the ledger (`./forks`), and
 * returns the same promise value. A failed fork reports nothing. Installation
 * is idempotent per service instance, so two plugin incarnations (HMR, a
 * re-apply) never wrap twice, and the last disposal restores the original
 * method exactly.
 *
 * @module dsh-session-map/session-map/fork-recorder
 */
import type { Context } from '@deepseek-ai/cordis'
import { recordFork } from './forks'

/** Structural view of the context's untyped service lookup. */
interface ServiceLocator {
  get(name: string): unknown
}

/** The fork request shape this recorder reads; the rest passes through. */
interface ForkRequestLike {
  readonly sessionId?: unknown
  readonly atSeq?: unknown
}

/** The client `ctx.sessions` member this recorder wraps. */
interface ForkSessionsFace {
  fork?(request: ForkRequestLike): Promise<string>
}

/** One wrapper currently installed on a service instance. */
interface ForkRecorder {
  readonly original: NonNullable<ForkSessionsFace['fork']>
  readonly wrapped: NonNullable<ForkSessionsFace['fork']>
  /** Live installers, so an HMR re-apply never stacks a second wrapper. */
  count: number
}

/**
 * Key under which a service instance carries its wrapper. A registered Symbol
 * survives an HMR module reload, so a new incarnation finds the wrapper the old
 * one left instead of stacking a second one.
 */
const RECORDER_KEY = Symbol.for('@xiguazhiprince/dsh-session-map/fork-recorder')

/** The service instance plus its recorder marker. */
type RecorderHost = Record<PropertyKey, unknown>

/**
 * Look up one optional service through the context's untyped lookup.
 * @param ctx - browser context.
 * @param name - service key.
 * @returns the service, or undefined when absent.
 */
function lookup<T>(ctx: Context, name: string): T | undefined {
  const found = (ctx as unknown as ServiceLocator).get(name)
  return found === undefined ? undefined : found as T
}

/**
 * Install the fork recorder on the client Session service.
 *
 * Call from a browser context that provides `sessions`; a composition without
 * it, or a build whose service no longer exposes `fork`, keeps every other seat
 * and simply records nothing.
 * @param ctx - browser context carrying the Session service.
 */
export function installForkRecorder(ctx: Context): void {
  const sessions = lookup<ForkSessionsFace>(ctx, 'sessions')
  if (sessions === undefined || typeof sessions.fork !== 'function') return

  const host = sessions as RecorderHost
  const existing = host[RECORDER_KEY]
  if (typeof existing === 'object' && existing !== null) {
    const recorder = existing as ForkRecorder
    recorder.count += 1
    ctx.effect(() => () => { release(sessions, recorder) }, 'session-map: fork recorder')
    return
  }

  const original = sessions.fork
  const wrapped = function fork(this: unknown, request: ForkRequestLike): Promise<string> {
    const sourceId = typeof request.sessionId === 'string' && request.sessionId !== '' ? request.sessionId : undefined
    const atSeq = typeof request.atSeq === 'number' && Number.isFinite(request.atSeq) ? request.atSeq : undefined
    return Promise.resolve(original.call(this, request)).then((childId) => {
      if (sourceId !== undefined && typeof childId === 'string' && childId !== '' && childId !== sourceId) {
        recordFork({
          childId,
          parentId: sourceId,
          ...(atSeq === undefined ? {} : { atSeq }),
        })
      }
      return childId
    })
  }

  const recorder: ForkRecorder = { original, wrapped, count: 1 }
  try {
    sessions.fork = wrapped
    host[RECORDER_KEY] = recorder
  } catch {
    // A frozen service object keeps its own fork; deduction still covers it.
    return
  }
  ctx.effect(() => () => { release(sessions, recorder) }, 'session-map: fork recorder')
}

/**
 * Drop one installer and restore the original method after the last one leaves.
 * @param sessions - the wrapped service instance.
 * @param recorder - the wrapper this installer owns.
 */
function release(sessions: ForkSessionsFace, recorder: ForkRecorder): void {
  recorder.count -= 1
  if (recorder.count > 0) return
  const host = sessions as RecorderHost
  if (host[RECORDER_KEY] !== recorder) return
  try {
    delete host[RECORDER_KEY]
    if (sessions.fork === recorder.wrapped) sessions.fork = recorder.original
  } catch {
    // The Host-side inference still covers a service that cannot be restored.
  }
}
