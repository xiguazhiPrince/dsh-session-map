/**
 * Parser tests: every fixture is a byte shape git really prints, including the
 * rename records whose two paths occupy separate NUL fields.
 *
 * @module dsh-session-map/git-workspace/git-parse.test
 */
import { describe, expect, it } from 'vitest'
import {
  mergeFileStats,
  parseCommitMeta,
  parseForEachRef,
  parseGitPathLines,
  parseLogZ,
  parseNameStatusZ,
  parseNumstatZ,
  parseRemoteVerbose,
  parseRepoProbe,
  parseStatusV2,
  parseUnifiedDiff,
} from './git-parse'
import {
  FOR_EACH_REF,
  LOG_Z,
  NAME_STATUS_Z,
  NUMSTAT_Z,
  STATUS_V2,
  UNIFIED_DIFF,
} from './testing/output-fixtures'

describe('parseRepoProbe', () => {
  it('reads the six probe lines in order', () => {
    const text = 'true\nC:/repo\nsub/\nfalse\nC:/repo/.git\n.git\n'
    expect(parseRepoProbe(text)).toEqual({
      insideWorkTree: true,
      topLevel: 'C:/repo',
      prefix: 'sub/',
      bare: false,
      gitDir: 'C:/repo/.git',
      commonDir: '.git',
    })
  })

  it('rejects an unexpected number of lines', () => {
    expect(parseRepoProbe('true\nC:/repo\n')).toBeUndefined()
  })
})

describe('parseStatusV2', () => {
  const parsed = parseStatusV2(STATUS_V2)

  it('reads the branch headers', () => {
    expect(parsed.head).toEqual({
      oid: '40159af4c0f4c7b1a2d3e4f50617283940a1b2c3',
      branch: 'main',
      upstream: 'origin/main',
      ahead: 2,
      behind: 1,
      stashCount: 1,
      detached: false,
      unborn: false,
    })
  })

  it('splits ordinary entries into staged and unstaged groups', () => {
    expect(parsed.changes).toContainEqual({
      path: 'modified.txt',
      xy: { index: '.', worktree: 'M' },
      kind: 'ordinary',
      group: 'unstaged',
      status: 'M',
    })
    expect(parsed.changes).toContainEqual({
      path: 'staged.txt',
      xy: { index: 'M', worktree: '.' },
      kind: 'ordinary',
      group: 'staged',
      status: 'M',
    })
  })

  it('takes both paths of a rename record', () => {
    expect(parsed.changes).toContainEqual({
      path: 'renamed space.txt',
      oldPath: 'new name with space.txt',
      xy: { index: 'R', worktree: '.' },
      kind: 'renamed',
      group: 'staged',
      status: 'R',
    })
  })

  it('marks conflicted, untracked and ignored rows', () => {
    expect(parsed.changes.find(entry => entry.path === 'conflict.txt')).toMatchObject({
      group: 'conflict',
      kind: 'unmerged',
      status: 'U',
    })
    expect(parsed.changes.find(entry => entry.path === 'untracked dir/')).toMatchObject({
      group: 'untracked',
      status: '?',
    })
    expect(parsed.changes.find(entry => entry.path === 'ignored.log')).toBeUndefined()
  })

  it('reports a stream without its final NUL as truncated', () => {
    expect(parseStatusV2(STATUS_V2.slice(0, -1)).truncated).toBe(true)
  })
})

describe('parseForEachRef', () => {
  const parsed = parseForEachRef(FOR_EACH_REF)

  it('carries branch, upstream and tracking facts', () => {
    const main = parsed.refs.find(ref => ref.name === 'main')
    expect(main).toMatchObject({
      ref: 'refs/heads/main',
      type: 'local',
      isHead: true,
      upstream: 'origin/main',
      track: { ahead: 2, behind: 1, gone: false },
    })
  })

  it('keeps remote refs and tags in their own namespaces', () => {
    expect(parsed.refs.find(ref => ref.name === 'origin/main')?.type).toBe('remote')
    expect(parsed.refs.find(ref => ref.name === 'v2.1')?.type).toBe('tag')
  })
})

describe('parseLogZ', () => {
  const parsed = parseLogZ(LOG_Z)

  it('reads rows and parents', () => {
    expect(parsed.commits).toHaveLength(2)
    expect(parsed.commits[0]).toMatchObject({
      oid: '1111111111111111111111111111111111111111',
      shortOid: '1111111',
      parents: ['2222222222222222222222222222222222222222', '3333333333333333333333333333333333333333'],
      subject: 'Merge branch v2.1',
    })
  })

  it('categorizes decorations without trusting them as data', () => {
    expect(parsed.commits[0]?.refs).toEqual({
      branches: ['main'],
      remoteBranches: ['origin/main'],
      tags: ['v2.1'],
    })
    expect(parsed.commits[1]?.refs).toEqual({ branches: [], remoteBranches: [], tags: [] })
  })

  it('flags a short record as truncated', () => {
    const short = 'a\x1fb\x1fc\x1fd\x1fe'
    expect(parseLogZ(short).truncated).toBe(true)
  })
})

