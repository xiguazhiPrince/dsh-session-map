/**
 * Settings page rendering smoke tests: build the real page over fixture data and
 * render it with React's server renderer. The page is one slot component, so
 * this catches a broken element tree, missing layer sections, and lost warning
 * badges without a browser.
 *
 * @module dsh-session-map/skill-catalog/client.test
 */
import * as React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import {
  createSkillCatalogSettings,
  SkillCatalogPage,
  type SkillCatalogPageProps,
  type SkillCatalogRuntime,
} from './client'
import type { SkillCatalogState, SkillView } from './catalog'

/** One user-level fixture skill. */
const ALPHA: SkillView = {
  name: 'alpha',
  description: '写周报的技能',
  source: 'user-dsh',
  layer: 'user',
  rootLabel: '~/.dsh/skills',
  modelInvocable: true,
  userInvocable: true,
  path: '/Users/you/.dsh/skills/alpha/SKILL.md',
}

/** One project-level fixture skill with a manual-only invocation policy. */
const BETA: SkillView = {
  name: 'beta',
  description: '部署脚本',
  source: 'project-dsh',
  layer: 'project',
  rootLabel: '.dsh/skills',
  modelInvocable: false,
  userInvocable: true,
  whenToUse: '只在要发布时',
  path: '/repo/.dsh/skills/beta/SKILL.md',
}

/** One bundled fixture skill. */
const GAMMA: SkillView = {
  name: 'gamma',
  description: '内置技能',
  source: 'bundled',
  layer: 'other',
  rootLabel: '内置',
  modelInvocable: true,
  userInvocable: true,
}

/** One second project-level fixture skill, for multi-project folding. */
const DELTA: SkillView = {
  name: 'delta',
  description: '文档同步脚本',
  source: 'project-agents',
  layer: 'project',
  rootLabel: '.agents/skills',
  modelInvocable: true,
  userInvocable: true,
}

/** A catalog covering all three sections. */
const STATE: SkillCatalogState = {
  user: [ALPHA],
  projects: [
    {
      projectRoot: '/Users/you/projects/repo',
      workspaceIds: ['w1'],
      workspaceTitles: ['repo'],
      skills: [BETA],
    },
  ],
  other: [GAMMA],
}

/**
 * Render the pure page body over fixture props.
 * @param overrides - props to replace.
 * @returns the static markup.
 */
function render(overrides: Partial<SkillCatalogPageProps> = {}): string {
  return renderToStaticMarkup(React.createElement(SkillCatalogPage, {
    state: STATE,
    query: '',
    onQueryChange: () => {},
    onRefresh: () => {},
    refreshing: false,
    updatedAt: null,
    staleFailure: null,
    ...overrides,
  }))
}

