/**
 * One persistent ACP channel: a spawned agent process, one remote session, and
 * the ordered update queue a DSH Session consumes.
 *
 * This keeps the process and the remote session alive across turns, because the
 * remote agent's own context is the conversation. What it takes from
 * `../acp-core` is everything vendor- and platform-shaped: the command resolver,
 * the permission policy, the extension tables, and the process teardown ladder.
 *
 * The turn model is the part worth stating plainly, because ACP and the Host
 * disagree about it. One `session/prompt` runs a whole remote turn, tools
 * included, and reports a single `stopReason` at the end. The Host instead wants
 * a model call to end when it emits a tool call, so it can execute that call and
 * continue. A channel therefore does three things at once:
 *
 * - it keeps the remote turn running in the background after the Host's step
 *   has already returned;
 * - it reports each newly seen tool call as a signal, and {@link ToolCallRecord}
 *   stays open until the remote side actually finishes that call, so the Host's
 *   `tool/result` carries a real outcome rather than a placeholder;
 * - it releases every open record when the prompt settles, so a remote agent
 *   that ends its turn with a tool call still in flight cannot hang the Host.
 *
 * @module dsh-session-map/acp-agent/channel
 */
import { Readable as NodeReadable, Writable as NodeWritable } from 'node:stream'
import {
  client as createClientApp,
  methods,
  ndJsonStream,
  PROTOCOL_VERSION,
  RequestError,
  type PermissionOption,
  type ReadTextFileRequest,
  type RequestPermissionResponse,
  type StopReason,
  type WriteTextFileRequest,
} from '@agentclientprotocol/sdk'
import type { PermissionPolicy, ResolvedAgent } from '../acp-core/config'
import { BLOCKING_EXTENSION_METHODS, DECLINED_EXTENSION_RESPONSE, NOTIFICATION_EXTENSION_METHODS, decidePermission, disposeAcpChild } from '../acp-core/client'
import { resolveAcpCommand } from '../acp-core/resolve'
import type { ApprovalMode, FsMode } from './config'
import type { HostContext, HostFs, SubprocessHandle } from './contract'

/** The ACP client identity this route announces. */
const CLIENT_NAME = 'dsh-session-map/acp-agent'

/** The protocol identity announced with {@link CLIENT_NAME}; ACP requires a version. */
const CLIENT_VERSION = '0.1.0'

/**
 * The empty response given to a blocking extension request: an empty object
 * neither approves a plan nor fabricates an answer, and the remote agent decides
 * how to continue. It lives beside the extension tables in `../acp-core/client`
 * so a request that must be answered cannot be forgotten here.
 */

/** The ACP tool-kind vocabulary; an unrecognized value routes to the `other` tool. */
export const TOOL_KINDS: readonly string[] = [
  'read', 'edit', 'delete', 'move', 'search',
  'execute', 'think', 'fetch', 'switch_mode', 'other',
]

/** Where in the channel lifecycle a failure happened. */
export type FailureStage = 'startup' | 'prompt' | 'transport' | 'teardown'

/** The closed failure taxonomy this route authors. */
export type FailureCategory = 'protocol' | 'configuration' | 'transport' | 'process' | 'unknown'

/**
 * A channel failure carrying only driver-owned structured facts.
 *
 * The original error — which may hold stderr, a path, or a protocol payload —
 * stays on the cause chain for Host diagnostics and never reaches the fixed line
 * a person or the model sees. This mirrors the core's convention in
 * `../acp-core/client`.
 */
export class AcpChannelFailure extends Error {
  /**
   * @param stage - where the failure happened.
   * @param category - what kind of failure it was.
   * @param cause - the original error, retained for the Host log only.
   */
  constructor(
    readonly stage: FailureStage,
    readonly category: FailureCategory,
    cause: unknown,
  ) {
    super(`ACP failure (stage: ${stage}; category: ${category})`, { cause })
    this.name = 'AcpChannelFailure'
  }
}

/** The DSH tool name serving one ACP tool kind. */
export function toolNameForKind(kind: string): string {
  return `acp_${TOOL_KINDS.includes(kind) ? kind : 'other'}`
}

/**
 * One text block's text, or an explicit marker for a block this route cannot
 * render. A silent empty string would make an image-only chunk look like a stall.
 * @param content - one ACP content block.
 * @returns the text to append to the current text block.
 */