describe('parseCommitMeta', () => {
  it('keeps the full message with its newlines', () => {
    const fields = [
      'aaa', 'aaa1111', 'bbb', 'Alice', 'alice@example.com', '2026-10-27T15:04:00+08:00',
      'Alice', 'alice@example.com', '2026-10-27T15:04:30+08:00', 'HEAD -> main', 'subject',
      'subject\n\nbody\nCo-authored-by: X <x@example.com>',
    ].join('\x1f')
    const parsed = parseCommitMeta(fields + '\0')
    expect(parsed?.message).toContain('Co-authored-by: X <x@example.com>')
    expect(parsed?.commit.refs.branches).toEqual(['main'])
  })

  it('returns undefined for a short record', () => {
    expect(parseCommitMeta('a\x1fb\0')).toBeUndefined()
  })
})

describe('parseNameStatusZ / parseNumstatZ', () => {
  it('reads rename triples and ordinary rows', () => {
    const { files } = parseNameStatusZ(NAME_STATUS_Z)
    expect(files).toContainEqual({ path: 'nested/new file.txt', status: 'A', additions: null, deletions: null, binary: false })
    expect(files).toContainEqual({
      path: 'renamed/new name.txt',
      oldPath: 'old name.txt',
      status: 'R',
      additions: null,
      deletions: null,
      binary: false,
    })
  })

  it('reads numstat, including the empty-path rename form and binary rows', () => {
    const { entries } = parseNumstatZ(NUMSTAT_Z)
    expect(entries).toContainEqual({ path: 'modified.txt', additions: 3, deletions: 2, binary: false })
    expect(entries).toContainEqual({
      path: 'renamed/new name.txt',
      oldPath: 'old name.txt',
      additions: 0,
      deletions: 0,
      binary: false,
    })
    expect(entries).toContainEqual({ path: 'binary.png', additions: null, deletions: null, binary: true })
  })

  it('zips the two lists positionally', () => {
    const files = parseNameStatusZ(NAME_STATUS_Z).files
    const stats = parseNumstatZ(NUMSTAT_Z).entries
    const merged = mergeFileStats(files, stats)
    expect(merged[0]).toMatchObject({ additions: 10, deletions: 0 })
    expect(merged[4]).toMatchObject({ binary: true })
  })
})

describe('parseRemoteVerbose', () => {
  it('keeps one fetch URL per remote', () => {
    const text = [
      'origin\thttps://example.com/repo.git (fetch)',
      'origin\thttps://example.com/repo.git (push)',
      'upstream\tgit@example.com:repo.git (fetch)',
      'upstream\tgit@example.com:repo.git (push)',
    ].join('\n')
    expect(parseRemoteVerbose(text)).toEqual([
      { name: 'origin', url: 'https://example.com/repo.git' },
      { name: 'upstream', url: 'git@example.com:repo.git' },
    ])
  })
})

describe('parseUnifiedDiff', () => {
  it('returns two hunks with line numbers', () => {
    const diff = parseUnifiedDiff(UNIFIED_DIFF, 'modified.txt')
    expect(diff.hunks).toHaveLength(2)
    expect(diff.hunks[0]?.lines).toEqual([
      { kind: ' ', text: 'line one', oldLine: 1, newLine: 1 },
      { kind: '-', text: 'old line', oldLine: 2, newLine: null },
      { kind: '+', text: 'new line', oldLine: null, newLine: 2 },
      { kind: ' ', text: 'line three', oldLine: 3, newLine: 3 },
    ])
    expect(diff.hunks[1]?.lines.at(-1)).toEqual({ kind: ' ', text: 'end', oldLine: 11, newLine: 12 })
  })

  it('detects a binary patch', () => {
    expect(parseUnifiedDiff('Binary files a/x.png and b/x.png differ\n', 'x.png').binary).toBe(true)
    expect(parseUnifiedDiff('GIT binary patch\nliteral 12\n', 'x.png').binary).toBe(true)
  })

  it('carries the Host truncation flag through', () => {
    expect(parseUnifiedDiff(UNIFIED_DIFF, 'modified.txt', true).truncated).toBe(true)
  })
})

describe('parseGitPathLines', () => {
  it('drops empty lines', () => {
    expect(parseGitPathLines('.git/MERGE_HEAD\n\n.git/index\n')).toEqual(['.git/MERGE_HEAD', '.git/index'])
  })
})
