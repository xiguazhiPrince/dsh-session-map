/**
 * State machine of the Git right-column page: the same Host round-trips the main
 * panel performs, shaped for a one-page layout (commit panel + diff above, log
 * below).
 *
 * The hook owns every fetch, selection, dialog and job decision, so the
 * presentational layout stays plain props and an SSR test can render it from a
 * fixture. Actions that need panel navigation (fullscreen, closing the tab)
 * stay in the page wrapper: they call services the slot context provides, not
 * the Host routes this module talks to.
 *
 * @module dsh-session-map/git-workspace/window/rightbar/model
 */
import * as React from 'react'
import type {
  BranchRef,
  ChangedEntry,
  CommitDetail,
  CommitRow,
  DiffView,
  GitJobView,
  HeadState,
  RepoSnapshot,
} from '../../git-types'
import type { GitAction } from '../../git-actions'
import { parseUnifiedDiff } from '../../git-parse'
import { computeGraph, type GraphRow } from '../lanes'
import type { DiffMode } from '../diff-view'
import {
  GitApiError,
  isAbortError,
  waitForJob,
  type GitWindowApi,
  type LogRequest,
} from '../runtime'
import type { BranchPrompt } from '../branch'
import type { ResetMode } from '../history'
import { COMMIT_WIDTH_MIN, type DiffModePref, type GitRightbarPrefs } from './prefs'

/** Poll interval while the page is visible. */
const POLL_VISIBLE_MS = 3_000
/** Poll interval after the page has been hidden for a while. */
const POLL_HIDDEN_MS = 10_000

/** What the diff viewer is currently showing. */
export type DiffTarget =
  | { readonly kind: 'change'; readonly path: string; readonly group: ChangedEntry['group'] }
  | { readonly kind: 'commit'; readonly hash: string; readonly path: string }

/** The open branch dialog. */
export interface BranchDialogState {
  readonly prompt: BranchPrompt
  readonly value: string
  readonly force: boolean
  readonly busy: boolean
  readonly error: GitApiError | null
}

/** The open reset dialog. */
export interface ResetDialogState {
  readonly target: string
  readonly mode: ResetMode
  readonly busy: boolean
  readonly error: GitApiError | null
}

/** The open tag dialog. */
export interface TagDialogState {
  readonly target: string
  readonly value: string
  readonly busy: boolean
  readonly error: GitApiError | null
}

/** The open tag-delete dialog. */
export interface TagDeleteDialogState {
  readonly name: string
  readonly busy: boolean
  readonly error: GitApiError | null
}

/** The open force-push dialog. */
export interface ForcePushDialogState {
  readonly branch: string
  readonly busy: boolean
  readonly error: GitApiError | null
}

/** Everything the layout renders. */
export interface GitRightbarModel {
  readonly runtime: GitWindowApi
  readonly workspaceId: string | null
  readonly snapshot: RepoSnapshot | null
  readonly snapshotLoading: boolean
  readonly banner: GitApiError | null
  readonly notRepo: boolean
  readonly head: HeadState | null
  readonly branches: readonly BranchRef[]
  readonly commits: readonly CommitRow[]
  readonly graph: readonly GraphRow[]
  readonly logLoading: boolean
  readonly logHasMore: boolean
  readonly branchFilter: string | null
  readonly queryInput: string
  readonly selectedOid: string | null
  readonly detail: CommitDetail | null
  readonly detailLoading: boolean
  readonly target: DiffTarget | null
  readonly diff: DiffView | null
  readonly diffLoading: boolean
  readonly diffHint: string | undefined
  readonly diffMode: DiffMode
  readonly commitOpen: boolean
  readonly commitWidth: number
  readonly logHeight: number
  readonly job: GitJobView | null
  readonly jobBusy: boolean
  readonly branchDialog: BranchDialogState | null
  readonly resetDialog: ResetDialogState | null
  readonly tagDialog: TagDialogState | null
  readonly tagDeleteDialog: TagDeleteDialogState | null
  readonly forcePushDialog: ForcePushDialogState | null
  readonly actions: GitRightbarActions
}

