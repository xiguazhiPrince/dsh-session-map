/**
 * SSR tests for the Git right-column layout: the wide page, the narrow page, and
 * the three empty states. Fixtures feed the presentational layout directly, so
 * the assertions do not depend on the Host round-trips.
 *
 * @module dsh-session-map/git-workspace/window/rightbar/page.test
 */
import * as React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import type { BranchRef, CommitDetail, CommitRow, DiffView, RepoSnapshot } from '../../git-types'
import { computeGraph } from '../lanes'
import type { GitWindowApi } from '../runtime'
import { GitRightbarLayout } from './layout'
import type { GitRightbarActions, GitRightbarModel } from './model'

/** A runtime whose round-trips never leave the process. */
const runtime: GitWindowApi = {
  snapshot: async () => ({ snapshot: SNAPSHOT, commands: [] }),
  log: async () => ({ commits: [], hasMore: false, truncated: false, commands: [] }),
  commit: async () => { throw new Error('not used') },
  diff: async () => ({ patch: '', binary: false, truncated: false, commands: [] }),
  pushPreview: async () => ({ preview: { upstream: null, commits: [], files: [], truncated: false }, commands: [] }),
  confirm: async () => ({ token: 'token', expiresAt: Date.now() + 60_000 }),
  action: async () => ({ commands: [], summary: 'ok' }),
  job: async () => { throw new Error('not used') },
  cancelJob: async () => { throw new Error('not used') },
}

const HEAD_OID = '1111111111111111111111111111111111111111'

const COMMIT: CommitRow = {
  oid: HEAD_OID,
  shortOid: '1111111',
  parents: ['parent'],
  author: { name: 'Alice', email: 'alice@example.com', date: '2026-10-27T15:04:00+08:00' },
  committer: { name: 'Alice', email: 'alice@example.com', date: '2026-10-27T15:04:00+08:00' },
  subject: 'Add the right-column Git page',
  decorations: [],
  refs: { branches: ['main'], remoteBranches: ['origin/main'], tags: [] },
}

const BRANCHES: readonly BranchRef[] = [
  {
    ref: 'refs/heads/main', name: 'main', oid: HEAD_OID, type: 'local', isHead: true,
    upstream: 'origin/main', track: { ahead: 2, behind: 1, gone: false },
    date: '2026-10-27T15:04:00+08:00', subject: 'initial',
  },
  {
    ref: 'refs/remotes/origin/main', name: 'origin/main', oid: HEAD_OID, type: 'remote', isHead: false,
    upstream: null, track: null,
    date: '2026-10-27T15:04:00+08:00', subject: 'initial',
  },
]

const SNAPSHOT: RepoSnapshot = {
  takenAt: Date.now(),
  stale: false,
  truncated: false,
  version: 'v1',
  repo: { root: '/repo', gitDir: '/repo/.git', isBare: false, isWorktree: false },
  head: {
    oid: HEAD_OID,
    branch: 'main',
    detached: false,
    unborn: false,
    upstream: { ref: 'origin/main', ahead: 2, behind: 1, gone: false },
    operation: 'none',
  },
  changes: [
    { path: 'src/a.ts', xy: { index: 'M', worktree: '.' }, kind: 'ordinary', group: 'staged', status: 'M' },
    { path: 'docs/b.md', xy: { index: '.', worktree: 'M' }, kind: 'ordinary', group: 'unstaged', status: 'M' },
  ],
  counts: { staged: 1, unstaged: 1, untracked: 0, conflicted: 0 },
  stashCount: 0,
  branches: BRANCHES,
  remotes: [{ name: 'origin', url: 'https://example.com/repo.git' }],
}

const DETAIL: CommitDetail = {
  ...COMMIT,
  message: 'Add the right-column Git page\n\nCo-authored-by: X <x@example.com>',
  files: [
    { path: 'src/a.ts', status: 'M', additions: 3, deletions: 2, binary: false },
    { path: 'docs/b.md', status: 'A', additions: 7, deletions: 0, binary: false },
  ],
  containedInBranches: ['main', 'origin/main'],
}

