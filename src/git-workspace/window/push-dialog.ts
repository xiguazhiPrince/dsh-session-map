/**
 * Push preview dialog: what would be sent to the upstream, shown before the
 * push job starts.
 *
 * @module dsh-session-map/git-workspace/window/push-dialog
 */
import * as React from 'react'
import type { CommitDetail, FileChange, PushPreview } from '../git-types'
import { FileIcon, FolderIcon, ChevronIcon } from './icons'

/** Props for the push preview. */
export interface PushDialogProps {
  readonly branch: string
  readonly remote: string | null
  /** Current upstream ref, or null when the push would set it up. */
  readonly upstream: string | null
  readonly preview: PushPreview | null
  readonly loading: boolean
  readonly error: string | null
  readonly busy: boolean
  /** Only an upstream can be force-with-lease pushed. */
  readonly canForce: boolean
  readonly force: boolean
  /** Load one commit's file list when the user selects it in the left pane. */
  readonly loadCommit: (oid: string) => Promise<CommitDetail>
  readonly onForce: (force: boolean) => void
  readonly onPush: () => void
  readonly onCancel: () => void
}

/** Render one push-preview row's stat summary. */
function fileStats(additions: number | null, deletions: number | null, binary: boolean): string {
  if (binary) return '二进制'
  return `+${additions ?? 0} −${deletions ?? 0}`
}

/** IDEA-style local author timestamp. */
function formatCommitDate(value: string): string {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value
  return date.toLocaleString('zh-CN', { hour12: false })
}

/** Browser-local key for the push dialog's pane sizes. */
const PUSH_LAYOUT_KEY = 'dsh.git-window.pushLayout'
/** Bounds for the left commit column and the bottom message pane. */
const LEFT_MIN = 200
const LEFT_MAX = 460
const MESSAGE_MIN = 120
const MESSAGE_MAX = 420

interface PushLayout {
  readonly left: number
  readonly message: number
}

/** Clamp one pane dimension. */
function clampPane(value: number, min: number, max: number): number {
  return Math.min(Math.max(min, Math.round(value)), max)
}

/** Read the saved pane sizes; a missing or denied store answers defaults. */
function readPushLayout(): PushLayout {
  const fallback: PushLayout = { left: 280, message: 220 }
  if (typeof localStorage === 'undefined') return fallback
  try {
    const raw = localStorage.getItem(PUSH_LAYOUT_KEY)
    if (raw === null) return fallback
    const parsed = JSON.parse(raw) as { readonly left?: unknown; readonly message?: unknown }
    return {
      left: typeof parsed.left === 'number' ? clampPane(parsed.left, LEFT_MIN, LEFT_MAX) : fallback.left,
      message: typeof parsed.message === 'number' ? clampPane(parsed.message, MESSAGE_MIN, MESSAGE_MAX) : fallback.message,
    }
  } catch {
    return fallback
  }
}

/** Persist the push dialog's pane sizes. */
function writePushLayout(layout: PushLayout): void {
  if (typeof localStorage === 'undefined') return
  try {
    localStorage.setItem(PUSH_LAYOUT_KEY, JSON.stringify(layout))
  } catch {
    // Blocked storage: the chooser still works for this run.
  }
}

/** One folder in the push preview's changed-file tree. */
interface PreviewFolder {
  readonly name: string
  readonly path: string
  readonly folders: Map<string, PreviewFolder>
  readonly files: FileChange[]
}

/** Build a directory tree from the preview's flat file list. */
function buildPreviewTree(files: readonly FileChange[]): PreviewFolder {
  const root: PreviewFolder = { name: '', path: '', folders: new Map(), files: [] }
  for (const file of files) {
    const parts = file.path.split('/')
    let node = root
    for (let index = 0; index < parts.length - 1; index += 1) {
      const name = parts[index] as string
      const path = node.path === '' ? name : `${node.path}/${name}`
      let child = node.folders.get(name)
      if (child === undefined) {
        child = { name, path, folders: new Map(), files: [] }
        node.folders.set(name, child)
      }
      node = child
    }
    node.files.push(file)
  }
  return root
}

/** Total files under one preview folder. */
function countPreviewFiles(folder: PreviewFolder): number {
  let total = folder.files.length
  for (const child of folder.folders.values()) total += countPreviewFiles(child)
  return total
}

/** Render one folder's children, indented by depth. */
function renderPreviewFolder(folder: PreviewFolder, depth: number): React.ReactNode[] {
  const rows: React.ReactNode[] = []
  for (const child of [...folder.folders.values()].sort((a, b) => a.name.localeCompare(b.name))) {
    rows.push(React.createElement(
      'div',
      { className: 'dgw-pushFolder', key: `d:${child.path}`, style: { paddingLeft: 8 + depth * 14 } },
      React.createElement(FolderIcon, { size: 13 }),
      React.createElement('span', { className: 'dgw-pushFolderName' }, child.name),
      React.createElement('span', { className: 'dgw-meta' }, `${countPreviewFiles(child)} 个文件`),
    ))
    rows.push(...renderPreviewFolder(child, depth + 1))
  }
  for (const file of [...folder.files].sort((a, b) => a.path.localeCompare(b.path))) {
    rows.push(React.createElement(
      'div',
      { className: 'dgw-pushFile', key: file.path, style: { paddingLeft: 8 + depth * 14 }, title: file.path },
      React.createElement(FileIcon, { size: 13 }),
      React.createElement('span', { className: 'dgw-pushFileStatus' }, file.status),
      React.createElement('span', { className: 'dgw-pushFilePath' }, file.path.split('/').pop() ?? file.path),
      React.createElement('span', { className: 'dgw-meta' }, fileStats(file.additions, file.deletions, file.binary)),
    ))
  }
  return rows
}

