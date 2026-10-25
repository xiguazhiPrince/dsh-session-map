/**
 * Host half of the Skills settings page.
 *
 * Registers one same-origin read route under `/plugin-skill-catalog` that
 * answers "which skills exist at the user level and at each project level".
 * The layers are not re-discovered here: `ctx.skills` already merges every
 * provider and reports the winning skill's discovery source. The route asks the
 * registry through the default agent preset's revision lease — the same cold,
 * scope-aware read the product uses for transcript presentation — twice per
 * level:
 *
 * - `list({ scope })` without a cwd reads the user roots
 *   (`~/.dsh/skills`, `~/.agents/skills`) plus whatever the preset mounts;
 * - `list({ scope, cwd })` per project root adds that project's `.dsh/skills`
 *   and `.agents/skills`, so the `project-*` rows are exactly what the project
 *   contributes.
 *
 * Without a preset registry the read falls back to the global layer, which is
 * only narrower: the answer never becomes wrong, just thinner.
 *
 * A project root is resolved the way the filesystem provider resolves it: walk
 * up from each registered workspace path to the nearest directory holding
 * `.git`. Workspaces that share one root collapse into one group, so a monorepo
 * checkout is listed once instead of once per workspace.
 *
 * The route only reads. Unlike the Clone-from-Git family in this package it
 * changes nothing on this machine, so it keeps the web server's ordinary
 * access rules instead of the loopback gate.
 *
 * @module dsh-session-map/skill-catalog/host
 */
import type { Context } from '@deepseek-ai/cordis'
import { stat } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { errorMessage } from '../git-workspace/git'
import {
  bucketSkillSummaries,
  type ProjectSkillGroup,
  type SkillCatalogEnvelope,
  type SkillSummaryLike,
} from './catalog'

/** Route family shared by the page and the Host. */
export const SKILL_CATALOG_ROUTE = '/plugin-skill-catalog'

/** Structural view of the context's untyped service lookup. */
interface ServiceLocator {
  get(name: string): unknown
}

/** One registry listing request; `scope` selects the preset layer, `cwd` the project roots. */
interface SkillListOptions {
  readonly cwd?: string
  readonly scope?: unknown
}

/** The skill registry this Host plugin reads. */
interface SkillsService {
  list(options?: SkillListOptions): Promise<readonly SkillSummaryLike[]>
}

/** One revision lease over a preset's standing composition. */
interface ScopeLease extends AsyncDisposable {
  /** Viewing scope the registry merges layers for. */
  readonly key: object
}

/** The preset registry the cold, scope-aware read leases from. */
interface AgentPresetsService {
  acquireScope(id?: string): Promise<ScopeLease>
}

/** One durable Workspace entity, as far as project grouping needs. */
interface WorkspaceEntity {
  readonly id: unknown
  readonly path: unknown
  readonly title?: unknown
}

/** The durable Workspace registry this Host plugin reads. */
interface WorkspacesService {
  list(): readonly WorkspaceEntity[]
}

/** Services one catalog read needs; each may be absent in a thin composition. */
export interface CatalogServices {
  readonly skills?: SkillsService | undefined
  readonly presets?: AgentPresetsService | undefined
  readonly workspaces?: WorkspacesService | undefined
}

/** The subset of a Node request the route reads. */
interface RouteRequest {
  readonly method?: string | undefined
  readonly url?: string | undefined
}

/** The subset of a Node response the route writes. */
interface RouteResponse {
  writeHead(status: number, headers?: Readonly<Record<string, string | number>>): unknown
  end(body?: string): unknown
}

/** One web-server route registration. */
interface WebRoute {
  readonly kind: 'exact' | 'prefix'
  readonly path: string
  readonly handler: (request: RouteRequest, response: RouteResponse) => void | Promise<void>
}

/** The web-server service this Host plugin registers into. */
interface WebServerService {
  register(route: WebRoute): () => void
}

/**
 * Read one optional service from the global store.
 * @param ctx - the plugin's context.
 * @param name - the service name.
 * @returns the service as the caller's local interface, or `undefined`.
 */
function lookup<T>(ctx: Context, name: string): T | undefined {
  const locator = ctx as unknown as ServiceLocator
  return locator.get(name) as T | undefined
}

/** Raise and format one JSON response; a closed connection is not an error. */
function sendJson(response: RouteResponse, status: number, value: unknown): void {
  const body = JSON.stringify(value)
  try {
    response.writeHead(status, {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store',
      'content-length': new TextEncoder().encode(body).byteLength,
    })
    response.end(body)
  } catch {
    // The page navigated away or reloaded while the catalog was read.
  }
}

/**
 * Whether a path exists, without distinguishing files from directories.
 * @param path - absolute host path.
 * @returns whether the path is present.
 */
async function pathExists(path: string): Promise<boolean> {
  try {
    await stat(path)
    return true
  } catch {
    return false
  }
}

/**
 * Resolve the project root a workspace path belongs to.
 *
 * This mirrors the filesystem skill provider: the nearest ancestor (or the path
 * itself) that holds `.git`; a path outside any repository is its own root.
 * @param cwd - registered workspace path, absolute.
 * @returns the resolved project root.
 */
export async function resolveProjectRoot(cwd: string): Promise<string> {
  const start = resolve(cwd)
  let current = start
  while (true) {
    if (await pathExists(join(current, '.git'))) return current
    const parent = dirname(current)
    if (parent === current) return start
    current = parent
  }
}

/** One project root gathered from the workspace registry. */
interface ProjectCandidate {
  readonly root: string
  readonly workspaceIds: string[]
  readonly workspaceTitles: string[]
}

