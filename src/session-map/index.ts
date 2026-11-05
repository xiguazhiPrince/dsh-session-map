/**
 * Browser half: the Session map plugin.
 *
 * Contributes the Session map UI plus seven smaller seats: a composer Git
 * branch badge, a composer `BTW` button that forks the running Session at its
 * exact progress into a read-only one (see `../btw`), a Session skills tab, a
 * Session instructions tab, the Settings → Clone from Git page, the Settings →
 * Skills page, and the right column's bulk-close tab-menu rows. The map itself
 * is a plain overview as a Conversation
 * tab and as a right-column tab, a turn-tree canvas as a Conversation tab, a
 * right-column tab, and a Session header launcher; the branch reading lives in
 * `conversation.input.left`, the Session skills list is another
 * `conversation.view` tab (see
 * `../skill-catalog/session-tab`), the AGENTS.md manager is a third
 * `conversation.view` tab (see `../agent-instructions/client`), the clone form
 * is a `settings.section` page (see `../git-workspace/client`), the skills
 * catalog is another `settings.section` page (see `../skill-catalog/client`),
 * and every right-column tab gains three bulk-close rows in its context menu
 * (see `../rightbar-tab-menu/client`).
 *
 * Services are read through `ctx.get` against local structural types rather
 * than the product's own browser packages: those are published at a prerelease
 * version, and this repository deliberately does not pin them. The same reason
 * makes the stylesheet travel as a string — there is no `styles` service
 * outside the dynamic runtime — so `apply` owns the `<style>` element itself.
 *
 * @module dsh-session-map/session-map/index
 */
import type { Context } from '@deepseek-ai/cordis'
import { createGitBranchBadge, type GitBranchRuntime } from './branch'
import { CSS } from './css'
import { MAP_KIND, MAP_TYPE_ID, OVERVIEW_KIND, OVERVIEW_TYPE_ID } from './constants'
import { createFlag } from './flags'
import { createAgentInstructionsRuntime, createAgentInstructionsTab } from '../agent-instructions/client'
import { installBtw } from '../btw'
import { createGitWorkspaceRuntime, createGitWorkspaceSettings } from '../git-workspace/client'
import { installGitRightbarPage, installGitWindowPanel } from '../git-workspace/window'
import { installRightbarTabMenu } from '../rightbar-tab-menu/client'
import { createSkillCatalogRuntime, createSkillCatalogSettings } from '../skill-catalog/client'
import { createSessionSkillRuntime, createSessionSkillsTab } from '../skill-catalog/session-tab'
import {
  createTypeClaimer,
  lookup,
  type SlotsService,
  type SidebarRightTabsService,
} from './sidebar-right'
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
export const name = '@xiguazhiprince/dsh-session-map'

/** Hard dependency: there is nothing to register into before the slot registry exists. */
export const inject = ['slots']

/** Workspace navigation, as far as opening one Session needs. */
interface UiWorkspaceService {
  openSession(sessionId: string): void
}

/** Session Controller navigation, the fallback when the Workspace UI is absent. */
interface SessionsService {
  open(sessionId: string): void
}

/**
 * Browser-local preference holding whether the map's Conversation tab entries
 * (the overview and the turn-tree canvas) are registered.
 *
 * Not row config: the browser half is created by the web boot with a bare
 * `{ name }` (`packages/client/web/src/boot-client.ts`), and a boot manifest
 * row carries only `id`, `inject`, and `immediately`, so nothing a profile
 * writes reaches this program.
 *
 * The Session skills tab is deliberately outside this preference: it is a small
 * read-only list, so it registers by default whenever the typed skill Remote is
 * mounted.
 */
const CONVERSATION_VIEWS_KEY = 'dsh.session-map.conversationViews'

/**
 * Whether the map's Conversation tabs are registered when this browser recorded
 * no preference. The header launcher and both right-column tab types register
 * either way, so the map stays usable from the right column alone.
 */
const DEFAULT_CONVERSATION_VIEWS = false

/**
 * Read this browser's map Conversation-tab preference.
 * @returns true when the map's overview and canvas tabs should be registered.
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

  // The Git tool window is a global main-panel entry, not conversation chrome:
  // it owns its own workspace picker and sidebar icon.
  installGitWindowPanel(ctx)

  // The one-page Git page for the native right column: Session-bound, follows
  // the Session's workspace, and usable without leaving the conversation.
  installGitRightbarPage(ctx)

  // Every tab of the native right column gains three bulk-close rows in its
  // context menu; the row component decides per occurrence which of them apply.
  installRightbarTabMenu(ctx)

  // `btw`: while a Session runs, one composer button forks it at its exact
  // current progress into a read-only Session and switches the view there.
  // The feature owns its own optional dependencies and stylesheet.
  installBtw(ctx)

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

  // The skills manager is a management surface, not conversation chrome: it
  // lists every discovered skill at both levels, so it belongs beside the other
  // project-scoped Settings pages. Order 30 keeps it next to the agent-preset
  // page, before the repository setup further down.
  const SkillCatalogSettings = createSkillCatalogSettings(createSkillCatalogRuntime(ctx))
  ctx.effect(() => slots.inject('settings.section', () => slots.register(
    { name: 'settings.section', id: 'skills', order: 30, label: '技能' },
    SkillCatalogSettings,
  )), 'skill-catalog: settings section')

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

  // The map's Conversation tab entries are opt-in; see
  // DEFAULT_CONVERSATION_VIEWS.
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

  // The Session's effective skills tab is registered by default: it is a small
  // read-only view over the typed Remote the product's own `/` skill menu
  // already uses, not part of the map's opt-in group. The Host resolves the
  // Session's working directory and Agent preset, so this tab needs no route of
  // its own, no cold Agent, and no second discovery pass. `remote.skills`
  // belongs to another package, so it stays an optional capability: a
  // composition without it keeps every other seat and simply omits this tab.
  ctx.inject(['slots', 'remote', 'remote.skills'], (scope) => {
    const scopedSlots = lookup<SlotsService>(scope, 'slots')
    if (scopedSlots === undefined) return
    const SessionSkillsTab = createSessionSkillsTab(createSessionSkillRuntime(scope))
    scope.effect(() => scopedSlots.inject('conversation.view', () => scopedSlots.register(
      { name: 'conversation.view', id: 'session-skills', order: 40, label: '技能' },
      SessionSkillsTab,
    )), 'session-skills: conversation view entry')
  })

  // The Session's instruction-file tab is registered by default: it answers
  // "which AGENTS.md chain does this Session actually read, and what is in
  // each layer", and the Host half owns discovery, reads, and writes. The tab
  // talks to the Host's same-origin route, so it needs nothing beyond the slot
  // registry; a composition without that route keeps every other seat and this
  // tab simply reports the route failure.
  const AgentInstructionsTab = createAgentInstructionsTab(createAgentInstructionsRuntime(ctx))
  ctx.effect(() => slots.inject('conversation.view', () => slots.register(
    { name: 'conversation.view', id: 'session-instructions', order: 50, label: '指令' },
    AgentInstructionsTab,
  )), 'session-instructions: conversation view entry')

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
    // conflict and still fails loud. The rule lives in `./sidebar-right` because
    // the Git right-column page follows the same one.
    const claimType = createTypeClaimer(sidebarRightTabs)

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
