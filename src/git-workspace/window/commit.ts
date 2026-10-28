/**
 * Commit pane: staging, discarding and committing with server-enforced
 * confirmation. The pane never runs a git command itself; every control is a
 * round-trip that returns the command receipts the console shows.
 *
 * @module dsh-session-map/git-workspace/window/commit
 */
import * as React from 'react'
import type { ChangedEntry, RepoSnapshot } from '../git-types'
import type { GitAction } from '../git-actions'
import { GitApiError, describeGitError, waitForJob, type GitWindowApi } from './runtime'
import { ChevronIcon, FileIcon, FolderIcon } from './icons'

/** Props for the commit tab. */
export interface CommitPaneProps {
  readonly runtime: GitWindowApi
  readonly workspaceId: string
  readonly snapshot: RepoSnapshot
  /** Called after a successful write so the shell refreshes the snapshot. */
  readonly onChanged: () => void
  /**
   * Group each section's rows under their directory (right-column page).
   * Defaults to the flat list the main panel has always shown.
   */
  readonly groupByDirectory?: boolean
  /** Let a section header collapse its rows (right-column page). */
  readonly collapsibleSections?: boolean
  /** `${group}:${path}` of the row to highlight as the previewed change. */
  readonly selectedKey?: string | null
  /**
   * When provided, clicking a row previews it instead of toggling staging: the
   * checkbox keeps the staging round-trip and becomes the only toggle.
   */
  readonly onSelect?: (entry: ChangedEntry) => void
}

/** Pending destructive confirmation. */
interface DiscardRequest {
  readonly tracked: readonly string[]
  readonly untracked: readonly string[]
  readonly label: string
}

/** Normalize one thrown value. */
function asApiError(error: unknown): GitApiError {
  return error instanceof GitApiError
    ? error
    : new GitApiError('internal', error instanceof Error ? error.message : String(error))
}

/** Status colour for one change row. */
function statusColour(entry: ChangedEntry): string {
  switch (entry.status) {
    case 'A': return 'var(--dgw-added)'
    case 'D': return 'var(--dgw-deleted)'
    case 'U': return 'var(--dgw-conflict)'
    case '?': return 'var(--dgw-untracked)'
    default: return 'var(--dgw-modified)'
  }
}

/** How one row is presented and what a row click does. */
interface ChangeRowOptions {
  /** Highlight this row as the previewed change. */
  readonly selected: boolean
  /** Row click previews the entry; the checkbox owns the staging toggle. */
  readonly onSelect?: (() => void) | undefined
  /** Directory nesting depth; each level draws one guide line. */
  readonly depth?: number
  /** Text to show instead of the full path (the right-column tree shows names). */
  readonly label?: string
}

/** One directory in the right-column change tree. */
interface DirNode {
  readonly name: string
  readonly path: string
  readonly dirs: Map<string, DirNode>
  readonly files: ChangedEntry[]
}

/** Build a directory tree for one section's rows. */
function buildChangeTree(rows: readonly ChangedEntry[]): { readonly files: ChangedEntry[]; readonly dirs: DirNode[] } {
  const root: DirNode = { name: '', path: '', dirs: new Map(), files: [] }
  for (const entry of rows) {
    const parts = entry.path.split('/')
    let node = root
    for (let index = 0; index < parts.length - 1; index += 1) {
      const name = parts[index] as string
      const path = node.path === '' ? name : `${node.path}/${name}`
      let child = node.dirs.get(name)
      if (child === undefined) {
        child = { name, path, dirs: new Map(), files: [] }
        node.dirs.set(name, child)
      }
      node = child
    }
    node.files.push(entry)
  }
  const sort = (node: DirNode): void => {
    node.files.sort((left, right) => left.path.localeCompare(right.path))
    for (const child of node.dirs.values()) sort(child)
  }
  sort(root)
  return { files: root.files, dirs: [...root.dirs.values()] }
}

/** Total files under one directory node (including nested directories). */
function countFiles(node: DirNode): number {
  let total = node.files.length
  for (const child of node.dirs.values()) total += countFiles(child)
  return total
}

