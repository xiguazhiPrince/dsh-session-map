/**
 * Commit-pane tests for the right-column presentation: directory grouping,
 * collapsible sections, the previewed-row highlight and the split between the
 * staging checkbox and the row click.
 *
 * @module dsh-session-map/git-workspace/window/commit.test
 */
import * as React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import type { RepoSnapshot } from '../git-types'
import { CommitPane } from './commit'
import type { GitWindowApi } from './runtime'

/** A runtime whose round-trips never leave the process. */
const runtime: GitWindowApi = {
  snapshot: async () => ({ snapshot: SNAPSHOT, commands: [] }),
  log: async () => ({ commits: [], hasMore: false, truncated: false, commands: [] }),
  commit: async () => { throw new Error('not used') },
  diff: async () => ({ patch: '', binary: false, truncated: false, commands: [] }),
  confirm: async () => ({ token: 'token', expiresAt: Date.now() + 60_000 }),
  action: async () => ({ commands: [], summary: 'ok' }),
  job: async () => { throw new Error('not used') },
  cancelJob: async () => { throw new Error('not used') },
}

/** A snapshot with changes spread over several directories. */
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
    upstream: null,
    operation: 'none',
  },
  changes: [
    { path: 'src/a.ts', xy: { index: 'M', worktree: '.' }, kind: 'ordinary', group: 'staged', status: 'M' },
    { path: 'src/b.ts', xy: { index: '.', worktree: 'M' }, kind: 'ordinary', group: 'unstaged', status: 'M' },
    { path: 'docs/c.md', xy: { index: '.', worktree: 'M' }, kind: 'ordinary', group: 'unstaged', status: 'M' },
    { path: 'tmp/d.txt', xy: { index: '.', worktree: '?' }, kind: 'untracked', group: 'untracked', status: '?' },
  ],
  counts: { staged: 1, unstaged: 2, untracked: 1, conflicted: 0 },
  stashCount: 0,
  branches: [],
  remotes: [],
}

describe('CommitPane (right-column presentation)', () => {
  const props = {
    runtime,
    workspaceId: 'workspace-1',
    snapshot: SNAPSHOT,
    onChanged: () => undefined,
    groupByDirectory: true,
    collapsibleSections: true,
    selectedKey: 'unstaged:src/b.ts',
    onSelect: () => undefined,
  }

  it('groups rows under directory buttons and keeps the file rows below them', () => {
    const markup = renderToStaticMarkup(React.createElement(CommitPane, props))
    expect(markup).toContain('dgw-changeDir')
    expect(markup).toContain('src')
    expect(markup).toContain('docs')
    expect(markup).toContain('个文件')
    expect(markup).toContain('a.ts')
    expect(markup).toContain('c.md')
    expect(markup).toContain('d.txt')
  })

  it('marks the previewed row and makes the checkbox the staging control', () => {
    const markup = renderToStaticMarkup(React.createElement(CommitPane, props))
    expect(markup).toContain('dgw-changeRow--active')
    expect(markup).toContain('dgw-checkbox--button')
    expect(markup).toContain('aria-pressed')
    expect(markup).toContain('dgw-changeGuide')
  })

  it('renders collapsible section headers', () => {
    const markup = renderToStaticMarkup(React.createElement(CommitPane, props))
    expect(markup).toContain('dgw-changeHead--button')
    expect(markup).toContain('暂存区 (1)')
    expect(markup).toContain('未暂存 (2)')
    expect(markup).toContain('未版本控制 (1)')
  })

  it('keeps the flat list and the row-click toggle when the new props are absent', () => {
    const markup = renderToStaticMarkup(React.createElement(CommitPane, {
      runtime,
      workspaceId: 'workspace-1',
      snapshot: SNAPSHOT,
      onChanged: () => undefined,
    }))
    expect(markup).not.toContain('dgw-changeDir')
    expect(markup).not.toContain('dgw-checkbox--button')
    expect(markup).toContain('提交并推送')
  })
})
