/**
 * Rules tests for the Git workspace helpers: everything the Host trusts from
 * the page passes through these functions, so they are exercised directly
 * instead of through a Cordis context.
 *
 * @module dsh-session-map/git-workspace/git.test
 */
import { describe, expect, it } from 'vitest'
import {
  classifyCloneFailure,
  cloneArgv,
  cloneFailureDetail,
  isAbsoluteDirectory,
  isSupportedRepositoryAddress,
  joinTargetPath,
  parentDirectoryOf,
  parseCloneRequest,
  repositoryNameFromAddress,
} from './git'

describe('repositoryNameFromAddress', () => {
  it('derives the name git would use for supported address forms', () => {
    expect(repositoryNameFromAddress('https://github.com/owner/repo.git')).toBe('repo')
    expect(repositoryNameFromAddress('https://github.com/owner/repo/')).toBe('repo')
    expect(repositoryNameFromAddress('https://github.com/owner/repo')).toBe('repo')
    expect(repositoryNameFromAddress('git@github.com:owner/repo.git')).toBe('repo')
    expect(repositoryNameFromAddress('ssh://git@host.example:22/team/repo.git')).toBe('repo')
    expect(repositoryNameFromAddress('file:///Users/you/projects/repo.git')).toBe('repo')
    expect(repositoryNameFromAddress('/Users/you/projects/repo')).toBe('repo')
    expect(repositoryNameFromAddress('C:\\Users\\you\\projects\\repo.git')).toBe('repo')
  })

  it('refuses names that could escape the chosen parent or hide as dot entries', () => {
    expect(repositoryNameFromAddress('https://github.com/owner/..')).toBeUndefined()
    expect(repositoryNameFromAddress('/Users/you/projects/.git')).toBeUndefined()
    expect(repositoryNameFromAddress('/Users/you/projects/.')).toBeUndefined()
    expect(repositoryNameFromAddress('https://github.com/')).toBeUndefined()
    expect(repositoryNameFromAddress('')).toBeUndefined()
  })

  it('refuses names that are not safe as one path segment', () => {
    expect(repositoryNameFromAddress('https://github.com/owner/-danger.git')).toBeUndefined()
    expect(repositoryNameFromAddress('/tmp/a b')).toBeUndefined()
    expect(repositoryNameFromAddress('/tmp/CON')).toBeUndefined()
    expect(repositoryNameFromAddress('/tmp/nul.txt')).toBeUndefined()
    expect(repositoryNameFromAddress('/tmp/repo.')).toBeUndefined()
    expect(repositoryNameFromAddress(`/tmp/${'x'.repeat(101)}`)).toBeUndefined()
  })
})

describe('isSupportedRepositoryAddress', () => {
  it('accepts the documented address families', () => {
    expect(isSupportedRepositoryAddress('https://github.com/owner/repo.git')).toBe(true)
    expect(isSupportedRepositoryAddress('http://host/repo')).toBe(true)
    expect(isSupportedRepositoryAddress('ssh://git@host/repo')).toBe(true)
    expect(isSupportedRepositoryAddress('git://host/repo')).toBe(true)
    expect(isSupportedRepositoryAddress('file:///tmp/repo')).toBe(true)
    expect(isSupportedRepositoryAddress('git@github.com:owner/repo.git')).toBe(true)
    expect(isSupportedRepositoryAddress('/tmp/repo')).toBe(true)
    expect(isSupportedRepositoryAddress('C:\\tmp\\repo')).toBe(true)
  })

  it('rejects schemes and shapes git clone must not receive', () => {
    expect(isSupportedRepositoryAddress('ftp://host/repo')).toBe(false)
    expect(isSupportedRepositoryAddress('github.com/owner/repo')).toBe(false)
    expect(isSupportedRepositoryAddress('repo')).toBe(false)
    expect(isSupportedRepositoryAddress('::')).toBe(false)
  })
})

describe('parseCloneRequest', () => {
  it('normalizes a valid body and defaults the shallow switch off', () => {
    expect(parseCloneRequest({
      url: '  https://github.com/owner/repo.git ',
      parentDir: ' /Users/you/projects ',
    })).toEqual({
      ok: true,
      request: {
        url: 'https://github.com/owner/repo.git',
        parentDir: '/Users/you/projects',
        shallow: false,
      },
    })
  })

  it('carries the shallow flag through', () => {
    const result = parseCloneRequest({
      url: 'https://github.com/owner/repo.git',
      parentDir: '/Users/you/projects',
      shallow: true,
    })
    expect(result.ok).toBe(true)
    expect(result.ok ? result.request.shallow : null).toBe(true)
  })

  it('rejects non-object bodies and wrong field types', () => {
    expect(parseCloneRequest(undefined)).toMatchObject({ ok: false, code: 'invalid-request' })
    expect(parseCloneRequest([])).toMatchObject({ ok: false, code: 'invalid-request' })
    expect(parseCloneRequest({ url: 1, parentDir: '/x' })).toMatchObject({ ok: false, code: 'invalid-request' })
    expect(parseCloneRequest({ url: 'https://host/repo', parentDir: 1 })).toMatchObject({ ok: false, code: 'invalid-request' })
    expect(parseCloneRequest({ url: 'https://host/repo', parentDir: '/x', shallow: 'yes' }))
      .toMatchObject({ ok: false, code: 'invalid-request' })
  })

  it('rejects addresses that could be read as git options or shell text', () => {
    expect(parseCloneRequest({ url: '', parentDir: '/x' })).toMatchObject({ ok: false, code: 'invalid-url' })
    expect(parseCloneRequest({ url: '--upload-pack=x', parentDir: '/x' })).toMatchObject({ ok: false, code: 'invalid-url' })
    expect(parseCloneRequest({ url: 'https://host/repo name', parentDir: '/x' })).toMatchObject({ ok: false, code: 'invalid-url' })
    expect(parseCloneRequest({ url: 'https://host/repo\nrm -rf /', parentDir: '/x' }))
      .toMatchObject({ ok: false, code: 'invalid-url' })
    expect(parseCloneRequest({ url: 'github.com/owner/repo', parentDir: '/x' }))
      .toMatchObject({ ok: false, code: 'unsupported-url' })
  })

  it('requires an absolute parent directory', () => {
    expect(parseCloneRequest({ url: 'https://host/repo', parentDir: '' }))
      .toMatchObject({ ok: false, code: 'invalid-directory' })
    expect(parseCloneRequest({ url: 'https://host/repo', parentDir: 'projects' }))
      .toMatchObject({ ok: false, code: 'invalid-directory' })
    expect(parseCloneRequest({ url: 'https://host/repo', parentDir: './projects' }))
      .toMatchObject({ ok: false, code: 'invalid-directory' })
    expect(parseCloneRequest({ url: 'https://host/repo', parentDir: `/${'x'.repeat(1025)}` }))
      .toMatchObject({ ok: false, code: 'invalid-directory' })
  })
})

