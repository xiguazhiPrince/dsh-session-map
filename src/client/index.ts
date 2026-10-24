/**
 * Browser half: the Session map plugin.
 *
 * Contributes the Session map UI plus two smaller seats: a composer Git branch
 * badge and the Settings → Clone from Git page. The map itself is a plain
 * overview as a Conversation tab and as a right-column tab, a turn-tree canvas
 * as a Conversation tab, a right-column tab, and a Session header launcher; the
 * branch reading lives in `conversation.input.left`, and the clone form is a
 * `settings.section` page (see `../git-workspace/client`).
 *
 * Services are read through `ctx.get` against local structural types rather
 * than the product's own browser packages: those are published at a prerelease
 * version, and this repository deliberately does not pin them. The same reason
 * makes the stylesheet travel as a string — there is no `styles` service
 * outside the dynamic runtime — so `apply` owns the `<style>` element itself.
 *
 * @module dsh-session-map/client
 */
import type { Context } from '@deepseek-ai/cordis'
import type { ReactElement } from 'react'
import { createGitBranchBadge, type GitBranchRuntime } from './branch'
import { CSS } from './css'
import { MAP_KIND, MAP_TYPE_ID, OVERVIEW_KIND, OVERVIEW_TYPE_ID } from './constants'
import { createFlag } from './flags'
import { createGitWorkspaceRuntime, createGitWorkspaceSettings } from '../git-workspace/client'
import {
  createMapLauncher,
  createMapView,
  createOverviewTab,
  DEFAULT_FOLD_RUNS,
  DEFAULT_MAP_DIRECTION,
  DEFAULT_MAP_SCOPE,
  SidebarOverviewBody,
  type MapFlags,
  type SessionEventsFace,
  type SessionMapRuntime,
  type SidebarRightFace,
} from './views'

/** Plugin name the Loader reports for this bundle's browser half. */
export const name = 'dsh-session-map'

/** Hard dependency: there is nothing to register into before the slot registry exists. */
export const inject = ['slots']

/** Structural view of the context's untyped service lookup, which this program does not declare. */
interface ServiceLocator {
  get(name: string): unknown
}

/** One entry's registration options, across the cardinalities this plugin uses. */
interface SlotRegistrationOptions {
  readonly name: string
  /** List-cell key; required by a list slot. */
  readonly id?: string
  /** Keyed-cell key; required by a keyed slot. */
  readonly key?: string
  readonly order?: number
  readonly label?: string
}

/** The slot-registry operations this plugin calls. */
interface SlotsService {
  /**
   * Run a registration while a slot key is declared, and drop it when that declaration collapses.
   * @param key - the slot key to wait for.
   * @param callback - the registration body.
   * @returns the injected registration's disposer.
   */
  inject(key: string, callback: () => () => void): () => void
  /**
   * Register one entry into a declared slot.
   * @param options - the slot key plus the options its cardinality takes.
   * @param component - the entry's body.
   * @returns the registration's disposer.
   */
  register<P>(options: SlotRegistrationOptions, component: (props: P) => ReactElement): () => void
}

/** One guide-page capsule a tab type offers. */
interface SidebarRightGuideEntry {
  readonly order: number
  readonly title: () => string
  readonly description?: (() => string) | undefined
}

/** One registered right-sidebar tab type, as this plugin declares it. */
interface SidebarRightTabDefinition {
  readonly id: string
  readonly kind: string
  readonly title: (address: string) => string
  readonly guide?: readonly SidebarRightGuideEntry[] | undefined
}

/** The right-sidebar tab-type registry (stage one of a tab registration). */
interface SidebarRightTabsService {
  /**
   * The type in force for a kind.
   * @param kind - the type discriminator.
   * @returns the type, or `undefined` when nothing registered it.
   */
  get(kind: string): SidebarRightTabDefinition | undefined
  /**
   * Register one tab type for the caller's lifetime.
   * @param definition - the contributed type.
   * @returns idempotent disposer.
   */
  register(definition: SidebarRightTabDefinition): () => void
}

/** Workspace navigation, as far as opening one Session needs. */
interface UiWorkspaceService {
  openSession(sessionId: string): void
}

/** Session Controller navigation, the fallback when the Workspace UI is absent. */
interface SessionsService {
  open(sessionId: string): void
}

/** A lifecycle effect body: what it installs, and the disposer that releases it. */
type EffectBody = () => () => void

/**
 * Read one optional service from the global store.
 *
 * The context's declared surface carries none of these prerelease services, so
 * the lookup is typed here instead of imported; `undefined` means nothing is
 * providing the name right now.
 * @param ctx - the plugin's context.
 * @param name - the service name.
 * @returns the service as the caller's local interface, or `undefined`.
 */
