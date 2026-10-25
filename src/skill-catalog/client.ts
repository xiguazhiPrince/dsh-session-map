/**
 * Browser half of the Skills settings page.
 *
 * The page is one `settings.section` entry: it reads the catalog from the Host
 * half's read-only route and renders the two layers side by side — user-level
 * skills that apply everywhere, and each project's own skills — plus a third
 * group for bundled, custom, and runtime providers so nothing the `/` menu can
 * load is silently hidden.
 *
 * It owns presentation only: discovery, project-root resolution, and grouping
 * stay in `host.ts`, and the wire vocabulary lives in `catalog.ts`.
 *
 * @module dsh-session-map/skill-catalog/client
 */
import type { Context } from '@deepseek-ai/cordis'
import * as React from 'react'
import {
  countCatalog,
  filterCatalog,
  stateFromEnvelope,
  type ProjectSkillGroup,
  type SkillCatalogEnvelope,
  type SkillCatalogState,
  type SkillView,
} from './catalog'

/** Route family shared with the Host half. */
const ROUTE = '/plugin-skill-catalog'

/** Skills page copy; the plugin is Chinese-first like its other seats. */
const COPY = {
  title: '技能',
  description: '用户级技能对所有项目生效；项目级技能只在所属项目的目录里生效。技能名可以直接用 /名称 调用。',
  searchPlaceholder: '搜索名称、描述或路径',
  refresh: '刷新',
  refreshing: '读取中…',
  loading: '正在读取技能目录…',
  userSection: '用户级',
  userHint: '所有项目可用 · ~/.dsh/skills、~/.agents/skills',
  userEmpty: '还没有用户级技能。把技能目录放到 ~/.dsh/skills/<名称>/SKILL.md 或 ~/.agents/skills/<名称>/SKILL.md，所有项目都会看到它。',
  projectSection: '项目级',
  projectHint: '按项目根目录下的 .dsh/skills、.agents/skills 发现',
  projectEmpty: '还没有注册工作区，所以没有项目级技能可列。',
  groupEmpty: '这个项目还没有自己的技能。在项目根目录下新建 .dsh/skills/<名称>/SKILL.md 即可。',
  otherSection: '内置 / 其他',
  otherHint: '不随项目变化：内置目录、自定义目录或运行时注册的技能',
  expandAll: '全部展开',
  collapseAll: '全部收起',
  expand: '展开',
  collapse: '收起',
  noDescription: '（没有描述）',
  whenToUse: '何时用：',
  noMatch: '没有匹配的技能',
  staleFailure: '本次刷新失败，下面仍是上一次读到的结果。',
  retry: '重试',
} as const

/** Everything the page needs from its Host. */
export interface SkillCatalogRuntime {
  /** Read the current catalog; the abort releases the page's request. */
  load(signal?: AbortSignal): Promise<SkillCatalogState>
}

/** One request to the Host route on the page's own origin. */
async function requestState(signal?: AbortSignal): Promise<SkillCatalogState> {
  const response = await fetch(new URL(`${ROUTE}/state`, document.baseURI), {
    method: 'GET',
    cache: 'no-store',
    ...(signal === undefined ? {} : { signal }),
  })
  const text = await response.text()
  let body: unknown
  try {
    body = text === '' ? undefined : JSON.parse(text) as unknown
  } catch {
    throw new Error(`Host 返回了无法解析的响应（HTTP ${response.status}）`)
  }
  const envelope = body as SkillCatalogEnvelope | undefined
  if (envelope === undefined) {
    throw new Error(`Host 没有返回技能目录（HTTP ${response.status}）`)
  }
  if (response.status !== 200 && envelope.ok !== false) {
    throw new Error(`Host 返回了 HTTP ${response.status}`)
  }
  return stateFromEnvelope(envelope)
}

/**
 * Build the page runtime over the running page.
 * @param _ctx - browser root context; the route is same-origin, so no service is read.
 * @returns the runtime the settings page calls.
 */
export function createSkillCatalogRuntime(_ctx: Context): SkillCatalogRuntime {
  return {
    async load(signal?: AbortSignal): Promise<SkillCatalogState> {
      return await requestState(signal)
    },
  }
}

