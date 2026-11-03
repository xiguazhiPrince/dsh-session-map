/**
 * Model tests: the pure assembly rules the Host and the tab share. These cover
 * the two behaviors that would silently change what the model sees — injection
 * order across the user roots and the project chain, and duplicate suppression
 * within a candidate group — plus the wire coercion that protects the page from
 * a malformed or stale response.
 *
 * @module dsh-session-map/agent-instructions/model.test
 */
import { describe, expect, it } from 'vitest'
import {
  allInstructionFiles,
  assembleInstructionState,
  assignInjectionOrder,
  checkDeleteEnvelope,
  displayPathOf,
  escapeProjectDisplayPath,
  existingInstructionFiles,
  fileFromEnvelope,
  findInstructionFile,
  formatInstructionBytes,
  injectionOrderOf,
  instructionFileId,
  instructionVariantOf,
  projectCandidateNames,
  projectLevelId,
  projectLevelTitle,
  shortenHomePath,
  stateFromEnvelope,
  USER_ROOTS,
  USER_GLOBAL_INSTRUCTION_FILE,
  writeFromEnvelope,
  type AgentInstructionsStateInput,
  type DiscoveredInstructionFile,
  type InstructionFileDetail,
  type UserRootInput,
} from './model'

/** One discovered row helper, so each fixture states only what it varies. */
function discovered(
  overrides: Partial<DiscoveredInstructionFile> & Pick<DiscoveredInstructionFile, 'levelId' | 'name' | 'displayPath'>,
): DiscoveredInstructionFile {
  return {
    scope: overrides.levelId.startsWith('user:') ? 'user' : 'project',
    absolutePath: `/${overrides.displayPath}`,
    exists: true,
    size: 12,
    modifiedAt: '2026-11-03T02:00:00.000Z',
    digest: 'digest-default',
    ...overrides,
  }
}

/** The two user roots, as the Host reports them. */
const USER_ROOTS_INPUT: readonly UserRootInput[] = [
  { id: 'user:dsh-home', title: '~/.dsh', home: '/home/me/.dsh' },
  { id: 'user:agents-home', title: '~/.agents', home: '/home/me/.agents' },
]

/**
 * One full input: user roots plus a three-level project chain.
 * @returns a fresh input object each call.
 */
function baseInput(): AgentInstructionsStateInput {
  return {
    sessionId: 'session-1',
    cwd: '/repo/src/api',
    cwdDisplay: '/repo/src/api',
    project: { root: '/repo', display: '/repo', hasMarker: true },
    userRoots: USER_ROOTS_INPUT,
    levels: [
      { id: 'project:.', title: '项目根', relativeDir: '.', absolutePath: '/repo' },
      { id: 'project:src', title: 'src', relativeDir: 'src', absolutePath: '/repo/src' },
      { id: 'project:src/api', title: 'src/api', relativeDir: 'src/api', absolutePath: '/repo/src/api' },
    ],
    discovered: [
      discovered({ levelId: 'user:dsh-home', name: USER_GLOBAL_INSTRUCTION_FILE, displayPath: '~/.dsh/AGENTS.md', digest: 'user' }),
      discovered({ levelId: 'user:agents-home', name: USER_GLOBAL_INSTRUCTION_FILE, displayPath: '~/.agents/AGENTS.md', digest: 'user' }),
      discovered({ levelId: 'project:.', name: 'AGENTS.md', displayPath: 'AGENTS.md', digest: 'root' }),
      discovered({ levelId: 'project:.', name: 'CLAUDE.md', displayPath: 'CLAUDE.md', exists: false, size: null, modifiedAt: null, digest: undefined }),
      discovered({ levelId: 'project:src', name: 'AGENTS.local.md', displayPath: 'src/AGENTS.local.md', digest: 'src-local' }),
      discovered({ levelId: 'project:src', name: 'CLAUDE.md', displayPath: 'src/CLAUDE.md', digest: 'src-local' }),
      discovered({ levelId: 'project:src/api', name: 'AGENTS.md', displayPath: 'src/api/AGENTS.md', digest: 'api' }),
    ],
  }
}

