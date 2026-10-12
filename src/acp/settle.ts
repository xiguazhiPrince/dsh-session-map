/**
 * Run settlement: the Host-facing half of one child, kept in one place.
 *
 * The semantics are the Host seam's, reimplemented here rather than imported
 * (see `./contract.ts` for why this package carries no `@deepseek-ai/*` runtime
 * import). The three facts that matter and must not drift:
 *
 * 1. `result` settles, it does not reject. A child-level failure becomes
 *    `stopReason: 'error'` with provider-authored detail, so the consumer maps
 *    it to an error result instead of an exception.
 * 2. Local cancellation wins over the child's own outcome: once the caller
 *    cancelled, the run is `aborted` even if the child then reported success.
 * 3. `dispose()` is idempotent: one memoized teardown, and it settles local
 *    cancellation before awaiting actual quiescence because nothing guarantees
 *    the child cooperates.
 *
 * @module dsh-session-map/acp/settle
 */
import type { SubagentResult, SubagentRun, SubagentStopReason, TextBlock } from './contract'

/** Maximum UTF-8 size of a provider-authored diagnostic, matching the Host boundary. */
const MAX_DIAGNOSTIC_BYTES = 4_096

const DIAGNOSTIC_TRUNCATION_SUFFIX = '\n[diagnostic truncated]'
const utf8Encoder = new TextEncoder()
const utf8Decoder = new TextDecoder()

/**
 * Limit provider-authored failure detail without splitting a UTF-8 sequence.
 * @param diagnostic - safe diagnostic text produced by this driver.
 * @returns the original text, or a visibly truncated value within the limit.
 */
export function limitDiagnostic(diagnostic: string): string {
  const bytes = utf8Encoder.encode(diagnostic)
  if (bytes.byteLength <= MAX_DIAGNOSTIC_BYTES) return diagnostic

  const suffixBytes = utf8Encoder.encode(DIAGNOSTIC_TRUNCATION_SUFFIX).byteLength
  let prefixBytes = MAX_DIAGNOSTIC_BYTES - suffixBytes
  while (((bytes[prefixBytes] as number) & 0b1100_0000) === 0b1000_0000) {
    prefixBytes -= 1
  }
  return utf8Decoder.decode(bytes.subarray(0, prefixBytes)) + DIAGNOSTIC_TRUNCATION_SUFFIX
}

/** Normalize an unknown thrown value to an Error (the catch binding is `unknown`). */
export function toError(value: unknown): Error {
  return value instanceof Error ? value : new Error(String(value))
}

/**
 * The accumulated assistant text stream. ACP exposes no complete assistant
 * message, only deltas, so this is the whole selection rule: every
 * `agent_message_chunk` text piece, joined in arrival order.
 */
export class AssistantTextFold {
  private readonly parts: string[] = []

  /**
   * Extend the stream with the next piece.
   * @param text - the next streamed text piece (an empty piece is a no-op).
   */
  pushText(text: string): void {
    if (text.length > 0) this.parts.push(text)
  }

  /**
   * Select the text folded so far.
   * @returns the accumulated blocks, or `[]` when the child produced no text.
   */
  collect(): readonly TextBlock[] {
    const text = this.parts.join('')
    return text.length > 0 ? [{ type: 'text', text }] : []
  }
}

/** Inputs to {@link settleRunResult}. */
export interface RunResultSettlement {
  /** The turn attempt (raced against local cancellation); returns the terminal result. */
  attempt: () => Promise<SubagentResult>
  /** Snapshot of the output accumulated so far. */
  collectOutput: () => readonly TextBlock[]
  /** Snapshot of the safe detail when a failure wins settlement. */
  collectDiagnostic?: (() => string | undefined) | undefined
  /** Whether local cancellation settled before the attempt's outcome is observed. */
  cancelled: () => boolean
  /** Diagnostic sink for a failure flattened to a stop reason; a throw is contained. */
  onError?: ((error: Error, stopReason: SubagentStopReason) => void) | undefined
  /** The caller's cancellation signal (the listener is removed at settlement). */
  signal: AbortSignal
  /** The abort listener registered on {@link signal} at start. */
  onAbort: () => void
}

/**
 * Settle a run result under the seam contract: `result` never rejects after
 * publication. The abort listener is removed on every path.
 * @param parts - the attempt, output snapshot, cancellation state, sink, and signal wiring.
 * @returns the terminal result (never a rejection).
 */
export async function settleRunResult(parts: RunResultSettlement): Promise<SubagentResult> {
  try {
    const result = await parts.attempt()
    return parts.cancelled()
      ? { output: parts.collectOutput(), stopReason: 'aborted' }
      : { ...result, ...(result.diagnostic === undefined ? {} : { diagnostic: limitDiagnostic(result.diagnostic) }) }
  } catch (error: unknown) {
    // Cover a rejection already queued when cancellation arrived.
    if (parts.cancelled()) return { output: parts.collectOutput(), stopReason: 'aborted' }
    try {
      parts.onError?.(toError(error), 'error')
    } catch {
      // The diagnostic sink cannot reject the run result.
    }
    const collected = parts.collectDiagnostic?.()
    return {
      output: parts.collectOutput(),
      ...(collected === undefined ? {} : { diagnostic: limitDiagnostic(collected) }),
      stopReason: 'error',
    }
  } finally {
    parts.signal.removeEventListener('abort', parts.onAbort)
  }
}

/** Inputs to {@link runHandle}. */
export interface RunHandleParts {
  /** The parent-scoped run id. */
  readonly id: string
  /** The settled, never-rejecting result. */
  readonly result: Promise<SubagentResult>
  /** The caller's cancellation signal (the listener is removed on dispose). */
  readonly signal: AbortSignal
  /** The abort listener registered on {@link signal} at start. */
  readonly onAbort: () => void
  /** Settle local cancellation so {@link result} resolves without the child. */
  readonly requestCancel: () => void
  /** Tear the child process down to quiescence. */
  readonly teardown: () => Promise<void>
}

/**
 * Publish the run handle for an out-of-process child.
 * @param parts - the run identity, result, cancellation wiring, and teardown.
 * @returns the seam run handle (`localAgent` is `undefined` for remote runs).
 */
export function runHandle(parts: RunHandleParts): SubagentRun {
  let disposal: Promise<void> | undefined
  return {
    id: parts.id,
    localAgent: undefined,
    result: parts.result,
    dispose(): Promise<void> {
      if (disposal !== undefined) return disposal
      parts.signal.removeEventListener('abort', parts.onAbort)
      parts.requestCancel()
      disposal = parts.teardown()
      return disposal
    },
  }
}
