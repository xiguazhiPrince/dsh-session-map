/**
 * Browser half of the Agent instructions (AGENTS.md) tab.
 *
 * The tab answers two questions the Session canvas cannot: which instruction
 * files the product actually injects for this Session, and in what order. It
 * does not rediscover anything. The Host half resolves the user roots, the
 * project chain, and the per-directory candidates; `./model` owns the wire
 * vocabulary and the ordering rules. This module turns that assembled state
 * into a list page — user-global roots first, then one card per project
 * directory from the project root down to the session cwd — and opens one
 * candidate at a time in an editor.
 *
 * The editor is deliberately conservative about external edits: it saves with
 * the SHA-1 it loaded, and a Host `conflict` answer becomes a warning that keeps
 * the draft instead of discarding it.
 *
 * @module dsh-session-map/agent-instructions/client
 */
import type { Context } from '@deepseek-ai/cordis'
import * as React from 'react'
import { errorText } from '../session-map/format'
import {
  AGENT_INSTRUCTIONS_ROUTE,
  INSTRUCTION_FILE_MAX_BYTES,
  allInstructionFiles,
  checkDeleteEnvelope,
  fileFromEnvelope,
  findInstructionFile,
  formatInstructionBytes,
  stateFromEnvelope,
  writeFromEnvelope,
  type AgentInstructionsState,
  type DeleteEnvelope,
  type DeleteInstructionRequest,
  type FileEnvelope,
  type InstructionFileDetail,
  type InstructionFileSummary,
  type InstructionLevel,
  type SaveInstructionRequest,
  type StateEnvelope,
  type UserRootView,
  type WriteEnvelope,
} from './model'

/** Fixed UI copy; the plugin is Chinese-first like its other seats. */
const COPY = {
  title: '指令',
  description: 'AGENTS.md 会按「用户级 → 项目根 → 当前目录」的顺序注入；越靠下的文件越具体，会覆盖上面同主题的说明。',
  refresh: '刷新',
  refreshing: '读取中…',
  loading: '正在读取指令文件…',
  retry: '重试',
  updatedPrefix: '更新于 ',
  contextCwd: '会话目录',
  contextProject: '项目根',
  noMarker: '没有找到 .git 项目标记，只列会话目录这一层。',
  userSection: '用户级',
  userHint: '对所有项目生效；两处内容相同时只注入一份。',
  projectSection: '项目级',
  projectHint: '从项目根到会话目录逐层读取；同一目录内先读 AGENTS.md / CLAUDE.md，再读 .local.md 覆盖文件。',
  effectivePrefix: '生效 ',
  effectiveSuffix: ' 个文件',
  empty: '还没有任何指令文件。用户级对所有项目生效；项目级只影响这个项目。',
  staleFailure: '本次刷新失败，下面仍是上一次读到的结果。',
  openFailure: '打开指令文件失败。',
  previewTitle: '预览',
  previewLabel: '指令预览',
  previewEmpty: '点击左侧文件，在这里预览内容。',
  previewEmptyHint: '预览是只读的；需要修改时点「编辑」。',
  previewLoading: '正在读取…',
  previewMissing: '尚未创建。点「新建」创建这个文件。',
  previewEmptyFile: '（空文件）',
  previewFailurePrefix: '预览读取失败：',
  chainPrefix: '注入顺序：',
  chainSeparator: ' → ',
  noMarkerTitle: '会话目录',
  projectRoot: '项目根',
  local: '本地覆盖',
  missing: '未创建',
  notCreatedMeta: '尚未创建',
  tooLarge: '超过 1 MiB，未注入',
  unreadable: '无法读取',
  edit: '编辑',
  create: '新建',
  reading: '读取中…',
  back: '← 返回列表',
  save: '保存',
  saving: '保存中…',
  revert: '还原',
  delete: '删除文件',
  editorLabel: '编辑指令文件',
  editorPlaceholder: '支持 Markdown；保存后会按上面的注入顺序生效。',
  editorNote: '创建文件 · 保存后会出现在注入顺序里。',
  savedPrefix: '已保存 · ',
  conflict: '文件已被外部修改，请重新加载后再保存。',
  reload: '重新加载',
} as const

/** Everything the tab needs from its Host. */
export interface AgentInstructionsRuntime {
  /**
   * Read the assembled instruction state of one Session.
   * @param sessionId - the Session being read.
   * @param signal - caller lifetime; the abort releases the request.
   * @returns the assembled state.
   */
  loadState(sessionId: string, signal: AbortSignal): Promise<AgentInstructionsState>
  /**
   * Read one instruction file for the editor.
   * @param sessionId - the Session the chain belongs to.
   * @param id - candidate identity from the state read.
   * @param signal - caller lifetime; the abort releases the request.
   * @returns the summary plus content and SHA-1.
   */
  loadFile(sessionId: string, id: string, signal: AbortSignal): Promise<InstructionFileDetail>
  /**
   * Write one instruction file.
   * @param request - Session, candidate identity, content, and expected digest.
   * @param signal - caller lifetime; the abort releases the request.
   * @returns the written file.
   */
  saveFile(request: SaveInstructionRequest, signal: AbortSignal): Promise<InstructionFileDetail>
  /**
   * Delete one instruction file.
   * @param request - Session and candidate identity.
   * @param signal - caller lifetime; the abort releases the request.
   */
  deleteFile(request: DeleteInstructionRequest, signal: AbortSignal): Promise<void>
}

/** One Host request description; the route decides method and body. */
interface HostRequest {
  /** HTTP method the route expects. */
  readonly method: 'GET' | 'POST'
  /** JSON body, serialized by the request itself. */
  readonly body?: unknown
}

/**
 * Absolute request URL on the page's own origin.
 *
 * The same string is used under the server renderer and in tests, where no
 * `document` exists, so the relative path is the fallback.
 * @param path - route path beginning with `/`.
 * @returns the absolute URL in a browser page, the path otherwise.
 */
function routeUrl(path: string): string {
  const base = typeof document === 'undefined' ? undefined : document.baseURI
  return base === undefined ? path : new URL(path, base).toString()
}

/** Whether an unknown thrown value is an abort of a caller-owned request. */
function isAbortError(error: unknown): boolean {
  return typeof error === 'object' && error !== null && (error as { readonly name?: unknown }).name === 'AbortError'
}

/**
 * Whether one request ended because its caller cancelled it.
 * @param signal - the caller's signal.
 * @param error - the thrown value, if any.
 * @returns true for an explicit abort signal or an `AbortError`.
 */
function aborted(signal: AbortSignal, error: unknown): boolean {
  return signal.aborted || isAbortError(error)
}

/**
 * Untyped body to one envelope type after a shape guard.
 *
 * The model's parsers validate every field they read; this guard only keeps a
 * JSON scalar from crashing the parser with a property access.
 * @param body - parsed response body.
 * @returns the body as the requested envelope.
 * @throws Error when the body is not an object.
 */
function envelopeOf<T>(body: unknown): T {
  if (typeof body !== 'object' || body === null) {
    throw new Error('Host 返回的指令数据格式不正确')
  }
  return body as T
}

/**
 * Fetch one Host route and decode its JSON body.
 *
 * An empty body is a Host that answered without data; a body that is not JSON
 * is a broken route, and both carry the status so the failure is diagnosable.
 * An abort is rethrown untouched — it is the caller's own cancellation, never a
 * Host failure — and callers check `signal.aborted`.
 * @param path - route path beginning with `/`.
 * @param request - method and optional JSON body.
 * @param signal - caller lifetime.
 * @returns the parsed JSON value.
 */
async function requestHost(path: string, request: HostRequest, signal: AbortSignal): Promise<unknown> {
  try {
    const init: RequestInit = { method: request.method, cache: 'no-store', signal }
    if (request.method === 'POST') {
      init.headers = { 'Content-Type': 'application/json' }
      if (request.body !== undefined) init.body = JSON.stringify(request.body)
    }
    const response = await fetch(routeUrl(path), init)
    const text = await response.text()
    if (text === '') {
      throw new Error(`Host 没有返回指令数据（HTTP ${response.status}）`)
    }
    try {
      return JSON.parse(text) as unknown
    } catch {
      throw new Error(`Host 返回了无法解析的响应（HTTP ${response.status}）`)
    }
  } catch (error) {
    if (aborted(signal, error)) throw error
    throw error instanceof Error ? error : new Error(String(error))
  }
}