function blockText(content: unknown): string {
  const block = content as { type?: unknown; text?: unknown; uri?: unknown; name?: unknown } | null
  if (block === null || typeof block !== 'object') return ''
  if (block.type === 'text') return typeof block.text === 'string' ? block.text : ''
  if (block.type === 'resource_link') return `[resource ${String(block.name ?? '')} ${String(block.uri ?? '')}]`
  return typeof block.type === 'string' ? `[${block.type}]` : ''
}

/**
 * Render one tool-call content part as text. Diffs and terminals have no text
 * form on the wire, so they are described rather than dropped: a tool card that
 * silently shows an empty result is worse than one that says what it produced.
 * @param part - one `ToolCallContent` entry.
 * @returns the text for that part.
 */
function toolContentText(part: unknown): string {
  const entry = part as {
    type?: unknown
    content?: unknown
    path?: unknown
    oldText?: unknown
    newText?: unknown
    terminalId?: unknown
  } | null
  if (entry === null || typeof entry !== 'object') return ''
  if (entry.type === 'content') return blockText(entry.content)
  if (entry.type === 'diff') {
    const path = String(entry.path ?? '')
    const before = typeof entry.oldText === 'string' ? `\n- ${entry.oldText.split('\n').join('\n- ')}` : ''
    const after = typeof entry.newText === 'string' ? `\n+ ${entry.newText.split('\n').join('\n+ ')}` : ''
    return `--- ${path}${before}${after}`
  }
  if (entry.type === 'terminal') return `[terminal ${String(entry.terminalId ?? '')}]`
  return ''
}

/** One signal the Host-side adapter consumes, in arrival order. */
export type ChannelSignal =
  | { kind: 'text'; text: string }
  | { kind: 'reasoning'; text: string }
  | { kind: 'tool'; call: ToolCallRecord }
  | { kind: 'settled'; stopReason: StopReason }
  | { kind: 'failed'; error: Error }

/**
 * One remote tool call, open from the moment the agent announces it until the
 * agent reports a terminal status. The Host's mirror tool awaits
 * {@link waitForSettlement}, so this record is what makes a DSH `tool/result`
 * carry the remote outcome instead of an empty string.
 */
export class ToolCallRecord {
  title = ''
  kind = 'other'
  status = 'pending'
  rawInput: unknown
  rawOutput: unknown
  /**
   * Files this call reads or modifies, as the remote agent reported them. They
   * are what lets the Host's card offer follow-along instead of a bare id.
   */
  locations: { path: string; line?: number }[] = []

  private parts: string[] = []
  private readonly settled: Promise<void>
  private markSettled!: () => void

  /**
   * @param dshCallId - the Host-side tool-call id, used as the DSH tool-call id.
   * @param acpId - the remote agent's own tool-call id.
   */
  constructor(readonly dshCallId: string, readonly acpId: string) {
    this.settled = new Promise<void>((resolve) => { this.markSettled = resolve })
  }

  /** The remote tool's rendered output. */
  get output(): string {
    return this.parts.join('')
  }

  /** The DSH tool name that serves this call's kind. */
  get toolName(): string {
    return toolNameForKind(this.kind)
  }

  /**
   * Merge one `tool_call` or `tool_call_update` into this record.
   * @param update - the ACP update; absent fields are left unchanged and a
   *   present `content` collection replaces the previous one, as ACP specifies.
   */
  apply(update: Record<string, unknown>, initial: boolean): void {
    if (initial || typeof update['title'] === 'string') {
      if (typeof update['title'] === 'string') this.title = update['title']
    }
    if (typeof update['kind'] === 'string') this.kind = update['kind']
    if (typeof update['status'] === 'string') this.status = update['status']
    if ('rawInput' in update) this.rawInput = update['rawInput']
    if ('rawOutput' in update) this.rawOutput = update['rawOutput']
    const content = update['content']
    if (Array.isArray(content)) this.parts = content.map(toolContentText)
    // ACP replaces the collection, like `content`; entries without a usable path
    // are dropped rather than rendered as an empty location.
    const locations = update['locations']
    if (Array.isArray(locations)) {
      this.locations = locations.flatMap((entry) => {
        const location = entry as { path?: unknown; line?: unknown } | null
        if (location === null || typeof location !== 'object' || typeof location.path !== 'string') return []
        return [typeof location.line === 'number'
          ? { path: location.path, line: location.line }
          : { path: location.path }]
      })
    }
    if (this.status === 'completed' || this.status === 'failed') this.markSettled()
  }

