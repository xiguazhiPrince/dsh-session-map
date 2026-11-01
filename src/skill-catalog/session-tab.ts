/**
 * Browser half of the Session → Skills tab.
 *
 * The tab answers one narrow question: which skills can the Session I am
 * reading actually invoke? It does not rediscover anything. The product already
 * exposes a typed browser Remote, `remote.skills`, backed by the Host's
 * `sessionSkillCatalog` service, and that service resolves the Session's working
 * directory and Agent preset before asking the skill registry. Its answer is
 * therefore exactly the catalog the Session's `/name` menu sees, without
 * activating a cold Agent — the same read the composer's own skill source uses.
 *
 * This module owns presentation and the Remote call only. The wire-to-row rules
 * live in `./catalog`, and the row renderer plus stylesheet are shared with the
 * Settings page in `./client`.
 *
 * @module dsh-session-map/skill-catalog/session-tab
 */
import type { Context } from '@deepseek-ai/cordis'
import * as React from 'react'
import { errorText } from '../session-map/format'
import { lookup } from '../session-map/sidebar-right'
import {
  filterSessionSkillViews,
  sessionSkillViews,
  skillRootTabs,
  type SessionSkillEntryLike,
  type SkillView,
  type SkillRootTab,
} from './catalog'
import { formatTime, isAbortError, SKILL_CSS, SkillList } from './client'

/** Copy for the Session skills tab; the plugin is Chinese-first like its other seats. */
const COPY = {
  title: '生效技能',
  description: '当前会话的 Agent 预设与工作目录下可用的技能；技能名可以直接用 /名称 调用。',
  searchPlaceholder: '搜索名称、描述或路径',
  refresh: '刷新',
  refreshing: '读取中…',
  loading: '正在读取当前会话的技能…',
  section: '本会话可见',
  sectionHint: '按当前会话的工作目录与 Agent 预设筛选；只列用户可调用的技能',
  allRoots: '全部',
  rootTabsLabel: '按来源路径筛选',
  rootNoMatch: '这个路径下没有匹配的技能',
  empty: '当前会话没有可用的技能。把技能目录放到 ~/.dsh/skills/<名称>/SKILL.md 或当前项目的 .dsh/skills/<名称>/SKILL.md，然后刷新。',
  noMatch: '没有匹配的技能',
  staleFailure: '本次刷新失败，下面仍是上一次读到的结果。',
  retry: '重试',
  failurePrefix: '技能读取失败：',
  updatedPrefix: '更新于 ',
} as const

/** One typed Remote result, as the browser gateway returns it. */
type RemoteResult<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly error: { readonly code?: unknown; readonly message?: unknown } }

/** The typed Remote this tab reads; `remote.skills` is its Client service key. */
interface SessionSkillRemote {
  list(
    request: { readonly sessionId: string },
    signal: AbortSignal,
  ): Promise<RemoteResult<{ readonly skills?: readonly SessionSkillEntryLike[] }>>
}

/** Everything the tab needs from the running page. */
export interface SessionSkillRuntime {
  /**
   * List the user-invocable skills visible to one Session.
   * @param sessionId - the Session being read.
   * @param signal - caller lifetime; aborting releases the Remote call.
   * @returns the Host's entries, untouched.
   */
  list(sessionId: string, signal: AbortSignal): Promise<readonly SessionSkillEntryLike[]>
}

/**
 * Build the runtime over the running page.
 *
 * The service is resolved per call rather than captured, so a composition
 * without `remote.skills` reports that plainly instead of failing at apply time.
 * @param ctx - the browser context that injected `remote.skills`.
 * @returns the runtime the tab component calls.
 */
export function createSessionSkillRuntime(ctx: Context): SessionSkillRuntime {
  return {
    async list(sessionId: string, signal: AbortSignal): Promise<readonly SessionSkillEntryLike[]> {
      const remote = lookup<SessionSkillRemote>(ctx, 'remote.skills')
      if (remote === undefined) {
        throw new Error('技能服务不可用：当前组合没有挂载 remote.skills')
      }
      const result = await remote.list({ sessionId }, signal)
      if (!result.ok) {
        const code = typeof result.error?.code === 'string' ? result.error.code : 'internal'
        const message = typeof result.error?.message === 'string' ? result.error.message : '技能读取失败'
        throw new Error(`${code}: ${message}`)
      }
      const skills = result.value?.skills
      return Array.isArray(skills) ? skills : []
    },
  }
}

