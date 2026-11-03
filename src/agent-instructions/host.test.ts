/**
 * Tests for the Agent instructions Host half: home resolution, discovery order,
 * duplicate suppression, the write/delete guards, and the route envelopes over
 * the production trust gate.
 *
 * Every filesystem assertion runs against a throwaway directory under the OS
 * temp directory. Discovery tests pass `homes` in directly, and route tests stub
 * `DSH_HOME`/`DSH_AGENTS_HOME`, so no test ever reads or writes the real home.
 *
 * @module dsh-session-map/agent-instructions/host.test
 */
import type { Context } from '@deepseek-ai/cordis'
import { createHash } from 'node:crypto'
import { lstat, mkdir, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  createFakeContext,
  FakeWebServer,
  invokeRoute,
} from '../git-workspace/testing/fake-host'
import {
  deleteInstructionFile,
  installAgentInstructionsHost,
  InstructionHostError,
  readInstructionState,
  resolveInstructionHomes,
  resolveSessionCwd,
  writeInstructionFile,
  type InstructionHomes,
} from './host'
import {
  AGENT_INSTRUCTIONS_ROUTE,
  INSTRUCTION_FILE_MAX_BYTES,
  allInstructionFiles,
  existingInstructionFiles,
  findInstructionFile,
  instructionFileId,
  type AgentInstructionsState,
} from './model'

/** Directories created by one test, removed afterwards. */
const created: string[] = []

afterEach(async () => {
  vi.unstubAllEnvs()
  await Promise.all(created.splice(0).map(dir => rm(dir, { recursive: true, force: true })))
})

/** Create one throwaway directory under the OS temp root. */
async function makeTempDir(prefix = 'dsh-ai-'): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), prefix))
  created.push(dir)
  return dir
}

/** Write one file inside a directory, creating parent directories. */
async function writeIn(dir: string, relativePath: string, content: string): Promise<string> {
  const target = join(dir, relativePath)
  await mkdir(dirname(target), { recursive: true })
  await writeFile(target, content, 'utf8')
  return target
}

/** SHA-1 of the exact text, the digest a save must match. */
function sha1(content: string): string {
  return createHash('sha1').update(content).digest('hex')
}

/**
 * Build resolved homes over one test directory without touching the environment.
 * @param base - directory the two fake homes live under.
 * @returns homes labelled the way an override is labelled.
 */
function homesIn(base: string): InstructionHomes {
  return resolveInstructionHomes({
    DSH_HOME: join(base, 'home-dsh'),
    DSH_AGENTS_HOME: join(base, 'home-agents'),
  }, '/home/tester')
}

/** Options for one state read over a fixed clock. */
const CLOCK = '2026-11-03T00:00:00.000Z'

/**
 * Make a project tree: a `.git` marker at the root and `a/b` below it.
 * @returns the project root.
 */
async function makeProjectTree(): Promise<string> {
  const dir = await makeTempDir()
  await mkdir(join(dir, '.git'), { recursive: true })
  await mkdir(join(dir, 'a', 'b'), { recursive: true })
  return dir
}

/** Read the state of one Session for a fixture directory. */
async function readState(dir: string, options: {
  readonly cwd?: string
  readonly homes?: InstructionHomes
} = {}): Promise<AgentInstructionsState> {
  return await readInstructionState({
    sessionId: 'session-1',
    cwd: options.cwd ?? dir,
    homes: options.homes ?? homesIn(dir),
    generatedAt: CLOCK,
  })
}

/** Every project file of one level, by candidate name. */
function levelFiles(state: AgentInstructionsState, relativeDir: string) {
  const level = state.levels.find(candidate => candidate.relativeDir === relativeDir)
  if (level === undefined) throw new Error(`no level ${relativeDir}`)
  return level.files
}