/**
 * Build the tab runtime over the running page.
 *
 * `ctx` is unused on purpose: the Host exposes one same-origin HTTP route and
 * the browser needs no service lookup, exactly like `createSkillCatalogRuntime`.
 * @param _ctx - browser root context.
 * @returns the runtime the Conversation tab calls.
 */
export function createAgentInstructionsRuntime(_ctx: Context): AgentInstructionsRuntime {
  return {
    async loadState(sessionId: string, signal: AbortSignal): Promise<AgentInstructionsState> {
      const query = new URLSearchParams({ sessionId })
      const body = await requestHost(
        `${AGENT_INSTRUCTIONS_ROUTE}/state?${query.toString()}`,
        { method: 'GET' },
        signal,
      )
      return stateFromEnvelope(envelopeOf<StateEnvelope>(body))
    },
    async loadFile(sessionId: string, id: string, signal: AbortSignal): Promise<InstructionFileDetail> {
      const query = new URLSearchParams({ sessionId, id })
      const body = await requestHost(
        `${AGENT_INSTRUCTIONS_ROUTE}/file?${query.toString()}`,
        { method: 'GET' },
        signal,
      )
      return fileFromEnvelope(envelopeOf<FileEnvelope>(body))
    },
    async saveFile(request: SaveInstructionRequest, signal: AbortSignal): Promise<InstructionFileDetail> {
      const body = await requestHost(
        `${AGENT_INSTRUCTIONS_ROUTE}/save`,
        { method: 'POST', body: request },
        signal,
      )
      return writeFromEnvelope(envelopeOf<WriteEnvelope>(body))
    },
    async deleteFile(request: DeleteInstructionRequest, signal: AbortSignal): Promise<void> {
      const body = await requestHost(
        `${AGENT_INSTRUCTIONS_ROUTE}/delete`,
        { method: 'POST', body: request },
        signal,
      )
      checkDeleteEnvelope(envelopeOf<DeleteEnvelope>(body))
    },
  }
}

/**
 * Format one ISO timestamp as a local wall-clock time.
 * @param iso - ISO timestamp, or `null`.
 * @returns `HH:mm:ss` in the local zone, or `null` when unknown or invalid.
 */
function formatClock(iso: string | null): string | null {
  if (iso === null) return null
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return null
  return date.toLocaleTimeString('zh-CN', { hour12: false })
}

/**
 * Format one ISO timestamp as a local date and time.
 *
 * A modification time is shown on its own only when the day is known to be
 * today, which the wire does not say; the full local moment avoids the guess.
 * @param iso - ISO timestamp, or `null`.
 * @returns the local moment, or `null` when unknown or invalid.
 */
function formatMoment(iso: string | null): string | null {
  if (iso === null) return null
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return null
  return date.toLocaleString('zh-CN', { hour12: false })
}

/**
 * One small status chip.
 * @param key - React key, stable within its row.
 * @param text - chip text.
 * @param tone - optional emphasis.
 * @returns the chip element.
 */
function chip(key: string, text: string, tone?: 'warn' | 'muted'): React.ReactElement {
  return React.createElement(
    'span',
    { key, className: tone === undefined ? 'ai-chip' : `ai-chip ai-chip--${tone}` },
    text,
  )
}

/**
 * The project-chain directory a candidate belongs to, for the editor header.
 * @param file - candidate being edited.
 * @returns `项目根` or the root-relative directory, and `null` for user roots.
 */
function levelLabelOf(file: InstructionFileSummary): string | null {
  if (file.scope !== 'project') return null
  const relative = file.levelId.startsWith('project:')
    ? file.levelId.slice('project:'.length)
    : file.levelId
  return relative === '' || relative === '.' ? COPY.projectRoot : relative
}

/**
 * Every chip one file row shows: overlay, injection order, absence, duplicate
 * suppression, and why an existing file was skipped.
 * @param file - the candidate to describe.
 * @returns the chip elements in reading order.
 */
function fileChips(file: InstructionFileSummary): React.ReactElement[] {
  const chips: React.ReactElement[] = []
  if (file.variant === 'local') chips.push(chip('local', COPY.local, 'warn'))
  if (file.order !== undefined) chips.push(chip('order', `生效 #${file.order}`))
  if (!file.exists) chips.push(chip('missing', COPY.missing, 'muted'))
  if (file.duplicateOf !== undefined) {
    chips.push(chip('duplicate', `内容与 ${file.duplicateOf} 相同，不会重复注入`, 'muted'))
  }
  if (file.skipped === 'too-large') chips.push(chip('skipped', COPY.tooLarge, 'warn'))
  if (file.skipped === 'unreadable') chips.push(chip('skipped', COPY.unreadable, 'warn'))
  return chips
}

/** Props of one file row. */
interface InstructionFileRowProps {
  /** Candidate to render. */
  readonly file: InstructionFileSummary
  /** Candidate currently being read for the editor, if any. */
  readonly loadingFileId: string | null
  /** Candidate currently shown in the preview pane, if any. */
  readonly activeFileId: string | null
  /** Show this candidate in the read-only preview pane. */
  readonly onPreview: (file: InstructionFileSummary) => void
  /** Open this candidate in the editor; `exists` decides between edit and create. */
  readonly onOpenFile: (file: InstructionFileSummary, exists: boolean) => void
}

/**
 * One candidate row: the row body previews, the trailing action edits.
 *
 * The master-detail split follows the classic list/detail pattern: the body is
 * a real button so a click and Enter/Space both select the file for preview,
 * while the action stays a separate button so editing never accidentally
 * replaces the preview. The selected row carries `data-active`, which is also
 * the style hook for the highlight. Missing files stay visible so a new file
 * has an obvious place to be created.
 * @param props - the candidate, selection, and the preview/open callbacks.
 * @returns the row element.
 */
function InstructionFileRow(props: InstructionFileRowProps): React.ReactElement {
  const { file, loadingFileId, activeFileId, onPreview, onOpenFile } = props
  const busy = loadingFileId === file.id
  const active = activeFileId === file.id
  const meta = file.exists
    ? `${formatInstructionBytes(file.size)} · ${formatMoment(file.modifiedAt) ?? '—'}`
    : COPY.notCreatedMeta
  return React.createElement(
    'div',
    {
      className: file.exists ? 'ai-file' : 'ai-file ai-file--missing',
      'data-active': active ? 'true' : 'false',
    },
    React.createElement(
      'button',
      {
        type: 'button',
        className: 'ai-fileMain',
        'aria-pressed': active,
        title: `${file.displayPath} · ${COPY.previewTitle}`,
        onClick: () => { onPreview(file) },
      },
      React.createElement(
        'span',
        { className: 'ai-fileHead' },
        React.createElement('span', { className: 'ai-fileName' }, file.name),
        ...fileChips(file),
      ),
      React.createElement('span', { className: 'ai-fileMeta' }, meta),
      React.createElement('span', { className: 'ai-filePath', title: file.absolutePath }, file.displayPath),
    ),
    React.createElement(
      'button',
      {
        type: 'button',
        className: 'ai-fileAction',
        onClick: () => { onOpenFile(file, file.exists) },
        disabled: loadingFileId !== null,
      },
      busy ? COPY.reading : file.exists ? COPY.edit : COPY.create,
    ),
  )
}

/** Props of one hierarchy card. */
interface InstructionLevelCardProps {
  /** Level to render, already in broad-to-specific order. */
  readonly level: InstructionLevel
  /** 1-based position in the chain. */
  readonly index: number
  /** Whether the Host found a `.git` marker, which names the root card. */
  readonly hasMarker: boolean
  /** Candidate currently being read for the editor, if any. */
  readonly loadingFileId: string | null
  /** Candidate currently shown in the preview pane, if any. */
  readonly activeFileId: string | null
  /** Show one candidate of this level in the preview pane. */
  readonly onPreview: (file: InstructionFileSummary) => void
  /** Open one candidate of this level in the editor. */
  readonly onOpenFile: (file: InstructionFileSummary, exists: boolean) => void
}

