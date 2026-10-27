/**
 * Write-action rule tests: validation, confirmation binding and the exact argv
 * each action produces. A builder that emits `--force`, `-x` or `--no-verify`
 * fails here before the Host can spawn it.
 *
 * @module dsh-session-map/git-workspace/git-actions.test
 */
import { describe, expect, it } from 'vitest'
import {
  ACTION_POLICY,
  buildActionInvocations,
  confirmationTarget,
  parseActionRequest,
  policyFor,
  type GitAction,
} from './git-actions'

const GIT = '/usr/bin/git'
const ROOT = '/repo'

/** Parse a body that must succeed. */
function parse(body: unknown): GitAction {
  const result = parseActionRequest(body)
  if (!result.ok) throw new Error(`expected success, got ${result.code}: ${result.message}`)
  return result.action
}

/** Build the argv arrays for one parsed action. */
function invocations(action: GitAction): readonly string[][] {
  return buildActionInvocations(action, { gitPath: GIT, root: ROOT }).map(invocation => [...invocation.argv])
}

describe('parseActionRequest', () => {
  it('rejects unknown actions and missing workspace ids', () => {
    expect(parseActionRequest({ kind: 'run-shell', workspaceId: 'w' })).toMatchObject({ ok: false, code: 'unsupported-action' })
    expect(parseActionRequest({ kind: 'stage', paths: ['a'] })).toMatchObject({ ok: false, code: 'invalid-request' })
    expect(parseActionRequest({ kind: 'stage', workspaceId: 'w' })).toMatchObject({ ok: false, code: 'invalid-path' })
    expect(parseActionRequest({ kind: 'stage', workspaceId: 'w', paths: [] })).toMatchObject({ ok: false, code: 'invalid-request' })
  })

  it('normalizes stage paths and rejects escapes', () => {
    expect(parse({ kind: 'stage', workspaceId: 'w', paths: ['./src/app.ts', 'src/../src/b.ts'] }))
      .toMatchObject({ kind: 'stage', paths: ['src/app.ts', 'src/b.ts'] })
    expect(parseActionRequest({ kind: 'stage', workspaceId: 'w', paths: ['../outside'] }))
      .toMatchObject({ ok: false, code: 'invalid-path' })
    expect(parseActionRequest({ kind: 'stage', workspaceId: 'w', paths: ['C:\\Windows\\x'] }))
      .toMatchObject({ ok: false, code: 'invalid-path' })
  })

  it('requires a non-empty commit message and defaults amend off', () => {
    expect(parse({ kind: 'commit', workspaceId: 'w', message: 'fix: thing' }))
      .toMatchObject({ kind: 'commit', message: 'fix: thing', amend: false })
    expect(parseActionRequest({ kind: 'commit', workspaceId: 'w', message: '   ' }))
      .toMatchObject({ ok: false, code: 'invalid-request' })
    expect(parse({ kind: 'commit', workspaceId: 'w', message: 'fix', amend: true }))
      .toMatchObject({ amend: true })
  })

  it('validates push targets and the upstream pair', () => {
    expect(parse({ kind: 'push', workspaceId: 'w' })).toMatchObject({ kind: 'push' })
    expect(parse({ kind: 'push', workspaceId: 'w', remote: 'origin', branch: 'main', setUpstream: true }))
      .toMatchObject({ remote: 'origin', branch: 'main', setUpstream: true })
    expect(parseActionRequest({ kind: 'push', workspaceId: 'w', remote: 'a;b' }))
      .toMatchObject({ ok: false, code: 'invalid-request' })
    expect(parseActionRequest({ kind: 'push', workspaceId: 'w', branch: '--force' }))
      .toMatchObject({ ok: false, code: 'invalid-ref' })
    expect(parseActionRequest({ kind: 'push', workspaceId: 'w', setUpstream: true }))
      .toMatchObject({ ok: false, code: 'invalid-request' })
  })

  it('requires at least one discard path', () => {
    expect(parseActionRequest({ kind: 'discard', workspaceId: 'w', tracked: [], untracked: [] }))
      .toMatchObject({ ok: false, code: 'invalid-request' })
    expect(parse({ kind: 'discard', workspaceId: 'w', tracked: ['a.txt'], untracked: ['tmp/'] }))
      .toMatchObject({ kind: 'discard', tracked: ['a.txt'] })
  })

  it('validates branch actions', () => {
    expect(parse({ kind: 'checkout', workspaceId: 'w', ref: 'feature/x' }))
      .toMatchObject({ kind: 'checkout', ref: 'feature/x' })
    expect(parseActionRequest({ kind: 'checkout', workspaceId: 'w', ref: '--all' }))
      .toMatchObject({ ok: false, code: 'invalid-ref' })
    expect(parse({ kind: 'createBranch', workspaceId: 'w', name: 'feature/new', start: 'main' }))
      .toMatchObject({ kind: 'createBranch', name: 'feature/new', start: 'main' })
    expect(parseActionRequest({ kind: 'createBranch', workspaceId: 'w', name: 'bad name' }))
      .toMatchObject({ ok: false, code: 'invalid-ref' })
    expect(parse({ kind: 'deleteBranch', workspaceId: 'w', name: 'side' }))
      .toMatchObject({ kind: 'deleteBranch', force: false })
    expect(parse({ kind: 'deleteBranch', workspaceId: 'w', name: 'side', force: true }))
      .toMatchObject({ force: true })
    expect(parseActionRequest({ kind: 'renameBranch', workspaceId: 'w', from: 'a', to: 'a' }))
      .toMatchObject({ ok: false, code: 'invalid-request' })
    expect(parse({ kind: 'fetch', workspaceId: 'w' })).toMatchObject({ kind: 'fetch', all: true })
    expect(parseActionRequest({ kind: 'fetch', workspaceId: 'w', all: false }))
      .toMatchObject({ ok: false, code: 'invalid-request' })
    expect(parse({ kind: 'fetch', workspaceId: 'w', all: false, remote: 'origin' }))
      .toMatchObject({ kind: 'fetch', all: false, remote: 'origin' })
  })
})

