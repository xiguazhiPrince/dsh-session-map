/**
 * Push preview dialog: what would be sent to the upstream, shown before the
 * push job starts.
 *
 * @module dsh-session-map/git-workspace/window/push-dialog
 */
import * as React from 'react'
import type { PushPreview } from '../git-types'

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
  readonly onPush: () => void
  readonly onCancel: () => void
}

/** Render one push-preview row's stat summary. */
function fileStats(additions: number | null, deletions: number | null, binary: boolean): string {
  if (binary) return '二进制'
  return `+${additions ?? 0} −${deletions ?? 0}`
}

/** Render the push preview. */
export function PushDialog(props: PushDialogProps): React.ReactElement {
  const target = props.upstream ?? `${props.remote ?? 'origin'}/${props.branch}`
  const createsUpstream = props.upstream === null
  return React.createElement(
    'div',
    { className: 'dgw-modalBackdrop' },
    React.createElement(
      'div',
      { className: 'dgw-modal dgw-modal--wide', role: 'dialog', 'aria-label': '推送当前分支' },
      React.createElement('div', { className: 'dgw-modalTitle' }, '推送当前分支'),
      React.createElement('div', { className: 'dgw-modalText' },
        `${props.branch} → ${target}`,
        createsUpstream ? '（将建立上游跟踪）' : '',
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
          { className: 'dgw-pushPreview' },
          React.createElement('div', { className: 'dgw-pushSectionHead' },
            createsUpstream ? '当前分支还没有上游，无法预览待推送提交' : `待推送提交（${props.preview.commits.length}）`,
          ),
          createsUpstream
            ? null
            : React.createElement('div', { className: 'dgw-pushCommits' },
              ...props.preview.commits.map(commit => React.createElement(
                'div',
                { className: 'dgw-pushCommit', key: commit.oid },
                React.createElement('span', { className: 'dgw-hash' }, commit.shortOid),
                React.createElement('span', { className: 'dgw-pushSubject', title: commit.subject }, commit.subject),
                React.createElement('span', { className: 'dgw-meta' }, commit.author.name),
              )),
            ),
          React.createElement('div', { className: 'dgw-pushSectionHead' },
            `变更文件（${props.preview.files.length}）`,
          ),
          React.createElement('div', { className: 'dgw-pushFiles' },
            ...props.preview.files.map(file => React.createElement(
              'div',
              { className: 'dgw-pushFile', key: file.path },
              React.createElement('span', { className: 'dgw-pushFileStatus' }, file.status),
              React.createElement('span', { className: 'dgw-pushFilePath', title: file.path }, file.path),
              React.createElement('span', { className: 'dgw-meta' }, fileStats(file.additions, file.deletions, file.binary)),
            )),
          ),
          props.preview.truncated
            ? React.createElement('div', { className: 'dgw-meta' }, '提交较多，仅显示最近 100 条')
            : null,
        ),
      React.createElement(
        'div',
        { className: 'dgw-modalActions' },
        React.createElement('button', { className: 'dgw-btn', type: 'button', onClick: props.onCancel, disabled: props.busy }, '取消'),
        React.createElement('button', {
          className: 'dgw-btn dgw-btn--primary',
          type: 'button',
          onClick: props.onPush,
          disabled: props.busy || props.loading || props.preview === null,
        }, '推送'),
      ),
    ),
  )
}
