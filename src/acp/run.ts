/**
 * The ACP driver: one spawned agent, one session, one prompt, one settled result.
 *
 * Shape and ownership follow the Host's own out-of-process ACP backend: read
 * the task in, spawn, handshake, publish, prompt, settle, and own cancellation
 * plus quiescent disposal. Everything the driver sends is either standard ACP or
 * driven by the row's configuration — the only vendor knowledge in this file is
 * the {@link BLOCKING_EXTENSION_METHODS} table, which exists because some agents
 * extend ACP with requests a client must answer or the turn waits forever.
 *
 * Three deliberate protocol choices:
 * - No client filesystem or terminal capability is advertised: the child
 *   self-serves in its own process, and advertising a capability this driver
 *   does not truly implement would make the agent read empty files. Verified
 *   against a real agent, which still edited files.
 * - `authenticate` is never called. It is an interactive method; an
 *   unauthenticated install is reported instead of being driven through a login
 *   flow nobody is watching.
 * - `mode` and `configOptions` are applied only when the row asked for them, and
 *   only after `session/new` advertised them.
 *
 * @module dsh-session-map/acp/run
 */
import { randomUUID } from 'node:crypto'
import { Readable as NodeReadable, Writable as NodeWritable } from 'node:stream'
import {
  client as createClientApp,
  methods,
  ndJsonStream,
  PROTOCOL_VERSION,
  RequestError,
  type ContentBlock,
  type PermissionOption,
  type RequestPermissionResponse,
  type StopReason,
} from '@agentclientprotocol/sdk'
import type {
  SubagentRun,
  SubagentStartRequest,
  SubagentStopReason,
  SubprocessHandle,
  SubprocessOutcome,
  SubprocessSpawnSpec,
  TextBlock,
} from './contract'
import type { PermissionPolicy } from './config'
import { PLUGIN_ID } from './config'
import { AssistantTextFold, runHandle, settleRunResult, toError } from './settle'

/** The ACP client name this driver announces, and its protocol identity string. */
const CLIENT_NAME = 'dsh-session-map/acp'

/**
 * The protocol identity announced alongside {@link CLIENT_NAME}. The ACP
 * `Implementation` requires a version, so this is not optional — and it is a
 * protocol identity, not a compatibility claim about the Host.
 */
const CLIENT_VERSION = '0.1.0'

/**
 * Blocking extension requests: an agent whose protocol is not pure ACP asks the
 * client to answer and waits for the response. Cursor's are the ones known
 * today. Each is answered with {@link DECLINED_EXTENSION_RESPONSE} and recorded
 * in the failure diagnostic, so a run that would otherwise wait for a human
 * still terminates. A method NOT listed here receives the transport's
 * method-not-found response, which is also a valid decline — entries exist so
 * the decline is visible rather than implicit.
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
 * The response this driver gives a blocking extension request. An empty object
 * is the most permissive "nothing to contribute" answer: it neither approves a
 * plan nor fabricates an answer, and it lets the agent decide how to continue
 * with an unanswered question rather than surfacing a protocol error that would
 * discard the turn's work.
 */
const DECLINED_EXTENSION_RESPONSE: Record<string, unknown> = {}

/** Which protocol operation an unpublished failure came from. */
type FailureStage = 'initialize' | 'new-session' | 'prompt' | 'process' | 'teardown'

/** The closed failure taxonomy this driver authors. */
type FailureCategory =
  | 'protocol'
  | 'configuration'
  | 'transport'
  | 'process-start'
  | 'process-exit'
  | 'remote-limit'
  | 'unknown'

/** The ACP tool-kind vocabulary; a future value falls back to `unknown`. */
const ACP_TOOL_KINDS: ReadonlySet<string> = new Set([
  'read', 'edit', 'delete', 'move', 'search',
  'execute', 'think', 'fetch', 'switch_mode', 'other',
])

interface FailureFacts {
  readonly stage: FailureStage
  readonly category: FailureCategory
  readonly stopReason?: string | undefined
  readonly outcome?: SubprocessOutcome | undefined
  /** The configured session option that was refused, when the failure is one. */
  readonly configOption?: string | undefined
}

interface PermissionDecision {
  readonly policy: PermissionPolicy
  readonly request: string
  readonly decision: 'allowed' | 'denied'
}