describe('display path helpers', () => {
  it('normalizes separators without touching the rest of the path', () => {
    expect(displayPathOf('C:\\repo\\src\\AGENTS.md')).toBe('C:/repo/src/AGENTS.md')
    expect(displayPathOf('/repo/src/AGENTS.md')).toBe('/repo/src/AGENTS.md')
  })

  it('shortens a path under the home directory and leaves others alone', () => {
    expect(shortenHomePath('/Users/me/repo/AGENTS.md', '/Users/me')).toBe('~/repo/AGENTS.md')
    expect(shortenHomePath('/Users/me', '/Users/me')).toBe('~')
    expect(shortenHomePath('/Users/meadow/x', '/Users/me')).toBe('/Users/meadow/x')
    expect(shortenHomePath('/opt/repo', '/Users/me')).toBe('/opt/repo')
  })

  it('escapes the two scope-reserved first components like the product does', () => {
    expect(escapeProjectDisplayPath('user-global/AGENTS.md')).toBe('./user-global/AGENTS.md')
    expect(escapeProjectDisplayPath('agents-global')).toBe('./agents-global')
    expect(escapeProjectDisplayPath('src/AGENTS.md')).toBe('src/AGENTS.md')
    expect(escapeProjectDisplayPath('AGENTS.md')).toBe('AGENTS.md')
  })
})

describe('identity helpers', () => {
  it('uses a stable project level id including the root dot', () => {
    expect(projectLevelId('.')).toBe('project:.')
    expect(projectLevelId('')).toBe('project:.')
    expect(projectLevelId('src/api')).toBe('project:src/api')
    expect(projectLevelId('user-global')).toBe('project:./user-global')
  })

  it('addresses one candidate by level plus file name', () => {
    expect(instructionFileId('project:src', 'AGENTS.md')).toBe('project:src/AGENTS.md')
    expect(instructionFileId('user:dsh-home', 'AGENTS.md')).toBe('user:dsh-home/AGENTS.md')
  })

  it('labels the project root and nested levels', () => {
    expect(projectLevelTitle('.')).toBe('项目根')
    expect(projectLevelTitle('src/api')).toBe('src/api')
  })

  it('classifies local overlays and keeps the candidate order', () => {
    expect(instructionVariantOf('AGENTS.md')).toBe('base')
    expect(instructionVariantOf('AGENTS.local.md')).toBe('local')
    expect(projectCandidateNames()).toEqual([
      'AGENTS.md', 'CLAUDE.md', 'AGENTS.local.md', 'CLAUDE.local.md',
    ])
  })

  it('lists the two user roots in injection order', () => {
    expect(USER_ROOTS.map(root => root.id)).toEqual(['user:dsh-home', 'user:agents-home'])
    expect(USER_ROOTS.map(root => root.defaultDisplay)).toEqual(['~/.dsh', '~/.agents'])
  })
})

describe('assignInjectionOrder', () => {
  it('numbers readable files from 1 across user roots and the project chain', () => {
    const summaries = assignInjectionOrder(baseInput().discovered)
    const byPath = new Map(summaries.map(summary => [summary.displayPath, summary]))
    // The two user roots carry identical content, so the second one has no order.
    expect(byPath.get('~/.dsh/AGENTS.md')?.order).toBe(1)
    expect(byPath.get('~/.agents/AGENTS.md')?.order).toBeUndefined()
    expect(byPath.get('~/.agents/AGENTS.md')?.duplicateOf).toBe('~/.dsh/AGENTS.md')
    expect(byPath.get('AGENTS.md')?.order).toBe(2)
    expect(byPath.get('src/AGENTS.local.md')?.order).toBe(3)
    expect(byPath.get('src/CLAUDE.md')?.duplicateOf).toBe('src/AGENTS.local.md')
    expect(byPath.get('src/api/AGENTS.md')?.order).toBe(4)
    // A missing candidate never takes an order.
    expect(byPath.get('CLAUDE.md')?.order).toBeUndefined()
    expect(byPath.get('CLAUDE.md')?.exists).toBe(false)
  })

  it('does not collapse identical content across different project directories', () => {
    const summaries = assignInjectionOrder([
      discovered({ levelId: 'project:.', name: 'AGENTS.md', displayPath: 'AGENTS.md', digest: 'same' }),
      discovered({ levelId: 'project:src', name: 'AGENTS.md', displayPath: 'src/AGENTS.md', digest: 'same' }),
    ])
    expect(summaries.map(summary => summary.order)).toEqual([1, 2])
  })

  it('reports skipped files without an order and without a duplicate', () => {
    const summaries = assignInjectionOrder([
      discovered({ levelId: 'project:.', name: 'AGENTS.md', displayPath: 'AGENTS.md', digest: 'x' }),
      discovered({
        levelId: 'project:.',
        name: 'CLAUDE.md',
        displayPath: 'CLAUDE.md',
        skipped: 'too-large',
        digest: 'x',
      }),
    ])
    expect(summaries[1]?.order).toBeUndefined()
    expect(summaries[1]?.duplicateOf).toBeUndefined()
    expect(summaries[1]?.skipped).toBe('too-large')
  })

  it('keeps the variant and identity fields on every row', () => {
    const summaries = assignInjectionOrder(baseInput().discovered)
    const local = summaries.find(summary => summary.displayPath === 'src/AGENTS.local.md')
    expect(local).toMatchObject({
      id: 'project:src/AGENTS.local.md',
      scope: 'project',
      levelId: 'project:src',
      variant: 'local',
    })
  })
})