/** Whether an unknown thrown value is the abort of a page-owned request. */
function isAbortError(error: unknown): boolean {
  return typeof error === 'object' && error !== null && (error as { name?: unknown }).name === 'AbortError'
}

/** Printable text for an unknown thrown value. */
function errorText(error: unknown): string {
  if (error instanceof Error) return error.message
  if (typeof error === 'string') return error
  return String(error)
}

/** Format one ISO timestamp as a local wall-clock time. */
function formatTime(iso: string | null): string | null {
  if (iso === null) return null
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return null
  return date.toLocaleTimeString('zh-CN', { hour12: false })
}

/** Props of the pure page body. */
export interface SkillCatalogPageProps {
  /** Successfully read catalog. */
  readonly state: SkillCatalogState
  /** Current search text. */
  readonly query: string
  /** Replace the search text. */
  readonly onQueryChange: (next: string) => void
  /** Ask the Host for a fresh read. */
  readonly onRefresh: () => void
  /** Whether a read is in flight. */
  readonly refreshing: boolean
  /** ISO time of the last successful read, when known. */
  readonly updatedAt: string | null
  /** Failure of the last read when an older catalog is still shown. */
  readonly staleFailure: string | null
}

/** Descriptions longer than this many characters fold to two lines by default. */
const DESCRIPTION_CLAMP_CHARS = 80

/**
 * One skill row: name, source root, invocation limits, description, and path.
 *
 * A long description starts as two clamped lines with a text button; the
 * toggle is a plain text action so rows stay scannable instead of becoming
 * walls of routing prose.
 * @param props - the skill to render.
 * @returns the row element.
 */
function SkillRow({ skill }: { readonly skill: SkillView }): React.ReactElement {
  const [descriptionOpen, setDescriptionOpen] = React.useState(false)
  const description = skill.description === '' ? COPY.noDescription : skill.description
  const foldable = skill.description.length > DESCRIPTION_CLAMP_CHARS
  return React.createElement(
    'div',
    { className: 'sk-row' },
    React.createElement(
      'div',
      { className: 'sk-rowHead' },
      React.createElement('span', { className: 'sk-name' }, skill.name),
      React.createElement('span', { className: 'sk-chip' }, skill.rootLabel),
      skill.modelInvocable
        ? null
        : React.createElement('span', { className: 'sk-chip sk-chip--warn' }, '仅手动调用'),
      skill.userInvocable
        ? null
        : React.createElement('span', { className: 'sk-chip sk-chip--warn' }, '仅模型可用'),
    ),
    React.createElement(
      'div',
      { className: foldable && !descriptionOpen ? 'sk-desc sk-desc--clamp' : 'sk-desc' },
      description,
    ),
    foldable
      ? React.createElement(
        'button',
        {
          type: 'button',
          className: 'sk-descToggle',
          'aria-expanded': descriptionOpen,
          onClick: () => { setDescriptionOpen(previous => !previous) },
        },
        descriptionOpen ? COPY.collapse : COPY.expand,
      )
      : null,
    skill.whenToUse === undefined
      ? null
      : React.createElement('div', { className: 'sk-when' }, COPY.whenToUse, skill.whenToUse),
    skill.path === undefined
      ? null
      : React.createElement('div', { className: 'sk-path', title: skill.path }, skill.path),
  )
}

/**
 * One list of skills with stable keys.
 * @param props - the rows to render.
 * @returns the list wrapper.
 */
function SkillList({ skills }: { readonly skills: readonly SkillView[] }): React.ReactElement {
  return React.createElement(
    'div',
    { className: 'sk-list' },
    ...skills.map(skill => React.createElement(SkillRow, {
      key: `${skill.name}\u0000${skill.path ?? ''}\u0000${skill.source}`,
      skill,
    })),
  )
}

/** How many collapsed skill names a project summary previews. */
const PREVIEW_NAMES = 3

/**
 * One project group: a disclosure header, its root path, and either the full
 * list or a one-line preview of what is inside.
 * @param props - the group, whether it is open, and the toggle.
 * @returns the project card.
 */