const DIFF: DiffView = {
  path: 'src/a.ts',
  binary: false,
  truncated: false,
  hunks: [{
    oldStart: 3,
    oldLines: 2,
    newStart: 3,
    newLines: 3,
    lines: [
      { kind: ' ', text: '  const a = 1', oldLine: 3, newLine: 3 },
      { kind: '-', text: '  return legacy()', oldLine: 4, newLine: null },
      { kind: '+', text: '  return render()', oldLine: null, newLine: 4 },
    ],
  }],
}

/** No-op action surface; individual tests do not invoke it. */
const noop = (): void => undefined

const ACTIONS: GitRightbarActions = {
  refresh: noop,
  retry: noop,
  fetchAll: noop,
  updateBranch: noop,
  push: noop,
  cancelJob: noop,
  search: noop,
  clearBranch: noop,
  selectBranch: noop,
  loadMore: noop,
  selectCommit: noop,
  selectChange: noop,
  selectCommitFile: noop,
  openCommitFile: noop,
  continueOperation: noop,
  abortOperation: noop,
  checkoutBranch: noop,
  openCreateBranch: noop,
  openRenameBranch: noop,
  openDeleteBranch: noop,
  mergeBranch: noop,
  rebaseBranch: noop,
  deleteTag: noop,
  openForcePush: noop,
  cherryPick: noop,
  revert: noop,
  openReset: noop,
  openTagCreate: noop,
  changesChanged: noop,
  toggleCommitPanel: noop,
  setCommitWidth: noop,
  setLogTreeWidth: noop,
  setLogDetailWidth: noop,
  setLogHeight: noop,
  cycleDiffMode: noop,
  setBranchValue: noop,
  setBranchForce: noop,
  cancelBranchDialog: noop,
  confirmBranchDialog: noop,
  setResetMode: noop,
  cancelResetDialog: noop,
  confirmResetDialog: noop,
  setTagValue: noop,
  cancelTagDialog: noop,
  confirmTagDialog: noop,
  cancelTagDeleteDialog: noop,
  confirmTagDeleteDialog: noop,
  cancelForcePushDialog: noop,
  confirmForcePushDialog: noop,
}

/** Build the full model fixture, overriding only what a test needs. */
function makeModel(overrides: Partial<GitRightbarModel> = {}): GitRightbarModel {
  const commits = [COMMIT]
  return {
    runtime,
    workspaceId: 'workspace-1',
    snapshot: SNAPSHOT,
    snapshotLoading: false,
    banner: null,
    notRepo: false,
    head: SNAPSHOT.head,
    branches: BRANCHES,
    commits,
    graph: computeGraph(commits),
    logLoading: false,
    logHasMore: false,
    branchFilter: null,
    queryInput: '',
    selectedOid: HEAD_OID,
    detail: DETAIL,
    detailLoading: false,
    target: { kind: 'commit', hash: HEAD_OID, path: 'src/a.ts' },
    diff: DIFF,
    diffLoading: false,
    diffHint: undefined,
    diffMode: 'side',
    commitOpen: true,
    commitWidth: 320,
    logTreeWidth: 240,
    logDetailWidth: 320,
    logHeight: 320,
    job: null,
    jobBusy: false,
    branchDialog: null,
    resetDialog: null,
    tagDialog: null,
    tagDeleteDialog: null,
    forcePushDialog: null,
    actions: ACTIONS,
    ...overrides,
  }
}

