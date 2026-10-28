/**
 * SSR smoke tests for the Git tool window: build the real panel over a fixture
 * runtime and render it with React's server renderer. This catches a broken
 * element tree, missing theme tokens and pane wiring without a browser.
 *
 * @module dsh-session-map/git-workspace/window/window.test
 */
import * as React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import type { CommitDetail, CommitRow, RepoSnapshot } from '../git-types'
import { BranchTree, DetailPane, LogList } from './log'
import { ConsolePane } from './console'
import { CommitPane } from './commit'
import { computeGraph } from './lanes'
import { createGitPanel, type GitPanelProps } from './shell'
import type { GitWindowApi } from './runtime'

/** One workspace row for the fake framework hooks. */
const WORKSPACES = {
  items: [
    { workspaceId: 'workspace-1', title: 'dsh-session-map', path: '/repo', sessionIds: ['session-1'] },
  ],
}

/** One commit row. */
function commit(oid: string, subject: string): CommitRow {
  return {
    oid,
    shortOid: oid.slice(0, 7),
    parents: ['parent'],
    author: { name: 'Alice', email: 'alice@example.com', date: '2026-10-27T15:04:00+08:00' },
    committer: { name: 'Alice', email: 'alice@example.com', date: '2026-10-27T15:04:00+08:00' },
    subject,
    decorations: [],
    refs: { branches: ['main'], remoteBranches: ['origin/main'], tags: [] },
  }
}

/** A snapshot fixture. */
const SNAPSHOT: RepoSnapshot = {
  takenAt: Date.now(),
  stale: false,
  truncated: false,
  version: 'v1',
  repo: { root: '/repo', gitDir: '/repo/.git', isBare: false, isWorktree: false },
  head: {
    oid: '1111111111111111111111111111111111111111',
    branch: 'main',
    detached: false,
    unborn: false,
    upstream: { ref: 'origin/main', ahead: 2, behind: 1, gone: false },
    operation: 'none',
  },
  changes: [],
  counts: { staged: 0, unstaged: 0, untracked: 0, conflicted: 0 },
  stashCount: 0,
  branches: [
    {
      ref: 'refs/heads/main', name: 'main', oid: '1111111111111111111111111111111111111111',
      type: 'local', isHead: true, upstream: 'origin/main', track: { ahead: 2, behind: 1, gone: false },
      date: '2026-10-27T15:04:00+08:00', subject: 'initial',
    },
    {
      ref: 'refs/remotes/origin/main', name: 'origin/main', oid: '1111111111111111111111111111111111111111',
      type: 'remote', isHead: false, upstream: null, track: null,
      date: '2026-10-27T15:04:00+08:00', subject: 'initial',
    },
  ],
  remotes: [{ name: 'origin', url: 'https://example.com/repo.git' }],
}

/** A commit detail fixture. */
const DETAIL: CommitDetail = {
  ...commit('1111111111111111111111111111111111111111', 'Merge branch v2.1'),
  message: 'Merge branch v2.1\n\nCo-authored-by: X <x@example.com>',
  files: [
    { path: 'src/app.ts', status: 'M', additions: 3, deletions: 2, binary: false },
    { path: 'assets/logo.png', status: 'A', additions: null, deletions: null, binary: true },
  ],
  containedInBranches: ['main', 'origin/main'],
}

/** A runtime whose round-trips never leave the process. */
const runtime: GitWindowApi = {
  snapshot: async () => ({ snapshot: SNAPSHOT, commands: [] }),
  log: async () => ({ commits: [commit('1111111111111111111111111111111111111111', 'Merge branch v2.1')], hasMore: false, truncated: false, commands: [] }),
  commit: async () => ({ commit: DETAIL, commands: [] }),
  diff: async () => ({ patch: '', binary: false, truncated: false, commands: [] }),
  pushPreview: async () => ({ preview: { upstream: null, commits: [], files: [], truncated: false }, commands: [] }),
  confirm: async () => ({ token: 'token', expiresAt: Date.now() + 60_000 }),
  action: async () => ({ commands: [], summary: 'ok' }),
  job: async (id: string) => ({
    id,
    kind: 'fetch',
    workspaceId: 'workspace-1',
    status: 'done' as const,
    lines: [],
    startedAt: Date.now(),
    finishedAt: Date.now(),
  }),
  cancelJob: async (id: string) => ({
    id,
    kind: 'fetch',
    workspaceId: 'workspace-1',
    status: 'cancelled' as const,
    lines: [],
    startedAt: Date.now(),
  }),
}