function ProjectCard({ project, open, onToggle }: {
  readonly project: ProjectSkillGroup
  readonly open: boolean
  readonly onToggle: () => void
}): React.ReactElement {
  const title = project.workspaceTitles.length === 0
    ? project.projectRoot
    : project.workspaceTitles.join('、')
  const preview = project.skills.slice(0, PREVIEW_NAMES).map(skill => skill.name).join('、')
  const previewText = project.skills.length > PREVIEW_NAMES
    ? `${preview} 等 ${project.skills.length} 个`
    : preview
  const head = project.error !== undefined
    ? React.createElement('div', { className: 'sk-projectTitle' }, title)
    : React.createElement(
      'button',
      {
        type: 'button',
        className: 'sk-projectToggle',
        'aria-expanded': open,
        onClick: onToggle,
      },
      React.createElement('span', { className: 'sk-chevron', 'aria-hidden': true }, open ? '▾' : '▸'),
      React.createElement('span', { className: 'sk-projectTitle' }, title),
      React.createElement('span', { className: 'sk-count' }, String(project.skills.length)),
    )
  return React.createElement(
    'div',
    { className: 'sk-project' },
    head,
    React.createElement('div', { className: 'sk-projectPath' }, project.projectRoot),
    project.error === undefined
      ? open
        ? React.createElement(SkillList, { skills: project.skills })
        : React.createElement('div', { className: 'sk-projectPreview' }, previewText)
      : React.createElement(
        'div',
        { className: 'sk-status sk-status--error', role: 'alert' },
        React.createElement('div', { className: 'sk-statusTitle' }, '读取这个项目的技能失败。'),
        React.createElement('div', { className: 'sk-statusPath' }, project.error),
      ),
  )
}

/**
 * The page body: header, search toolbar, and the three layer sections.
 * @param props - catalog, search state, and refresh state.
 * @returns the page element.
 */
