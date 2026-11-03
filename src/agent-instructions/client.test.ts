/**
 * Agent instructions tab tests: the pure list page, the pure editor page, the
 * container's first frame, and the HTTP runtime's wire contract. The tab is a
 * Session-scoped View, so a server render catches a broken element tree, a lost
 * hierarchy notice, and mislabelled candidates without a browser, while the
 * runtime tests pin request URLs, methods, bodies, and failure propagation.
 *
 * @module dsh-session-map/agent-instructions/client.test
 */
import type { Context } from '@deepseek-ai/cordis'
import * as React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  AgentInstructionsPage,
  InstructionEditorPage,
  createAgentInstructionsRuntime,
  createAgentInstructionsTab,
  type AgentInstructionsPageProps,
  type AgentInstructionsRuntime,
  type InstructionEditorPageProps,
} from './client'
import type {
  AgentInstructionsState,
  InstructionFileDetail,
  InstructionFileSummary,
  InstructionLevel,
  UserRootView,
} from './model'

/** Injection order, size, and time of the user's `~/.dsh/AGENTS.md`. */
const USER_DSH_FILE: InstructionFileSummary = {
  id: 'user:dsh-home/AGENTS.md',
  scope: 'user',
  levelId: 'user:dsh-home',
  name: 'AGENTS.md',
  variant: 'base',
  displayPath: '~/.dsh/AGENTS.md',
  absolutePath: '/Users/you/.dsh/AGENTS.md',
  exists: true,
  size: 21,
  modifiedAt: '2026-11-03T02:00:00.000Z',
  order: 1,
}

/** The missing `~/.agents/AGENTS.md`, the dedup sibling of the `~/.dsh` file. */
const USER_AGENTS_FILE: InstructionFileSummary = {
  id: 'user:agents-home/AGENTS.md',
  scope: 'user',
  levelId: 'user:agents-home',
  name: 'AGENTS.md',
  variant: 'base',
  displayPath: '~/.agents/AGENTS.md',
  absolutePath: '/Users/you/.agents/AGENTS.md',
  exists: false,
  size: null,
  modifiedAt: null,
}

/**
 * Build one candidate that is not present on disk.
 * @param levelId - owning level id.
 * @param name - candidate file name.
 * @param displayPath - path shown in the row.
 * @returns the missing candidate.
 */
function missingFile(
  levelId: string,
  name: string,
  displayPath: string,
): InstructionFileSummary {
  return {
    id: `${levelId}/${name}`,
    scope: 'project',
    levelId,
    name,
    variant: /\.local\.md$/i.test(name) ? 'local' : 'base',
    displayPath,
    absolutePath: `/Users/you/projects/repo/${displayPath}`,
    exists: false,
    size: null,
    modifiedAt: null,
  }
}

/** The root candidate the prompt includes second. */
const ROOT_AGENTS: InstructionFileSummary = {
  id: 'project:./AGENTS.md',
  scope: 'project',
  levelId: 'project:.',
  name: 'AGENTS.md',
  variant: 'base',
  displayPath: 'AGENTS.md',
  absolutePath: '/Users/you/projects/repo/AGENTS.md',
  exists: true,
  size: 900,
  modifiedAt: '2026-11-03T02:01:00.000Z',
  order: 2,
}

/** The `src` overlay the prompt includes third. */
const SRC_AGENTS_LOCAL: InstructionFileSummary = {
  id: 'project:src/AGENTS.local.md',
  scope: 'project',
  levelId: 'project:src',
  name: 'AGENTS.local.md',
  variant: 'local',
  displayPath: 'src/AGENTS.local.md',
  absolutePath: '/Users/you/projects/repo/src/AGENTS.local.md',
  exists: true,
  size: 40,
  modifiedAt: '2026-11-03T02:02:00.000Z',
  order: 3,
}

/** A `CLAUDE.md` byte-identical to the root `AGENTS.md`, so it is suppressed. */
const SRC_CLAUDE: InstructionFileSummary = {
  id: 'project:src/CLAUDE.md',
  scope: 'project',
  levelId: 'project:src',
  name: 'CLAUDE.md',
  variant: 'base',
  displayPath: 'src/CLAUDE.md',
  absolutePath: '/Users/you/projects/repo/src/CLAUDE.md',
  exists: true,
  size: 900,
  modifiedAt: '2026-11-03T02:02:30.000Z',
  duplicateOf: 'AGENTS.md',
}

