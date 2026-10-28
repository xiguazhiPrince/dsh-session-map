/**
 * Tests for the update dialog: merge/rebase choice, the remember toggle and the
 * reset hand-off, plus the stored preference defaults.
 *
 * @module dsh-session-map/git-workspace/window/update-dialog.test
 */
import * as React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { UpdateDialog, readUpdateMode } from './update-dialog'

const noop = (): void => undefined

describe('UpdateDialog', () => {
  it('renders merge and rebase choices plus the reset shortcut', () => {
    const markup = renderToStaticMarkup(React.createElement(UpdateDialog, {
      mode: 'rebase',
      busy: false,
      canReset: true,
      onMode: noop,
      onReset: noop,
      onCancel: noop,
      onConfirm: noop,
    }))
    expect(markup).toContain('将传入更改合并到当前分支')
    expect(markup).toContain('在传入更改上变基当前分支')
    expect(markup).not.toContain('不再显示')
    expect(markup).toContain('重置到远程分支…')
    expect(markup).toContain('确定')
    expect(markup).toContain('取消')
    // Only the rebase radio is checked.
    const radios = markup.match(/<input[^>]*type="radio"[^>]*>/g) ?? []
    expect(radios).toHaveLength(2)
    expect(radios.filter(radio => radio.includes('checked'))).toHaveLength(1)
    expect(radios[1]).toContain('checked')
  })

  it('disables the reset shortcut without an upstream', () => {
    const markup = renderToStaticMarkup(React.createElement(UpdateDialog, {
      mode: 'merge',
      busy: false,
      canReset: false,
      onMode: noop,
      onReset: noop,
      onCancel: noop,
      onConfirm: noop,
    }))
    expect(markup).toMatch(/disabled=""[^>]*>重置到远程分支…|>重置到远程分支…/)
  })

  it('falls back to merge without stored preferences', () => {
    expect(readUpdateMode()).toBe('merge')
  })
})