  /** Release this record whether or not the remote side reported a terminal status. */
  release(): void {
    this.markSettled()
  }

  /** Resolves once the remote side finished this call, or the turn ended. */
  waitForSettlement(): Promise<void> {
    return this.settled
  }
}

/** Where one channel's state comes from. */
export interface ChannelOptions {
  /** The plugin's diagnostic prefix. */
  readonly prefix: string
  /** The resolved row entry for this agent. */
  readonly config: ResolvedAgent
  /** Disposal graces, from the shared core's defaults. */
  readonly disposeEofGraceMs: number
  /** Signal grace before platform termination. */
  readonly disposeGraceMs: number
  /** Reap the process after this much idle time; 0 disables the reaper. */
  readonly idleDisposeMs: number
  /** The remote session's working directory. */
  readonly cwd: string
  /** The DSH Session this channel serves; approval requests are addressed to it. */
  readonly sessionId: string
  /** How an ACP permission request is answered. */
  readonly approval: ApprovalMode
  /**
   * `bridge` advertises the Host's `fs` capabilities and serves them through
   * `ctx.fs`, so the remote agent's file access obeys the Session's sandbox.
   * `isolate` advertises nothing and leaves the agent to its own filesystem.
   */
  readonly fs: FsMode
  /** Stable channel key: `session::agent`. */
  readonly key: string
  /**
   * The DSH-side tool-call registry this channel publishes into. It is shared
   * with the mirror tools, which is how a `tool/result` finds the remote outcome.
   */
  readonly records: Map<string, ToolCallRecord>
}

/** One live ACP channel. */
export class AcpChannel {
  private child: SubprocessHandle | undefined
  private connection: { agent: { request(method: string, params: unknown): Promise<unknown>; notify(method: string, params: unknown): Promise<void> } } | undefined
  private remoteSessionId: string | undefined
  private startup: Promise<void> | undefined
  private queue: ChannelSignal[] = []
  private waiter: (() => void) | undefined
  private closed = false
  private broken: Error | undefined
  private turnOpen = false
  private turnSignal: AbortSignal | undefined
  private serial = 0
  private cancelled = false
  private idleTimer: ReturnType<typeof setTimeout> | undefined
  private readonly byAcpId = new Map<string, ToolCallRecord>()

  /** @param ctx - Host context. @param options - resolved channel configuration. */
  constructor(
    private readonly ctx: HostContext,
    private readonly options: ChannelOptions,
  ) {}

  /** Whether this channel can still be used for a new turn. */
  get usable(): boolean {
    return !this.closed && this.broken === undefined
  }

  /**
   * Spawn, handshake and open the remote session, once per channel. Concurrent
   * callers share one startup, so a second step cannot spawn a second process.
   * @returns settlement of the handshake.
   */
  async ensureReady(): Promise<void> {
    this.startup ??= this.start()
    return this.startup
  }

