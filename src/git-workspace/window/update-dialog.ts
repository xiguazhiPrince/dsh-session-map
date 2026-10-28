/**
 * The "update current branch" dialog: choose merge vs rebase, optionally stop
 * asking, and jump to the existing destructive-reset flow.
 *
 * @module dsh-session-map/git-workspace/window/update-dialog
 */
import * as React from 'react'

/** How the fetched upstream is applied to the current branch. */
export type UpdateMode = 'merge' | 'rebase'

/** Stored preference for the next update. */
export interface UpdatePreference {
  readonly mode: UpdateMode
}

/** Browser-local key for the update preference. */
export const UPDATE_PREF_KEY = 'dsh.git-window.updateMode'

/** Default preference: merge. */
const DEFAULT_UPDATE_MODE: UpdateMode = 'merge'

/** Read the last chosen mode; a denied or malformed store falls back to merge. */
export function readUpdateMode(): UpdateMode {
  if (typeof localStorage === 'undefined') return DEFAULT_UPDATE_MODE
  try {
    const raw = localStorage.getItem(UPDATE_PREF_KEY)
    if (raw === null) return DEFAULT_UPDATE_MODE
    if (raw === 'rebase' || raw === 'merge') return raw
    // Legacy object form `{ mode, skipDialog }`.
    const parsed = JSON.parse(raw) as { readonly mode?: unknown }
    return parsed.mode === 'rebase' ? 'rebase' : 'merge'
  } catch {
    return DEFAULT_UPDATE_MODE
  }
}

/** Persist the last chosen mode; denial is not an error. */
export function writeUpdateMode(mode: UpdateMode): void {
  if (typeof localStorage === 'undefined') return
  try {
    localStorage.setItem(UPDATE_PREF_KEY, mode)
  } catch {
    // Private mode or blocked storage: the dialog still works for this run.
  }
}

/** Props for the update dialog. */
export interface UpdateDialogProps {
  readonly mode: UpdateMode
  readonly busy: boolean
  /** The local branch has a resolvable upstream, so reset can be offered. */
  readonly canReset: boolean
  readonly onMode: (mode: UpdateMode) => void
  readonly onReset: () => void
  readonly onCancel: () => void
  readonly onConfirm: () => void
}

/** Render IDEA-style update options. */
export function UpdateDialog(props: UpdateDialogProps): React.ReactElement {
  return React.createElement(
    'div',
    { className: 'dgw-modalBackdrop' },
    React.createElement(
      'div',
      { className: 'dgw-modal', role: 'dialog', 'aria-label': '更新当前分支' },
      React.createElement('div', { className: 'dgw-modalTitle' }, '更新当前分支'),
      React.createElement('div', { className: 'dgw-modalText' },
        '先下载远端状态，再把上游的传入更改应用到当前分支。',
      ),
      React.createElement('label', { className: 'dgw-choice' },
        React.createElement('input', {
          type: 'radio',
          name: 'dgw-update-mode',
          checked: props.mode === 'merge',
          onChange: () => props.onMode('merge'),
        }),
        '将传入更改合并到当前分支',
      ),
      React.createElement('label', { className: 'dgw-choice' },
        React.createElement('input', {
          type: 'radio',
          name: 'dgw-update-mode',
          checked: props.mode === 'rebase',
          onChange: () => props.onMode('rebase'),
        }),
        '在传入更改上变基当前分支',
      ),
      React.createElement(
        'div',
        { className: 'dgw-modalActions' },
        React.createElement('button', {
          className: 'dgw-btn',
          type: 'button',
          title: props.canReset ? '把当前分支硬重置到上游远端' : '当前分支没有可用的上游远端',
          disabled: props.busy || !props.canReset,
          onClick: props.onReset,
        }, '重置到远程分支…'),
        React.createElement('button', { className: 'dgw-btn', type: 'button', onClick: props.onCancel, disabled: props.busy }, '取消'),
        React.createElement('button', {
          className: 'dgw-btn dgw-btn--primary',
          type: 'button',
          onClick: props.onConfirm,
          disabled: props.busy,
        }, '确定'),
      ),
    ),
  )
}
