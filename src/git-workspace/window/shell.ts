/**
 * The Git tool window shell: workspace picker, tabs, polling, selection and the
 * three panes. It is a `main` panel component, so it receives the framework's
 * `useWorkspaces` / `useSessions` hooks as props and has no session of its own.
 *
 * The shell is a factory over a {@link GitWindowApi} so the SSR smoke test can
 * render it with fixtures instead of the network.
 *
 * @module dsh-session-map/git-workspace/window/shell
 */
import * as React from 'react'
import type { CommandReceipt, CommitDetail, DiffView, GitJobView, HeadState, RepoSnapshot, BranchRef } from '../git-types'
import type { GitAction } from '../git-actions'
import { parseUnifiedDiff } from '../git-parse'
import { computeGraph } from './lanes'
import { BranchTree, DetailPane, LogList, formatWhen } from './log'
import { BranchDialog, type BranchPrompt } from './branch'
import { CommitPane } from './commit'
import { ConsolePane } from './console'
import { CSS } from './css'
import { GitPanelIcon, FetchIcon, PushIcon, RefreshIcon } from './icons'
import {
  GitApiError,
  describeGitError,
  isAbortError,
  type DiffResult,
  type GitWindowApi,
  type LogRequest,
} from './runtime'

/** Browser-local key remembering the panel is open across reloads. */
export const PANEL_OPEN_KEY = 'dsh.git-window.panelOpen'
/** Browser-local key remembering the last workspace. */
export const WORKSPACE_KEY = 'dsh.git-window.workspaceId'
/** Browser-local key remembering the active tab. */
export const TAB_KEY = 'dsh.git-window.tab'

/** The Workspace row fields this panel reads. */
export interface WorkspaceItemLike {
  readonly workspaceId: string
  readonly title: string
  readonly path: string
  readonly sessionIds: readonly string[]
}

/** The Workspace snapshot shape the framework hook exposes. */
export interface WorkspaceSnapshotLike {
  readonly items: readonly WorkspaceItemLike[]
}

/** The Session snapshot fields this panel reads. */
export interface SessionsSnapshotLike {
  readonly current?: string | undefined
}

/** Props the slot injects into a main-panel component. */
export interface GitPanelProps {
  readonly useWorkspaces: <T>(selector: (state: WorkspaceSnapshotLike) => T) => T
  readonly useSessions: <T>(selector: (state: SessionsSnapshotLike) => T) => T
}

/** Read one browser-local string. */
function readStored(key: string): string | null {
  if (typeof localStorage === 'undefined') return null
  try {
    return localStorage.getItem(key)
  } catch {
    return null
  }
}

/** Write one browser-local string; denial is not an error. */
function writeStored(key: string, value: string): void {
  if (typeof localStorage === 'undefined') return
  try {
    localStorage.setItem(key, value)
  } catch {
    // Storage can be denied (private mode, blocked site data); the panel still works.
  }
}

/** Normalize one unknown failure into the API error shape. */
function toApiError(error: unknown): GitApiError {
  if (error instanceof GitApiError) return error
  return new GitApiError('internal', error instanceof Error ? error.message : String(error))
}
/** Stable selector for the Workspace rows. */
function selectItems(state: WorkspaceSnapshotLike): readonly WorkspaceItemLike[] {
  return state.items
}

/** Stable selector for the current Session id. */
function selectCurrent(state: SessionsSnapshotLike): string | undefined {
  return state.current
}

/** Every command receipt the console keeps. */
const MAX_CONSOLE_ROWS = 300

/** Poll interval while the tab is visible and focused. */
const POLL_VISIBLE_MS = 3_000
/** Poll interval after the panel has been hidden for a while. */
const POLL_HIDDEN_MS = 10_000

