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
import { BranchIcon, ChevronIcon, CommitIcon, CopyIcon, FileIcon, FolderIcon, RemoteIcon, SearchIcon, TagIcon } from './icons'
import { DiffView as DiffViewPane } from './diff-view'

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
  readonly onMergeBranch: (ref: string) => void
  readonly onRebaseBranch: (ref: string) => void
  readonly onDeleteTag: (name: string) => void
  readonly onForcePush: (name: string) => void
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
  depth: number,
  onSelect: () => void,
  onCheckout: () => void,
  onMenu: (event: React.MouseEvent) => void,
): React.ReactElement {
  const badge = branch.track === null
    ? null
    : branch.track.gone
      ? 'gone'
      : [branch.track.ahead > 0 ? `↑${branch.track.ahead}` : '', branch.track.behind > 0 ? `↓${branch.track.behind}` : ''].filter(Boolean).join(' ')
  const icon = branch.type === 'remote'
    ? React.createElement(RemoteIcon, { size: 14 })
    : branch.type === 'tag'
      ? React.createElement(TagIcon, { size: 14 })
      : React.createElement(BranchIcon, { size: 14 })
  return React.createElement(
    'div',
    {
      key: branch.ref,
      className: [
        'dgw-treeRow',
        branch.isHead ? 'dgw-treeRow--current' : '',
        active ? 'dgw-treeRow--active' : '',
      ].filter(Boolean).join(' '),
      style: { paddingLeft: 14 + depth * 12 },
      onClick: onSelect,
      onDoubleClick: branch.type === 'local' ? onCheckout : undefined,
      onContextMenu: branch.type === 'remote' ? undefined : onMenu,
      title: branch.name,
    },
    icon,
    React.createElement('span', { className: 'dgw-treeName' }, branch.name.split('/').at(-1) ?? branch.name),
    badge === null || badge === '' ? null : React.createElement('span', { className: 'dgw-treeBadge' }, badge),
  )
}

/** One folded branch-tree node. */
interface BranchTreeNode {
  readonly segment: string
  readonly path: string
  readonly children: BranchTreeNode[]
  branch?: BranchRef
}

/**
 * Fold slash-separated branch names into a tree.
 * @param branches - branches of one namespace.
 * @returns the sorted forest.
 */
export function buildBranchTree(branches: readonly BranchRef[]): readonly BranchTreeNode[] {
  const roots: BranchTreeNode[] = []
  for (const branch of branches) {
    const parts = branch.name.split('/')
    let level = roots
    let path = ''
    for (let index = 0; index < parts.length; index += 1) {
      const segment = parts[index] as string
      path = path === '' ? segment : `${path}/${segment}`
      let node = level.find(candidate => candidate.segment === segment)
      if (node === undefined) {
        node = { segment, path, children: [] }
        level.push(node)
      }
      if (index === parts.length - 1) node.branch = branch
      level = node.children
    }
  }
  const sort = (nodes: BranchTreeNode[]): void => {
    nodes.sort((left, right) => left.segment.localeCompare(right.segment))
    for (const node of nodes) sort(node.children)
  }
  sort(roots)
  return roots
}

/** Count leaves under one folded node. */
function leafCount(node: BranchTreeNode): number {
  if (node.branch !== undefined && node.children.length === 0) return 1
  return node.children.reduce((total, child) => total + leafCount(child), 0)
}

/** One open context menu. */
interface BranchMenuState {
  readonly x: number
  readonly y: number
  readonly branch?: BranchRef
  readonly tag?: BranchRef
}

