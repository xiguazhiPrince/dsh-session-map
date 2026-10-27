/**
 * Path and ref-name rule tests: the first line of defense that keeps user
 * input from becoming a git argument or escaping the repository.
 *
 * @module dsh-session-map/git-workspace/git-repo.test
 */
import { describe, expect, it } from 'vitest'
import {
  branchParent,
  isPathInside,
  isSafeHash,
  isSafeRefName,
  isSafeRemoteName,
  normalizeRepoRelativePath,
  samePath,
  shortRefName,
  toPosixPath,
} from './git-repo'

describe('normalizeRepoRelativePath', () => {
  it('accepts repository-relative paths and collapses dot segments', () => {
    expect(normalizeRepoRelativePath('src/app.ts')).toEqual({ ok: true, path: 'src/app.ts' })
    expect(normalizeRepoRelativePath('./src/app.ts')).toEqual({ ok: true, path: 'src/app.ts' })
    expect(normalizeRepoRelativePath('src/../src/app.ts')).toEqual({ ok: true, path: 'src/app.ts' })
    expect(normalizeRepoRelativePath('src//deep//file.ts')).toEqual({ ok: true, path: 'src/deep/file.ts' })
    expect(normalizeRepoRelativePath('src\\win\\file.ts')).toEqual({ ok: true, path: 'src/win/file.ts' })
  })

  it('refuses escape attempts and absolute paths', () => {
    expect(normalizeRepoRelativePath('../outside.txt')).toMatchObject({ ok: false })
    expect(normalizeRepoRelativePath('src/../../outside.txt')).toMatchObject({ ok: false })
    expect(normalizeRepoRelativePath('/etc/passwd')).toMatchObject({ ok: false })
    expect(normalizeRepoRelativePath('\\\\server\\share\\x')).toMatchObject({ ok: false })
    expect(normalizeRepoRelativePath('C:\\Windows\\System32\\x')).toMatchObject({ ok: false })
  })

  it('refuses control characters, empty values and non-strings', () => {
    expect(normalizeRepoRelativePath('src/\u0000evil')).toMatchObject({ ok: false })
    expect(normalizeRepoRelativePath('src/\u001bevil')).toMatchObject({ ok: false })
    expect(normalizeRepoRelativePath('   ')).toMatchObject({ ok: false })
    expect(normalizeRepoRelativePath(12)).toMatchObject({ ok: false })
  })
})

describe('isPathInside', () => {
  it('accepts the root itself and descendants, rejecting prefixes', () => {
    expect(isPathInside('/repo', '/repo', 'posix')).toBe(true)
    expect(isPathInside('/repo', '/repo/sub/file.ts', 'posix')).toBe(true)
    expect(isPathInside('/repo/', '/repo/sub', 'posix')).toBe(true)
    expect(isPathInside('/repo', '/repo2/file.ts', 'posix')).toBe(false)
    expect(isPathInside('/repo', '/', 'posix')).toBe(false)
  })

  it('folds case on Windows only', () => {
    expect(isPathInside('C:\\Repo', 'c:/repo/src', 'windows')).toBe(true)
    expect(isPathInside('/Repo', '/repo/src', 'posix')).toBe(false)
  })
})

describe('samePath', () => {
  it('normalizes separators and platform case rules', () => {
    expect(samePath('/repo/app', '/repo/app/', 'posix')).toBe(true)
    expect(samePath('C:\\Repo', 'c:/repo', 'windows')).toBe(true)
    expect(samePath('/Repo', '/repo', 'posix')).toBe(false)
  })
})

describe('isSafeRefName', () => {
  it('accepts ordinary branch and tag names', () => {
    for (const name of ['main', 'feature/git-window', 'release/v1.2.3', 'fix-1']) {
      expect(isSafeRefName(name)).toBe(true)
    }
  })

  it('rejects names git would reject or read as an option', () => {
    for (const name of ['', '-x', '/main', 'main/', 'a..b', 'a b', 'a~b', 'a^b', 'a:b', 'a?b', 'a*b', 'a[b', 'a\\b', 'a.lock', 'a@{1}', '@']) {
      expect(isSafeRefName(name)).toBe(false)
    }
    expect(isSafeRefName('x'.repeat(256))).toBe(false)
  })
})

describe('isSafeHash / isSafeRemoteName', () => {
  it('accepts hash prefixes only', () => {
    expect(isSafeHash('abc1234')).toBe(true)
    expect(isSafeHash('ABCD1234')).toBe(true)
    expect(isSafeHash('--all')).toBe(false)
    expect(isSafeHash('abc')).toBe(false)
    expect(isSafeHash('abc1234;rm -rf /')).toBe(false)
  })

  it('accepts ordinary remote names', () => {
    expect(isSafeRemoteName('origin')).toBe(true)
    expect(isSafeRemoteName('up-stream_1')).toBe(true)
    expect(isSafeRemoteName('origin;rm')).toBe(false)
    expect(isSafeRemoteName('a/b')).toBe(false)
  })
})

describe('display helpers', () => {
  it('strips ref namespaces and exposes branch parents', () => {
    expect(shortRefName('refs/heads/main')).toBe('main')
    expect(shortRefName('refs/remotes/origin/main')).toBe('origin/main')
    expect(shortRefName('refs/tags/v1')).toBe('v1')
    expect(branchParent('feature/git-window')).toBe('feature')
    expect(branchParent('main')).toBeUndefined()
    expect(toPosixPath('C:\\repo\\src')).toBe('C:/repo/src')
  })
})
