/**
 * Diff presentation tests: the pairing rule as a pure function, and the two
 * rendered presentations plus their empty states.
 *
 * @module dsh-session-map/git-workspace/window/diff-view.test
 */
import * as React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import type { DiffHunk, DiffView as DiffPayload } from '../git-types'
import { DiffView, diffStats, pairDiffRows } from './diff-view'

/** One hunk: two context lines, one removed line and two added ones. */
const HUNK: DiffHunk = {
  oldStart: 10,
  oldLines: 4,
  newStart: 10,
  newLines: 5,
  lines: [
    { kind: ' ', text: '  const a = 1', oldLine: 10, newLine: 10 },
    { kind: '-', text: '  return legacy()', oldLine: 11, newLine: null },
    { kind: '+', text: '  const dock = useDock()', oldLine: null, newLine: 11 },
    { kind: '+', text: '  return render(dock)', oldLine: null, newLine: 12 },
    { kind: ' ', text: '}', oldLine: 12, newLine: 13 },
  ],
}

/** A parsed diff over {@link HUNK}. */
const DIFF: DiffPayload = { path: 'src/app.ts', binary: false, truncated: false, hunks: [HUNK] }

describe('pairDiffRows', () => {
  it('pairs a removal run with the addition run that follows it', () => {
    const rows = pairDiffRows([HUNK])
    expect(rows[0]).toEqual({ kind: 'hunk', text: '@@ -10,4 +10,5 @@' })
    const pairs = rows.filter(row => row.kind === 'pair')
    expect(pairs).toHaveLength(4)
    expect(pairs[0]).toMatchObject({ left: { kind: ' ' }, right: { kind: ' ' } })
    expect(pairs[1]).toMatchObject({ left: { kind: '-' }, right: { kind: '+' } })
    expect(pairs[2]).toMatchObject({ left: null, right: { kind: '+' } })
    expect(pairs[3]).toMatchObject({ left: { kind: ' ' }, right: { kind: ' ' } })
  })

  it('handles an empty hunk list and an addition-only run', () => {
    expect(pairDiffRows([])).toEqual([])
    const additionOnly: DiffHunk = {
      oldStart: 1,
      oldLines: 0,
      newStart: 1,
      newLines: 1,
      lines: [{ kind: '+', text: 'new line', oldLine: null, newLine: 1 }],
    }
    const rows = pairDiffRows([additionOnly])
    expect(rows).toEqual([
      { kind: 'hunk', text: '@@ -1,0 +1,1 @@' },
      { kind: 'pair', left: null, right: { kind: '+', text: 'new line', oldLine: null, newLine: 1 } },
    ])
  })
})

describe('diffStats', () => {
  it('counts added and removed lines', () => {
    expect(diffStats(DIFF)).toEqual({ adds: 2, dels: 1 })
    expect(diffStats(null)).toEqual({ adds: 0, dels: 0 })
  })
})

describe('DiffView', () => {
  it('renders the unified presentation with gutters and tones', () => {
    const markup = renderToStaticMarkup(React.createElement(DiffView, {
      diff: DIFF,
      file: 'src/app.ts',
      loading: false,
      mode: 'unified',
    }))
    expect(markup).toContain('@@ -10,4 +10,5 @@')
    expect(markup).toContain('dgw-diffLine--add')
    expect(markup).toContain('dgw-diffLine--del')
    expect(markup).toContain('const dock = useDock()')
  })

  it('renders the side-by-side presentation as two scroll columns', () => {
    const markup = renderToStaticMarkup(React.createElement(DiffView, {
      diff: DIFF,
      file: 'src/app.ts',
      loading: false,
      mode: 'side',
    }))
    // One pane per side: each owns all its rows, so a horizontal scrollbar
    // moves the whole side rather than a single line.
    expect(markup.match(/class="dgw-diffSidePane"/g)).toHaveLength(2)
    expect(markup).toContain('dgw-diffSideGutter')
    expect(markup).toContain('dgw-diffGutterNo--add')
    expect(markup).toContain('dgw-diffGutterNo--del')
    expect(markup).toContain('dgw-diffSideHunk--blank')
    expect(markup).toContain('dgw-diffSideRow--add')
    expect(markup).toContain('dgw-diffSideRow--del')
    expect(markup).toContain('const dock = useDock()')
  })

  it('renders the empty states', () => {
    const noFile = renderToStaticMarkup(React.createElement(DiffView, {
      diff: null, file: null, loading: false, mode: 'unified',
    }))
    expect(noFile).toContain('选择一个文件查看差异')
    const loading = renderToStaticMarkup(React.createElement(DiffView, {
      diff: null, file: 'src/app.ts', loading: true, mode: 'unified',
    }))
    expect(loading).toContain('正在读取差异…')
    const binary = renderToStaticMarkup(React.createElement(DiffView, {
      diff: { path: 'a.png', binary: true, truncated: false, hunks: [] },
      file: 'a.png',
      loading: false,
      mode: 'unified',
    }))
    expect(binary).toContain('二进制文件，无法预览差异')
    const hinted = renderToStaticMarkup(React.createElement(DiffView, {
      diff: { path: 'new.txt', binary: false, truncated: false, hunks: [] },
      file: 'new.txt',
      loading: false,
      mode: 'unified',
      hint: '未跟踪文件没有差异可显示',
    }))
    expect(hinted).toContain('未跟踪文件没有差异可显示')
    const truncated = renderToStaticMarkup(React.createElement(DiffView, {
      diff: { path: 'big.ts', binary: false, truncated: true, hunks: [HUNK] },
      file: 'big.ts',
      loading: false,
      mode: 'unified',
    }))
    expect(truncated).toContain('差异过大，已截断')
  })
})