function lookup<T>(ctx: Context, name: string): T | undefined {
  const locator = ctx as unknown as ServiceLocator
  return locator.get(name) as T | undefined
}

/**
 * Browser-local preference holding whether the Conversation tab entries are
 * registered.
 *
 * Not row config: the browser half is created by the web boot with a bare
 * `{ name }` (`packages/client/web/src/boot-client.ts`), and a boot manifest
 * row carries only `id`, `inject`, and `immediately`, so nothing a profile
 * writes reaches this program.
 */
const CONVERSATION_VIEWS_KEY = 'dsh.session-map.conversationViews'

/**
 * Whether the Conversation tabs are registered when this browser recorded no
 * preference. The header launcher and both right-column tab types register
 * either way, so the map stays usable from the right column alone.
 */
const DEFAULT_CONVERSATION_VIEWS = false

/**
 * Read this browser's Conversation-tab preference.
 * @returns true when the tabs should be registered.
 */
function conversationViewsEnabled(): boolean {
  if (typeof localStorage === 'undefined') return DEFAULT_CONVERSATION_VIEWS
  try {
    const stored = localStorage.getItem(CONVERSATION_VIEWS_KEY)
    if (stored === 'true') return true
    if (stored === 'false') return false
  } catch {
    // Storage can be denied (private mode, blocked site data); the shipped
    // default is the reading of "no preference recorded".
  }
  return DEFAULT_CONVERSATION_VIEWS
}

/**
 * Client plugin body: inject the stylesheet, build the three bodies over one set
 * of plugin-run switches, and register every seat and tab type.
 * @param ctx - browser root context carrying the slot registry.
 */