/**
 * One project directory card: its hierarchy position, absolute path, and all
 * four candidate rows.
 * @param props - the level, its position, and the preview/open callbacks.
 * @returns the card element.
 */
function InstructionLevelCard(props: InstructionLevelCardProps): React.ReactElement {
  const { level, index, hasMarker, loadingFileId, activeFileId, onPreview, onOpenFile } = props
  const title = hasMarker ? level.title : COPY.noMarkerTitle
  return React.createElement(
    'div',
    { className: 'ai-level' },
    React.createElement(
      'div',
      { className: 'ai-levelHead' },
      React.createElement('span', { className: 'ai-levelTitle' }, title),
      React.createElement('span', { className: 'ai-levelDepth' }, `第 ${index + 1} 层`),
      React.createElement('span', { className: 'ai-levelPath', title: level.absolutePath }, level.absolutePath),
    ),
    React.createElement(
      'div',
      { className: 'ai-levelFiles' },
      ...level.files.map(file => React.createElement(InstructionFileRow, {
        key: file.id,
        file,
        loadingFileId,
        activeFileId,
        onPreview,
        onOpenFile,
      })),
    ),
  )
}

/** Props of one user-global root block. */
interface UserRootBlockProps {
  /** Root and its single `AGENTS.md` candidate. */
  readonly root: UserRootView
  /** Candidate currently being read for the editor, if any. */
  readonly loadingFileId: string | null
  /** Candidate currently shown in the preview pane, if any. */
  readonly activeFileId: string | null
  /** Show the root's candidate in the preview pane. */
  readonly onPreview: (file: InstructionFileSummary) => void
  /** Open the root's candidate in the editor. */
  readonly onOpenFile: (file: InstructionFileSummary, exists: boolean) => void
}

/**
 * One user-global root: its symbolic location plus the candidate row.
 * @param props - the root and the preview/open callbacks.
 * @returns the block element.
 */
function UserRootBlock(props: UserRootBlockProps): React.ReactElement {
  const { root, loadingFileId, activeFileId, onPreview, onOpenFile } = props
  return React.createElement(
    'div',
    { className: 'ai-rootBlock' },
    React.createElement(
      'div',
      { className: 'ai-rootHead' },
      React.createElement('span', { className: 'ai-rootTitle' }, root.title),
      React.createElement('span', { className: 'ai-rootPath', title: root.home }, root.home),
    ),
    React.createElement(InstructionFileRow, {
      file: root.file,
      loadingFileId,
      activeFileId,
      onPreview,
      onOpenFile,
    }),
  )
}

/**
 * One section header: title, optional count, hint, and an optional trailing
 * summary.
 * @param title - section title.
 * @param hint - one-line explanation under the title.
 * @param count - existing-file count, or `null` to omit.
 * @param extra - trailing node, such as the effective-count line.
 * @returns the header element.
 */
function sectionHead(
  title: string,
  hint: string,
  count: number | null,
  extra?: React.ReactNode,
): React.ReactElement {
  return React.createElement(
    'div',
    { className: 'ai-sectionHead' },
    React.createElement('h2', { className: 'ai-sectionTitle' }, title),
    count === null ? null : React.createElement('span', { className: 'ai-count' }, String(count)),
    React.createElement('span', { className: 'ai-sectionHint' }, hint),
    extra === undefined ? null : extra,
  )
}

/** Props of the read-only preview pane. */
export interface InstructionPreviewProps {
  /** Candidate selected on the left, or `null` before the first selection. */
  readonly file: InstructionFileSummary | null
  /** Loaded body of the selected file, when it exists and has been read. */
  readonly detail: InstructionFileDetail | null
  /** Whether the selected body is being read. */
  readonly loading: boolean
  /** Failure of the last preview read. */
  readonly failure: string | null
  /** Candidate currently being read for the editor, which disables the action. */
  readonly loadingFileId: string | null
  /** Open the previewed candidate in the editor. */
  readonly onOpenFile: (file: InstructionFileSummary, exists: boolean) => void
}

/**
 * The right-hand preview column: a read-only rendering of the clicked file.
 *
 * This is the detail half of the master-detail split. It never edits: the only
 * action hands the file to the existing editor page, so the preview stays a
 * cheap "what does the model actually read here" answer, and the four classic
 * empty states (no selection, absent file, loading, failed read) all say what
 * to do next instead of rendering a blank pane.
 * @param props - selected candidate, its loaded body, and the open action.
 * @returns the preview pane element.
 */
export function InstructionPreview(props: InstructionPreviewProps): React.ReactElement {
  const { file, detail, loading, failure, loadingFileId, onOpenFile } = props
  if (file === null) {
    return React.createElement(
      'div',
      { className: 'ai-previewEmpty' },
      React.createElement('div', { className: 'ai-previewEmptyTitle' }, COPY.previewEmpty),
      React.createElement('div', { className: 'ai-previewEmptyHint' }, COPY.previewEmptyHint),
    )
  }
  const busy = loadingFileId === file.id
  const body = loading
    ? React.createElement('div', { className: 'ai-previewLoading', role: 'status' }, COPY.previewLoading)
    : failure !== null
      ? React.createElement(
        'div',
        { className: 'ai-status ai-status--error', role: 'alert' },
        React.createElement('div', { className: 'ai-statusTitle' }, COPY.previewFailurePrefix),
        React.createElement('div', { className: 'ai-statusPath' }, failure),
      )
      : !file.exists
        ? React.createElement('div', { className: 'ai-previewMissing' }, COPY.previewMissing)
        : detail === null
          ? null
          : React.createElement(
            'pre',
            { className: 'ai-previewBody' },
            detail.content === '' ? COPY.previewEmptyFile : detail.content,
          )
  return React.createElement(
    'div',
    { className: 'ai-previewCard' },
    React.createElement(
      'div',
      { className: 'ai-previewHead' },
      React.createElement('span', { className: 'ai-previewName' }, file.name),
      ...fileChips(file),
      React.createElement(
        'button',
        {
          type: 'button',
          className: 'ai-fileAction ai-previewAction',
          onClick: () => { onOpenFile(file, file.exists) },
          disabled: loadingFileId !== null,
        },
        busy ? COPY.reading : file.exists ? COPY.edit : COPY.create,
      ),
    ),
    React.createElement('div', { className: 'ai-previewPath', title: file.absolutePath }, file.displayPath),
    React.createElement('div', { className: 'ai-previewContent' }, body),
  )
}

/** Props of the pure list page. */
export interface AgentInstructionsPageProps {
  /** Successfully read instruction state. */
  readonly state: AgentInstructionsState
  /** Ask the Host for a fresh read. */
  readonly onRefresh: () => void
  /** Whether a read is in flight. */
  readonly refreshing: boolean
  /** ISO time of the last successful read, when known. */
  readonly updatedAt: string | null
  /** Failure of the last read when an older list is still shown. */
  readonly staleFailure: string | null
  /** Failure of the last attempt to open one candidate in the editor. */
  readonly openFailure: string | null
  /** Show one candidate in the read-only preview pane. */
  readonly onPreview: (file: InstructionFileSummary) => void
  /** Open one candidate; `exists` decides between the editor and a new file. */
  readonly onOpenFile: (file: InstructionFileSummary, exists: boolean) => void
  /** Candidate currently being read for the editor, if any. */
  readonly loadingFileId: string | null
  /** Candidate currently shown in the preview pane, if any. */
  readonly preview: InstructionFileSummary | null
  /** Loaded body of the previewed candidate. */
  readonly previewDetail: InstructionFileDetail | null
  /** Whether the previewed body is being read. */
  readonly previewLoading: boolean
  /** Failure of the last preview read. */
  readonly previewFailure: string | null
}

/**
 * The list page: header, refresh toolbar, chain context, the user-global
 * section, and the project chain from the project root down to the cwd.
 * @param props - assembled state and refresh/open state.
 * @returns the page element.
 */
