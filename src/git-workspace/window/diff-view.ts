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

/** One code line inside a side pane; the line number lives in the centre gutter. */
function sideLine(line: DiffLine | null, key: string): React.ReactElement {
  const tone = line === null ? '' : line.kind === '+' ? ' dgw-diffSideRow--add' : line.kind === '-' ? ' dgw-diffSideRow--del' : ''
  return React.createElement(
    'div',
    { className: `dgw-diffSideRow${tone}`, key },
    React.createElement('span', { className: 'dgw-diffSideText' }, line === null ? '' : line.text),
  )
}

/** One row of the fixed centre gutter: old number on the left, new on the right. */
function gutterLine(left: DiffLine | null, right: DiffLine | null, key: string): React.ReactElement {
  const leftTone = left !== null && left.kind === '-' ? ' dgw-diffGutterNo--del' : ''
  const rightTone = right !== null && right.kind === '+' ? ' dgw-diffGutterNo--add' : ''
  return React.createElement(
    'div',
    { className: 'dgw-diffGutterRow', key },
    React.createElement('span', { className: `dgw-diffGutterNo${leftTone}` },
      left === null || left.oldLine === null ? '' : String(left.oldLine)),
    React.createElement('span', { className: `dgw-diffGutterNo${rightTone}` },
      right === null || right.newLine === null ? '' : String(right.newLine)),
  )
}

/**
 * Side-by-side presentation as two horizontal scroll panes plus a fixed centre
 * gutter. The line numbers never move horizontally: only the code panes scroll,
 * their horizontal positions are linked, and all three columns mirror vertical
 * scrolling so rows stay aligned.
 */
function SideDiff(props: { readonly hunks: readonly DiffHunk[] }): React.ReactElement {
  const rootRef = React.useRef<HTMLDivElement | null>(null)
  const leftRef = React.useRef<HTMLDivElement | null>(null)
  const rightRef = React.useRef<HTMLDivElement | null>(null)
  const gutterTrackRef = React.useRef<HTMLDivElement | null>(null)
  const syncing = React.useRef(false)

  // Native wheel deltas are tuned for reading prose, not for scanning a diff;
  // scale them up while keeping trackpad/Shift+wheel behaviour.
  React.useEffect(() => {
    const root = rootRef.current
    if (root === null) return undefined
    const onWheel = (event: WheelEvent): void => {
      if (event.ctrlKey) return
      const target = event.target instanceof Element ? event.target.closest('.dgw-diffSidePane') : null
      const pane = target instanceof HTMLElement ? target : leftRef.current
      if (pane === null) return
      event.preventDefault()
      const horizontal = event.shiftKey && event.deltaX === 0
      pane.scrollTop += horizontal ? 0 : event.deltaY * 1.8
      pane.scrollLeft += (horizontal ? event.deltaY : event.deltaX) * 1.8
    }
    root.addEventListener('wheel', onWheel, { passive: false })
    return () => root.removeEventListener('wheel', onWheel)
  }, [])

  const syncScroll = (event: React.UIEvent<HTMLDivElement>): void => {
    if (syncing.current) return
    const source = event.currentTarget
    syncing.current = true
    const other = source === leftRef.current ? rightRef.current : leftRef.current
    if (other !== null) {
      other.scrollTop = source.scrollTop
      // The two sides rarely have the same scrollWidth. Map the horizontal
      // position proportionally so both panes reach their left/right edge
      // together instead of the shorter one clamping and "sticking" early.
      const sourceMax = source.scrollWidth - source.clientWidth
      const targetMax = other.scrollWidth - other.clientWidth
      other.scrollLeft = sourceMax <= 0 ? 0 : Math.round((source.scrollLeft / sourceMax) * Math.max(0, targetMax))
    }
    // The gutter has no scrollbar of its own (its viewport is taller than the
    // code panes by the horizontal-bar height), so translate its track instead
    // of setting scrollTop: that keeps the numbers aligned right up to the edge.
    if (gutterTrackRef.current !== null) {
      gutterTrackRef.current.style.transform = `translateY(${-source.scrollTop}px)`
    }
    requestAnimationFrame(() => { syncing.current = false })
  }
  const rows = pairDiffRows(props.hunks)
  const left = rows.map((row, index) => row.kind === 'hunk'
    ? React.createElement('div', { className: 'dgw-diffSideHunk', key: `h${index}` }, row.text)
    : sideLine(row.left, `l${index}`))
  const gutter = rows.map((row, index) => row.kind === 'hunk'
    ? React.createElement('div', { className: 'dgw-diffGutterHunk', key: `h${index}` })
    : gutterLine(row.left, row.right, `g${index}`))
  const right = rows.map((row, index) => row.kind === 'hunk'
    ? React.createElement('div', { className: 'dgw-diffSideHunk dgw-diffSideHunk--blank', key: `h${index}` })
    : sideLine(row.right, `r${index}`))
  return React.createElement(
    'div',
    {
      className: 'dgw-diff dgw-diffSide',
      ref: rootRef,
      title: '并排视图：行号固定在中间，左右代码栏横向滚动联动，竖向滚动保持对齐（Shift + 滚轮或触控板）',
    },
    React.createElement('div', { className: 'dgw-diffSidePane', ref: leftRef, onScroll: syncScroll }, ...left),
    React.createElement(
      'div',
      { className: 'dgw-diffSideGutter' },
      React.createElement('div', { className: 'dgw-diffGutterTrack', ref: gutterTrackRef }, ...gutter),
    ),
    React.createElement('div', { className: 'dgw-diffSidePane', ref: rightRef, onScroll: syncScroll }, ...right),
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
    return React.createElement(SideDiff, { hunks: props.diff.hunks })
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