/** One project file, looked up by its root-relative path. */
function projectFile(state: AgentInstructionsState, relativePath: string) {
  const found = allInstructionFiles(state).find(file => file.scope === 'project' && file.displayPath === relativePath)
  if (found === undefined) throw new Error(`no project file ${relativePath}`)
  return found
}

describe('resolveInstructionHomes', () => {
  it('falls back to the home-relative defaults with symbolic labels', () => {
    const homes = resolveInstructionHomes({}, '/home/tester')
    expect(homes.dshHome).toBe(join('/home/tester', '.dsh'))
    expect(homes.agentsHome).toBe(join('/home/tester', '.agents'))
    expect(homes.dshTitle).toBe('~/.dsh')
    expect(homes.agentsTitle).toBe('~/.agents')
  })

  it('prefers the environment overrides and labels them by variable', () => {
    const homes = resolveInstructionHomes({ DSH_HOME: '/opt/dsh', DSH_AGENTS_HOME: '/opt/agents' }, '/home/tester')
    expect(homes.dshHome).toBe(resolve('/opt/dsh'))
    expect(homes.agentsHome).toBe(resolve('/opt/agents'))
    expect(homes.dshTitle).toBe('$DSH_HOME')
    expect(homes.agentsTitle).toBe('$DSH_AGENTS_HOME')
  })

  it('ignores blank overrides', () => {
    const homes = resolveInstructionHomes({ DSH_HOME: '   ', DSH_AGENTS_HOME: '' }, '/home/tester')
    expect(homes.dshHome).toBe(join('/home/tester', '.dsh'))
    expect(homes.agentsHome).toBe(join('/home/tester', '.agents'))
    expect(homes.dshTitle).toBe('~/.dsh')
    expect(homes.agentsTitle).toBe('~/.agents')
  })

  it('keeps the symbolic label when an override names the default directory', () => {
    const homes = resolveInstructionHomes({ DSH_HOME: join('/home/tester', '.dsh') }, '/home/tester')
    expect(homes.dshTitle).toBe('~/.dsh')
    expect(homes.agentsTitle).toBe('~/.agents')
  })
})

