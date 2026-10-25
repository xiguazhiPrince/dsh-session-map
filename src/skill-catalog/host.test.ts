/**
 * Host-adapter tests for the skills catalog: project-root resolution, per-level
 * grouping with the real registry shape, failure containment, and the route's
 * method/path handling. Services are faked structurally, so no Cordis context
 * or skill provider is needed.
 *
 * @module dsh-session-map/skill-catalog/host.test
 */
import { mkdir, mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import type { Context } from '@deepseek-ai/cordis'
import { afterEach, describe, expect, it } from 'vitest'
import {
  installSkillCatalogHost,
  readCatalog,
  resolveProjectRoot,
  type CatalogServices,
} from './host'
import type { SkillSummaryLike } from './catalog'

/** Temporary project directories created by one test. */
const created: string[] = []

/**
 * Create a temporary directory tree and remember it for cleanup.
 * @param segments - directories to create below the temporary root.
 * @returns the absolute temporary root.
 */
async function makeTemp(segments: readonly string[]): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'dsh-skill-catalog-'))
  created.push(root)
  await mkdir(join(root, ...segments), { recursive: true })
  return root
}

afterEach(async () => {
  await Promise.all(created.splice(0).map(async root => await rm(root, { recursive: true, force: true })))
})

/** One registry listing the fake skill registry observed. */
interface FakeListCall {
  readonly cwd: string | undefined
  readonly scope: unknown
}

/** A fake skill registry that records each listing's selector. */
class FakeSkills {
  readonly calls: FakeListCall[] = []

  /** @param rows - rows to return for one version of the catalog. */
  constructor(private readonly rows: (cwd: string | undefined) => readonly SkillSummaryLike[]) {}

  /**
   * One registry listing.
   * @param options - the cwd and scope selectors.
   * @returns the configured rows.
   */
  async list(options?: { readonly cwd?: string; readonly scope?: unknown }): Promise<readonly SkillSummaryLike[]> {
    this.calls.push({ cwd: options?.cwd, scope: options?.scope })
    return this.rows(options?.cwd)
  }
}

/** One workspace row the group builder reads. */
interface FakeWorkspace {
  readonly id: string
  readonly path: string
  readonly title: string
}

/** A fake preset registry that mints one revision lease. */
function fakePresets(): {
  readonly service: { acquireScope: () => Promise<{ key: object } & AsyncDisposable> }
  readonly scope: object
  readonly state: { disposed: boolean }
} {
  const scope = { revision: 1 }
  const state = { disposed: false }
  return {
    service: {
      acquireScope: async () => ({
        key: scope,
        [Symbol.asyncDispose]: async () => { state.disposed = true },
      }),
    },
    scope,
    state,
  }
}

/** Build the services object for one read. */
function services(
  skills: FakeSkills | undefined,
  workspaces: readonly FakeWorkspace[] | undefined,
  presets?: CatalogServices['presets'],
): CatalogServices {
  return {
    skills,
    presets,
    workspaces: workspaces === undefined ? undefined : { list: () => workspaces },
  }
}

describe('resolveProjectRoot', () => {
  it('walks up to the nearest .git directory', async () => {
    const root = await makeTemp(['repo', '.git'])
    await mkdir(join(root, 'repo', 'packages', 'app'), { recursive: true })
    expect(await resolveProjectRoot(join(root, 'repo', 'packages', 'app'))).toBe(resolve(root, 'repo'))
    expect(await resolveProjectRoot(join(root, 'repo'))).toBe(resolve(root, 'repo'))
  })

  it('treats a directory outside any repository as its own root', async () => {
    const root = await makeTemp(['plain'])
    expect(await resolveProjectRoot(join(root, 'plain'))).toBe(resolve(root, 'plain'))
  })
})

