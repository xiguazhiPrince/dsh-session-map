/**
 * Browser registration for the Git tool window.
 *
 * The tool window is one `main` panel addressed by the sidebar entry id, plus
 * the sidebar icon itself. The sidebar owns the button and the selection state;
 * this module only contributes the icon and the panel body.
 *
 * @module dsh-session-map/git-workspace/window/index
 */
import type { Context } from '@deepseek-ai/cordis'
import type { ReactElement } from 'react'
import { createGitPanel, PANEL_OPEN_KEY } from './shell'
import { GitPanelIcon } from './icons'
import { createGitWindowRuntime } from './runtime'

/** Sidebar entry id, also the `main` key the panel registers under. */
const PANEL_ID = 'git-workspace'

/** One entry's registration options. */
interface SlotRegistrationOptions {
  readonly name: string
  readonly id?: string
  readonly key?: string
  readonly order?: number
  readonly label?: string
}

/** The slot-registry operations this module calls. */
interface SlotsService {
  inject(key: string, callback: () => () => void): () => void
  register<P>(options: SlotRegistrationOptions, component: (props: P) => ReactElement): () => void
}

/** Panel navigation, used only to restore the panel after a reload. */
interface LayoutService {
  selectPanel(panelId: string | null): void
}

/** Structural view of the context's untyped service lookup. */
interface ServiceLocator {
  get(name: string): unknown
}

/** Read one optional service. */
function lookup<T>(ctx: Context, name: string): T | undefined {
  return (ctx as unknown as ServiceLocator).get(name) as T | undefined
}

/** Whether the previous page load had this panel open. */
function panelWasOpen(): boolean {
  if (typeof localStorage === 'undefined') return false
  try {
    return localStorage.getItem(PANEL_OPEN_KEY) === 'true'
  } catch {
    return false
  }
}

/**
 * Register the Git tool window panel and its sidebar icon.
 * @param ctx - browser root context carrying the slot registry.
 */
export function installGitWindowPanel(ctx: Context): void {
  const slots = lookup<SlotsService>(ctx, 'slots')
  if (slots === undefined) return
  const layout = lookup<LayoutService>(ctx, 'layout')

  ctx.effect(() => slots.inject('sidebar.panellist', () => slots.register(
    { name: 'sidebar.panellist', id: PANEL_ID, order: 30, label: 'Git' },
    GitPanelIcon,
  )), 'git-window: panel icon')

  const Panel = createGitPanel(createGitWindowRuntime())
  ctx.effect(() => slots.inject('main', () => slots.register(
    { name: 'main', key: PANEL_ID },
    Panel,
  )), 'git-window: main panel')

  // The layout store is in-memory, so a reload would otherwise land back on the
  // Conversation. Restore only after the registration fiber has mounted, and
  // never let a missing layout service break the rest of the bundle.
  ctx.effect(() => {
    if (!panelWasOpen() || layout === undefined) return () => undefined
    const timer = setTimeout(() => {
      try {
        layout.selectPanel(PANEL_ID)
      } catch {
        // The panel registration is gone (plugin reload); stay on the Conversation.
      }
    }, 0)
    return () => clearTimeout(timer)
  }, 'git-window: restore panel')
}