/** The project root level. */
const ROOT_LEVEL: InstructionLevel = {
  id: 'project:.',
  title: '项目根',
  relativeDir: '.',
  absolutePath: '/Users/you/projects/repo',
  files: [
    ROOT_AGENTS,
    missingFile('project:.', 'CLAUDE.md', 'CLAUDE.md'),
    missingFile('project:.', 'AGENTS.local.md', 'AGENTS.local.md'),
    missingFile('project:.', 'CLAUDE.local.md', 'CLAUDE.local.md'),
  ],
}

/** The nested `src` level. */
const SRC_LEVEL: InstructionLevel = {
  id: 'project:src',
  title: 'src',
  relativeDir: 'src',
  absolutePath: '/Users/you/projects/repo/src',
  files: [
    missingFile('project:src', 'AGENTS.md', 'src/AGENTS.md'),
    SRC_CLAUDE,
    SRC_AGENTS_LOCAL,
    missingFile('project:src', 'CLAUDE.local.md', 'src/CLAUDE.local.md'),
  ],
}

/** The session cwd level, with every candidate still absent. */
const API_LEVEL: InstructionLevel = {
  id: 'project:src/api',
  title: 'src/api',
  relativeDir: 'src/api',
  absolutePath: '/Users/you/projects/repo/src/api',
  files: [
    missingFile('project:src/api', 'AGENTS.md', 'src/api/AGENTS.md'),
    missingFile('project:src/api', 'CLAUDE.md', 'src/api/CLAUDE.md'),
    missingFile('project:src/api', 'AGENTS.local.md', 'src/api/AGENTS.local.md'),
    missingFile('project:src/api', 'CLAUDE.local.md', 'src/api/CLAUDE.local.md'),
  ],
}

/** The two user-global roots, in injection order. */
const USER_ROOTS: readonly UserRootView[] = [
  { id: 'user:dsh-home', title: '~/.dsh', home: '/Users/you/.dsh', file: USER_DSH_FILE },
  { id: 'user:agents-home', title: '~/.agents', home: '/Users/you/.agents', file: USER_AGENTS_FILE },
]

/** The assembled fixture state: three effective files across three levels. */
const STATE: AgentInstructionsState = {
  sessionId: 'session-1234',
  cwd: '/Users/you/projects/repo/src/api',
  cwdDisplay: '~/projects/repo/src/api',
  project: { root: '/Users/you/projects/repo', display: '~/projects/repo', hasMarker: true },
  userRoots: USER_ROOTS,
  levels: [ROOT_LEVEL, SRC_LEVEL, API_LEVEL],
  effectiveCount: 3,
  generatedAt: '2026-11-03T02:03:04.000Z',
}

/** The root file with content, as the editor receives it. */
const DETAIL: InstructionFileDetail = {
  ...ROOT_AGENTS,
  content: '# 根指令\n',
  sha1: 'sha1-root',
}

/**
 * Render the pure list page over fixture props.
 * @param overrides - props to replace.
 * @returns the static markup.
 */
function renderPage(overrides: Partial<AgentInstructionsPageProps> = {}): string {
  return renderToStaticMarkup(React.createElement(AgentInstructionsPage, {
    state: STATE,
    onRefresh: () => {},
    refreshing: false,
    updatedAt: null,
    staleFailure: null,
    openFailure: null,
    onPreview: () => {},
    onOpenFile: () => {},
    loadingFileId: null,
    preview: null,
    previewDetail: null,
    previewLoading: false,
    previewFailure: null,
    ...overrides,
  }))
}

/**
 * Render the pure editor page over fixture props.
 * @param overrides - props to replace.
 * @returns the static markup.
 */
