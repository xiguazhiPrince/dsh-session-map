/**
 * The composer's ACP mode control (P11, browser half).
 *
 * A remote ACP agent advertises its own collaboration modes (`agent`, `plan`, `ask`
 * for `cursor-agent`) and changes them through the core `session/set_mode` method.
 * The Host half owns the switch; this cell is the visible control, placed in
 * `conversation.input.left` — the list slot the composer bar declares immediately
 * after the access-mode (permission) seat, which is what puts it to that seat's
 * right.
 *
 * The state arrives through the **command answer**, not a projection: DSH's
 * projection channel needs a Session event, and a plugin cannot write one that other
 * harness builds will read (see `../../docs/p11-acp-mode-select.md` §3). So the cell
 * reads once per Session by executing `/acp-mode @<agent>` and parsing the settled
 * text, and switches by executing `/acp-mode @<agent> <id>`. The visible cost is that
 * each read and each switch commits the command's own lifecycle events, which the
 * transcript renders as a command row.
 *
 * @module dsh-session-map/client/acp-mode-card
 */
import { createElement, Fragment, useEffect, useState, type ReactElement } from 'react'
import { parseModeReport, type AcpModeState } from './acp-mode-model'
import { agentFromPresetId, isAcpPreset } from './model-scope'

/** The outcome shape `remote.commands.execute` settles with, narrowed to what is read. */
export type CommandOutcome =
  | { readonly ok: true; readonly value?: { readonly result?: { readonly kind?: string; readonly text?: string } } }
  | { readonly ok: false; readonly error: { readonly code: string; readonly message: string } }

/** The one Remote verb this cell needs. */
export interface AcpModeCommandsFace {
  execute(sessionId: string, line: string, attachments: readonly unknown[]): Promise<CommandOutcome>
}

/** The props a composer list cell receives, narrowed to what this one reads. */
export interface AcpModeCellProps {
  readonly sessionId: string
  /** Reads the current Session's projection value by key. */
  readonly useProjection?: (key: string) => unknown
}

/** The cell's key in `conversation.input.left`. */
export const ACP_MODE_CELL_ID = 'acp-mode'

/**
 * Sessions this page has already read a mode report for.
 *
 * A read commits the command's lifecycle events to the Session log, so it is worth
 * doing exactly once: a re-rendered cell must not answer itself into the transcript.
 * A failed read is forgotten, so a later mount may try again.
 */
const readOnce = new Set<string>()

/**
 * Build the cell component.
 *
 * A factory rather than a plain component because the command face comes from the
 * plugin's own context: a list cell is registered with its own registration shape
 * (id/order), which does not carry an injected face the way a single seat does.
 * @param commands - the command Remote, when the composition exposes it.
 * @returns the component to register.
 */
export function createAcpModeSelect(commands: AcpModeCommandsFace | undefined): (props: AcpModeCellProps) => ReactElement {
  return function AcpModeSelect({ sessionId, useProjection }: AcpModeCellProps): ReactElement {
    const preset = useProjection?.('agentPreset')
    const agent = isAcpPreset(preset) ? agentFromPresetId(preset) : undefined
    const [state, setState] = useState<AcpModeState | undefined>(undefined)
    const [busy, setBusy] = useState(false)
    const [failure, setFailure] = useState<string | null>(null)

    /**
     * Ask the Host what modes this Session's agent offers.
     *
     * Every failure narrows to a line on the control instead of a broken cell: a
     * Session whose agent is unreachable simply keeps whatever it already showed.
     */
    const read = async (): Promise<boolean> => {
      if (commands === undefined || agent === undefined) return false
      setBusy(true)
      try {
        const outcome = await commands.execute(sessionId, `/acp-mode @${agent}`, [])
        if (!outcome.ok) {
          setFailure(`${outcome.error.message} (${outcome.error.code})`)
          return false
        }
        const text = outcome.value?.result?.text
        const parsed = parseModeReport(text)
        if (parsed === undefined) {
          setFailure(outcome.value?.result?.kind === 'error' ? (text ?? 'the mode read failed') : 'no ACP modes were reported')
          return false
        }
        setFailure(null)
        setState(parsed)
        return true
      } catch (error: unknown) {
        setFailure(error instanceof Error ? error.message : String(error))
        return false
      } finally {
        setBusy(false)
      }
    }

    // One read per Session per page: a Session whose agent has not connected yet is
    // answered from the route's own discovery probe, so the control appears before
    // the first message rather than after it.
    useEffect(() => {
      if (commands === undefined || agent === undefined || readOnce.has(sessionId)) return
      readOnce.add(sessionId)
      void read().then((ok) => { if (!ok) readOnce.delete(sessionId) })
    }, [commands, agent, sessionId])

    // A single advertised mode is not a choice, and without the command there is
    // nothing this control could do. The slot registry types a cell as returning an
    // element, so "nothing to show" is an empty fragment rather than `null`.
    if (commands === undefined || agent === undefined || state === undefined || state.available.length < 2) {
      return createElement(Fragment, null)
    }

    const current = state.current ?? state.available[0]!.id
    const change = (modeId: string): void => {
      setBusy(true)
      setFailure(null)
      void commands.execute(sessionId, `/acp-mode @${agent} ${modeId}`, []).then(
        (outcome) => {
          setBusy(false)
          if (!outcome.ok) {
            setFailure(`${outcome.error.message} (${outcome.error.code})`)
            return
          }
          if (outcome.value?.result?.kind === 'error') {
            setFailure(outcome.value.result.text ?? 'the agent refused that mode')
            return
          }
          // The switch is confirmed by the Host; the mode list itself does not change.
          setState((previous) => (previous === undefined ? previous : { ...previous, current: modeId }))
        },
        (error: unknown) => {
          setBusy(false)
          setFailure(error instanceof Error ? error.message : String(error))
        },
      )
    }

    const described = state.available.find((mode) => mode.id === current)?.description
    return createElement(
      'select',
      {
        className: 'dsm-acp-mode',
        'data-dsm-acp-mode': 'select',
        'aria-label': 'ACP mode',
        title: failure ?? described ?? 'ACP mode',
        value: current,
        disabled: busy,
        onChange: (event: { target: { value: string } }) => { change(event.target.value) },
      },
      state.available.map((mode) => createElement(
        'option',
        { key: mode.id, value: mode.id, title: mode.description ?? '' },
        mode.name,
      )),
    )
  }
}