/** Fake framework hooks. */
const props: GitPanelProps = {
  useWorkspaces: (<T,>(selector: (state: typeof WORKSPACES) => T): T => selector(WORKSPACES)) as GitPanelProps['useWorkspaces'],
  useSessions: (<T,>(selector: (state: { current?: string }) => T): T => selector({ current: 'session-1' })) as GitPanelProps['useSessions'],
}

describe('Git panel shell', () => {
  it('renders the header, tabs and empty selection state', () => {
    const Panel = createGitPanel(runtime)
    const markup = renderToStaticMarkup(React.createElement(Panel, props))
    expect(markup).toContain('Git')
    expect(markup).toContain('日志')
    expect(markup).toContain('控制台')
    expect(markup).toContain('分支或标签')
    expect(markup).toContain('文本或哈希')
    expect(markup).toContain('选择一个提交查看详情')
    expect(markup).toContain('dsh-session-map')
    // The log tab exposes two draggable column splitters around the commit list.
    expect(markup).toContain('dgw-treeCol')
    expect(markup).toContain('dgw-detailCol')
    expect(markup.match(/class="dgw-splitter"/g)).toHaveLength(2)
  })

  it('ships its own stylesheet with theme tokens', () => {
    const Panel = createGitPanel(runtime)
    const markup = renderToStaticMarkup(React.createElement(Panel, props))
    expect(markup).toContain('<style>')
    expect(markup).toContain('--dsw-alias-bg-base')
    expect(markup).toContain('--dsw-alias-border-l1')
  })
})

describe('BranchTree', () => {
  it('renders the HEAD section and both ref groups', () => {
    const markup = renderToStaticMarkup(React.createElement(BranchTree, {
      head: SNAPSHOT.head,
      branches: SNAPSHOT.branches,
      selectedRef: null,
      onSelect: () => undefined,
      onCheckout: () => undefined,
      onCreateBranch: () => undefined,
      onRenameBranch: () => undefined,
      onDeleteBranch: () => undefined,
      onMergeBranch: () => undefined,
      onRebaseBranch: () => undefined,
      onDeleteTag: () => undefined,
      onForcePush: () => undefined,
    }))
    expect(markup).toContain('HEAD(当前分支)')
    expect(markup).toContain('本地 (1)')
    expect(markup).toContain('远程 (1)')
    expect(markup).toContain('main')
    expect(markup).toContain('origin')
    expect(markup).toContain('全部展开')
    expect(markup).toContain('全部收起')
  })
})