describe('GitRightbarLayout', () => {
  it('renders the full wide page', () => {
    const markup = renderToStaticMarkup(React.createElement(GitRightbarLayout, {
      size: { width: 1_200, height: 900 },
      workspaceLabel: 'dsh-session-map',
      model: makeModel(),
      onFullscreen: noop,
      onClose: noop,
    }))
    expect(markup).toContain('Git')
    expect(markup).toContain('main')
    expect(markup).toContain('dsh-session-map')
    expect(markup).toContain('分支或标签')
    expect(markup).toContain('文本或哈希')
    expect(markup).toContain('更改的文件')
    expect(markup).toContain('Add the right-column Git page')
    expect(markup).toContain('提交并推送')
    expect(markup).toContain('仓库差异')
    expect(markup).toContain('提交 1111111')
    expect(markup).toContain('dgw-diffSideRow')
    // Wide panes show the labelled header actions, with the long explanation
    // carried by the native tooltip.
    expect(markup).toContain('dgw-rb__toolText')
    expect(markup).toContain('dgw-rb__logTree')
    expect(markup).toContain('dgw-rb__logDetails')
    expect(markup).toContain('dgw-rb__detailsDiff')
    expect(markup).toContain('dgw-rb__detailsSplit')
    expect(markup).toContain('dgw-rb__detailsMessage')
    expect(markup).toContain('下载远端状态')
    expect(markup).toContain('更新当前分支')
    expect(markup).toContain('推送')
    expect(markup).toContain('fetch --all --prune')
    expect(markup).not.toContain('class="dgw-rb__top dgw-rb__top--compact"')
  })

  it('collapses the commit panel and the branch tree in a narrow page', () => {
    const markup = renderToStaticMarkup(React.createElement(GitRightbarLayout, {
      size: { width: 420, height: 700 },
      workspaceLabel: 'dsh-session-map',
      model: makeModel({ commitOpen: false }),
      onFullscreen: noop,
      onClose: noop,
    }))
    expect(markup).not.toContain('提交并推送')
    expect(markup).not.toContain('分支或标签')
    expect(markup).toContain('仓库差异')
    expect(markup).toContain('提交详情')
    // The words are in the DOM but the compact class hides them visually.
    expect(markup).toContain('class="dgw-rb__top dgw-rb__top--compact"')
  })

  it('renders the empty states', () => {
    const noWorkspace = renderToStaticMarkup(React.createElement(GitRightbarLayout, {
      size: { width: 900, height: 800 },
      workspaceLabel: '',
      model: makeModel({ workspaceId: null, snapshot: null, detail: null, target: null, diff: null }),
      onFullscreen: noop,
      onClose: noop,
    }))
    expect(noWorkspace).toContain('当前会话没有关联工作区')

    const notRepo = renderToStaticMarkup(React.createElement(GitRightbarLayout, {
      size: { width: 900, height: 800 },
      workspaceLabel: 'plain-dir',
      model: makeModel({ notRepo: true, snapshot: null }),
      onFullscreen: noop,
      onClose: noop,
    }))
    expect(notRepo).toContain('当前工作区不是 git 仓库')

    const loading = renderToStaticMarkup(React.createElement(GitRightbarLayout, {
      size: { width: 900, height: 800 },
      workspaceLabel: 'dsh-session-map',
      model: makeModel({ snapshot: null, snapshotLoading: true }),
      onFullscreen: noop,
      onClose: noop,
    }))
    expect(loading).toContain('正在读取仓库状态…')
  })

  it('shows the in-progress operation banner with continue and abort', () => {
    const markup = renderToStaticMarkup(React.createElement(GitRightbarLayout, {
      size: { width: 1_200, height: 900 },
      workspaceLabel: 'dsh-session-map',
      model: makeModel({
        head: { ...SNAPSHOT.head, operation: 'merge' },
        snapshot: { ...SNAPSHOT, head: { ...SNAPSHOT.head, operation: 'merge' } },
      }),
      onFullscreen: noop,
      onClose: noop,
    }))
    expect(markup).toContain('正在merge')
    expect(markup).toContain('继续')
    expect(markup).toContain('中止操作')
  })
})
