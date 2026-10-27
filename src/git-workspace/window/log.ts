/**
 * Presentational panes for the log tab: the branch tree, the commit list with
 * client-side graph lanes, and the commit-detail/diff column.
 *
 * These components own only local view state (search text, section collapse);
 * every fetch, selection and refresh decision lives in the shell so an SSR test
 * can render each pane from plain props.
 *
 * @module dsh-session-map/git-workspace/window/log
 */
import * as React from 'react'
import type { BranchRef, CommitDetail, CommitRow, DiffView, FileChange, HeadState } from '../git-types'
import { BranchIcon, ChevronIcon, CommitIcon, CopyIcon, FileIcon, RemoteIcon, SearchIcon, TagIcon } from './icons'

/** Branch tree props. */
export interface BranchTreeProps {
  readonly head: HeadState
  readonly branches: readonly BranchRef[]
  readonly selectedRef: string | null
  readonly onSelect: (ref: string | null) => void
  readonly onCheckout: (ref: string) => void
  readonly onCreateBranch: (start?: string) => void
  readonly onRenameBranch: (name: string) => void
  readonly onDeleteBranch: (name: string) => void
}

/** Format one ISO timestamp the way the tool window shows it. */
export function formatWhen(value: string): string {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value
  const now = new Date()
  const sameDay = date.getFullYear() === now.getFullYear()
    && date.getMonth() === now.getMonth()
    && date.getDate() === now.getDate()
  const time = `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`
  if (sameDay) return `今天 ${time}`
  const day = `${String(date.getMonth() + 1).padStart(2, '0')}/${String(date.getDate()).padStart(2, '0')}`
  if (date.getFullYear() === now.getFullYear()) return `${day} ${time}`
  return `${date.getFullYear()}/${day} ${time}`
}

/** One display label for a commit's refs, merging `origin/x` with local `x`. */
function refLabels(row: CommitRow): Array<{ readonly text: string; readonly tag: boolean }> {
  const labels: Array<{ text: string; tag: boolean }> = []
  for (const tag of row.refs.tags) labels.push({ text: tag, tag: true })
  const remote = new Set(row.refs.remoteBranches)
  for (const branch of row.refs.branches) {
    const match = [...remote].find(candidate => candidate === branch || candidate.endsWith(`/${branch}`))
    if (match !== undefined) {
      labels.push({ text: `${match.split('/')[0]} & ${branch}`, tag: false })
      remote.delete(match)
    } else {
      labels.push({ text: branch, tag: false })
    }
  }
  for (const branch of remote) labels.push({ text: branch, tag: false })
  return labels
}

/** Render one branch row. */
function branchRow(
  branch: BranchRef,
  active: boolean,
  onSelect: () => void,
  onCheckout: () => void,
  onMenu: (event: React.MouseEvent) => void,
): React.ReactElement {
  const badge = branch.track === null
    ? null
    : branch.track.gone
      ? 'gone'
      : [branch.track.ahead > 0 ? `↑${branch.track.ahead}` : '', branch.track.behind > 0 ? `↓${branch.track.behind}` : ''].filter(Boolean).join(' ')
  return React.createElement(
    'div',
    {
      key: branch.ref,
      className: [
        'dgw-treeRow',
        branch.isHead ? 'dgw-treeRow--current' : '',
        active ? 'dgw-treeRow--active' : '',
      ].filter(Boolean).join(' '),
      onClick: onSelect,
      onDoubleClick: branch.type === 'local' ? onCheckout : undefined,
      onContextMenu: branch.type === 'local' ? onMenu : undefined,
      title: branch.name,
    },
    branch.type === 'remote' ? React.createElement(RemoteIcon, { size: 14 }) : React.createElement(BranchIcon, { size: 14 }),
    React.createElement('span', { className: 'dgw-treeName' }, branch.name),
    badge === null || badge === '' ? null : React.createElement('span', { className: 'dgw-treeBadge' }, badge),
  )
}