export function AgentInstructionsPage(props: AgentInstructionsPageProps): React.ReactElement {
  const {
    state,
    onRefresh,
    refreshing,
    updatedAt,
    staleFailure,
    openFailure,
    onPreview,
    onOpenFile,
    loadingFileId,
    preview,
    previewDetail,
    previewLoading,
    previewFailure,
  } = props
  const updated = formatClock(updatedAt)
  const chainTitles = state.levels.map(level => state.project.hasMarker ? level.title : COPY.noMarkerTitle)
  const hasAnyFile = allInstructionFiles(state).some(file => file.exists)
  const existingUserFiles = state.userRoots.filter(root => root.file.exists).length
  const activeFileId = preview?.id ?? null
  return React.createElement(
    'div',
    { className: 'ai-page' },
    React.createElement('style', null, AGENT_INSTRUCTIONS_CSS),
    React.createElement(
      'div',
      { className: 'ai-inner' },
      React.createElement(
        'div',
        { className: 'ai-headRow' },
        React.createElement(
          'header',
          { className: 'ai-head' },
          React.createElement('h1', { className: 'ai-title' }, COPY.title),
          React.createElement('p', { className: 'ai-desc' }, COPY.description),
        ),
        React.createElement(
          'div',
          { className: 'ai-toolbar' },
          React.createElement(
            'button',
            { type: 'button', className: 'ai-btn', onClick: onRefresh, disabled: refreshing },
            refreshing ? COPY.refreshing : COPY.refresh,
          ),
          updated === null
            ? null
            : React.createElement('span', { className: 'ai-updated' }, COPY.updatedPrefix + updated),
        ),
      ),
      React.createElement(
        'div',
        { className: 'ai-contextBar' },
        React.createElement(
          'span',
          { className: 'ai-contextItem' },
          COPY.contextCwd,
          React.createElement('span', { className: 'ai-contextPath' }, state.cwdDisplay),
        ),
        React.createElement(
          'span',
          { className: 'ai-contextItem' },
          COPY.contextProject,
          React.createElement('span', { className: 'ai-contextPath' }, state.project.display),
        ),
      ),
      state.project.hasMarker
        ? null
        : React.createElement('div', { className: 'ai-hint ai-hint--warn' }, COPY.noMarker),
      staleFailure === null
        ? null
        : React.createElement(
          'div',
          { className: 'ai-status ai-status--warn', role: 'status' },
          React.createElement('div', { className: 'ai-statusTitle' }, COPY.staleFailure),
          React.createElement('div', { className: 'ai-statusPath' }, staleFailure),
        ),
      openFailure === null
        ? null
        : React.createElement(
          'div',
          { className: 'ai-status ai-status--error', role: 'alert' },
          React.createElement('div', { className: 'ai-statusTitle' }, COPY.openFailure),
          React.createElement('div', { className: 'ai-statusPath' }, openFailure),
        ),
      // The classic master-detail split: the list is the master, the read-only
      // preview is the detail. It stays side by side while there is room and
      // stacks above the list on a narrow Conversation view, so a click always
      // has somewhere to show its answer.
      React.createElement(
        'div',
        { className: 'ai-split' },
        React.createElement(
          'div',
          { className: 'ai-main' },
          hasAnyFile
            ? null
            : React.createElement('div', { className: 'ai-empty' }, COPY.empty),
          React.createElement(
            'section',
            { className: 'ai-section' },
            sectionHead(COPY.userSection, COPY.userHint, existingUserFiles),
            React.createElement(
              'div',
              { className: 'ai-userRoots' },
              ...state.userRoots.map(root => React.createElement(UserRootBlock, {
                key: root.id,
                root,
                loadingFileId,
                activeFileId,
                onPreview,
                onOpenFile,
              })),
            ),
          ),
          React.createElement(
            'section',
            { className: 'ai-section' },
            sectionHead(
              COPY.projectSection,
              COPY.projectHint,
              null,
              React.createElement(
                'span',
                { className: 'ai-summary' },
                `${COPY.effectivePrefix}${state.effectiveCount}${COPY.effectiveSuffix}`,
              ),
            ),
            state.levels.length === 0
              ? null
              : React.createElement(
                'div',
                { className: 'ai-chain' },
                React.createElement('span', { className: 'ai-chainLabel' }, COPY.chainPrefix),
                React.createElement('span', { className: 'ai-chainItems' }, chainTitles.join(COPY.chainSeparator)),
              ),
            React.createElement(
              'div',
              { className: 'ai-levels' },
              ...state.levels.map((level, index) => React.createElement(InstructionLevelCard, {
                key: level.id,
                level,
                index,
                hasMarker: state.project.hasMarker,
                loadingFileId,
                activeFileId,
                onPreview,
                onOpenFile,
              })),
            ),
          ),
        ),
        React.createElement(
          'aside',
          { className: 'ai-preview', 'aria-label': COPY.previewLabel },
          React.createElement('div', { className: 'ai-previewTitle' }, COPY.previewTitle),
          React.createElement(InstructionPreview, {
            file: preview,
            detail: previewDetail,
            loading: previewLoading,
            failure: previewFailure,
            loadingFileId,
            onOpenFile,
          }),
        ),
      ),
    ),
  )
}

/** Props of the pure editor page. */
export interface InstructionEditorPageProps {
  /** Candidate being edited; a summary while creating. */
  readonly file: InstructionFileDetail | InstructionFileSummary
  /** Controlled draft. */
  readonly content: string
  /** Replace the draft. */
  readonly onChange: (next: string) => void
  /** Whether a save is in flight. */
  readonly saving: boolean
  /** ISO time of the last successful save, when known. */
  readonly savedAt: string | null
  /** Failure of the last save or load, when known. */
  readonly failure: string | null
  /** Whether the Host rejected the save because the file changed externally. */
  readonly conflict: boolean
  /** Re-read the file after a conflict. */
  readonly onReload: () => void
  /** Return to the list, asking first when the draft is dirty. */
  readonly onBack: () => void
  /** Write the draft. */
  readonly onSave: () => void
  /** Delete the file. */
  readonly onDelete: () => void
  /** Restore the last loaded content. */
  readonly onRevert: () => void
  /** Whether the draft differs from what was loaded. */
  readonly dirty: boolean
  /** Whether the file does not exist yet. */
  readonly creating: boolean
}

/** The 1 MiB cap as it appears in the byte counter. */
const BYTE_CAP_TEXT = `${INSTRUCTION_FILE_MAX_BYTES / (1024 * 1024)} MiB`

/**
 * The editor page: hierarchy context, a controlled Markdown textarea, conflict
 * and failure banners, the byte counter, and the save/revert/delete actions.
 *
 * It is pure: every interactive prop is a callback and nothing reads `window`,
 * so the container owns confirmation dialogs and Host calls.
 * @param props - candidate, draft, and editing state.
 * @returns the page element.
 */
