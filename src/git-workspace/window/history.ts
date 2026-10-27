/**
 * Reset and tag dialogs: presentation only. The shell owns the confirmation
 * token for reset and the action round-trip for both.
 *
 * @module dsh-session-map/git-workspace/window/history
 */
import * as React from 'react'
import type { GitApiError } from './runtime'
import { describeGitError } from './runtime'

/** Props for the tag-creation modal. */
export interface TagDialogProps {
  readonly hash: string
  readonly value: string
  readonly busy: boolean
  readonly error: GitApiError | null
  readonly onValue: (value: string) => void
  readonly onCancel: () => void
  readonly onConfirm: () => void
}

/** Render the tag-creation dialog. */
export function TagDialog(props: TagDialogProps): React.ReactElement {
  return React.createElement(
    'div',
    { className: 'dgw-modalBackdrop' },
    React.createElement(
      'div',
      { className: 'dgw-modal', role: 'dialog', 'aria-label': '创建标签' },
      React.createElement('div', { className: 'dgw-modalTitle' }, '创建标签'),
      React.createElement('div', { className: 'dgw-modalText' },
        `在提交 ${props.hash.slice(0, 8)} 上创建一个轻量标签。`,
      ),
      React.createElement('input', {
        className: 'dgw-input',
        value: props.value,
        autoFocus: true,
        placeholder: 'v1.0.0',
        onChange: (event: React.ChangeEvent<HTMLInputElement>) => props.onValue(event.target.value),
        'aria-label': '标签名',
      }),
      props.error === null
        ? null
        : React.createElement('div', { className: 'dgw-inlineError' }, describeGitError(props.error.code, props.error.message)),
      React.createElement(
        'div',
        { className: 'dgw-modalActions' },
        React.createElement('button', { className: 'dgw-btn', type: 'button', onClick: props.onCancel, disabled: props.busy }, '取消'),
        React.createElement('button', {
          className: 'dgw-btn dgw-btn--primary',
          type: 'button',
          onClick: props.onConfirm,
          disabled: props.busy,
        }, '创建'),
      ),
    ),
  )
}

/** Props for the tag-deletion modal. */
export interface TagDeleteDialogProps {
  readonly name: string
  readonly busy: boolean
  readonly error: GitApiError | null
  readonly onCancel: () => void
  readonly onConfirm: () => void
}

/** Render the tag-deletion confirmation. */
export function TagDeleteDialog(props: TagDeleteDialogProps): React.ReactElement {
  return React.createElement(
    'div',
    { className: 'dgw-modalBackdrop' },
    React.createElement(
      'div',
      { className: 'dgw-modal', role: 'alertdialog', 'aria-label': '删除标签' },
      React.createElement('div', { className: 'dgw-modalTitle' }, '删除标签'),
      React.createElement('div', { className: 'dgw-modalText' },
        `将删除标签 ${props.name}。本地删除不会影响远端，除非另行推送删除。`,
      ),
      props.error === null
        ? null
        : React.createElement('div', { className: 'dgw-inlineError' }, describeGitError(props.error.code, props.error.message)),
      React.createElement(
        'div',
        { className: 'dgw-modalActions' },
        React.createElement('button', { className: 'dgw-btn', type: 'button', onClick: props.onCancel, disabled: props.busy }, '取消'),
        React.createElement('button', {
          className: 'dgw-btn dgw-btn--danger',
          type: 'button',
          onClick: props.onConfirm,
          disabled: props.busy,
        }, '删除标签'),
      ),
    ),
  )
}

/** Props for the forced-push confirmation. */
export interface ForcePushDialogProps {
  readonly branch: string
  readonly busy: boolean
  readonly error: GitApiError | null
  readonly onCancel: () => void
  readonly onConfirm: () => void
}

/** Render the forced-push confirmation. */
export function ForcePushDialog(props: ForcePushDialogProps): React.ReactElement {
  return React.createElement(
    'div',
    { className: 'dgw-modalBackdrop' },
    React.createElement(
      'div',
      { className: 'dgw-modal', role: 'alertdialog', 'aria-label': '强制推送' },
      React.createElement('div', { className: 'dgw-modalTitle' }, '强制推送（--force-with-lease）'),
      React.createElement('div', { className: 'dgw-modalText' },
        `将用本地 ${props.branch} 覆盖远端同名分支。若远端已有他人的新提交，lease 校验会拒绝本次推送；否则远端历史会被改写，影响其他协作者。`,
      ),
      props.error === null
        ? null
        : React.createElement('div', { className: 'dgw-inlineError' }, describeGitError(props.error.code, props.error.message)),
      React.createElement(
        'div',
        { className: 'dgw-modalActions' },
        React.createElement('button', { className: 'dgw-btn', type: 'button', onClick: props.onCancel, disabled: props.busy }, '取消'),
        React.createElement('button', {
          className: 'dgw-btn dgw-btn--danger',
          type: 'button',
          onClick: props.onConfirm,
          disabled: props.busy,
        }, '强制推送'),
      ),
    ),
  )
}

/** Reset modes the UI offers. */
export type ResetMode = 'soft' | 'mixed' | 'hard'

/** Props for the reset modal. */
export interface ResetDialogProps {
  readonly hash: string
  readonly mode: ResetMode
  readonly busy: boolean
  readonly error: GitApiError | null
  readonly onMode: (mode: ResetMode) => void
  readonly onCancel: () => void
  readonly onConfirm: () => void
}

/** Render the reset dialog. */
export function ResetDialog(props: ResetDialogProps): React.ReactElement {
  return React.createElement(
    'div',
    { className: 'dgw-modalBackdrop' },
    React.createElement(
      'div',
      { className: 'dgw-modal', role: 'dialog', 'aria-label': '重置当前分支' },
      React.createElement('div', { className: 'dgw-modalTitle' }, '重置当前分支'),
      React.createElement('div', { className: 'dgw-modalText' },
        `把当前分支重置到 ${props.hash.slice(0, 8)}。`,
      ),
      React.createElement(
        'select',
        {
          className: 'dgw-select',
          value: props.mode,
          onChange: (event: React.ChangeEvent<HTMLSelectElement>) => props.onMode(event.target.value as ResetMode),
          'aria-label': '重置模式',
        },
        React.createElement('option', { value: 'soft' }, 'Soft：移动 HEAD，保留暂存区和工作区'),
        React.createElement('option', { value: 'mixed' }, 'Mixed：移动 HEAD，保留工作区，清空暂存区'),
        React.createElement('option', { value: 'hard' }, 'Hard：移动 HEAD，丢弃暂存区和工作区更改'),
      ),
      props.mode === 'hard'
        ? React.createElement('div', { className: 'dgw-inlineError' }, 'Hard 模式会丢失未提交的更改，此操作不可撤销。')
        : null,
      props.error === null
        ? null
        : React.createElement('div', { className: 'dgw-inlineError' }, describeGitError(props.error.code, props.error.message)),
      React.createElement(
        'div',
        { className: 'dgw-modalActions' },
        React.createElement('button', { className: 'dgw-btn', type: 'button', onClick: props.onCancel, disabled: props.busy }, '取消'),
        React.createElement('button', {
          className: props.mode === 'hard' ? 'dgw-btn dgw-btn--danger' : 'dgw-btn dgw-btn--primary',
          type: 'button',
          onClick: props.onConfirm,
          disabled: props.busy,
        }, '重置'),
      ),
    ),
  )
}