  private async start(): Promise<void> {
    const { prefix, config, cwd, disposeGraceMs } = this.options
    /** Whether the Host filesystem is advertised as an ACP client capability. */
    const bridged = this.options.fs === 'bridge' && this.ctx.get('fs') !== undefined
    let argv: readonly string[]
    try {
      argv = resolveAcpCommand(prefix, { command: config.command, args: config.args }, process.platform, process.env)
    } catch (error: unknown) {
      // This message names configuration keys and is meant to be read; it is the
      // one startup failure with a human-actionable form.
      this.broken = error instanceof Error ? error : new Error(String(error))
      throw this.broken
    }

    let child: SubprocessHandle
    try {
      child = this.ctx.subprocess.spawn({
        argv,
        cwd,
        stdio: { stdin: 'pipe', stdout: 'pipe', stderr: 'inherit' },
        graceMs: disposeGraceMs,
        env: config.env,
      })
    } catch (error: unknown) {
      throw await this.abortStartup(new AcpChannelFailure('startup', 'process', error))
    }
    this.child = child
    if (child.stdin === undefined || child.stdout === undefined) {
      throw await this.abortStartup(new AcpChannelFailure('startup', 'transport', new Error('the subprocess seam dropped a piped protocol stream')))
    }

    child.done.then(
      () => { this.fail(new AcpChannelFailure('transport', 'process', new Error('the ACP agent process exited'))) },
      (error: unknown) => { this.fail(new AcpChannelFailure('transport', 'process', error)) },
    )

    const app = createClientApp({ name: CLIENT_NAME })
    app.onNotification(methods.client.session.update, ({ params }) => {
      this.observeUpdate(params.update as Record<string, unknown>)
      return Promise.resolve()
    })
    app.onRequest(methods.client.session.requestPermission, ({ params }) => this.answerPermission(params))
    // Registered unconditionally; whether they are ADVERTISED is what decides
    // if a conforming agent may call them, and an agent that calls anyway gets
    // a clear error rather than a silent lie.
    app.onRequest(methods.client.fs.readTextFile, ({ params }) => this.readTextFile(params))
    app.onRequest(methods.client.fs.writeTextFile, ({ params }) => this.writeTextFile(params))
    for (const method of BLOCKING_EXTENSION_METHODS) {
      app.onRequest(method, (params: unknown) => params, () => Promise.resolve(DECLINED_EXTENSION_RESPONSE))
    }
    for (const method of NOTIFICATION_EXTENSION_METHODS) {
      app.onNotification(method, (params: unknown) => params, () => Promise.resolve())
    }

    const connection = app.connect(ndJsonStream(
      NodeWritable.toWeb(child.stdin) as WritableStream<Uint8Array>,
      NodeReadable.toWeb(child.stdout) as ReadableStream<Uint8Array>,
    ))
    this.connection = connection as unknown as AcpChannel['connection']

    const agent = connection.agent
    try {
      const initialized = await agent.request(methods.agent.initialize, {
        protocolVersion: PROTOCOL_VERSION,
        // Advertising `fs` is what lets the remote agent's file access travel
        // through the Host filesystem, where the Session's sandbox fence applies.
        // It is only advertised when this row is in `bridge` mode AND the Host
        // service actually exists: declaring a capability nothing implements is
        // how a driver makes an agent read empty files.
        clientCapabilities: bridged ? { fs: { readTextFile: true, writeTextFile: true } } : {},
        clientInfo: { name: CLIENT_NAME, version: CLIENT_VERSION },
      })
      if (initialized.protocolVersion !== PROTOCOL_VERSION) {
        throw new AcpChannelFailure(
          'startup',
          'protocol',
          new Error(`agent negotiated ACP protocol version ${String(initialized.protocolVersion)}`),
        )
      }

      const session = await agent.request(methods.agent.session.new, { cwd, mcpServers: [] })
      const sessionId: unknown = Reflect.get(session as object, 'sessionId')
      if (typeof sessionId !== 'string') {
        throw new AcpChannelFailure('startup', 'protocol', new Error('agent published an ACP session without an id'))
      }
      this.remoteSessionId = sessionId

      const modes = Reflect.get(session as object, 'modes') as { availableModes?: { id: string }[]; currentModeId?: string } | null | undefined
      if (config.mode !== undefined && modes !== null && modes !== undefined) {
        if (modes.availableModes?.some((mode) => mode.id === config.mode) === true) {
          if (modes.currentModeId !== config.mode) {
            await agent.request(methods.agent.session.setMode, { sessionId, modeId: config.mode })
          }
        }
      }
      for (const [configId, value] of config.configOptions) {
        try {
          await agent.request(
            methods.agent.session.setConfigOption,
            typeof value === 'boolean'
              ? { sessionId, configId, type: 'boolean', value }
              : { sessionId, configId, value: String(value) },
          )
        } catch (error: unknown) {
          // An explicitly configured option the agent refuses is a deployment
          // error, not something to fall back from silently.
          throw new AcpChannelFailure('startup', 'configuration', error)
        }
      }
    } catch (error: unknown) {
      throw await this.abortStartup(
        error instanceof AcpChannelFailure
          ? error
          : new AcpChannelFailure(error instanceof RequestError ? 'startup' : 'transport', 'protocol', error),
      )
    }

    this.armIdle()
  }

  private async abortStartup(error: Error): Promise<Error> {
    this.broken = error
    await this.dispose()
    return error
  }

