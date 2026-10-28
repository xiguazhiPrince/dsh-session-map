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
  readonly skipDialog: boolean
}

/** Browser-local key for the update preference. */
export const UPDATE_PREF_KEY = 'dsh.git-window.updateMode'

/** Default preference: merge, ask every time. */
const DEFAULT_UPDATE_PREFERENCE: UpdatePreference = { mode: 'merge', skipDialog: false }

/** Read the saved update preference; a denied store falls back to the default. */
export function readUpdatePreference(): UpdatePreference {
  if (typeof localStorage === 'undefined') return DEFAULT_UPDATE_PREFERENCE
  try {
    const raw = localStorage.getItem(UPDATE_PREF_KEY)
    if (raw === null) return DEFAULT_UPDATE_PREFERENCE
    const parsed = JSON.parse(raw) as { readonly mode?: unknown; readonly skipDialog?: unknown }
    return {
      mode: parsed.mode === 'rebase' ? 'rebase' : 'merge',
      skipDialog: parsed.skipDialog === true,
    }
  } catch {
    return DEFAULT_UPDATE_PREFERENCE
  }
}

/** Persist the update preference; denial is not an error. */
export function writeUpdatePreference(preference: UpdatePreference): void {
  if (typeof localStorage === 'undefined') return
  try {
    localStorage.setItem(UPDATE_PREF_KEY, JSON.stringify(preference))
  } catch {
    // Private mode or blocked storage: the dialog still works for this run.
  }
}

/** Props for the update dialog. */
export interface UpdateDialogProps {
  readonly mode: UpdateMode
  readonly remember: boolean
  readonly busy: boolean
  /** The local branch has a resolvable upstream, so reset can be offered. */
  readonly canReset: boolean
  readonly onMode: (mode: UpdateMode) => void
  readonly onRemember: (remember: boolean) => void
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
      React.createElement('label', { className: 'dgw-choice' },
        React.createElement('input', {
          type: 'checkbox',
          checked: props.remember,
          onChange: (event: React.ChangeEvent<HTMLInputElement>) => props.onRemember(event.target.checked),
        }),
        '不再显示',
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