/** Every control the layout can invoke. */
export interface GitRightbarActions {
  readonly refresh: () => void
  readonly retry: () => void
  readonly fetchAll: () => void
  readonly updateBranch: () => void
  readonly push: () => void
  readonly cancelJob: () => void
  readonly search: (value: string) => void
  readonly clearBranch: () => void
  readonly selectBranch: (ref: string | null) => void
  readonly loadMore: () => void
  readonly selectCommit: (oid: string) => void
  readonly selectChange: (entry: ChangedEntry) => void
  readonly selectCommitFile: (path: string) => void
  readonly continueOperation: () => void
  readonly abortOperation: () => void
  readonly checkoutBranch: (ref: string) => void
  readonly openCreateBranch: (start?: string) => void
  readonly openRenameBranch: (name: string) => void
  readonly openDeleteBranch: (name: string) => void
  readonly mergeBranch: (ref: string) => void
  readonly rebaseBranch: (ref: string) => void
  readonly deleteTag: (name: string) => void
  readonly openForcePush: (name: string) => void
  readonly cherryPick: (oid: string) => void
  readonly revert: (oid: string) => void
  readonly openReset: (oid: string) => void
  readonly openTagCreate: (oid: string) => void
  readonly changesChanged: () => void
  readonly toggleCommitPanel: () => void
  readonly setCommitWidth: (width: number) => void
  readonly setLogHeight: (height: number) => void
  readonly cycleDiffMode: () => void
  readonly setBranchValue: (value: string) => void
  readonly setBranchForce: (force: boolean) => void
  readonly cancelBranchDialog: () => void
  readonly confirmBranchDialog: () => void
  readonly setResetMode: (mode: ResetMode) => void
  readonly cancelResetDialog: () => void
  readonly confirmResetDialog: () => void
  readonly setTagValue: (value: string) => void
  readonly cancelTagDialog: () => void
  readonly confirmTagDialog: () => void
  readonly cancelTagDeleteDialog: () => void
  readonly confirmTagDeleteDialog: () => void
  readonly cancelForcePushDialog: () => void
  readonly confirmForcePushDialog: () => void
}

/** What {@link useGitRightbarModel} reads from its host. */
export interface GitRightbarModelDeps {
  readonly runtime: GitWindowApi
  readonly workspaceId: string | null
  /** Measured page width, used only for the `auto` diff preference. */
  readonly width: number
  readonly prefs: GitRightbarPrefs
  readonly onPrefs: (next: GitRightbarPrefs) => void
}

/** Normalize one thrown value. */
function toApiError(error: unknown): GitApiError {
  return error instanceof GitApiError
    ? error
    : new GitApiError('internal', error instanceof Error ? error.message : String(error))
}

/** The diff presentation a preference resolves to at this width. */
function resolveDiffMode(pref: DiffModePref, width: number): DiffMode {
  if (pref === 'unified' || pref === 'side') return pref
  return width >= 700 ? 'side' : 'unified'
}

