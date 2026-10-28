/**
 * SSR tests for the push preview dialog.
 *
 * @module dsh-session-map/git-workspace/window/push-dialog.test
 */
import * as React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import type { PushPreview } from '../git-types'
import { PushDialog } from './push-dialog'

const noop = (): void => undefined

const PREVIEW: PushPreview = {
  upstream: 'origin/feature/aic',
  commits: [{
    oid: '1111111111111111111111111111111111111111',
    shortOid: '1111111',
    parents: ['parent'],
    author: { name: 'watermelon', email: 'w@example.com', date: '2026-10-27T15:04:00+08:00' },
    committer: { name: 'watermelon', email: 'w@example.com', date: '2026-10-27T15:04:00+08:00' },
    subject: 'feat(aic): M1 录入、删除撤回',
    decorations: [],
    refs: { branches: [], remoteBranches: [], tags: [] },
  }],
  files: [{ path: 'server/aic/src/run.ts', status: 'M', additions: 3, deletions: 1, binary: false }],
  truncated: false,
}

describe('PushDialog', () => {
  it('shows the target, commits and files before pushing', () => {
    const markup = renderToStaticMarkup(React.createElement(PushDialog, {
      branch: 'feature/aic',
      remote: 'origin',
      upstream: 'origin/feature/aic',
      preview: PREVIEW,
      loading: false,
      error: null,
      busy: false,
      onPush: noop,
      onCancel: noop,
    }))
    expect(markup).toContain('feature/aic → origin/feature/aic')
    expect(markup).toContain('待推送提交（1）')
    expect(markup).toContain('feat(aic): M1 录入、删除撤回')
    expect(markup).toContain('server/aic/src/run.ts')
    expect(markup).toContain('推送')
  })

  it('explains a first push without upstream', () => {
    const markup = renderToStaticMarkup(React.createElement(PushDialog, {
      branch: 'feature/aic',
      remote: 'origin',
      upstream: null,
      preview: { upstream: null, commits: [], files: [], truncated: false },
      loading: false,
      error: null,
      busy: false,
      onPush: noop,
      onCancel: noop,
    }))
    expect(markup).toContain('（将建立上游跟踪）')
    expect(markup).toContain('当前分支还没有上游，无法预览待推送提交')
  })
})