/**
 * Fixed safe failure text derived only from driver-owned structured facts. The
 * provider name comes from the row, so several mountings stay distinguishable.
 * @param providerName - the registry name this provider was mounted as.
 * @param facts - the structured failure facts.
 * @returns the diagnostic line.
 */
function failureDiagnostic(providerName: string, facts: FailureFacts): string {
  const fields = [`provider: ${providerName}`, `stage: ${facts.stage}`, `category: ${facts.category}`]
  if (facts.configOption !== undefined) fields.push(`config option: ${facts.configOption}`)
  if (facts.stopReason !== undefined) fields.push(`stop reason: ${facts.stopReason}`)
  const exitCode = facts.outcome?.exitCode
  if (exitCode !== null && exitCode !== undefined) fields.push(`exit code: ${exitCode}`)
  const signal = facts.outcome?.signal
  if (signal !== null && signal !== undefined) fields.push(`signal: ${signal}`)
  return `ACP failure (${fields.join('; ')})`
}

/** Fixed permission fact; option text and tool titles never enter it. */
function permissionDiagnostic(permission: PermissionDecision): string {
  return `ACP unattended decision (policy: ${permission.policy}; request: ${permission.request}; decision: ${permission.decision})`
}

/**
 * Assemble the failure line plus the notes an operator needs to explain a
 * non-`completed` run. Successful runs carry no diagnostic at all.
 * @param providerName - the registry name this provider was mounted as.
 * @param facts - the structured failure facts.
 * @param notes - the ordered note lines collected during the run.
 * @returns the diagnostic text.
 */
function diagnosticText(providerName: string, facts: FailureFacts, notes: readonly string[]): string {
  return [failureDiagnostic(providerName, facts), ...notes].join('\n')
}

class AcpRunFailure extends Error {
  constructor(providerName: string, facts: FailureFacts, cause: unknown) {
    super(`${PLUGIN_ID}: ${failureDiagnostic(providerName, facts)}`, { cause })
    this.name = 'AcpRunFailure'
  }
}

/**
 * Classify an unpublished protocol failure from what the transport observed.
 * @param stage - the operation that failed.
 * @param answeredWithError - whether the child sent a JSON-RPC error response (so it is alive).
 * @param outcome - the observed exit facts, when the process was seen to exit.
 * @returns the structured failure facts.
 */
function failureFacts(
  stage: FailureStage,
  answeredWithError: boolean,
  outcome: SubprocessOutcome | undefined,
): FailureFacts {
  if (answeredWithError) return { stage, category: 'protocol' }
  return outcome === undefined
    ? { stage, category: 'transport' }
    : { stage, category: 'process-exit', outcome }
}

/** Keep only the closed ACP tool-kind vocabulary; future values use a fixed fallback. */
function permissionRequestKind(kind: unknown): string {
  return typeof kind === 'string' && ACP_TOOL_KINDS.has(kind) ? kind : 'unknown'
}

/** The text of one ACP content block; every non-text block contributes nothing. */
function blockText(content: unknown): string {
  if (typeof content !== 'object' || content === null) return ''
  const block = content as { readonly type?: unknown; readonly text?: unknown }
  return block.type === 'text' && typeof block.text === 'string' ? block.text : ''
}

/**
 * Translate the Host prompt blocks into ACP text blocks. Non-text blocks are
 * dropped: this driver advertises no image capability, so forwarding one would
 * claim a surface it does not have.
 *
 * The return type is ACP's own `ContentBlock`, not a lookalike: a structurally
 * similar local type defeats the SDK's inference on `params` and silently
 * degrades the whole `session/prompt` call to `unknown`.
 * @param prompt - the Host prompt blocks.
 * @returns the ACP text blocks, in order.
 */
export function toAcpPrompt(prompt: readonly unknown[]): ContentBlock[] {
  const blocks: ContentBlock[] = []
  for (const block of prompt) {
    if (typeof block !== 'object' || block === null) continue
    const candidate = block as { readonly type?: unknown; readonly text?: unknown }
    if (candidate.type === 'text' && typeof candidate.text === 'string') {
      blocks.push({ type: 'text', text: candidate.text })
    }
  }
  return blocks
}