describe('LogList', () => {
  it('renders graph, subject, ref pills and metadata', () => {
    const commits = [commit('1111111111111111111111111111111111111111', 'Merge branch v2.1')]
    const markup = renderToStaticMarkup(React.createElement(LogList, {
      commits,
      graph: computeGraph(commits),
      selectedOid: null,
      branchLabel: 'main',
      query: '',
      loading: false,
      hasMore: true,
      onSelect: () => undefined,
      onQueryChange: () => undefined,
      onClearBranch: () => undefined,
      onLoadMore: () => undefined,
      onCherryPick: () => undefined,
      onRevert: () => undefined,
      onReset: () => undefined,
      onTagCreate: () => undefined,
    }))
    expect(markup).toContain('Merge branch v2.1')
    expect(markup).toContain('origin &amp; main')
    expect(markup).toContain('Alice')
    expect(markup).toContain('加载更多')
    expect(markup).toContain('<svg')
  })

  it('marks merge commits but keeps their subject text', () => {
    const merge = {
      ...commit('2222222222222222222222222222222222222222', 'Merge branch v2.1'),
      parents: ['aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa', 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb'],
    }
    const commits = [merge]
    const markup = renderToStaticMarkup(React.createElement(LogList, {
      commits,
      graph: computeGraph(commits),
      selectedOid: null,
      branchLabel: null,
      query: '',
      loading: false,
      hasMore: false,
      onSelect: () => undefined,
      onQueryChange: () => undefined,
      onClearBranch: () => undefined,
      onLoadMore: () => undefined,
      onCherryPick: () => undefined,
      onRevert: () => undefined,
      onReset: () => undefined,
      onTagCreate: () => undefined,
    }))
    expect(markup).toContain('dgw-row--merge')
    expect(markup).toContain('Merge branch v2.1')
    // The merge row draws a curved fork into the parent lane.
    expect(markup).toContain('dgw-mergeEdge')
  })
})

describe('DetailPane', () => {
  it('lets the message area fill the pane until a file is selected', () => {
    const markup = renderToStaticMarkup(React.createElement(DetailPane, {
      detail: DETAIL,
      loading: false,
      selectedFile: null,
      diff: null,
      diffLoading: false,
      onSelectFile: () => undefined,
    }))
    expect(markup).toContain('Co-authored-by: X')
    expect(markup).toContain('在 2 个分支中')
    expect(markup).toContain('src/app.ts')
    expect(markup).toContain('二进制')
    expect(markup).not.toContain('dgw-detailScroll--pinned')
    expect(markup).not.toContain('选择一个文件查看差异')
  })

  it('splits the pane with the diff once a file is selected', () => {
    const markup = renderToStaticMarkup(React.createElement(DetailPane, {
      detail: DETAIL,
      loading: false,
      selectedFile: 'src/a.ts',
      diff: null,
      diffLoading: false,
      onSelectFile: () => undefined,
    }))
    expect(markup).toContain('dgw-detailScroll--pinned')
  })
})

describe('ConsolePane', () => {
  it('renders executions and their exit codes', () => {
    const markup = renderToStaticMarkup(React.createElement(ConsolePane, {
      commands: [
        { argv: ['/usr/bin/git', 'status'], cwd: '/repo', exitCode: 0, ms: 42 },
        { argv: ['/usr/bin/git', 'diff'], cwd: '/repo', exitCode: 1, ms: 7 },
      ],
    }))
    expect(markup).toContain('exit 0')
    expect(markup).toContain('exit 1')
    expect(markup).toContain('42 ms')
  })
})

describe('CommitPane', () => {
  const withChanges: RepoSnapshot = {
    ...SNAPSHOT,
    changes: [
      { path: 'src/app.ts', xy: { index: 'M', worktree: '.' }, kind: 'ordinary', group: 'staged', status: 'M' },
      { path: 'README.md', xy: { index: '.', worktree: 'M' }, kind: 'ordinary', group: 'unstaged', status: 'M' },
      { path: 'tmp/new.txt', xy: { index: '.', worktree: '?' }, kind: 'untracked', group: 'untracked', status: '?' },
    ],
    counts: { staged: 1, unstaged: 1, untracked: 1, conflicted: 0 },
  }

  it('renders the three change groups and the commit controls', () => {
    const markup = renderToStaticMarkup(React.createElement(CommitPane, {
      runtime,
      workspaceId: 'workspace-1',
      snapshot: withChanges,
      onChanged: () => undefined,
    }))
    expect(markup).toContain('暂存区 (1)')
    expect(markup).toContain('未暂存 (1)')
    expect(markup).toContain('未版本控制 (1)')
    expect(markup).toContain('src/app.ts')
    expect(markup).toContain('修正上次提交')
    expect(markup).toContain('丢弃搁置')
    expect(markup).toContain('提交并推送')
    expect(markup).toContain('提交信息')
    expect(markup).toContain('已暂存 1')
  })

  it('shows the clean-tree copy when nothing changed', () => {
    const markup = renderToStaticMarkup(React.createElement(CommitPane, {
      runtime,
      workspaceId: 'workspace-1',
      snapshot: SNAPSHOT,
      onChanged: () => undefined,
    }))
    expect(markup).toContain('没有要提交的内容，工作树是干净的')
  })
})
