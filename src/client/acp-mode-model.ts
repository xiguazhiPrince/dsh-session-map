/**
 * The ACP mode vocabulary, shared by the Host half and the browser half (P11).
 *
 * A remote ACP agent advertises its collaboration modes in `session/new` and changes
 * them through `session/set_mode`. The Host half reaches that, the browser half
 * cannot — and the channels that would carry the state to the client are all closed
 * to a runtime plugin (see `../../docs/p11-acp-mode-select.md` §3). The one open
 * channel is a registered command: the composer control executes `/acp-mode …` and
 * reads the **report text** it settles with.
 *
 * This module is therefore the single place where that text is defined and parsed,
 * built for Node as well as bundled into the browser half — the same arrangement as
 * `./acp-model.ts`. Keeping one definition is what stops the writer and the reader
 * from drifting into a format only one of them understands.
 *
 * @module dsh-session-map/client/acp-mode-model
 */

/** One mode an agent advertises. */
export interface AcpModeOption {
  readonly id: string
  readonly name: string
  readonly description?: string
}

/** The complete mode state of one Session's agent. */
export interface AcpModeState {
  readonly available: readonly AcpModeOption[]
  readonly current: string | null
}

/** The state before any agent has advertised modes. */
export const EMPTY_ACP_MODES: AcpModeState = Object.freeze({ available: [], current: null })

/** The report line every `/acp-mode` read answers with. */
export const MODE_REPORT_PREFIX = 'ACP mode: '

/**
 * Read ACP's `SessionModeState` into this vocabulary.
 *
 * Tolerant by design: an agent that publishes nothing recognizable yields
 * `undefined`, a name falls back to the id, and a `currentModeId` the agent did not
 * also advertise is replaced by the first advertised id rather than offered as a
 * value nothing can select. The current id is read from ACP's `currentModeId` first
 * and from this vocabulary's own `current` second, so a state that round-trips keeps
 * the mode it recorded.
 * @param modes - the raw `modes` field of an ACP `session/new` result.
 * @returns the state, or `undefined` when no usable mode was advertised.
 */
export function readModeState(modes: unknown): AcpModeState | undefined {
  if (modes === null || typeof modes !== 'object') return undefined
  const record = modes as { availableModes?: unknown; currentModeId?: unknown; current?: unknown }
  if (!Array.isArray(record.availableModes)) return undefined
  const available: AcpModeOption[] = []
  for (const entry of record.availableModes) {
    if (entry === null || typeof entry !== 'object') continue
    const option = entry as { id?: unknown; name?: unknown; description?: unknown }
    if (typeof option.id !== 'string' || option.id === '' || option.id.includes(' ')) continue
    const name = typeof option.name === 'string' && option.name !== '' ? option.name : option.id
    const description = typeof option.description === 'string' && option.description !== '' ? option.description : undefined
    available.push(description === undefined ? { id: option.id, name } : { id: option.id, name, description })
  }
  if (available.length === 0) return undefined
  const wanted = typeof record.currentModeId === 'string'
    ? record.currentModeId
    : typeof record.current === 'string' ? record.current : undefined
  const advertised = wanted !== undefined && available.some((mode) => mode.id === wanted)
  return { available, current: advertised ? (wanted as string) : available[0]!.id }
}

/**
 * Narrow a state to the fields a control renders, dropping anything unrecognizable.
 * @param value - a state, or a projection value of unknown provenance.
 * @returns the view, or `undefined` when it carries no usable mode.
 */
export function readModeView(value: unknown): AcpModeState | undefined {
  if (value === null || typeof value !== 'object') return undefined
  const record = value as { available?: unknown; current?: unknown }
  if (!Array.isArray(record.available)) return undefined
  const state = readModeState({ availableModes: record.available, currentModeId: record.current })
  return state === undefined ? undefined : state
}

/**
 * Render one report line.
 *
 * `id=Name`, with the current mode marked and the parts separated by `, ` — short
 * enough for the command row a person sees, and ordered (`current` is not
 * positional) so the two readers agree without sharing a process. Names are
 * sanitized: a separator inside a name would make the line ambiguous, and the id is
 * always recoverable.
 * @param state - the state to report.
 * @returns the line.
 */
export function formatModeReport(state: AcpModeState): string {
  const parts = state.available.map((mode) => {
    const name = mode.name.replace(/[,=]/g, ' ').trim() || mode.id
    return mode.id === state.current ? `${mode.id}=${name} (current)` : `${mode.id}=${name}`
  })
  return `${MODE_REPORT_PREFIX}${parts.join(', ')}`
}

/**
 * Parse a report line back into a state.
 *
 * The inverse of {@link formatModeReport}, and deliberately forgiving: a name is
 * optional (`plan`), whitespace around the parts is ignored, and an entry that does
 * not parse is skipped rather than failing the whole read — the control then shows
 * the ids it could recover.
 * @param text - the settled command text.
 * @returns the parsed state, or `undefined` when the line is not a report.
 */
export function parseModeReport(text: unknown): AcpModeState | undefined {
  if (typeof text !== 'string' || !text.startsWith(MODE_REPORT_PREFIX)) return undefined
  const available: AcpModeOption[] = []
  let current: string | null = null
  for (const raw of text.slice(MODE_REPORT_PREFIX.length).split(',')) {
    const entry = raw.trim()
    if (entry === '') continue
    const marked = entry.endsWith('(current)')
    const body = (marked ? entry.slice(0, -'(current)'.length) : entry).trim()
    const separator = body.indexOf('=')
    const id = (separator === -1 ? body : body.slice(0, separator)).trim()
    const name = (separator === -1 ? body : body.slice(separator + 1)).trim()
    if (id === '' || id.includes(' ')) continue
    available.push({ id, name: name === '' ? id : name })
    if (marked) current = id
  }
  if (available.length === 0) return undefined
  const advertised = current !== null && available.some((mode) => mode.id === current)
  return { available, current: advertised ? current : available[0]!.id }
}

/** One `/acp-mode` line, split into its parts. */
export interface AcpModeArgv {
  /** The agent to interrogate, when the line named one (`@<agent>`). */
  readonly agent?: string
  /** The mode to select, when the line named one. */
  readonly modeId?: string
}

/**
 * Split a command line.
 *
 * `@` introduces the agent, because the Session's route is not always readable from
 * the Host side: a Session that has not sent its first message has no request header
 * to name its agent, and the composer control — which does know — passes it.
 * @param rawInput - everything after the command name.
 * @returns the named parts.
 */
export function parseModeArgv(rawInput: string): AcpModeArgv {
  const tokens = rawInput.trim().split(/\s+/).filter((token) => token !== '')
  const out: { agent?: string; modeId?: string } = {}
  for (const token of tokens) {
    if (token.startsWith('@')) out.agent = token.slice(1)
    else if (out.modeId === undefined) out.modeId = token
  }
  return out
}