/** Render the branch panel. */
export function BranchTree(props: BranchTreeProps): React.ReactElement {
  const [filter, setFilter] = React.useState('')
  const [localOpen, setLocalOpen] = React.useState(true)
  const [remoteOpen, setRemoteOpen] = React.useState(true)
  const [menu, setMenu] = React.useState<{ readonly x: number; readonly y: number; readonly branch: BranchRef } | null>(null)
  const needle = filter.trim().toLowerCase()
  const matches = (branch: BranchRef): boolean => needle === '' || branch.name.toLowerCase().includes(needle)
  const locals = props.branches.filter(branch => branch.type === 'local' && matches(branch))
  const remotes = props.branches.filter(branch => branch.type === 'remote' && matches(branch))
  const current = props.head.branch

  React.useEffect(() => {
    if (menu === null) return undefined
    const close = (): void => setMenu(null)
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') close()
    }
    window.addEventListener('click', close)
    window.addEventListener('contextmenu', close)
    window.addEventListener('keydown', onKey)
    return () => {
      window.removeEventListener('click', close)
      window.removeEventListener('contextmenu', close)
      window.removeEventListener('keydown', onKey)
    }
  }, [menu])

  const openMenu = (event: React.MouseEvent, branch: BranchRef): void => {
    event.preventDefault()
    event.stopPropagation()
    setMenu({ x: event.clientX, y: event.clientY, branch })
  }

  const menuItem = (label: string, action: () => void): React.ReactElement => React.createElement(
    'button',
    {
      className: 'dgw-menuItem',
      type: 'button',
      key: label,
      onClick: (event: React.MouseEvent) => {
        event.stopPropagation()
        setMenu(null)
        action()
      },
    },
    label,
  )

  return React.createElement(
    'div',
    { className: 'dgw-tree' },
    React.createElement(
      'div',
      { className: 'dgw-treeHead' },
      React.createElement('span', { className: 'dgw-search' },
        React.createElement(SearchIcon, { size: 13 }),
        React.createElement('input', {
          className: 'dgw-searchInput',
          type: 'search',
          placeholder: '分支或标签',
          value: filter,
          onChange: (event: React.ChangeEvent<HTMLInputElement>) => setFilter(event.target.value),
          'aria-label': '过滤分支',
        }),
      ),
      React.createElement('button', {
        className: 'dgw-iconBtn',
        type: 'button',
        title: '新建分支',
        'aria-label': '新建分支',
        onClick: () => props.onCreateBranch(current ?? undefined),
      }, '+'),
    ),
    React.createElement(
      'div',
      { className: 'dgw-treeScroll' },
      React.createElement('div', { className: 'dgw-treeSectionHead' }, 'HEAD(当前分支)'),
      current === null
        ? React.createElement(
          'div',
          { className: `dgw-treeRow${props.head.detached ? '' : ' dgw-treeRow--current'}` },
          React.createElement(CommitIcon, { size: 14 }),
          React.createElement('span', { className: 'dgw-treeName' }, props.head.detached ? 'HEAD 已分离' : 'HEAD'),
        )
        : React.createElement(
          'div',
          {
            className: `dgw-treeRow dgw-treeRow--current${props.selectedRef === null ? ' dgw-treeRow--active' : ''}`,
            onClick: () => props.onSelect(null),
            title: current,
          },
          React.createElement(BranchIcon, { size: 14 }),
          React.createElement('span', { className: 'dgw-treeName' }, current),
          React.createElement('span', { className: 'dgw-treeBadge' }, 'HEAD'),
        ),
      React.createElement(
        'button',
        {
          className: 'dgw-treeSectionHead',
          'data-open': localOpen,
          onClick: () => setLocalOpen(open => !open),
          type: 'button',
        },
        React.createElement(ChevronIcon, { size: 12 }),
        `本地 (${locals.length})`,
      ),
      localOpen
        ? locals.map(branch => branchRow(
          branch,
          props.selectedRef === branch.name,
          () => props.onSelect(branch.name),
          () => props.onCheckout(branch.name),
          event => openMenu(event, branch),
        ))
        : null,
      React.createElement(
        'button',
        {
          className: 'dgw-treeSectionHead',
          'data-open': remoteOpen,
          onClick: () => setRemoteOpen(open => !open),
          type: 'button',
        },
        React.createElement(ChevronIcon, { size: 12 }),
        `远程 (${remotes.length})`,
      ),
      remoteOpen
        ? remotes.map(branch => branchRow(
          branch,
          props.selectedRef === branch.name,
          () => props.onSelect(branch.name),
          () => undefined,
          () => undefined,
        ))
        : null,
    ),
    menu === null
      ? null
      : React.createElement(
        'div',
        { className: 'dgw-menu', style: { left: menu.x, top: menu.y } },
        menuItem('检出', () => props.onCheckout(menu.branch.name)),
        menuItem('从此分支新建…', () => props.onCreateBranch(menu.branch.name)),
        menuItem('重命名…', () => props.onRenameBranch(menu.branch.name)),
        menuItem('删除…', () => props.onDeleteBranch(menu.branch.name)),
      ),
  )
}

