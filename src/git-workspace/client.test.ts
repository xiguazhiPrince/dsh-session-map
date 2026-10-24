/**
 * Settings page rendering smoke test: build the real page over a fake runtime
 * and render it with React's server renderer. The page is one slot component,
 * so this catches a broken element tree without a browser.
 *
 * @module dsh-session-map/git-workspace/client.test
 */
import * as React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import {
  createGitWorkspaceSettings,
  type GitWorkspaceRuntime,
  type GitWorkspaceState,
} from './client'

/** A runtime whose Host round-trips never leave the process. */
function runtime(overrides: Partial<GitWorkspaceRuntime> = {}): GitWorkspaceRuntime {
  const state: GitWorkspaceState = {
    gitAvailable: true,
    defaultParentDir: '/Users/you/projects',
  }
  return {
    pickDirectory: async () => '/Users/you/projects',
    loadState: async () => state,
    clone: async () => ({
      ok: true,
      workspace: { id: 'workspace-1', path: '/Users/you/projects/repo', title: 'repo' },
    }),
    ...overrides,
  }
}

/** Render the page body. */
function render(overrides: Partial<GitWorkspaceRuntime> = {}): string {
  const Settings = createGitWorkspaceSettings(runtime(overrides))
  return renderToStaticMarkup(React.createElement(Settings))
}

describe('Git workspace settings page', () => {
  it('renders the three requested inputs and the clone action', () => {
    const markup = render()
    expect(markup).toContain('从 Git 克隆工作区')
    expect(markup).toContain('仓库地址')
    expect(markup).toContain('https://github.com/owner/repo.git')
    expect(markup).toContain('存放目录')
    expect(markup).toContain('选择…')
    expect(markup).toContain('浅克隆')
    expect(markup).toContain('type="submit"')
  })

  it('draws the shallow switch as an off switch by default (full clone)', () => {
    const markup = render()
    expect(markup).toContain('role="switch"')
    expect(markup).toContain('aria-checked="false"')
  })

  it('renders its own stylesheet and theme-token classes', () => {
    const markup = render()
    expect(markup).toContain('<style>')
    expect(markup).toContain('--dsw-alias-brand-primary')
    expect(markup).toContain('--dsw-alias-label-secondary')
  })
})