  /**
   * Open one conversational turn: discard anything the previous turn left behind,
   * then send the user's text as an ACP prompt and let it run in the background.
   *
   * The prompt's completion is delivered as a {@link ChannelSignal} rather than
   * awaited, because the Host's step returns long before the remote turn ends.
   *
   * Clearing the queue here is an invariant, not tidiness: an aborted turn can
   * leave stale updates and an unconsumed `settled` behind, and replaying those
   * into the next turn would attribute the previous turn's output to this one.
   * @param text - the admitted user text.
   * @param signal - the Host's cancellation channel for this step.
   */
  beginTurn(text: string, signal: AbortSignal | undefined): void {
    const connection = this.connection
    const sessionId = this.remoteSessionId
    if (connection === undefined || sessionId === undefined) {
      throw new AcpChannelFailure('prompt', 'transport', new Error('channel used before its handshake completed'))
    }

    for (const record of this.byAcpId.values()) this.options.records.delete(record.dshCallId)
    this.byAcpId.clear()
    this.queue = []
    this.cancelled = false
    this.turnOpen = true
    this.turnSignal = signal
    this.armIdle()

    const onAbort = (): void => { this.cancel() }
    if (signal !== undefined) {
      if (signal.aborted) { this.cancel(); return }
      signal.addEventListener('abort', onAbort, { once: true })
    }

    void connection.agent
      .request(methods.agent.session.prompt, { sessionId, prompt: [{ type: 'text', text }] })
      .then((result) => {
        const stopReason = Reflect.get(result as object, 'stopReason') as StopReason | undefined
        this.turnOpen = false
        this.turnSignal = undefined
        this.releaseOpenRecords()
        this.push({ kind: 'settled', stopReason: stopReason ?? (this.cancelled ? 'cancelled' : 'end_turn') })
      })
      .catch((error: unknown) => {
        this.turnOpen = false
        this.turnSignal = undefined
        this.releaseOpenRecords()
        this.push({
          kind: 'failed',
          error: new AcpChannelFailure(error instanceof RequestError ? 'prompt' : 'transport', error instanceof RequestError ? 'protocol' : 'transport', error),
        })
      })
      .finally(() => {
        signal?.removeEventListener('abort', onAbort)
        this.armIdle()
      })
  }

  /**
   * Ask the remote agent to stop the running turn. Best-effort by design: the
   * process teardown ladder remains authoritative if the agent does not answer.
   */
  cancel(): void {
    this.cancelled = true
    const sessionId = this.remoteSessionId
    if (sessionId === undefined || this.connection === undefined) return
    void this.connection.agent.notify(methods.agent.session.cancel, { sessionId }).catch(() => { /* agent gone */ })
  }

  /**
   * Answer one ACP permission request.
   *
   * With `approval: policy` (the default) this is the core's auto-answer and
   * nothing else. With `approval: ask` the decision goes to the Host's approval
   * service, which applies the Session's own approval policy first and then puts
   * the question in that Session's conversation — so the person who started the
   * Session decides, and the answer is audited in the same log.
   *
   * Every path that cannot reach an answerer falls back to the row's configured
   * `permission` policy rather than inventing a decision, which is what keeps the
   * documented auto-answer behaviour as the floor.
   */
  private async answerPermission(params: unknown): Promise<RequestPermissionResponse> {
    const request = params as { options?: PermissionOption[]; toolCall?: Record<string, unknown> } | null
    const options = Array.isArray(request?.options) ? request.options : []
    const policyAnswer = decidePermission(this.options.config.permission as PermissionPolicy, options)
    if (this.options.approval !== 'ask') return policyAnswer.response

    const approval = this.ctx.get('approval')
    const agent = this.ctx.get('agents')?.get(this.options.sessionId)
    if (approval === undefined || agent === undefined) return policyAnswer.response

    const toolCall = request?.toolCall ?? {}
    const acpCallId = typeof toolCall['toolCallId'] === 'string' ? toolCall['toolCallId'] : undefined
    const record = acpCallId === undefined ? undefined : this.byAcpId.get(acpCallId)
    const title = typeof toolCall['title'] === 'string' && toolCall['title'] !== '' ? toolCall['title'] : undefined
    const kind = typeof toolCall['kind'] === 'string' ? toolCall['kind'] : 'other'

    let outcome: 'allowed-once' | 'rejected' | 'cancelled' | 'unavailable'
    try {
      outcome = await approval.request({
        agent,
        // The name the person will also see on the conversation's tool card, so
        // the approval and the call it belongs to cannot read as two things.
        toolName: toolNameForKind(kind),
        ...record === undefined ? {} : { callId: record.dshCallId },
        ...title === undefined ? {} : {
          reason: title,
          displayReason: { en: `The remote agent wants to run: ${title}` },
        },
        ...this.turnSignal === undefined ? {} : { signal: this.turnSignal },
      })
    } catch (error: unknown) {
      // An idle ask rejects by contract (the audit pair needs an open turn), and
      // a closed Session rejects too.
      this.ctx.logger.warn(
        `${this.options.prefix}: approval request failed, falling back to the row policy: %o`,
        error,
      )
      return policyAnswer.response
    }

    if (outcome === 'unavailable') return policyAnswer.response
    return this.responseFor(outcome, options) ?? policyAnswer.response
  }