/** Render the branch panel. */
export function BranchTree(props: BranchTreeProps): React.ReactElement {
  const [filter, setFilter] = React.useState('')
  const [localOpen, setLocalOpen] = React.useState(true)
  const [remoteOpen, setRemoteOpen] = React.useState(true)
  const [tagsOpen, setTagsOpen] = React.useState(true)
  const [expanded, setExpanded] = React.useState<ReadonlySet<string>>(new Set())
  const [menu, setMenu] = React.useState<BranchMenuState | null>(null)
  const needle = filter.trim().toLowerCase()
  const matches = (branch: BranchRef): boolean => needle === '' || branch.name.toLowerCase().includes(needle)
  const locals = props.branches.filter(branch => branch.type === 'local' && matches(branch))
  const remotes = props.branches.filter(branch => branch.type === 'remote' && matches(branch))
  const tags = props.branches.filter(branch => branch.type === 'tag' && matches(branch))
  const current = props.head.branch

  React.useEffect(() => {
    if (menu === null) return undefined
    const close = (): void => setMenu(null)
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') close()
    }
    window.addEventListener('click', close)
    window.addEventListener('keydown', onKey)
    window.addEventListener('scroll', close, true)
    return () => {
      window.removeEventListener('click', close)
      window.removeEventListener('keydown', onKey)
      window.removeEventListener('scroll', close, true)
    }
  }, [menu])

  const openMenu = (event: React.MouseEvent, entry: { readonly branch?: BranchRef; readonly tag?: BranchRef }): void => {
    event.preventDefault()
    event.stopPropagation()
    setMenu({ x: event.clientX, y: event.clientY, ...entry })
  }

  const toggleFolder = (path: string): void => {
    setExpanded((previous) => {
      const next = new Set(previous)
      if (next.has(path)) next.delete(path)
      else next.add(path)
      return next
    })
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

  const renderNodes = (nodes: readonly BranchTreeNode[], depth: number): React.ReactNode[] => nodes.flatMap((node) => {
    const rows: React.ReactNode[] = []
    const paddingLeft = 14 + depth * 12
    if (node.branch !== undefined && node.children.length === 0) {
      const branch = node.branch
      rows.push(branchRow(
        branch,
        props.selectedRef === branch.name,
        depth,
        () => props.onSelect(branch.name),
        () => props.onCheckout(branch.name),
        event => openMenu(event, { branch }),
      ))
      return rows
    }
    if (node.branch !== undefined) {
      const branch = node.branch
      rows.push(branchRow(
        branch,
        props.selectedRef === branch.name,
        depth,
        () => props.onSelect(branch.name),
        () => props.onCheckout(branch.name),
        event => openMenu(event, { branch }),
      ))
    }
    const open = needle !== '' || expanded.has(node.path)
    rows.push(React.createElement(
      'button',
      {
        key: `folder:${node.path}`,
        className: 'dgw-treeRow dgw-treeRow--folder',
        style: { paddingLeft },
        type: 'button',
        'data-open': open,
        onClick: () => toggleFolder(node.path),
      },
      React.createElement(ChevronIcon, { size: 12 }),
      React.createElement(FolderIcon, { size: 14 }),
      React.createElement('span', { className: 'dgw-treeName' }, node.segment),
      React.createElement('span', { className: 'dgw-treeBadge' }, String(leafCount(node))),
    ))
    if (open) rows.push(...renderNodes(node.children, depth + 1))
    return rows
  })

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
      localOpen ? renderNodes(buildBranchTree(locals), 0) : null,
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
      remoteOpen ? renderNodes(buildBranchTree(remotes), 0) : null,
      tags.length === 0
        ? null
        : React.createElement(
          'button',
          {
            className: 'dgw-treeSectionHead',
            'data-open': tagsOpen,
            onClick: () => setTagsOpen(open => !open),
            type: 'button',
          },
          React.createElement(ChevronIcon, { size: 12 }),
          `标签 (${tags.length})`,
        ),
      tags.length === 0 || !tagsOpen
        ? null
        : tags.map(tag => branchRow(
          tag,
          props.selectedRef === tag.name,
          0,
          () => props.onSelect(tag.name),
          () => undefined,
          event => openMenu(event, { tag }),
        )),
    ),
    menu === null
      ? null
      : React.createElement(
        'div',
        {
          className: 'dgw-menu',
          style: {
            left: Math.max(8, Math.min(menu.x, (typeof window === 'undefined' ? menu.x : window.innerWidth - 200))),
            top: Math.max(8, Math.min(menu.y, (typeof window === 'undefined' ? menu.y : window.innerHeight - 240))),
          },
        },
        ...(menu.branch === undefined
          ? [
            menuItem('在日志中查看', () => props.onSelect(menu.tag?.name ?? null)),
            menuItem('删除标签…', () => { if (menu.tag !== undefined) props.onDeleteTag(menu.tag.name) }),
          ]
          : [
            menuItem('检出', () => { if (menu.branch !== undefined) props.onCheckout(menu.branch.name) }),
            menuItem('从此分支新建…', () => { if (menu.branch !== undefined) props.onCreateBranch(menu.branch.name) }),
            menuItem('合并到当前分支', () => { if (menu.branch !== undefined) props.onMergeBranch(menu.branch.name) }),
            menuItem('将当前分支变基到此处', () => { if (menu.branch !== undefined) props.onRebaseBranch(menu.branch.name) }),
            menuItem('重命名…', () => { if (menu.branch !== undefined) props.onRenameBranch(menu.branch.name) }),
            menuItem('删除…', () => { if (menu.branch !== undefined) props.onDeleteBranch(menu.branch.name) }),
            ...(menu.branch?.isHead === true
              ? [menuItem('强制推送（--force-with-lease）…', () => { if (menu.branch !== undefined) props.onForcePush(menu.branch.name) })]
              : []),
          ]),
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
  readonly onCherryPick: (oid: string) => void
  readonly onRevert: (oid: string) => void
  readonly onReset: (oid: string) => void
  readonly onTagCreate: (oid: string) => void
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
  const step = 12
  const height = 26
  const middle = height / 2
  const children: React.ReactElement[] = []
  props.after.forEach((_, index) => {
    children.push(React.createElement('line', {
      key: `a${index}`,
      x1: 6 + index * step, y1: middle, x2: 6 + index * step, y2: height,
      stroke: LANE_PALETTE[index % LANE_PALETTE.length], strokeWidth: 1.5,
    }))
  })
  props.before.forEach((_, index) => {
    children.push(React.createElement('line', {
      key: `b${index}`,
      x1: 6 + index * step, y1: 0, x2: 6 + index * step, y2: middle,
      stroke: LANE_PALETTE[index % LANE_PALETTE.length], strokeWidth: 1.5,
    }))
  })
  children.push(React.createElement('circle', {
    key: 'dot',
    cx: 6 + props.lane * step,
    cy: middle,
    r: 3.5,
    fill: LANE_PALETTE[props.lane % LANE_PALETTE.length],
  }))
  return React.createElement('svg', { className: 'dgw-gutter', width: props.width, height }, ...children)
}

