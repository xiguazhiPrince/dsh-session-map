/**
 * The Git right-column page: resolves the Session's workspace, measures the
 * pane, keeps the per-Session preferences, and mounts the presentational
 * layout over the page state machine.
 *
 * The page is Session-scoped: DSH dispatches `sidebar.right.pane.tab` bodies
 * with the Session id they render for, so the workspace comes from that
 * Session's own workspace row — no workspace picker and no cross-Session
 * leakage.
 *
 * @module dsh-session-map/git-workspace/window/rightbar/page
 */
import * as React from 'react'
import type { GitWindowApi } from '../runtime'
import type { WorkspaceItemLike, WorkspaceSnapshotLike } from '../shell'
import { GitRightbarLayout } from './layout'
import { useGitRightbarModel } from './model'
import { readPrefs, writePrefs, type GitRightbarPrefs } from './prefs'

/** Props the slot injects into the page body. */
export interface GitRightbarPageProps {
  /** Session this right-column tab renders for. */
  readonly sessionId: string
  /** Framework hook over the Workspace list. */
  readonly useWorkspaces: <T>(selector: (state: WorkspaceSnapshotLike) => T) => T
  /** Optional framework hook naming this tab, used by the close control. */
  readonly useTabInfo?: () => { readonly tab: { readonly id: string; readonly kind: string } } | null
  /** Open the right column in its fullscreen presentation. */
  readonly openFullscreen: () => void
  /** Close this tab; the id is optional because the active tab may answer instead. */
  readonly closeTab: (tabId?: string) => void
}

/** The workspace a Session belongs to, and its display label. */
interface ResolvedWorkspace {
  readonly workspaceId: string | null
  readonly label: string
}

/**
 * Resolve the Session's workspace row.
 *
 * A Session belongs to exactly one Workspace (`items[].sessionIds`), which is
 * what the main panel already uses to pick its default. The first row is the
 * fallback for a Session the list does not know (for example a just-forked
 * Session whose row has not landed yet); a page with no row at all renders its
 * empty state.
 */
function resolveWorkspace(items: readonly WorkspaceItemLike[], sessionId: string): ResolvedWorkspace {
  const own = items.find(item => item.sessionIds.includes(sessionId))
  const chosen = own ?? items[0]
  if (chosen === undefined) return { workspaceId: null, label: '' }
  return { workspaceId: chosen.workspaceId, label: chosen.title || chosen.path }
}

/** Measure one element, reporting zero until the observer lands. */
function useElementSize(): {
  readonly ref: React.RefObject<HTMLDivElement | null>
  readonly size: { readonly width: number; readonly height: number }
} {
  const ref = React.useRef<HTMLDivElement | null>(null)
  // SSR has no ResizeObserver and never measures: render the wide layout so a
  // server-rendered snapshot shows the full page instead of the narrow variant.
  const fallback = typeof ResizeObserver === 'undefined'
  const [size, setSize] = React.useState({ width: fallback ? 1_200 : 0, height: fallback ? 800 : 0 })
  React.useEffect(() => {
    const element = ref.current
    if (element === null) return undefined
    const apply = (nextWidth: number, nextHeight: number): void => {
      if (nextWidth <= 0 || nextHeight <= 0) return
      setSize(current => current.width === nextWidth && current.height === nextHeight
        ? current
        : { width: nextWidth, height: nextHeight })
    }
    const rect = element.getBoundingClientRect()
    apply(rect.width, rect.height)
    if (typeof ResizeObserver === 'undefined') return undefined
    const observer = new ResizeObserver((entries) => {
      const entry = entries[0]
      if (entry === undefined) return
      apply(entry.contentRect.width, entry.contentRect.height)
    })
    observer.observe(element)
    return () => observer.disconnect()
  }, [])
  return { ref, size }
}

/** Build the page body over one Host runtime and the slot services. */
export function createGitRightbarPage(
  runtime: GitWindowApi,
): (props: GitRightbarPageProps) => React.ReactElement {
  return function GitRightbarPage(props: GitRightbarPageProps): React.ReactElement {
    const { ref, size } = useElementSize()
    const items = props.useWorkspaces(state => state.items)
    const resolved = resolveWorkspace(items, props.sessionId)

    // The tab hook is injected only when the right column hosts this body; the
    // read happens during render (hooks cannot be called from an event
    // handler), and a throw outside that context only drops the id.
    let tabId: string | undefined
    try {
      const info = typeof props.useTabInfo === 'function' ? props.useTabInfo() : null
      tabId = info?.tab?.id
    } catch {
      tabId = undefined
    }

    const [prefs, setPrefs] = React.useState<GitRightbarPrefs>(() => readPrefs(props.sessionId))
    React.useEffect(() => {
      setPrefs(readPrefs(props.sessionId))
    }, [props.sessionId])

    const updatePrefs = React.useCallback((next: GitRightbarPrefs): void => {
      setPrefs(next)
      writePrefs(props.sessionId, next)
    }, [props.sessionId])

    const model = useGitRightbarModel({
      runtime,
      workspaceId: resolved.workspaceId,
      width: size.width,
      prefs,
      onPrefs: updatePrefs,
    })

    const close = (): void => props.closeTab(tabId)

    return React.createElement(
      'div',
      { ref, style: { display: 'flex', flexDirection: 'column', height: '100%', minHeight: 0 } },
      React.createElement(GitRightbarLayout, {
        size,
        workspaceLabel: resolved.label,
        model,
        onFullscreen: props.openFullscreen,
        onClose: close,
      }),
    )
  }
}
