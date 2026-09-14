/**
 * Browser half: the Session map plugin.
 *
 * Contributes three bodies and two right-sidebar tab types: a plain overview as
 * a Conversation tab and as a right-column tab, a fork-tree canvas as a
 * Conversation tab, a right-column tab, and a Session header launcher.
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
import { CSS } from './css'
import { MAP_KIND, MAP_TYPE_ID, OVERVIEW_KIND, OVERVIEW_TYPE_ID } from './constants'
import { createFlag } from './flags'
import {
  createMapLauncher,
  createMapView,
  createOverviewTab,
  SidebarOverviewBody,
  type MapFlags,
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
  const showPromptsFlag = createFlag(false)
  const hideSubagentsFlag = createFlag(true)
  // Per-line overrides. Two sets, each recording one user gesture in the mode
  // it was made in, so flipping the global switch restores rather than
  // inverts what the other mode had.
  const openedLinesFlag = createFlag(new Set<string>())
  const collapsedLinesFlag = createFlag(new Set<string>())
  // Session ids whose inherited turn prefix is expanded rather than folded.
  const expandedInheritedFlag = createFlag(new Set<string>())

  const flags: MapFlags = {
    showPrompts: showPromptsFlag,
    hideSubagents: hideSubagentsFlag,
    openedLines: openedLinesFlag,
    collapsedLines: collapsedLinesFlag,
    expandedInherited: expandedInheritedFlag,
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
  }

  const MapLauncher = createMapLauncher(runtime)
  const OverviewTab = createOverviewTab(runtime)
  const SessionMapTab = createMapView(runtime, flags, true)
  const SidebarMapBody = createMapView(runtime, flags, false)

  ctx.effect(() => slots.inject('conversation.session.header.utilities', () => slots.register(
    { name: 'conversation.session.header.utilities', id: 'session-map-launcher', order: 40 },
    MapLauncher,
  )), 'session-map: header launcher')

  ctx.effect(() => slots.inject('conversation.view', () => slots.register(
    { name: 'conversation.view', id: 'session-overview', order: 20, label: '概览' },
    OverviewTab,
  )), 'session-overview: conversation view entry')

  ctx.effect(() => slots.inject('conversation.view', () => slots.register(
    { name: 'conversation.view', id: 'session-map', order: 30, label: '会话图谱' },
    SessionMapTab,
  )), 'session-map: conversation view entry')

  const sidebarRightTabs = lookup<SidebarRightTabsService>(ctx, 'sidebarRightTabs')
  if (sidebarRightTabs === undefined) return

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
  ctx.effect(() => slots.inject('sidebar.right.pane.tab', () => slots.register(
    { name: 'sidebar.right.pane.tab', key: OVERVIEW_TYPE_ID },
    SidebarOverviewBody,
  )), 'session-overview: rightbar tab body')

  ctx.effect(
    claimType(
      MAP_TYPE_ID,
      MAP_KIND,
      () => '会话图谱',
      () => '会话图谱',
      () => '所有会话的 fork 树画布',
    ),
    'session-map: rightbar tab type',
  )
  ctx.effect(() => slots.inject('sidebar.right.pane.tab', () => slots.register(
    { name: 'sidebar.right.pane.tab', key: MAP_TYPE_ID },
    SidebarMapBody,
  )), 'session-map: rightbar tab body')
}
