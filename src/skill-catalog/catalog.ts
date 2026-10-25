/**
 * Shared vocabulary for the Skills settings page: the layer a discovered skill
 * belongs to, the display label of its discovery root, the wire envelope the
 * Host route returns, and the pure sorting/filtering/stamping helpers both
 * halves run over it.
 *
 * The page's question is "which skills do I have, at the user level and at the
 * project level", so the split follows the discovery source the skill registry
 * already reports (`user-*` roots versus `project-*` roots). Everything here is
 * pure: the Host adapter owns service calls, the browser half owns rendering,
 * and these rules are exercised without either.
 *
 * @module dsh-session-map/skill-catalog/catalog
 */

/** Layer a discovered skill belongs to. */
export type SkillLayer = 'user' | 'project' | 'other'

/** Root labels for the discovery sources the filesystem provider reports. */
const SOURCE_LABELS: Readonly<Record<string, string>> = {
  'user-dsh': '~/.dsh/skills',
  'user-agents': '~/.agents/skills',
  'project-dsh': '.dsh/skills',
  'project-agents': '.agents/skills',
  custom: '自定义目录',
  bundled: '内置',
  runtime: '运行时注册',
}

/** One skill as the page renders it. */
export interface SkillView {
  /** Kebab-case identifier addressed by `/name`. */
  readonly name: string
  /** Routing description shown under the name. */
  readonly description: string
  /** Optional extra routing guidance. */
  readonly whenToUse?: string
  /** Absolute instruction-file path when the provider supplies one. */
  readonly path?: string
  /** Raw discovery source reported by the registry. */
  readonly source: string
  /** Layer the source belongs to. */
  readonly layer: SkillLayer
  /** Short discovery-root label, such as `.agents/skills`. */
  readonly rootLabel: string
  /** Whether the model-facing catalog includes this skill. */
  readonly modelInvocable: boolean
  /** Whether the human-facing `/` catalog includes this skill. */
  readonly userInvocable: boolean
  /** Provider that owns the skill body, when it is not the filesystem provider. */
  readonly provider?: string
}

/** Every project-level skill discovered under one project root. */
export interface ProjectSkillGroup {
  /** Root directory whose `.dsh/skills` and `.agents/skills` were read. */
  readonly projectRoot: string
  /** Workspaces that resolve to this root, in registry order. */
  readonly workspaceIds: readonly string[]
  /** Display titles of those workspaces. */
  readonly workspaceTitles: readonly string[]
  /** Project-level skills, name-sorted. */
  readonly skills: readonly SkillView[]
  /** Discovery failure for this root; the other groups still render. */
  readonly error?: string
}

/** Successful catalog read, as the Host route returns it. */
export interface SkillCatalogState {
  /** Skills under the user roots: visible in every project. */
  readonly user: readonly SkillView[]
  /** Skills under each project root, one group per root. */
  readonly projects: readonly ProjectSkillGroup[]
  /** Skills from bundled, custom, or runtime providers. */
  readonly other: readonly SkillView[]
}

/** Stable failure codes shared by the Host route and the page. */
export type SkillCatalogFailureCode = 'skills-unavailable' | 'list-failed' | 'internal'

/** Host failure envelope carried inside an HTTP response body. */
export interface SkillCatalogErrorEnvelope {
  readonly code: string
  readonly message: string
  readonly detail?: string
}

/** Body of `GET /plugin-skill-catalog/state`. */
export interface SkillCatalogEnvelope extends Partial<SkillCatalogState> {
  readonly ok: boolean
  /** ISO timestamp of the read; drives the page's "updated at" line. */
  readonly generatedAt?: string
  readonly error?: SkillCatalogErrorEnvelope
}

/** One skill summary as the registry reports it, structurally. */
export interface SkillSummaryLike {
  readonly name: unknown
  readonly description?: unknown
  readonly whenToUse?: unknown
  readonly path?: unknown
  readonly source?: unknown
  readonly provider?: unknown
  readonly invocation?: {
    readonly modelInvocable?: unknown
    readonly userInvocable?: unknown
  }
}

/**
 * Classify a discovery source into the layer this page groups by.
 * @param source - raw source reported by the registry.
 * @returns `user` for user roots, `project` for project roots, `other` otherwise.
 */
export function layerOfSource(source: string): SkillLayer {
  if (source.startsWith('user-')) return 'user'
  if (source.startsWith('project-')) return 'project'
  return 'other'
}

/**
 * Human label for one discovery source.
 * @param source - raw source reported by the registry.
 * @returns the known root label, or the raw source for unknown providers.
 */
export function rootLabelOf(source: string): string {
  return SOURCE_LABELS[source] ?? source
}

/**
 * Stamp one registry summary into the page's view shape.
 * @param summary - one summary as the registry reports it.
 * @param layer - layer the summary belongs to.
 * @returns the view, or `undefined` when the summary has no usable name.
 */