function renderEditor(overrides: Partial<InstructionEditorPageProps> = {}): string {
  return renderToStaticMarkup(React.createElement(InstructionEditorPage, {
    file: DETAIL,
    content: DETAIL.content,
    onChange: () => {},
    saving: false,
    savedAt: null,
    failure: null,
    conflict: false,
    onReload: () => {},
    onBack: () => {},
    onSave: () => {},
    onDelete: () => {},
    onRevert: () => {},
    dirty: false,
    creating: false,
    ...overrides,
  }))
}

/**
 * Copy one candidate without any content-bearing fields.
 * @param file - the candidate to strip.
 * @returns the same candidate as a missing file.
 */
function asMissing(file: InstructionFileSummary): InstructionFileSummary {
  return {
    id: file.id,
    scope: file.scope,
    levelId: file.levelId,
    name: file.name,
    variant: file.variant,
    displayPath: file.displayPath,
    absolutePath: file.absolutePath,
    exists: false,
    size: null,
    modifiedAt: null,
  }
}

/**
 * Build one response-shaped object for the fetch stub.
 * @param status - HTTP status the route reports.
 * @param text - response body text.
 * @returns the object the runtime reads.
 */
function textResponse(status: number, text: string): Response {
  return { status, text: async () => text } as unknown as Response
}

/**
 * Build one JSON response-shaped object for the fetch stub.
 * @param status - HTTP status the route reports.
 * @param body - value serialized as the body.
 * @returns the object the runtime reads.
 */
function jsonResponse(status: number, body: unknown): Response {
  return textResponse(status, JSON.stringify(body))
}

/** Restore the global fetch after every runtime test. */
afterEach(() => {
  vi.unstubAllGlobals()
})

describe('Agent instructions list page', () => {
  it('renders both scopes, the chain context, and one card per directory', () => {
    const markup = renderPage()
    expect(markup).toContain('指令')
    expect(markup).toContain('用户级')
    expect(markup).toContain('项目级')
    expect(markup).toContain('对所有项目生效；两处内容相同时只注入一份。')
    expect(markup).toContain('从项目根到会话目录逐层读取')
    expect(markup).toContain('会话目录')
    expect(markup).toContain('~/projects/repo/src/api')
    expect(markup).toContain('项目根')
    expect(markup).toContain('~/projects/repo</span>')
    expect(markup).toContain('ai-contextBar')
    expect(markup).toContain('注入顺序：')
    expect(markup).toContain('项目根 → src → src/api')
    expect(markup).toContain('>项目根</span>')
    expect(markup).toContain('>src</span>')
    expect(markup).toContain('>src/api</span>')
    expect(markup).toContain('~/.dsh/AGENTS.md')
    expect(markup).toContain('~/.agents/AGENTS.md')
  })

  it('marks injection order, missing candidates, overlays, and duplicates', () => {
    const markup = renderPage()
    expect(markup).toContain('生效 #1')
    expect(markup).toContain('生效 #2')
    expect(markup).toContain('生效 #3')
    expect(markup).toContain('未创建')
    expect(markup).toContain('本地覆盖')
    expect(markup).toContain('内容与 AGENTS.md 相同，不会重复注入')
    expect(markup).toContain('生效 3 个文件')
    expect(markup).toContain('900 B')
  })

  it('renders the refresh toolbar and the last update time', () => {
    const idle = renderPage({ updatedAt: '2026-11-03T02:03:04.000Z' })
    expect(idle).toContain('刷新')
    expect(idle).toContain('更新于 ')
    expect(idle).not.toContain('读取中…')

    const busy = renderPage({ refreshing: true })
    expect(busy).toContain('读取中…')
    expect(busy).toContain('disabled')
  })

  it('keeps the previous list under a stale-failure banner', () => {
    const markup = renderPage({ staleFailure: '指令读取失败：Host 返回了 HTTP 500' })
    expect(markup).toContain('本次刷新失败，下面仍是上一次读到的结果。')
    expect(markup).toContain('HTTP 500')
    expect(markup).toContain('role="status"')
    expect(markup).toContain('~/.dsh/AGENTS.md')
  })

  it('reports a failed open as its own error, not a stale refresh', () => {
    const markup = renderPage({ openFailure: '打开 AGENTS.md 失败：symlink-not-allowed: 拒绝操作符号链接' })
    expect(markup).toContain('打开指令文件失败。')
    expect(markup).toContain('symlink-not-allowed')
    expect(markup).toContain('role="alert"')
    expect(markup).not.toContain('本次刷新失败')
  })

  it('shows the cross-scope empty hint when nothing exists anywhere', () => {
    const empty: AgentInstructionsState = {
      ...STATE,
      userRoots: USER_ROOTS.map(root => ({ ...root, file: asMissing(root.file) })),
      levels: STATE.levels.map(level => ({ ...level, files: level.files.map(asMissing) })),
      effectiveCount: 0,
    }
    const markup = renderPage({ state: empty })
    expect(markup).toContain('还没有任何指令文件。用户级对所有项目生效；项目级只影响这个项目。')
    expect(markup).not.toContain('生效 #1')
    expect(markup).toContain('未创建')
  })

  it('explains a missing project marker and names the single level 会话目录', () => {
    const noMarker: AgentInstructionsState = {
      ...STATE,
      project: { ...STATE.project, hasMarker: false },
      levels: [{ ...ROOT_LEVEL, title: '项目根', relativeDir: '.' }],
    }
    const markup = renderPage({ state: noMarker })
    expect(markup).toContain('没有找到 .git 项目标记，只列会话目录这一层。')
    expect(markup).toContain('class="ai-levelTitle">会话目录</span>')
    expect(markup).not.toContain('>项目根</span>')
  })

  it('disables every open action while one candidate is loading', () => {
    const markup = renderPage({ loadingFileId: USER_DSH_FILE.id })
    expect(markup).toContain('>读取中…</button>')
    expect(markup).toContain('disabled')
    expect(markup).toContain('>编辑</button>')
    expect(markup).toContain('>新建</button>')
  })
})