/**
 * Map an ACP terminal reason to a Host stop reason. `max_turn_requests` and any
 * unknown future variant mean the task did NOT finish cleanly, so they must
 * never be reported as `completed`.
 * @param reason - the terminal reason from `session/prompt`.
 * @returns the Host equivalent.
 */
export function acpStopReason(reason: StopReason): SubagentStopReason {
  switch (reason) {
    case 'end_turn':
      return 'completed'
    case 'max_tokens':
      return 'max-tokens'
    case 'refusal':
      return 'refusal'
    case 'cancelled':
      return 'aborted'
    case 'max_turn_requests':
      return 'error'
    default:
      return 'error'
  }
}

/**
 * Auto-answer one permission request. `allow` prefers a one-shot approval so a
 * delegated run cannot widen the agent's own persisted permission state; a
 * request that offers no allow option at all is declined rather than guessed at.
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

/** The resolved spawn, session selection, and policy for one run (no defaults — see `Config`). */
export interface AcpRunSpec {
  /** Registry name on `ctx.subagents`; appears in every diagnostic this run authors. */
  readonly providerName: string
  /** Executable and arguments, already resolved. */
  readonly argv: readonly string[]
  /** Absolute working directory for both the process and its ACP session. */
  readonly cwd: string
  /** Session mode to select when the agent advertises it; omitted leaves the agent's own default. */
  readonly mode: string | undefined
  /** Session configuration options to apply after `session/new`. */
  readonly configOptions: ReadonlyMap<string, string | number | boolean>
  /** How to auto-answer the child's permission prompts. */
  readonly permission: PermissionPolicy
  /** Explicit child environment entries. */
  readonly env: Record<string, string>
  /** Grace (ms) for the child's stdin-EOF quiesce. */
  readonly disposeEofGraceMs: number
  /** Failure-observation and termination-escalation grace (ms). */
  readonly disposeGraceMs: number
  /** Spawn function from the process seam. */
  readonly spawn: (spec: SubprocessSpawnSpec) => SubprocessHandle
  /** Host sink for startup, published-run, or teardown failures. */
  readonly onError?: ((error: Error, stopReason: SubagentStopReason) => void) | undefined
}