describe('readInstructionState discovery', () => {
  it('walks the project chain from the root down to the cwd', async () => {
    const dir = await makeProjectTree()
    await writeIn(dir, 'AGENTS.md', '# root agents\n')
    await writeIn(dir, 'CLAUDE.md', '# root claude\n')
    await writeIn(dir, 'a/AGENTS.local.md', '# a local\n')
    await writeIn(dir, 'a/b/AGENTS.md', '# b agents\n')

    const state = await readState(dir, { cwd: join(dir, 'a', 'b') })
    expect(state.generatedAt).toBe(CLOCK)
    expect(state.project.root).toBe(dir)
    expect(state.project.hasMarker).toBe(true)
    expect(state.levels.map(level => level.relativeDir)).toEqual(['.', 'a', 'a/b'])
    expect(state.levels.map(level => level.title)).toEqual(['项目根', 'a', 'a/b'])
    expect(state.levels.map(level => level.id)).toEqual([
      'project:.',
      'project:a',
      'project:a/b',
    ])

    const names = ['AGENTS.md', 'CLAUDE.md', 'AGENTS.local.md', 'CLAUDE.local.md']
    expect(levelFiles(state, '.').map(file => file.name)).toEqual(names)
    expect(levelFiles(state, 'a').map(file => file.name)).toEqual(names)
    expect(levelFiles(state, 'a/b').map(file => file.name)).toEqual(names)
    expect(levelFiles(state, 'a').map(file => file.displayPath)).toEqual(
      names.map(name => `a/${name}`),
    )
    expect(levelFiles(state, 'a').map(file => file.variant)).toEqual([
      'base',
      'base',
      'local',
      'local',
    ])
    expect(projectFile(state, 'AGENTS.md').levelId).toBe('project:.')
    expect(projectFile(state, 'a/AGENTS.local.md').levelId).toBe('project:a')
    expect(projectFile(state, 'a/b/AGENTS.md').levelId).toBe('project:a/b')

    // Injection order runs broad to specific across the whole chain.
    expect(existingInstructionFiles(state).map(file => file.displayPath)).toEqual([
      'AGENTS.md',
      'CLAUDE.md',
      'a/AGENTS.local.md',
      'a/b/AGENTS.md',
    ])
    expect(existingInstructionFiles(state).map(file => file.order)).toEqual([1, 2, 3, 4])
    expect(state.effectiveCount).toBe(4)

    // The user-global candidates are reported even when absent.
    expect(state.userRoots.map(root => root.id)).toEqual(['user:dsh-home', 'user:agents-home'])
    expect(state.userRoots.map(root => root.file.id)).toEqual([
      'user:dsh-home/AGENTS.md',
      'user:agents-home/AGENTS.md',
    ])
    expect(state.userRoots.every(root => root.file.exists === false)).toBe(true)
    expect(state.userRoots[0]?.file.displayPath).toBe('$DSH_HOME/AGENTS.md')

    for (const file of existingInstructionFiles(state)) {
      expect(file.size).toBeGreaterThan(0)
      expect(typeof file.modifiedAt).toBe('string')
      expect(Number.isNaN(Date.parse(file.modifiedAt ?? ''))).toBe(false)
    }
  })

  it('renders absent candidates without size, mtime, or order', async () => {
    const dir = await makeProjectTree()
    await writeIn(dir, 'AGENTS.md', '# root\n')
    const state = await readState(dir)
    const missing = projectFile(state, 'CLAUDE.md')
    expect(missing.exists).toBe(false)
    expect(missing.size).toBeNull()
    expect(missing.modifiedAt).toBeNull()
    expect(missing.order).toBeUndefined()
    expect(missing.skipped).toBeUndefined()
    expect(existingInstructionFiles(state)).toHaveLength(1)
  })

  it('treats a cwd outside any repository as its own project root', async () => {
    const dir = await makeTempDir()
    await writeIn(dir, 'AGENTS.md', '# alone\n')
    const state = await readState(dir)
    expect(state.project.hasMarker).toBe(false)
    expect(state.project.root).toBe(dir)
    expect(state.levels.map(level => level.relativeDir)).toEqual(['.'])
    expect(state.effectiveCount).toBe(1)
  })

  it('refuses a cwd that is not a directory', async () => {
    const dir = await makeTempDir()
    const file = await writeIn(dir, 'not-a-dir.txt', 'x')
    await expect(readState(dir, { cwd: file })).rejects.toMatchObject({
      code: 'session-cwd-unavailable',
      status: 400,
    })
    await expect(readState(dir, { cwd: join(dir, 'missing') })).rejects.toMatchObject({
      code: 'session-cwd-unavailable',
    })
  })

  it('collapses identical content across the two user roots into one entry', async () => {
    const dir = await makeTempDir()
    const homes = homesIn(dir)
    await writeIn(homes.dshHome, 'AGENTS.md', '# shared\n\n')
    await writeIn(homes.agentsHome, 'AGENTS.md', '# shared')
    const state = await readState(dir, { homes })

    const [dshRoot, agentsRoot] = state.userRoots
    expect(dshRoot?.file.order).toBe(1)
    expect(dshRoot?.file.duplicateOf).toBeUndefined()
    expect(agentsRoot?.file.exists).toBe(true)
    expect(agentsRoot?.file.order).toBeUndefined()
    expect(agentsRoot?.file.duplicateOf).toBe('$DSH_HOME/AGENTS.md')
    expect(state.effectiveCount).toBe(1)
    expect(existingInstructionFiles(state)).toHaveLength(2)
  })

  it('does not collapse identical content across different project directories', async () => {
    const dir = await makeProjectTree()
    await writeIn(dir, 'AGENTS.md', '# same\n')
    await writeIn(dir, 'a/AGENTS.md', '# same\n')
    const state = await readState(dir, { cwd: join(dir, 'a') })
    const rootFile = projectFile(state, 'AGENTS.md')
    const nestedFile = projectFile(state, 'a/AGENTS.md')
    expect(rootFile.order).toBe(1)
    expect(nestedFile.order).toBe(2)
    expect(rootFile.duplicateOf).toBeUndefined()
    expect(nestedFile.duplicateOf).toBeUndefined()
    expect(state.effectiveCount).toBe(2)
  })

  it('reports an oversized or unreadable present file as skipped', async () => {
    const dir = await makeProjectTree()
    await writeIn(dir, 'AGENTS.md', 'x'.repeat(INSTRUCTION_FILE_MAX_BYTES + 1))
    // A directory at a candidate path is not a file the surface can edit.
    await mkdir(join(dir, 'CLAUDE.md'))
    const state = await readState(dir)
    const oversized = projectFile(state, 'AGENTS.md')
    expect(oversized.exists).toBe(true)
    expect(oversized.skipped).toBe('too-large')
    expect(oversized.order).toBeUndefined()
    expect(projectFile(state, 'CLAUDE.md').exists).toBe(false)
    expect(state.effectiveCount).toBe(0)
  })
})