/** Commit list props. */
export interface LogListProps {
  readonly commits: readonly CommitRow[]
  readonly graph: readonly { readonly oid: string; readonly lane: number; readonly before: readonly string[]; readonly after: readonly string[] }[]
  readonly selectedOid: string | null
  readonly branchLabel: string | null
  readonly query: string
  readonly loading: boolean
  readonly hasMore: boolean
  readonly onSelect: (oid: string) => void
  readonly onQueryChange: (value: string) => void
  readonly onClearBranch: () => void
  readonly onLoadMore: () => void
}

/** Lane palette; the gutter is an SVG so colour comes from here, not CSS. */
const LANE_PALETTE = [
  '#4f9cf9', '#b48ead', '#7ec699', '#e8a87c', '#f07178', '#56b6c2', '#e5c07b', '#c678dd',
]

/** One row's graph gutter. */
function Gutter(props: {
  readonly lane: number
  readonly before: readonly string[]
  readonly after: readonly string[]
  readonly width: number
}): React.ReactElement {
  const step = 10
  const height = 26
  const middle = height / 2
  const children: React.ReactElement[] = []
  props.after.forEach((_, index) => {
    children.push(React.createElement('line', {
      key: `a${index}`,
      x1: 5 + index * step, y1: middle, x2: 5 + index * step, y2: height,
      stroke: LANE_PALETTE[index % LANE_PALETTE.length], strokeWidth: 1.5,
    }))
  })
  props.before.forEach((_, index) => {
    children.push(React.createElement('line', {
      key: `b${index}`,
      x1: 5 + index * step, y1: 0, x2: 5 + index * step, y2: middle,
      stroke: LANE_PALETTE[index % LANE_PALETTE.length], strokeWidth: 1.5,
    }))
  })
  children.push(React.createElement('circle', {
    key: 'dot',
    cx: 5 + props.lane * step,
    cy: middle,
    r: 3,
    fill: LANE_PALETTE[props.lane % LANE_PALETTE.length],
  }))
  return React.createElement('svg', { className: 'dgw-gutter', width: props.width, height }, ...children)
}

/** Render the commit list. */
export function LogList(props: LogListProps): React.ReactElement {
  const laneCount = props.graph.reduce((max, row) => Math.max(max, row.lane + 1, row.before.length, row.after.length), 1)
  const gutterWidth = laneCount * 10 + 6
  return React.createElement(
    'div',
    { className: 'dgw-list' },
    React.createElement(
      'div',
      { className: 'dgw-listHead' },
      props.branchLabel === null
        ? null
        : React.createElement('span', { className: 'dgw-chip' },
          props.branchLabel,
          React.createElement('button', {
            className: 'dgw-iconBtn',
            style: { width: 16, height: 16 },
            onClick: props.onClearBranch,
            title: '显示当前分支',
            type: 'button',
            'aria-label': '清除分支过滤',
          }, '×'),
        ),
      React.createElement('span', { className: 'dgw-search' },
        React.createElement(SearchIcon, { size: 13 }),
        React.createElement('input', {
          className: 'dgw-searchInput',
          type: 'search',
          placeholder: '文本或哈希',
          value: props.query,
          onChange: (event: React.ChangeEvent<HTMLInputElement>) => props.onQueryChange(event.target.value),
          'aria-label': '搜索提交',
        }),
      ),
    ),
    React.createElement(
      'div',
      { className: 'dgw-rows' },
      props.commits.length === 0
        ? React.createElement('div', { className: 'dgw-empty' },
          React.createElement('div', { className: 'dgw-emptyBox' },
            React.createElement('div', null, props.loading ? '正在加载提交…' : (props.query === '' ? '没有提交' : '没有匹配的提交')),
          ),
        )
        : props.commits.map((commit, index) => {
          const graphRow = props.graph[index] ?? { lane: 0, before: [], after: [] }
          const labels = refLabels(commit)
          return React.createElement(
            'div',
            {
              key: commit.oid,
              className: `dgw-row${props.selectedOid === commit.oid ? ' dgw-row--active' : ''}`,
              onClick: () => props.onSelect(commit.oid),
              title: `${commit.shortOid} ${commit.subject}`,
            },
            React.createElement(Gutter, {
              lane: graphRow.lane,
              before: graphRow.before,
              after: graphRow.after,
              width: gutterWidth,
            }),
            React.createElement('span', { className: 'dgw-subject' }, commit.subject),
            labels.length === 0
              ? null
              : React.createElement('span', { className: 'dgw-pills' },
                ...labels.slice(0, 3).map((label, labelIndex) => React.createElement(
                  'span',
                  { key: `${label.text}-${labelIndex}`, className: label.tag ? 'dgw-pill dgw-pill--tag' : 'dgw-pill' },
                  label.text,
                )),
              ),
            React.createElement('span', { className: 'dgw-meta' }, commit.author.name),
            React.createElement('span', { className: 'dgw-meta' }, formatWhen(commit.author.date)),
          )
        }),
      props.hasMore
        ? React.createElement('button', { className: 'dgw-loadMore', onClick: props.onLoadMore, type: 'button' }, '加载更多')
        : null,
    ),
  )
}

