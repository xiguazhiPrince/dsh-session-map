/**
 * Push preview dialog: what would be sent to the upstream, shown before the
 * push job starts.
 *
 * @module dsh-session-map/git-workspace/window/push-dialog
 */
import * as React from 'react'
import type { CommitDetail, FileChange, PushPreview } from '../git-types'
import { FileIcon, FolderIcon, ChevronIcon, CloseIcon } from './icons'

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

/** Merge several commits' file lists by path (multi-select preview). */
function mergeFileGroups(groups: readonly (readonly FileChange[])[]): readonly FileChange[] {
  const byPath = new Map<string, FileChange>()
  for (const group of groups) {
    for (const file of group) {
      const previous = byPath.get(file.path)
      if (previous === undefined) {
        byPath.set(file.path, file)
        continue
      }
      byPath.set(file.path, {
        ...file,
        additions: (previous.additions ?? 0) + (file.additions ?? 0),
        deletions: (previous.deletions ?? 0) + (file.deletions ?? 0),
        binary: previous.binary || file.binary,
      })
    }
  }
  return [...byPath.values()].sort((left, right) => left.path.localeCompare(right.path))
}

/** Render the push preview. */
export function PushDialog(props: PushDialogProps): React.ReactElement {
  const target = props.upstream ?? `${props.remote ?? 'origin'}/${props.branch}`
  const createsUpstream = props.upstream === null
  const [selectedOids, setSelectedOids] = React.useState<ReadonlySet<string>>(new Set())
  const [anchorOid, setAnchorOid] = React.useState<string | null>(null)
  const [details, setDetails] = React.useState<ReadonlyMap<string, CommitDetail>>(new Map())
  const [detailLoading, setDetailLoading] = React.useState<ReadonlySet<string>>(new Set())
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
  const ensureDetails = (oids: readonly string[]): void => {
    const missing = oids.filter(oid => !details.has(oid) && !detailLoading.has(oid))
    if (missing.length === 0) return
    setDetailLoading(previous => {
      const next = new Set(previous)
      for (const oid of missing) next.add(oid)
      return next
    })
    for (const oid of missing) {
      void props.loadCommit(oid)
        .then((detail) => {
          setDetails(previous => {
            const next = new Map(previous)
            next.set(oid, detail)
            return next
          })
        })
        .catch((error: unknown) => {
          setDetailError(error instanceof Error ? error.message : String(error))
        })
        .finally(() => {
          setDetailLoading(previous => {
            const next = new Set(previous)
            next.delete(oid)
            return next
          })
        })
    }
  }

  const showAll = (): void => {
    setSelectedOids(new Set())
    setAnchorOid(null)
    setDetailError(null)
  }

  const selectSingle = (oid: string): void => {
    setSelectedOids(new Set([oid]))
    setAnchorOid(oid)
    setDetailError(null)
    ensureDetails([oid])
  }

  const toggleCommit = (oid: string): void => {
    setSelectedOids((previous) => {
      const next = new Set(previous)
      if (next.has(oid)) next.delete(oid)
      else next.add(oid)
      return next
    })
    setAnchorOid(oid)
    setDetailError(null)
    ensureDetails([oid])
  }

  const selectRange = (oid: string): void => {
    const commits = props.preview?.commits ?? []
    const to = commits.findIndex(commit => commit.oid === oid)
    const from = anchorOid === null ? -1 : commits.findIndex(commit => commit.oid === anchorOid)
    if (to < 0 || from < 0) {
      selectSingle(oid)
      return
    }
    const low = Math.min(from, to)
    const high = Math.max(from, to)
    const ids = commits.slice(low, high + 1).map(commit => commit.oid)
    setSelectedOids(new Set(ids))
    setDetailError(null)
    ensureDetails(ids)
  }

  const onCommitClick = (oid: string, event: React.MouseEvent): void => {
    if (event.shiftKey) selectRange(oid)
    else if (event.ctrlKey || event.metaKey) toggleCommit(oid)
    else selectSingle(oid)
  }

  const selectedList = [...selectedOids]
  const singleOid = selectedList.length === 1 ? selectedList[0] as string : null
  const singleDetail = singleOid === null ? null : details.get(singleOid) ?? null
  const selectionLoading = selectedList.some(oid => detailLoading.has(oid))
  const files: readonly FileChange[] = selectedList.length === 0
    ? props.preview?.files ?? []
    : selectedList.length === 1
      ? singleDetail?.files ?? []
      : mergeFileGroups(selectedList.map(oid => details.get(oid)?.files ?? []))
  const fileTree = buildPreviewTree(files)

  const filesTitle = selectedList.length === 0
    ? `全部变更（${props.preview?.files.length ?? 0}）`
    : selectedList.length === 1
      ? `提交 ${singleDetail?.shortOid ?? singleOid?.slice(0, 7) ?? ''} 的文件（${files.length}）`
      : `所选 ${selectedList.length} 个提交的文件（${files.length}）`
  const selectedCommit = singleOid === null
    ? null
    : props.preview?.commits.find(commit => commit.oid === singleOid) ?? null
  const selectedSubject = selectedCommit?.subject ?? singleDetail?.subject ?? ''
  const fullMessage = singleDetail?.message ?? selectedCommit?.subject ?? ''
  const bodyText = selectedSubject !== '' && fullMessage.startsWith(selectedSubject)
    ? fullMessage.slice(selectedSubject.length).trimStart()
    : fullMessage
  const commitAuthor = singleDetail?.author ?? selectedCommit?.author ?? null

  return React.createElement(
    'div',
    { className: 'dgw-modalBackdrop' },
    React.createElement(
      'div',
      { className: 'dgw-modal dgw-pushModal', role: 'dialog', 'aria-label': '推送当前分支' },
      React.createElement(
        'div',
        { className: 'dgw-pushTitle' },
        React.createElement('span', { className: 'dgw-pushTitleText' }, '推送当前分支'),
        React.createElement('button', {
          className: 'dgw-iconBtn dgw-pushClose',
          type: 'button',
          title: '关闭',
          'aria-label': '关闭',
          disabled: props.busy,
          onClick: props.onCancel,
        }, React.createElement(CloseIcon, { size: 14 })),
      ),
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
              className: 'dgw-pushMapping' + (selectedOids.size === 0 ? ' dgw-pushMapping--active' : ''),
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
                      className: 'dgw-pushCommit' + (selectedOids.has(commit.oid) ? ' dgw-pushCommit--active' : ''),
                      key: commit.oid,
                      title: `${commit.subject}（Ctrl 点选、Shift 连选）`,
                      onClick: (event: React.MouseEvent) => onCommitClick(commit.oid, event),
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
            selectionLoading
              ? React.createElement('div', { className: 'dgw-pushEmpty' }, '正在读取提交文件…')
              : detailError === null
                ? React.createElement('div', { className: 'dgw-pushFiles' },
                  ...renderPreviewFolder(fileTree, 0),
                )
                : React.createElement('div', { className: 'dgw-inlineError' }, detailError),
            singleOid === null
              ? null
              : React.createElement('div', {
                className: 'dgw-pushHSplit',
                role: 'separator',
                'aria-orientation': 'horizontal',
                title: '拖动调整提交信息高度',
                onPointerDown: (event: React.PointerEvent) => startDrag('message', event),
              }),
            singleOid === null
              ? null
              : React.createElement('div', {
                className: 'dgw-pushMessage',
                style: { height: layout.message, flexBasis: layout.message },
              },
                React.createElement('div', { className: 'dgw-pushSectionHead' }, '提交信息'),
                singleOid !== null && detailLoading.has(singleOid)
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
                      singleDetail?.shortOid ?? singleOid.slice(0, 7),
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
