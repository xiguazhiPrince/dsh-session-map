/**
 * Session skills tab tests: the Remote wrapper and the pure body. The tab is a
 * Session-scoped View, so a server render catches a broken element tree, wrongly
 * attributed discovery roots, and lost search/empty/stale states without a
 * browser.
 *
 * @module dsh-session-map/skill-catalog/session-tab.test
 */
import type { Context } from '@deepseek-ai/cordis'
import * as React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { sessionSkillViews } from './catalog'
import {
  createSessionSkillRuntime,
  createSessionSkillsTab,
  SessionSkillsPage,
  type SessionSkillsPageProps,
} from './session-tab'

/** The shared row fixtures: one user-level, one project-level, one pathless. */
const VIEWS = sessionSkillViews([
  {
    name: 'alpha',
    description: '写周报的技能',
    path: '/Users/you/.dsh/skills/alpha/SKILL.md',
    modelInvocable: true,
  },
  {
    name: 'beta',
    description: '部署脚本',
    path: '/Users/you/repo/.dsh/skills/beta/SKILL.md',
    whenToUse: '只在要发布时',
    modelInvocable: false,
  },
  { name: 'gamma', description: '内置技能' },
])

/**
 * Render the pure tab body over fixture props.
 * @param overrides - props to replace.
 * @returns the static markup.
 */
function render(overrides: Partial<SessionSkillsPageProps> = {}): string {
  return renderToStaticMarkup(React.createElement(SessionSkillsPage, {
    sessionId: 'session-1234',
    skills: VIEWS,
    query: '',
    onQueryChange: () => {},
    rootFilter: null,
    onRootFilterChange: () => {},
    onRefresh: () => {},
    refreshing: false,
    updatedAt: null,
    staleFailure: null,
    ...overrides,
  }))
}

/**
 * Build a fake context whose only service is `remote.skills`.
 * @param remote - the fake Remote, or `undefined` to leave it unmounted.
 * @returns the context the runtime reads.
 */
function contextWith(remote: unknown): Context {
  return {
    get: (name: string) => name === 'remote.skills' ? remote : undefined,
  } as unknown as Context
}

describe('Session skills tab body', () => {
  it('renders every effective skill with its discovery root and path', () => {
    const markup = render()
    expect(markup).toContain('生效技能')
    expect(markup).toContain('本会话可见')
    expect(markup).toContain('alpha')
    expect(markup).toContain('beta')
    expect(markup).toContain('gamma')
    expect(markup).toContain('~/.dsh/skills')
    expect(markup).toContain('.dsh/skills')
    expect(markup).toContain('运行时注册')
    expect(markup).toContain('/Users/you/.dsh/skills/alpha/SKILL.md')
  })

  it('marks model-invisible skills and routing guidance', () => {
    const markup = render()
    expect(markup).toContain('仅手动调用')
    expect(markup).toContain('何时用：')
    expect(markup).toContain('只在要发布时')
  })

  it('names the Session and the total skill count in the footer', () => {
    expect(render()).toContain('会话 session-1234 · 共 3 个技能')
  })

  it('filters by name, description, path, and root', () => {
    const byDescription = render({ query: '周报' })
    expect(byDescription).toContain('写周报的技能')
    expect(byDescription).not.toContain('部署脚本')

    const byRoot = render({ query: '~/.dsh/skills' })
    expect(byRoot).toContain('alpha')
    expect(byRoot).not.toContain('beta')
  })

  it('reports a query with no matches', () => {
    const markup = render({ query: 'no-such-skill' })
    expect(markup).toContain('没有匹配的技能')
    expect(markup).toContain('no-such-skill')
  })

  it('renders the empty hint when the Session has no skills', () => {
    const markup = render({ skills: [] })
    expect(markup).toContain('当前会话没有可用的技能')
    expect(markup).toContain('共 0 个技能')
  })

  it('still reports a filter with no matches when the Session has no skills', () => {
    const markup = render({ skills: [], query: 'no-such-skill' })
    expect(markup).toContain('没有匹配的技能')
    expect(markup).not.toContain('当前会话没有可用的技能')
  })

  it('renders the stale-read banner over the previous list', () => {
    const markup = render({ staleFailure: '技能读取失败：HTTP 500' })
    expect(markup).toContain('本次刷新失败')
    expect(markup).toContain('HTTP 500')
    expect(markup).toContain('写周报的技能')
  })

  it('renders an 全部 tab plus one filter tab per discovery root', () => {
    const markup = render()
    expect(markup).toContain('sk-rootTabs')
    expect(markup).toContain('全部')
    expect(markup).toContain('~/.dsh/skills')
    expect(markup).toContain('.dsh/skills')
    expect(markup).toContain('运行时注册')
    expect(markup).toContain('data-active="true"')
    expect(markup).toContain('>3</span>')
  })

  it('filters the list to one discovery root', () => {
    const markup = render({ rootFilter: '.dsh/skills' })
    expect(markup).toContain('beta')
    expect(markup).not.toContain('alpha')
    expect(markup).not.toContain('gamma')
  })

  it('falls back to 全部 when the selected root is gone', () => {
    const markup = render({ rootFilter: '自定义目录' })
    expect(markup).toContain('alpha')
    expect(markup).toContain('beta')
    expect(markup).toContain('gamma')
  })

  it('reports a root filter that hides every search match', () => {
    const markup = render({ rootFilter: '.dsh/skills', query: '周报' })
    expect(markup).toContain('这个路径下没有匹配的技能')
    expect(markup).toContain('周报')
    expect(markup).not.toContain('写周报的技能')
  })
})

describe('Session skills tab container', () => {
  it('renders the loading state before the first read settles', () => {
    const Tab = createSessionSkillsTab({ list: async () => [] })
    const markup = renderToStaticMarkup(React.createElement(Tab, { sessionId: 'session-1234' }))
    expect(markup).toContain('正在读取当前会话的技能')
  })
})

describe('SessionSkillRuntime', () => {
  it('reads the entries from the typed remote.skills namespace', async () => {
    const calls: unknown[] = []
    const runtime = createSessionSkillRuntime(contextWith({
      list: async (request: unknown) => {
        calls.push(request)
        return {
          ok: true,
          value: {
            skills: [{ name: 'alpha', description: 'writes reports', modelInvocable: true }],
          },
        }
      },
    }))
    await expect(runtime.list('session-1234', new AbortController().signal))
      .resolves.toEqual([{ name: 'alpha', description: 'writes reports', modelInvocable: true }])
    expect(calls).toEqual([{ sessionId: 'session-1234' }])
  })

  it('surfaces the Remote failure code and message', async () => {
    const runtime = createSessionSkillRuntime(contextWith({
      list: async () => ({
        ok: false,
        error: { code: 'session/not-found', message: 'session "s1" not found' },
      }),
    }))
    await expect(runtime.list('s1', new AbortController().signal))
      .rejects.toThrow('session/not-found: session "s1" not found')
  })

  it('reports a composition without remote.skills instead of failing at apply time', async () => {
    const runtime = createSessionSkillRuntime(contextWith(undefined))
    await expect(runtime.list('s1', new AbortController().signal))
      .rejects.toThrow('技能服务不可用')
  })
})