export function InstructionEditorPage(props: InstructionEditorPageProps): React.ReactElement {
  const {
    file,
    content,
    onChange,
    saving,
    savedAt,
    failure,
    conflict,
    onReload,
    onBack,
    onSave,
    onDelete,
    onRevert,
    dirty,
    creating,
  } = props
  const bytes = new TextEncoder().encode(content).byteLength
  const overCap = bytes > INSTRUCTION_FILE_MAX_BYTES
  const clock = formatClock(savedAt)
  const levelLabel = levelLabelOf(file)
  return React.createElement(
    'div',
    { className: 'ai-page ai-page--editor' },
    React.createElement('style', null, AGENT_INSTRUCTIONS_CSS),
    React.createElement(
      'div',
      { className: 'ai-inner' },
      React.createElement('button', { type: 'button', className: 'ai-back', onClick: onBack }, COPY.back),
      React.createElement(
        'header',
        { className: 'ai-head' },
        React.createElement('h1', { className: 'ai-title ai-title--mono' }, file.displayPath),
        React.createElement(
          'div',
          { className: 'ai-chipRow' },
          chip('scope', file.scope === 'user' ? COPY.userSection : COPY.projectSection),
          levelLabel === null ? null : chip('level', `层级 ${levelLabel}`),
          file.variant === 'local' ? chip('variant', COPY.local, 'warn') : null,
          creating ? chip('creating', COPY.create) : null,
        ),
        React.createElement('div', { className: 'ai-editorPath', title: file.absolutePath }, file.absolutePath),
        creating ? React.createElement('p', { className: 'ai-editorNote' }, COPY.editorNote) : null,
      ),
      React.createElement('textarea', {
        className: overCap ? 'ai-textarea ai-textarea--over' : 'ai-textarea',
        value: content,
        spellCheck: false,
        'aria-label': COPY.editorLabel,
        placeholder: COPY.editorPlaceholder,
        onChange: (event: React.ChangeEvent<HTMLTextAreaElement>) => { onChange(event.currentTarget.value) },
      }),
      conflict
        ? React.createElement(
          'div',
          { className: 'ai-status ai-status--warn', role: 'alert' },
          React.createElement('div', { className: 'ai-statusTitle' }, COPY.conflict),
          React.createElement(
            'div',
            { className: 'ai-statusActions' },
            React.createElement('button', { type: 'button', className: 'ai-btn', onClick: onReload }, COPY.reload),
          ),
        )
        : null,
      failure === null
        ? null
        : React.createElement(
          'div',
          { className: 'ai-status ai-status--error', role: 'alert' },
          React.createElement('div', { className: 'ai-statusTitle' }, failure),
        ),
      React.createElement(
        'div',
        { className: 'ai-editorFoot' },
        React.createElement(
          'span',
          { className: overCap ? 'ai-bytes ai-bytes--over' : 'ai-bytes' },
          `${bytes} B / ${BYTE_CAP_TEXT}`,
        ),
        clock === null
          ? null
          : React.createElement('span', { className: 'ai-saved', role: 'status' }, COPY.savedPrefix + clock),
        React.createElement(
          'div',
          { className: 'ai-editorActions' },
          React.createElement(
            'button',
            {
              type: 'button',
              className: 'ai-btn ai-btn--primary',
              onClick: onSave,
              disabled: saving || (!dirty && !creating),
            },
            saving ? COPY.saving : COPY.save,
          ),
          React.createElement(
            'button',
            { type: 'button', className: 'ai-btn', onClick: onRevert, disabled: !dirty },
            COPY.revert,
          ),
          creating
            ? null
            : React.createElement(
              'button',
              { type: 'button', className: 'ai-btn ai-btn--danger', onClick: onDelete, disabled: saving },
              COPY.delete,
            ),
        ),
      ),
    ),
  )
}

/**
 * One read-only preview selection and its loaded body.
 *
 * The four fields travel together: a selection without its body is either
 * loading or failed, and every transition (select, read, save, delete, refresh)
 * replaces the whole object, so the pane can never show a body from the
 * previously selected file.
 */
interface PreviewState {
  /** Candidate selected on the left, or `null` before the first selection. */
  readonly file: InstructionFileSummary | null
  /** Loaded body of that candidate, when it exists and has been read. */
  readonly detail: InstructionFileDetail | null
  /** Whether the body is being read. */
  readonly loading: boolean
  /** Failure of the last read. */
  readonly failure: string | null
}

/** The unselected preview; the only value that renders the placeholder. */
const EMPTY_PREVIEW: PreviewState = { file: null, detail: null, loading: false, failure: null }

/**
 * Build the Conversation tab body: fetch on mount and on Session switch, and
 * render the list or the editor depending on the current selection.
 *
 * Three controllers own the tab's requests: one for the state list, one for
 * file reads/saves/deletes, and one for the read-only preview. Switching
 * Sessions or unmounting aborts all three, and an aborted answer is dropped
 * rather than written over the next read.
 * @param runtime - Host capabilities.
 * @returns the registered View component.
 */