describe('readCatalog', () => {
  it('reports a missing skill registry instead of failing the route', async () => {
    const envelope = await readCatalog(services(undefined, []))
    expect(envelope.ok).toBe(false)
    expect(envelope.error?.code).toBe('skills-unavailable')
  })

  it('splits global rows by source and reads each project root', async () => {
    const repo = await makeTemp(['repo', '.git'])
    await mkdir(join(repo, 'repo', 'sub'), { recursive: true })
    const global: SkillSummaryLike[] = [
      { name: 'user-one', description: 'global', source: 'user-dsh', path: '/home/you/.dsh/skills/user-one/SKILL.md' },
      { name: 'user-two', description: 'global agents', source: 'user-agents' },
      { name: 'bundled-one', description: 'bundled', source: 'bundled' },
    ]
    const project: SkillSummaryLike[] = [
      ...global,
      { name: 'project-one', description: 'project', source: 'project-dsh', path: `${repo}/repo/.dsh/skills/project-one/SKILL.md` },
    ]
    const skills = new FakeSkills(cwd => cwd === undefined ? global : project)
    const workspaces: FakeWorkspace[] = [
      { id: 'w1', path: join(repo, 'repo'), title: 'repo' },
      { id: 'w2', path: join(repo, 'repo', 'sub'), title: 'repo/app' },
    ]

    const envelope = await readCatalog(services(skills, workspaces))
    expect(envelope.ok).toBe(true)
    expect(envelope.user?.map(skill => skill.name)).toEqual(['user-one', 'user-two'])
    expect(envelope.other?.map(skill => skill.name)).toEqual(['bundled-one'])
    expect(envelope.projects).toHaveLength(1)
    expect(envelope.projects?.[0]?.projectRoot).toBe(resolve(repo, 'repo'))
    expect(envelope.projects?.[0]?.workspaceIds).toEqual(['w1', 'w2'])
    expect(envelope.projects?.[0]?.workspaceTitles).toEqual(['repo', 'repo/app'])
    expect(envelope.projects?.[0]?.skills.map(skill => skill.name)).toEqual(['project-one'])
    // One global read plus one read per distinct root (the two workspaces share it).
    expect(skills.calls.filter(call => call.cwd === undefined)).toHaveLength(1)
    expect(skills.calls.filter(call => call.cwd === resolve(repo, 'repo'))).toHaveLength(1)
  })

  it('keeps a failing project group out of the other groups', async () => {
    const repo = await makeTemp(['repo', '.git'])
    const skills = new FakeSkills((cwd) => {
      if (cwd === undefined) return [{ name: 'user-one', source: 'user-dsh' }]
      throw new Error('permission denied')
    })
    const envelope = await readCatalog(services(skills, [{ id: 'w1', path: join(repo, 'repo'), title: 'repo' }]))
    expect(envelope.ok).toBe(true)
    expect(envelope.user?.map(skill => skill.name)).toEqual(['user-one'])
    expect(envelope.projects?.[0]?.skills).toEqual([])
    expect(envelope.projects?.[0]?.error).toContain('permission denied')
  })

  it('lists no projects when the composition has no Workspace registry', async () => {
    const skills = new FakeSkills(() => [{ name: 'user-one', source: 'user-agents' }])
    const envelope = await readCatalog(services(skills, undefined))
    expect(envelope.ok).toBe(true)
    expect(envelope.projects).toEqual([])
    expect(skills.calls.map(call => call.cwd)).toEqual([undefined])
  })

  it('reads through the default preset scope and releases the lease', async () => {
    const repo = await makeTemp(['repo', '.git'])
    const skills = new FakeSkills(() => [{ name: 'user-one', source: 'user-dsh' }])
    const presets = fakePresets()
    const envelope = await readCatalog(services(
      skills,
      [{ id: 'w1', path: join(repo, 'repo'), title: 'repo' }],
      presets.service,
    ))
    expect(envelope.ok).toBe(true)
    expect(envelope.user?.map(skill => skill.name)).toEqual(['user-one'])
    expect(skills.calls).toHaveLength(2)
    expect(skills.calls.every(call => call.scope === presets.scope)).toBe(true)
    expect(presets.state.disposed).toBe(true)
  })

  it('falls back to the global layer when the preset cannot be leased', async () => {
    const skills = new FakeSkills(() => [{ name: 'user-one', source: 'user-agents' }])
    const envelope = await readCatalog(services(skills, undefined, {
      acquireScope: async () => { throw new Error('no presets') },
    }))
    expect(envelope.ok).toBe(true)
    expect(skills.calls).toEqual([{ cwd: undefined, scope: undefined }])
  })
})

/** One captured route registration. */
interface CapturedRoute {
  readonly kind: 'exact' | 'prefix'
  readonly path: string
  readonly handler: (request: unknown, response: unknown) => void | Promise<void>
}

/** Build a fake Cordis context carrying the fake services and web server. */
function fakeContext(registry: Record<string, unknown>, route: { current?: CapturedRoute }): Context {
  const webServer = {
    register: (captured: CapturedRoute) => {
      route.current = captured
      return () => {}
    },
  }
  return {
    get: (name: string) => name === 'webServer' ? webServer : registry[name],
    effect: (callback: () => unknown) => callback(),
  } as unknown as Context
}

/** Response stub that records what the handler wrote. */
function fakeResponse(): { response: unknown; status: number; body: unknown } {
  const result = {
    status: 0,
    body: undefined as unknown,
    response: {
      writeHead: (status: number) => { result.status = status },
      end: (chunk?: string) => { result.body = chunk === undefined ? undefined : JSON.parse(chunk) as unknown },
    },
  }
  return result
}

describe('installSkillCatalogHost', () => {
  it('serves the state read and rejects other methods and paths', async () => {
    const repo = await makeTemp(['repo', '.git'])
    const skills = new FakeSkills(() => [{ name: 'user-one', description: 'global', source: 'user-dsh' }])
    const route: { current?: CapturedRoute } = {}
    const ctx = fakeContext({
      skills,
      workspaceRegistry: { list: () => [{ id: 'w1', path: join(repo, 'repo'), title: 'repo' }] },
    }, route)
    installSkillCatalogHost(ctx)
    expect(route.current?.path).toBe('/plugin-skill-catalog')
    expect(route.current?.kind).toBe('prefix')

    const handler = route.current?.handler
    expect(handler).toBeTypeOf('function')
    if (handler === undefined) return

    const ok = fakeResponse()
    await handler({ method: 'GET', url: '/plugin-skill-catalog/state' }, ok.response)
    expect(ok.status).toBe(200)
    expect((ok.body as { ok?: unknown }).ok).toBe(true)

    const method = fakeResponse()
    await handler({ method: 'POST', url: '/plugin-skill-catalog/state' }, method.response)
    expect(method.status).toBe(405)

    const missing = fakeResponse()
    await handler({ method: 'GET', url: '/plugin-skill-catalog/other' }, missing.response)
    expect(missing.status).toBe(404)
  })
})