/** Render one inline error banner. */
function ErrorBanner(props: { readonly error: GitApiError | null; readonly onRetry: () => void }): React.ReactElement | null {
  if (props.error === null) return null
  return React.createElement(
    'div',
    { className: 'dgw-error', role: 'alert' },
    React.createElement('div', { className: 'dgw-errorText' },
      describeGitError(props.error.code, props.error.message),
      props.error.detail === undefined
        ? null
        : React.createElement('pre', { className: 'dgw-errorDetail' }, props.error.detail),
    ),
    React.createElement('button', { className: 'dgw-retry', type: 'button', onClick: props.onRetry }, '重试'),
  )
}

/** Render the empty state for a workspace that has no git repository. */
function NoRepo(props: { readonly onRetry: () => void }): React.ReactElement {
  return React.createElement(
    'div',
    { className: 'dgw-empty' },
    React.createElement('div', { className: 'dgw-emptyBox' },
      React.createElement('div', null, '当前工作区不是 git 仓库'),
      React.createElement('div', null, '请在工作中选择另一个目录，或先在此目录初始化 git。'),
      React.createElement('button', { className: 'dgw-retry', type: 'button', onClick: props.onRetry }, '重新检测'),
    ),
  )
}

/** One log page held by the shell. */
interface LogState {
  readonly commits: readonly import('../git-types').CommitRow[]
  readonly hasMore: boolean
}

