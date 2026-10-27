/**
 * Branch dialogs: create, rename and delete. They are presentation only; the
 * shell owns the action round-trip and the confirmation token for delete.
 *
 * @module dsh-session-map/git-workspace/window/branch
 */
import * as React from 'react'
import type { GitApiError } from './runtime'
import { describeGitError } from './runtime'

/** Which branch operation one dialog is collecting input for. */
export type BranchPromptKind = 'create' | 'rename' | 'delete'

/** One open branch dialog. */
export interface BranchPrompt {
  readonly kind: BranchPromptKind
  readonly branch?: string | undefined
  readonly start?: string | undefined
}

/** Props for the branch dialog modal. */
export interface BranchDialogProps {
  readonly prompt: BranchPrompt
  readonly value: string
  readonly force: boolean
  readonly busy: boolean
  readonly error: GitApiError | null
  readonly onValue: (value: string) => void
  readonly onForce: (value: boolean) => void
  readonly onCancel: () => void
  readonly onConfirm: () => void
}

/** Titles and confirm labels per operation. */
const COPY: Readonly<Record<BranchPromptKind, { readonly title: string; readonly confirm: string }>> = {
  create: { title: '新建分支', confirm: '创建并检出' },
  rename: { title: '重命名分支', confirm: '重命名' },
  delete: { title: '删除分支', confirm: '删除' },
}

/** Render one branch dialog. */
export function BranchDialog(props: BranchDialogProps): React.ReactElement {
  const copy = COPY[props.prompt.kind]
  return React.createElement(
    'div',
    { className: 'dgw-modalBackdrop' },
    React.createElement(
      'div',
      { className: 'dgw-modal', role: 'dialog', 'aria-label': copy.title },
      React.createElement('div', { className: 'dgw-modalTitle' }, copy.title),
      props.prompt.kind === 'delete'
        ? React.createElement('div', { className: 'dgw-modalText' },
          `将删除分支 ${props.prompt.branch ?? ''}。未合并的分支默认会被 git 拒绝。`,
        )
        : React.createElement(
          React.Fragment,
          null,
          React.createElement('label', { className: 'dgw-fieldLabel' }, props.prompt.kind === 'create' ? '新分支名' : '新名称'),
          React.createElement('input', {
            className: 'dgw-input',
            value: props.value,
            autoFocus: true,
            onChange: (event: React.ChangeEvent<HTMLInputElement>) => props.onValue(event.target.value),
            placeholder: props.prompt.kind === 'rename' ? (props.prompt.branch ?? '') : 'feature/my-branch',
            'aria-label': props.prompt.kind === 'create' ? '新分支名' : '新名称',
          }),
          props.prompt.kind === 'create' && props.prompt.start !== undefined
            ? React.createElement('div', { className: 'dgw-fieldLabel' }, `起点：${props.prompt.start}`)
            : null,
        ),
      props.prompt.kind === 'delete'
        ? React.createElement('label', { className: 'dgw-label' },
          React.createElement('input', {
            type: 'checkbox',
            checked: props.force,
            onChange: (event: React.ChangeEvent<HTMLInputElement>) => props.onForce(event.target.checked),
          }),
          '强制删除未合并的分支（-D）',
        )
        : null,
      props.error === null
        ? null
        : React.createElement('div', { className: 'dgw-inlineError' }, describeGitError(props.error.code, props.error.message)),
      React.createElement(
        'div',
        { className: 'dgw-modalActions' },
        React.createElement('button', { className: 'dgw-btn', type: 'button', onClick: props.onCancel, disabled: props.busy }, '取消'),
        React.createElement('button', {
          className: props.prompt.kind === 'delete' ? 'dgw-btn dgw-btn--danger' : 'dgw-btn dgw-btn--primary',
          type: 'button',
          onClick: props.onConfirm,
          disabled: props.busy,
        }, copy.confirm),
      ),
    ),
  )
}