describe('writeInstructionFile', () => {
  it('creates a missing candidate and the next read shows it in order', async () => {
    const dir = await makeProjectTree()
    const before = await readState(dir)
    expect(projectFile(before, 'AGENTS.md').exists).toBe(false)

    const detail = await writeInstructionFile(before, {
      id: 'project:./AGENTS.md',
      content: '# created\n',
    })
    expect(detail.id).toBe('project:./AGENTS.md')
    expect(detail.exists).toBe(true)
    expect(detail.size).toBe(Buffer.byteLength('# created\n', 'utf8'))
    expect(detail.content).toBe('# created\n')
    expect(detail.sha1).toBe(sha1('# created\n'))
    expect(Number.isNaN(Date.parse(detail.modifiedAt ?? ''))).toBe(false)
    expect(detail.order).toBeUndefined()
    expect(detail.skipped).toBeUndefined()
    expect(await readFile(join(dir, 'AGENTS.md'), 'utf8')).toBe('# created\n')

    const after = await readState(dir)
    const created = projectFile(after, 'AGENTS.md')
    expect(created.exists).toBe(true)
    expect(created.order).toBe(1)
    expect(after.effectiveCount).toBe(1)
  })

  it('overwrites when the expected digest still matches', async () => {
    const dir = await makeProjectTree()
    const state = await readState(dir)
    const first = await writeInstructionFile(state, {
      id: 'project:./AGENTS.md',
      content: '# one\n',
    })
    const second = await writeInstructionFile(state, {
      id: 'project:./AGENTS.md',
      content: '# two\n',
      expectedSha1: first.sha1,
    })
    expect(second.sha1).toBe(sha1('# two\n'))
    expect(second.size).toBe(Buffer.byteLength('# two\n', 'utf8'))
    expect(await readFile(join(dir, 'AGENTS.md'), 'utf8')).toBe('# two\n')
  })

  it('rejects a stale digest and a create over an existing file', async () => {
    const dir = await makeProjectTree()
    const state = await readState(dir)
    const first = await writeInstructionFile(state, {
      id: 'project:./AGENTS.md',
      content: '# one\n',
    })
    await writeInstructionFile(state, {
      id: 'project:./AGENTS.md',
      content: '# two\n',
      expectedSha1: first.sha1,
    })
    await expect(writeInstructionFile(state, {
      id: 'project:./AGENTS.md',
      content: '# three\n',
      expectedSha1: first.sha1,
    })).rejects.toMatchObject({ code: 'conflict', status: 409 })
    await expect(writeInstructionFile(state, {
      id: 'project:./AGENTS.md',
      content: '# three\n',
    })).rejects.toMatchObject({ code: 'conflict', status: 409 })
    expect(await readFile(join(dir, 'AGENTS.md'), 'utf8')).toBe('# two\n')
  })

  it('rejects a symlink target', async () => {
    const dir = await makeProjectTree()
    const outside = await makeTempDir()
    const target = await writeIn(outside, 'real.md', '# real\n')
    await symlink(target, join(dir, 'AGENTS.md'))
    const state = await readState(dir)
    await expect(writeInstructionFile(state, {
      id: 'project:./AGENTS.md',
      content: '# overwritten\n',
    })).rejects.toMatchObject({ code: 'symlink-not-allowed', status: 409 })
    expect(await readFile(target, 'utf8')).toBe('# real\n')
  })

  it('rejects a non-regular target', async () => {
    const dir = await makeProjectTree()
    await mkdir(join(dir, 'AGENTS.md'))
    const state = await readState(dir)
    await expect(writeInstructionFile(state, {
      id: 'project:./AGENTS.md',
      content: '# nope\n',
    })).rejects.toMatchObject({ code: 'not-regular-file', status: 409 })
  })

  it('rejects content over the source cap and NUL bytes', async () => {
    const dir = await makeProjectTree()
    const state = await readState(dir)
    await expect(writeInstructionFile(state, {
      id: 'project:./AGENTS.md',
      content: 'x'.repeat(INSTRUCTION_FILE_MAX_BYTES + 1),
    })).rejects.toMatchObject({ code: 'too-large', status: 413 })
    await expect(writeInstructionFile(state, {
      id: 'project:./AGENTS.md',
      content: 'a\u0000b',
    })).rejects.toMatchObject({ code: 'not-text', status: 415 })
  })

  it('rejects an id the state does not contain', async () => {
    const dir = await makeProjectTree()
    const state = await readState(dir)
    await expect(writeInstructionFile(state, {
      id: 'project:./NOPE.md',
      content: 'x',
    })).rejects.toMatchObject({ code: 'unknown-file', status: 404 })
  })

  it('creates a missing user-global directory on demand', async () => {
    const dir = await makeTempDir()
    const homes = homesIn(dir)
    const state = await readState(dir, { homes })
    await writeInstructionFile(state, {
      id: instructionFileId('user:agents-home', 'AGENTS.md'),
      content: '# user\n',
    })
    expect(await readFile(join(homes.agentsHome, 'AGENTS.md'), 'utf8')).toBe('# user\n')
    const after = await readState(dir, { homes })
    expect(after.userRoots[1]?.file.exists).toBe(true)
    expect(after.userRoots[1]?.file.order).toBe(1)
  })
})