/** Props the Conversation slot hands one View. */
export interface SessionSkillsProps {
  /** Session this seat is drawing. */
  readonly sessionId: string
}

/** Props of the pure tab body. */
export interface SessionSkillsPageProps {
  /** Session this seat is drawing. */
  readonly sessionId: string
  /** Successfully read skills, already stamped into the shared row shape. */
  readonly skills: readonly SkillView[]
  /** Current search text. */
  readonly query: string
  /** Replace the search text. */
  readonly onQueryChange: (next: string) => void
  /** Selected discovery-root filter, or `null` for the `全部` tab. */
  readonly rootFilter: string | null
  /** Replace the discovery-root filter; `null` selects `全部`. */
  readonly onRootFilterChange: (next: string | null) => void
  /** Ask the Host for a fresh read. */
  readonly onRefresh: () => void
  /** Whether a read is in flight. */
  readonly refreshing: boolean
  /** ISO time of the last successful read, when known. */
  readonly updatedAt: string | null
  /** Failure of the last read when an older list is still shown. */
  readonly staleFailure: string | null
}

/** The page header, shared by the loaded, loading, and failed states. */
function pageHead(): React.ReactElement {
  return React.createElement(
    'header',
    { className: 'sk-head' },
    React.createElement('h1', { className: 'sk-title' }, COPY.title),
    React.createElement('p', { className: 'sk-desc sk-headDesc' }, COPY.description),
  )
}

/** The two stylesheets one tab mount owns: the shared rows and the tab frame. */
function styles(): React.ReactElement[] {
  return [
    React.createElement('style', { key: 'rows' }, SKILL_CSS),
    React.createElement('style', { key: 'tab' }, TAB_CSS),
  ]
}

/**
 * One discovery-root filter tab: `全部` first, then one cell per root present in
 * the Session, each carrying its post-search count.
 * @param tabs - the roots present in the Session, in display order.
 * @param matchingByRoot - post-search count per root.
 * @param totalMatching - post-search count across every root.
 * @param activeRoot - selected root, or `null` for `全部`.
 * @param onSelect - switches the filter.
 * @returns the tab row.
 */
function rootTabRow(
  tabs: readonly SkillRootTab[],
  matchingByRoot: ReadonlyMap<string, number>,
  totalMatching: number,
  activeRoot: string | null,
  onSelect: (root: string | null) => void,
): React.ReactElement {
  return React.createElement(
    'div',
    { className: 'sk-rootTabs', role: 'group', 'aria-label': COPY.rootTabsLabel },
    React.createElement(
      'button',
      {
        key: 'all',
        type: 'button',
        className: 'sk-rootTab',
        'data-active': activeRoot === null ? 'true' : 'false',
        'aria-pressed': activeRoot === null,
        onClick: () => { onSelect(null) },
      },
      COPY.allRoots,
      React.createElement('span', { className: 'sk-rootTabCount' }, String(totalMatching)),
    ),
    ...tabs.map(tab => React.createElement(
      'button',
      {
        key: tab.root,
        type: 'button',
        className: 'sk-rootTab',
        title: tab.root,
        'data-active': activeRoot === tab.root ? 'true' : 'false',
        'aria-pressed': activeRoot === tab.root,
        onClick: () => { onSelect(tab.root) },
      },
      tab.root,
      React.createElement('span', { className: 'sk-rootTabCount' }, String(matchingByRoot.get(tab.root) ?? 0)),
    )),
  )
}

/**
 * The loaded body: header, search toolbar, the identity filters, the session's
 * skill list, and the Session identity in the footer.
 * @param props - the loaded catalog, search/root state, and refresh state.
 * @returns the tab element.
 */
