/**
 * Real-git integration tests for the safety-critical write paths.
 *
 * These run only when `GIT_WS_IT=1` and git exists: they create a throwaway
 * repository, install the real Host routes over a local subprocess adapter and
 * assert on the actual working tree, not on mocked output.
 *
 * @module dsh-session-map/git-workspace/safety.integration.test
 */
import { readFile, stat } from 'node:fs/promises'
import { afterEach, describe, expect, it } from 'vitest'
import type { Context } from '@deepseek-ai/cordis'
import { installGitWorkspaceHost } from './host'
import { createHostHarness, invokeRoute, type HostHarness } from './testing/fake-host'
import { LocalSubprocess } from './testing/real-subprocess'
import { createTempRepo, hasGit, type TempRepo } from './testing/temp-repo'

const enabled = hasGit() && process.env['GIT_WS_IT'] === '1'

/** One repository plus harness pair created by a test. */
interface Fixture {
  readonly repo: TempRepo
  readonly harness: HostHarness
  readonly subprocess: LocalSubprocess
}

const fixtures: Fixture[] = []

/** Build the real Host over a temp repository. */
async function fixture(): Promise<Fixture> {
  const repo = await createTempRepo()
  const subprocess = new LocalSubprocess()
  const harness = createHostHarness(subprocess as never, repo.dir)
  installGitWorkspaceHost(harness.ctx as unknown as Context)
  const entry = { repo, harness, subprocess }
  fixtures.push(entry)
  return entry
}

afterEach(async () => {
  await Promise.all(fixtures.splice(0).map(async entry => {
    await entry.repo.dispose()
  }))
})

const describeIntegration = enabled ? describe : describe.skip