describe('Agent instructions preview pane', () => {
  it('renders the master-detail split with a placeholder before a selection', () => {
    const markup = renderPage()
    expect(markup).toContain('class="ai-split"')
    expect(markup).toContain('aria-label="指令预览"')
    expect(markup).toContain('点击左侧文件，在这里预览内容。')
    expect(markup).toContain('预览是只读的；需要修改时点「编辑」。')
    expect(markup).not.toContain('class="ai-previewCard"')
  })

  it('previews a clicked file as read-only text with its injection chips', () => {
    const detail: InstructionFileDetail = {
      ...USER_DSH_FILE,
      content: '# 用户指令\n\n- 第一条\n',
      sha1: 'sha1-user',
    }
    const markup = renderPage({ preview: USER_DSH_FILE, previewDetail: detail })
    expect(markup).toContain('class="ai-previewCard"')
    expect(markup).toContain('class="ai-previewBody"')
    expect(markup).toContain('# 用户指令')
    expect(markup).toContain('生效 #1')
    expect(markup).toContain('~/.dsh/AGENTS.md')
    // The previewed row is the one highlighted, and the action still edits.
    expect(markup.match(/data-active="true"/g)).toHaveLength(1)
    expect(markup).toContain('>编辑</button>')
    expect(markup).not.toContain('<textarea')
  })

  it('offers the create affordance for a missing candidate', () => {
    const markup = renderPage({ preview: USER_AGENTS_FILE })
    expect(markup).toContain('尚未创建。点「新建」创建这个文件。')
    expect(markup).toContain('>新建</button>')
    expect(markup.match(/data-active="true"/g)).toHaveLength(1)
  })

  it('renders the empty-file copy inside the preview body', () => {
    const detail: InstructionFileDetail = { ...USER_DSH_FILE, content: '', sha1: 'empty' }
    const markup = renderPage({ preview: USER_DSH_FILE, previewDetail: detail })
    expect(markup).toContain('（空文件）')
  })

  it('reports preview loading and preview read failures distinctly', () => {
    const loading = renderPage({ preview: USER_DSH_FILE, previewLoading: true })
    expect(loading).toContain('class="ai-previewLoading"')
    expect(loading).toContain('正在读取…')

    const failed = renderPage({
      preview: USER_DSH_FILE,
      previewFailure: 'symlink-not-allowed: 拒绝操作符号链接',
    })
    expect(failed).toContain('预览读取失败：')
    expect(failed).toContain('symlink-not-allowed')
    expect(failed).toContain('role="alert"')
  })
})

