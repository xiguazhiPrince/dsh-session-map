/**
 * Layout of the Git right-column page: toolbar, commit panel + diff above, the
 * log (branch tree / commit list / commit details) below, and a status bar.
 *
 * Presentational only: every fetch, selection and dialog decision lives in
 * {@link useGitRightbarModel}, so this file can be rendered from fixtures at
 * either breakpoint.
 *
 * @module dsh-session-map/git-workspace/window/rightbar/layout
 */
import * as React from 'react'
import type { HeadState } from '../../git-types'
import { CommitPane } from '../commit'
import { BranchTree, CommitFiles, CommitMeta, LogList, formatWhen } from '../log'
import { DiffView, diffStats } from '../diff-view'
import { ErrorBanner, NoRepo } from '../feedback'
import { BranchDialog } from '../branch'
import { ForcePushDialog, ResetDialog, TagDeleteDialog, TagDialog } from '../history'
import {
  ChevronIcon,
  CloseIcon,
  CopyIcon,
  FetchIcon,
  GitPanelIcon,
  PanelLeftIcon,
  PushIcon,
  RefreshIcon,
  SideBySideIcon,
  UnifiedIcon,
} from '../icons'
import { CSS } from '../css'
import { RIGHTBAR_CSS } from './css'
import type { GitRightbarModel } from './model'
import { jobStatusLabel } from './model'
import { COMMIT_WIDTH_MIN } from './prefs'
import { UpdateDialog, readUpdateMode, writeUpdateMode, type UpdateMode } from '../update-dialog'
import { PushDialog } from '../push-dialog'
import type { PushPreview } from '../../git-types'

/** The HEAD placeholder used before the first snapshot lands. */
const EMPTY_HEAD: HeadState = {
  oid: null,
  branch: null,
  detached: false,
  unborn: false,
  upstream: null,
  operation: 'none',
}

/** Width below which the branch tree gives its space to the commit list. */
const BRANCHES_MIN_WIDTH = 520
/** Width at which the commit-details column fits beside the list. */
const DETAILS_MIN_WIDTH = 800

/** Props for {@link GitRightbarLayout}. */
export interface GitRightbarLayoutProps {
  readonly size: { readonly width: number; readonly height: number }
  readonly workspaceLabel: string
  readonly model: GitRightbarModel
  readonly onFullscreen: () => void
  readonly onClose: () => void
}

/** Copy text without surfacing a failure. */
function copy(text: string): void {
  if (typeof navigator === 'undefined' || navigator.clipboard === undefined) return
  void navigator.clipboard.writeText(text).catch(() => undefined)
}

/** One toolbar/footer icon button. */
function iconButton(
  key: string,
  title: string,
  glyph: React.ReactElement,
  onClick: () => void,
  options?: { readonly disabled?: boolean; readonly active?: boolean },
): React.ReactElement {
  return React.createElement(
    'button',
    {
      key,
      className: 'dgw-iconBtn' + (options?.active === true ? ' dgw-iconBtn--active' : ''),
      type: 'button',
      title,
      'aria-label': title,
      onClick,
      disabled: options?.disabled === true,
    },
    glyph,
  )
}

/**
 * One labelled toolbar button: the glyph plus a short word, with the longer
 * explanation in the native tooltip. The right-column page's header used to be a
 * row of anonymous glyphs, which is hard to read without hovering each one.
 */
function toolButton(
  key: string,
  label: string,
  detail: string,
  glyph: React.ReactElement,
  onClick: () => void,
  options?: { readonly disabled?: boolean; readonly active?: boolean },
): React.ReactElement {
  return React.createElement(
    'button',
    {
      key,
      className: 'dgw-rb__tool' + (options?.active === true ? ' dgw-rb__tool--active' : ''),
      type: 'button',
      title: detail,
      'aria-label': detail,
      onClick,
      disabled: options?.disabled === true,
    },
    glyph,
    React.createElement('span', { className: 'dgw-rb__toolText' }, label),
  )
}