export function apply(ctx: Context): void {
  const slots = lookup<SlotsService>(ctx, 'slots')
  if (slots === undefined) return

  // The product has no `styles` service outside the dynamic runtime, so the
  // sheet is a string this effect owns: one element, removed with the fiber.
  ctx.effect(() => {
    const element = document.createElement('style')
    element.textContent = CSS
    document.head.appendChild(element)
    return () => { element.remove() }
  }, 'session-views: stylesheet')

  // Toolbar preferences live on the plugin run, not on one mounted View:
  // switching Session unmounts and remounts this View.
  // How much of the map to draw: the Session being read has a tree of its own,
  // and a reader who arrived in one Session usually wants that tree. Asking for
  // every Session is one gesture away, on this same switch.
  const scopeFlag = createFlag(DEFAULT_MAP_SCOPE)
  // Which way the trees grow. A fork reads as a descent, so the canvas opens
  // top-down and keeps the original left-to-right layout on the same switch.
  const directionFlag = createFlag(DEFAULT_MAP_DIRECTION)
  // Long straight runs fold their middle stretch by default; expanding one is a
  // per-run override, and the toolbar switch asks for every turn at once.
  const foldRunsFlag = createFlag(DEFAULT_FOLD_RUNS)
  const expandedRunsFlag = createFlag(new Set<string>())
  const hideSubagentsFlag = createFlag(true)

  const flags: MapFlags = {
    scope: scopeFlag,
    direction: directionFlag,
    foldRuns: foldRunsFlag,
    expandedRuns: expandedRunsFlag,
    hideSubagents: hideSubagentsFlag,
  }

  const runtime: SessionMapRuntime = {
    sidebarRight: () => {
      const service = lookup<SidebarRightFace>(ctx, 'sidebarRight')
      if (service === undefined) throw new Error('右侧栏服务 sidebarRight 不可用')
      return service
    },
    openSession: (sessionId) => {
      const uiWorkspace = lookup<UiWorkspaceService>(ctx, 'uiWorkspace')
      if (uiWorkspace !== undefined && typeof uiWorkspace.openSession === 'function') {
        uiWorkspace.openSession(sessionId)
        return
      }
      const sessions = lookup<SessionsService>(ctx, 'sessions')
      if (sessions !== undefined && typeof sessions.open === 'function') sessions.open(sessionId)
    },
    // Only the loaded event windows can add steering inputs to the outline;
    // the canvas reads the current Session and its ancestors, then releases.
    sessions: () => lookup<SessionEventsFace>(ctx, 'sessions'),
  }

  const MapLauncher = createMapLauncher(runtime)
  const OverviewTab = createOverviewTab(runtime)
  const SessionMapTab = createMapView(runtime, flags, true)
  const SidebarMapBody = createMapView(runtime, flags, false)

  ctx.effect(() => slots.inject('conversation.session.header.utilities', () => slots.register(
    { name: 'conversation.session.header.utilities', id: 'session-map-launcher', order: 40 },
    MapLauncher,
  )), 'session-map: header launcher')

  // Clone from Git lives in Settings, not the sidebar: a repository is set up
  // once per project, so it earns a settings page rather than a permanent
  // navigation cell. The Host half owns the clone and Workspace registration.
  const GitWorkspaceSettings = createGitWorkspaceSettings(createGitWorkspaceRuntime(ctx))
  ctx.effect(() => slots.inject('settings.section', () => slots.register(
    { name: 'settings.section', id: 'git-workspace', order: 60, label: '从 Git 克隆' },
    GitWorkspaceSettings,
  )), 'git-workspace: settings section')

  // The branch badge reads `.git/HEAD` through the Host's file Remote. That
  // Remote belongs to another package, so it is an optional capability: a
  // composition without it keeps every other seat, and this one simply never
  // appears.
  ctx.inject(['slots', 'remote', 'remote.workspaceFiles'], (scope) => {
    const scopedSlots = lookup<SlotsService>(scope, 'slots')
    const remote = lookup<GitBranchRuntime>(scope, 'remote')
    if (scopedSlots === undefined || remote === undefined) return
    const GitBranchBadge = createGitBranchBadge(remote)
    scope.effect(() => scopedSlots.inject('conversation.input.left', () => scopedSlots.register(
      { name: 'conversation.input.left', id: 'session-map-git-branch', order: 10 },
      GitBranchBadge,
    )), 'session-map: git branch badge')
  })

  // The Conversation tab entries are opt-in; see DEFAULT_CONVERSATION_VIEWS.
  if (conversationViewsEnabled()) {
    ctx.effect(() => slots.inject('conversation.view', () => slots.register(
      { name: 'conversation.view', id: 'session-overview', order: 20, label: '概览' },
      OverviewTab,
    )), 'session-overview: conversation view entry')

    ctx.effect(() => slots.inject('conversation.view', () => slots.register(
      { name: 'conversation.view', id: 'session-map', order: 30, label: '会话图谱' },
      SessionMapTab,
    )), 'session-map: conversation view entry')
  }

  // The right column's type registry belongs to another package whose own
  // injections are wider, so its apply can land after this one. Reading the
  // service once at this point would find nothing, drop both tab types, and
  // leave the header button opening a kind nothing registered. Waiting on it
  // here keeps the Conversation seats available in a composition that mounts no
  // right column at all, which a plugin-level inject would not.
  ctx.inject(['slots', 'sidebarRightTabs'], (scope) => {
    const scopedSlots = lookup<SlotsService>(scope, 'slots')
    const sidebarRightTabs = lookup<SidebarRightTabsService>(scope, 'sidebarRightTabs')
    if (scopedSlots === undefined || sidebarRightTabs === undefined) return

    // A page kept open across a host restart still runs the previous incarnation
    // of this plugin, which already holds the same type. Reusing that one is
    // safe: every other cell is re-registered below under a later priority, so
    // the new bodies win. A DIFFERENT type holding the kind is a real wiring
    // conflict and still fails loud.
    const claimType = (
      id: string,
      kind: string,
      title: () => string,
      guideTitle?: () => string,
      guideDescription?: () => string,
    ): EffectBody => {
      return () => {
        const existing = sidebarRightTabs.get(kind)
        if (existing !== undefined) {
          if (existing.id === id) return () => {}
          throw new Error(
            'sidebarRight: kind "' + kind + '" is already held by tab type "' + existing.id + '"',
          )
        }
        const definition: SidebarRightTabDefinition = guideTitle === undefined
          ? { id, kind, title }
          : { id, kind, title, guide: [{ order: 20, title: guideTitle, description: guideDescription }] }
        return sidebarRightTabs.register(definition)
      }
    }

    ctx.effect(
      claimType(OVERVIEW_TYPE_ID, OVERVIEW_KIND, () => '会话概览'),
      'session-overview: rightbar tab type',
    )
    ctx.effect(() => scopedSlots.inject('sidebar.right.pane.tab', () => scopedSlots.register(
      { name: 'sidebar.right.pane.tab', key: OVERVIEW_TYPE_ID },
      SidebarOverviewBody,
    )), 'session-overview: rightbar tab body')

    ctx.effect(
      claimType(
        MAP_TYPE_ID,
        MAP_KIND,
        () => '会话图谱',
        () => '会话图谱',
        () => '所有会话的轮次树画布',
      ),
      'session-map: rightbar tab type',
    )
    ctx.effect(() => scopedSlots.inject('sidebar.right.pane.tab', () => scopedSlots.register(
      { name: 'sidebar.right.pane.tab', key: MAP_TYPE_ID },
      SidebarMapBody,
    )), 'session-map: rightbar tab body')
  })
}