export function SessionSkillsPage(props: SessionSkillsPageProps): React.ReactElement {
  const {
    sessionId,
    skills,
    query,
    onQueryChange,
    rootFilter,
    onRootFilterChange,
    onRefresh,
    refreshing,
    updatedAt,
    staleFailure,
  } = props
  const queried = filterSessionSkillViews(skills, query)
  const tabs = skillRootTabs(skills)
  // A filter left over from an older read falls back to 全部 instead of hiding
  // every row behind a root this Session no longer has.
  const activeRoot = rootFilter !== null && tabs.some(tab => tab.root === rootFilter) ? rootFilter : null
  const matchingByRoot = new Map<string, number>()
  for (const view of queried) matchingByRoot.set(view.rootLabel, (matchingByRoot.get(view.rootLabel) ?? 0) + 1)
  const visible = activeRoot === null ? queried : queried.filter(view => view.rootLabel === activeRoot)
  const updated = formatTime(updatedAt)
  const queryActive = query.trim() !== ''
  const sectionBody = skills.length === 0
    ? queryActive
      ? null
      : React.createElement('div', { className: 'sk-empty' }, COPY.empty)
    : React.createElement(
      React.Fragment,
      null,
      rootTabRow(tabs, matchingByRoot, queried.length, activeRoot, onRootFilterChange),
      visible.length > 0
        ? React.createElement(SkillList, { skills: visible })
        : queried.length === 0
          ? null
          : React.createElement(
            'div',
            { className: 'sk-empty' },
            queryActive ? `${COPY.rootNoMatch}：${query.trim()}` : COPY.rootNoMatch,
          ),
    )
  return React.createElement(
    'div',
    { className: 'sk-page sk-sessionPage' },
    ...styles(),
    React.createElement(
      'div',
      { className: 'sk-inner' },
      pageHead(),
      React.createElement(
        'div',
        { className: 'sk-toolbar' },
        React.createElement('input', {
          className: 'sk-search',
          type: 'search',
          value: query,
          placeholder: COPY.searchPlaceholder,
          'aria-label': COPY.searchPlaceholder,
          spellCheck: false,
          onChange: (event: React.ChangeEvent<HTMLInputElement>) => { onQueryChange(event.currentTarget.value) },
        }),
        React.createElement(
          'button',
          {
            type: 'button',
            className: 'sk-btn',
            onClick: onRefresh,
            disabled: refreshing,
          },
          refreshing ? COPY.refreshing : COPY.refresh,
        ),
        updated === null
          ? null
          : React.createElement('span', { className: 'sk-updated' }, COPY.updatedPrefix + updated),
      ),
      staleFailure === null
        ? null
        : React.createElement(
          'div',
          { className: 'sk-status sk-status--warn', role: 'status' },
          React.createElement('div', { className: 'sk-statusTitle' }, COPY.staleFailure),
          React.createElement('div', { className: 'sk-statusPath' }, staleFailure),
        ),
      // A search that matches nothing anywhere; a search filtered out by one
      // root tab is reported inside that tab's section instead.
      queryActive && queried.length === 0
        ? React.createElement('div', { className: 'sk-empty' }, `${COPY.noMatch}：${query.trim()}`)
        : null,
      React.createElement(
        'section',
        { className: 'sk-section' },
        React.createElement(
          'div',
          { className: 'sk-sectionHead' },
          React.createElement('h2', { className: 'sk-sectionTitle' }, COPY.section),
          React.createElement('span', { className: 'sk-count' }, String(visible.length)),
          React.createElement('span', { className: 'sk-sectionHint' }, COPY.sectionHint),
        ),
        sectionBody,
      ),
      React.createElement(
        'div',
        { className: 'sk-sessionFoot' },
        `会话 ${sessionId} · 共 ${skills.length} 个技能`,
      ),
    ),
  )
}

/**
 * Build the Conversation tab body: fetch on mount and on Session switch,
 * refetch on demand, and render the pure page once the Remote has answered.
 * @param runtime - the Host Remote and the page's lifetime helpers.
 * @returns the registered View component.
 */
