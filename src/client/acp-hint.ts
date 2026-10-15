/**
 * The composer's ACP setup notice (browser half).
 *
 * The ACP route registers its preset cards only once at least one agent is
 * configured (`src/acp-agent/index.ts`), so a fresh install — the component
 * active, `agents: []` — shows a mode menu with no ACP entry and no reason why.
 * The settings page that fixes it is not reachable from the composer: the only
 * seam that can open Settings *on a section* is the onboarding owner share, and
 * the composer bar is not an onboarding step. This cell therefore does the one
 * thing it can do — say which blocker is in front of the person and name the page
 * that clears it — instead of staying silent.
 *
 * It is a **notice, not a control**: it appears in one state, disappears by itself
 * once an agent exists, and can be dismissed for good by the person who does not
 * intend to use ACP. `conversation.input.right` is the list slot the composer bar
 * declares before the model seat, so the notice sits with the rest of the compact
 * controls rather than inside the transcript.
 *
 * It only shows while the Session is still **blank**. The mode menu it is about
 * lives on the new-session screen, and a Session that has already run cannot
 * change its preset — so on a running conversation the same notice would be a
 * non-sequitur repeated into every turn.
 *
 * @module dsh-session-map/client/acp-hint
 */
import { createElement, Fragment, useCallback, useMemo, useState, type ReactElement } from 'react'
import { KNOWN_ENTRY_ID, acpHintFor, selectAcpNamespace } from './acp-model'
import type { ConfigFormLike, ConfigFormsLike } from './acp-card'
import { useSnapshot, type SnapshotSource } from './snapshot'

/** The cell's key in `conversation.input.right`. */
export const ACP_HINT_CELL_ID = 'acp-hint'

/**
 * The Sessions store, as far as "is this Session still blank" needs.
 *
 * An optional face: a composition that exposes no store leaves `isBlank` with
 * nothing to answer, and the notice reads that as blank rather than disappearing —
 * a missing pointer is the failure this whole cell exists to prevent.
 */
export interface SessionFace {
  /**
   * @param sessionId - the Session the composer belongs to.
   * @returns true while no turn has run, or undefined when the store cannot say.
   */
  isBlank(sessionId: string): boolean | undefined
  /**
   * @param listener - invoked after the store changes.
   * @returns the disposer removing this listener.
   */
  subscribe(listener: () => void): () => void
}

/** The props a composer list cell receives, narrowed to what this one reads. */
export interface AcpHintCellProps {
  readonly sessionId?: string
}

/**
 * Browser-local record of "this person has seen the notice and does not want it".
 *
 * Not row configuration: dismissing a pointer is a reading preference, and the
 * notice is about a state the Host already knows — see `CONVERSATION_VIEWS_KEY` in
 * `./index.ts` for the same reasoning.
 */
const DISMISSED_KEY = 'dsh.session-map.acpHintDismissed'

/**
 * A snapshot source that is always `true`, standing in for a settings provider
 * that predates the code-tools preference. Assuming it is *open* keeps the notice
 * correct without it: the alternative reads as "presets are off" and would send
 * someone to a switch that is not the problem.
 */
const PRESETS_AVAILABLE: SnapshotSource<boolean> = {
  getSnapshot: () => true,
  subscribe: () => () => {},
}

/** A form-shaped placeholder so the hook order never depends on discovery. */
const EMPTY_FORM: ConfigFormLike = {
  getSnapshot: () => ({ status: 'loading', value: undefined, writable: false, mode: 'host' }),
  subscribe: () => () => {},
  set: async () => false,
}

/**
 * Whether this browser recorded a dismissal.
 * @returns true when the notice should stay away.
 */
function readDismissed(): boolean {
  if (typeof localStorage === 'undefined') return false
  try {
    return localStorage.getItem(DISMISSED_KEY) === 'true'
  } catch {
    // Storage can be denied (private mode, blocked site data). Showing the notice
    // again is the safe reading of "no record".
    return false
  }
}

/** Record the dismissal for this browser, ignoring unavailable storage. */
function rememberDismissed(): void {
  if (typeof localStorage === 'undefined') return
  try {
    localStorage.setItem(DISMISSED_KEY, 'true')
  } catch {
    // The notice is already gone for this page; a lost preference is not worth a
    // broken render.
  }
}

/**
 * Build the notice component over a fixed configuration-form service.
 *
 * A factory rather than a plain component because the service comes from the
 * plugin's own context: a list cell is registered with its own registration
 * shape (id/order), which carries no injected face the way a single seat does.
 * @param forms - the shared configuration-form service.
 * @param session - the Sessions store, for the blank-Session gate.
 * @returns the component to register.
 */
export function createAcpHint(
  forms: ConfigFormsLike,
  session: SessionFace,
): (props: AcpHintCellProps) => ReactElement {
  return function AcpHintCell({ sessionId }: AcpHintCellProps): ReactElement {
    const describe = useMemo(() => forms.describe(), [forms])
    const mirror = useSnapshot(describe)
    const namespace = selectAcpNamespace(mirror.view?.namespaces ?? [], KNOWN_ENTRY_ID)
    const form = useMemo(() => (namespace === undefined ? undefined : forms.get(namespace)), [forms, namespace])
    const snapshot = useSnapshot(form ?? EMPTY_FORM)
    const developerTools = useSnapshot(forms.developerTools?.enabled ?? PRESETS_AVAILABLE)
    // One stable source per Session, so the hook below does not resubscribe on every
    // render: `sessionId` changes only when the composer switches Session.
    const blankSource = useMemo<SnapshotSource<boolean | undefined>>(() => ({
      getSnapshot: () => (sessionId === undefined ? undefined : session.isBlank(sessionId)),
      subscribe: session.subscribe,
    }), [session, sessionId])
    const blank = useSnapshot(blankSource)
    const [dismissed, setDismissed] = useState(readDismissed)

    const hint = acpHintFor({
      status: snapshot.status,
      value: snapshot.value,
      developerTools,
      // "Cannot tell" reads as blank: the alternative hides the only pointer at a
      // state that has no other way of announcing itself.
      blank: blank !== false,
      dismissed,
    })

    const dismiss = useCallback(() => {
      rememberDismissed()
      setDismissed(true)
    }, [])

    // The slot registry types a cell as returning an element, so "nothing to say"
    // is an empty fragment rather than `null`.
    if (hint === undefined) return createElement(Fragment, null)

    return createElement(
      'span',
      { className: 'dsm-acp-hint', 'data-dsm-acp-hint': hint.kind, title: hint.detail },
      createElement('span', { className: 'dsm-acp-hint__label' }, hint.label),
      createElement(
        'button',
        {
          type: 'button',
          className: 'dsm-acp-hint__dismiss',
          'aria-label': '不再提示',
          title: '不再提示（之后仍可在「设置 → ACP」里配置）',
          onClick: dismiss,
        },
        '×',
      ),
    )
  }
}