describe('Agent instructions editor page', () => {
  it('renders an existing file with its path, content, and actions', () => {
    const markup = renderEditor()
    const bytes = new TextEncoder().encode(DETAIL.content).byteLength
    expect(markup).toContain('← 返回列表')
    expect(markup).toContain('AGENTS.md')
    expect(markup).toContain('项目级')
    expect(markup).toContain('层级 项目根')
    expect(markup).toContain('/Users/you/projects/repo/AGENTS.md')
    expect(markup).toContain('aria-label="编辑指令文件"')
    expect(markup).toContain('spellcheck="false"')
    expect(markup).toContain('支持 Markdown；保存后会按上面的注入顺序生效。')
    expect(markup).toContain(`${bytes} B / 1 MiB`)
    expect(markup).toContain('>保存</button>')
    expect(markup).toContain('>还原</button>')
    expect(markup).toContain('>删除文件</button>')
  })

  it('renders a new file without a delete action and with saving feedback', () => {
    const markup = renderEditor({
      file: missingFile('project:src/api', 'AGENTS.md', 'src/api/AGENTS.md'),
      content: '',
      creating: true,
      saving: true,
    })
    expect(markup).toContain('>新建</span>')
    expect(markup).toContain('创建文件')
    expect(markup).toContain('保存中…')
    expect(markup).not.toContain('删除文件')
  })

  it('renders conflict, saved, and failure states together', () => {
    const markup = renderEditor({
      conflict: true,
      savedAt: '2026-11-03T02:04:05.000Z',
      failure: 'write-failed: 磁盘只读',
    })
    expect(markup).toContain('文件已被外部修改，请重新加载后再保存。')
    expect(markup).toContain('重新加载')
    expect(markup).toContain('已保存 · ')
    expect(markup).toContain('write-failed: 磁盘只读')
    expect(markup).toContain('role="alert"')
  })
})

describe('Agent instructions container', () => {
  it('renders the loading copy before the first read settles', () => {
    const runtime: AgentInstructionsRuntime = {
      loadState: async () => STATE,
      loadFile: async () => DETAIL,
      saveFile: async () => DETAIL,
      deleteFile: async () => {},
    }
    const Tab = createAgentInstructionsTab(runtime)
    const markup = renderToStaticMarkup(React.createElement(Tab, { sessionId: 'session-1234' }))
    expect(markup).toContain('正在读取指令文件…')
  })
})