/** IDEA-style single-child chains collapsed into one row. */
function compactDir(node: DirNode): { readonly node: DirNode; readonly label: string } {
  let current = node
  let label = node.name
  while (current.files.length === 0 && current.dirs.size === 1) {
    const only = [...current.dirs.values()][0]
    if (only === undefined) break
    label += `/${only.name}`
    current = only
  }
  return { node: current, label }
}

/** One guide line per nesting level. */
function depthGuides(depth: number, prefix: string): React.ReactNode[] {
  return Array.from({ length: depth }, (_, index) =>
    React.createElement('span', { className: 'dgw-changeGuide', key: `${prefix}-g${index}` }))
}

/** Render one change row. */
function changeRow(
  entry: ChangedEntry,
  checked: boolean,
  disabled: boolean,
  onToggle: () => void,
  onDiscard: (() => void) | undefined,
  options: ChangeRowOptions,
): React.ReactElement {
  const activate = options.onSelect ?? onToggle
  const depth = options.depth ?? 0
  const classes = [
    'dgw-changeRow',
    options.selected ? 'dgw-changeRow--active' : '',
  ].filter(part => part !== '').join(' ')
  const fullPath = entry.oldPath === undefined ? entry.path : `${entry.oldPath} → ${entry.path}`
  const label = options.label ?? fullPath
  const checkbox = options.onSelect === undefined
    ? React.createElement('span', { className: 'dgw-checkbox', 'data-checked': checked, 'aria-hidden': true }, checked ? '✓' : '')
    : React.createElement('button', {
      className: 'dgw-checkbox dgw-checkbox--button',
      type: 'button',
      'data-checked': checked,
      'aria-pressed': checked,
      title: checked ? '取消暂存' : '暂存',
      'aria-label': checked ? '取消暂存' : '暂存',
      onClick: (event: React.MouseEvent) => {
        event.stopPropagation()
        onToggle()
      },
    }, checked ? '✓' : '')
  return React.createElement(
    'div',
    {
      key: `${entry.group}:${entry.path}`,
      className: classes,
      style: { paddingLeft: 8 + depth * 12 },
      onClick: disabled ? undefined : activate,
      title: fullPath,
    },
    ...depthGuides(depth, entry.path),
    checkbox,
    React.createElement(FileIcon, { size: 13 }),
    React.createElement('span', { className: 'dgw-changePath' }, label),
    React.createElement('span', { className: 'dgw-changeStatus', style: { color: statusColour(entry) } }, entry.status),
    onDiscard === undefined
      ? null
      : React.createElement('button', {
        className: 'dgw-discard',
        type: 'button',
        title: '丢弃更改',
        onClick: (event: React.MouseEvent) => {
          event.stopPropagation()
          onDiscard()
        },
      }, '丢弃'),
  )
}