/**
 * Group the workspace registry's paths by resolved project root.
 * @param workspaces - the registry rows.
 * @returns one candidate per distinct project root, in path order.
 */
async function collectProjectCandidates(
  workspaces: readonly WorkspaceEntity[],
): Promise<ProjectCandidate[]> {
  const byRoot = new Map<string, ProjectCandidate>()
  for (const workspace of workspaces) {
    if (typeof workspace.path !== 'string' || workspace.path === '') continue
    const root = await resolveProjectRoot(workspace.path)
    const candidate = byRoot.get(root) ?? { root, workspaceIds: [], workspaceTitles: [] }
    candidate.workspaceIds.push(String(workspace.id))
    candidate.workspaceTitles.push(
      typeof workspace.title === 'string' && workspace.title !== '' ? workspace.title : root,
    )
    byRoot.set(root, candidate)
  }
  return [...byRoot.values()].sort((left, right) => left.root.localeCompare(right.root))
}

/**
 * Read one project group's skills; a failure stays inside its own group so the
 * rest of the page still renders.
 * @param skills - the skill registry.
 * @param candidate - the project root and the workspaces that share it.
 * @param scope - preset viewing scope, when a lease could be taken.
 * @returns the group, with `error` set when discovery failed.
 */
async function readProjectGroup(
  skills: SkillsService,
  candidate: ProjectCandidate,
  scope: object | undefined,
): Promise<ProjectSkillGroup> {
  const base = {
    projectRoot: candidate.root,
    workspaceIds: candidate.workspaceIds,
    workspaceTitles: candidate.workspaceTitles,
  }
  try {
    const summaries = await skills.list(scope === undefined
      ? { cwd: candidate.root }
      : { cwd: candidate.root, scope })
    return { ...base, skills: bucketSkillSummaries(summaries).project }
  } catch (error: unknown) {
    return { ...base, skills: [], error: errorMessage(error) }
  }
}

/**
 * Lease the default agent preset's current revision, the scope-aware cold read
 * the product uses for transcript presentation.
 * @param presets - the preset registry, when composed.
 * @returns the lease, or `undefined` when the registry is absent or the preset
 * cannot be leased; the read then falls back to the global layer.
 */
async function leaseDefaultScope(presets: AgentPresetsService | undefined): Promise<ScopeLease | undefined> {
  if (presets === undefined) return undefined
  try {
    return await presets.acquireScope()
  } catch {
    return undefined
  }
}

/**
 * Read the complete catalog the page renders.
 *
 * `services.skills` is absent in a composition without the skill registry, and
 * the other services narrow the answer instead of failing the read: no preset
 * registry means global-layer only, and no Workspace registry means no project
 * groups.
 * @param services - the optional services the read needs.
 * @returns the response envelope.
 */
export async function readCatalog(services: CatalogServices): Promise<SkillCatalogEnvelope> {
  const skills = services.skills
  if (skills === undefined) {
    return {
      ok: false,
      error: {
        code: 'skills-unavailable',
        message: '技能服务不可用：当前组合没有挂载技能注册表',
      },
    }
  }

  const lease = await leaseDefaultScope(services.presets)
  try {
    const scope = lease?.key
    let globalSummaries: readonly SkillSummaryLike[]
    try {
      // No cwd: the user roots plus whatever the leased preset mounts.
      globalSummaries = await skills.list(scope === undefined ? {} : { scope })
    } catch (error: unknown) {
      return { ok: false, error: { code: 'list-failed', message: errorMessage(error) } }
    }

    const globalBuckets = bucketSkillSummaries(globalSummaries)
    const candidates = await collectProjectCandidates(services.workspaces?.list() ?? [])
    const projects: ProjectSkillGroup[] = []
    for (const candidate of candidates) {
      projects.push(await readProjectGroup(skills, candidate, scope))
    }

    return {
      ok: true,
      generatedAt: new Date().toISOString(),
      user: globalBuckets.user,
      projects,
      other: globalBuckets.other,
    }
  } finally {
    await lease?.[Symbol.asyncDispose]()
  }
}

/**
 * Install the Skills catalog route.
 *
 * Call this from a context that already provides `webServer`; the skill and
 * Workspace registries stay optional capabilities read on each request.
 * @param ctx - plugin context carrying the web server.
 */
export function installSkillCatalogHost(ctx: Context): void {
  const webServer = lookup<WebServerService>(ctx, 'webServer')
  if (webServer === undefined) return

  const handler = async (request: RouteRequest, response: RouteResponse): Promise<void> => {
    try {
      const url = new URL(request.url ?? '/', 'http://localhost')
      const method = (request.method ?? 'GET').toUpperCase()
      if (url.pathname !== `${SKILL_CATALOG_ROUTE}/state`) {
        sendJson(response, 404, {
          ok: false,
          error: { code: 'not-found', message: `unknown endpoint: ${method} ${url.pathname}` },
        })
        return
      }
      if (method !== 'GET') {
        sendJson(response, 405, {
          ok: false,
          error: { code: 'method-not-allowed', message: 'use GET' },
        })
        return
      }
      sendJson(response, 200, await readCatalog({
        skills: lookup<SkillsService>(ctx, 'skills'),
        presets: lookup<AgentPresetsService>(ctx, 'agentPresets'),
        workspaces: lookup<WorkspacesService>(ctx, 'workspaceRegistry'),
      }))
    } catch (error: unknown) {
      sendJson(response, 500, {
        ok: false,
        error: { code: 'internal', message: errorMessage(error) },
      })
    }
  }

  ctx.effect(
    () => webServer.register({ kind: 'prefix', path: SKILL_CATALOG_ROUTE, handler }),
    'skill-catalog: state route',
  )
}
