/**
 * The ACP collaboration-mode surface (P11).
 *
 * An ACP agent advertises its own collaboration modes in `session/new`
 * (`SessionModeState`: `{ currentModeId, availableModes }`) and changes them through
 * the core `session/set_mode` method. `cursor-agent` advertises `agent`, `plan` and
 * `ask`; another agent may advertise none, or other ids entirely. Nothing about this
 * is vendor-specific, and nothing about it exists in DSH: measured across the
 * product source, a Session has no notion of "the agent's mode".
 *
 * DSH's own plan mode cannot stand in for it — that feature is a DSH prompt section
 * plus a DSH tool, and a remote ACP agent receives neither.
 *
 * What this module deliberately does NOT do is publish the state through a Session
 * projection, which was the first design and is not available to a plugin: a
 * projection needs a Session event, and `dsh-session`'s read path refuses a type
 * outside the build's catalogue unless the envelope carries `ignorable: true`, which
 * `Session.append` cannot set for a non-surface event. Writing one anyway made the
 * Session unreadable (measured; see `../../docs/p11-acp-mode-select.md`).
 *
 * The one supported channel is a **registered command**:
 *
 * - a live Session's mode is switched by `session/set_mode` on its channel;
 * - a mode chosen before the agent connected is held in memory and adopted by the
 *   first channel that opens for that Session;
 * - the report a read answers with is the state channel the client reads, in the
 *   shape `./../client/acp-mode-model.ts` defines and parses.
 *
 * @module dsh-session-map/acp-agent/modes
 */
import {
  EMPTY_ACP_MODES,
  formatModeReport,
  parseModeArgv,
  type AcpModeState,
} from '../client/acp-mode-model'
import type { HostContext, SessionLike } from './contract'

export {
  EMPTY_ACP_MODES,
  MODE_REPORT_PREFIX,
  formatModeReport,
  parseModeArgv,
  parseModeReport,
  readModeState,
  readModeView,
} from '../client/acp-mode-model'
export type { AcpModeArgv, AcpModeOption, AcpModeState } from '../client/acp-mode-model'

/** The command the composer control (or a person) executes. */
export const ACP_MODE_COMMAND = 'acp-mode'

/** What the command handler should do for one `/acp-mode …` line. */
export type ModeSwitchOrReport =
  | { readonly kind: 'report'; readonly text: string }
  | { readonly kind: 'set'; readonly modeId: string }
  | { readonly kind: 'error'; readonly text: string }

/**
 * The `/acp-mode` grammar, as one pure decision: no mode reports, a mode the agent
 * advertised switches, anything else is refused with the ids that would have worked.
 * @param state - the Session's known mode state.
 * @param modeId - the mode the line named, when it named one.
 * @returns the decision.
 */
export function planModeSwitch(state: AcpModeState, modeId: string | undefined): ModeSwitchOrReport {
  const ids = state.available.map((mode) => mode.id)
  if (ids.length === 0) {
    return { kind: 'error', text: 'This Session has no connected ACP agent yet, or its agent advertises no modes.' }
  }
  if (modeId === undefined) return { kind: 'report', text: formatModeReport(state) }
  if (state.available.some((mode) => mode.id === modeId)) return { kind: 'set', modeId }
  return { kind: 'error', text: `Unknown ACP mode "${modeId}". Available: ${ids.join(', ')}` }
}

/** A live channel, as the surface needs it. */
export interface AcpModeController {
  /** @returns the last state this channel reported. */
  modeState(): AcpModeState
  /**
   * @param modeId - one advertised mode id.
   * @returns settlement of the agent's `session/set_mode`.
   */
  setMode(modeId: string): Promise<void>
}

/** What the surface needs from the route to answer for a Session that has no channel. */
export interface AcpModeSurfaceOptions {
  /**
   * The modes a named agent advertises, read through the same handshake the model
   * list uses. Omitted when the route has no discovery path, in which case a report
   * is only possible for a Session whose agent is already connected.
   * @param agentName - the configured agent name.
   * @returns its modes, or `undefined` when it advertises none or cannot be reached.
   */
  readonly probe?: (agentName: string) => Promise<AcpModeState | undefined>
}

/** The surface the adapter registers channels with and the command writes through. */
export interface AcpModeSurface {
  /**
   * @param session - the Session this channel serves.
   * @param controller - the live channel.
   * @returns the disposer removing the registration.
   */
  attach(session: SessionLike | undefined, controller: AcpModeController): () => void
  /**
   * Take the mode a Session asked for before its agent connected, once.
   *
   * A mode picked on a Session with no live channel cannot be sent yet — the agent
   * has no session to receive it — so the choice is held and the first channel for
   * that Session adopts it before the turn's prompt.
   * @param session - the Session the choice belongs to.
   * @returns the mode id once, then `undefined` for later channels.
   */
  takeWanted(session: SessionLike | undefined): string | undefined
}

/**
 * Install the mode surface: the command, and the registry of live channels.
 *
 * Registered through optional injection, so a composition without a command registry
 * keeps the route working and simply offers no way to switch modes.
 * @param ctx - the row's Host context.
 * @param options - the route hooks a report needs when no channel exists.
 * @returns the surface the adapter publishes through.
 */
export function installAcpModes(ctx: HostContext, options: AcpModeSurfaceOptions = {}): AcpModeSurface {
  const controllers = new WeakMap<object, AcpModeController>()
  /** Modes picked before the Session's agent connected, adopted by its first channel. */
  const wanted = new WeakMap<object, string>()

  ctx.inject(['commands'], (scoped) => {
    const commands = (scoped as unknown as {
      commands?: {
        register(definition: {
          name: string
          description: string
          input: { hint: string }
          handler: (invocation: { agent?: { session?: SessionLike }; rawInput: string }) => unknown
        }): () => void
      }
    }).commands
    if (commands === undefined) return
    commands.register({
      name: ACP_MODE_COMMAND,
      description: "Read or switch the ACP agent's collaboration mode",
      input: { hint: '[@agent] [mode]' },
      handler: async ({ agent, rawInput }) => {
        const session = agent?.session
        if (session === undefined) return { kind: 'error', text: 'This command needs a Session.' }
        const argv = parseModeArgv(rawInput)
        const controller = controllers.get(session)
        const state = controller?.modeState()
          ?? (argv.agent === undefined ? EMPTY_ACP_MODES : await options.probe?.(argv.agent) ?? EMPTY_ACP_MODES)
        const plan = planModeSwitch(state, argv.modeId)
        if (plan.kind === 'report') return { kind: 'success', text: plan.text }
        if (plan.kind === 'error') return { kind: 'error', text: plan.text }
        if (controller === undefined) {
          wanted.set(session, plan.modeId)
          return { kind: 'success', text: `ACP mode: ${plan.modeId} (applies when the agent connects)` }
        }
        try {
          await controller.setMode(plan.modeId)
        } catch (error: unknown) {
          ctx.logger.warn('dsh-session-map/acp-agent: switching ACP mode failed: %o', error)
          return { kind: 'error', text: `The agent refused mode "${plan.modeId}".` }
        }
        return { kind: 'success', text: `ACP mode: ${plan.modeId}` }
      },
    })
  })

  return {
    attach: (session, controller) => {
      if (session === undefined) return () => {}
      controllers.set(session, controller)
      return () => { controllers.delete(session) }
    },
    takeWanted: (session) => {
      if (session === undefined) return undefined
      const value = wanted.get(session)
      wanted.delete(session)
      return value
    },
  }
}
