/**
 * Shared vocabulary for the Skills surfaces: the layer a discovered skill
 * belongs to, the display label of its discovery root, the wire envelope the
 * Host route returns, the Session-scoped entry the product's typed Remote
 * reports, and the pure sorting/filtering/stamping helpers both halves run
 * over them.
 *
 * The Settings page asks "which skills do I have, at the user level and at the
 * project level", so that split follows the discovery source the skill registry
 * already reports (`user-*` roots versus `project-*` roots). The Session tab
 * asks a narrower question — "which skills can this Session see" — and the
 * product answers it with a flat, already-filtered list that carries no source
 * field, so that half only infers a display root from the instruction path.
 * Everything here is pure: the Host adapter owns service calls, the browser
 * half owns rendering, and these rules are exercised without either.
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
 * One skill as the Session-scoped typed Remote reports it.
 *
 * The product narrows this list to user-invocable skills before it answers, so
 * there is no `userInvocable` or discovery-source field: the catalog is already
 * exactly what this Session's `/name` menu can reach.
 */
export interface SessionSkillEntry {
  /** Kebab-case identifier addressed by `/name`. */
  readonly name: string
  /** Routing description shown under the name. */
  readonly description: string
  /** Optional extra routing guidance. */
  readonly whenToUse?: string
  /** Absolute instruction-file path when the provider supplies one. */
  readonly path?: string
  /** Whether the model-facing catalog includes this skill. */
  readonly modelInvocable: boolean
}

/**
 * Structural view of one Session skill entry, so wire data can be validated
 * before it reaches a row.
 */
export interface SessionSkillEntryLike {
  readonly name?: unknown
  readonly description?: unknown
  readonly whenToUse?: unknown
  readonly path?: unknown
  readonly modelInvocable?: unknown
}

/**
 * Home-directory roots, where the user-level `.dsh/skills` lives.
 *
 * The Session Remote reports paths but no discovery source, so the only way to
 * keep the familiar "user level versus project level" labels is to recognise
 * the home prefix. A path outside a home directory stays unlabelled instead of
 * being guessed into the wrong layer.
 */
const HOME_DSH_SKILLS = /^(?:[A-Za-z]:)?\/(?:(?:Users|home)\/[^/]+|root)\/\.dsh\/skills(?:\/|$)/i
/** Home-directory root holding the user-level `.agents/skills`. */
const HOME_AGENTS_SKILLS = /^(?:[A-Za-z]:)?\/(?:(?:Users|home)\/[^/]+|root)\/\.agents\/skills(?:\/|$)/i
/** Any `.dsh/skills` root that is not under the home directory. */
const PROJECT_DSH_SKILLS = /(?:^|\/)\.dsh\/skills(?:\/|$)/
/** Any `.agents/skills` root that is not under the home directory. */
const PROJECT_AGENTS_SKILLS = /(?:^|\/)\.agents\/skills(?:\/|$)/

/**
 * Display label for the discovery root a Session skill's instruction path sits
 * under, using the same labels as the Settings page.
 * @param path - absolute SKILL.md path, when the provider supplied one.
 * @returns the root label, `运行时注册` for a pathless skill, or
 * `自定义目录` for an unknown root.
 */
export function rootLabelOfSkillPath(path: string | undefined): string {
  if (path === undefined || path === '') return '运行时注册'
  const normalized = path.replace(/\\/g, '/')
  if (HOME_DSH_SKILLS.test(normalized)) return '~/.dsh/skills'
  if (HOME_AGENTS_SKILLS.test(normalized)) return '~/.agents/skills'
  if (PROJECT_DSH_SKILLS.test(normalized)) return '.dsh/skills'
  if (PROJECT_AGENTS_SKILLS.test(normalized)) return '.agents/skills'
  return '自定义目录'
}

/**
 * Stamp the Session Remote's entries into the row shape both skill surfaces
 * render, sorted by name and deduplicated by name plus path.
 *
 * A malformed entry is dropped rather than rendered as a nameless row, and a
 * missing invocation flag means the model may use the skill, matching how the
 * Settings page reads absent invocation controls.
 * @param entries - entries as the typed Remote reports them.
 * @returns the name-sorted rows.
 */
export function sessionSkillViews(
  entries: readonly (SessionSkillEntryLike | null | undefined)[],
): SkillView[] {
  const views: SkillView[] = []
  for (const entry of entries) {
    if (entry === null || entry === undefined) continue
    if (typeof entry.name !== 'string' || entry.name === '') continue
    const path = typeof entry.path === 'string' && entry.path !== '' ? entry.path : undefined
    const whenToUse = typeof entry.whenToUse === 'string' && entry.whenToUse !== ''
      ? entry.whenToUse
      : undefined
    views.push({
      name: entry.name,
      description: typeof entry.description === 'string' ? entry.description : '',
      ...whenToUse === undefined ? {} : { whenToUse },
      ...path === undefined ? {} : { path },
      source: 'session',
      layer: 'other',
      rootLabel: rootLabelOfSkillPath(path),
      modelInvocable: entry.modelInvocable !== false,
      userInvocable: true,
    })
  }
  return uniqueSkillViews(views)
}

/**
 * Filter the Session rows for the tab's search box.
 * @param views - the Session rows.
 * @param query - raw query text; surrounding whitespace is ignored.
 * @returns the matching rows in their existing order.
 */
export function filterSessionSkillViews(views: readonly SkillView[], query: string): SkillView[] {
  const needle = query.trim().toLowerCase()
  if (needle === '') return [...views]
  return views.filter(view => skillMatchesQuery(view, needle))
}

/**
 * Display order for the discovery roots the Session tab offers as filter tabs:
 * user roots first, then project roots, then everything the path cannot place.
 */
const ROOT_TAB_ORDER: readonly string[] = [
  '~/.dsh/skills',
  '~/.agents/skills',
  '.dsh/skills',
  '.agents/skills',
  '自定义目录',
  '运行时注册',
]

/** One root filter tab and how many skills it holds. */
export interface SkillRootTab {
  /** Discovery-root label, as {@link rootLabelOfSkillPath} stamps it. */
  readonly root: string
  /** Skills under that root. */
  readonly count: number
}

/**
 * One filter tab per discovery root present in the list.
 *
 * Known roots keep the order the Settings page teaches, so the tab row does not
 * reshuffle when skills are created or refreshed; an unrecognised root falls
 * after them, alphabetically.
 * @param views - the Session rows.
 * @returns the roots with their counts, `[]` for an empty list.
 */
export function skillRootTabs(views: readonly SkillView[]): SkillRootTab[] {
  const counts = new Map<string, number>()
  for (const view of views) counts.set(view.rootLabel, (counts.get(view.rootLabel) ?? 0) + 1)
  const known = ROOT_TAB_ORDER.filter(root => counts.has(root))
  const extra = [...counts.keys()]
    .filter(root => !ROOT_TAB_ORDER.includes(root))
    .sort((left, right) => left.localeCompare(right))
  return [...known, ...extra].map(root => ({ root, count: counts.get(root) ?? 0 }))
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