describe('deleteInstructionFile', () => {
  it('removes an existing file', async () => {
    const dir = await makeProjectTree()
    const target = await writeIn(dir, 'AGENTS.md', '# doomed\n')
    const state = await readState(dir)
    await deleteInstructionFile(state, 'project:./AGENTS.md')
    await expect(lstat(target)).rejects.toThrow()
    const after = await readState(dir)
    expect(projectFile(after, 'AGENTS.md').exists).toBe(false)
  })

  it('reports an unknown id and an already-deleted file', async () => {
    const dir = await makeProjectTree()
    await writeIn(dir, 'AGENTS.md', '# doomed\n')
    const state = await readState(dir)
    await expect(deleteInstructionFile(state, 'project:./NOPE.md')).rejects.toMatchObject({
      code: 'unknown-file',
      status: 404,
    })
    await deleteInstructionFile(state, 'project:./AGENTS.md')
    await expect(deleteInstructionFile(state, 'project:./AGENTS.md')).rejects.toMatchObject({
      code: 'unknown-file',
    })
  })

  it('refuses a symlink and a non-regular target', async () => {
    const dir = await makeProjectTree()
    const outside = await makeTempDir()
    const target = await writeIn(outside, 'real.md', '# real\n')
    await symlink(target, join(dir, 'AGENTS.md'))
    await mkdir(join(dir, 'CLAUDE.md'))
    const state = await readState(dir)
    await expect(deleteInstructionFile(state, 'project:./AGENTS.md')).rejects.toMatchObject({
      code: 'symlink-not-allowed',
    })
    await expect(deleteInstructionFile(state, 'project:./CLAUDE.md')).rejects.toMatchObject({
      code: 'not-regular-file',
    })
    expect(await readFile(target, 'utf8')).toBe('# real\n')
  })
})