/** Render the commit-detail column (metadata + file list; the diff is above). */
function DetailsColumn(props: { readonly model: GitRightbarModel }): React.ReactElement {
  const { model } = props
  if (model.detail === null) {
    return React.createElement('div', { className: 'dgw-rb__empty' },
      React.createElement('div', { className: 'dgw-rb__emptyBox' },
        React.createElement('div', null, model.detailLoading ? '正在加载提交详情…' : '选择一个提交查看详情'),
      ),
    )
  }
  const detail = model.detail
  return React.createElement(
    'div',
    { className: 'dgw-rb__details' },
    React.createElement('div', { className: 'dgw-rb__detailsHead' },
      React.createElement('span', { className: 'dgw-hash' }, detail.shortOid),
      React.createElement('button', {
        className: 'dgw-iconBtn',
        type: 'button',
        title: '复制完整哈希',
        onClick: () => copy(detail.oid),
      }, React.createElement(CopyIcon, { size: 13 })),
      React.createElement('span', { className: 'dgw-spacer' }),
      React.createElement('span', { className: 'dgw-meta' }, `${detail.files.length} 个文件`),
    ),
    React.createElement('div', { className: 'dgw-rb__detailsScroll' },
      React.createElement(CommitMeta, { detail }),
      React.createElement(CommitFiles, {
        files: detail.files,
        selectedFile: model.target !== null && model.target.kind === 'commit' ? model.target.path : null,
        onSelectFile: model.actions.selectCommitFile,
      }),
    ),
  )
}