/** File status colour. */
function statusColour(status: FileChange['status']): string {
  switch (status) {
    case 'A': return 'var(--dgw-added)'
    case 'D': return 'var(--dgw-deleted)'
    case 'U': return 'var(--dgw-conflict)'
    case 'R':
    case 'C': return 'var(--dgw-modified)'
    default: return 'var(--dgw-modified)'
  }
}

/** Detail pane props. */
export interface DetailPaneProps {
  readonly detail: CommitDetail | null
  readonly loading: boolean
  readonly selectedFile: string | null
  readonly diff: DiffView | null
  readonly diffLoading: boolean
  readonly onSelectFile: (path: string) => void
}

/** Copy text without surfacing a failure. */
function copy(text: string): void {
  if (typeof navigator === 'undefined' || navigator.clipboard === undefined) return
  void navigator.clipboard.writeText(text).catch(() => undefined)
}

/** Render one diff. */
function DiffPane(props: { readonly diff: DiffView | null; readonly file: string | null; readonly loading: boolean }): React.ReactElement {
  if (props.file === null) {
    return React.createElement('div', { className: 'dgw-empty' }, React.createElement('div', { className: 'dgw-emptyBox' }, '选择一个文件查看差异'))
  }
  if (props.loading) return React.createElement('div', { className: 'dgw-loading' }, '正在读取差异…')
  if (props.diff === null) {
    return React.createElement('div', { className: 'dgw-empty' }, React.createElement('div', { className: 'dgw-emptyBox' }, '没有可显示的差异'))
  }
  if (props.diff.binary) {
    return React.createElement('div', { className: 'dgw-empty' }, React.createElement('div', { className: 'dgw-emptyBox' }, '二进制文件，无法预览差异'))
  }
  if (props.diff.truncated) {
    return React.createElement(
      'div',
      { className: 'dgw-diff' },
      React.createElement('div', { className: 'dgw-hunkHead' }, '差异过大，已截断'),
      ...props.diff.hunks.flatMap((hunk, hunkIndex) => [
        React.createElement('div', { className: 'dgw-hunkHead', key: `h${hunkIndex}` },
          `@@ -${hunk.oldStart},${hunk.oldLines} +${hunk.newStart},${hunk.newLines} @@`),
        ...hunk.lines.map((line, lineIndex) => React.createElement(
          'div',
          {
            className: line.kind === '+' ? 'dgw-diffLine dgw-diffLine--add' : line.kind === '-' ? 'dgw-diffLine dgw-diffLine--del' : 'dgw-diffLine',
            key: `${hunkIndex}-${lineIndex}`,
          },
          React.createElement('span', { className: 'dgw-diffLineNo' }, line.oldLine === null ? '' : String(line.oldLine)),
          React.createElement('span', { className: 'dgw-diffLineNo' }, line.newLine === null ? '' : String(line.newLine)),
          React.createElement('span', { className: 'dgw-diffSign' }, line.kind === ' ' ? ' ' : line.kind),
          React.createElement('span', null, line.text),
        )),
      ]),
    )
  }
  return React.createElement(
    'div',
    { className: 'dgw-diff' },
    ...props.diff.hunks.flatMap((hunk, hunkIndex) => [
      React.createElement('div', { className: 'dgw-hunkHead', key: `h${hunkIndex}` },
        `@@ -${hunk.oldStart},${hunk.oldLines} +${hunk.newStart},${hunk.newLines} @@`),
      ...hunk.lines.map((line, lineIndex) => React.createElement(
        'div',
        {
          className: line.kind === '+' ? 'dgw-diffLine dgw-diffLine--add' : line.kind === '-' ? 'dgw-diffLine dgw-diffLine--del' : 'dgw-diffLine',
          key: `${hunkIndex}-${lineIndex}`,
        },
        React.createElement('span', { className: 'dgw-diffLineNo' }, line.oldLine === null ? '' : String(line.oldLine)),
        React.createElement('span', { className: 'dgw-diffLineNo' }, line.newLine === null ? '' : String(line.newLine)),
        React.createElement('span', { className: 'dgw-diffSign' }, line.kind === ' ' ? ' ' : line.kind),
        React.createElement('span', null, line.text),
      )),
    ]),
  )
}