function toSkillView(summary: SkillSummaryLike, layer: SkillLayer): SkillView | undefined {
  if (typeof summary.name !== 'string' || summary.name === '') return undefined
  const source = typeof summary.source === 'string' && summary.source !== '' ? summary.source : 'unknown'
  const description = typeof summary.description === 'string' ? summary.description : ''
  const whenToUse = typeof summary.whenToUse === 'string' && summary.whenToUse !== '' ? summary.whenToUse : undefined
  const path = typeof summary.path === 'string' && summary.path !== '' ? summary.path : undefined
  const provider = typeof summary.provider === 'string' && summary.provider !== '' ? summary.provider : undefined
  return {
    name: summary.name,
    description,
    ...whenToUse === undefined ? {} : { whenToUse },
    ...path === undefined ? {} : { path },
    source,
    layer,
    rootLabel: rootLabelOf(source),
    // Absent invocation controls mean both surfaces allow the skill.
    modelInvocable: summary.invocation?.modelInvocable !== false,
    userInvocable: summary.invocation?.userInvocable !== false,
    ...provider === undefined ? {} : { provider },
  }
}

/**
 * Sort views by name so every group reads the same way.
 * @param views - views to sort; the input is left alone.
 * @returns a new name-sorted array.
 */
export function sortSkillViews(views: readonly SkillView[]): SkillView[] {
  return [...views].sort((left, right) => left.name.localeCompare(right.name))
}

/**
 * Keep one view per name and path, dropping malformed duplicates.
 * @param views - views to deduplicate.
 * @returns a name-sorted, duplicate-free array.
 */
function uniqueSkillViews(views: readonly SkillView[]): SkillView[] {
  const seen = new Set<string>()
  const kept: SkillView[] = []
  for (const view of views) {
    const key = `${view.name}\u0000${view.path ?? ''}`
    if (seen.has(key)) continue
    seen.add(key)
    kept.push(view)
  }
  return sortSkillViews(kept)
}

/**
 * Split one registry listing into the page's three buckets.
 * @param summaries - one registry listing, in registry order.
 * @returns the user-level, project-level, and other-source views.
 */
export function bucketSkillSummaries(summaries: readonly SkillSummaryLike[]): {
  readonly user: readonly SkillView[]
  readonly project: readonly SkillView[]
  readonly other: readonly SkillView[]
} {
  const user: SkillView[] = []
  const project: SkillView[] = []
  const other: SkillView[] = []
  for (const summary of summaries) {
    const source = typeof summary.source === 'string' ? summary.source : ''
    const layer = layerOfSource(source)
    const view = toSkillView(summary, layer)
    if (view === undefined) continue
    if (layer === 'user') user.push(view)
    else if (layer === 'project') project.push(view)
    else other.push(view)
  }
  return { user: uniqueSkillViews(user), project: uniqueSkillViews(project), other: uniqueSkillViews(other) }
}

/**
 * Whether one view matches a search query.
 * @param view - the skill to test.
 * @param query - already-trimmed, lower-cased query; empty matches everything.
 * @returns whether the name, description, guidance, or path contains the query.
 */
export function skillMatchesQuery(view: SkillView, query: string): boolean {
  if (query === '') return true
  return [view.name, view.description, view.whenToUse ?? '', view.path ?? '', view.rootLabel]
    .some(field => field.toLowerCase().includes(query))
}

/**
 * Filter a whole catalog for the search box, preserving section order.
 * @param state - successfully read catalog.
 * @param query - raw query text; surrounding whitespace is ignored.
 * @returns the filtered catalog plus the number of skills it kept.
 */
export function filterCatalog(state: SkillCatalogState, query: string): {
  readonly state: SkillCatalogState
  readonly count: number
} {
  const needle = query.trim().toLowerCase()
  if (needle === '') {
    return { state, count: countCatalog(state) }
  }
  const keep = (views: readonly SkillView[]): SkillView[] => views.filter(view => skillMatchesQuery(view, needle))
  const user = keep(state.user)
  const other = keep(state.other)
  const projects = state.projects.map(project => ({
    ...project,
    skills: keep(project.skills),
  }))
  const filtered: SkillCatalogState = { user, projects, other }
  return { state: filtered, count: countCatalog(filtered) }
}

/**
 * Count every skill in a catalog.
 * @param state - the catalog.
 * @returns the total across the user, project, and other buckets.
 */
export function countCatalog(state: SkillCatalogState): number {
  return state.user.length
    + state.other.length
    + state.projects.reduce((total, project) => total + project.skills.length, 0)
}

/**
 * Read a successful state out of a route envelope.
 * @param envelope - the parsed response body.
 * @returns the catalog when the envelope is successful.
 * @throws Error carrying the Host failure code and message otherwise.
 */
export function stateFromEnvelope(envelope: SkillCatalogEnvelope): SkillCatalogState {
  if (envelope.ok !== true) {
    const code = typeof envelope.error?.code === 'string' ? envelope.error.code : 'internal'
    const message = typeof envelope.error?.message === 'string' ? envelope.error.message : '技能目录读取失败'
    throw new Error(`${code}: ${message}`)
  }
  return {
    user: Array.isArray(envelope.user) ? envelope.user : [],
    projects: Array.isArray(envelope.projects) ? envelope.projects : [],
    other: Array.isArray(envelope.other) ? envelope.other : [],
  }
}
