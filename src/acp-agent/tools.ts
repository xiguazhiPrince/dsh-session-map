/**
 * The mirror tools: what makes a remote agent's tool call a first-class DSH
 * tool call instead of a decorative line of text.
 *
 * The remote agent already ran its own tool by the time the Host sees the call.
 * The Host's loop, however, only records `tool/call` + `tool/result` by actually
 * executing a registered tool. So this route registers one tool per ACP tool
 * kind; the model-side "call" it emits carries only the remote call's identity,
 * and the tool's `execute` waits for the remote outcome and returns it.
 *
 * The payoff is that the shipped tool card renders with a real status, a real
 * duration and a real result — and because the tool names are static strings,
 * a later phase can claim `tool.call.toolview` keys for them without touching
 * this file.
 *
 * @module dsh-session-map/acp-agent/tools
 */
import { TOOL_KINDS, toolNameForKind, type ToolCallRecord } from './channel'

/** One mirror tool's argument shape, as accepted from the Host's loop. */
interface MirrorArgs {
  readonly toolCallId?: unknown
  readonly title?: unknown
  readonly kind?: unknown
  readonly rawInput?: unknown
  readonly locations?: unknown
}

/** One file location as the Host's render-intent vocabulary spells it. */
interface MirrorLocation {
  readonly path: string
  readonly line?: number
}

/**
 * Map an ACP tool kind onto the Host's render-intent vocabulary. The two
 * vocabularies overlap except for `think` and `switch_mode`, which have no Host
 * analogue; `other` is the documented default for those.
 * @param kind - the ACP tool kind.
 * @returns the Host's tool-call kind.
 */
function callKindFor(kind: string): string {
  switch (kind) {
    case 'read':
    case 'edit':
    case 'delete':
    case 'move':
    case 'search':
    case 'execute':
    case 'fetch':
      return kind
    default:
      return 'other'
  }
}

/**
 * Normalize the location list carried in the arguments.
 * @param raw - the argument's `locations` value, of unknown shape.
 * @returns the usable locations, in order.
 */
function locationsOf(raw: unknown): MirrorLocation[] {
  if (!Array.isArray(raw)) return []
  return raw.flatMap((entry) => {
    const location = entry as { path?: unknown; line?: unknown } | null
    if (location === null || typeof location !== 'object' || typeof location.path !== 'string') return []
    return [typeof location.line === 'number'
      ? { path: location.path, line: location.line }
      : { path: location.path }]
  })
}

/** One mirror tool's canonical return value. */
interface MirrorValue {
  readonly title: string
  readonly status: string
  readonly output: string
}

/**
 * Wait for a remote tool call, giving up if the Host cancels first.
 *
 * Without the abort arm the mirror tool would outlive a stop request until the
 * remote agent happened to finish, which is exactly the hang a stop button is
 * meant to end.
 * @param record - the open remote call.
 * @param signal - the Host's cancellation channel for this execution.
 * @returns `true` when the remote side settled it, `false` on cancellation.
 */
async function waitForSettlementOrAbort(record: ToolCallRecord, signal: AbortSignal | undefined): Promise<boolean> {
  if (signal === undefined) {
    await record.waitForSettlement()
    return true
  }
  if (signal.aborted) return false
  return await new Promise<boolean>((resolve) => {
    const onAbort = (): void => { resolve(false) }
    signal.addEventListener('abort', onAbort, { once: true })
    void record.waitForSettlement().then(() => {
      signal.removeEventListener('abort', onAbort)
      resolve(true)
    })
  })
}

/**
 * Build the mirror tool definitions.
 *
 * The argument schema deliberately constrains only the routing id: `rawInput` is
 * whatever JSON the remote agent sent, and inventing a shape for it would reject
 * perfectly good calls. The `output` schema is exact, because the registry
 * validates the canonical value this tool returns.
 * @param records - every open remote tool call, keyed by the Host-side call id.
 * @param prefix - this plugin's diagnostic prefix.
 * @returns one definition per ACP tool kind, plus the `other` fallback.
 */