describe('assembleInstructionState', () => {
  it('groups the candidates under their user root and project level', () => {
    const state = assembleInstructionState(baseInput(), '2026-11-03T02:00:00.000Z')
    expect(state.userRoots.map(root => root.id)).toEqual(['user:dsh-home', 'user:agents-home'])
    expect(state.userRoots[0]?.file.order).toBe(1)
    expect(state.levels.map(level => level.id)).toEqual(['project:.', 'project:src', 'project:src/api'])
    expect(state.levels[0]?.files.map(file => file.name)).toEqual(['AGENTS.md', 'CLAUDE.md'])
    expect(state.levels[1]?.files.map(file => file.name)).toEqual(['AGENTS.local.md', 'CLAUDE.md'])
    expect(state.effectiveCount).toBe(4)
    expect(state.generatedAt).toBe('2026-11-03T02:00:00.000Z')
  })

  it('round-trips through the flattened helpers in injection order', () => {
    const state = assembleInstructionState(baseInput(), '2026-11-03T02:00:00.000Z')
    expect(injectionOrderOf(state).map(file => file.displayPath)).toEqual([
      '~/.dsh/AGENTS.md',
      'AGENTS.md',
      'src/AGENTS.local.md',
      'src/api/AGENTS.md',
    ])
    expect(existingInstructionFiles(state)).toHaveLength(6)
    expect(allInstructionFiles(state)).toHaveLength(7)
    expect(findInstructionFile(state, 'project:src/CLAUDE.md')?.duplicateOf).toBe('src/AGENTS.local.md')
    expect(findInstructionFile(state, 'no-such-id')).toBeUndefined()
  })
})

describe('formatInstructionBytes', () => {
  it('renders bytes, KiB, MiB, and the unknown size', () => {
    expect(formatInstructionBytes(null)).toBe('—')
    expect(formatInstructionBytes(512)).toBe('512 B')
    expect(formatInstructionBytes(2048)).toBe('2.0 KiB')
    expect(formatInstructionBytes(1024 * 1024)).toBe('1.0 MiB')
  })
})

describe('wire coercion', () => {
  const detail: InstructionFileDetail = {
    id: 'project:.',
    scope: 'project',
    levelId: 'project:.',
    name: 'AGENTS.md',
    variant: 'base',
    displayPath: 'AGENTS.md',
    absolutePath: '/repo/AGENTS.md',
    exists: true,
    size: 12,
    modifiedAt: '2026-11-03T02:00:00.000Z',
    order: 1,
    content: '# repo\n',
    sha1: 'abc',
  }

  it('reads a state envelope and its nested rows', () => {
    const state = assembleInstructionState(baseInput(), '2026-11-03T02:00:00.000Z')
    const parsed = stateFromEnvelope({ ok: true, state })
    expect(parsed.sessionId).toBe('session-1')
    expect(parsed.project.hasMarker).toBe(true)
    expect(parsed.levels).toHaveLength(3)
    expect(parsed.levels[0]?.files[0]?.name).toBe('AGENTS.md')
  })

  it('surfaces the Host failure code and message', () => {
    expect(() => stateFromEnvelope({
      ok: false,
      error: { code: 'session-not-found', message: 'session "s1" not found' },
    })).toThrow('session-not-found: session "s1" not found')
  })

  it('rejects a malformed state instead of rendering a half page', () => {
    expect(() => stateFromEnvelope({ ok: true, state: { sessionId: 's1' } })).toThrow('格式不正确')
    expect(() => stateFromEnvelope({ ok: true })).toThrow('格式不正确')
  })

  it('reads a file detail and a written file detail', () => {
    expect(fileFromEnvelope({ ok: true, file: detail })).toEqual(detail)
    expect(writeFromEnvelope({ ok: true, file: detail })).toEqual(detail)
    expect(() => fileFromEnvelope({ ok: true, file: { ...detail, content: undefined } }))
      .toThrow('格式不正确')
  })

  it('throws the delete failure and accepts success', () => {
    expect(() => checkDeleteEnvelope({ ok: true })).not.toThrow()
    expect(() => checkDeleteEnvelope({
      ok: false,
      error: { code: 'delete-failed', message: '磁盘拒绝' },
    })).toThrow('delete-failed: 磁盘拒绝')
  })
})