/** Report an original Host failure without letting the sink replace it. */
function reportFailure(spec: AcpRunSpec, error: unknown): void {
  try {
    spec.onError?.(toError(error), 'error')
  } catch {
    // Host diagnostic logging cannot replace the child failure.
  }
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

/**
 * Start and publish one child after initialization and session creation.
 * Startup failures reject with fixed safe facts after the driver has reaped the
 * not-yet-published process; a failure after publication settles through the
 * returned run's result.
 * @param request - the start request; its signal is the cancellation channel.
 * @param spec - the resolved spawn, session selection, permission policy, and graces.
 * @returns the published run handle.
 */
export async function startAcpRun(request: SubagentStartRequest, spec: AcpRunSpec): Promise<SubagentRun> {
  const { providerName } = spec
  if (request.signal.aborted) throw new Error(`${PLUGIN_ID}: subagent request was aborted before the ACP child started`)
  // An ACP session id is unique only inside one child; this lifecycle id is
  // minted in the parent namespace so fresh processes cannot collide.
  const id = randomUUID()

  let child: SubprocessHandle
  try {
    child = spec.spawn({
      argv: spec.argv,
      cwd: spec.cwd,
      stdio: { stdin: 'pipe', stdout: 'pipe', stderr: 'inherit' },
      graceMs: spec.disposeGraceMs,
      env: spec.env,
    })
  } catch (error: unknown) {
    reportFailure(spec, error)
    throw new AcpRunFailure(providerName, { stage: 'process', category: 'process-start' }, error)
  }

  // Startup rollback and the published handle share one process teardown.
  let processDisposal: Promise<void> | undefined
  const disposeProcess = (): Promise<void> => (processDisposal ??= disposeAcpChild(child, spec.disposeEofGraceMs))

  if (child.stdin === undefined || child.stdout === undefined) {
    const missing = new Error(`${PLUGIN_ID}: the subprocess seam dropped a piped protocol stream`)
    reportFailure(spec, missing)
    try {
      await disposeProcess()
    } catch (cleanupError: unknown) {
      reportFailure(spec, cleanupError)
    }
    throw new AcpRunFailure(providerName, { stage: 'process', category: 'transport' }, missing)
  }
  const stdin = child.stdin
  const stdout = child.stdout

  let processOutcome: SubprocessOutcome | undefined
  let processFailure: Error | undefined
  const processDone = child.done.then(
    (outcome) => {
      processOutcome = outcome
      return outcome
    },
    (error: unknown) => {
      processFailure = toError(error)
      throw processFailure
    },
  )
  // A clean exit must never win the startup race, so the success arm parks.
  const processRejected: Promise<never> = processDone.then(
    () => new Promise<never>(() => {}),
    (error: unknown) => Promise.reject(toError(error)),
  )
  processRejected.catch(() => { /* observed by the startup race; never unhandled */ })

  const observeProcessOutcome = async (signal?: AbortSignal): Promise<SubprocessOutcome | undefined> => {
    if (processOutcome !== undefined) return processOutcome
    const timeout = AbortSignal.timeout(Math.ceil(spec.disposeGraceMs))
    const bound = signal === undefined ? timeout : AbortSignal.any([signal, timeout])
    // Constructed by hand rather than with `Promise.withResolvers`: this
    // package typechecks against the DOM lib at ES2022, where that static does
    // not exist.
    let resolveAborted!: (value: undefined) => void
    const aborted = new Promise<undefined>((resolve) => { resolveAborted = resolve })
    const onObservationAbort = (): void => { resolveAborted(undefined) }
    bound.addEventListener('abort', onObservationAbort, { once: true })
    if (bound.aborted) onObservationAbort()
    try {
      return await Promise.race([processDone, aborted])
    } catch {
      return processOutcome
    } finally {
      bound.removeEventListener('abort', onObservationAbort)
    }
  }

  const fold = new AssistantTextFold()
  // Shared mutable state keeps cancellation visible across async closures.
  const flags = { cancelled: false }
  const declinedExtensions = new Set<string>()
  let modeUnavailable: string | undefined
  let latestPermission: PermissionDecision | undefined

  const notes = (): string[] => {
    const lines: string[] = []
    if (latestPermission !== undefined) lines.push(permissionDiagnostic(latestPermission))
    for (const method of declinedExtensions) lines.push(`ACP declined extension request (method: ${method})`)
    if (modeUnavailable !== undefined) {
      lines.push(`ACP mode unavailable (requested: ${modeUnavailable}; the agent kept its own)`)
    }
    return lines
  }

  const identityParams = (params: unknown): unknown => params

  const clientApp = createClientApp({ name: CLIENT_NAME })
    .onNotification(methods.client.session.update, ({ params }) => {
      const update = params.update
      if (update.sessionUpdate === 'agent_message_chunk') fold.pushText(blockText(update.content))
      // Thoughts, tool calls, plans, and command lists are consumed but not
      // surfaced: a delegation returns its final answer, nothing else.
      return Promise.resolve()
    })
    .onRequest(methods.client.session.requestPermission, ({ params }) => {
      const answer = decidePermission(spec.permission, params.options)
      latestPermission = {
        policy: spec.permission,
        request: permissionRequestKind(params.toolCall.kind),
        decision: answer.decision,
      }
      return Promise.resolve(answer.response)
    })

  for (const method of BLOCKING_EXTENSION_METHODS) {
    clientApp.onRequest(method, identityParams, () => {
      declinedExtensions.add(method)
      return Promise.resolve(DECLINED_EXTENSION_RESPONSE)
    })
  }
  for (const method of NOTIFICATION_EXTENSION_METHODS) {
    clientApp.onNotification(method, identityParams, () => Promise.resolve())
  }

  const connection = clientApp.connect(ndJsonStream(
    NodeWritable.toWeb(stdin) as WritableStream<Uint8Array>,
    NodeReadable.toWeb(stdout) as ReadableStream<Uint8Array>,
  ))
  const agent = connection.agent

  let sessionId: string | undefined
  let startupStage: Extract<FailureStage, 'initialize' | 'new-session'> = 'initialize'
  // Cancellation settles the result without waiting for a cooperative child.
  let signalCancelSettled!: () => void
  const cancelSettled = new Promise<void>((resolve) => { signalCancelSettled = resolve })
  const requestCancel = (): void => {
    if (flags.cancelled) return
    flags.cancelled = true
    signalCancelSettled()
    // Best-effort ACP cancel; process teardown remains authoritative.
    if (sessionId !== undefined) {
      void agent.notify(methods.agent.session.cancel, { sessionId }).catch(() => { /* child gone / no session */ })
    }
  }
  const onAbort = (): void => { requestCancel() }
  request.signal.addEventListener('abort', onAbort, { once: true })

  const collectOutput = (): readonly TextBlock[] => fold.collect()

  try {
    await Promise.race([
      (async (): Promise<void> => {
        const initialized = await agent.request(methods.agent.initialize, {
          protocolVersion: PROTOCOL_VERSION,
          // Advertise NO optional client capabilities (no fs, no terminal): the
          // child self-serves in its own process. Declaring a capability this
          // driver does not implement would make the agent read empty files.
          clientCapabilities: {},
          clientInfo: { name: CLIENT_NAME, version: CLIENT_VERSION },
        })
        if (initialized.protocolVersion !== PROTOCOL_VERSION) {
          // A protocol the client cannot speak is a startup failure by the ACP
          // contract (the client should disconnect), not a degraded run.
          throw new AcpRunFailure(
            providerName,
            { stage: 'initialize', category: 'protocol' },
            new Error(`agent negotiated ACP protocol version ${String(initialized.protocolVersion)}`),
          )
        }
        startupStage = 'new-session'
        const session = await agent.request(methods.agent.session.new, { cwd: spec.cwd, mcpServers: [] })
        const returnedSessionId: unknown = Reflect.get(session, 'sessionId')
        if (typeof returnedSessionId !== 'string') {
          throw new AcpRunFailure(
            providerName,
            { stage: 'new-session', category: 'protocol' },
            new Error('agent published an ACP session without an id'),
          )
        }
        sessionId = returnedSessionId
        const modes = session.modes
        if (spec.mode !== undefined && modes !== null && modes !== undefined) {
          if (modes.availableModes.some(mode => mode.id === spec.mode)) {
            if (modes.currentModeId !== spec.mode) {
              await agent.request(methods.agent.session.setMode, { sessionId: returnedSessionId, modeId: spec.mode })
            }
          } else {
            modeUnavailable = spec.mode
          }
        }
        for (const [configId, value] of spec.configOptions) {
          try {
            await agent.request(
              methods.agent.session.setConfigOption,
              typeof value === 'boolean'
                ? { sessionId: returnedSessionId, configId, type: 'boolean', value }
                : { sessionId: returnedSessionId, configId, value: String(value) },
            )
          } catch (cause: unknown) {
            // An explicitly configured option that the agent refuses is a
            // deployment error, not something to fall back from silently.
            throw new AcpRunFailure(
              providerName,
              { stage: 'new-session', category: 'configuration', configOption: configId },
              cause,
            )
          }
        }
        if (flags.cancelled) throw new Error(`${PLUGIN_ID}: subagent cancelled before the ACP session started`)
      })(),
      processRejected,
      cancelSettled.then((): never => { throw new Error(`${PLUGIN_ID}: subagent cancelled before the ACP session started`) }),
    ])
  } catch (error: unknown) {
    request.signal.removeEventListener('abort', onAbort)
    const cancelledBeforeCleanup = flags.cancelled
    // A `RequestError` is a well-formed JSON-RPC error RESPONSE: the child is
    // alive and speaking, so there is no exit to observe and waiting out the
    // process grace would only delay an already-decided failure. Every other
    // rejection may be a transport close that a real exit explains.
    const answeredWithError = error instanceof RequestError
    const observedOutcome = !cancelledBeforeCleanup && !(error instanceof AcpRunFailure) && !answeredWithError
      ? await observeProcessOutcome()
      : undefined
    const startup = cancelledBeforeCleanup
      ? { kind: 'cancelled' } as const
      : {
        kind: 'failed',
        failure: error instanceof AcpRunFailure
          ? error
          : new AcpRunFailure(
            providerName,
            failureFacts(startupStage, answeredWithError, observedOutcome),
            error,
          ),
      } as const
    if (startup.kind === 'failed') {
      reportFailure(spec, error instanceof AcpRunFailure ? error.cause : processFailure ?? error)
    }
    try {
      await disposeProcess()
    } catch (cleanupError: unknown) {
      reportFailure(spec, cleanupError)
      const cleanupFailure = new AcpRunFailure(providerName, {
        stage: 'teardown',
        category: processOutcome === undefined ? 'unknown' : 'process-exit',
        ...(processOutcome === undefined ? {} : { outcome: processOutcome }),
      }, cleanupError)
      if (startup.kind === 'cancelled') throw new AggregateError([cleanupFailure], cleanupFailure.message)
      throw new AggregateError(
        [startup.failure, cleanupFailure],
        `${startup.failure.message}; ${cleanupFailure.message}`,
      )
    }
    if (startup.kind === 'cancelled') {
      throw new Error(`${PLUGIN_ID}: subagent request was aborted before the ACP child started`)
    }
    throw startup.failure
  }
  if (sessionId === undefined) throw new Error('unreachable: ACP startup fulfilled without a session id')
  const remoteSessionId = sessionId

  let diagnostic: string | undefined
  const result = settleRunResult({
    attempt: async () => {
      try {
        const promptResult = await Promise.race([
          agent.request(methods.agent.session.prompt, {
            sessionId: remoteSessionId,
            prompt: toAcpPrompt(request.prompt),
          }),
          cancelSettled.then((): never => { throw new Error(`${PLUGIN_ID}: subagent cancelled while the prompt was running`) }),
        ])
        const reason = promptResult.stopReason
        diagnostic = terminalDiagnostic(providerName, reason, notes())
        // The diagnostic rides ON the returned result: `collectDiagnostic` is
        // consulted only when the attempt throws, so an unclean-but-answered
        // terminal reason would otherwise lose its detail.
        return {
          output: collectOutput(),
          ...(diagnostic === undefined ? {} : { diagnostic }),
          stopReason: acpStopReason(reason),
        }
      } catch (error: unknown) {
        if (!flags.cancelled) {
          if (error instanceof RequestError) {
            // The child refused the prompt but is still alive; its exit facts
            // explain nothing and observing them would only cost the grace.
            diagnostic = diagnosticText(providerName, { stage: 'prompt', category: 'protocol' }, notes())
          } else {
            const outcome = await observeProcessOutcome(request.signal)
            const facts: FailureFacts = outcome === undefined
              ? { stage: 'prompt', category: 'transport' }
              : { stage: 'process', category: 'process-exit', outcome }
            diagnostic = diagnosticText(providerName, facts, notes())
          }
        }
        throw processFailure ?? error
      }
    },
    collectOutput,
    collectDiagnostic: () => diagnostic,
    cancelled: () => flags.cancelled,
    onError: spec.onError,
    signal: request.signal,
    onAbort,
  })

  return runHandle({
    id,
    result,
    signal: request.signal,
    onAbort,
    requestCancel,
    teardown: async () => {
      try {
        // ACP normally quiesces from stdin EOF, including its final flush, so
        // this ladder uses the wider EOF grace before terminating.
        await disposeProcess()
      } catch (error: unknown) {
        reportFailure(spec, error)
        throw new AcpRunFailure(providerName, {
          stage: 'teardown',
          category: processOutcome === undefined ? 'unknown' : 'process-exit',
          ...(processOutcome === undefined ? {} : { outcome: processOutcome }),
        }, error)
      }
    },
  })
}

/**
 * Map one terminal reason to the failure line it needs, if any.
 * @param providerName - the registry name this provider was mounted as.
 * @param reason - the terminal reason from `session/prompt`.
 * @param notes - the ordered note lines collected during the run.
 * @returns the diagnostic, or `undefined` for a clean finish.
 */
function terminalDiagnostic(providerName: string, reason: StopReason, notes: readonly string[]): string | undefined {
  switch (reason) {
    case 'end_turn':
      return undefined
    case 'max_turn_requests':
      return diagnosticText(providerName, { stage: 'prompt', category: 'remote-limit', stopReason: reason }, notes)
    case 'max_tokens':
    case 'refusal':
    case 'cancelled':
      return notes.length === 0 ? undefined : notes.join('\n')
    default:
      return diagnosticText(providerName, { stage: 'prompt', category: 'unknown', stopReason: 'unknown' }, notes)
  }
}