export function mirrorToolDefinitions(
  records: ReadonlyMap<string, ToolCallRecord>,
  prefix: string,
): unknown[] {
  return TOOL_KINDS.map((kind) => ({
    name: toolNameForKind(kind),
    description:
      `Mirrors one \`${kind}\` tool call that the connected ACP agent has already executed in its own process. `
      + 'The call is recorded here so this conversation shows what the remote agent did; executing it returns the '
      + "remote agent's own result and performs no local work.",
    parameters: {
      type: 'object',
      properties: {
        toolCallId: { type: 'string', description: 'Host-side identifier of the mirrored remote tool call.' },
        title: { type: 'string', description: 'Human-readable title the remote agent gave the call.' },
        kind: { type: 'string', description: 'ACP tool kind reported by the remote agent.' },
        rawInput: {},
        locations: {
          type: 'array',
          description: 'Files this call reads or modifies, as the remote agent reported them.',
          items: {
            type: 'object',
            properties: { path: { type: 'string' }, line: { type: 'number' } },
            required: ['path'],
            additionalProperties: false,
          },
        },
      },
      required: ['toolCallId'],
      additionalProperties: false,
    },
    output: {
      schema: {
        type: 'object',
        properties: {
          title: { type: 'string' },
          status: { type: 'string' },
          output: { type: 'string' },
        },
        required: ['title', 'status', 'output'],
        additionalProperties: false,
      },
      /**
       * @param _args - validated arguments; the record already holds them.
       * @param value - the canonical value this tool returned.
       * @returns the model- and Native-facing content blocks.
       */
      render(_args: MirrorArgs, value: MirrorValue): { type: 'text'; text: string }[] {
        const output = typeof value.output === 'string' ? value.output : ''
        const status = typeof value.status === 'string' ? value.status : 'unknown'
        const title = typeof value.title === 'string' && value.title !== '' ? value.title : 'ACP tool call'
        const text = output !== '' ? output : `${title} (${status})`
        return [{ type: 'text', text }]
      },
    },
    /**
     * Describe the pending card.
     *
     * Without this the Host labels the row with the tool-call id, which is an
     * internal coordinate (`session-…::cursor#3`) and the first thing a reader
     * saw wrong in the browser. The remote agent's own title, its category, and
     * the file it touches are what a card should say.
     * @param args - validated arguments.
     * @returns the render intent for the pending call.
     */
    presentCall(args: MirrorArgs): unknown {
      const remoteKind = typeof args.kind === 'string' ? args.kind : kind
      const title = typeof args.title === 'string' && args.title.trim() !== ''
        ? args.title
        : `ACP ${remoteKind} call`
      const locations = locationsOf(args.locations)
      return {
        card: 'generic',
        title,
        kind: callKindFor(remoteKind),
        ...args.rawInput === undefined || args.rawInput === null ? {} : { rawInput: args.rawInput },
        ...locations.length === 0 ? {} : { locations },
      }
    },
    /**
     * Wait for the remote call to reach a terminal status and return its outcome.
     * @param args - validated arguments carrying the Host-side call id.
     * @param exec - the execution context; its signal ends the wait on cancel.
     * @returns the canonical value declared by `output.schema`.
     */
    async execute(args: MirrorArgs, exec?: unknown): Promise<MirrorValue> {
      const id = typeof args.toolCallId === 'string' ? args.toolCallId : ''
      const record = records.get(id)
      if (record === undefined) {
        throw new Error(`${prefix}: no mirrored ACP tool call with id "${id}"`)
      }
      const signal = (exec as { signal?: AbortSignal } | undefined)?.signal
      const settled = await waitForSettlementOrAbort(record, signal)
      const raw = record.rawOutput
      const fallback = raw === undefined || raw === null ? '' : JSON.stringify(raw)
      return {
        title: record.title !== '' ? record.title : record.acpId,
        status: settled ? record.status : 'cancelled',
        output: settled
          ? (record.output !== '' ? record.output : fallback)
          : 'The turn was cancelled before the remote tool reported an outcome.',
      }
    },
  }))
}