export function SkillCatalogPage(props: SkillCatalogPageProps): React.ReactElement {
  const { state, query, onQueryChange, onRefresh, refreshing, updatedAt, staleFailure } = props
  // Which project cards are open. A single project with skills opens on first
  // render so the common one-project case needs no click; more than one starts
  // collapsed, with the page answering "which projects have skills" at a glance.
  const [openProjects, setOpenProjects] = React.useState<ReadonlySet<string>>(() => {
    const withSkills = state.projects.filter(project => project.skills.length > 0)
    const only = withSkills.length === 1 ? withSkills[0] : undefined
    return new Set(only === undefined ? [] : [only.projectRoot])
  })
  const filtered = filterCatalog(state, query)
  const shown = filtered.state
  const projectCount = shown.projects.reduce((total, project) => total + project.skills.length, 0)
  const updated = formatTime(updatedAt)
  const queryActive = query.trim() !== ''
  const nothingFound = queryActive && filtered.count === 0
  // Only projects that have something to show get a card; empty ones fold into
  // one summary line, so a long workspace list does not bury the real answer.
  const populatedProjects = shown.projects.filter(project => project.skills.length > 0 || project.error !== undefined)
  const emptyProjects = queryActive
    ? []
    : shown.projects.filter(project => project.skills.length === 0 && project.error === undefined)
  // A project whose read failed has no list to fold, so it never takes a toggle.
  const toggleableProjects = populatedProjects.filter(project => project.error === undefined)
  const allProjectsOpen = toggleableProjects.length > 0
    && toggleableProjects.every(project => openProjects.has(project.projectRoot))
  // Searching forces every match open: a hidden match would look like no match.
  const isOpen = (project: ProjectSkillGroup): boolean => queryActive || openProjects.has(project.projectRoot)

  const toggleProject = (projectRoot: string): void => {
    setOpenProjects((previous) => {
      const next = new Set(previous)
      if (next.has(projectRoot)) next.delete(projectRoot)
      else next.add(projectRoot)
      return next
    })
  }
  const toggleAllProjects = (): void => {
    setOpenProjects(allProjectsOpen
      ? new Set()
      : new Set(toggleableProjects.map(project => project.projectRoot)))
  }

  return React.createElement(
    'div',
    { className: 'sk-page' },
    React.createElement('style', null, CSS),
    React.createElement(
      'div',
      { className: 'sk-inner' },
      React.createElement(
        'header',
        { className: 'sk-head' },
        React.createElement('h1', { className: 'sk-title' }, COPY.title),
        React.createElement('p', { className: 'sk-desc sk-headDesc' }, COPY.description),
      ),
      React.createElement(
        'div',
        { className: 'sk-toolbar' },
        React.createElement('input', {
          className: 'sk-search',
          type: 'search',
          value: query,
          placeholder: COPY.searchPlaceholder,
          'aria-label': COPY.searchPlaceholder,
          spellCheck: false,
          onChange: (event: React.ChangeEvent<HTMLInputElement>) => { onQueryChange(event.currentTarget.value) },
        }),
        React.createElement(
          'button',
          {
            type: 'button',
            className: 'sk-btn',
            onClick: onRefresh,
            disabled: refreshing,
          },
          refreshing ? COPY.refreshing : COPY.refresh,
        ),
        updated === null
          ? null
          : React.createElement('span', { className: 'sk-updated' }, `更新于 ${updated}`),
      ),
      staleFailure === null
        ? null
        : React.createElement(
          'div',
          { className: 'sk-status sk-status--warn', role: 'status' },
          React.createElement('div', { className: 'sk-statusTitle' }, COPY.staleFailure),
          React.createElement('div', { className: 'sk-statusPath' }, staleFailure),
        ),
      nothingFound
        ? React.createElement('div', { className: 'sk-empty' }, `${COPY.noMatch}：${query.trim()}`)
        : null,
      React.createElement(
        'section',
        { className: 'sk-section' },
        React.createElement(
          'div',
          { className: 'sk-sectionHead' },
          React.createElement('h2', { className: 'sk-sectionTitle' }, COPY.userSection),
          React.createElement('span', { className: 'sk-count' }, String(shown.user.length)),
          React.createElement('span', { className: 'sk-sectionHint' }, COPY.userHint),
        ),
        shown.user.length === 0
          ? queryActive
            ? null
            : React.createElement('div', { className: 'sk-empty' }, COPY.userEmpty)
          : React.createElement(SkillList, { skills: shown.user }),
      ),
      React.createElement(
        'section',
        { className: 'sk-section' },
        React.createElement(
          'div',
          { className: 'sk-sectionHead' },
          React.createElement('h2', { className: 'sk-sectionTitle' }, COPY.projectSection),
          React.createElement('span', { className: 'sk-count' }, String(projectCount)),
          React.createElement('span', { className: 'sk-sectionHint' }, COPY.projectHint),
          toggleableProjects.length > 1 && !queryActive
            ? React.createElement(
              'button',
              { type: 'button', className: 'sk-linkBtn', onClick: toggleAllProjects },
              allProjectsOpen ? COPY.collapseAll : COPY.expandAll,
            )
            : null,
        ),
        shown.projects.length === 0
          ? React.createElement('div', { className: 'sk-empty' }, COPY.projectEmpty)
          : React.createElement(
            'div',
            { className: 'sk-projects' },
            ...populatedProjects.map(project => React.createElement(ProjectCard, {
              key: project.projectRoot,
              project,
              open: isOpen(project),
              onToggle: () => { toggleProject(project.projectRoot) },
            })),
            populatedProjects.length === 0 && emptyProjects.length === 0
              ? React.createElement('div', { className: 'sk-empty' }, COPY.groupEmpty)
              : null,
            emptyProjects.length === 0
              ? null
              : React.createElement(
                'details',
                { className: 'sk-more' },
                React.createElement(
                  'summary',
                  { className: 'sk-moreSummary' },
                  `另有 ${emptyProjects.length} 个项目没有项目级技能`,
                ),
                React.createElement(
                  'div',
                  { className: 'sk-moreList' },
                  ...emptyProjects.map(project => React.createElement(
                    'div',
                    { className: 'sk-moreItem', key: project.projectRoot },
                    React.createElement(
                      'span',
                      { className: 'sk-moreTitle' },
                      project.workspaceTitles.length === 0
                        ? project.projectRoot
                        : project.workspaceTitles.join('、'),
                    ),
                    React.createElement('span', { className: 'sk-morePath' }, project.projectRoot),
                  )),
                ),
                React.createElement('div', { className: 'sk-moreHint' }, COPY.groupEmpty),
              ),
          ),
      ),
      shown.other.length === 0
        ? null
        : React.createElement(
          'section',
          { className: 'sk-section' },
          React.createElement(
            'div',
            { className: 'sk-sectionHead' },
            React.createElement('h2', { className: 'sk-sectionTitle' }, COPY.otherSection),
            React.createElement('span', { className: 'sk-count' }, String(shown.other.length)),
            React.createElement('span', { className: 'sk-sectionHint' }, COPY.otherHint),
          ),
          React.createElement(SkillList, { skills: shown.other }),
        ),
    ),
  )
}

