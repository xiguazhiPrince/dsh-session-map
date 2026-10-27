/**
 * Argv builder tests. These are the safety tests' first layer: they assert the
 * exact spawn argv the Host would hand git, so a builder that starts emitting
 * `--force`, `-x`, `--no-verify` or a shell string fails here.
 *
 * @module dsh-session-map/git-workspace/git-command.test
 */
import { describe, expect, it } from 'vitest'
import {
  commitFilesArgs,
  commitMetaArgs,
  containsArgs,
  diffArgs,
  forEachRefArgs,
  gitEnvironment,
  gitPathArgs,
  headOidArgs,
  logArgs,
  readInvocation,
  receiptOf,
  redactArg,
  redactArgv,
  remoteVerboseArgs,
  repoProbeArgs,
  stashListArgs,
  statusArgs,
  symbolicRefArgs,
  writeInvocation,
} from './git-command'

const GIT = '/usr/bin/git'
const ROOT = '/repo'

/** The common read prefix every read invocation must start with. */
function readPrefix(): readonly string[] {
  return [
    GIT, '-C', ROOT, '--no-pager', '--no-optional-locks',
    '-c', 'core.quotepath=false', '-c', 'color.ui=false', '-c', 'core.pager=cat',
    '-c', 'log.showSignature=false', '-c', 'i18n.logOutputEncoding=UTF-8',
  ]
}

describe('readInvocation', () => {
  it('builds the hardened read prefix and env', () => {
    const invocation = readInvocation(GIT, ROOT, ['status'])
    expect(invocation.argv).toEqual([...readPrefix(), 'status'])
    expect(invocation.cwd).toBe(ROOT)
    expect(invocation.env).toMatchObject({
      LC_ALL: 'C',
      GIT_TERMINAL_PROMPT: '0',
      GIT_OPTIONAL_LOCKS: '0',
      GIT_LITERAL_PATHSPECS: '1',
      GIT_EDITOR: ':',
    })
    expect(invocation.timeoutMs).toBeGreaterThan(0)
    expect(invocation.maxBytes).toBeGreaterThan(0)
  })

  it('honours per-invocation timeout and label overrides', () => {
    const invocation = readInvocation(GIT, ROOT, ['log'], { timeoutMs: 1234, label: 'history' })
    expect(invocation.timeoutMs).toBe(1234)
    expect(invocation.label).toBe('history')
  })
})

describe('writeInvocation', () => {
  it('never takes the read-only no-optional-locks flag and closes the editor', () => {
    const invocation = writeInvocation(GIT, ROOT, ['commit'])
    expect(invocation.argv).not.toContain('--no-optional-locks')
    expect(invocation.argv).toContain('core.editor=false')
    expect(invocation.argv).toContain('sequence.editor=false')
    expect(gitEnvironment(true)).not.toHaveProperty('GIT_OPTIONAL_LOCKS')
  })
})

