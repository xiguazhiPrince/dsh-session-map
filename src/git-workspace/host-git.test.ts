/**
 * Route tests for the Git window read API: workspace containment, scripted git
 * output, envelopes and the loopback gate.
 *
 * The fake subprocess is enough for these tests because every branch under test
 * is driven by a scripted stdout/exit code; real-git behavior is covered by the
 * integration suite.
 *
 * @module dsh-session-map/git-workspace/host-git.test
 */
import { mkdtemp, realpath, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import type { Context } from '@deepseek-ai/cordis'
import { installGitWorkspaceHost } from './host'
import { createHostHarness, invokeRoute, type FakeWebServer } from './testing/fake-host'
import { FakeSubprocess } from './testing/fake-subprocess'
import {
  FOR_EACH_REF,
  LOG_Z,
  NAME_STATUS_Z,
  NUMSTAT_Z,
  STATUS_V2,
  UNIFIED_DIFF,
} from './testing/output-fixtures'

/** Workspaces created by one test, removed afterwards. */
const created: string[] = []

/** Headless workspace directory that realpath can resolve. */
async function makeWorkspace(): Promise<string> {
  const dir = await realpath(await mkdtemp(join(tmpdir(), 'dsh-gw-ws-')))
  created.push(dir)
  return dir
}

afterEach(async () => {
  await Promise.all(created.splice(0).map(dir => rm(dir, { recursive: true, force: true })))
})

/** The probe stdout the Host parses, pointed at one real directory. */
function probeOutput(topLevel: string): string {
  return ['true', topLevel, '', 'false', join(topLevel, '.git'), '.git'].join('\n') + '\n'
}

/** The eight marker paths the Host asks `--git-path` for. */
const MARKER_OUTPUT = [
  '.git/MERGE_HEAD',
  '.git/rebase-merge',
  '.git/rebase-apply',
  '.git/CHERRY_PICK_HEAD',
  '.git/REVERT_HEAD',
  '.git/BISECT_LOG',
  '.git/sequencer',
  '.git/index',
].join('\n') + '\n'

/** Boot one harness with the plugin's routes installed. */
function harness(fake: FakeSubprocess, workspace: string) {
  const created = createHostHarness(fake, workspace)
  installGitWorkspaceHost(created.ctx as unknown as Context)
  return created
}

/** One commit metadata stdout in the `show -s -z` shape. */
function metaOutput(): string {
  return [
    '1111111111111111111111111111111111111111',
    '1111111',
    '2222222222222222222222222222222222222222',
    'Alice',
    'alice@example.com',
    '2026-10-27T15:04:00+08:00',
    'Alice',
    'alice@example.com',
    '2026-10-27T15:04:30+08:00',
    'HEAD -> main, origin/main, tag: v2.1',
    'Merge branch v2.1',
    'Merge branch v2.1\n\nCo-authored-by: X <x@example.com>',
  ].join('\x1f') + '\0'
}

/** Poll one job until it settles, or fail the test after a short timeout. */
async function waitForJob(server: FakeWebServer, id: string): Promise<{ status: string }> {
  const started = Date.now()
  for (;;) {
    const response = await invokeRoute(server, { path: `/plugin-git-workspace/job?id=${id}` })
    const job = (response.json as { job: { status: string } }).job
    if (job.status !== 'running') return job
    if (Date.now() - started > 3_000) throw new Error('the background job did not settle')
    await new Promise(resolve => setTimeout(resolve, 10))
  }
}

describe('GET /snapshot', () => {
  it('assembles a snapshot from scripted git output', async () => {
    const workspace = await makeWorkspace()
    const fake = new FakeSubprocess().queueOutcome(
      { stdout: probeOutput(workspace) },
      { stdout: STATUS_V2 },
      { stdout: FOR_EACH_REF },
      { stdout: MARKER_OUTPUT },
      { stdout: 'origin\thttps://example.com/r.git (fetch)\n' },
    )
    const { server, subprocess } = harness(fake, workspace)
    const response = await invokeRoute(server, {
      path: '/plugin-git-workspace/snapshot?workspaceId=workspace-1',
    })
    expect(response.status).toBe(200)
    const body = response.json as {
      ok: boolean
      snapshot: { head: { branch: string; upstream: unknown }; counts: Record<string, number>; branches: unknown[]; remotes: unknown[] }
      commands: unknown[]
    }
    expect(body.ok).toBe(true)
    expect(body.snapshot.head.branch).toBe('main')
    expect(body.snapshot.head.upstream).toMatchObject({ ref: 'origin/main', ahead: 2, behind: 1 })
    expect(body.snapshot.counts).toEqual({ staged: 2, unstaged: 1, untracked: 2, conflicted: 1 })
    expect(body.snapshot.remotes).toEqual([{ name: 'origin', url: 'https://example.com/r.git' }])
    expect(body.commands).toHaveLength(4)
    expect(subprocess.spawns).toHaveLength(5)
  })

  it('reuses the snapshot inside the short cache window', async () => {
    const workspace = await makeWorkspace()
    const fake = new FakeSubprocess().queueOutcome(
      { stdout: probeOutput(workspace) },
      { stdout: STATUS_V2 },
      { stdout: FOR_EACH_REF },
      { stdout: MARKER_OUTPUT },
      { stdout: '' },
    )
    const { server, subprocess } = harness(fake, workspace)
    await invokeRoute(server, { path: '/plugin-git-workspace/snapshot?workspaceId=workspace-1' })
    const before = subprocess.spawns.length
    await invokeRoute(server, { path: '/plugin-git-workspace/snapshot?workspaceId=workspace-1' })
    expect(subprocess.spawns.length).toBe(before)
  })

  it('answers 404 for an unregistered workspace without spawning', async () => {
    const workspace = await makeWorkspace()
    const fake = new FakeSubprocess()
    const { server, subprocess } = harness(fake, workspace)
    const response = await invokeRoute(server, {
      path: '/plugin-git-workspace/snapshot?workspaceId=nope',
    })
    expect(response.status).toBe(404)
    expect((response.json as { error: { code: string } }).error.code).toBe('workspace-not-found')
    expect(subprocess.spawns).toHaveLength(0)
  })

  it('reports a non-repository workspace in-band instead of as an HTTP error', async () => {
    const workspace = await makeWorkspace()
    const fake = new FakeSubprocess().queueOutcome({
      exitCode: 128,
      stderr: 'fatal: not a git repository (or any of the parent directories): .git\n',
    })
    const { server } = harness(fake, workspace)
    const response = await invokeRoute(server, {
      path: '/plugin-git-workspace/snapshot?workspaceId=workspace-1',
    })
    expect(response.status).toBe(200)
    expect((response.json as { error: { code: string } }).error.code).toBe('not-a-repository')
  })

  it('refuses a repository root outside the workspace', async () => {
    const workspace = await makeWorkspace()
    const parent = await realpath(join(workspace, '..'))
    const fake = new FakeSubprocess().queueOutcome({ stdout: probeOutput(parent) })
    const { server } = harness(fake, workspace)
    const response = await invokeRoute(server, {
      path: '/plugin-git-workspace/snapshot?workspaceId=workspace-1',
    })
    expect(response.status).toBe(400)
    expect((response.json as { error: { code: string } }).error.code).toBe('invalid-path')
  })

  it('rejects an untrusted peer at the shared gate', async () => {
    const workspace = await makeWorkspace()
    const fake = new FakeSubprocess()
    const { server, subprocess } = harness(fake, workspace)
    const response = await invokeRoute(server, {
      path: '/plugin-git-workspace/snapshot?workspaceId=workspace-1',
      peer: '192.168.1.9',
    })
    expect(response.status).toBe(403)
    expect(subprocess.spawns).toHaveLength(0)
  })
})

describe('GET /log', () => {
  it('returns one page with parents and decoration refs', async () => {
    const workspace = await makeWorkspace()
    const fake = new FakeSubprocess().queueOutcome(
      { stdout: probeOutput(workspace) },
      { stdout: LOG_Z },
    )
    const { server } = harness(fake, workspace)
    const response = await invokeRoute(server, {
      path: '/plugin-git-workspace/log?workspaceId=workspace-1&limit=1',
    })
    expect(response.status).toBe(200)
    const body = response.json as {
      ok: boolean
      commits: Array<{ subject: string; parents: string[]; refs: unknown }>
      hasMore: boolean
      commands: unknown[]
    }
    expect(body.ok).toBe(true)
    expect(body.commits).toHaveLength(2)
    expect(body.commits[0]?.subject).toBe('Merge branch v2.1')
    expect(body.commits[0]?.parents).toHaveLength(2)
    expect(body.hasMore).toBe(true)
    expect(body.commands).toHaveLength(1)
  })

  it('rejects an unsafe ref before running git log', async () => {
    const workspace = await makeWorkspace()
    const fake = new FakeSubprocess().queueOutcome({ stdout: probeOutput(workspace) })
    const { server, subprocess } = harness(fake, workspace)
    const response = await invokeRoute(server, {
      path: '/plugin-git-workspace/log?workspaceId=workspace-1&ref=--all',
    })
    expect(response.status).toBe(400)
    expect((response.json as { error: { code: string } }).error.code).toBe('invalid-ref')
    expect(subprocess.spawns).toHaveLength(1)
  })

  it('rejects a path filter that escapes the repository', async () => {
    const workspace = await makeWorkspace()
    const fake = new FakeSubprocess().queueOutcome({ stdout: probeOutput(workspace) })
    const { server } = harness(fake, workspace)
    const response = await invokeRoute(server, {
      path: '/plugin-git-workspace/log?workspaceId=workspace-1&file=../outside.txt',
    })
    expect(response.status).toBe(400)
    expect((response.json as { error: { code: string } }).error.code).toBe('invalid-path')
  })
})

describe('GET /commit', () => {
  it('merges file lists with line stats and lists containing branches', async () => {
    const workspace = await makeWorkspace()
    const fake = new FakeSubprocess().queueOutcome(
      { stdout: probeOutput(workspace) },
      { stdout: metaOutput() },
      { stdout: NAME_STATUS_Z },
      { stdout: NUMSTAT_Z },
      { stdout: 'main\norigin/main\n' },
    )
    const { server } = harness(fake, workspace)
    const response = await invokeRoute(server, {
      path: '/plugin-git-workspace/commit?workspaceId=workspace-1&hash=1111111',
    })
    expect(response.status).toBe(200)
    const body = response.json as {
      ok: boolean
      commit: {
        message: string
        files: Array<{ path: string; additions: number | null; binary: boolean }>
        containedInBranches: string[]
      }
      commands: unknown[]
    }
    expect(body.ok).toBe(true)
    expect(body.commit.message).toContain('Co-authored-by: X')
    expect(body.commit.files[0]).toMatchObject({ path: 'nested/new file.txt', additions: 10 })
    expect(body.commit.files[4]).toMatchObject({ path: 'binary.png', binary: true })
    expect(body.commit.containedInBranches).toEqual(['main', 'origin/main'])
    expect(body.commands).toHaveLength(4)
  })

  it('rejects a non-hash id', async () => {
    const workspace = await makeWorkspace()
    const fake = new FakeSubprocess().queueOutcome({ stdout: probeOutput(workspace) })
    const { server } = harness(fake, workspace)
    const response = await invokeRoute(server, {
      path: '/plugin-git-workspace/commit?workspaceId=workspace-1&hash=--all',
    })
    expect(response.status).toBe(400)
    expect((response.json as { error: { code: string } }).error.code).toBe('invalid-ref')
  })
})

describe('GET /diff', () => {
  it('returns the raw patch for the client to parse', async () => {
    const workspace = await makeWorkspace()
    const fake = new FakeSubprocess().queueOutcome(
      { stdout: probeOutput(workspace) },
      { stdout: UNIFIED_DIFF },
    )
    const { server } = harness(fake, workspace)
    const response = await invokeRoute(server, {
      path: '/plugin-git-workspace/diff?workspaceId=workspace-1&file=modified.txt',
    })
    expect(response.status).toBe(200)
    const body = response.json as { ok: boolean; patch: string; binary: boolean; truncated: boolean }
    expect(body).toMatchObject({ ok: true, binary: false, truncated: false })
    expect(body.patch).toContain('@@ -1,3 +1,3 @@')
  })

  it('refuses an escaping path before spawning diff', async () => {
    const workspace = await makeWorkspace()
    const fake = new FakeSubprocess().queueOutcome({ stdout: probeOutput(workspace) })
    const { server, subprocess } = harness(fake, workspace)
    const response = await invokeRoute(server, {
      path: '/plugin-git-workspace/diff?workspaceId=workspace-1&file=../secret.txt',
    })
    expect(response.status).toBe(400)
    expect(subprocess.spawns).toHaveLength(1)
  })
})

describe('POST /confirm and /action', () => {
  it('rejects an unknown action without spawning', async () => {
    const workspace = await makeWorkspace()
    const fake = new FakeSubprocess()
    const { server, subprocess } = harness(fake, workspace)
    const response = await invokeRoute(server, {
      method: 'POST',
      path: '/plugin-git-workspace/action',
      body: { kind: 'run-shell', workspaceId: 'workspace-1' },
    })
    expect(response.status).toBe(400)
    expect((response.json as { error: { code: string } }).error.code).toBe('unsupported-action')
    expect(subprocess.spawns).toHaveLength(0)
  })

  it('rejects a path traversal before resolving the repository', async () => {
    const workspace = await makeWorkspace()
    const fake = new FakeSubprocess()
    const { server, subprocess } = harness(fake, workspace)
    const response = await invokeRoute(server, {
      method: 'POST',
      path: '/plugin-git-workspace/action',
      body: { kind: 'stage', workspaceId: 'workspace-1', paths: ['../outside.txt'] },
    })
    expect(response.status).toBe(400)
    expect((response.json as { error: { code: string } }).error.code).toBe('invalid-path')
    expect(subprocess.spawns).toHaveLength(0)
  })

  it('refuses a destructive action without a confirmation and does not spawn it', async () => {
    const workspace = await makeWorkspace()
    const fake = new FakeSubprocess().queueOutcome({ stdout: probeOutput(workspace) })
    const { server, subprocess } = harness(fake, workspace)
    const response = await invokeRoute(server, {
      method: 'POST',
      path: '/plugin-git-workspace/action',
      body: { kind: 'discard', workspaceId: 'workspace-1', tracked: ['a.txt'], untracked: [] },
    })
    expect(response.status).toBe(409)
    expect((response.json as { error: { code: string } }).error.code).toBe('confirmation-required')
    expect(subprocess.spawns).toHaveLength(1)
    expect(subprocess.lastArgv()).toContain('rev-parse')
  })

  it('issues a single-use token, then runs restore, clean preview and clean', async () => {
    const workspace = await makeWorkspace()
    const fake = new FakeSubprocess().queueOutcome(
      { stdout: probeOutput(workspace) },
      { stdout: '' },
      { stdout: '' },
      { stdout: '' },
    )
    const { server, subprocess } = harness(fake, workspace)
    const action = { kind: 'discard', workspaceId: 'workspace-1', tracked: ['a.txt'], untracked: ['tmp/file.txt'] }
    const confirm = await invokeRoute(server, {
      method: 'POST',
      path: '/plugin-git-workspace/confirm',
      body: action,
    })
    expect(confirm.status).toBe(200)
    const token = (confirm.json as { token: string }).token
    expect(typeof token).toBe('string')

    const applied = await invokeRoute(server, {
      method: 'POST',
      path: '/plugin-git-workspace/action',
      body: { ...action, confirm: token },
    })
    expect(applied.status).toBe(200)
    expect((applied.json as { ok: boolean }).ok).toBe(true)
    const argvs = subprocess.spawns.map(spec => spec.argv)
    expect(argvs.some(argv => argv.includes('restore') && argv.includes('--worktree'))).toBe(true)
    expect(argvs.some(argv => argv.includes('clean') && argv.includes('-nd'))).toBe(true)
    expect(argvs.some(argv => argv.includes('clean') && argv.includes('-fd'))).toBe(true)
    for (const argv of argvs) expect(argv).not.toContain('-x')

    const replay = await invokeRoute(server, {
      method: 'POST',
      path: '/plugin-git-workspace/action',
      body: { ...action, confirm: token },
    })
    expect(replay.status).toBe(409)
    expect((replay.json as { error: { code: string } }).error.code).toBe('confirmation-required')
  })

  it('stages paths through the write builder', async () => {
    const workspace = await makeWorkspace()
    const fake = new FakeSubprocess().queueOutcome(
      { stdout: probeOutput(workspace) },
      { stdout: '' },
    )
    const { server, subprocess } = harness(fake, workspace)
    const response = await invokeRoute(server, {
      method: 'POST',
      path: '/plugin-git-workspace/action',
      body: { kind: 'stage', workspaceId: 'workspace-1', paths: ['src/app.ts'] },
    })
    expect(response.status).toBe(200)
    expect(subprocess.lastArgv()).toEqual(expect.arrayContaining(['add', '-A', '--', 'src/app.ts']))
  })

  it('reports a commit with nothing staged as nothing-to-commit', async () => {
    const workspace = await makeWorkspace()
    const fake = new FakeSubprocess().queueOutcome(
      { stdout: probeOutput(workspace) },
      { exitCode: 1, stdout: 'nothing to commit, working tree clean\n' },
    )
    const { server } = harness(fake, workspace)
    const response = await invokeRoute(server, {
      method: 'POST',
      path: '/plugin-git-workspace/action',
      body: { kind: 'commit', workspaceId: 'workspace-1', message: 'fix' },
    })
    expect(response.status).toBe(409)
    expect((response.json as { error: { code: string } }).error.code).toBe('nothing-to-commit')
  })

  it('pushes without any force flag', async () => {
    const workspace = await makeWorkspace()
    const fake = new FakeSubprocess().queueOutcome(
      { stdout: probeOutput(workspace) },
      { stdout: '' },
    )
    const { server, subprocess } = harness(fake, workspace)
    const response = await invokeRoute(server, {
      method: 'POST',
      path: '/plugin-git-workspace/action',
      body: { kind: 'push', workspaceId: 'workspace-1' },
    })
    expect(response.status).toBe(200)
    const argv = subprocess.lastArgv() ?? []
    expect(argv).toEqual(expect.arrayContaining(['push', '--porcelain', '--progress']))
    expect(argv).not.toContain('--force')
    expect(argv).not.toContain('--force-with-lease')
  })

  it('rejects a non-JSON action body', async () => {
    const workspace = await makeWorkspace()
    const fake = new FakeSubprocess()
    const { server, subprocess } = harness(fake, workspace)
    const response = await invokeRoute(server, {
      method: 'POST',
      path: '/plugin-git-workspace/action',
      body: { kind: 'stage', workspaceId: 'workspace-1', paths: ['a'] },
      contentType: 'text/plain',
    })
    expect(response.status).toBe(415)
    expect(subprocess.spawns).toHaveLength(0)
  })

  it('checks out a branch through switch', async () => {
    const workspace = await makeWorkspace()
    const fake = new FakeSubprocess().queueOutcome(
      { stdout: probeOutput(workspace) },
      { stdout: '' },
    )
    const { server, subprocess } = harness(fake, workspace)
    const response = await invokeRoute(server, {
      method: 'POST',
      path: '/plugin-git-workspace/action',
      body: { kind: 'checkout', workspaceId: 'workspace-1', ref: 'feature/x' },
    })
    expect(response.status).toBe(200)
    expect(subprocess.lastArgv()).toEqual(expect.arrayContaining(['switch', '--', 'feature/x']))
  })

  it('requires a confirmation for branch deletion and then uses -D when forced', async () => {
    const workspace = await makeWorkspace()
    const fake = new FakeSubprocess().queueOutcome(
      { stdout: probeOutput(workspace) },
      { stdout: '' },
    )
    const { server, subprocess } = harness(fake, workspace)
    const action = { kind: 'deleteBranch', workspaceId: 'workspace-1', name: 'side', force: true }
    const denied = await invokeRoute(server, {
      method: 'POST',
      path: '/plugin-git-workspace/action',
      body: action,
    })
    expect(denied.status).toBe(409)
    expect((denied.json as { error: { code: string } }).error.code).toBe('confirmation-required')

    const confirm = await invokeRoute(server, {
      method: 'POST',
      path: '/plugin-git-workspace/confirm',
      body: action,
    })
    const applied = await invokeRoute(server, {
      method: 'POST',
      path: '/plugin-git-workspace/action',
      body: { ...action, confirm: (confirm.json as { token: string }).token },
    })
    expect(applied.status).toBe(200)
    expect(subprocess.lastArgv()).toEqual(expect.arrayContaining(['branch', '-D', '--', 'side']))
  })

  it('creates a branch from a start point', async () => {
    const workspace = await makeWorkspace()
    const fake = new FakeSubprocess().queueOutcome(
      { stdout: probeOutput(workspace) },
      { stdout: '' },
    )
    const { server, subprocess } = harness(fake, workspace)
    const response = await invokeRoute(server, {
      method: 'POST',
      path: '/plugin-git-workspace/action',
      body: { kind: 'createBranch', workspaceId: 'workspace-1', name: 'feature/new', start: 'main' },
    })
    expect(response.status).toBe(200)
    expect(subprocess.lastArgv()).toEqual(expect.arrayContaining(['switch', '-c', 'feature/new', 'main']))
  })

  it('runs fetch as a background job and exposes it through GET /job', async () => {
    const workspace = await makeWorkspace()
    const fake = new FakeSubprocess().queueOutcome(
      { stdout: probeOutput(workspace) },
      { stdout: 'From example.com\n * [new branch] main -> origin/main\n' },
    )
    const { server, subprocess } = harness(fake, workspace)
    const started = await invokeRoute(server, {
      method: 'POST',
      path: '/plugin-git-workspace/action',
      body: { kind: 'fetch', workspaceId: 'workspace-1', all: true },
    })
    expect(started.status).toBe(200)
    const id = (started.json as { job: { id: string } }).job.id
    const job = await waitForJob(server, id)
    expect(job.status).toBe('done')
    expect(subprocess.lastArgv()).toEqual(expect.arrayContaining(['fetch', '--prune', '--all']))
  })

  it('cancels a running job through POST /cancel', async () => {
    const workspace = await makeWorkspace()
    const fake = new FakeSubprocess().queueOutcome(
      { stdout: probeOutput(workspace) },
      { holdUntilAbort: true, stdout: '' },
    )
    const { server } = harness(fake, workspace)
    const started = await invokeRoute(server, {
      method: 'POST',
      path: '/plugin-git-workspace/action',
      body: { kind: 'fetch', workspaceId: 'workspace-1', all: true },
    })
    const id = (started.json as { job: { id: string } }).job.id
    const cancelled = await invokeRoute(server, {
      method: 'POST',
      path: '/plugin-git-workspace/cancel',
      body: { id },
    })
    expect(cancelled.status).toBe(200)
    const job = await waitForJob(server, id)
    expect(job.status).toBe('cancelled')
  })

  it('requires a confirmation for a lease-forced push and then uses no bare --force', async () => {
    const workspace = await makeWorkspace()
    const fake = new FakeSubprocess().queueOutcome(
      { stdout: probeOutput(workspace) },
      { stdout: '' },
    )
    const { server, subprocess } = harness(fake, workspace)
    const action = {
      kind: 'push',
      workspaceId: 'workspace-1',
      remote: 'origin',
      branch: 'main',
      forceWithLease: true,
    }
    const denied = await invokeRoute(server, {
      method: 'POST',
      path: '/plugin-git-workspace/action',
      body: action,
    })
    expect(denied.status).toBe(409)
    expect((denied.json as { error: { code: string } }).error.code).toBe('confirmation-required')

    const confirm = await invokeRoute(server, {
      method: 'POST',
      path: '/plugin-git-workspace/confirm',
      body: action,
    })
    const started = await invokeRoute(server, {
      method: 'POST',
      path: '/plugin-git-workspace/action',
      body: { ...action, confirm: (confirm.json as { token: string }).token },
    })
    const job = await waitForJob(server, (started.json as { job: { id: string } }).job.id)
    expect(job.status).toBe('done')
    const argv = subprocess.lastArgv() ?? []
    expect(argv).toContain('--force-with-lease')
    expect(argv).not.toContain('--force')
  })
})

describe('route surface', () => {
  it('rejects a non-GET method on a read route', async () => {
    const workspace = await makeWorkspace()
    const fake = new FakeSubprocess()
    const { server } = harness(fake, workspace)
    const response = await invokeRoute(server, {
      method: 'POST',
      path: '/plugin-git-workspace/snapshot?workspaceId=workspace-1',
      body: {},
    })
    expect(response.status).toBe(405)
  })

  it('leaves the clone and state routes with the clone handler', async () => {
    const workspace = await makeWorkspace()
    const fake = new FakeSubprocess().queueOutcome({ stdout: 'true\n' })
    const { server } = harness(fake, workspace)
    const state = await invokeRoute(server, { path: '/plugin-git-workspace/state' })
    expect(state.status).toBe(200)
    expect((state.json as { ok: boolean }).ok).toBe(true)
  })
})