describe('AgentInstructionsRuntime', () => {
  it('reads the state with a same-origin no-store GET and parses the envelope', async () => {
    const fetchMock = vi.fn(async () => jsonResponse(200, {
      ok: true,
      state: JSON.parse(JSON.stringify(STATE)) as unknown,
    }))
    vi.stubGlobal('fetch', fetchMock)
    const runtime = createAgentInstructionsRuntime({} as Context)
    const signal = new AbortController().signal

    const state = await runtime.loadState('session-1234', signal)

    expect(state.project.display).toBe('~/projects/repo')
    expect(state.effectiveCount).toBe(3)
    expect(state.levels.map(level => level.title)).toEqual(['项目根', 'src', 'src/api'])
    const calls = fetchMock.mock.calls as unknown as [string, RequestInit][]
    const call = calls[0]
    expect(call?.[0]).toBe('/plugin-agent-instructions/state?sessionId=session-1234')
    expect(call?.[1]).toMatchObject({ method: 'GET', cache: 'no-store' })
    expect(call?.[1]?.signal).toBe(signal)
  })

  it('propagates the Host failure code and reports an empty body', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(jsonResponse(404, {
        ok: false,
        error: { code: 'session-not-found', message: '会话不存在' },
      }))
      .mockResolvedValueOnce(textResponse(500, ''))
    vi.stubGlobal('fetch', fetchMock)
    const runtime = createAgentInstructionsRuntime({} as Context)
    const signal = new AbortController().signal

    await expect(runtime.loadState('missing', signal))
      .rejects.toThrow('session-not-found: 会话不存在')
    await expect(runtime.loadState('missing', signal))
      .rejects.toThrow('Host 没有返回指令数据（HTTP 500）')
  })

  it('reads one file by encoded id and parses its content', async () => {
    const fetchMock = vi.fn(async () => jsonResponse(200, {
      ok: true,
      file: JSON.parse(JSON.stringify(DETAIL)) as unknown,
    }))
    vi.stubGlobal('fetch', fetchMock)
    const runtime = createAgentInstructionsRuntime({} as Context)
    const signal = new AbortController().signal

    const file = await runtime.loadFile('session-1234', SRC_AGENTS_LOCAL.id, signal)

    expect(file.content).toBe('# 根指令\n')
    expect(file.sha1).toBe('sha1-root')
    const calls = fetchMock.mock.calls as unknown as [string, RequestInit][]
    const call = calls[0]
    expect(decodeURIComponent(String(call?.[0])))
      .toBe('/plugin-agent-instructions/file?sessionId=session-1234&id=project:src/AGENTS.local.md')
    expect(call?.[1]).toMatchObject({ method: 'GET', cache: 'no-store' })
    expect(call?.[1]?.signal).toBe(signal)
  })

  it('writes a file with the expected digest and parses the written body', async () => {
    const next = { ...DETAIL, content: '# 新内容\n', sha1: 'sha1-next' }
    const fetchMock = vi.fn(async () => jsonResponse(200, {
      ok: true,
      file: JSON.parse(JSON.stringify(next)) as unknown,
    }))
    vi.stubGlobal('fetch', fetchMock)
    const runtime = createAgentInstructionsRuntime({} as Context)
    const signal = new AbortController().signal

    const file = await runtime.saveFile({
      sessionId: 'session-1234',
      id: DETAIL.id,
      content: '# 新内容\n',
      expectedSha1: 'sha1-root',
    }, signal)

    expect(file.content).toBe('# 新内容\n')
    expect(file.sha1).toBe('sha1-next')
    const calls = fetchMock.mock.calls as unknown as [string, RequestInit][]
    const call = calls[0]
    expect(call?.[0]).toBe('/plugin-agent-instructions/save')
    expect(call?.[1]).toMatchObject({ method: 'POST', cache: 'no-store' })
    expect(call?.[1]?.headers).toEqual({ 'Content-Type': 'application/json' })
    expect(JSON.parse(String(call?.[1]?.body))).toEqual({
      sessionId: 'session-1234',
      id: DETAIL.id,
      content: '# 新内容\n',
      expectedSha1: 'sha1-root',
    })
  })

  it('surfaces a save conflict with the model code prefix', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse(409, {
      ok: false,
      error: { code: 'conflict', message: '文件已被修改' },
    })))
    const runtime = createAgentInstructionsRuntime({} as Context)

    await expect(runtime.saveFile({ sessionId: 'session-1234', id: DETAIL.id, content: 'x' },
      new AbortController().signal))
      .rejects.toThrow('conflict: 文件已被修改')
  })

  it('posts a delete request and propagates a delete failure', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(jsonResponse(200, { ok: true }))
      .mockResolvedValueOnce(jsonResponse(500, {
        ok: false,
        error: { code: 'delete-failed', message: '磁盘只读' },
      }))
    vi.stubGlobal('fetch', fetchMock)
    const runtime = createAgentInstructionsRuntime({} as Context)
    const signal = new AbortController().signal

    await expect(runtime.deleteFile({ sessionId: 'session-1234', id: DETAIL.id }, signal))
      .resolves.toBeUndefined()
    const calls = fetchMock.mock.calls as unknown as [string, RequestInit][]
    const call = calls[0]
    expect(call?.[0]).toBe('/plugin-agent-instructions/delete')
    expect(call?.[1]).toMatchObject({ method: 'POST', cache: 'no-store' })
    expect(JSON.parse(String(call?.[1]?.body))).toEqual({ sessionId: 'session-1234', id: DETAIL.id })

    await expect(runtime.deleteFile({ sessionId: 'session-1234', id: DETAIL.id }, signal))
      .rejects.toThrow('delete-failed: 磁盘只读')
  })
})