describe('resolveSessionCwd', () => {
  it('prefers the projected working directory over the header cwd', async () => {
    const services = {
      sessionQuery: {
        observeSession: async () => ({
          header: { cwd: '/header' },
          projections: { values: { workingDirectory: '/projected' } },
        }),
      },
    }
    await expect(resolveSessionCwd(services, 'session-1')).resolves.toBe('/projected')
  })

  it('falls back to the header cwd and disposes the observation', async () => {
    let disposed = false
    const services = {
      sessionQuery: {
        observeSession: () => ({
          header: { cwd: '/header' },
          [Symbol.dispose](): void {
            disposed = true
          },
        }),
      },
    }
    await expect(resolveSessionCwd(services, 'session-1')).resolves.toBe('/header')
    expect(disposed).toBe(true)
  })

  it('ignores a dispose that throws', async () => {
    const services = {
      sessionQuery: {
        observeSession: () => ({
          header: { cwd: '/header' },
          [Symbol.dispose](): void {
            throw new Error('dispose failed')
          },
        }),
      },
    }
    await expect(resolveSessionCwd(services, 'session-1')).resolves.toBe('/header')
  })

  it('prefers the live agent ensure result', async () => {
    const live = { id: 'live' }
    const services = {
      sessionQuery: { observeSession: async () => ({ header: { cwd: '/observed' } }) },
      agents: { get: () => live },
      workingDirectory: {
        defaultDirectory: '/default',
        ensure: async () => '/ensured',
      },
    }
    await expect(resolveSessionCwd(services, 'session-1')).resolves.toBe('/ensured')
  })

  it('falls back to the deployment default directory', async () => {
    const services = {
      sessionQuery: { observeSession: async () => ({ header: {} }) },
      workingDirectory: { defaultDirectory: '/default' },
    }
    await expect(resolveSessionCwd(services, 'session-1')).resolves.toBe('/default')
  })

  it('fails when the query service is absent, the Session is missing, or no cwd exists', async () => {
    await expect(resolveSessionCwd({}, 'session-1')).rejects.toMatchObject({
      code: 'session-not-found',
      status: 404,
    })
    await expect(resolveSessionCwd({
      sessionQuery: { observeSession: async () => undefined },
    }, 'session-1')).rejects.toMatchObject({ code: 'session-not-found' })
    await expect(resolveSessionCwd({
      sessionQuery: { observeSession: async () => ({ header: {} }) },
    }, 'session-1')).rejects.toMatchObject({
      code: 'session-cwd-unavailable',
      status: 400,
    })
    await expect(resolveSessionCwd({
      sessionQuery: {
        observeSession: async () => {
          throw new Error('boom')
        },
      },
    }, 'session-1')).rejects.toBeInstanceOf(InstructionHostError)
  })
})

/** A fake `sessionQuery` returning one cwd for every Session. */
function sessionQueryFor(cwd: string): { observeSession(id: string): Promise<unknown> } {
  return {
    observeSession: async () => ({
      header: { cwd },
      projections: { values: { workingDirectory: cwd } },
    }),
  }
}

/** Install the Host routes over a fake web server and fake services. */
function installRoutes(services: Readonly<Record<string, unknown>>): FakeWebServer {
  const server = new FakeWebServer()
  const ctx = createFakeContext({ webServer: server, ...services })
  installAgentInstructionsHost(ctx as unknown as Context)
  return server
}