describe('read argument builders', () => {
  it('asks for porcelain v2 with branch and stash headers', () => {
    expect(statusArgs('normal')).toEqual([
      'status', '--porcelain=v2', '-z', '--branch', '--show-stash', '--untracked-files=normal',
    ])
    expect(statusArgs('no')).toContain('--untracked-files=no')
  })

  it('builds repository probe, ref and remote commands', () => {
    expect(repoProbeArgs()[0]).toBe('rev-parse')
    expect(repoProbeArgs()).toContain('--is-inside-work-tree')
    expect(forEachRefArgs()).toContain('refs/heads')
    expect(forEachRefArgs()[1]).toMatch(/^--format=/)
    expect(stashListArgs()).toContain('-z')
    expect(gitPathArgs(['MERGE_HEAD', 'CHERRY_PICK_HEAD'])).toEqual([
      'rev-parse', '--git-path', 'MERGE_HEAD', '--git-path', 'CHERRY_PICK_HEAD',
    ])
    expect(remoteVerboseArgs()).toEqual(['remote', '-v'])
    expect(symbolicRefArgs()).toEqual(['symbolic-ref', '-q', '--short', 'HEAD'])
    expect(headOidArgs()).toEqual(['rev-parse', 'HEAD'])
  })

  it('keeps log filters before the path separator', () => {
    const args = logArgs({
      ref: 'main',
      limit: 50,
      skip: 100,
      query: 'fix crash',
      author: 'alice',
      since: '2026-01-01',
      until: '2026-12-31',
      file: 'src/app.ts',
    })
    expect(args).toContain('main')
    expect(args).toContain('--max-count=50')
    expect(args).toContain('--skip=100')
    expect(args).toContain('--grep=fix crash')
    expect(args).toContain('--fixed-strings')
    expect(args).toContain('--author=alice')
    expect(args).toContain('--since=2026-01-01')
    expect(args).toContain('--until=2026-12-31')
    expect(args.indexOf('--')).toBe(args.length - 2)
    expect(args.at(-1)).toBe('src/app.ts')
  })

  it('uses --all only when asked for every branch', () => {
    const all = logArgs({ allBranches: true, limit: 10, skip: 0 })
    expect(all).toContain('--all')
    expect(all).not.toContain('HEAD')
    expect(logArgs({ ref: 'HEAD', limit: 10, skip: 0 })).toContain('HEAD')
  })

  it('never emits destructive flags in read builders', () => {
    const readArgvs = [
      statusArgs('all'),
      forEachRefArgs(),
      stashListArgs(),
      logArgs({ ref: 'HEAD', limit: 10, skip: 0 }),
      commitFilesArgs('abc1234'),
      commitMetaArgs('abc1234'),
      containsArgs('abc1234'),
      diffArgs({ file: 'a.txt', context: 3 }),
      diffArgs({ hash: 'abc1234', file: 'a.txt', context: 3 }),
    ]
    for (const argv of readArgvs) {
      expect(argv).not.toContain('--force')
      expect(argv).not.toContain('--force-with-lease')
      expect(argv).not.toContain('-x')
      expect(argv).not.toContain('--no-verify')
      expect(argv).not.toContain('--hard')
    }
  })

  it('reads merge file lists via --first-parent', () => {
    expect(commitFilesArgs('abc1234')).toEqual([
      'show', '--first-parent', '--format=', '--name-status', '-z', '-M', 'abc1234',
    ])
    expect(commitMetaArgs('abc1234')).toContain('-s')
  })

  it('keeps diff paths behind the separator', () => {
    const worktree = diffArgs({ file: 'src/app.ts', context: 3 })
    expect(worktree).toContain('--')
    expect(worktree.at(-1)).toBe('src/app.ts')
    const staged = diffArgs({ file: 'a.txt', staged: true, context: 3 })
    expect(staged).toContain('--cached')
    const commit = diffArgs({ hash: 'abc1234', file: 'a.txt', context: 5 })
    expect(commit[0]).toBe('show')
    expect(commit).toContain('--unified=5')
    expect(commit.at(-2)).toBe('--')
  })
})

describe('credential redaction', () => {
  it('redacts user:secret in URL arguments', () => {
    expect(redactArg('https://user:token@example.com/repo.git')).toBe('https://***@example.com/repo.git')
    expect(redactArg('https://example.com/repo.git')).toBe('https://example.com/repo.git')
    expect(redactArg('--grep=user:token@example.com')).toBe('--grep=user:token@example.com')
  })

  it('redacts every element of a receipt argv', () => {
    expect(redactArgv(['git', 'push', 'https://a:b@host/r.git'])).toEqual(['git', 'push', 'https://***@host/r.git'])
  })

  it('carries cancellation and truncation facts into the receipt', () => {
    const invocation = readInvocation(GIT, ROOT, ['status'])
    const receipt = receiptOf(invocation, null, 12, { cancelled: true, truncated: true })
    expect(receipt).toMatchObject({ exitCode: null, ms: 12, cancelled: true, truncated: true })
    expect(receipt.argv).toEqual(invocation.argv)
  })
})
