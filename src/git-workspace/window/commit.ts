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
import { GitApiError, describeGitError, type GitWindowApi } from './runtime'
import { FileIcon } from './icons'

/** Props for the commit tab. */
export interface CommitPaneProps {
  readonly runtime: GitWindowApi
  readonly workspaceId: string
  readonly snapshot: RepoSnapshot
  /** Called after a successful write so the shell refreshes the snapshot. */
  readonly onChanged: () => void
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

/** Render one change row. */
function changeRow(
  entry: ChangedEntry,
  checked: boolean,
  disabled: boolean,
  onToggle: () => void,
  onDiscard: (() => void) | undefined,
): React.ReactElement {
  return React.createElement(
    'div',
    {
      key: `${entry.group}:${entry.path}`,
      className: 'dgw-changeRow',
      onClick: disabled ? undefined : onToggle,
      title: entry.oldPath === undefined ? entry.path : `${entry.oldPath} → ${entry.path}`,
    },
    React.createElement('span', {
      className: 'dgw-checkbox',
      'data-checked': checked,
      'aria-hidden': true,
    }, checked ? '✓' : ''),
    React.createElement(FileIcon, { size: 13 }),
    React.createElement('span', { className: 'dgw-changePath' },
      entry.oldPath === undefined ? entry.path : `${entry.oldPath} → ${entry.path}`,
    ),
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

  const sections: Array<{ title: string; rows: ChangedEntry[]; checked: boolean; discardable: boolean }> = [
    { title: `冲突 (${conflicts.length})`, rows: conflicts, checked: false, discardable: false },
    { title: `暂存区 (${staged.length})`, rows: staged, checked: true, discardable: false },
    { title: `未暂存 (${unstaged.length})`, rows: unstaged, checked: false, discardable: true },
    { title: `未版本控制 (${untracked.length})`, rows: untracked, checked: false, discardable: true },
  ]

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
        : sections.filter(section => section.rows.length > 0).map(section => React.createElement(
          'div',
          { className: 'dgw-changeSection', key: section.title },
          React.createElement('div', { className: 'dgw-changeHead' }, section.title),
          ...section.rows.map(entry => changeRow(
            entry,
            section.checked,
            busy || entry.group === 'conflict',
            () => { void toggle(entry) },
            section.discardable ? () => requestDiscard(entry) : undefined,
          )),
        )),
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
  )
}
