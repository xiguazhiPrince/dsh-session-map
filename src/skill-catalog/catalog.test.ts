/**
 * Rules tests for the skills catalog: source classification, bucketing,
 * search filtering, and envelope decoding. These are the rules both halves
 * share, so they are exercised without a Cordis context or a browser.
 *
 * @module dsh-session-map/skill-catalog/catalog.test
 */
import { describe, expect, it } from 'vitest'
import {
  bucketSkillSummaries,
  countCatalog,
  filterCatalog,
  layerOfSource,
  rootLabelOf,
  stateFromEnvelope,
  type SkillCatalogState,
  type SkillSummaryLike,
} from './catalog'

describe('layerOfSource', () => {
  it('maps the provider sources onto the two requested levels', () => {
    expect(layerOfSource('user-dsh')).toBe('user')
    expect(layerOfSource('user-agents')).toBe('user')
    expect(layerOfSource('project-dsh')).toBe('project')
    expect(layerOfSource('project-agents')).toBe('project')
    expect(layerOfSource('bundled')).toBe('other')
    expect(layerOfSource('custom')).toBe('other')
    expect(layerOfSource('runtime')).toBe('other')
    expect(layerOfSource('third-party-provider')).toBe('other')
  })
})

describe('rootLabelOf', () => {
  it('names the known roots and falls back to the raw source', () => {
    expect(rootLabelOf('user-dsh')).toBe('~/.dsh/skills')
    expect(rootLabelOf('project-agents')).toBe('.agents/skills')
    expect(rootLabelOf('some-provider')).toBe('some-provider')
  })
})

describe('bucketSkillSummaries', () => {
  const summaries: SkillSummaryLike[] = [
    { name: 'alpha', description: 'user skill', source: 'user-dsh', path: '/home/you/.dsh/skills/alpha/SKILL.md' },
    { name: 'beta', description: 'project skill', source: 'project-dsh', path: '/repo/.dsh/skills/beta/SKILL.md' },
    { name: 'gamma', description: 'bundled skill', source: 'bundled', invocation: { userInvocable: false } },
    { name: 'delta', description: 'agents skill', source: 'user-agents', whenToUse: 'when testing' },
    { name: '', description: 'no name', source: 'user-dsh' },
    { name: undefined, source: 'user-dsh' },
  ]

  it('splits one listing into user, project, and other buckets', () => {
    const buckets = bucketSkillSummaries(summaries)
    expect(buckets.user.map(skill => skill.name)).toEqual(['alpha', 'delta'])
    expect(buckets.project.map(skill => skill.name)).toEqual(['beta'])
    expect(buckets.other.map(skill => skill.name)).toEqual(['gamma'])
  })

  it('stamps layer, root label, and invocation defaults', () => {
    const buckets = bucketSkillSummaries(summaries)
    const alpha = buckets.user[0]
    const gamma = buckets.other[0]
    expect(alpha?.layer).toBe('user')
    expect(alpha?.rootLabel).toBe('~/.dsh/skills')
    expect(alpha?.modelInvocable).toBe(true)
    expect(alpha?.userInvocable).toBe(true)
    expect(alpha?.description).toBe('user skill')
    expect(gamma?.userInvocable).toBe(false)
    expect(gamma?.modelInvocable).toBe(true)
    expect(buckets.user[1]?.whenToUse).toBe('when testing')
  })

  it('drops entries without a usable name and deduplicates name plus path', () => {
    const duplicate: SkillSummaryLike[] = [
      ...summaries,
      { name: 'alpha', description: 'same file again', source: 'user-dsh', path: '/home/you/.dsh/skills/alpha/SKILL.md' },
    ]
    const buckets = bucketSkillSummaries(duplicate)
    expect(buckets.user.filter(skill => skill.name === 'alpha')).toHaveLength(1)
    expect(buckets.user).toHaveLength(2)
  })
})

describe('filterCatalog', () => {
  const state: SkillCatalogState = {
    user: [
      { name: 'alpha', description: 'writes reports', source: 'user-dsh', layer: 'user', rootLabel: '~/.dsh/skills', modelInvocable: true, userInvocable: true },
      { name: 'beta', description: 'reads invoices', source: 'user-agents', layer: 'user', rootLabel: '~/.agents/skills', modelInvocable: true, userInvocable: true },
    ],
    projects: [
      {
        projectRoot: '/repo',
        workspaceIds: ['w1'],
        workspaceTitles: ['repo'],
        skills: [
          { name: 'gamma', description: 'project deploy helper', source: 'project-dsh', layer: 'project', rootLabel: '.dsh/skills', modelInvocable: true, userInvocable: true },
        ],
      },
    ],
    other: [
      { name: 'delta', description: 'bundled skill', source: 'bundled', layer: 'other', rootLabel: '内置', modelInvocable: true, userInvocable: true },
    ],
  }

  it('matches names, descriptions, paths, and root labels case-insensitively', () => {
    expect(filterCatalog(state, 'ALPHA').count).toBe(1)
    expect(filterCatalog(state, 'invoice').count).toBe(1)
    expect(filterCatalog(state, 'deploy').count).toBe(1)
    expect(filterCatalog(state, '内置').count).toBe(1)
  })

  it('returns the same catalog for a blank query', () => {
    const filtered = filterCatalog(state, '   ')
    expect(filtered.state).toBe(state)
    expect(filtered.count).toBe(4)
  })

  it('keeps the section shape while dropping non-matching rows', () => {
    const filtered = filterCatalog(state, 'report')
    expect(filtered.state.user.map(skill => skill.name)).toEqual(['alpha'])
    expect(filtered.state.projects[0]?.skills).toEqual([])
    expect(filtered.state.other).toEqual([])
    expect(filtered.count).toBe(1)
    expect(countCatalog(state)).toBe(4)
  })
})

describe('stateFromEnvelope', () => {
  it('returns the three buckets of a successful read', () => {
    const state = stateFromEnvelope({
      ok: true,
      user: [],
      projects: [],
      other: [],
    })
    expect(state).toEqual({ user: [], projects: [], other: [] })
  })

  it('throws the Host code and message of a failed read', () => {
    expect(() => stateFromEnvelope({
      ok: false,
      error: { code: 'skills-unavailable', message: '技能服务不可用' },
    })).toThrow('skills-unavailable: 技能服务不可用')
    expect(() => stateFromEnvelope({ ok: false })).toThrow('internal: 技能目录读取失败')
  })

  it('tolerates a partial success body', () => {
    expect(stateFromEnvelope({ ok: true, user: undefined, projects: undefined, other: undefined }))
      .toEqual({ user: [], projects: [], other: [] })
  })
})