/** Render the commit tab. */
export function CommitPane(props: CommitPaneProps): React.ReactElement {
  const { runtime, workspaceId, snapshot, onChanged } = props
  const [message, setMessage] = React.useState('')
  const [amend, setAmend] = React.useState(false)
  const [busy, setBusy] = React.useState(false)
  const [error, setError] = React.useState<GitApiError | null>(null)
  const [discardRequest, setDiscardRequest] = React.useState<DiscardRequest | null>(null)
  const [dropStashPending, setDropStashPending] = React.useState(false)
  const [collapsedDirs, setCollapsedDirs] = React.useState<Record<string, boolean>>({})
  const [collapsedSections, setCollapsedSections] = React.useState<Record<string, boolean>>({})

  const staged = snapshot.changes.filter(entry => entry.group === 'staged')
  const unstaged = snapshot.changes.filter(entry => entry.group === 'unstaged')
  const untracked = snapshot.changes.filter(entry => entry.group === 'untracked')
  const conflicts = snapshot.changes.filter(entry => entry.group === 'conflict')
  const clean = staged.length + unstaged.length + untracked.length + conflicts.length === 0

  const run = async (action: GitAction, confirmToken?: string): Promise<boolean> => {
    setBusy(true)
    setError(null)
    try {
      await runtime.action(action, confirmToken)
      onChanged()
      return true
    } catch (failure) {
      setError(asApiError(failure))
      return false
    } finally {
      setBusy(false)
    }
  }

  const toggle = async (entry: ChangedEntry): Promise<void> => {
    if (busy) return
    if (entry.group === 'staged') {
      await run({ kind: 'unstage', workspaceId, paths: [entry.path] })
    } else if (entry.group === 'unstaged' || entry.group === 'untracked') {
      await run({ kind: 'stage', workspaceId, paths: [entry.path] })
    }
  }

  const requestDiscard = (entry: ChangedEntry): void => {
    if (entry.group === 'untracked') {
      setDiscardRequest({ tracked: [], untracked: [entry.path], label: entry.path })
    } else if (entry.group === 'unstaged') {
      setDiscardRequest({ tracked: [entry.path], untracked: [], label: entry.path })
    }
  }

  const confirmDiscard = async (): Promise<void> => {
    const request = discardRequest
    if (request === null) return
    setBusy(true)
    setError(null)
    try {
      const action: GitAction = {
        kind: 'discard',
        workspaceId,
        tracked: request.tracked,
        untracked: request.untracked,
      }
      const confirmation = await runtime.confirm(action)
      await runtime.action(action, confirmation.token)
      setDiscardRequest(null)
      onChanged()
    } catch (failure) {
      setError(asApiError(failure))
    } finally {
      setBusy(false)
    }
  }

  const commit = async (push: boolean): Promise<void> => {
    const text = message.trim()
    if (text === '' || busy) return
    const action: GitAction = { kind: 'commit', workspaceId, message: text, amend }
    setBusy(true)
    setError(null)
    try {
      await runtime.action(action)
      if (push) {
        const branch = snapshot.head.branch
        if (branch === null) throw new GitApiError('detached-head', 'HEAD is detached')
        const remote = snapshot.remotes[0]?.name
        const needsUpstream = snapshot.head.upstream === null
        if (needsUpstream && remote === undefined) {
          throw new GitApiError('no-upstream', 'no remote is configured')
        }
        await runtime.action({
          kind: 'push',
          workspaceId,
          ...(needsUpstream && remote !== undefined
            ? { remote, branch, setUpstream: true }
            : {}),
        }).then(async (result) => {
          if (result.job === undefined) return
          const settled = await waitForJob(runtime, result.job.id)
          if (settled.status === 'failed') {
            throw new GitApiError(
              settled.error?.code ?? 'internal',
              settled.error?.message ?? 'the push failed',
              settled.error?.detail,
            )
          }
          if (settled.status === 'cancelled') {
            throw new GitApiError('cancelled', '推送已取消')
          }
        })
      }
      setMessage('')
      setAmend(false)
      onChanged()
    } catch (failure) {
      setError(asApiError(failure))
    } finally {
      setBusy(false)
    }
  }

  /** Drop the latest stash after an explicit confirmation token. */
  const confirmDropStash = async (): Promise<void> => {
    setBusy(true)
    setError(null)
    try {
      const action: GitAction = { kind: 'stashDrop', workspaceId }
      const confirmation = await runtime.confirm(action)
      await runtime.action(action, confirmation.token)
      setDropStashPending(false)
      onChanged()
    } catch (failure) {
      setError(asApiError(failure))
    } finally {
      setBusy(false)
    }
  }

  const sections: Array<{ title: string; rows: ChangedEntry[]; checked: boolean; discardable: boolean }> = [
    { title: `冲突 (${conflicts.length})`, rows: conflicts, checked: false, discardable: false },
    { title: `暂存区 (${staged.length})`, rows: staged, checked: true, discardable: false },
    { title: `未暂存 (${unstaged.length})`, rows: unstaged, checked: false, discardable: true },
    { title: `未版本控制 (${untracked.length})`, rows: untracked, checked: false, discardable: true },
  ]

  /** Render one section's rows, flat or as a nested directory tree. */
  const renderRows = (rows: readonly ChangedEntry[], checked: boolean, discardable: boolean): React.ReactNode[] => {
    const nodes: React.ReactNode[] = []
    const emit = (entry: ChangedEntry, depth: number): void => {
      nodes.push(changeRow(
        entry,
        checked,
        busy || entry.group === 'conflict',
        () => { void toggle(entry) },
        discardable ? () => requestDiscard(entry) : undefined,
        {
          selected: props.selectedKey === `${entry.group}:${entry.path}`,
          ...(props.onSelect === undefined ? {} : { onSelect: () => { props.onSelect?.(entry) } }),
          depth,
          label: entry.path.split('/').pop() ?? entry.path,
        },
      ))
    }
    if (props.groupByDirectory !== true) {
      for (const entry of rows) emit(entry, 0)
      return nodes
    }
    const tree = buildChangeTree(rows)
    for (const entry of tree.files) emit(entry, 0)
    const emitDir = (raw: DirNode, depth: number): void => {
      const { node, label } = compactDir(raw)
      const open = collapsedDirs[node.path] !== true
      nodes.push(React.createElement(
        'button',
        {
          key: `dir:${node.path}`,
          className: 'dgw-changeDir',
          type: 'button',
          title: node.path,
          style: { paddingLeft: 8 + depth * 12 },
          onClick: () => setCollapsedDirs(state => ({ ...state, [node.path]: open })),
        },
        ...depthGuides(depth, node.path),
        React.createElement('span', { className: 'dgw-changeChevron', 'data-open': open ? 'true' : 'false' },
          React.createElement(ChevronIcon, { size: 11 }),
        ),
        React.createElement(FolderIcon, { size: 13 }),
        React.createElement('span', { className: 'dgw-changeDirName' }, label),
        React.createElement('span', { className: 'dgw-changeDirCount' }, `${countFiles(node)} 个文件`),
      ))
      if (!open) return
      for (const child of node.dirs.values()) emitDir(child, depth + 1)
      for (const entry of node.files) emit(entry, depth + 1)
    }
    for (const dir of tree.dirs) emitDir(dir, 0)
    return nodes
  }

  /** Render one section header (collapsible when asked) plus its rows. */
  const renderSection = (section: { title: string; rows: ChangedEntry[]; checked: boolean; discardable: boolean }): React.ReactElement => {
    const collapsible = props.collapsibleSections === true
    const open = !collapsible || collapsedSections[section.title] !== true
    return React.createElement(
      'div',
      { className: 'dgw-changeSection', key: section.title },
      collapsible
        ? React.createElement(
          'button',
          {
            className: 'dgw-changeHead dgw-changeHead--button',
            type: 'button',
            onClick: () => setCollapsedSections(state => ({ ...state, [section.title]: open })),
          },
          React.createElement('span', { className: 'dgw-changeChevron', 'data-open': open ? 'true' : 'false' },
            React.createElement(ChevronIcon, { size: 11 }),
          ),
          section.title,
        )
        : React.createElement('div', { className: 'dgw-changeHead' }, section.title),
      open ? renderRows(section.rows, section.checked, section.discardable) : null,
    )
  }

  return React.createElement(
    'div',
    { className: 'dgw-commit' },
    React.createElement(
      'div',
      { className: 'dgw-changeScroll' },
      clean
        ? React.createElement('div', { className: 'dgw-empty' },
          React.createElement('div', { className: 'dgw-emptyBox' }, '没有要提交的内容，工作树是干净的'),
        )
        : sections.filter(section => section.rows.length > 0).map(section => renderSection(section)),
    ),
    React.createElement(
      'div',
      { className: 'dgw-commitForm' },
      React.createElement('textarea', {
        className: 'dgw-textarea',
        placeholder: '提交信息',
        value: message,
        onChange: (event: React.ChangeEvent<HTMLTextAreaElement>) => setMessage(event.target.value),
        'aria-label': '提交信息',
      }),
      error === null
        ? null
        : React.createElement('div', { className: 'dgw-inlineError' },
          describeGitError(error.code, error.message),
          error.detail === undefined ? null : `\n${error.detail}`,
        ),
      React.createElement(
        'div',
        { className: 'dgw-formRow' },
        React.createElement('label', { className: 'dgw-label' },
          React.createElement('input', {
            type: 'checkbox',
            checked: amend,
            onChange: (event: React.ChangeEvent<HTMLInputElement>) => setAmend(event.target.checked),
          }),
          '修正上次提交',
        ),
        React.createElement('button', {
          className: 'dgw-btn',
          type: 'button',
          disabled: busy,
          title: '把当前工作区更改放进 git stash（含未跟踪文件）',
          onClick: () => { void run({ kind: 'stashPush', workspaceId, includeUntracked: true, message: 'WIP from Git tool window' }) },
        }, '搁置'),
        React.createElement('button', {
          className: 'dgw-btn',
          type: 'button',
          disabled: busy || snapshot.stashCount === 0,
          title: '弹出最近一次搁置',
          onClick: () => { void run({ kind: 'stashPop', workspaceId }) },
        }, '弹出搁置'),
        React.createElement('button', {
          className: 'dgw-btn',
          type: 'button',
          disabled: busy || snapshot.stashCount === 0,
          title: '删除最近一次搁置（不会应用内容）',
          onClick: () => setDropStashPending(true),
        }, '丢弃搁置'),
        React.createElement('span', { className: 'dgw-spacer' }),
        React.createElement('span', { className: 'dgw-meta' }, `已暂存 ${staged.length}`),
        React.createElement('button', {
          className: 'dgw-btn',
          type: 'button',
          disabled: busy || message.trim() === '' || staged.length === 0 || conflicts.length > 0,
          onClick: () => { void commit(false) },
        }, '提交'),
        React.createElement('button', {
          className: 'dgw-btn dgw-btn--primary',
          type: 'button',
          disabled: busy || message.trim() === '' || staged.length === 0 || conflicts.length > 0,
          onClick: () => { void commit(true) },
        }, '提交并推送'),
      ),
    ),
    discardRequest === null
      ? null
      : React.createElement(
        'div',
        { className: 'dgw-modalBackdrop' },
        React.createElement(
          'div',
          { className: 'dgw-modal', role: 'alertdialog', 'aria-label': '确认丢弃更改' },
          React.createElement('div', { className: 'dgw-modalTitle' }, '确认丢弃更改'),
          React.createElement('div', { className: 'dgw-modalText' },
            discardRequest.untracked.length > 0
              ? `将永久删除 ${discardRequest.label}，此操作不可撤销。`
              : `将把 ${discardRequest.label} 恢复到上次提交的内容，此操作不可撤销。`,
          ),
          React.createElement(
            'div',
            { className: 'dgw-modalActions' },
            React.createElement('button', { className: 'dgw-btn', type: 'button', onClick: () => setDiscardRequest(null), disabled: busy }, '取消'),
            React.createElement('button', { className: 'dgw-btn dgw-btn--danger', type: 'button', onClick: () => { void confirmDiscard() }, disabled: busy },
              discardRequest.untracked.length > 0 ? '永久删除' : '丢弃更改'),
          ),
        ),
      ),
    dropStashPending
      ? React.createElement(
        'div',
        { className: 'dgw-modalBackdrop' },
        React.createElement(
          'div',
          { className: 'dgw-modal', role: 'alertdialog', 'aria-label': '确认丢弃搁置' },
          React.createElement('div', { className: 'dgw-modalTitle' }, '确认丢弃搁置'),
          React.createElement('div', { className: 'dgw-modalText' },
            '将永久删除最近一次搁置（不会应用其中的内容），此操作不可撤销。',
          ),
          React.createElement(
            'div',
            { className: 'dgw-modalActions' },
            React.createElement('button', { className: 'dgw-btn', type: 'button', onClick: () => setDropStashPending(false), disabled: busy }, '取消'),
            React.createElement('button', { className: 'dgw-btn dgw-btn--danger', type: 'button', onClick: () => { void confirmDropStash() }, disabled: busy }, '删除搁置'),
          ),
        ),
      )
      : null,
  )
}