export function createAgentInstructionsTab(
  runtime: AgentInstructionsRuntime,
): (props: { readonly sessionId: string }) => React.ReactElement {
  function AgentInstructionsTab(props: { readonly sessionId: string }): React.ReactElement {
    const { sessionId } = props
    const [state, setState] = React.useState<AgentInstructionsState | null>(null)
    const [failure, setFailure] = React.useState<string | null>(null)
    const [staleFailure, setStaleFailure] = React.useState<string | null>(null)
    const [openFailure, setOpenFailure] = React.useState<string | null>(null)
    const [refreshing, setRefreshing] = React.useState(false)
    const [updatedAt, setUpdatedAt] = React.useState<string | null>(null)
    const [selected, setSelected] = React.useState<InstructionFileSummary | null>(null)
    const [detail, setDetail] = React.useState<InstructionFileDetail | null>(null)
    const [draft, setDraft] = React.useState('')
    const [originalSha1, setOriginalSha1] = React.useState<string | undefined>(undefined)
    const [saving, setSaving] = React.useState(false)
    const [savedAt, setSavedAt] = React.useState<string | null>(null)
    const [saveFailure, setSaveFailure] = React.useState<string | null>(null)
    const [conflict, setConflict] = React.useState(false)
    const [loadingFileId, setLoadingFileId] = React.useState<string | null>(null)
    const [creating, setCreating] = React.useState(false)
    // The preview is a separate pipeline from the editor: clicking a row must
    // never wait for, or interfere with, an edit in flight.
    const [preview, setPreview] = React.useState<PreviewState>(EMPTY_PREVIEW)
    // One list request and one file request at a time; Session switches and
    // unmounts abort both.
    const listInFlight = React.useRef<AbortController | null>(null)
    const fileInFlight = React.useRef<AbortController | null>(null)
    const previewInFlight = React.useRef<AbortController | null>(null)
    // Whether a state has ever been shown; only then does a failed read become a
    // stale-data banner instead of a page-level error.
    const hasData = React.useRef(false)

    /** Drop the selection and every editor-scoped state. */
    function clearSelection(): void {
      setSelected(null)
      setDetail(null)
      setDraft('')
      setOriginalSha1(undefined)
      setSaving(false)
      setSavedAt(null)
      setSaveFailure(null)
      setConflict(false)
      setLoadingFileId(null)
      setCreating(false)
    }

    const readState = React.useCallback(async (quiet: boolean): Promise<void> => {
      listInFlight.current?.abort()
      const controller = new AbortController()
      listInFlight.current = controller
      // A quiet refresh replaces any spinner read it interrupts, so it also
      // owns the toolbar state: otherwise the aborted read's `finally` is
      // skipped and 刷新 would stay disabled.
      setRefreshing(!quiet)
      try {
        const next = await runtime.loadState(sessionId, controller.signal)
        if (controller.signal.aborted) return
        hasData.current = true
        setState(next)
        setFailure(null)
        setStaleFailure(null)
        setOpenFailure(null)
        setUpdatedAt(new Date().toISOString())
        // A refresh can change the previewed row (order, size, duplicate, or the
        // file may have been removed outside the tab); keep the selection in
        // step without re-reading the body.
        setPreview((current) => {
          if (current.file === null) return current
          const fresh = findInstructionFile(next, current.file.id)
          return fresh === undefined ? EMPTY_PREVIEW : { ...current, file: fresh }
        })
      } catch (error) {
        if (controller.signal.aborted || isAbortError(error)) return
        const message = `指令读取失败：${errorText(error)}`
        if (hasData.current) setStaleFailure(message)
        else setFailure(message)
      } finally {
        if (listInFlight.current === controller) {
          listInFlight.current = null
          if (!quiet) setRefreshing(false)
        }
      }
    }, [runtime, sessionId])

    React.useEffect(() => {
      // A different Session gets its own read: the previous Session's chain,
      // selection, and editor state must not linger while the new one loads.
      hasData.current = false
      setState(null)
      setFailure(null)
      setStaleFailure(null)
      setOpenFailure(null)
      setUpdatedAt(null)
      setPreview(EMPTY_PREVIEW)
      clearSelection()
      void readState(false)
      return () => {
        listInFlight.current?.abort()
        fileInFlight.current?.abort()
        previewInFlight.current?.abort()
      }
      // `clearSelection` only sets state and reads no props, so the Session and
      // the fetch identity are the whole dependency set.
    }, [readState])

    const openFile = React.useCallback((file: InstructionFileSummary, exists: boolean): void => {
      fileInFlight.current?.abort()
      fileInFlight.current = null
      setSelected(file)
      setDetail(null)
      setDraft('')
      setOriginalSha1(undefined)
      setSavedAt(null)
      setSaveFailure(null)
      setConflict(false)
      setOpenFailure(null)
      setSaving(false)
      if (!exists) {
        // A missing candidate needs no read: the editor starts empty and the
        // save request omits `expectedSha1`.
        setCreating(true)
        setLoadingFileId(null)
        return
      }
      setCreating(false)
      const controller = new AbortController()
      fileInFlight.current = controller
      setLoadingFileId(file.id)
      void (async (): Promise<void> => {
        try {
          const next = await runtime.loadFile(sessionId, file.id, controller.signal)
          if (controller.signal.aborted) return
          setDetail(next)
          setSelected(next)
          setDraft(next.content)
          setOriginalSha1(next.sha1)
        } catch (error) {
          if (controller.signal.aborted || isAbortError(error)) return
          // A failed open returns to the list: an empty editor over an existing
          // file would invite an accidental overwrite.
          setSelected(null)
          setOpenFailure(`打开 ${file.displayPath} 失败：${errorText(error)}`)
        } finally {
          if (fileInFlight.current === controller) {
            fileInFlight.current = null
            setLoadingFileId(null)
          }
        }
      })()
    }, [runtime, sessionId])

    /**
     * Select one candidate for the read-only preview pane.
     *
     * The selection is committed immediately so the pane headers respond on
     * click even while the body is still on its way; a missing candidate needs
     * no read at all. Every answer is matched against the current selection, so
     * a slow read that lost the race cannot paint over a newer one.
     * @param file - the candidate the user clicked.
     */
    const previewFile = React.useCallback((file: InstructionFileSummary): void => {
      previewInFlight.current?.abort()
      previewInFlight.current = null
      setPreview({ file, detail: null, loading: file.exists, failure: null })
      if (!file.exists) return
      const controller = new AbortController()
      previewInFlight.current = controller
      void (async (): Promise<void> => {
        try {
          const next = await runtime.loadFile(sessionId, file.id, controller.signal)
          if (controller.signal.aborted) return
          setPreview(current => current.file?.id === next.id
            ? { file: next, detail: next, loading: false, failure: null }
            : current)
        } catch (error) {
          if (controller.signal.aborted || isAbortError(error)) return
          setPreview(current => current.file?.id === file.id
            ? { ...current, loading: false, failure: errorText(error) }
            : current)
        } finally {
          if (previewInFlight.current === controller) previewInFlight.current = null
        }
      })()
    }, [runtime, sessionId])

    // A refresh replaces the previewed row's metadata; when it moved on disk the
    // old body no longer describes the file, so re-read it. The effect returns
    // immediately once the loaded detail matches the fresh summary, which also
    // keeps a save (which updates both together) from re-reading itself.
    React.useEffect(() => {
      const file = preview.file
      const loaded = preview.detail
      if (file === null || loaded === null || !file.exists) return
      if (file.size === loaded.size && file.modifiedAt === loaded.modifiedAt) return
      previewFile(file)
    }, [preview.file, preview.detail, previewFile])

    /**
     * Leave the editor, asking first when the draft would be lost.
     * @returns nothing; the click handler ignores the result.
     */
    function back(): void {
      if (selected === null) return
      const isDirty = creating ? draft !== '' : detail !== null && draft !== detail.content
      if (isDirty && typeof window !== 'undefined' && !window.confirm('放弃未保存的修改？')) return
      fileInFlight.current?.abort()
      fileInFlight.current = null
      clearSelection()
    }

    /** Write the draft and refresh the list without a spinner on success. */
    function save(): void {
      if (selected === null || saving) return
      const controller = new AbortController()
      fileInFlight.current?.abort()
      fileInFlight.current = controller
      setSaving(true)
      setSaveFailure(null)
      void (async (): Promise<void> => {
        try {
          const request: SaveInstructionRequest = {
            sessionId,
            id: selected.id,
            content: draft,
            ...(originalSha1 === undefined ? {} : { expectedSha1: originalSha1 }),
          }
          const next = await runtime.saveFile(request, controller.signal)
          if (controller.signal.aborted) return
          setDetail(next)
          setSelected(next)
          setDraft(next.content)
          setOriginalSha1(next.sha1)
          setCreating(false)
          setConflict(false)
          setSaveFailure(null)
          setSavedAt(new Date().toISOString())
          // Keep an already-previewed file in step with what was just written.
          setPreview(current => current.file?.id === next.id
            ? { file: next, detail: next, loading: false, failure: null }
            : current)
          // Sizes, order, duplicates, and the effective count all change with a
          // write, so the list is re-read quietly behind the editor.
          void readState(true)
        } catch (error) {
          if (controller.signal.aborted || isAbortError(error)) return
          const message = errorText(error)
          // The model's failure text is `<code>: <message>`; a conflict keeps
          // the draft and offers a reload instead of overwriting.
          if (message.startsWith('conflict:')) setConflict(true)
          else setSaveFailure(message)
        } finally {
          if (fileInFlight.current === controller) {
            fileInFlight.current = null
            setSaving(false)
          }
        }
      })()
    }

    /** Re-read the open file, or the list when there is no file yet. */
    function reload(): void {
      if (selected === null) return
      setConflict(false)
      setSaveFailure(null)
      if (creating) {
        // A new file has no content to reload; a fresh state read is enough to
        // clear the conflict banner and show whether the file appeared.
        void readState(true)
        return
      }
      // Unlike `openFile`, a reload keeps the old detail mounted so the editor
      // does not flash back to the list while the new content is on its way.
      const controller = new AbortController()
      fileInFlight.current?.abort()
      fileInFlight.current = controller
      setLoadingFileId(selected.id)
      void (async (): Promise<void> => {
        try {
          const next = await runtime.loadFile(sessionId, selected.id, controller.signal)
          if (controller.signal.aborted) return
          setDetail(next)
          setSelected(next)
          setDraft(next.content)
          setOriginalSha1(next.sha1)
          setCreating(false)
        } catch (error) {
          if (controller.signal.aborted || isAbortError(error)) return
          setSaveFailure(errorText(error))
        } finally {
          if (fileInFlight.current === controller) {
            fileInFlight.current = null
            setLoadingFileId(null)
          }
        }
      })()
    }

    /** Restore the last loaded content. */
    function revert(): void {
      setDraft(creating || detail === null ? '' : detail.content)
    }

    /** Delete the open file after a confirmation, then return to the list. */
    function remove(): void {
      if (selected === null || saving) return
      if (typeof window !== 'undefined' && !window.confirm(`确定删除 ${selected.displayPath} 吗？`)) return
      const controller = new AbortController()
      fileInFlight.current?.abort()
      fileInFlight.current = controller
      setSaving(true)
      setSaveFailure(null)
      void (async (): Promise<void> => {
        try {
          await runtime.deleteFile({ sessionId, id: selected.id }, controller.signal)
          if (controller.signal.aborted) return
          // The previewed body has no file behind it any more; drop it rather
          // than leaving stale text in the pane.
          setPreview(current => current.file?.id === selected.id ? EMPTY_PREVIEW : current)
          clearSelection()
          void readState(true)
        } catch (error) {
          if (controller.signal.aborted || isAbortError(error)) return
          setSaveFailure(errorText(error))
        } finally {
          if (fileInFlight.current === controller) {
            fileInFlight.current = null
            setSaving(false)
          }
        }
      })()
    }

    if (state === null) {
      return React.createElement(
        'div',
        { className: 'ai-page' },
        React.createElement('style', null, AGENT_INSTRUCTIONS_CSS),
        React.createElement(
          'div',
          { className: 'ai-inner' },
          React.createElement(
            'header',
            { className: 'ai-head' },
            React.createElement('h1', { className: 'ai-title' }, COPY.title),
            React.createElement('p', { className: 'ai-desc' }, COPY.description),
          ),
          failure === null
            ? React.createElement('div', { className: 'ai-loading', role: 'status' }, COPY.loading)
            : React.createElement(
              'div',
              { className: 'ai-status ai-status--error', role: 'alert' },
              React.createElement('div', { className: 'ai-statusTitle' }, failure),
              React.createElement(
                'div',
                { className: 'ai-statusActions' },
                React.createElement(
                  'button',
                  { type: 'button', className: 'ai-btn', onClick: () => { void readState(false) } },
                  COPY.retry,
                ),
              ),
            ),
        ),
      )
    }

    if (selected !== null && (detail !== null || creating)) {
      const dirty = creating ? draft !== '' : detail !== null && draft !== detail.content
      return React.createElement(InstructionEditorPage, {
        file: detail ?? selected,
        content: draft,
        onChange: setDraft,
        saving,
        savedAt,
        failure: saveFailure,
        conflict,
        onReload: reload,
        onBack: back,
        onSave: save,
        onDelete: remove,
        onRevert: revert,
        dirty,
        creating,
      })
    }

    return React.createElement(AgentInstructionsPage, {
      state,
      onRefresh: () => { void readState(false) },
      refreshing,
      updatedAt,
      staleFailure,
      openFailure,
      onPreview: previewFile,
      onOpenFile: (file, exists) => { openFile(file, exists) },
      loadingFileId,
      preview: preview.file,
      previewDetail: preview.detail,
      previewLoading: preview.loading,
      previewFailure: preview.failure,
    })
  }
  return AgentInstructionsTab
}