/** Point both user roots at throwaway directories for one route test. */
function stubHomes(dir: string): void {
  vi.stubEnv('DSH_HOME', join(dir, 'home-dsh'))
  vi.stubEnv('DSH_AGENTS_HOME', join(dir, 'home-agents'))
}

/** A fresh project tree with one root instruction file. */
async function makeRouteFixture(): Promise<string> {
  const dir = await makeProjectTree()
  await writeIn(dir, 'AGENTS.md', '# routed\n')
  stubHomes(dir)
  return dir
}

describe('routes', () => {
  it('answers the assembled state for a Session', async () => {
    const dir = await makeRouteFixture()
    const server = installRoutes({
      sessionQuery: sessionQueryFor(dir),
      workingDirectory: { defaultDirectory: dir },
    })
    const response = await invokeRoute(server, {
      path: `${AGENT_INSTRUCTIONS_ROUTE}/state?sessionId=session-1`,
    })
    expect(response.status).toBe(200)
    const body = response.json as { ok: boolean; state: AgentInstructionsState }
    expect(body.ok).toBe(true)
    expect(body.state.sessionId).toBe('session-1')
    expect(body.state.cwd).toBe(dir)
    expect(body.state.project.root).toBe(dir)
    expect(body.state.levels[0]?.files[0]?.id).toBe('project:./AGENTS.md')
    expect(body.state.levels[0]?.files[0]?.exists).toBe(true)
    expect(body.state.userRoots.map(root => root.id)).toEqual(['user:dsh-home', 'user:agents-home'])
    expect(body.state.userRoots[0]?.title).toBe('$DSH_HOME')
    expect(body.state.effectiveCount).toBe(1)
  })

  it('answers one file body and rejects an unknown id', async () => {
    const dir = await makeRouteFixture()
    const server = installRoutes({ sessionQuery: sessionQueryFor(dir) })
    const id = encodeURIComponent('project:./AGENTS.md')
    const response = await invokeRoute(server, {
      path: `${AGENT_INSTRUCTIONS_ROUTE}/file?sessionId=session-1&id=${id}`,
    })
    expect(response.status).toBe(200)
    const body = response.json as { ok: boolean; file: { id: string; content: string; sha1: string } }
    expect(body.ok).toBe(true)
    expect(body.file.id).toBe('project:./AGENTS.md')
    expect(body.file.content).toBe('# routed\n')
    expect(body.file.sha1).toBe(sha1('# routed\n'))

    const missing = await invokeRoute(server, {
      path: `${AGENT_INSTRUCTIONS_ROUTE}/file?sessionId=session-1&id=${encodeURIComponent('project:./NOPE.md')}`,
    })
    expect(missing.status).toBe(404)
    expect((missing.json as { error: { code: string } }).error.code).toBe('unknown-file')
  })

  it('round-trips a save and a delete', async () => {
    const dir = await makeRouteFixture()
    const server = installRoutes({ sessionQuery: sessionQueryFor(dir) })
    const id = 'project:./CLAUDE.md'

    const created = await invokeRoute(server, {
      method: 'POST',
      path: `${AGENT_INSTRUCTIONS_ROUTE}/save`,
      body: { sessionId: 'session-1', id, content: '# saved\n' },
    })
    expect(created.status).toBe(200)
    const createdBody = created.json as { ok: boolean; file: { sha1: string; content: string } }
    expect(createdBody.ok).toBe(true)
    expect(createdBody.file.content).toBe('# saved\n')
    expect(await readFile(join(dir, 'CLAUDE.md'), 'utf8')).toBe('# saved\n')

    const updated = await invokeRoute(server, {
      method: 'POST',
      path: `${AGENT_INSTRUCTIONS_ROUTE}/save`,
      body: {
        sessionId: 'session-1',
        id,
        content: '# rewritten\n',
        expectedSha1: createdBody.file.sha1,
      },
    })
    expect(updated.status).toBe(200)
    expect(await readFile(join(dir, 'CLAUDE.md'), 'utf8')).toBe('# rewritten\n')

    const conflicted = await invokeRoute(server, {
      method: 'POST',
      path: `${AGENT_INSTRUCTIONS_ROUTE}/save`,
      body: {
        sessionId: 'session-1',
        id,
        content: '# stale\n',
        expectedSha1: createdBody.file.sha1,
      },
    })
    expect(conflicted.status).toBe(409)
    expect((conflicted.json as { error: { code: string } }).error.code).toBe('conflict')

    const deleted = await invokeRoute(server, {
      method: 'POST',
      path: `${AGENT_INSTRUCTIONS_ROUTE}/delete`,
      body: { sessionId: 'session-1', id },
    })
    expect(deleted.status).toBe(200)
    expect(deleted.json).toEqual({ ok: true })
    await expect(lstat(join(dir, 'CLAUDE.md'))).rejects.toThrow()
  })

  it('refuses a non-loopback peer before any filesystem work', async () => {
    const dir = await makeRouteFixture()
    const server = installRoutes({ sessionQuery: sessionQueryFor(dir) })
    const response = await invokeRoute(server, {
      path: `${AGENT_INSTRUCTIONS_ROUTE}/state?sessionId=session-1`,
      peer: '192.168.1.9',
    })
    expect(response.status).toBe(403)
    expect((response.json as { error: { code: string } }).error.code).toBe('not-trusted')
  })

  it('answers 405 for a wrong method and 404 for an unknown endpoint', async () => {
    const dir = await makeRouteFixture()
    const server = installRoutes({ sessionQuery: sessionQueryFor(dir) })
    const wrongMethod = await invokeRoute(server, {
      method: 'POST',
      path: `${AGENT_INSTRUCTIONS_ROUTE}/state?sessionId=session-1`,
    })
    expect(wrongMethod.status).toBe(405)
    expect((wrongMethod.json as { error: { code: string } }).error.code).toBe('bad-request')

    const unknown = await invokeRoute(server, {
      path: `${AGENT_INSTRUCTIONS_ROUTE}/nope?sessionId=session-1`,
    })
    expect(unknown.status).toBe(404)
    expect((unknown.json as { error: { code: string } }).error.code).toBe('bad-request')
  })

  it('answers 400 for a missing session id, an empty body, and a non-object body', async () => {
    const dir = await makeRouteFixture()
    const server = installRoutes({ sessionQuery: sessionQueryFor(dir) })
    const noSession = await invokeRoute(server, { path: `${AGENT_INSTRUCTIONS_ROUTE}/state` })
    expect(noSession.status).toBe(400)
    expect((noSession.json as { error: { code: string } }).error.code).toBe('bad-request')

    const emptyBody = await invokeRoute(server, {
      method: 'POST',
      path: `${AGENT_INSTRUCTIONS_ROUTE}/save`,
    })
    expect(emptyBody.status).toBe(400)
    expect((emptyBody.json as { error: { code: string } }).error.code).toBe('bad-request')

    const nonObject = await invokeRoute(server, {
      method: 'POST',
      path: `${AGENT_INSTRUCTIONS_ROUTE}/save`,
      body: 'not-an-object',
    })
    expect(nonObject.status).toBe(400)
    expect((nonObject.json as { error: { code: string } }).error.code).toBe('bad-request')
  })

  it('answers a clear envelope when the Session services are absent', async () => {
    const server = installRoutes({})
    const response = await invokeRoute(server, {
      path: `${AGENT_INSTRUCTIONS_ROUTE}/state?sessionId=session-1`,
    })
    expect(response.status).toBe(404)
    const body = response.json as { ok: boolean; error: { code: string; message: string } }
    expect(body.ok).toBe(false)
    expect(body.error.code).toBe('session-not-found')
    expect(body.error.message).toContain('sessionQuery')
  })
})