/** Render the push preview. */
export function PushDialog(props: PushDialogProps): React.ReactElement {
  const target = props.upstream ?? `${props.remote ?? 'origin'}/${props.branch}`
  const createsUpstream = props.upstream === null
  const [selectedOid, setSelectedOid] = React.useState<string | null>(null)
  const [selectedDetail, setSelectedDetail] = React.useState<CommitDetail | null>(null)
  const [detailLoading, setDetailLoading] = React.useState(false)
  const [detailError, setDetailError] = React.useState<string | null>(null)
  const [commitsOpen, setCommitsOpen] = React.useState(true)
  const [layout, setLayout] = React.useState<PushLayout>(() => readPushLayout())
  const layoutRef = React.useRef(layout)
  layoutRef.current = layout
  const drag = React.useRef<{ readonly kind: 'left' | 'message'; readonly start: number; readonly base: number } | null>(null)

  React.useEffect(() => {
    const move = (event: PointerEvent): void => {
      const active = drag.current
      if (active === null) return
      if (active.kind === 'left') {
        const next = clampPane(active.base + (event.clientX - active.start), LEFT_MIN, LEFT_MAX)
        setLayout(previous => ({ ...previous, left: next }))
      } else {
        const next = clampPane(active.base + (active.start - event.clientY), MESSAGE_MIN, MESSAGE_MAX)
        setLayout(previous => ({ ...previous, message: next }))
      }
    }
    const up = (): void => {
      if (drag.current === null) return
      drag.current = null
      document.body.style.userSelect = ''
      writePushLayout(layoutRef.current)
    }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
    return () => {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
      document.body.style.userSelect = ''
    }
  }, [])

  const startDrag = (kind: 'left' | 'message', event: React.PointerEvent): void => {
    event.preventDefault()
    document.body.style.userSelect = 'none'
    drag.current = {
      kind,
      start: kind === 'left' ? event.clientX : event.clientY,
      base: kind === 'left' ? layout.left : layout.message,
    }
  }
  const files: readonly FileChange[] = selectedOid === null
    ? props.preview?.files ?? []
    : selectedDetail?.files ?? []
  const fileTree = buildPreviewTree(files)

  const showAll = (): void => {
    setSelectedOid(null)
    setSelectedDetail(null)
    setDetailError(null)
  }

  const selectCommit = async (oid: string): Promise<void> => {
    setSelectedOid(oid)
    setSelectedDetail(null)
    setDetailLoading(true)
    setDetailError(null)
    try {
      setSelectedDetail(await props.loadCommit(oid))
    } catch (error) {
      setDetailError(error instanceof Error ? error.message : String(error))
    } finally {
      setDetailLoading(false)
    }
  }

  const filesTitle = selectedOid === null
    ? `全部变更（${props.preview?.files.length ?? 0}）`
    : `提交 ${selectedDetail?.shortOid ?? selectedOid.slice(0, 7)} 的文件（${files.length}）`
  const selectedCommit = selectedOid === null
    ? null
    : props.preview?.commits.find(commit => commit.oid === selectedOid) ?? null
  const selectedSubject = selectedCommit?.subject ?? selectedDetail?.subject ?? ''
  const fullMessage = selectedDetail?.message ?? selectedCommit?.subject ?? ''
  const bodyText = selectedSubject !== '' && fullMessage.startsWith(selectedSubject)
    ? fullMessage.slice(selectedSubject.length).trimStart()
    : fullMessage
  const commitAuthor = selectedDetail?.author ?? selectedCommit?.author ?? null

  return React.createElement(
    'div',
    { className: 'dgw-modalBackdrop' },
    React.createElement(
      'div',
      { className: 'dgw-modal dgw-pushModal', role: 'dialog', 'aria-label': '推送当前分支' },
      React.createElement('div', { className: 'dgw-modalTitle' }, '推送当前分支'),
      props.loading
        ? React.createElement('div', { className: 'dgw-loading' }, '正在计算待推送提交…')
        : null,
      props.error === null
        ? null
        : React.createElement('div', { className: 'dgw-inlineError' }, props.error),
      props.preview === null || props.loading
        ? null
        : React.createElement(
          'div',
          { className: 'dgw-pushBody' },
          React.createElement(
            'div',
            { className: 'dgw-pushLeft', style: { width: layout.left, flexBasis: layout.left } },
            React.createElement('div', {
              className: 'dgw-pushMapping' + (selectedOid === null ? ' dgw-pushMapping--active' : ''),
              onClick: showAll,
              title: '查看全部待推送文件',
            },
            React.createElement('button', {
              className: 'dgw-pushBranchToggle',
              type: 'button',
              'data-open': commitsOpen,
              'aria-label': commitsOpen ? '收起提交列表' : '展开提交列表',
              onClick: (event: React.MouseEvent) => {
                event.stopPropagation()
                setCommitsOpen(open => !open)
              },
            }, React.createElement(ChevronIcon, { size: 12 })),
            React.createElement('span', { className: 'dgw-pushMappingText' },
              `${props.branch} → ${target}`,
              createsUpstream ? '（将建立上游跟踪）' : '',
            ),
            React.createElement('span', { className: 'dgw-meta' }, `${props.preview.commits.length} 个提交`),
            ),
            createsUpstream
              ? React.createElement('div', { className: 'dgw-pushEmpty' }, '当前分支还没有上游，无法预览待推送提交')
              : commitsOpen
                ? React.createElement('div', { className: 'dgw-pushCommits' },
                  ...props.preview.commits.map(commit => React.createElement(
                    'div',
                    {
                      className: 'dgw-pushCommit' + (selectedOid === commit.oid ? ' dgw-pushCommit--active' : ''),
                      key: commit.oid,
                      title: commit.subject,
                      onClick: () => { void selectCommit(commit.oid) },
                    },
                    React.createElement('span', { className: 'dgw-pushSubject' }, commit.subject),
                    React.createElement('span', { className: 'dgw-meta' }, commit.author.name),
                  )),
                )
                : null,
            props.preview.truncated
              ? React.createElement('div', { className: 'dgw-meta' }, '提交较多，仅显示最近 100 条')
              : null,
          ),
          React.createElement('div', {
            className: 'dgw-pushVSplit',
            role: 'separator',
            'aria-orientation': 'vertical',
            title: '拖动调整左右宽度',
            onPointerDown: (event: React.PointerEvent) => startDrag('left', event),
          }),
          React.createElement(
            'div',
            { className: 'dgw-pushRight' },
            React.createElement('div', { className: 'dgw-pushSectionHead' }, filesTitle),
            detailLoading
              ? React.createElement('div', { className: 'dgw-pushEmpty' }, '正在读取提交文件…')
              : detailError === null
                ? React.createElement('div', { className: 'dgw-pushFiles' },
                  ...renderPreviewFolder(fileTree, 0),
                )
                : React.createElement('div', { className: 'dgw-inlineError' }, detailError),
            selectedOid === null
              ? null
              : React.createElement('div', {
                className: 'dgw-pushHSplit',
                role: 'separator',
                'aria-orientation': 'horizontal',
                title: '拖动调整提交信息高度',
                onPointerDown: (event: React.PointerEvent) => startDrag('message', event),
              }),
            selectedOid === null
              ? null
              : React.createElement('div', {
                className: 'dgw-pushMessage',
                style: { height: layout.message, flexBasis: layout.message },
              },
                React.createElement('div', { className: 'dgw-pushSectionHead' }, '提交信息'),
                detailLoading
                  ? React.createElement('div', { className: 'dgw-pushEmpty' }, '正在读取提交信息…')
                  : React.createElement(
                    React.Fragment,
                    null,
                    React.createElement('div', { className: 'dgw-pushMessageHead' },
                      selectedSubject,
                    ),
                    bodyText === ''
                      ? null
                      : React.createElement('div', { className: 'dgw-pushMessageBody' }, bodyText),
                    React.createElement('div', { className: 'dgw-pushMessageMeta' },
                      selectedDetail?.shortOid ?? selectedOid.slice(0, 7),
                      commitAuthor === null ? '' : ` 作者 ${commitAuthor.name} <${commitAuthor.email}>`,
                      commitAuthor === null ? '' : `, ${formatCommitDate(commitAuthor.date)}`,
                    ),
                  ),
              ),
          ),
        ),
      React.createElement(
        'div',
        { className: 'dgw-pushFooter' },
        props.canForce
          ? React.createElement('label', { className: 'dgw-choice' },
            React.createElement('input', {
              type: 'checkbox',
              checked: props.force,
              onChange: (event: React.ChangeEvent<HTMLInputElement>) => props.onForce(event.target.checked),
            }),
            '强制推送（--force-with-lease，会再次确认）',
          )
          : null,
        React.createElement('span', { className: 'dgw-spacer' }),
        React.createElement('button', { className: 'dgw-btn', type: 'button', onClick: props.onCancel, disabled: props.busy }, '取消'),
        React.createElement('button', {
          className: props.force ? 'dgw-btn dgw-btn--danger' : 'dgw-btn dgw-btn--primary',
          type: 'button',
          onClick: props.onPush,
          disabled: props.busy || props.loading || props.preview === null,
        }, props.force ? '强制推送' : '推送'),
      ),
    ),
  )
}
