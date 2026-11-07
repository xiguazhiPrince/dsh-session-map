/**
 * The `btw` feature's browser half: one composer button that forks the running
 * Session at its exact current progress into a read-only Session, then switches
 * the main view to it.
 *
 * There is deliberately no answer surface of the plugin's own: the forked
 * Session is an ordinary Session, so the product's own chat view renders it. The
 * feature owns three seats: the composer entry in `conversation.input.left`, the
 * leading mark on that Session's list row in `sidebar.session.row.leading`, and
 * the stylesheet both need.
 *
 * Both `slots` and `sessions` are optional capabilities here: a composition
 * without the Session service keeps every other seat and simply never shows the
 * button.
 *
 * @module dsh-session-map/btw
 */
import type { Context } from '@deepseek-ai/cordis'
import { createBtwButton } from './button'
import { BTW_CSS } from './css'
import { recordFork } from '../session-map/forks'
import { forkHere, type BtwSessionsFace } from './fork-here'
import { btwMarkerStorage, createBtwMarkers } from './markers'
import { createBtwRowMark } from './row-mark'
import { lookup, type SlotsService } from '../session-map/sidebar-right'

/**
 * Install the feature: inject the stylesheet, then register the composer entry
 * once both the slot registry and the Client Session service are available.
 * @param ctx - browser root context of this plugin.
 */
export function installBtw(ctx: Context): void {
  // The plugin has no `styles` service; one element per fiber, removed with it.
  ctx.effect(() => {
    const element = document.createElement('style')
    element.textContent = BTW_CSS
    document.head.appendChild(element)
    return () => { element.remove() }
  }, 'btw: stylesheet')

  // Marker store lives on the plugin run: one broadcast per fork, shared by
  // every mounted Session row.
  const markers = createBtwMarkers(btwMarkerStorage())

  ctx.inject(['slots', 'sessions'], (scope) => {
    const slots = lookup<SlotsService>(scope, 'slots')
    const sessions = lookup<BtwSessionsFace>(scope, 'sessions')
    if (slots === undefined || sessions === undefined) return

    const BtwButton = createBtwButton({
      forkHere: sessionId => forkHere({
        sessions,
        openSession: id => openSession(scope, id),
        discard: id => archiveSession(scope, id),
        mark: id => markers.add(id),
        onForked: (childId, parentId, atSeq) => recordFork({
          childId,
          parentId,
          ...(atSeq === undefined ? {} : { atSeq }),
        }),
      }, sessionId),
    })

    scope.effect(() => slots.inject('conversation.input.left', () => slots.register(
      { name: 'conversation.input.left', id: 'session-map-btw', order: 20 },
      BtwButton,
    )), 'btw: composer button')

    // The 16px cell before a Session row's title: the product's own status dot
    // lives there, and a louder row state replaces this occupant, so the mark
    // shows exactly on the rows where nothing else is speaking.
    const BtwRowMark = createBtwRowMark(markers)
    scope.effect(() => slots.inject('sidebar.session.row.leading', () => slots.register(
      { name: 'sidebar.session.row.leading', id: 'session-map-btw-mark', order: 20 },
      BtwRowMark,
    )), 'btw: session row mark')
  })
}

/** Workspace navigation, as far as opening one Session needs. */
interface UiWorkspaceFace {
  openSession(sessionId: string): void
  archiveSession?(sessionId: string, options?: { readonly stopActivity?: boolean }): Promise<void>
}

/** Session Controller navigation, the fallback when the Workspace UI is absent. */
interface SessionsNavigationFace {
  open(sessionId: string): void
}

/**
 * Show one Session in the main view.
 *
 * The Workspace UI owns which Session the conversation area shows; a native
 * shell without it falls back to the Session controller's own `open`.
 * @param ctx - context to resolve the navigation service from.
 * @param sessionId - the Session to show.
 */
function openSession(ctx: Context, sessionId: string): void {
  const uiWorkspace = lookup<UiWorkspaceFace>(ctx, 'uiWorkspace')
  if (uiWorkspace !== undefined && typeof uiWorkspace.openSession === 'function') {
    uiWorkspace.openSession(sessionId)
    return
  }
  const sessions = lookup<SessionsNavigationFace>(ctx, 'sessions')
  if (sessions !== undefined && typeof sessions.open === 'function') sessions.open(sessionId)
}

/**
 * Drop a Session that was created but must not be shown — the read-only switch
 * failed, so landing the user in it would break the feature's promise. The fork
 * attaches its child to the Session's workspace, so archiving takes the row out
 * of the list while keeping it recoverable.
 * @param ctx - context to resolve the archive service from.
 * @param sessionId - the Session to hide.
 */
async function archiveSession(ctx: Context, sessionId: string): Promise<void> {
  const uiWorkspace = lookup<UiWorkspaceFace>(ctx, 'uiWorkspace')
  if (uiWorkspace === undefined || typeof uiWorkspace.archiveSession !== 'function') return
  await uiWorkspace.archiveSession(sessionId)
}
