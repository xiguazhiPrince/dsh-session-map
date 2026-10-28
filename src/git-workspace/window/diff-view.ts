/**
 * Diff rendering shared by the two Git carriers: the main tool-window panel and
 * the right-column page.
 *
 * `pairDiffRows` is pure (it turns hunks into side-by-side rows), so the pairing
 * rule has a unit test without a browser. The unified branch keeps the markup
 * the main panel has shipped with; the side-by-side branch is new and only the
 * right-column page turns it on.
 *
 * @module dsh-session-map/git-workspace/window/diff-view
 */
import * as React from 'react'
import type { DiffHunk, DiffLine, DiffView } from '../git-types'

/** Which presentation a diff is drawn in. */
export type DiffMode = 'unified' | 'side'

/** One row of a side-by-side diff: a hunk caption or a pair of aligned lines. */
export type DiffRow =
  | { readonly kind: 'hunk'; readonly text: string }
  | { readonly kind: 'pair'; readonly left: DiffLine | null; readonly right: DiffLine | null }

/** Props for {@link DiffView}. */
export interface DiffViewProps {
  readonly diff: DiffView | null
  readonly file: string | null
  readonly loading: boolean
  readonly mode: DiffMode
  /** Copy shown when the parsed diff has no hunks (for example an untracked file). */
  readonly hint?: string
}

/** Count the added and removed lines of a parsed diff. */
export function diffStats(diff: DiffView | null): { readonly adds: number; readonly dels: number } {
  if (diff === null) return { adds: 0, dels: 0 }
  let adds = 0
  let dels = 0
  for (const hunk of diff.hunks) {
    for (const line of hunk.lines) {
      if (line.kind === '+') adds += 1
      else if (line.kind === '-') dels += 1
    }
  }
  return { adds, dels }
}

/** Render one hunk caption. */
function hunkCaption(hunk: DiffHunk): string {
  return `@@ -${hunk.oldStart},${hunk.oldLines} +${hunk.newStart},${hunk.newLines} @@`
}

/**
 * Turn hunks into side-by-side rows: a run of `-` lines pairs with the `+` run
 * that follows it, a `+` without a matching `-` sits on the right only, and a
 * context line sits on both sides.
 * @param hunks - parsed diff hunks.
 * @returns the aligned rows, hunk captions included.
 */
export function pairDiffRows(hunks: readonly DiffHunk[]): readonly DiffRow[] {
  const rows: DiffRow[] = []
  for (const hunk of hunks) {
    rows.push({ kind: 'hunk', text: hunkCaption(hunk) })
    let index = 0
    while (index < hunk.lines.length) {
      const line = hunk.lines[index]
      if (line === undefined) break
      if (line.kind === ' ') {
        rows.push({ kind: 'pair', left: line, right: line })
        index += 1
        continue
      }
      if (line.kind === '+') {
        rows.push({ kind: 'pair', left: null, right: line })
        index += 1
        continue
      }
      const deletions: DiffLine[] = []
      while (index < hunk.lines.length && hunk.lines[index]?.kind === '-') {
        const candidate = hunk.lines[index]
        if (candidate !== undefined) deletions.push(candidate)
        index += 1
      }
      const additions: DiffLine[] = []
      while (index < hunk.lines.length && hunk.lines[index]?.kind === '+') {
        const candidate = hunk.lines[index]
        if (candidate !== undefined) additions.push(candidate)
        index += 1
      }
      const pairs = Math.max(deletions.length, additions.length)
      for (let pair = 0; pair < pairs; pair += 1) {
        rows.push({ kind: 'pair', left: deletions[pair] ?? null, right: additions[pair] ?? null })
      }
    }
  }
  return rows
}

/** One line's two gutters plus its text, in the unified presentation. */
function unifiedLine(line: DiffLine, key: string): React.ReactElement {
  return React.createElement(
    'div',
    {
      className: line.kind === '+' ? 'dgw-diffLine dgw-diffLine--add' : line.kind === '-' ? 'dgw-diffLine dgw-diffLine--del' : 'dgw-diffLine',
      key,
    },
    React.createElement('span', { className: 'dgw-diffLineNo' }, line.oldLine === null ? '' : String(line.oldLine)),
    React.createElement('span', { className: 'dgw-diffLineNo' }, line.newLine === null ? '' : String(line.newLine)),
    React.createElement('span', { className: 'dgw-diffSign' }, line.kind === ' ' ? ' ' : line.kind),
    React.createElement('span', null, line.text),
  )
}

/** One side of a paired row. */
function sideCell(line: DiffLine | null, side: 'left' | 'right', key: string): React.ReactElement {
  if (line === null) {
    return React.createElement('span', { className: 'dgw-diffSideCell dgw-diffSideCell--empty', key })
  }
  const number = side === 'left' ? line.oldLine : line.newLine
  const tone = line.kind === '+' ? ' dgw-diffSideCell--add' : line.kind === '-' ? ' dgw-diffSideCell--del' : ''
  return React.createElement(
    'span',
    { className: `dgw-diffSideCell${tone}`, key },
    React.createElement('span', { className: 'dgw-diffLineNo' }, number === null ? '' : String(number)),
    React.createElement('span', null, line.text),
  )
}

/** Render one diff in the requested presentation. */
export function DiffView(props: DiffViewProps): React.ReactElement {
  if (props.file === null) {
    return React.createElement('div', { className: 'dgw-empty' },
      React.createElement('div', { className: 'dgw-emptyBox' }, '选择一个文件查看差异'),
    )
  }
  if (props.loading) return React.createElement('div', { className: 'dgw-loading' }, '正在读取差异…')
  if (props.diff === null) {
    return React.createElement('div', { className: 'dgw-empty' },
      React.createElement('div', { className: 'dgw-emptyBox' }, props.hint ?? '没有可显示的差异'),
    )
  }
  if (props.diff.binary) {
    return React.createElement('div', { className: 'dgw-empty' },
      React.createElement('div', { className: 'dgw-emptyBox' }, '二进制文件，无法预览差异'),
    )
  }
  if (props.diff.hunks.length === 0) {
    return React.createElement('div', { className: 'dgw-empty' },
      React.createElement('div', { className: 'dgw-emptyBox' }, props.hint ?? '没有可显示的差异'),
    )
  }
  if (props.mode === 'side') {
    return React.createElement(
      'div',
      {
        className: 'dgw-diff dgw-diffSide',
        title: '并排视图：左右两栏可各自横向滚动（触控板左右滑动，或按住 Shift 滚动滚轮）',
      },
      ...pairDiffRows(props.diff.hunks).map((row, index) => {
        if (row.kind === 'hunk') {
          return React.createElement('div', { className: 'dgw-hunkHead', key: `h${index}` }, row.text)
        }
        return React.createElement(
          'div',
          { className: 'dgw-diffSideRow', key: `r${index}` },
          sideCell(row.left, 'left', `l${index}`),
          sideCell(row.right, 'right', `r${index}`),
        )
      }),
    )
  }
  return React.createElement(
    'div',
    { className: 'dgw-diff' },
    ...(props.diff.truncated
      ? [React.createElement('div', { className: 'dgw-hunkHead', key: 'truncated' }, '差异过大，已截断')]
      : []),
    ...props.diff.hunks.flatMap((hunk, hunkIndex) => [
      React.createElement('div', { className: 'dgw-hunkHead', key: `h${hunkIndex}` }, hunkCaption(hunk)),
      ...hunk.lines.map((line, lineIndex) => unifiedLine(line, `${hunkIndex}-${lineIndex}`)),
    ]),
  )
}