describe('ACTION_POLICY', () => {
  it('marks discard as the only L2 action in this phase', () => {
    expect(ACTION_POLICY.discard).toMatchObject({ level: 'l2', requiresConfirmation: true })
    for (const kind of ['stage', 'unstage', 'commit', 'push'] as const) {
      expect(ACTION_POLICY[kind].level).toBe('l1')
      expect(ACTION_POLICY[kind].requiresConfirmation).toBe(false)
    }
  })

  it('binds the discard confirmation to root and path set', () => {
    const action = parse({ kind: 'discard', workspaceId: 'w', tracked: ['a.txt', 'b.txt'], untracked: ['tmp/'] })
    const target = confirmationTarget(action, ROOT)
    expect(target).toBeDefined()
    expect(confirmationTarget(action, '/other')).not.toBe(target)
    const other = parse({ kind: 'discard', workspaceId: 'w', tracked: ['a.txt'], untracked: ['tmp/'] })
    expect(confirmationTarget(other, ROOT)).not.toBe(target)
    const stage = parse({ kind: 'stage', workspaceId: 'w', paths: ['a.txt'] })
    expect(confirmationTarget(stage, ROOT)).toBeUndefined()
  })

  it('requires confirmation to delete a branch and binds the target', () => {
    const safe = parse({ kind: 'deleteBranch', workspaceId: 'w', name: 'side', force: false })
    const forced = parse({ kind: 'deleteBranch', workspaceId: 'w', name: 'side', force: true })
    expect(ACTION_POLICY.deleteBranch).toMatchObject({ level: 'l2', requiresConfirmation: true })
    expect(confirmationTarget(safe, ROOT)).toBeDefined()
    expect(confirmationTarget(forced, ROOT)).not.toBe(confirmationTarget(safe, ROOT))
    expect(confirmationTarget(parse({ kind: 'checkout', workspaceId: 'w', ref: 'main' }), ROOT)).toBeUndefined()
  })

  it('treats a lease-forced push as L3 and binds its target', () => {
    const normal = parse({ kind: 'push', workspaceId: 'w' })
    const forced = parse({ kind: 'push', workspaceId: 'w', remote: 'origin', branch: 'main', forceWithLease: true })
    expect(policyFor(normal)).toMatchObject({ level: 'l1', requiresConfirmation: false })
    expect(policyFor(forced)).toMatchObject({ level: 'l3', requiresConfirmation: true })
    expect(confirmationTarget(normal, ROOT)).toBeUndefined()
    expect(confirmationTarget(forced, ROOT)).toContain('force-push')
  })
})