export function createSessionSkillsTab(
  runtime: SessionSkillRuntime,
): (props: SessionSkillsProps) => React.ReactElement {
  function SessionSkillsTab(props: SessionSkillsProps): React.ReactElement {
    const { sessionId } = props
    const [state, setState] = React.useState<readonly SkillView[] | null>(null)
    const [failure, setFailure] = React.useState<string | null>(null)
    const [staleFailure, setStaleFailure] = React.useState<string | null>(null)
    const [query, setQuery] = React.useState('')
    const [rootFilter, setRootFilter] = React.useState<string | null>(null)
    const [refreshing, setRefreshing] = React.useState(false)
    const [updatedAt, setUpdatedAt] = React.useState<string | null>(null)
    // One request at a time; switching Sessions or unmounting aborts it.
    const inFlight = React.useRef<AbortController | null>(null)
    // Whether a list has ever been shown; only then does a failure become a
    // stale-data banner instead of a page-level error.
    const hasData = React.useRef(false)

    const read = React.useCallback(async (): Promise<void> => {
      inFlight.current?.abort()
      const controller = new AbortController()
      inFlight.current = controller
      setRefreshing(true)
      try {
        const entries = await runtime.list(sessionId, controller.signal)
        if (controller.signal.aborted) return
        hasData.current = true
        setState(sessionSkillViews(entries))
        setFailure(null)
        setStaleFailure(null)
        setUpdatedAt(new Date().toISOString())
      } catch (error) {
        // A Session switch or unmount aborts the request; its failure belongs to
        // no mounted tab and must not overwrite the next read's state.
        if (controller.signal.aborted || isAbortError(error)) return
        const message = COPY.failurePrefix + errorText(error)
        if (hasData.current) setStaleFailure(message)
        else setFailure(message)
      } finally {
        if (inFlight.current === controller) {
          inFlight.current = null
          setRefreshing(false)
        }
      }
    }, [runtime, sessionId])

    React.useEffect(() => {
      // A different Session gets its own read: the previous Session's rows,
      // search text, and root filter must not linger while the new answer is on
      // its way.
      hasData.current = false
      setState(null)
      setFailure(null)
      setStaleFailure(null)
      setUpdatedAt(null)
      setQuery('')
      setRootFilter(null)
      void read()
      return () => { inFlight.current?.abort() }
    }, [read])

    if (state === null) {
      return React.createElement(
        'div',
        { className: 'sk-page sk-sessionPage' },
        ...styles(),
        React.createElement(
          'div',
          { className: 'sk-inner' },
          pageHead(),
          failure === null
            ? React.createElement('div', { className: 'sk-loading', role: 'status' }, COPY.loading)
            : React.createElement(
              'div',
              { className: 'sk-status sk-status--error', role: 'alert' },
              React.createElement('div', { className: 'sk-statusTitle' }, failure),
              React.createElement(
                'div',
                { className: 'sk-statusActions' },
                React.createElement(
                  'button',
                  { type: 'button', className: 'sk-btn', onClick: () => { void read() } },
                  COPY.retry,
                ),
              ),
            ),
        ),
      )
    }

    return React.createElement(SessionSkillsPage, {
      sessionId,
      skills: state,
      query,
      onQueryChange: setQuery,
      rootFilter,
      onRootFilterChange: setRootFilter,
      onRefresh: () => { void read() },
      refreshing,
      updatedAt,
      staleFailure,
    })
  }
  return SessionSkillsTab
}

/** Tab-frame rules on top of the shared Skills sheet. */
const TAB_CSS = `
.sk-sessionPage { padding: 24px 28px 32px; }
.sk-sessionPage .sk-inner { max-width: 780px; }
.sk-rootTabs { display: flex; flex-wrap: wrap; align-items: center; gap: 6px; }
.sk-rootTab { display: inline-flex; align-items: center; gap: 6px; padding: 4px 10px; border: 0.5px solid var(--dsw-alias-border-l1); border-radius: 999px; background: none; color: var(--dsw-alias-label-secondary); font: inherit; font-size: 12px; line-height: 1.5; cursor: pointer; }
.sk-rootTab:hover { border-color: var(--dsw-alias-border-l2); color: var(--dsw-alias-label-primary); }
.sk-rootTab:focus-visible { outline: 2px solid var(--dsw-alias-brand-primary); outline-offset: 1px; }
.sk-rootTab[data-active="true"] { border-color: var(--dsw-alias-brand-primary); background: var(--dsw-alias-bg-layer-2); color: var(--dsw-alias-label-primary); }
.sk-rootTabCount { color: var(--dsw-alias-label-secondary); font-size: 11px; }
.sk-rootTab[data-active="true"] .sk-rootTabCount { color: var(--dsw-alias-brand-primary); }
.sk-sessionFoot { color: var(--dsw-alias-label-secondary); font-size: 12px; word-break: break-all; }
`