describe('isAbsoluteDirectory', () => {
  it('accepts both absolute dialects and nothing relative', () => {
    expect(isAbsoluteDirectory('/Users/you')).toBe(true)
    expect(isAbsoluteDirectory('C:\\Users\\you')).toBe(true)
    expect(isAbsoluteDirectory('\\\\server\\share')).toBe(true)
    expect(isAbsoluteDirectory('./relative')).toBe(false)
    expect(isAbsoluteDirectory('relative/path')).toBe(false)
    expect(isAbsoluteDirectory('')).toBe(false)
  })
})

describe('joinTargetPath', () => {
  it('joins POSIX paths without doubling a trailing separator', () => {
    expect(joinTargetPath('/Users/you/projects', 'repo', 'posix')).toBe('/Users/you/projects/repo')
    expect(joinTargetPath('/Users/you/projects/', 'repo', 'posix')).toBe('/Users/you/projects/repo')
    expect(joinTargetPath('/', 'repo', 'posix')).toBe('/repo')
  })

  it('joins Windows paths with a backslash', () => {
    expect(joinTargetPath('C:\\Users\\you', 'repo', 'windows')).toBe('C:\\Users\\you\\repo')
    expect(joinTargetPath('C:\\', 'repo', 'windows')).toBe('C:\\repo')
  })
})

describe('parentDirectoryOf', () => {
  it('walks one level up from an absolute path', () => {
    expect(parentDirectoryOf('/Users/you/Developer/projects/repo')).toBe('/Users/you/Developer/projects')
    expect(parentDirectoryOf('/Users/you/Developer/projects/repo/')).toBe('/Users/you/Developer/projects')
    expect(parentDirectoryOf('C:\\Users\\you\\repo')).toBe('C:\\Users\\you')
    expect(parentDirectoryOf('C:\\repo')).toBe('C:\\')
    expect(parentDirectoryOf('/repo')).toBeUndefined()
    expect(parentDirectoryOf('')).toBeUndefined()
  })
})

describe('cloneArgv', () => {
  it('separates options from the address and target', () => {
    expect(cloneArgv('/usr/bin/git', 'https://host/repo.git', '/projects/repo', false)).toEqual([
      '/usr/bin/git', 'clone', '--', 'https://host/repo.git', '/projects/repo',
    ])
  })

  it('asks for a shallow history when requested', () => {
    expect(cloneArgv('/usr/bin/git', 'https://host/repo.git', '/projects/repo', true)).toEqual([
      '/usr/bin/git', 'clone', '--depth', '1', '--', 'https://host/repo.git', '/projects/repo',
    ])
  })
})

describe('classifyCloneFailure', () => {
  it('recognizes the failures the page has dedicated copy for', () => {
    expect(classifyCloneFailure("fatal: destination path '/p/repo' already exists and is not an empty directory.").code)
      .toBe('target-exists')
    expect(classifyCloneFailure("fatal: destination path '/p/repo' already exists and is not a directory").code)
      .toBe('target-exists')
    expect(classifyCloneFailure("fatal: could not create work tree dir '/p/repo': No such file or directory").code)
      .toBe('parent-missing')
    expect(classifyCloneFailure("error: could not open '/p/repo': Permission denied").code).toBe('parent-missing')
    expect(classifyCloneFailure("fatal: could not read Username for 'https://host': terminal prompts disabled").code)
      .toBe('authentication')
    expect(classifyCloneFailure('no such identity: /Users/you/.ssh/id_ed25519: No such file or directory').code)
      .toBe('authentication')
    expect(classifyCloneFailure("fatal: unable to access 'https://host/': The requested URL returned error: 403").code)
      .toBe('authentication')
    expect(classifyCloneFailure('remote: Repository not found.').code).toBe('not-found')
    expect(classifyCloneFailure('fatal: unable to access: Could not resolve host: host').code).toBe('network')
    expect(classifyCloneFailure('fatal: something else').code).toBe('clone-failed')
  })
})

describe('cloneFailureDetail', () => {
  it('keeps the stderr tail, which is where git states the cause', () => {
    const detail = cloneFailureDetail(`head\n${'x'.repeat(2000)}\ntail`)
    expect(detail.startsWith('…')).toBe(true)
    expect(detail.endsWith('tail')).toBe(true)
    expect(cloneFailureDetail('  \n ')).toBe('')
  })
})