describe('buildActionInvocations', () => {
  it('stages and unstages with the path separator', () => {
    const [stage] = invocations(parse({ kind: 'stage', workspaceId: 'w', paths: ['src/app.ts'] }))
    expect(stage).toEqual(expect.arrayContaining(['add', '-A', '--', 'src/app.ts']))
    const [unstage] = invocations(parse({ kind: 'unstage', workspaceId: 'w', paths: ['src/app.ts'] }))
    expect(unstage).toEqual(expect.arrayContaining(['restore', '--staged', '--', 'src/app.ts']))
  })

  it('runs restore, then a clean preview, then the real clean', () => {
    const [restore, preview, clean] = invocations(parse({
      kind: 'discard', workspaceId: 'w', tracked: ['a.txt'], untracked: ['tmp/file.txt'],
    }))
    expect(restore).toEqual(expect.arrayContaining(['restore', '--worktree', '--source=HEAD', '--', 'a.txt']))
    expect(preview).toEqual(expect.arrayContaining(['clean', '-nd', '--', 'tmp/file.txt']))
    expect(clean).toEqual(expect.arrayContaining(['clean', '-fd', '--', 'tmp/file.txt']))
    for (const argv of [restore, preview, clean]) {
      expect(argv).not.toContain('-x')
    }
  })

  it('never adds force flags to a push', () => {
    const [push] = invocations(parse({ kind: 'push', workspaceId: 'w' }))
    expect(push).toContain('--porcelain')
    expect(push).not.toContain('--force')
    expect(push).not.toContain('--force-with-lease')
    const [upstream] = invocations(parse({ kind: 'push', workspaceId: 'w', remote: 'origin', branch: 'main', setUpstream: true }))
    expect(upstream).toEqual(expect.arrayContaining(['-u', 'origin', 'main']))
  })

  it('passes the commit message as one argv element', () => {
    const message = 'fix: a message with spaces; rm -rf / and $(id)'
    const [commit] = invocations(parse({ kind: 'commit', workspaceId: 'w', message }))
    expect(commit).toContain(message)
    expect(commit).toContain('--cleanup=whitespace')
    expect(commit).not.toContain('--no-verify')
    const [amend] = invocations(parse({ kind: 'commit', workspaceId: 'w', message, amend: true }))
    expect(amend).toEqual(expect.arrayContaining(['commit', '--amend', '-m', message]))
  })

  it('keeps every write invocation on the resolved git binary', () => {
    for (const action of [
      parse({ kind: 'stage', workspaceId: 'w', paths: ['a'] }),
      parse({ kind: 'unstage', workspaceId: 'w', paths: ['a'] }),
      parse({ kind: 'discard', workspaceId: 'w', tracked: ['a'], untracked: [] }),
      parse({ kind: 'commit', workspaceId: 'w', message: 'm' }),
      parse({ kind: 'push', workspaceId: 'w' }),
    ]) {
      const built = buildActionInvocations(action, { gitPath: GIT, root: ROOT })
      for (const invocation of built) {
        expect(invocation.argv[0]).toBe(GIT)
        expect(invocation.cwd).toBe(ROOT)
      }
    }
  })

  it('builds branch and fetch invocations without option injection', () => {
    const [checkout] = invocations(parse({ kind: 'checkout', workspaceId: 'w', ref: 'feature/x' }))
    expect(checkout).toEqual(expect.arrayContaining(['switch', '--', 'feature/x']))
    const [create] = invocations(parse({ kind: 'createBranch', workspaceId: 'w', name: 'feature/new', start: 'main' }))
    expect(create).toEqual(expect.arrayContaining(['switch', '-c', 'feature/new', 'main']))
    const [safeDelete] = invocations(parse({ kind: 'deleteBranch', workspaceId: 'w', name: 'side' }))
    expect(safeDelete).toEqual(expect.arrayContaining(['branch', '-d', '--', 'side']))
    const [forcedDelete] = invocations(parse({ kind: 'deleteBranch', workspaceId: 'w', name: 'side', force: true }))
    expect(forcedDelete).toEqual(expect.arrayContaining(['branch', '-D', '--', 'side']))
    const [rename] = invocations(parse({ kind: 'renameBranch', workspaceId: 'w', from: 'old', to: 'new' }))
    expect(rename).toEqual(expect.arrayContaining(['branch', '-m', 'old', 'new']))
    const [fetch] = invocations(parse({ kind: 'fetch', workspaceId: 'w' }))
    expect(fetch).toEqual(expect.arrayContaining(['fetch', '--prune', '--all']))
    const [oneRemote] = invocations(parse({ kind: 'fetch', workspaceId: 'w', all: false, remote: 'origin' }))
    expect(oneRemote).toEqual(expect.arrayContaining(['fetch', '--prune', 'origin']))
    expect(oneRemote).not.toContain('--all')
  })

  it('builds update as fetch plus merge or rebase', () => {
    const merge = invocations(parse({ kind: 'update', workspaceId: 'w', mode: 'merge' }))
    expect(merge).toHaveLength(2)
    expect(merge[0]).toEqual(expect.arrayContaining(['fetch', '--prune']))
    expect(merge[1]).toEqual(expect.arrayContaining(['merge', '--no-edit', '@{upstream}']))
    const rebase = invocations(parse({ kind: 'update', workspaceId: 'w', mode: 'rebase' }))
    expect(rebase[1]).toEqual(expect.arrayContaining(['rebase', '@{upstream}']))
  })

  it('adds --force-with-lease only for the forced push variant', () => {
    const [normal] = invocations(parse({ kind: 'push', workspaceId: 'w' }))
    expect(normal).not.toContain('--force-with-lease')
    const [forced] = invocations(parse({ kind: 'push', workspaceId: 'w', forceWithLease: true, remote: 'origin', branch: 'main' }))
    expect(forced).toContain('--force-with-lease')
    expect(forced).not.toContain('--force')
    expect(forced).toEqual(expect.arrayContaining(['origin', 'main']))
  })
})