  /**
   * Serve one `fs/read_text_file` through the Host filesystem.
   *
   * The read is resolved and performed by `ctx.fs`, so it sees the same
   * execution world the Session's own tools do, and a path outside what the
   * backend admits fails here rather than silently returning nothing.
   * @param params - the agent's read request.
   * @returns the requested text, windowed when the request asked for a range.
   */
  private async readTextFile(params: ReadTextFileRequest): Promise<{ content: string }> {
    const fs = this.requireFs()
    const target = await fs.resolve(params.path, { cwd: this.options.cwd })
    const content = await fs.readText(target)
    const line = typeof params.line === 'number' && params.line > 0 ? params.line : undefined
    const limit = typeof params.limit === 'number' && params.limit > 0 ? params.limit : undefined
    if (line === undefined && limit === undefined) return { content }
    const lines = content.split('\n')
    const from = line === undefined ? 0 : line - 1
    const window = limit === undefined ? lines.slice(from) : lines.slice(from, from + limit)
    return { content: window.join('\n') }
  }

  /**
   * Serve one `fs/write_text_file` through the Host filesystem.
   *
   * The write carries the Session's resolved sandbox policy, so a read-only
   * Session refuses it at the backend instead of trusting the remote agent to
   * have respected a mode it cannot enforce.
   * @param params - the agent's write request.
   * @returns the empty success response ACP defines.
   */
  private async writeTextFile(params: WriteTextFileRequest): Promise<Record<string, never>> {
    const fs = this.requireFs()
    const target = await fs.resolve(params.path, { cwd: this.options.cwd })
    await fs.writeText(target, params.content, undefined, undefined, this.sandboxPolicy())
    return {}
  }

  /**
   * @returns the Host filesystem.
   * @throws when the composition has none, in which case nothing is advertised
   *   and a call can only come from an agent ignoring the handshake.
   */
  private requireFs(): HostFs {
    const fs = this.ctx.get('fs')
    if (fs === undefined) throw new Error(`${this.options.prefix}: the Host filesystem is unavailable`)
    return fs
  }

  /**
   * Resolve this Session's sandbox policy for one file write.
   * @returns the policy, or undefined when the composition has no policy service
   *   (the backend then applies its own default).
   */
  private sandboxPolicy(): unknown {
    const sandboxPolicy = this.ctx.get('sandboxPolicy')
    const session = this.ctx.get('agents')?.get(this.options.sessionId)?.session
    if (sandboxPolicy === undefined || session === undefined) return undefined
    try {
      return sandboxPolicy.resolve({ session })
    } catch (error: unknown) {
      this.ctx.logger.warn(`${this.options.prefix}: could not resolve the sandbox policy: %o`, error)
      return undefined
    }
  }

  /**
   * Translate one approval outcome into the agent's own option vocabulary.
   *
   * A grant prefers `allow_once` and a refusal prefers `reject_once`, so neither
   * can widen the remote agent's persisted permission state as a side effect of
   * answering a single prompt.
   * @param outcome - the closed approval outcome.
   * @param options - the options the remote agent offered.
   * @returns the response, or undefined when the agent offered no matching option.
   */
  private responseFor(
    outcome: 'allowed-once' | 'rejected' | 'cancelled',
    options: readonly PermissionOption[],
  ): RequestPermissionResponse | undefined {
    if (outcome === 'cancelled') return { outcome: { outcome: 'cancelled' } }
    if (outcome === 'allowed-once') {
      const allow = options.find((option) => option.kind === 'allow_once')
        ?? options.find((option) => option.kind === 'allow_always')
      return allow === undefined
        ? undefined
        : { outcome: { outcome: 'selected', optionId: allow.optionId } }
    }
    const reject = options.find((option) => option.kind === 'reject_once')
      ?? options.find((option) => option.kind === 'reject_always')
    return reject === undefined
      ? undefined
      : { outcome: { outcome: 'selected', optionId: reject.optionId } }
  }

