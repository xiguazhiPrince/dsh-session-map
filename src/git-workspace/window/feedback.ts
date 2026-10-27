/**
 * Shared feedback panes for the two Git carriers: the inline error banner and
 * the "not a repository" empty state. Both were private to the main panel's
 * shell; the right-column page shows the same words, so they live here.
 *
 * @module dsh-session-map/git-workspace/window/feedback
 */
import * as React from 'react'
import { describeGitError, type GitApiError } from './runtime'

/** Props for {@link ErrorBanner}. */
export interface ErrorBannerProps {
  readonly error: GitApiError | null
  readonly onRetry: () => void
}

/** Render one inline error banner. */
export function ErrorBanner(props: ErrorBannerProps): React.ReactElement | null {
  if (props.error === null) return null
  return React.createElement(
    'div',
    { className: 'dgw-error', role: 'alert' },
    React.createElement('div', { className: 'dgw-errorText' },
      describeGitError(props.error.code, props.error.message),
      props.error.detail === undefined
        ? null
        : React.createElement('pre', { className: 'dgw-errorDetail' }, props.error.detail),
    ),
    React.createElement('button', { className: 'dgw-retry', type: 'button', onClick: props.onRetry }, '重试'),
  )
}

/** Props for {@link NoRepo}. */
export interface NoRepoProps {
  readonly onRetry: () => void
}

/** Render the empty state for a workspace that has no git repository. */
export function NoRepo(props: NoRepoProps): React.ReactElement {
  return React.createElement(
    'div',
    { className: 'dgw-empty' },
    React.createElement('div', { className: 'dgw-emptyBox' },
      React.createElement('div', null, '当前工作区不是 git 仓库'),
      React.createElement('div', null, '请在工作中选择另一个目录，或先在此目录初始化 git。'),
      React.createElement('button', { className: 'dgw-retry', type: 'button', onClick: props.onRetry }, '重新检测'),
    ),
  )
}