/**
 * Build the Settings section body: fetch on mount, refetch on demand, and
 * render the pure page body once a catalog exists.
 * @param runtime - Host and browser capabilities.
 * @returns a slot component rendering the skills page.
 */
export function createSkillCatalogSettings(runtime: SkillCatalogRuntime): () => React.ReactElement {
  return function SkillCatalogSettings(): React.ReactElement {
    const [state, setState] = React.useState<SkillCatalogState | null>(null)
    const [failure, setFailure] = React.useState<string | null>(null)
    const [staleFailure, setStaleFailure] = React.useState<string | null>(null)
    const [query, setQuery] = React.useState('')
    const [refreshing, setRefreshing] = React.useState(false)
    const [updatedAt, setUpdatedAt] = React.useState<string | null>(null)
    // One request at a time; unmounting Settings aborts it.
    const inFlight = React.useRef<AbortController | null>(null)
    // Whether a catalog has ever been shown; only then does a failure become a
    // stale-data banner instead of a page-level error.
    const hasData = React.useRef(false)

    const read = React.useCallback(async (): Promise<void> => {
      inFlight.current?.abort()
      const controller = new AbortController()
      inFlight.current = controller
      setRefreshing(true)
      try {
        const next = await runtime.load(controller.signal)
        if (controller.signal.aborted) return
        hasData.current = true
        setState(next)
        setFailure(null)
        setStaleFailure(null)
        setUpdatedAt(new Date().toISOString())
      } catch (error) {
        if (isAbortError(error)) return
        const message = `技能目录读取失败：${errorText(error)}`
        if (hasData.current) setStaleFailure(message)
        else setFailure(message)
      } finally {
        if (inFlight.current === controller) {
          inFlight.current = null
          setRefreshing(false)
        }
      }
    }, [])

    React.useEffect(() => {
      void read()
      return () => { inFlight.current?.abort() }
    }, [read])

    if (state === null) {
      return React.createElement(
        'div',
        { className: 'sk-page' },
        React.createElement('style', null, CSS),
        React.createElement(
          'div',
          { className: 'sk-inner' },
          React.createElement(
            'header',
            { className: 'sk-head' },
            React.createElement('h1', { className: 'sk-title' }, COPY.title),
            React.createElement('p', { className: 'sk-desc sk-headDesc' }, COPY.description),
          ),
          failure === null
            ? React.createElement('div', { className: 'sk-loading', role: 'status' }, COPY.loading)
            : React.createElement(
              'div',
              { className: 'sk-status sk-status--error', role: 'alert' },
              React.createElement('div', { className: 'sk-statusTitle' }, failure),
              React.createElement(
                'div',
                { className: 'sk-statusActions' },
                React.createElement(
                  'button',
                  { type: 'button', className: 'sk-btn', onClick: () => { void read() } },
                  COPY.retry,
                ),
              ),
            ),
        ),
      )
    }

    return React.createElement(SkillCatalogPage, {
      state,
      query,
      onQueryChange: setQuery,
      onRefresh: () => { void read() },
      refreshing,
      updatedAt,
      staleFailure,
    })
  }
}

