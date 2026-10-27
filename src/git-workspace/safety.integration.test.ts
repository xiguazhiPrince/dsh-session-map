/**
 * Real-git integration tests for the safety-critical write paths.
 *
 * These run only when `GIT_WS_IT=1` and git exists: they create a throwaway
 * repository, install the real Host routes over a local subprocess adapter and
 * assert on the actual working tree, not on mocked output.
 *
 * @module dsh-session-map/git-workspace/safety.integration.test
 */
import { mkdtemp, readFile, rm, stat, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
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

/** Poll one job until it settles. */
async function waitForJob(server: HostHarness['server'], id: string): Promise<{ status: string }> {
  const started = Date.now()
  for (;;) {
    const response = await invokeRoute(server, { path: `/plugin-git-workspace/job?id=${id}` })
    const job = (response.json as { job: { status: string } }).job
    if (job.status !== 'running') return job
    if (Date.now() - started > 5_000) throw new Error('the background job did not settle')
    await new Promise(resolve => setTimeout(resolve, 20))
  }
}

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

  it('fetches remote updates through a background job', async () => {
    const { repo, harness } = await fixture()
    const bare = await repo.createBareOrigin()
    await repo.git(['push', '-q', '-u', 'origin', 'master'])
    const other = await createTempRepo()
    try {
      await other.git(['remote', 'add', 'origin', bare])
      await other.git(['fetch', '-q', 'origin'])
      await other.git(['switch', '-q', '-c', 'pushed', '--track', 'origin/master'])
      await other.write('remote.txt', 'remote\n')
      const remoteHash = await other.commit('remote commit')
      await other.git(['push', '-q', 'origin', 'HEAD:master'])

      const started = await invokeRoute(harness.server, {
        method: 'POST',
        path: '/plugin-git-workspace/action',
        body: { kind: 'fetch', workspaceId: 'workspace-1', all: true },
      })
      expect(started.status).toBe(200)
      const job = await waitForJob(harness.server, (started.json as { job: { id: string } }).job.id)
      expect(job.status).toBe('done')
      expect(await repo.git(['rev-parse', 'origin/master'])).toBe(remoteHash)
    } finally {
      await other.dispose()
    }
  })

  it('updates the current branch through fetch plus merge', async () => {
    const { repo, harness } = await fixture()
    const bare = await repo.createBareOrigin()
    await repo.git(['push', '-q', '-u', 'origin', 'master'])
    const other = await createTempRepo()
    try {
      await other.git(['remote', 'add', 'origin', bare])
      await other.git(['fetch', '-q', 'origin'])
      await other.git(['switch', '-q', '-c', 'pushed', '--track', 'origin/master'])
      await other.write('remote.txt', 'remote\n')
      await other.commit('remote commit')
      await other.git(['push', '-q', 'origin', 'HEAD:master'])

      const started = await invokeRoute(harness.server, {
        method: 'POST',
        path: '/plugin-git-workspace/action',
        body: { kind: 'update', workspaceId: 'workspace-1', mode: 'merge' },
      })
      expect(started.status).toBe(200)
      const job = await waitForJob(harness.server, (started.json as { job: { id: string } }).job.id)
      expect(job.status).toBe('done')
      expect(await repo.git(['log', '-1', '--format=%s'])).toBe('remote commit')
    } finally {
      await other.dispose()
    }
  })

  it('stashes and pops working tree changes through the routes', async () => {
    const { repo, harness } = await fixture()
    await repo.write('README.md', 'stashed change\n')
    const pushed = await invokeRoute(harness.server, {
      method: 'POST',
      path: '/plugin-git-workspace/action',
      body: { kind: 'stashPush', workspaceId: 'workspace-1', includeUntracked: true, message: 'wip' },
    })
    expect(pushed.status).toBe(200)
    expect((await repo.read('README.md')).replace(/\r\n/g, '\n')).toBe('# fixture\n')
    expect((await repo.git(['stash', 'list'])).includes('wip')).toBe(true)
    const popped = await invokeRoute(harness.server, {
      method: 'POST',
      path: '/plugin-git-workspace/action',
      body: { kind: 'stashPop', workspaceId: 'workspace-1' },
    })
    expect(popped.status).toBe(200)
    expect((await repo.read('README.md')).replace(/\r\n/g, '\n')).toBe('stashed change\n')
  })

  it('creates a tag and deletes it only after confirmation', async () => {
    const { repo, harness } = await fixture()
    const head = await repo.headHash()
    const created = await invokeRoute(harness.server, {
      method: 'POST',
      path: '/plugin-git-workspace/action',
      body: { kind: 'tagCreate', workspaceId: 'workspace-1', name: 'v-integration', hash: head },
    })
    expect(created.status).toBe(200)
    expect(await repo.git(['tag', '--list', 'v-integration'])).toBe('v-integration')

    const action = { kind: 'tagDelete', workspaceId: 'workspace-1', name: 'v-integration' }
    const denied = await invokeRoute(harness.server, {
      method: 'POST',
      path: '/plugin-git-workspace/action',
      body: action,
    })
    expect(denied.status).toBe(409)
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
    expect(await repo.git(['tag', '--list', 'v-integration'])).toBe('')
  })

  it('rejects a non-fast-forward push and accepts a confirmed force-with-lease', async () => {
    const { repo, harness } = await fixture()
    await repo.createBareOrigin()
    await repo.git(['push', '-q', '-u', 'origin', 'master'])
    await repo.write('second.txt', 'second\n')
    await repo.commit('second')
    await repo.git(['push', '-q'])
    // Rewrite the pushed commit: a normal push must now be rejected.
    await repo.git(['commit', '-q', '--amend', '-m', 'second amended'])

    const rejected = await invokeRoute(harness.server, {
      method: 'POST',
      path: '/plugin-git-workspace/action',
      body: { kind: 'push', workspaceId: 'workspace-1' },
    })
    expect(rejected.status).toBe(200)
    const rejectedJob = await waitForJob(harness.server, (rejected.json as { job: { id: string } }).job.id)
    expect(rejectedJob.status).toBe('failed')

    const force = { kind: 'push', workspaceId: 'workspace-1', forceWithLease: true }
    const denied = await invokeRoute(harness.server, {
      method: 'POST',
      path: '/plugin-git-workspace/action',
      body: force,
    })
    expect(denied.status).toBe(409)
    expect((denied.json as { error: { code: string } }).error.code).toBe('confirmation-required')

    const confirm = await invokeRoute(harness.server, {
      method: 'POST',
      path: '/plugin-git-workspace/confirm',
      body: force,
    })
    const forced = await invokeRoute(harness.server, {
      method: 'POST',
      path: '/plugin-git-workspace/action',
      body: { ...force, confirm: (confirm.json as { token: string }).token },
    })
    const forcedJob = await waitForJob(harness.server, (forced.json as { job: { id: string } }).job.id)
    expect(forcedJob.status).toBe('done')
    expect(await repo.git(['rev-parse', 'origin/master'])).toBe(await repo.headHash())
  })

  it('never follows a symlink outside the repository while discarding', async (ctx) => {
    const { repo, harness } = await fixture()
    const outside = await mkdtemp(join(tmpdir(), 'dsh-gw-out-'))
    const outsideFile = join(outside, 'keep.txt')
    await writeFile(outsideFile, 'keep\n', 'utf8')
    const link = repo.path('link-out.txt')
    try {
      await symlink(outsideFile, link, 'file')
    } catch {
      // Windows requires Developer Mode or an elevated shell for symlinks.
      await rm(outside, { recursive: true, force: true })
      ctx.skip()
      return
    }
    try {
      const action = { kind: 'discard', workspaceId: 'workspace-1', tracked: [], untracked: ['link-out.txt'] }
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
      await expect(stat(link)).rejects.toBeTruthy()
      expect((await readFile(outsideFile, 'utf8')).replace(/\r\n/g, '\n')).toBe('keep\n')
    } finally {
      await rm(outside, { recursive: true, force: true })
    }
  })
})
