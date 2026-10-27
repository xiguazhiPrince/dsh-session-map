/**
 * Registration of the Git right-column page: the tab type, its body, and the
 * Session-header launcher.
 *
 * The right column belongs to another package, so its tab-type registry is
 * waited on inside `ctx.inject` instead of read once at activation. Reading it
 * eagerly is exactly the failure that leaves a header button opening a kind
 * nothing registered: at a cold page load this plugin's body can activate
 * before the sidebar-right plugin has provided the service.
 *
 * @module dsh-session-map/git-workspace/window/rightbar/install
 */
import type { Context } from '@deepseek-ai/cordis'
import * as React from 'react'
import { createGitWindowRuntime } from '../runtime'
import {
  createTypeClaimer,
  lookup,
  type SidebarRightTabsService,
  type SlotsService,
} from '../../../session-map/sidebar-right'
import {
  GIT_RIGHTBAR_HEADER_ID,
  GIT_RIGHTBAR_HEADER_ORDER,
  GIT_RIGHTBAR_KIND,
  GIT_RIGHTBAR_TYPE_ID,
} from './ids'
import { createGitRightbarPage, type GitRightbarPageProps } from './page'

/** Panel navigation, as far as the page's fullscreen control needs it. */
interface LayoutService {
  openRightbar?(track: boolean, fullscreen: boolean): void
}

/** The right column's navigation operations this module calls. */
interface SidebarRightFace {
  openTab(kind: string): void
  active(): { readonly id: string; readonly kind: string } | undefined
  close(tabId: string): void
}

/** Normalize one thrown value into display text. */
function errorText(cause: unknown): string {
  if (cause instanceof Error) return cause.message
  return String(cause)
}

/**
 * Build the Session-header launcher: a real button that toggles the page.
 *
 * A rejected toggle used to reach only the console, which reads as a dead
 * button; the reason is shown beside it instead. The button reuses the Session
 * map launcher's classes, which the always-loaded plugin stylesheet owns.
 * @param ctx - browser root context carrying the service lookup.
 * @returns the registered header utility component.
 */
function createGitLauncher(ctx: Context): () => React.ReactElement {
  function GitLauncher(): React.ReactElement {
    const [error, setError] = React.useState<string | null>(null)
    const onClick = (): void => {
      try {
        const face = lookup<SidebarRightFace>(ctx, 'sidebarRight')
        if (face === undefined) throw new Error('右侧栏服务 sidebarRight 不可用')
        const active = face.active()
        if (active !== undefined && active.kind === GIT_RIGHTBAR_KIND) {
          face.close(active.id)
          setError(null)
          return
        }
        face.openTab(GIT_RIGHTBAR_KIND)
        setError(null)
      } catch (cause) {
        const message = errorText(cause)
        // console.error lines are mirrored into this Run's diagnostics.
        console.error('Git 右侧栏：切换失败', message)
        setError(message)
      }
    }
    return React.createElement(
      'span',
      { className: 'dsm-launchWrap' },
      React.createElement(
        'button',
        {
          type: 'button',
          className: 'dsm-launch',
          title: '在右侧栏打开或关闭 Git',
          onClick,
        },
        'Git',
      ),
      error === null ? null : React.createElement('span', { className: 'dsm__error' }, error),
    )
  }
  return GitLauncher
}

/**
 * Register the Git right-column page, its tab type and the header launcher.
 * @param ctx - browser root context carrying the slot registry.
 */
export function installGitRightbarPage(ctx: Context): void {
  const slots = lookup<SlotsService>(ctx, 'slots')
  if (slots === undefined) return

  const runtime = createGitWindowRuntime()

  const openFullscreen = (): void => {
    const layout = lookup<LayoutService>(ctx, 'layout')
    layout?.openRightbar?.(true, true)
  }
  const closeTab = (tabId?: string): void => {
    const face = lookup<SidebarRightFace>(ctx, 'sidebarRight')
    if (face === undefined) return
    const active = face.active()
    const id = tabId ?? (active !== undefined && active.kind === GIT_RIGHTBAR_KIND ? active.id : undefined)
    if (id !== undefined) face.close(id)
  }

  const Page = createGitRightbarPage(runtime)
  const Body = (props: GitRightbarPageProps): React.ReactElement =>
    React.createElement(Page, { ...props, openFullscreen, closeTab })

  // The body depends on no right-column service: register it as soon as the
  // host declares the keyed slot.
  ctx.effect(() => slots.inject('sidebar.right.pane.tab', () => slots.register(
    { name: 'sidebar.right.pane.tab', key: GIT_RIGHTBAR_TYPE_ID },
    Body,
  )), 'git-window: rightbar tab body')

  // The type and its guide entry wait for the native registry.
  ctx.inject(['slots', 'sidebarRightTabs'], (scope) => {
    const scopedSlots = lookup<SlotsService>(scope, 'slots')
    const tabs = lookup<SidebarRightTabsService>(scope, 'sidebarRightTabs')
    if (scopedSlots === undefined || tabs === undefined) return
    const claim = createTypeClaimer(tabs)
    scope.effect(
      claim(
        GIT_RIGHTBAR_TYPE_ID,
        GIT_RIGHTBAR_KIND,
        () => 'Git',
        () => 'Git',
        () => '提交、差异与提交日志',
      ),
      'git-window: rightbar tab type',
    )
  })

  // The Session-header launcher, in flow next to the host's own utilities.
  ctx.effect(() => slots.inject('conversation.session.header.utilities', () => slots.register(
    {
      name: 'conversation.session.header.utilities',
      id: GIT_RIGHTBAR_HEADER_ID,
      order: GIT_RIGHTBAR_HEADER_ORDER,
      label: () => 'Git',
    },
    createGitLauncher(ctx),
  )), 'git-window: header launcher')
}