/** Build the panel component over one runtime. */
export function createGitPanel(runtime: GitWindowApi): (props: GitPanelProps) => React.ReactElement {
  return function GitPanel(props: GitPanelProps): React.ReactElement {
    const useWorkspaces = props.useWorkspaces
    const useSessions = props.useSessions
    const items = typeof useWorkspaces === 'function' ? useWorkspaces(selectItems) : []
    const current = typeof useSessions === 'function' ? useSessions(selectCurrent) : undefined

    const [choice, setChoice] = React.useState<string | null>(() => readStored(WORKSPACE_KEY))
    const [tab, setTab] = React.useState<'commit' | 'log' | 'console'>(() => {
      const stored = readStored(TAB_KEY)
      return stored === 'console' || stored === 'commit' ? stored : 'log'
    })
    const [refreshKey, setRefreshKey] = React.useState(0)
    const [snapshot, setSnapshot] = React.useState<RepoSnapshot | null>(null)
    const [snapshotError, setSnapshotError] = React.useState<GitApiError | null>(null)
    const [snapshotLoading, setSnapshotLoading] = React.useState(false)
    const [branchFilter, setBranchFilter] = React.useState<string | null>(null)
    const [queryInput, setQueryInput] = React.useState('')
    const [query, setQuery] = React.useState('')
    const [log, setLog] = React.useState<LogState>({ commits: [], hasMore: false })
    const [logLoading, setLogLoading] = React.useState(false)
    const [logLoadingMore, setLogLoadingMore] = React.useState(false)
    const [logError, setLogError] = React.useState<GitApiError | null>(null)
    const [selectedHash, setSelectedHash] = React.useState<string | null>(null)
    const [detail, setDetail] = React.useState<CommitDetail | null>(null)
    const [detailLoading, setDetailLoading] = React.useState(false)
    const [detailError, setDetailError] = React.useState<GitApiError | null>(null)
    const [selectedFile, setSelectedFile] = React.useState<string | null>(null)
    const [diff, setDiff] = React.useState<DiffView | null>(null)
    const [diffLoading, setDiffLoading] = React.useState(false)
    const [diffError, setDiffError] = React.useState<GitApiError | null>(null)
    const [commands, setCommands] = React.useState<readonly CommandReceipt[]>([])
    const [actionError, setActionError] = React.useState<GitApiError | null>(null)
    const [branchPrompt, setBranchPrompt] = React.useState<BranchPrompt | null>(null)
    const [branchValue, setBranchValue] = React.useState('')
    const [branchForce, setBranchForce] = React.useState(false)
    const [branchBusy, setBranchBusy] = React.useState(false)
    const [branchError, setBranchError] = React.useState<GitApiError | null>(null)
    const [job, setJob] = React.useState<GitJobView | null>(null)
    const [jobBusy, setJobBusy] = React.useState(false)

    const remembered = readStored(WORKSPACE_KEY)
    const candidate = items.find(item => item.workspaceId === choice)
      ?? items.find(item => item.workspaceId === remembered)
      ?? items.find(item => current !== undefined && item.sessionIds.includes(current))
      ?? items[0]
    const workspaceId = candidate?.workspaceId ?? null

    const appendCommands = React.useCallback((incoming: readonly CommandReceipt[]): void => {
      if (incoming.length === 0) return
      setCommands(previous => [...previous, ...incoming].slice(-MAX_CONSOLE_ROWS))
    }, [])

    const retry = React.useCallback((): void => {
      setSnapshotError(null)
      setLogError(null)
      setDetailError(null)
      setDiffError(null)
      setActionError(null)
      setBranchError(null)
      setRefreshKey(key => key + 1)
    }, [])

    /** Check out one local branch and refresh both history views. */
    const checkoutBranch = async (ref: string): Promise<void> => {
      if (workspaceId === null || branchBusy) return
      setBranchBusy(true)
      setActionError(null)
      try {
        await runtime.action({ kind: 'checkout', workspaceId, ref })
        setBranchFilter(null)
        setSelectedHash(null)
        setRefreshKey(key => key + 1)
      } catch (error) {
        setActionError(toApiError(error))
      } finally {
        setBranchBusy(false)
      }
    }

    const openBranchDialog = (prompt: BranchPrompt, initial: string): void => {
      setBranchPrompt(prompt)
      setBranchValue(initial)
      setBranchForce(false)
      setBranchError(null)
    }

    /** Run the dialog's create/rename/delete round-trip. */
    const submitBranchDialog = async (): Promise<void> => {
      if (workspaceId === null || branchPrompt === null || branchBusy) return
      const name = branchValue.trim()
      if (branchPrompt.kind !== 'delete' && name === '') return
      setBranchBusy(true)
      setBranchError(null)
      try {
        if (branchPrompt.kind === 'create') {
          await runtime.action({
            kind: 'createBranch',
            workspaceId,
            name,
            ...(branchPrompt.start === undefined ? {} : { start: branchPrompt.start }),
          })
        } else if (branchPrompt.kind === 'rename') {
          await runtime.action({
            kind: 'renameBranch',
            workspaceId,
            from: branchPrompt.branch ?? '',
            to: name,
          })
        } else {
          const action = {
            kind: 'deleteBranch',
            workspaceId,
            name: branchPrompt.branch ?? '',
            force: branchForce,
          } as const
          const confirmation = await runtime.confirm(action)
          await runtime.action(action, confirmation.token)
        }
        setBranchPrompt(null)
        setBranchFilter(null)
        setSelectedHash(null)
        setRefreshKey(key => key + 1)
      } catch (error) {
        setBranchError(toApiError(error))
      } finally {
        setBranchBusy(false)
      }
    }

    /** Chinese label for one job kind. */
    const jobLabel = (kind: string): string => {
      switch (kind) {
        case 'fetch': return '获取'
        case 'update': return '更新'
        case 'push': return '推送'
        default: return kind
      }
    }

    /** Follow one job through SSE, falling back to polling when the stream fails. */
    const watchJob = (id: string): void => {
      let stopped = false
      let source: EventSource | undefined
      const finish = (view: GitJobView): void => {
        if (stopped) return
        setJob(view)
        if (view.status === 'running') return
        stopped = true
        source?.close()
        setJobBusy(false)
        if (view.status === 'failed' && view.error !== undefined) {
          setActionError(new GitApiError(view.error.code, view.error.message, view.error.detail))
        }
        setRefreshKey(key => key + 1)
      }
      const poll = async (): Promise<void> => {
        if (stopped) return
        try {
          const view = await runtime.job(id)
          finish(view)
          if (!stopped) setTimeout(() => { void poll() }, 700)
        } catch (error) {
          if (stopped) return
          setActionError(toApiError(error))
          setJobBusy(false)
        }
      }
      if (typeof EventSource === 'undefined') {
        void poll()
        return
      }
      source = new EventSource(`/plugin-git-workspace/events?job=${encodeURIComponent(id)}`)
      source.onmessage = (event: MessageEvent) => {
        try {
          finish(JSON.parse(String(event.data)) as GitJobView)
        } catch {
          // Ignore a malformed frame; polling is the fallback.
        }
      }
      source.onerror = () => {
        source?.close()
        source = undefined
        void poll()
      }
    }

    /** Start one long action and follow its job. */
    const runJob = async (action: GitAction): Promise<void> => {
      if (workspaceId === null || jobBusy) return
      setJobBusy(true)
      setActionError(null)
      try {
        const result = await runtime.action(action)
        if (result.job === undefined) {
          setJobBusy(false)
          setRefreshKey(key => key + 1)
          return
        }
        watchJob(result.job.id)
      } catch (error) {
        setActionError(toApiError(error))
        setJobBusy(false)
      }
    }

    /** Push the current branch, defining its upstream on first use. */
    const pushCurrent = (): void => {
      if (workspaceId === null || snapshot === null) return
      const branch = snapshot.head.branch
      if (branch === null) {
        setActionError(new GitApiError('detached-head', 'HEAD is detached'))
        return
      }
      const remote = snapshot.remotes[0]?.name
      const needsUpstream = snapshot.head.upstream === null
      if (needsUpstream && remote === undefined) {
        setActionError(new GitApiError('no-upstream', 'no remote is configured'))
        return
      }
      void runJob({
        kind: 'push',
        workspaceId,
        ...(needsUpstream && remote !== undefined ? { remote, branch, setUpstream: true } : {}),
      })
    }

    // Remember that the panel was open so the next page load can restore it;
    // clearing on unmount is what "closed" means for the sidebar.
    React.useEffect(() => {
      writeStored(PANEL_OPEN_KEY, 'true')
      return () => { writeStored(PANEL_OPEN_KEY, 'false') }
    }, [])

    React.useEffect(() => {
      writeStored(TAB_KEY, tab)
    }, [tab])

    // Snapshot polling. The request carries its own AbortController so a
    // workspace switch or unmount cannot land an old answer on the new view.
    React.useEffect(() => {
      if (workspaceId === null) {
        setSnapshot(null)
        setSnapshotLoading(false)
        return undefined
      }
      let stopped = false
      const controller = new AbortController()
      let timer: ReturnType<typeof setTimeout> | undefined
      setSnapshotLoading(true)
      const tick = async (): Promise<void> => {
        try {
          const result = await runtime.snapshot(workspaceId, controller.signal)
          if (stopped) return
          setSnapshot(result.snapshot)
          setSnapshotError(null)
          appendCommands(result.commands)
        } catch (error) {
          if (stopped || isAbortError(error)) return
          setSnapshotError(toApiError(error))
        } finally {
          if (stopped) return
          setSnapshotLoading(false)
          timer = setTimeout(tick, document.visibilityState === 'hidden' ? POLL_HIDDEN_MS : POLL_VISIBLE_MS)
        }
      }
      void tick()
      const onVisibility = (): void => {
        if (document.visibilityState !== 'visible') return
        if (timer !== undefined) clearTimeout(timer)
        void tick()
      }
      document.addEventListener('visibilitychange', onVisibility)
      return () => {
        stopped = true
        controller.abort()
        if (timer !== undefined) clearTimeout(timer)
        document.removeEventListener('visibilitychange', onVisibility)
      }
    }, [workspaceId, refreshKey, appendCommands])

    // Debounce the search box so typing does not spawn one git process per key.
    React.useEffect(() => {
      const timer = setTimeout(() => setQuery(queryInput.trim()), 300)
      return () => clearTimeout(timer)
    }, [queryInput])

    // Log page. A filter change invalidates the selection because the selected
    // commit may no longer be in the list.
    React.useEffect(() => {
      if (workspaceId === null) {
        setLog({ commits: [], hasMore: false })
        return undefined
      }
      let stopped = false
      const controller = new AbortController()
      setLogLoading(true)
      setSelectedHash(null)
      setDetail(null)
      setSelectedFile(null)
      setDiff(null)
      const request: LogRequest = {
        workspaceId,
        limit: 50,
        ...(branchFilter === null ? {} : { ref: branchFilter }),
        ...(query === '' ? {} : { query }),
      }
      runtime.log(request, controller.signal).then((page) => {
        if (stopped) return
        setLog({ commits: page.commits, hasMore: page.hasMore })
        setLogError(null)
        appendCommands(page.commands)
      }).catch((error: unknown) => {
        if (stopped || isAbortError(error)) return
        setLogError(toApiError(error))
      }).finally(() => {
        if (!stopped) setLogLoading(false)
      })
      return () => {
        stopped = true
        controller.abort()
      }
    }, [workspaceId, branchFilter, query, refreshKey, appendCommands])

    // Commit detail.
    React.useEffect(() => {
      setSelectedFile(null)
      setDiff(null)
      if (workspaceId === null || selectedHash === null) {
        setDetail(null)
        return undefined
      }
      let stopped = false
      const controller = new AbortController()
      setDetailLoading(true)
      runtime.commit(workspaceId, selectedHash, controller.signal).then((result) => {
        if (stopped) return
        setDetail(result.commit)
        setDetailError(null)
        appendCommands(result.commands)
        const first = result.commit.files[0]
        if (first !== undefined) setSelectedFile(first.path)
      }).catch((error: unknown) => {
        if (stopped || isAbortError(error)) return
        setDetailError(toApiError(error))
      }).finally(() => {
        if (!stopped) setDetailLoading(false)
      })
      return () => {
        stopped = true
        controller.abort()
      }
    }, [workspaceId, selectedHash, appendCommands])

    // File diff, loaded only for the selected file.
    React.useEffect(() => {
      if (workspaceId === null || selectedHash === null || selectedFile === null) {
        setDiff(null)
        return undefined
      }
      let stopped = false
      const controller = new AbortController()
      setDiffLoading(true)
      runtime.diff({ workspaceId, hash: selectedHash, file: selectedFile, context: 3 }, controller.signal).then((result: DiffResult) => {
        if (stopped) return
        setDiff(parseUnifiedDiff(result.patch, selectedFile, result.truncated))
        setDiffError(null)
        appendCommands(result.commands)
      }).catch((error: unknown) => {
        if (stopped || isAbortError(error)) return
        setDiffError(toApiError(error))
      }).finally(() => {
        if (!stopped) setDiffLoading(false)
      })
      return () => {
        stopped = true
        controller.abort()
      }
    }, [workspaceId, selectedHash, selectedFile, appendCommands])

    const loadMore = (): void => {
      if (workspaceId === null || logLoadingMore) return
      const controller = new AbortController()
      setLogLoadingMore(true)
      runtime.log({
        workspaceId,
        limit: 50,
        skip: log.commits.length,
        ...(branchFilter === null ? {} : { ref: branchFilter }),
        ...(query === '' ? {} : { query }),
      }, controller.signal).then((page) => {
        setLog(previous => ({ commits: [...previous.commits, ...page.commits], hasMore: page.hasMore }))
        appendCommands(page.commands)
      }).catch((error: unknown) => {
        if (!isAbortError(error)) setLogError(toApiError(error))
      }).finally(() => {
        setLogLoadingMore(false)
      })
    }

    const selectWorkspace = (next: string): void => {
      setChoice(next)
      writeStored(WORKSPACE_KEY, next)
      setSnapshot(null)
      setBranchFilter(null)
      setSelectedHash(null)
      setDetail(null)
      setDiff(null)
    }

    const selectBranch = (ref: string | null): void => {
      setBranchFilter(ref)
    }

    const graph = React.useMemo(() => computeGraph(log.commits), [log.commits])
    const failures = [snapshotError, logError, detailError, diffError, actionError].filter((error): error is GitApiError => error !== null)
    const banner = failures[0] ?? null
    const head: HeadState | null = snapshot?.head ?? null
    const branches: readonly BranchRef[] = snapshot?.branches ?? []
    const isNoRepo = snapshotError?.code === 'not-a-repository'
    const status = snapshot === null
      ? null
      : [
        head?.branch ?? (head?.detached === true ? 'HEAD 已分离' : 'HEAD'),
        head?.upstream === null || head?.upstream === undefined
          ? null
          : `↑${head.upstream.ahead} ↓${head.upstream.behind}`,
        snapshot.counts.staged + snapshot.counts.unstaged + snapshot.counts.untracked + snapshot.counts.conflicted > 0
          ? `本地更改 ${snapshot.counts.staged + snapshot.counts.unstaged + snapshot.counts.untracked + snapshot.counts.conflicted}`
          : '工作树干净',
      ].filter((part): part is string => part !== null).join('  ·  ')

    return React.createElement(
      'div',
      { className: 'dgw' },
      React.createElement('style', null, CSS),
      React.createElement(
        'div',
        { className: 'dgw-head' },
        React.createElement('span', { className: 'dgw-brand' },
          React.createElement(GitPanelIcon, { size: 16, active: true }),
          React.createElement('span', null, 'Git'),
        ),
        items.length === 0
          ? null
          : React.createElement(
            'select',
            {
              className: 'dgw-select',
              value: workspaceId ?? '',
              onChange: (event: React.ChangeEvent<HTMLSelectElement>) => selectWorkspace(event.target.value),
              'aria-label': '选择工作区',
            },
            ...items.map(item => React.createElement('option', { key: item.workspaceId, value: item.workspaceId }, item.title || item.path)),
          ),
        React.createElement('span', { className: 'dgw-spacer' }),
        status === null ? null : React.createElement('span', { className: 'dgw-status' }, status),
        React.createElement('button', {
          className: 'dgw-iconBtn',
          type: 'button',
          title: '刷新',
          'aria-label': '刷新',
          onClick: retry,
          disabled: workspaceId === null || snapshotLoading,
        }, React.createElement(RefreshIcon, { size: 14 })),
        React.createElement('button', {
          className: 'dgw-iconBtn',
          type: 'button',
          title: '获取（fetch）',
          'aria-label': '获取',
          disabled: workspaceId === null || jobBusy,
          onClick: () => { if (workspaceId !== null) void runJob({ kind: 'fetch', workspaceId, all: true }) },
        }, React.createElement(FetchIcon, { size: 14 })),
        React.createElement('button', {
          className: 'dgw-iconBtn',
          type: 'button',
          title: '更新当前分支（fetch + merge）',
          'aria-label': '更新',
          disabled: workspaceId === null || jobBusy || snapshot === null,
          onClick: () => { if (workspaceId !== null) void runJob({ kind: 'update', workspaceId, mode: 'merge' }) },
        }, React.createElement(RefreshIcon, { size: 14 })),
        React.createElement('button', {
          className: 'dgw-iconBtn',
          type: 'button',
          title: '推送（push）',
          'aria-label': '推送',
          disabled: workspaceId === null || jobBusy || snapshot === null,
          onClick: pushCurrent,
        }, React.createElement(PushIcon, { size: 14 })),
      ),
      React.createElement(
        'div',
        { className: 'dgw-tabs', role: 'tablist' },
        React.createElement('button', {
          className: tab === 'commit' ? 'dgw-tab dgw-tab--active' : 'dgw-tab',
          type: 'button',
          role: 'tab',
          'aria-selected': tab === 'commit',
          onClick: () => setTab('commit'),
        }, '提交'),
        React.createElement('button', {
          className: tab === 'log' ? 'dgw-tab dgw-tab--active' : 'dgw-tab',
          type: 'button',
          role: 'tab',
          'aria-selected': tab === 'log',
          onClick: () => setTab('log'),
        }, '日志'),
        React.createElement('button', {
          className: tab === 'console' ? 'dgw-tab dgw-tab--active' : 'dgw-tab',
          type: 'button',
          role: 'tab',
          'aria-selected': tab === 'console',
          onClick: () => setTab('console'),
        }, '控制台'),
      ),
      React.createElement(ErrorBanner, { error: banner, onRetry: retry }),
      workspaceId === null
        ? React.createElement('div', { className: 'dgw-empty' },
          React.createElement('div', { className: 'dgw-emptyBox' },
            React.createElement('div', null, '选择工作区以查看 Git 状态'),
          ),
        )
        : isNoRepo
          ? React.createElement(NoRepo, { onRetry: retry })
          : React.createElement(
            'div',
            { className: 'dgw-body' },
            tab === 'commit'
              ? snapshot === null
                ? React.createElement('div', { className: 'dgw-loading' }, '正在读取仓库状态…')
                : React.createElement(CommitPane, {
                  runtime,
                  workspaceId,
                  snapshot,
                  onChanged: () => setRefreshKey(key => key + 1),
                })
              : tab === 'console'
                ? React.createElement(ConsolePane, { commands })
                : React.createElement(
                  'div',
                  { className: 'dgw-logLayout' },
                React.createElement(BranchTree, {
                  head: head ?? { oid: null, branch: null, detached: false, unborn: false, upstream: null, operation: 'none' },
                  branches,
                  selectedRef: branchFilter,
                  onSelect: selectBranch,
                  onCheckout: (ref: string) => { void checkoutBranch(ref) },
                  onCreateBranch: (start?: string) => openBranchDialog({ kind: 'create', ...(start === undefined ? {} : { start }) }, ''),
                  onRenameBranch: (name: string) => openBranchDialog({ kind: 'rename', branch: name }, name),
                  onDeleteBranch: (name: string) => openBranchDialog({ kind: 'delete', branch: name }, ''),
                }),
                React.createElement(LogList, {
                  commits: log.commits,
                  graph,
                  selectedOid: selectedHash,
                  branchLabel: branchFilter,
                  query: queryInput,
                  loading: logLoading,
                  hasMore: log.hasMore,
                  onSelect: (oid: string) => setSelectedHash(oid),
                  onQueryChange: setQueryInput,
                  onClearBranch: () => setBranchFilter(null),
                  onLoadMore: loadMore,
                }),
                React.createElement(DetailPane, {
                  detail,
                  loading: detailLoading,
                  selectedFile,
                  diff,
                  diffLoading,
                  onSelectFile: setSelectedFile,
                }),
              ),
          ),
      snapshot === null
        ? null
        : React.createElement(
          'div',
          { className: snapshot.stale ? 'dgw-statusBar dgw-statusBar--warn' : 'dgw-statusBar' },
          React.createElement('span', null, snapshot.repo.root),
          snapshot.head.operation !== 'none'
            ? React.createElement('span', null, `正在${snapshot.head.operation}…`)
            : null,
          React.createElement('span', null, `分支 ${branches.filter(branch => branch.type === 'local').length} · 远程 ${branches.filter(branch => branch.type === 'remote').length}`),
          job === null
            ? null
            : React.createElement('span', { className: 'dgw-job' },
              `${jobLabel(job.kind)}${job.status === 'running' ? '：进行中' : job.status === 'done' ? '：完成' : job.status === 'cancelled' ? '：已取消' : '：失败'}`,
              job.status === 'running' && job.lines.length > 0 ? `  ${job.lines[job.lines.length - 1] ?? ''}` : '',
            ),
          job !== null && job.status === 'running'
            ? React.createElement('button', {
              className: 'dgw-retry',
              type: 'button',
              onClick: () => { void runtime.cancelJob(job.id).catch((error: unknown) => setActionError(toApiError(error))) },
            }, '取消')
            : null,
          React.createElement('span', null, snapshot.truncated ? '结果已截断' : `更新于 ${formatWhen(new Date(snapshot.takenAt).toISOString())}`),
        ),
      branchPrompt === null
        ? null
        : React.createElement(BranchDialog, {
          prompt: branchPrompt,
          value: branchValue,
          force: branchForce,
          busy: branchBusy,
          error: branchError,
          onValue: setBranchValue,
          onForce: setBranchForce,
          onCancel: () => { if (!branchBusy) setBranchPrompt(null) },
          onConfirm: () => { void submitBranchDialog() },
        }),
    )
  }
}