describe('Skills settings page', () => {
  it('renders the two requested levels plus the other-source group', () => {
    const markup = render()
    expect(markup).toContain('技能')
    expect(markup).toContain('用户级')
    expect(markup).toContain('项目级')
    expect(markup).toContain('内置 / 其他')
    expect(markup).toContain('写周报的技能')
    expect(markup).toContain('部署脚本')
    expect(markup).toContain('内置技能')
  })

  it('names each skill with its discovery root and its project', () => {
    const markup = render()
    expect(markup).toContain('alpha')
    expect(markup).toContain('~/.dsh/skills')
    expect(markup).toContain('repo')
    expect(markup).toContain('/Users/you/projects/repo')
    expect(markup).toContain('/repo/.dsh/skills/beta/SKILL.md')
  })

  it('marks invocation limits and routing guidance', () => {
    const markup = render()
    expect(markup).toContain('仅手动调用')
    expect(markup).toContain('何时用：')
    expect(markup).toContain('只在要发布时')
  })

  it('filters by query and reports an empty result', () => {
    const filtered = render({ query: '周报' })
    expect(filtered).toContain('写周报')
    expect(filtered).not.toContain('内置技能')

    const none = render({ query: 'no-such-skill' })
    expect(none).toContain('没有匹配的技能')
    expect(none).toContain('no-such-skill')
  })

  it('renders the empty-level hints before any skill exists', () => {
    const markup = render({
      state: { user: [], projects: [], other: [] },
    })
    expect(markup).toContain('还没有用户级技能')
    expect(markup).toContain('还没有注册工作区')
    expect(markup).not.toContain('内置 / 其他')
  })

  it('folds projects without project skills into one summary line', () => {
    const markup = render({
      state: {
        user: [ALPHA],
        projects: [
          {
            projectRoot: '/Users/you/projects/empty',
            workspaceIds: ['w2'],
            workspaceTitles: ['empty'],
            skills: [],
          },
        ],
        other: [],
      },
    })
    expect(markup).toContain('另有 1 个项目没有项目级技能')
    expect(markup).toContain('/Users/you/projects/empty')
    expect(markup).not.toContain('class="sk-project"')
  })

  it('renders the stale-read banner over the previous catalog', () => {
    const markup = render({ staleFailure: '技能目录读取失败：HTTP 500' })
    expect(markup).toContain('本次刷新失败')
    expect(markup).toContain('HTTP 500')
    expect(markup).toContain('写周报的技能')
  })

  it('opens a sole project but collapses a list of projects', () => {
    const single = render()
    expect(single).toContain('部署脚本')
    expect(single).not.toContain('全部展开')

    const twoProjects: SkillCatalogState = {
      user: [ALPHA],
      projects: [
        { projectRoot: '/Users/you/projects/a', workspaceIds: ['a'], workspaceTitles: ['项目 A'], skills: [BETA] },
        { projectRoot: '/Users/you/projects/b', workspaceIds: ['b'], workspaceTitles: ['项目 B'], skills: [DELTA] },
      ],
      other: [],
    }
    const folded = render({ state: twoProjects })
    expect(folded).toContain('项目 A')
    expect(folded).toContain('项目 B')
    expect(folded).toContain('全部展开')
    expect(folded).toContain('beta')
    expect(folded).toContain('delta')
    expect(folded).not.toContain('部署脚本')
    expect(folded).not.toContain('文档同步脚本')
  })

  it('forces matching projects open while searching', () => {
    const twoProjects: SkillCatalogState = {
      user: [ALPHA],
      projects: [
        { projectRoot: '/Users/you/projects/a', workspaceIds: ['a'], workspaceTitles: ['项目 A'], skills: [BETA] },
        { projectRoot: '/Users/you/projects/b', workspaceIds: ['b'], workspaceTitles: ['项目 B'], skills: [DELTA] },
      ],
      other: [],
    }
    const markup = render({ state: twoProjects, query: '部署' })
    expect(markup).toContain('部署脚本')
    expect(markup).not.toContain('文档同步脚本')
    expect(markup).not.toContain('全部展开')
  })

  it('folds a long description behind a text toggle', () => {
    const longSkill: SkillView = {
      ...ALPHA,
      name: 'long-description',
      description: '这是一段很长的技能描述，用来验证折叠。'.repeat(6),
    }
    const markup = render({ state: { user: [longSkill], projects: [], other: [] } })
    expect(markup).toContain('sk-desc sk-desc--clamp')
    expect(markup).toContain('>展开</button>')
    expect(markup).not.toContain('>收起</button>')
  })

  it('keeps a short description whole without a toggle', () => {
    const markup = render({ state: { user: [ALPHA], projects: [], other: [] } })
    expect(markup).not.toContain('sk-desc sk-desc--clamp')
    expect(markup).not.toContain('class="sk-descToggle"')
  })
})

describe('Skills settings container', () => {
  it('renders the loading state before the first read settles', () => {
    const runtime: SkillCatalogRuntime = { load: async () => STATE }
    const Settings = createSkillCatalogSettings(runtime)
    const markup = renderToStaticMarkup(React.createElement(Settings))
    expect(markup).toContain('正在读取技能目录')
  })
})