/** Component-local stylesheet; every color is a Harness theme token. */
const CSS = `
.sk-page { box-sizing: border-box; padding: 2px 0 28px; color: var(--dsw-alias-label-primary); font-size: 13px; line-height: 1.55; font-family: inherit; }
.sk-page * { box-sizing: border-box; }
.sk-inner { display: flex; flex-direction: column; gap: 16px; max-width: 720px; }
.sk-head { display: flex; flex-direction: column; gap: 4px; }
.sk-title { margin: 0; font-size: 15px; font-weight: 600; line-height: 1.4; }
.sk-desc { margin: 0; color: var(--dsw-alias-label-secondary); font-size: 12.5px; }
.sk-toolbar { display: flex; align-items: center; gap: 8px; }
.sk-search { flex: 1; min-width: 0; height: 32px; padding: 0 12px; border: 0.5px solid var(--dsw-alias-border-l1); border-radius: 8px; background: var(--dsw-alias-bg-layer-1); color: var(--dsw-alias-label-primary); font: inherit; font-size: 12.5px; }
.sk-search::placeholder { color: var(--dsw-alias-label-secondary); opacity: 0.7; }
.sk-search:focus-visible { outline: none; border-color: var(--dsw-alias-brand-primary); }
.sk-btn { flex: none; height: 32px; padding: 0 12px; border: 0.5px solid var(--dsw-alias-border-l1); border-radius: 8px; background: var(--dsw-alias-bg-layer-1); color: var(--dsw-alias-label-primary); font: inherit; font-size: 12.5px; cursor: pointer; white-space: nowrap; }
.sk-btn:hover:not(:disabled) { border-color: var(--dsw-alias-border-l2); background: var(--dsw-alias-bg-layer-2); }
.sk-btn:focus-visible { outline: 2px solid var(--dsw-alias-brand-primary); outline-offset: 1px; }
.sk-btn:disabled { cursor: default; opacity: 0.5; }
.sk-updated { flex: none; color: var(--dsw-alias-label-secondary); font-size: 11px; white-space: nowrap; }
.sk-section { display: flex; flex-direction: column; gap: 8px; }
.sk-sectionHead { display: flex; align-items: baseline; flex-wrap: wrap; gap: 8px; }
.sk-sectionTitle { margin: 0; font-size: 13px; font-weight: 600; }
.sk-count { flex: none; min-width: 20px; padding: 0 6px; border-radius: 999px; background: var(--dsw-alias-bg-layer-2); color: var(--dsw-alias-label-secondary); font-size: 11px; text-align: center; }
.sk-sectionHint { color: var(--dsw-alias-label-secondary); font-size: 11.5px; }
.sk-linkBtn { flex: none; margin-left: auto; padding: 0; border: 0; background: none; color: var(--dsw-alias-brand-primary); font: inherit; font-size: 12px; cursor: pointer; }
.sk-linkBtn:hover { text-decoration: underline; text-underline-offset: 2px; }
.sk-linkBtn:focus-visible { outline: 2px solid var(--dsw-alias-brand-primary); outline-offset: 2px; border-radius: 4px; }
.sk-list { border: 0.5px solid var(--dsw-alias-border-l1); border-radius: 10px; background: var(--dsw-alias-bg-layer-1); overflow: hidden; }
.sk-row { display: flex; flex-direction: column; gap: 2px; padding: 10px 12px; }
.sk-row + .sk-row { border-top: 0.5px solid var(--dsw-alias-border-l1); }
.sk-rowHead { display: flex; align-items: center; flex-wrap: wrap; gap: 6px; }
.sk-name { font-size: 14.5px; font-weight: 600; line-height: 1.35; }
.sk-chip { flex: none; padding: 0 6px; border: 0.5px solid var(--dsw-alias-border-l1); border-radius: 999px; color: var(--dsw-alias-label-secondary); font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; font-size: 10.5px; line-height: 16px; }
.sk-chip--warn { border-color: var(--dsw-alias-state-warn-primary); color: var(--dsw-alias-state-warn-primary); font-family: inherit; }
.sk-desc { color: var(--dsw-alias-label-secondary); font-size: 12.5px; }
.sk-desc--clamp { display: -webkit-box; -webkit-box-orient: vertical; -webkit-line-clamp: 2; overflow: hidden; }
.sk-descToggle { align-self: flex-start; padding: 0; border: 0; background: none; color: var(--dsw-alias-brand-primary); font: inherit; font-size: 11.5px; line-height: 1.4; cursor: pointer; }
.sk-descToggle:hover { text-decoration: underline; text-underline-offset: 2px; }
.sk-descToggle:focus-visible { outline: 2px solid var(--dsw-alias-brand-primary); outline-offset: 2px; border-radius: 4px; }
.sk-when { color: var(--dsw-alias-label-secondary); font-size: 11.5px; }
.sk-path { color: var(--dsw-alias-label-secondary); font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; font-size: 11px; overflow-wrap: anywhere; }
.sk-projects { display: flex; flex-direction: column; gap: 10px; }
.sk-project { display: flex; flex-direction: column; gap: 8px; padding: 12px; border: 0.5px solid var(--dsw-alias-border-l1); border-radius: 10px; background: var(--dsw-alias-bg-layer-1); }
.sk-projectToggle { display: flex; align-items: center; gap: 6px; width: 100%; padding: 0; margin: 0; border: 0; background: none; color: var(--dsw-alias-label-primary); font: inherit; text-align: left; cursor: pointer; }
.sk-projectToggle:hover .sk-projectTitle { text-decoration: underline; text-underline-offset: 2px; }
.sk-projectToggle:focus-visible { outline: 2px solid var(--dsw-alias-brand-primary); outline-offset: 2px; border-radius: 4px; }
.sk-chevron { flex: none; width: 10px; color: var(--dsw-alias-label-secondary); font-size: 10px; line-height: 1; }
.sk-projectTitle { font-size: 14.5px; font-weight: 600; line-height: 1.35; }
.sk-projectPreview { color: var(--dsw-alias-label-secondary); font-size: 12px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.sk-projectPath { color: var(--dsw-alias-label-secondary); font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; font-size: 11px; overflow-wrap: anywhere; }
.sk-more { padding: 8px 12px; border: 0.5px dashed var(--dsw-alias-border-l1); border-radius: 10px; color: var(--dsw-alias-label-secondary); font-size: 12px; }
.sk-moreSummary { cursor: pointer; }
.sk-moreSummary:focus-visible { outline: 2px solid var(--dsw-alias-brand-primary); outline-offset: 2px; }
.sk-more[open] .sk-moreSummary { margin-bottom: 6px; }
.sk-moreList { display: flex; flex-direction: column; gap: 2px; padding: 2px 0 6px; }
.sk-moreItem { display: flex; flex-wrap: wrap; align-items: baseline; gap: 6px; }
.sk-moreTitle { color: var(--dsw-alias-label-primary); font-size: 12px; }
.sk-morePath { font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; font-size: 11px; overflow-wrap: anywhere; }
.sk-moreHint { font-size: 11.5px; }
.sk-empty { padding: 12px; border: 0.5px dashed var(--dsw-alias-border-l1); border-radius: 10px; color: var(--dsw-alias-label-secondary); font-size: 12px; }
.sk-loading { color: var(--dsw-alias-label-secondary); font-size: 12.5px; }
.sk-status { display: flex; flex-direction: column; gap: 4px; padding: 10px 12px; border: 0.5px solid var(--dsw-alias-border-l1); border-radius: 8px; background: var(--dsw-alias-bg-layer-1); font-size: 12px; }
.sk-statusTitle { font-weight: 500; }
.sk-status--warn { border-color: var(--dsw-alias-state-warn-primary); }
.sk-status--warn .sk-statusTitle { color: var(--dsw-alias-state-warn-primary); }
.sk-status--error { border-color: var(--dsw-alias-state-error-primary); }
.sk-status--error .sk-statusTitle { color: var(--dsw-alias-state-error-primary); }
.sk-statusPath { color: var(--dsw-alias-label-secondary); font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; font-size: 11px; overflow-wrap: anywhere; }
.sk-statusActions { display: flex; gap: 8px; padding-top: 2px; }
`