describeIntegration('git window integration', () => {
  it('reads a real snapshot', async () => {
    const { harness } = await fixture()
    const response = await invokeRoute(harness.server, {
      path: '/plugin-git-workspace/snapshot?workspaceId=workspace-1',
    })
    expect(response.status).toBe(200)
    const body = response.json as { ok: boolean; snapshot: { head: { branch: string }; branches: unknown[] } }
    expect(body.ok).toBe(true)
    expect(body.snapshot.head.branch).not.toBe('')
    expect(body.snapshot.branches.length).toBeGreaterThan(0)
  })

  it('refuses to discard without confirmation and leaves the file untouched', async () => {
    const { repo, harness } = await fixture()
    await repo.write('a.txt', 'changed\n')
    const response = await invokeRoute(harness.server, {
      method: 'POST',
      path: '/plugin-git-workspace/action',
      body: { kind: 'discard', workspaceId: 'workspace-1', tracked: ['a.txt'], untracked: [] },
    })
    expect(response.status).toBe(409)
    expect(await repo.read('a.txt')).toBe('changed\n')
  })

  it('discards a tracked change only after the token is used', async () => {
    const { repo, harness } = await fixture()
    await repo.write('README.md', 'modified\n')
    const action = { kind: 'discard', workspaceId: 'workspace-1', tracked: ['README.md'], untracked: [] }
    const confirm = await invokeRoute(harness.server, {
      method: 'POST',
      path: '/plugin-git-workspace/confirm',
      body: action,
    })
    const token = (confirm.json as { token: string }).token
    const applied = await invokeRoute(harness.server, {
      method: 'POST',
      path: '/plugin-git-workspace/action',
      body: { ...action, confirm: token },
    })
    expect(applied.status).toBe(200)
    expect((await repo.read('README.md')).replace(/\r\n/g, '\n')).toBe('# fixture\n')
  })

  it('never deletes ignored or tracked files through clean', async () => {
    const { repo, harness } = await fixture()
    await repo.write('.gitignore', 'ignored.log\n')
    await repo.write('ignored.log', 'keep\n')
    await repo.commit('ignore setup')
    await repo.write('scratch.txt', 'temp\n')
    const action = { kind: 'discard', workspaceId: 'workspace-1', tracked: [], untracked: ['scratch.txt'] }
    const confirm = await invokeRoute(harness.server, {
      method: 'POST',
      path: '/plugin-git-workspace/confirm',
      body: action,
    })
    const applied = await invokeRoute(harness.server, {
      method: 'POST',
      path: '/plugin-git-workspace/action',
      body: { ...action, confirm: (confirm.json as { token: string }).token },
    })
    expect(applied.status).toBe(200)
    await expect(stat(repo.path('scratch.txt'))).rejects.toBeTruthy()
    expect((await repo.read('ignored.log')).replace(/\r\n/g, '\n')).toBe('keep\n')
  })

  it('stages and commits through the routes', async () => {
    const { repo, harness } = await fixture()
    await repo.write('feature.txt', 'feature\n')
    const staged = await invokeRoute(harness.server, {
      method: 'POST',
      path: '/plugin-git-workspace/action',
      body: { kind: 'stage', workspaceId: 'workspace-1', paths: ['feature.txt'] },
    })
    expect(staged.status).toBe(200)
    const committed = await invokeRoute(harness.server, {
      method: 'POST',
      path: '/plugin-git-workspace/action',
      body: { kind: 'commit', workspaceId: 'workspace-1', message: 'add feature' },
    })
    expect(committed.status).toBe(200)
    expect(await repo.git(['log', '-1', '--format=%s'])).toBe('add feature')
  })

  it('reports an index lock without deleting it', async () => {
    const { repo, harness } = await fixture()
    await repo.write('feature.txt', 'x\n')
    await repo.lockIndex()
    const response = await invokeRoute(harness.server, {
      method: 'POST',
      path: '/plugin-git-workspace/action',
      body: { kind: 'stage', workspaceId: 'workspace-1', paths: ['feature.txt'] },
    })
    expect(response.status).toBe(409)
    expect((response.json as { error: { code: string } }).error.code).toBe('lock')
    await expect(stat(repo.path('.git/index.lock'))).resolves.toBeTruthy()
  })

  it('keeps a commit message with spaces and shell-looking text intact', async () => {
    const { repo, harness } = await fixture()
    await repo.write('feature.txt', 'x\n')
    await invokeRoute(harness.server, {
      method: 'POST',
      path: '/plugin-git-workspace/action',
      body: { kind: 'stage', workspaceId: 'workspace-1', paths: ['feature.txt'] },
    })
    const message = 'fix: quoting; rm -rf / is not executed'
    const response = await invokeRoute(harness.server, {
      method: 'POST',
      path: '/plugin-git-workspace/action',
      body: { kind: 'commit', workspaceId: 'workspace-1', message },
    })
    expect(response.status).toBe(200)
    expect(await repo.git(['log', '-1', '--format=%s'])).toBe(message)
    // The fixture file survived the shell-looking text.
    expect(await readFile(repo.path('feature.txt'), 'utf8')).toBe('x\n')
  })

  it('creates and switches branches through the routes', async () => {
    const { repo, harness } = await fixture()
    const created = await invokeRoute(harness.server, {
      method: 'POST',
      path: '/plugin-git-workspace/action',
      body: { kind: 'createBranch', workspaceId: 'workspace-1', name: 'feature/it', start: 'master' },
    })
    expect(created.status).toBe(200)
    expect(await repo.currentBranch()).toBe('feature/it')
    const switched = await invokeRoute(harness.server, {
      method: 'POST',
      path: '/plugin-git-workspace/action',
      body: { kind: 'checkout', workspaceId: 'workspace-1', ref: 'master' },
    })
    expect(switched.status).toBe(200)
    expect(await repo.currentBranch()).toBe('master')
  })

  it('refuses to delete an unmerged branch unless force is confirmed', async () => {
    const { repo, harness } = await fixture()
    await repo.checkoutNew('topic')
    await repo.write('topic.txt', 'topic\n')
    await repo.commit('topic commit')
    await repo.checkout('master')

    const safe = { kind: 'deleteBranch', workspaceId: 'workspace-1', name: 'topic', force: false }
    const safeConfirm = await invokeRoute(harness.server, {
      method: 'POST',
      path: '/plugin-git-workspace/confirm',
      body: safe,
    })
    const safeApplied = await invokeRoute(harness.server, {
      method: 'POST',
      path: '/plugin-git-workspace/action',
      body: { ...safe, confirm: (safeConfirm.json as { token: string }).token },
    })
    expect(safeApplied.status).toBe(409)
    expect((safeApplied.json as { error: { code: string } }).error.code).toBe('branch-not-merged')
    await expect(repo.git(['rev-parse', '--verify', 'topic'])).resolves.toMatch(/^[0-9a-f]{40}$/)

    const forced = { kind: 'deleteBranch', workspaceId: 'workspace-1', name: 'topic', force: true }
    const forcedConfirm = await invokeRoute(harness.server, {
      method: 'POST',
      path: '/plugin-git-workspace/confirm',
      body: forced,
    })
    const forcedApplied = await invokeRoute(harness.server, {
      method: 'POST',
      path: '/plugin-git-workspace/action',
      body: { ...forced, confirm: (forcedConfirm.json as { token: string }).token },
    })
    expect(forcedApplied.status).toBe(200)
    await expect(repo.git(['rev-parse', '--verify', 'topic'])).rejects.toBeTruthy()
  })
})