/**
 * Component-local stylesheet; every color is a Harness theme token.
 *
 * The visual hierarchy follows the Gestalt "common region" rule: each entity is
 * ONE enclosure — a card with a header strip — instead of a card nested inside
 * a bordered list. The light theme makes `bg-layer-1` and `bg-layer-2` both
 * white, so tint alone cannot separate surfaces there; the structure therefore
 * rides on border weight: `--border-l2` at 1px outlines a card, the same token
 * at 0.5px divides its header and rows, and `--border-l1` is left for purely
 * decorative hints. The brand color marks only the selected row.
 */
export const AGENT_INSTRUCTIONS_CSS = `
.ai-page { box-sizing: border-box; padding: 24px 28px 32px; color: var(--dsw-alias-label-primary); font-size: 13px; line-height: 1.55; font-family: inherit; }
.ai-page * { box-sizing: border-box; }
.ai-inner { display: flex; flex-direction: column; gap: 16px; max-width: 1180px; }
.ai-page--editor .ai-inner { max-width: 780px; }

/* Page chrome: title + actions on one line; context as its own bounded strip. */
.ai-headRow { display: flex; align-items: flex-start; justify-content: space-between; flex-wrap: wrap; gap: 12px; }
.ai-head { display: flex; flex-direction: column; gap: 4px; min-width: 0; }
.ai-title { margin: 0; font-size: 16px; font-weight: 600; line-height: 1.4; }
.ai-title--mono { font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; font-size: 14px; overflow-wrap: anywhere; }
.ai-desc { margin: 0; color: var(--dsw-alias-label-secondary); font-size: 12.5px; }
.ai-toolbar { display: flex; align-items: center; gap: 8px; padding-top: 3px; }
.ai-btn { flex: none; height: 32px; padding: 0 12px; border: 0.5px solid var(--dsw-alias-border-l2); border-radius: 8px; background: var(--dsw-alias-bg-layer-1); color: var(--dsw-alias-label-primary); font: inherit; font-size: 12.5px; cursor: pointer; white-space: nowrap; }
.ai-btn:hover:not(:disabled) { border-color: var(--dsw-alias-label-secondary); background: var(--dsw-alias-bg-layer-2); }
.ai-btn:focus-visible { outline: 2px solid var(--dsw-alias-brand-primary); outline-offset: 1px; }
.ai-btn:disabled { cursor: default; opacity: 0.5; }
.ai-btn--primary { border-color: var(--dsw-alias-brand-primary); color: var(--dsw-alias-brand-primary); }
.ai-btn--danger { color: var(--dsw-alias-state-error-primary); }
.ai-updated { flex: none; color: var(--dsw-alias-label-secondary); font-size: 11px; white-space: nowrap; }
.ai-contextBar { display: flex; align-items: center; flex-wrap: wrap; gap: 6px 14px; padding: 8px 12px; border: 0.5px solid var(--dsw-alias-border-l2); border-radius: 10px; background: var(--dsw-alias-bg-layer-1); color: var(--dsw-alias-label-secondary); font-size: 12px; }
.ai-contextItem { display: inline-flex; align-items: baseline; gap: 6px; min-width: 0; }
.ai-contextItem + .ai-contextItem::before { content: ''; flex: none; align-self: center; width: 1px; height: 12px; margin-right: 12px; background: var(--dsw-alias-border-l1); }
.ai-contextPath { color: var(--dsw-alias-label-primary); font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; font-size: 11.5px; overflow-wrap: anywhere; }
.ai-hint { color: var(--dsw-alias-label-secondary); font-size: 11.5px; }
.ai-hint--warn { color: var(--dsw-alias-state-warn-primary); font-size: 12px; }

/* Sections: a rule under each heading draws the boundary the gap alone misses. */
.ai-section { display: flex; flex-direction: column; gap: 10px; }
.ai-sectionHead { display: flex; align-items: baseline; flex-wrap: wrap; gap: 8px; padding-bottom: 8px; border-bottom: 0.5px solid var(--dsw-alias-border-l2); }
.ai-sectionTitle { margin: 0; font-size: 13px; font-weight: 600; }
.ai-count { flex: none; min-width: 20px; padding: 0 6px; border-radius: 999px; background: var(--dsw-alias-bg-layer-2); color: var(--dsw-alias-label-secondary); font-size: 11px; text-align: center; }
.ai-sectionHint { color: var(--dsw-alias-label-secondary); font-size: 11.5px; }
.ai-summary { margin-left: auto; color: var(--dsw-alias-label-secondary); font-size: 11.5px; white-space: nowrap; }
.ai-chain { display: flex; flex-wrap: wrap; gap: 4px; color: var(--dsw-alias-label-secondary); font-size: 11.5px; }
.ai-chainLabel { flex: none; }
.ai-chainItems { color: var(--dsw-alias-label-primary); font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; font-size: 11px; overflow-wrap: anywhere; }

/* User-global roots: two peer cards instead of one list split by hairlines. */
.ai-userRoots { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 10px; }
.ai-rootBlock { display: flex; flex-direction: column; min-width: 0; border: 1px solid var(--dsw-alias-border-l2); border-radius: 12px; background: var(--dsw-alias-bg-layer-1); overflow: hidden; }
.ai-rootHead { display: flex; align-items: baseline; flex-wrap: wrap; gap: 6px; padding: 9px 12px; background: var(--dsw-alias-bg-layer-2); border-bottom: 0.5px solid var(--dsw-alias-border-l2); }
.ai-rootTitle { font-size: 12.5px; font-weight: 600; }
.ai-rootPath { color: var(--dsw-alias-label-secondary); font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; font-size: 10.5px; overflow-wrap: anywhere; }

/* Project chain: one card per level, header strip keyed to the level identity. */
.ai-levels { display: flex; flex-direction: column; gap: 10px; }
.ai-level { display: flex; flex-direction: column; border: 1px solid var(--dsw-alias-border-l2); border-radius: 12px; background: var(--dsw-alias-bg-layer-1); overflow: hidden; }
.ai-levelHead { display: flex; align-items: baseline; flex-wrap: wrap; gap: 6px 8px; padding: 9px 12px; background: var(--dsw-alias-bg-layer-2); border-bottom: 0.5px solid var(--dsw-alias-border-l2); }
.ai-levelTitle { font-size: 13px; font-weight: 600; line-height: 1.35; }
.ai-levelDepth { flex: none; color: var(--dsw-alias-label-secondary); font-size: 10.5px; }
.ai-levelPath { flex-basis: 100%; color: var(--dsw-alias-label-secondary); font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; font-size: 11px; overflow-wrap: anywhere; }
.ai-levelFiles { display: flex; flex-direction: column; }

/* One row: the whole body is the preview target, the trailing button edits. */
.ai-file { display: flex; align-items: center; gap: 10px; padding: 10px 12px; transition: background 120ms ease; }
.ai-file + .ai-file { border-top: 0.5px solid var(--dsw-alias-border-l2); }
.ai-file:hover { background: var(--dsw-alias-bg-layer-2); box-shadow: inset 0 0 0 1px var(--dsw-alias-border-l2); }
.ai-file[data-active="true"] { background: var(--dsw-alias-bg-layer-2); box-shadow: inset 3px 0 0 var(--dsw-alias-brand-primary), inset 0 0 0 0.5px var(--dsw-alias-border-l2); }
.ai-fileMain { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 2px; padding: 0; margin: 0; border: 0; background: none; color: inherit; font: inherit; text-align: left; cursor: pointer; border-radius: 6px; }
.ai-fileMain:focus-visible { outline: 2px solid var(--dsw-alias-brand-primary); outline-offset: 2px; }
.ai-fileHead { display: flex; align-items: center; flex-wrap: wrap; gap: 6px; }
.ai-fileName { font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; font-size: 13px; font-weight: 600; line-height: 1.35; }
.ai-file--missing .ai-fileName { color: var(--dsw-alias-label-secondary); font-weight: 500; }
.ai-fileAction { flex: none; height: 26px; padding: 0 10px; border: 0.5px solid var(--dsw-alias-border-l2); border-radius: 7px; background: var(--dsw-alias-bg-layer-1); color: var(--dsw-alias-label-primary); font: inherit; font-size: 11.5px; cursor: pointer; }
.ai-fileAction:hover:not(:disabled) { border-color: var(--dsw-alias-label-secondary); background: var(--dsw-alias-bg-layer-2); }
.ai-fileAction:focus-visible { outline: 2px solid var(--dsw-alias-brand-primary); outline-offset: 1px; }
.ai-fileAction:disabled { cursor: default; opacity: 0.5; }
.ai-file[data-active="true"] .ai-fileAction { border-color: var(--dsw-alias-border-l2); }
.ai-chip { flex: none; padding: 0 6px; border: 0.5px solid var(--dsw-alias-border-l2); border-radius: 999px; color: var(--dsw-alias-label-secondary); font-size: 10.5px; line-height: 16px; }
.ai-chip--warn { border-color: var(--dsw-alias-state-warn-primary); color: var(--dsw-alias-state-warn-primary); }
.ai-chip--muted { border-style: dashed; }
.ai-chipRow { display: flex; flex-wrap: wrap; align-items: center; gap: 6px; }
.ai-fileMeta { display: block; color: var(--dsw-alias-label-secondary); font-size: 11px; }
.ai-filePath { display: block; color: var(--dsw-alias-label-secondary); font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; font-size: 11px; overflow-wrap: anywhere; }

/* Master-detail split: the aside gets its own edge so the two panes never blur. */
.ai-split { display: grid; grid-template-columns: minmax(0, 1fr) minmax(300px, 380px); gap: 20px; align-items: start; }
.ai-main { display: flex; flex-direction: column; gap: 18px; min-width: 0; }
.ai-preview { position: sticky; top: 12px; display: flex; flex-direction: column; gap: 8px; min-width: 0; padding-left: 20px; border-left: 0.5px solid var(--dsw-alias-border-l2); }
.ai-previewTitle { color: var(--dsw-alias-label-secondary); font-size: 11.5px; font-weight: 600; }
.ai-previewCard { display: flex; flex-direction: column; max-height: calc(100vh - 190px); border: 1px solid var(--dsw-alias-border-l2); border-radius: 12px; background: var(--dsw-alias-bg-layer-1); overflow: hidden; }
.ai-previewHead { display: flex; align-items: center; flex-wrap: wrap; gap: 6px; padding: 9px 12px; background: var(--dsw-alias-bg-layer-2); border-bottom: 0.5px solid var(--dsw-alias-border-l2); }
.ai-previewName { font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; font-size: 13px; font-weight: 600; line-height: 1.35; overflow-wrap: anywhere; }
.ai-previewAction { margin-left: auto; }
.ai-previewPath { padding: 10px 12px 0; color: var(--dsw-alias-label-secondary); font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; font-size: 10.5px; overflow-wrap: anywhere; }
.ai-previewContent { display: flex; flex-direction: column; flex: 1; min-height: 0; padding: 10px 12px 12px; overflow: auto; }
.ai-previewBody { flex: 1; min-height: 120px; margin: 0; padding: 10px 12px; border: 0.5px solid var(--dsw-alias-border-l2); border-radius: 8px; background: var(--dsw-alias-bg-layer-2); color: var(--dsw-alias-label-primary); font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; font-size: 12px; line-height: 1.6; white-space: pre-wrap; word-break: break-word; tab-size: 2; }
.ai-previewLoading { padding: 12px; color: var(--dsw-alias-label-secondary); font-size: 12.5px; }
.ai-previewMissing { padding: 12px; border: 0.5px dashed var(--dsw-alias-border-l2); border-radius: 8px; color: var(--dsw-alias-label-secondary); font-size: 12px; }
.ai-previewEmpty { display: flex; flex-direction: column; gap: 6px; padding: 16px; border: 0.5px dashed var(--dsw-alias-border-l2); border-radius: 12px; color: var(--dsw-alias-label-secondary); font-size: 12px; }
.ai-previewEmptyTitle { color: var(--dsw-alias-label-primary); font-weight: 500; }
.ai-previewEmptyHint { font-size: 11.5px; }

/* Empty / loading / status surfaces. */
.ai-empty { padding: 12px; border: 0.5px dashed var(--dsw-alias-border-l2); border-radius: 10px; color: var(--dsw-alias-label-secondary); font-size: 12px; }
.ai-loading { color: var(--dsw-alias-label-secondary); font-size: 12.5px; }
.ai-status { display: flex; flex-direction: column; gap: 4px; padding: 10px 12px; border: 0.5px solid var(--dsw-alias-border-l2); border-radius: 10px; background: var(--dsw-alias-bg-layer-1); font-size: 12px; }
.ai-statusTitle { font-weight: 500; }
.ai-status--warn { border-color: var(--dsw-alias-state-warn-primary); }
.ai-status--warn .ai-statusTitle { color: var(--dsw-alias-state-warn-primary); }
.ai-status--error { border-color: var(--dsw-alias-state-error-primary); }
.ai-status--error .ai-statusTitle { color: var(--dsw-alias-state-error-primary); }
.ai-statusPath { color: var(--dsw-alias-label-secondary); font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; font-size: 11px; overflow-wrap: anywhere; }
.ai-statusActions { display: flex; gap: 8px; padding-top: 2px; }

/* Editor page. */
.ai-back { align-self: flex-start; padding: 0; border: 0; background: none; color: var(--dsw-alias-brand-primary); font: inherit; font-size: 12px; line-height: 1.4; cursor: pointer; }
.ai-back:hover { text-decoration: underline; text-underline-offset: 2px; }
.ai-back:focus-visible { outline: 2px solid var(--dsw-alias-brand-primary); outline-offset: 2px; border-radius: 4px; }
.ai-editorPath { color: var(--dsw-alias-label-secondary); font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; font-size: 11px; overflow-wrap: anywhere; }
.ai-editorNote { margin: 0; color: var(--dsw-alias-label-secondary); font-size: 11.5px; }
.ai-textarea { width: 100%; min-height: 340px; padding: 10px 12px; border: 0.5px solid var(--dsw-alias-border-l2); border-radius: 10px; background: var(--dsw-alias-bg-layer-1); color: var(--dsw-alias-label-primary); font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; font-size: 12.5px; line-height: 1.6; resize: vertical; }
.ai-textarea::placeholder { color: var(--dsw-alias-label-secondary); opacity: 0.7; }
.ai-textarea:focus-visible { outline: none; border-color: var(--dsw-alias-brand-primary); }
.ai-textarea--over { border-color: var(--dsw-alias-state-warn-primary); }
.ai-editorFoot { display: flex; flex-wrap: wrap; align-items: center; gap: 8px; }
.ai-bytes { color: var(--dsw-alias-label-secondary); font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; font-size: 11px; white-space: nowrap; }
.ai-bytes--over { color: var(--dsw-alias-state-warn-primary); }
.ai-saved { color: var(--dsw-alias-state-success-primary); font-size: 11.5px; white-space: nowrap; }
.ai-editorActions { display: flex; gap: 8px; margin-left: auto; }

/* Narrow Conversation views stack the detail pane above the list. */
@media (max-width: 1040px) {
  .ai-split { grid-template-columns: minmax(0, 1fr); }
  .ai-preview { position: static; order: -1; padding: 0 0 14px; border-left: 0; border-bottom: 0.5px solid var(--dsw-alias-border-l2); }
  .ai-previewCard { max-height: none; }
  .ai-previewContent { max-height: 320px; }
  .ai-userRoots { grid-template-columns: minmax(0, 1fr); }
}
`