/** Build the page state machine over one Host runtime and one workspace. */
export function useGitRightbarModel(deps: GitRightbarModelDeps): GitRightbarModel {
  const { runtime, workspaceId, width, prefs, onPrefs } = deps

  const [refreshKey, setRefreshKey] = React.useState(0)
  const [snapshot, setSnapshot] = React.useState<RepoSnapshot | null>(null)
  const [snapshotLoading, setSnapshotLoading] = React.useState(false)
  const [snapshotError, setSnapshotError] = React.useState<GitApiError | null>(null)

  const [branchFilter, setBranchFilter] = React.useState<string | null>(null)
  const [queryInput, setQueryInput] = React.useState('')
  const [query, setQuery] = React.useState('')
  const [commits, setCommits] = React.useState<readonly CommitRow[]>([])
  const [logHasMore, setLogHasMore] = React.useState(false)
  const [logLoading, setLogLoading] = React.useState(false)
  const [logLoadingMore, setLogLoadingMore] = React.useState(false)
  const [logError, setLogError] = React.useState<GitApiError | null>(null)

  const [selectedOid, setSelectedOid] = React.useState<string | null>(null)
  const [detail, setDetail] = React.useState<CommitDetail | null>(null)
  const [detailLoading, setDetailLoading] = React.useState(false)
  const [detailError, setDetailError] = React.useState<GitApiError | null>(null)

  const [target, setTarget] = React.useState<DiffTarget | null>(null)
  const [diff, setDiff] = React.useState<DiffView | null>(null)
  const [diffLoading, setDiffLoading] = React.useState(false)
  const [diffError, setDiffError] = React.useState<GitApiError | null>(null)

  const [actionError, setActionError] = React.useState<GitApiError | null>(null)
  const [job, setJob] = React.useState<GitJobView | null>(null)
  const [jobBusy, setJobBusy] = React.useState(false)

  const [branchDialog, setBranchDialog] = React.useState<BranchDialogState | null>(null)
  const [resetDialog, setResetDialog] = React.useState<ResetDialogState | null>(null)
  const [tagDialog, setTagDialog] = React.useState<TagDialogState | null>(null)
  const [tagDeleteDialog, setTagDeleteDialog] = React.useState<TagDeleteDialogState | null>(null)
  const [forcePushDialog, setForcePushDialog] = React.useState<ForcePushDialogState | null>(null)

  const refresh = React.useCallback((): void => setRefreshKey(key => key + 1), [])
  const updatePrefs = React.useCallback((patch: Partial<GitRightbarPrefs>): void => {
    onPrefs({ ...prefs, ...patch })
  }, [onPrefs, prefs])

  // ---------------------------------------------------------------- reads
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
  }, [runtime, workspaceId, refreshKey])

  React.useEffect(() => {
    const timer = setTimeout(() => setQuery(queryInput.trim()), 300)
    return () => clearTimeout(timer)
  }, [queryInput])

  // A filter or workspace change invalidates the selection: the selected
  // commit may no longer be in the list.
  React.useEffect(() => {
    setSelectedOid(null)
    setDetail(null)
    setTarget(null)
    setDiff(null)
  }, [workspaceId, branchFilter, query])

  React.useEffect(() => {
    if (workspaceId === null) {
      setCommits([])
      setLogHasMore(false)
      return undefined
    }
    let stopped = false
    const controller = new AbortController()
    setLogLoading(true)
    const request: LogRequest = {
      workspaceId,
      limit: 50,
      ...(branchFilter === null ? {} : { ref: branchFilter }),
      ...(query === '' ? {} : { query }),
    }
    runtime.log(request, controller.signal).then((page) => {
      if (stopped) return
      setCommits(page.commits)
      setLogHasMore(page.hasMore)
      setLogError(null)
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
  }, [runtime, workspaceId, branchFilter, query, refreshKey])

  React.useEffect(() => {
    if (workspaceId === null || selectedOid === null) {
      setDetail(null)
      setDetailLoading(false)
      return undefined
    }
    let stopped = false
    const controller = new AbortController()
    setDetailLoading(true)
    runtime.commit(workspaceId, selectedOid, controller.signal).then((result) => {
      if (stopped) return
      setDetail(result.commit)
      setDetailError(null)
      const first = result.commit.files[0]
      if (first !== undefined) {
        setTarget({ kind: 'commit', hash: result.commit.oid, path: first.path })
      }
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
  }, [runtime, workspaceId, selectedOid, refreshKey])

  React.useEffect(() => {
    if (workspaceId === null || target === null) {
      setDiff(null)
      setDiffLoading(false)
      return undefined
    }
    if (target.kind === 'change' && target.group === 'untracked') {
      setDiff(null)
      setDiffLoading(false)
      setDiffError(null)
      return undefined
    }
    let stopped = false
    const controller = new AbortController()
    setDiffLoading(true)
    const request = target.kind === 'commit'
      ? { workspaceId, hash: target.hash, file: target.path, context: 3 }
      : { workspaceId, file: target.path, staged: target.group === 'staged', context: 3 }
    runtime.diff(request, controller.signal).then((result) => {
      if (stopped) return
      setDiff(parseUnifiedDiff(result.patch, target.path, result.truncated))
      setDiffError(null)
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
  }, [runtime, workspaceId, target, refreshKey])

  React.useEffect(() => {
    setSelectedOid(current => current !== null && commits.some(commit => commit.oid === current) ? current : null)
  }, [commits])

  // ---------------------------------------------------------------- writes
  const runSimple = async (action: GitAction): Promise<void> => {
    if (workspaceId === null) return
    setActionError(null)
    try {
      await runtime.action(action)
      refresh()
    } catch (error) {
      setActionError(toApiError(error))
    }
  }

  /** Chinese label for one job kind. */
  const jobLabel = (kind: string): string => {
    switch (kind) {
      case 'fetch': return '下载远端状态'
      case 'update': return '更新当前分支'
      case 'push': return '推送'
      default: return kind
    }
  }

  /** Follow one job through SSE, falling back to polling when the stream fails. */
  const watchJob = React.useCallback((id: string): void => {
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
      refresh()
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
  }, [refresh, runtime])

  /** Start one long action and follow its job. */
  const runJob = async (action: GitAction, confirmToken?: string): Promise<void> => {
    if (workspaceId === null || jobBusy) return
    setJobBusy(true)
    setActionError(null)
    try {
      const result = await runtime.action(action, confirmToken)
      if (result.job === undefined) {
        setJobBusy(false)
        refresh()
        return
      }
      setJob({ id: result.job.id, kind: action.kind, workspaceId, status: 'running', lines: [], startedAt: Date.now() })
      watchJob(result.job.id)
    } catch (error) {
      setActionError(toApiError(error))
      setJobBusy(false)
    }
  }

  const fetchAll = (): void => {
    if (workspaceId === null) return
    void runJob({ kind: 'fetch', workspaceId, all: true })
  }

  const updateBranch = (): void => {
    if (workspaceId === null) return
    void runJob({ kind: 'update', workspaceId, mode: 'merge' })
  }

  const push = (): void => {
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

  const cancelJob = (): void => {
    if (job === null) return
    void runtime.cancelJob(job.id).then(() => { setJobBusy(false) }).catch((error: unknown) => {
      setActionError(toApiError(error))
      setJobBusy(false)
    })
  }

  const continueOperation = (): void => {
    if (workspaceId === null || snapshot === null) return
    const operation = snapshot.head.operation
    if (operation === 'none' || operation === 'bisect') return
    void runSimple({ kind: 'continueOperation', workspaceId, operation: operation === 'rebase-apply' ? 'rebase' : operation })
  }

  const abortOperation = (): void => {
    if (workspaceId === null || snapshot === null) return
    const operation = snapshot.head.operation
    if (operation === 'none' || operation === 'bisect') return
    void runSimple({ kind: 'abortOperation', workspaceId, operation: operation === 'rebase-apply' ? 'rebase' : operation })
  }

  // ---------------------------------------------------------------- dialogs
  const openBranchDialog = (prompt: BranchPrompt, initial: string): void => {
    setBranchDialog({ prompt, value: initial, force: false, busy: false, error: null })
  }

  const submitBranchDialog = async (): Promise<void> => {
    if (workspaceId === null || branchDialog === null || branchDialog.busy) return
    const name = branchDialog.value.trim()
    if (branchDialog.prompt.kind !== 'delete' && name === '') return
    setBranchDialog({ ...branchDialog, busy: true, error: null })
    try {
      if (branchDialog.prompt.kind === 'create') {
        await runtime.action({
          kind: 'createBranch',
          workspaceId,
          name,
          ...(branchDialog.prompt.start === undefined ? {} : { start: branchDialog.prompt.start }),
        })
      } else if (branchDialog.prompt.kind === 'rename') {
        await runtime.action({ kind: 'renameBranch', workspaceId, from: branchDialog.prompt.branch ?? '', to: name })
      } else {
        const action = {
          kind: 'deleteBranch',
          workspaceId,
          name: branchDialog.prompt.branch ?? '',
          force: branchDialog.force,
        } as const
        const confirmation = await runtime.confirm(action)
        await runtime.action(action, confirmation.token)
      }
      setBranchDialog(null)
      refresh()
    } catch (error) {
      setBranchDialog(current => current === null ? null : { ...current, busy: false, error: toApiError(error) })
    }
  }

  const submitReset = async (): Promise<void> => {
    if (workspaceId === null || resetDialog === null || resetDialog.busy) return
    setResetDialog({ ...resetDialog, busy: true, error: null })
    try {
      const action = { kind: 'reset', workspaceId, hash: resetDialog.target, mode: resetDialog.mode } as const
      const confirmation = await runtime.confirm(action)
      await runtime.action(action, confirmation.token)
      setResetDialog(null)
      refresh()
    } catch (error) {
      setResetDialog(current => current === null ? null : { ...current, busy: false, error: toApiError(error) })
    }
  }

  const submitTag = async (): Promise<void> => {
    if (workspaceId === null || tagDialog === null || tagDialog.busy) return
    const name = tagDialog.value.trim()
    if (name === '') return
    setTagDialog({ ...tagDialog, busy: true, error: null })
    try {
      await runtime.action({ kind: 'tagCreate', workspaceId, name, hash: tagDialog.target })
      setTagDialog(null)
      refresh()
    } catch (error) {
      setTagDialog(current => current === null ? null : { ...current, busy: false, error: toApiError(error) })
    }
  }

  const submitTagDelete = async (): Promise<void> => {
    if (workspaceId === null || tagDeleteDialog === null || tagDeleteDialog.busy) return
    setTagDeleteDialog({ ...tagDeleteDialog, busy: true, error: null })
    try {
      const action = { kind: 'tagDelete', workspaceId, name: tagDeleteDialog.name } as const
      const confirmation = await runtime.confirm(action)
      await runtime.action(action, confirmation.token)
      setTagDeleteDialog(null)
      refresh()
    } catch (error) {
      setTagDeleteDialog(current => current === null ? null : { ...current, busy: false, error: toApiError(error) })
    }
  }

  const submitForcePush = async (): Promise<void> => {
    if (workspaceId === null || forcePushDialog === null || forcePushDialog.busy) return
    setForcePushDialog({ ...forcePushDialog, busy: true, error: null })
    try {
      const remote = snapshot?.remotes[0]?.name
      const action = {
        kind: 'push',
        workspaceId,
        branch: forcePushDialog.branch,
        forceWithLease: true,
        ...(remote === undefined ? {} : { remote }),
      } as const
      const confirmation = await runtime.confirm(action)
      setForcePushDialog(null)
      await runJob(action, confirmation.token)
    } catch (error) {
      setForcePushDialog(current => current === null ? null : { ...current, busy: false, error: toApiError(error) })
    }
  }

  // ---------------------------------------------------------------- derived
  const graph = React.useMemo(() => computeGraph(commits), [commits])
  const failures = [snapshotError, logError, detailError, diffError, actionError]
    .filter((error): error is GitApiError => error !== null)
  const banner = failures[0] ?? null
  const notRepo = snapshotError?.code === 'not-a-repository'
  const commitOpen = prefs.commitOpen === null ? width >= 760 : prefs.commitOpen
  const diffHint = target !== null && target.kind === 'change' && target.group === 'untracked'
    ? '未跟踪文件没有差异可显示'
    : undefined

  const actions: GitRightbarActions = {
    refresh,
    retry: () => {
      setSnapshotError(null)
      setLogError(null)
      setDetailError(null)
      setDiffError(null)
      setActionError(null)
      refresh()
    },
    fetchAll,
    updateBranch,
    push,
    cancelJob,
    search: (value: string) => setQueryInput(value),
    clearBranch: () => setBranchFilter(null),
    selectBranch: (ref: string | null) => setBranchFilter(ref),
    loadMore: () => {
      if (workspaceId === null || logLoadingMore) return
      const controller = new AbortController()
      setLogLoadingMore(true)
      runtime.log({
        workspaceId,
        limit: 50,
        skip: commits.length,
        ...(branchFilter === null ? {} : { ref: branchFilter }),
        ...(query === '' ? {} : { query }),
      }, controller.signal).then((page) => {
        setCommits(previous => [...previous, ...page.commits])
        setLogHasMore(page.hasMore)
      }).catch((error: unknown) => {
        if (!isAbortError(error)) setLogError(toApiError(error))
      }).finally(() => setLogLoadingMore(false))
    },
    selectCommit: (oid: string) => setSelectedOid(oid),
    selectChange: (entry: ChangedEntry) => setTarget({ kind: 'change', path: entry.path, group: entry.group }),
    selectCommitFile: (path: string) => {
      if (detail === null) return
      setTarget({ kind: 'commit', hash: detail.oid, path })
    },
    continueOperation,
    abortOperation,
    checkoutBranch: (ref: string) => {
      if (workspaceId === null) return
      void runSimple({ kind: 'checkout', workspaceId, ref })
    },
    openCreateBranch: (start?: string) => openBranchDialog({ kind: 'create', ...(start === undefined ? {} : { start }) }, ''),
    openRenameBranch: (name: string) => openBranchDialog({ kind: 'rename', branch: name }, name),
    openDeleteBranch: (name: string) => openBranchDialog({ kind: 'delete', branch: name }, ''),
    mergeBranch: (ref: string) => {
      if (workspaceId === null) return
      void runSimple({ kind: 'merge', workspaceId, ref })
    },
    rebaseBranch: (ref: string) => {
      if (workspaceId === null) return
      void runSimple({ kind: 'rebase', workspaceId, onto: ref })
    },
    deleteTag: (name: string) => setTagDeleteDialog({ name, busy: false, error: null }),
    openForcePush: (name: string) => setForcePushDialog({ branch: name, busy: false, error: null }),
    cherryPick: (oid: string) => {
      if (workspaceId === null) return
      void runSimple({ kind: 'cherryPick', workspaceId, hash: oid })
    },
    revert: (oid: string) => {
      if (workspaceId === null) return
      void runSimple({ kind: 'revert', workspaceId, hash: oid })
    },
    openReset: (oid: string) => setResetDialog({ target: oid, mode: 'mixed', busy: false, error: null }),
    openTagCreate: (oid: string) => setTagDialog({ target: oid, value: '', busy: false, error: null }),
    changesChanged: refresh,
    toggleCommitPanel: () => updatePrefs({ commitOpen: !commitOpen }),
    setCommitWidth: (next: number) => updatePrefs({ commitWidth: Math.min(Math.max(COMMIT_WIDTH_MIN, Math.round(next)), 520) }),
    setLogHeight: (next: number) => updatePrefs({ logHeight: Math.max(140, Math.round(next)) }),
    cycleDiffMode: () => {
      const resolved = resolveDiffMode(prefs.diffMode, width)
      updatePrefs({ diffMode: resolved === 'side' ? 'unified' : 'side' })
    },
    setBranchValue: (value: string) => setBranchDialog(current => current === null ? null : { ...current, value }),
    setBranchForce: (force: boolean) => setBranchDialog(current => current === null ? null : { ...current, force }),
    cancelBranchDialog: () => setBranchDialog(current => current === null || current.busy ? current : null),
    confirmBranchDialog: () => { void submitBranchDialog() },
    setResetMode: (mode: ResetMode) => setResetDialog(current => current === null ? null : { ...current, mode }),
    cancelResetDialog: () => setResetDialog(current => current === null || current.busy ? current : null),
    confirmResetDialog: () => { void submitReset() },
    setTagValue: (value: string) => setTagDialog(current => current === null ? null : { ...current, value }),
    cancelTagDialog: () => setTagDialog(current => current === null || current.busy ? current : null),
    confirmTagDialog: () => { void submitTag() },
    cancelTagDeleteDialog: () => setTagDeleteDialog(current => current === null || current.busy ? current : null),
    confirmTagDeleteDialog: () => { void submitTagDelete() },
    cancelForcePushDialog: () => setForcePushDialog(current => current === null || current.busy ? current : null),
    confirmForcePushDialog: () => { void submitForcePush() },
  }

  return {
    runtime,
    workspaceId,
    snapshot,
    snapshotLoading,
    banner,
    notRepo,
    head: snapshot?.head ?? null,
    branches: snapshot?.branches ?? [],
    commits,
    graph,
    logLoading,
    logHasMore,
    branchFilter,
    queryInput,
    selectedOid,
    detail,
    detailLoading,
    target,
    diff,
    diffLoading,
    diffHint,
    diffMode: resolveDiffMode(prefs.diffMode, width),
    commitOpen,
    commitWidth: Math.min(Math.max(COMMIT_WIDTH_MIN, prefs.commitWidth), Math.max(COMMIT_WIDTH_MIN, width - 320)),
    logHeight: prefs.logHeight,
    job,
    jobBusy,
    branchDialog,
    resetDialog,
    tagDialog,
    tagDeleteDialog,
    forcePushDialog,
    actions,
  }
}

/** Job label used by the status bar. */
export function jobStatusLabel(view: GitJobView): string {
  if (view.status === 'running') return '进行中'
  if (view.status === 'done') return '完成'
  if (view.status === 'cancelled') return '已取消'
  return '失败'
}
