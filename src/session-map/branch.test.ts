/**
 * Git branch reading tests: normal repositories, linked worktrees, submodule
 * checkouts, detached HEADs, folders without a repository, and the failure the
 * badge must not mistake for "no repository".
 *
 * @module dsh-session-map/session-map/branch.test
 */
import * as React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import {
  branchBadgeView,
  createGitBranchBadge,
  parseGitdir,
  parseHead,
  readGitBranch,
  resolveGitPath,
  type RemoteFailure,
  type WorkspaceFilesRemote,
  type WorkspaceFileText,
} from './branch'

/** One successful page of text. */
function file(absolutePath: string, text: string): WorkspaceFileText {
  return { absolutePath, text, version: '1', lines: 1, offset: 1, eof: true }
}

/** The failure a path that is not there in the asked form produces. */
const NOT_FOUND: RemoteFailure = { code: 'workspace-file/not-found', message: 'not found' }

/** A fake Host file Remote over a fixed path table; an absent path is not-found. */
function filesWith(
  table: Readonly<Record<string, WorkspaceFileText | RemoteFailure>>,
): WorkspaceFilesRemote {
  return {
    async read(_sessionId, path) {
      const entry = table[path]
      if (entry === undefined) return { ok: false, error: NOT_FOUND }
      if ('text' in entry) return { ok: true, value: entry }
      return { ok: false, error: entry }
    },
    changes() {
      throw new Error('the reader tests never watch')
    },
  }
}

/** Read one branch with a live signal. */
async function read(table: Readonly<Record<string, WorkspaceFileText | RemoteFailure>>) {
  return readGitBranch(filesWith(table), 'session', new AbortController().signal)
}

describe('parseHead', () => {
  it('reads a branch ref with either line ending', () => {
    expect(parseHead('ref: refs/heads/master\n')).toEqual({ branch: 'master', detached: false })
    expect(parseHead('ref: refs/heads/feature/a\r\n')).toEqual({ branch: 'feature/a', detached: false })
  })

  it('shortens a detached commit and keeps other refs whole', () => {
    expect(parseHead('0123456789abcdef0123456789abcdef01234567\n'))
      .toEqual({ branch: '0123456', detached: true })
    expect(parseHead('ref: refs/tags/v1.0.0\n'))
      .toEqual({ branch: 'refs/tags/v1.0.0', detached: true })
  })

  it('rejects text that is not a HEAD', () => {
    expect(parseHead('')).toBeUndefined()
    expect(parseHead('not a ref\n')).toBeUndefined()
    expect(parseHead('ref: refs/heads/\n')).toBeUndefined()
  })
})

describe('parseGitdir', () => {
  it('reads the gitdir line, including a BOM', () => {
    expect(parseGitdir('\uFEFFgitdir: /repo/.git/worktrees/wt\n'))
      .toBe('/repo/.git/worktrees/wt')
    expect(parseGitdir('gitdir:   ../.git/modules/sub  \n'))
      .toBe('../.git/modules/sub')
  })

  it('rejects a plain .git directory content', () => {
    expect(parseGitdir('ref: refs/heads/master\n')).toBeUndefined()
    expect(parseGitdir('')).toBeUndefined()
  })
})

describe('resolveGitPath', () => {
  it('keeps an absolute target and collapses its segments', () => {
    expect(resolveGitPath('/repo/.git', '/repo/.git/worktrees/wt'))
      .toBe('/repo/.git/worktrees/wt')
    expect(resolveGitPath('/repo/.git', 'C:\\repo\\.git\\worktrees\\wt'))
      .toBe('C:/repo/.git/worktrees/wt')
  })

  it('resolves a relative target from the directory holding .git', () => {
    expect(resolveGitPath('/repo/sub/.git', '../.git/modules/sub'))
      .toBe('/repo/.git/modules/sub')
  })
})

describe('readGitBranch', () => {
  it('reads a normal repository branch and watches its HEAD', async () => {
    const state = await read({
      '.git/HEAD': file('/repo/.git/HEAD', 'ref: refs/heads/master\n'),
    })
    expect(state).toEqual({
      status: 'branch',
      branch: 'master',
      detached: false,
      headPath: '/repo/.git/HEAD',
    })
  })

  it('follows a linked worktree .git file to its own HEAD', async () => {
    const state = await read({
      '.git': file('/repo/.git', 'gitdir: /repo/.git/worktrees/wt\n'),
      '/repo/.git/worktrees/wt/HEAD': file(
        '/repo/.git/worktrees/wt/HEAD',
        'ref: refs/heads/worktree-branch\n',
      ),
    })
    expect(state).toEqual({
      status: 'branch',
      branch: 'worktree-branch',
      detached: false,
      headPath: '/repo/.git/worktrees/wt/HEAD',
    })
  })

  it('resolves a submodule checkout written with a relative gitdir', async () => {
    const state = await read({
      '.git': file('/repo/sub/.git', 'gitdir: ../.git/modules/sub\n'),
      '/repo/.git/modules/sub/HEAD': file(
        '/repo/.git/modules/sub/HEAD',
        'ref: refs/heads/sub\n',
      ),
    })
    expect(state.status).toBe('branch')
    if (state.status === 'branch') expect(state.branch).toBe('sub')
  })

  it('reports a folder without a repository and watches for .git creation', async () => {
    expect(await read({})).toEqual({ status: 'none', watchPath: '.git' })
  })

  it('reports a detached HEAD by its short commit', async () => {
    const state = await read({
      '.git/HEAD': file('/repo/.git/HEAD', '0123456789abcdef0123456789abcdef01234567\n'),
    })
    expect(state).toEqual({
      status: 'branch',
      branch: '0123456',
      detached: true,
      headPath: '/repo/.git/HEAD',
    })
  })

  it('keeps a real read failure distinct from an absent repository', async () => {
    const state = await read({
      '.git/HEAD': { code: 'gateway/internal', message: 'permission denied' },
    })
    expect(state).toEqual({ status: 'error', message: 'permission denied' })
  })
})

describe('branchBadgeView', () => {
  it('renders the branch, the detached hash, and the tooltip', () => {
    expect(branchBadgeView({
      status: 'branch', branch: 'feature/x', detached: false, headPath: '/repo/.git/HEAD',
    })).toEqual({
      text: 'feature/x',
      title: '当前 Git 分支：feature/x',
      className: 'dsm-git',
    })
    expect(branchBadgeView({
      status: 'branch', branch: '0123456', detached: true, headPath: '/repo/.git/HEAD',
    }).title).toBe('分离 HEAD：0123456')
  })

  it('names the absent repository and the failed read without pretending either is a branch', () => {
    expect(branchBadgeView({ status: 'none', watchPath: '.git' }).text).toBe('无 Git 仓库')
    expect(branchBadgeView({ status: 'loading' }).text).toBe('Git …')
    expect(branchBadgeView({ status: 'error', message: 'denied' })).toMatchObject({
      text: 'Git 读取失败',
      className: 'dsm-git dsm-git--error',
    })
  })
})

describe('GitBranchBadge', () => {
  it('renders the loading badge into the composer row', () => {
    const Badge = createGitBranchBadge({ workspaceFiles: filesWith({}) })
    const html = renderToStaticMarkup(React.createElement(Badge, { sessionId: 'session' }))
    expect(html).toContain('class="dsm-git dsm-git--muted"')
    expect(html).toContain('Git …')
    expect(html).toContain('aria-label="正在读取当前 Git 分支"')
  })
})