/** Render the page. */
export function GitRightbarLayout(props: GitRightbarLayoutProps): React.ReactElement {
  const { model } = props
  const { width, height } = props.size
  const commitOpen = model.commitOpen
  const commitWidth = Math.min(model.commitWidth, Math.max(COMMIT_WIDTH_MIN, width - 320))
  const logHeight = Math.min(model.logHeight, Math.max(160, height - 220))
  const showBranches = width >= BRANCHES_MIN_WIDTH
  const showDetails = width >= DETAILS_MIN_WIDTH

  const [drag, setDrag] = React.useState<{ readonly kind: 'log' | 'commit' | 'logTree' | 'logDetail'; readonly start: number; readonly base: number } | null>(null)
  const [dragValue, setDragValue] = React.useState<number | null>(null)
  const [drawerOpen, setDrawerOpen] = React.useState(false)
  const [updateDialog, setUpdateDialog] = React.useState<{ readonly mode: UpdateMode } | null>(null)
  const [pushOpen, setPushOpen] = React.useState(false)
  const [pushPreview, setPushPreview] = React.useState<PushPreview | null>(null)
  const [pushPreviewLoading, setPushPreviewLoading] = React.useState(false)
  const [pushPreviewError, setPushPreviewError] = React.useState<string | null>(null)
  const [pushForce, setPushForce] = React.useState(false)

  const openPushPreview = async (): Promise<void> => {
    if (model.workspaceId === null) return
    setPushOpen(true)
    setPushPreviewLoading(true)
    setPushPreview(null)
    setPushPreviewError(null)
    setPushForce(false)
    try {
      const result = await model.runtime.pushPreview(model.workspaceId)
      setPushPreview(result.preview)
    } catch (error) {
      setPushPreviewError(error instanceof Error ? error.message : String(error))
    } finally {
      setPushPreviewLoading(false)
    }
  }

  const upstreamRef = model.head?.upstream?.ref ?? null
  const upstreamOid = upstreamRef === null
    ? null
    : model.branches.find(branch => branch.type === 'remote' && (branch.ref === upstreamRef || branch.name === upstreamRef || upstreamRef.endsWith('/' + branch.name)))?.oid ?? null

  const openUpdate = (): void => {
    setUpdateDialog({ mode: readUpdateMode() })
  }

  const confirmUpdate = (): void => {
    if (updateDialog === null) return
    const mode = updateDialog.mode
    writeUpdateMode(mode)
    setUpdateDialog(null)
    model.actions.updateBranch(mode)
  }

  React.useEffect(() => {
    if (drag === null) return undefined
    const move = (event: PointerEvent): void => {
      const delta = drag.kind === 'log'
        ? drag.start - event.clientY
        : drag.kind === 'logDetail'
          ? drag.start - event.clientX
          : event.clientX - drag.start
      setDragValue(drag.base + delta)
    }
    const up = (): void => {
      const value = dragValue
      if (value !== null) {
        if (drag.kind === 'log') model.actions.setLogHeight(value)
        else if (drag.kind === 'commit') model.actions.setCommitWidth(value)
        else if (drag.kind === 'logTree') model.actions.setLogTreeWidth(value)
        else model.actions.setLogDetailWidth(value)
      }
      setDrag(null)
      setDragValue(null)
    }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
    return () => {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
    }
  }, [drag, dragValue, model.actions])

  const effectiveCommitWidth = drag !== null && drag.kind === 'commit' && dragValue !== null ? dragValue : commitWidth
  const effectiveLogHeight = drag !== null && drag.kind === 'log' && dragValue !== null ? Math.min(dragValue, Math.max(160, height - 220)) : logHeight
  const logTreeWidth = drag !== null && drag.kind === 'logTree' && dragValue !== null
    ? Math.min(Math.max(180, dragValue), 420)
    : model.logTreeWidth
  const logDetailWidth = drag !== null && drag.kind === 'logDetail' && dragValue !== null
    ? Math.min(Math.max(240, dragValue), 560)
    : model.logDetailWidth

  const head = model.head ?? EMPTY_HEAD
  const counts = model.snapshot?.counts
  const ahead = head.upstream?.ahead ?? 0
  const behind = head.upstream?.behind ?? 0
  // Below this width the labelled toolbar would crowd out the branch/repo
  // chips; keep the glyphs and the detailed tooltips, drop the words.
  const compactToolbar = width < 700
  const stats = diffStats(model.diff)
  const targetFile = model.target?.path ?? null
  const targetLabel = model.target === null
    ? null
    : model.target.kind === 'commit'
      ? '提交 ' + model.target.hash.slice(0, 7)
      : model.target.group === 'staged'
        ? '暂存区'
        : model.target.group === 'untracked'
          ? '未跟踪'
          : '工作区'

  const diffHeader = React.createElement(
    'div',
    { className: 'dgw-rb__diffHead' },
    React.createElement('span', { className: 'dgw-rb__diffTitle', title: targetFile ?? '' },
      targetFile === null ? '仓库差异' : '仓库差异: ' + (targetFile.split('/').pop() ?? targetFile),
    ),
    targetFile === null
      ? null
      : React.createElement('span', { className: 'dgw-rb__diffDir' }, targetFile.slice(0, targetFile.length - (targetFile.split('/').pop() ?? '').length)),
    targetLabel === null ? null : React.createElement('span', { className: 'dgw-rb__chip' }, targetLabel),
    React.createElement('span', { className: 'dgw-spacer' }),
    model.diff === null
      ? null
      : React.createElement('span', { className: 'dgw-rb__chip' }, '+' + stats.adds + ' −' + stats.dels),
    iconButton(
      'mode',
      model.diffMode === 'side' ? '切换为统一视图' : '切换为并排视图',
      model.diffMode === 'side' ? React.createElement(UnifiedIcon, { size: 13 }) : React.createElement(SideBySideIcon, { size: 13 }),
      model.actions.cycleDiffMode,
    ),
  )

  const toolbar = React.createElement(
    'div',
    { className: 'dgw-rb__top' + (compactToolbar ? ' dgw-rb__top--compact' : '') },
    React.createElement('span', { className: 'dgw-brand' },
      React.createElement(GitPanelIcon, { size: 16, active: true }),
      React.createElement('span', null, 'Git'),
    ),
    head.branch === null ? null : React.createElement('span', { className: 'dgw-rb__chip' }, head.branch),
    props.workspaceLabel === ''
      ? null
      : React.createElement('span', { className: 'dgw-rb__repo', title: props.workspaceLabel }, props.workspaceLabel),
    ahead === 0 && behind === 0
      ? null
      : React.createElement('span', { className: 'dgw-rb__chip' }, '↑' + ahead + ' ↓' + behind),
    counts === undefined
      ? null
      : React.createElement('span', { className: 'dgw-rb__chip' }, `${counts.staged} 已暂存 / ${counts.unstaged + counts.untracked + counts.conflicted} 未暂存`),
    React.createElement('span', { className: 'dgw-spacer' }),
    toolButton(
      'panels',
      commitOpen ? '收起变更' : '变更',
      commitOpen
        ? '收起左侧提交面板：提交信息、暂存区与差异预览'
        : '展开左侧提交面板：提交信息、暂存区与差异预览',
      React.createElement(PanelLeftIcon, { size: 14 }),
      model.actions.toggleCommitPanel,
      { active: commitOpen },
    ),
    toolButton(
      'refresh',
      '刷新',
      '重新读取工作区状态、分支和提交列表（只读，不联网）',
      React.createElement(RefreshIcon, { size: 14 }),
      model.actions.retry,
      { disabled: model.workspaceId === null || model.snapshotLoading },
    ),
    toolButton(
      'fetch',
      '下载远端状态',
      '下载远端状态：获取所有远端的最新引用（fetch --all --prune）；只更新远端跟踪分支，不修改工作区或本地分支',
      React.createElement(FetchIcon, { size: 14 }),
      model.actions.fetchAll,
      { disabled: model.workspaceId === null || model.jobBusy },
    ),
    toolButton(
      'update',
      '更新当前分支',
      '更新当前分支：先下载远端状态，再按弹窗选择合并或变基；有未提交更改时会被拒绝',
      React.createElement(RefreshIcon, { size: 14 }),
      openUpdate,
      { disabled: model.workspaceId === null || model.jobBusy },
    ),
    toolButton(
      'push',
      '推送',
      '推送当前分支到远端；会先预览待推送提交与文件',
      React.createElement(PushIcon, { size: 14 }),
      () => { void openPushPreview() },
      { disabled: model.workspaceId === null || model.jobBusy || model.snapshot === null },
    ),
  )

  const statusBar = React.createElement(
    'div',
    { className: 'dgw-rb__status' },
    React.createElement('span', null, model.snapshot?.repo.root ?? ''),
    head.operation !== 'none'
      ? React.createElement(React.Fragment, null,
        React.createElement('span', null, `正在${head.operation}…`),
        React.createElement('button', { className: 'dgw-retry', type: 'button', onClick: model.actions.continueOperation }, '继续'),
        React.createElement('button', { className: 'dgw-retry', type: 'button', onClick: model.actions.abortOperation }, '中止操作'),
      )
      : null,
    model.job === null
      ? null
      : React.createElement('span', null,
        `作业 ${model.job.kind}：${jobStatusLabel(model.job)}` + (model.job.status === 'running' && model.job.lines.length > 0 ? '  ' + (model.job.lines[model.job.lines.length - 1] ?? '') : ''),
      ),
    model.job !== null && model.job.status === 'running'
      ? React.createElement('button', { className: 'dgw-retry', type: 'button', onClick: model.actions.cancelJob }, '取消')
      : null,
    React.createElement('span', { className: 'dgw-spacer' }),
    model.snapshot === null
      ? null
      : React.createElement('span', null, `${head.branch ?? (head.detached ? 'HEAD 已分离' : 'HEAD')} · 更新于 ${formatWhen(new Date(model.snapshot.takenAt).toISOString())}`),
    React.createElement('span', null, `${width}×${height} · ${model.diffMode === 'side' ? '并排' : '统一'}`),
  )

  const logHead = React.createElement(
    'div',
    { className: 'dgw-rb__logHead' },
    React.createElement('span', { className: 'dgw-log-title' }, 'Git 日志'),
    React.createElement('span', { className: 'dgw-meta' }, `${model.commits.length} 个提交`),
    React.createElement('span', { className: 'dgw-spacer' }),
    showDetails
      ? null
      : iconButton('detail', '提交详情', React.createElement(ChevronIcon, { size: 13 }), () => setDrawerOpen(open => !open), { active: drawerOpen }),
    React.createElement('span', { className: 'dgw-meta' }, model.branchFilter === null ? '' : model.branchFilter),
  )

  const logBody = React.createElement(
    'div',
    { className: 'dgw-rb__logBody' },
    showBranches
      ? React.createElement(
        'div',
        { className: 'dgw-rb__logTree', style: { width: logTreeWidth, flexBasis: logTreeWidth } },
        React.createElement(BranchTree, {
        head,
        branches: model.branches,
        selectedRef: model.branchFilter,
        onSelect: model.actions.selectBranch,
        onCheckout: model.actions.checkoutBranch,
        onCreateBranch: model.actions.openCreateBranch,
        onRenameBranch: model.actions.openRenameBranch,
        onDeleteBranch: model.actions.openDeleteBranch,
        onMergeBranch: model.actions.mergeBranch,
        onRebaseBranch: model.actions.rebaseBranch,
        onDeleteTag: model.actions.deleteTag,
        onForcePush: model.actions.openForcePush,
      }),
      )
      : null,
    showBranches
      ? React.createElement('div', {
        className: 'dgw-rb__vsplit',
        title: '拖动调整分支树宽度',
        onPointerDown: (event: React.PointerEvent<HTMLDivElement>) => {
          event.preventDefault()
          setDrag({ kind: 'logTree', start: event.clientX, base: logTreeWidth })
        },
      })
      : null,
    React.createElement(LogList, {
      commits: model.commits,
      graph: model.graph,
      selectedOid: model.selectedOid,
      branchLabel: model.branchFilter,
      query: model.queryInput,
      loading: model.logLoading,
      hasMore: model.logHasMore,
      onSelect: (oid: string) => {
        model.actions.selectCommit(oid)
        if (!showDetails) setDrawerOpen(true)
      },
      onQueryChange: model.actions.search,
      onClearBranch: model.actions.clearBranch,
      onLoadMore: model.actions.loadMore,
      onCherryPick: model.actions.cherryPick,
      onRevert: model.actions.revert,
      onReset: model.actions.openReset,
      onTagCreate: model.actions.openTagCreate,
    }),
    showDetails
      ? React.createElement('div', {
        className: 'dgw-rb__vsplit',
        title: '拖动调整提交详情宽度',
        onPointerDown: (event: React.PointerEvent<HTMLDivElement>) => {
          event.preventDefault()
          setDrag({ kind: 'logDetail', start: event.clientX, base: logDetailWidth })
        },
      })
      : null,
    showDetails
      ? React.createElement(
        'div',
        { className: 'dgw-rb__logDetails', style: { width: logDetailWidth, flexBasis: logDetailWidth } },
        React.createElement(DetailsColumn, { model }),
      )
      : null,
    !showDetails && drawerOpen
      ? React.createElement(
        'div',
        { className: 'dgw-rb__drawer' },
        React.createElement('div', { className: 'dgw-rb__drawerHead' },
          React.createElement('span', { className: 'dgw-log-title' }, '提交详情'),
          React.createElement('span', { className: 'dgw-spacer' }),
          iconButton('drawer-close', '关闭详情', React.createElement(CloseIcon, { size: 13 }), () => setDrawerOpen(false)),
        ),
        React.createElement(DetailsColumn, { model }),
      )
      : null,
  )

  let body: React.ReactNode
  if (model.workspaceId === null) {
    body = React.createElement('div', { className: 'dgw-rb__empty' },
      React.createElement('div', { className: 'dgw-rb__emptyBox' }, '当前会话没有关联工作区'),
    )
  } else if (model.notRepo) {
    body = React.createElement(NoRepo, { onRetry: model.actions.retry })
  } else if (model.snapshot === null) {
    body = React.createElement('div', { className: 'dgw-rb__empty' },
      React.createElement('div', { className: 'dgw-rb__emptyBox' },
        React.createElement('div', null, model.snapshotLoading ? '正在读取仓库状态…' : '还没有仓库状态'),
        React.createElement('button', { className: 'dgw-retry', type: 'button', onClick: model.actions.retry }, '重试'),
      ),
    )
  } else {
    body = React.createElement(React.Fragment, null,
      React.createElement('div', { className: 'dgw-rb__main' },
        commitOpen
          ? React.createElement('div', { className: 'dgw-rb__commitCol', style: { width: effectiveCommitWidth + 'px' } },
            React.createElement(CommitPane, {
              runtime: model.runtime,
              workspaceId: model.workspaceId ?? '',
              snapshot: model.snapshot,
              onChanged: model.actions.changesChanged,
              groupByDirectory: true,
              collapsibleSections: true,
              selectedKey: model.target !== null && model.target.kind === 'change' ? `${model.target.group}:${model.target.path}` : null,
              onSelect: model.actions.selectChange,
            }),
          )
          : null,
        commitOpen
          ? React.createElement('div', {
            className: 'dgw-rb__vsplit',
            title: '拖动调整提交面板宽度',
            onPointerDown: (event: React.PointerEvent<HTMLDivElement>) => {
              event.preventDefault()
              setDrag({ kind: 'commit', start: event.clientX, base: effectiveCommitWidth })
            },
          })
          : null,
        React.createElement('div', { className: 'dgw-rb__diff' },
          diffHeader,
          React.createElement('div', { className: 'dgw-rb__diffScroll' },
            React.createElement(DiffView, {
              diff: model.diff,
              file: targetFile,
              loading: model.diffLoading,
              mode: model.diffMode,
              ...(model.diffHint === undefined ? {} : { hint: model.diffHint }),
            }),
          ),
        ),
      ),
      React.createElement('div', {
        className: 'dgw-rb__splitter',
        title: '拖动调整日志区高度',
        onPointerDown: (event: React.PointerEvent<HTMLDivElement>) => {
          event.preventDefault()
          setDrag({ kind: 'log', start: event.clientY, base: effectiveLogHeight })
        },
      }),
      React.createElement('div', { className: 'dgw-rb__log', style: { height: effectiveLogHeight + 'px' } }, logHead, logBody),
    )
  }

  return React.createElement(
    'div',
    { className: 'dgw dgw-rb' },
    React.createElement('style', null, CSS + RIGHTBAR_CSS),
    toolbar,
    React.createElement(ErrorBanner, { error: model.banner, onRetry: model.actions.retry }),
    body,
    statusBar,
    model.branchDialog === null
      ? null
      : React.createElement(BranchDialog, {
        prompt: model.branchDialog.prompt,
        value: model.branchDialog.value,
        force: model.branchDialog.force,
        busy: model.branchDialog.busy,
        error: model.branchDialog.error,
        onValue: model.actions.setBranchValue,
        onForce: model.actions.setBranchForce,
        onCancel: model.actions.cancelBranchDialog,
        onConfirm: model.actions.confirmBranchDialog,
      }),
    model.resetDialog === null
      ? null
      : React.createElement(ResetDialog, {
        hash: model.resetDialog.target,
        mode: model.resetDialog.mode,
        busy: model.resetDialog.busy,
        error: model.resetDialog.error,
        onMode: model.actions.setResetMode,
        onCancel: model.actions.cancelResetDialog,
        onConfirm: model.actions.confirmResetDialog,
      }),
    model.tagDialog === null
      ? null
      : React.createElement(TagDialog, {
        hash: model.tagDialog.target,
        value: model.tagDialog.value,
        busy: model.tagDialog.busy,
        error: model.tagDialog.error,
        onValue: model.actions.setTagValue,
        onCancel: model.actions.cancelTagDialog,
        onConfirm: model.actions.confirmTagDialog,
      }),
    model.tagDeleteDialog === null
      ? null
      : React.createElement(TagDeleteDialog, {
        name: model.tagDeleteDialog.name,
        busy: model.tagDeleteDialog.busy,
        error: model.tagDeleteDialog.error,
        onCancel: model.actions.cancelTagDeleteDialog,
        onConfirm: model.actions.confirmTagDeleteDialog,
      }),
    model.forcePushDialog === null
      ? null
      : React.createElement(ForcePushDialog, {
        branch: model.forcePushDialog.branch,
        busy: model.forcePushDialog.busy,
        error: model.forcePushDialog.error,
        onCancel: model.actions.cancelForcePushDialog,
        onConfirm: model.actions.confirmForcePushDialog,
      }),
    updateDialog === null
      ? null
      : React.createElement(UpdateDialog, {
        mode: updateDialog.mode,
        busy: model.jobBusy,
        canReset: upstreamOid !== null,
        onMode: (mode: UpdateMode) => setUpdateDialog({ mode }),
        onReset: () => {
          if (upstreamOid === null) return
          setUpdateDialog(null)
          model.actions.openReset(upstreamOid)
        },
        onCancel: () => setUpdateDialog(null),
        onConfirm: confirmUpdate,
      }),
    pushOpen
      ? React.createElement(PushDialog, {
        branch: model.head?.branch ?? '',
        remote: model.snapshot?.remotes[0]?.name ?? null,
        upstream: model.head?.upstream?.ref ?? null,
        preview: pushPreview,
        loading: pushPreviewLoading,
        error: pushPreviewError,
        busy: model.jobBusy,
        canForce: model.head?.upstream != null,
        force: pushForce,
        onForce: setPushForce,
        onPush: () => {
          setPushOpen(false)
          model.actions.push(pushForce)
        },
        onCancel: () => { if (!model.jobBusy) setPushOpen(false) },
      })
      : null,
  )
}