/** Render the commit list. */
export function LogList(props: LogListProps): React.ReactElement {
  const laneCount = props.graph.reduce((max, row) => Math.max(max, row.lane + 1, row.before.length, row.after.length), 1)
  const gutterWidth = laneCount * 12 + 8
  const [menu, setMenu] = React.useState<{ readonly x: number; readonly y: number; readonly commit: CommitRow } | null>(null)

  React.useEffect(() => {
    if (menu === null) return undefined
    const close = (): void => setMenu(null)
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') close()
    }
    window.addEventListener('click', close)
    window.addEventListener('keydown', onKey)
    window.addEventListener('scroll', close, true)
    return () => {
      window.removeEventListener('click', close)
      window.removeEventListener('keydown', onKey)
      window.removeEventListener('scroll', close, true)
    }
  }, [menu])

  const menuItem = (label: string, action: () => void, key?: string): React.ReactElement => React.createElement(
    'button',
    {
      className: 'dgw-menuItem',
      type: 'button',
      key: key ?? label,
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
              onContextMenu: (event: React.MouseEvent) => {
                event.preventDefault()
                event.stopPropagation()
                setMenu({ x: event.clientX, y: event.clientY, commit })
              },
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
            React.createElement('button', {
              className: 'dgw-rowMenu',
              type: 'button',
              title: '提交操作',
              'aria-label': '提交操作',
              onClick: (event: React.MouseEvent<HTMLButtonElement>) => {
                event.stopPropagation()
                const rect = event.currentTarget.getBoundingClientRect()
                setMenu({ x: rect.left - 170, y: rect.bottom + 2, commit })
              },
            }, '⋯'),
          )
        }),
      props.hasMore
        ? React.createElement('button', { className: 'dgw-loadMore', onClick: props.onLoadMore, type: 'button' }, '加载更多')
        : null,
    ),
    menu === null
      ? null
      : React.createElement(
        'div',
        { className: 'dgw-menu', style: { left: Math.max(8, Math.min(menu.x, (typeof window === 'undefined' ? menu.x : window.innerWidth - 200))), top: Math.max(8, Math.min(menu.y, (typeof window === 'undefined' ? menu.y : window.innerHeight - 220))) } },
        menuItem('复制哈希', () => copy(menu.commit.oid)),
        menuItem('创建标签…', () => props.onTagCreate(menu.commit.oid)),
        menuItem('拣选提交', () => props.onCherryPick(menu.commit.oid)),
        menuItem('撤销提交', () => props.onRevert(menu.commit.oid)),
        menuItem('重置到此处…', () => props.onReset(menu.commit.oid)),
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

/** Commit meta props. */
export interface CommitMetaProps {
  readonly detail: CommitDetail
}

/** Render one commit's message, ref pills and authorship metadata. */
export function CommitMeta(props: CommitMetaProps): React.ReactElement {
  const detail = props.detail
  return React.createElement(
    React.Fragment,
    null,
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
  )
}

/** Commit file-list props. */
export interface CommitFilesProps {
  readonly files: readonly FileChange[]
  readonly selectedFile: string | null
  readonly onSelectFile: (path: string) => void
}

/** Render one commit's changed-file list; the diff itself stays outside. */
export function CommitFiles(props: CommitFilesProps): React.ReactElement {
  return React.createElement(
    React.Fragment,
    null,
    React.createElement('div', { className: 'dgw-sectionTitle' }, '更改的文件'),
    ...props.files.map(file => React.createElement(
      'div',
      {
        key: `${file.oldPath ?? ''}:${file.path}`,
        className: `dgw-fileRow${props.selectedFile === file.path ? ' dgw-fileRow--active' : ''}`,
        onClick: () => props.onSelectFile(file.path),
        title: file.path,
      },
      React.createElement(FileIcon, { size: 14 }),
      React.createElement('span', { className: 'dgw-filePath' }, file.path),
      React.createElement('span', { className: 'dgw-fileStat', style: { color: statusColour(file.status) } }, file.status),
      file.binary
        ? React.createElement('span', { className: 'dgw-fileStat' }, '二进制')
        : React.createElement('span', { className: 'dgw-fileStat' },
          React.createElement('span', { className: 'dgw-fileStat--add' }, `+${String(file.additions ?? 0)}`),
          ' ',
          React.createElement('span', { className: 'dgw-fileStat--del' }, `-${String(file.deletions ?? 0)}`),
        ),
    )),
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
      React.createElement(CommitMeta, { detail }),
      React.createElement(CommitFiles, {
        files: detail.files,
        selectedFile: props.selectedFile,
        onSelectFile: props.onSelectFile,
      }),
    ),
    React.createElement(DiffViewPane, {
      diff: props.diff,
      file: props.selectedFile,
      loading: props.diffLoading,
      mode: 'unified',
    }),
  )
}

/** Tag icon re-exported for the shell's empty states. */
export const DetailTagIcon = TagIcon