  /**
   * Pull the next signal, waiting for one if the queue is empty.
   *
   * @param signal - the Host's cancellation channel. Waiting on the queue must
   *   not outlive it: without this the Host's stop button would only be observed
   *   when the remote agent happened to emit something else.
   * @returns the next signal, `'aborted'` when the signal fired first, or
   *   `undefined` once the channel is closed.
   */
  async next(signal?: AbortSignal): Promise<ChannelSignal | undefined | 'aborted'> {
    for (;;) {
      const queued = this.queue.shift()
      if (queued !== undefined) return queued
      if (this.closed) return undefined
      if (signal?.aborted === true) return 'aborted'
      await this.waitForSignal(signal)
    }
  }

  /** One wait, released by a pushed signal, an abort, or channel closure. */
  private waitForSignal(signal: AbortSignal | undefined): Promise<void> {
    return new Promise<void>((resolve) => {
      const done = (): void => {
        if (this.waiter === done) this.waiter = undefined
        signal?.removeEventListener('abort', done)
        resolve()
      }
      this.waiter = done
      if (signal !== undefined) {
        if (signal.aborted) { done(); return }
        signal.addEventListener('abort', done, { once: true })
      }
    })
  }

  private push(signal: ChannelSignal): void {
    this.queue.push(signal)
    const waiter = this.waiter
    this.waiter = undefined
    waiter?.()
  }

  private fail(error: Error): void {
    if (this.broken === undefined) this.broken = error
    this.releaseOpenRecords()
    this.push({ kind: 'failed', error })
  }

  /** Resolve every still-open tool record so no mirror tool can hang. */
  private releaseOpenRecords(): void {
    for (const record of this.byAcpId.values()) record.release()
  }

  /**
   * Reap an idle channel. Nothing else in the Host knows a Session has gone
   * quiet, so the route owns this: one agent process per (Session × agent) would
   * otherwise accumulate for the lifetime of the profile.
   */
  private armIdle(): void {
    this.clearIdle()
    const ms = this.options.idleDisposeMs
    if (!Number.isFinite(ms) || ms <= 0) return
    this.idleTimer = setTimeout(() => { void this.dispose() }, ms)
    // A parked channel must never hold the process open.
    this.idleTimer.unref?.()
  }

  private clearIdle(): void {
    if (this.idleTimer === undefined) return
    clearTimeout(this.idleTimer)
    this.idleTimer = undefined
  }

  /** Whether a turn is currently running on the remote side. */
  get busy(): boolean {
    return this.turnOpen
  }

  private observeUpdate(update: Record<string, unknown>): void {
    switch (update['sessionUpdate']) {
      case 'agent_message_chunk':
        this.push({ kind: 'text', text: blockText(update['content']) })
        return
      case 'agent_thought_chunk':
        this.push({ kind: 'reasoning', text: blockText(update['content']) })
        return
      case 'tool_call':
      case 'tool_call_update': {
        const acpId = update['toolCallId']
        if (typeof acpId !== 'string') return
        let record = this.byAcpId.get(acpId)
        const initial = update['sessionUpdate'] === 'tool_call'
        if (record === undefined) {
          this.serial += 1
          record = new ToolCallRecord(`${this.options.key}#${this.serial}`, acpId)
          this.byAcpId.set(acpId, record)
          this.options.records.set(record.dshCallId, record)
        }
        record.apply(update, initial)
        this.push({ kind: 'tool', call: record })
        return
      }
      default:
        // Plan, commands, mode, config, session-info, usage and compaction
        // updates are protocol-legal and carry no assistant content this route
        // renders. Swallowing them is deliberate: an unknown update must never
        // become an empty text block.
        return
    }
  }

  /** Stop the remote session and reap the process range. Idempotent. */
  async dispose(): Promise<void> {
    if (this.closed) return
    this.closed = true
    this.clearIdle()
    this.releaseOpenRecords()
    for (const record of this.byAcpId.values()) this.options.records.delete(record.dshCallId)
    this.byAcpId.clear()
    const waiter = this.waiter
    this.waiter = undefined
    waiter?.()
    const child = this.child
    if (child !== undefined) {
      try {
        await disposeAcpChild(child, this.options.disposeEofGraceMs)
      } catch (error: unknown) {
        this.ctx.logger.warn(
          `${this.options.prefix}: ACP channel teardown failed (agent: ${this.options.config.providerName}): %o`,
          error,
        )
      }
    }
  }
}