/** Render the commit-detail column. */
export function DetailPane(props: DetailPaneProps): React.ReactElement {
  if (props.detail === null) {
    return React.createElement('div', { className: 'dgw-detail' },
      React.createElement('div', { className: 'dgw-empty' },
        React.createElement('div', { className: 'dgw-emptyBox' },
          React.createElement('div', null, props.loading ? '正在加载提交详情…' : '选择一个提交查看详情'),
        ),
      ),
    )
  }
  const detail = props.detail
  return React.createElement(
    'div',
    { className: 'dgw-detail' },
    React.createElement(
      'div',
      { className: 'dgw-detailHead' },
      React.createElement('span', { className: 'dgw-hash' }, detail.shortOid),
      React.createElement('button', {
        className: 'dgw-iconBtn',
        type: 'button',
        title: '复制完整哈希',
        onClick: () => copy(detail.oid),
      }, React.createElement(CopyIcon, { size: 13 })),
      React.createElement('span', { className: 'dgw-spacer' }),
      React.createElement('span', { className: 'dgw-meta' }, `${detail.files.length} 个文件`),
    ),
    React.createElement(
      'div',
      { className: 'dgw-detailScroll' },
      React.createElement('div', { className: 'dgw-msg' }, detail.message),
      React.createElement('div', { className: 'dgw-detailRefs' },
        ...refLabels(detail).map(label => React.createElement(
          'span',
          { key: label.text, className: label.tag ? 'dgw-pill dgw-pill--tag' : 'dgw-pill' },
          label.text,
        )),
      ),
      React.createElement('div', { className: 'dgw-detailMeta' },
        React.createElement('div', null, `作者 ${detail.author.name} <${detail.author.email}>，${formatWhen(detail.author.date)}`),
        detail.committer.date !== detail.author.date
          ? React.createElement('div', null, `提交于 ${formatWhen(detail.committer.date)}`)
          : null,
        detail.containedInBranches.length === 0
          ? null
          : React.createElement('div', null, `在 ${detail.containedInBranches.length} 个分支中: ${detail.containedInBranches.join(', ')}`),
      ),
      React.createElement('div', { className: 'dgw-sectionTitle' }, '更改的文件'),
      ...detail.files.map(file => React.createElement(
        'div',
        {
          key: `${file.oldPath ?? ''}:${file.path}`,
          className: `dgw-fileRow${props.selectedFile === file.path ? ' dgw-fileRow--active' : ''}`,
          onClick: () => props.onSelectFile(file.path),
          title: file.path,
        },
        React.createElement(FileIcon, { size: 14 }),
        React.createElement('span', {
          className: 'dgw-filePath',
        }, file.path),
        React.createElement('span', { className: 'dgw-fileStat', style: { color: statusColour(file.status) } }, file.status),
        file.binary
          ? React.createElement('span', { className: 'dgw-fileStat' }, '二进制')
          : React.createElement('span', { className: 'dgw-fileStat' },
            React.createElement('span', { className: 'dgw-fileStat--add' }, `+${String(file.additions ?? 0)}`),
            ' ',
            React.createElement('span', { className: 'dgw-fileStat--del' }, `-${String(file.deletions ?? 0)}`),
          ),
      )),
    ),
    React.createElement(DiffPane, { diff: props.diff, file: props.selectedFile, loading: props.diffLoading }),
  )
}

/** Tag icon re-exported for the shell's empty states. */
export const DetailTagIcon = TagIcon
