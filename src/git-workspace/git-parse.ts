/**
 * Byte-level parsers for the git output the Host reads.
 *
 * Every parser is pure and returns an explicit `truncated` flag when the
 * collected output ends mid-record: a half record must never be presented as a
 * complete commit, change or file list.
 *
 * @module dsh-session-map/git-workspace/git-parse
 */
import type {
  BranchRef,
  ChangedEntry,
  CommitRow,
  DiffHunk,
  DiffLine,
  DiffView,
  FileChange,
  RemoteRef,
} from './git-types'

/** Split a NUL-terminated record stream, reporting a missing final terminator. */
function nulRecords(text: string): { readonly records: readonly string[]; readonly truncated: boolean } {
  if (text === '') return { records: [], truncated: false }
  const complete = text.endsWith('\0')
  const records = text.split('\0')
  if (complete) records.pop()
  return { records, truncated: !complete }
}

/**
 * Take `count` space-separated fields starting at `offset`, leaving the rest.
 * Paths may contain spaces, so the tail is never split again.
 * @param record - one line/record.
 * @param offset - index of the first field.
 * @param count - number of fields to take.
 * @returns the fields and the remaining tail, or undefined when short.
 */
function takeFields(record: string, offset: number, count: number): { fields: string[]; rest: string } | undefined {
  const fields: string[] = []
  let cursor = offset
  for (let index = 0; index < count; index += 1) {
    const space = record.indexOf(' ', cursor)
    if (space < 0) return undefined
    fields.push(record.slice(cursor, space))
    cursor = space + 1
  }
  return { fields, rest: record.slice(cursor) }
}

/** Normalize a porcelain `X`/`Y` letter to a display status. */
function statusOf(letter: string): 'M' | 'A' | 'D' | 'R' | 'C' | 'T' | 'U' {
  switch (letter) {
    case 'A': return 'A'
    case 'D': return 'D'
    case 'R': return 'R'
    case 'C': return 'C'
    case 'T': return 'T'
    case 'U': return 'U'
    default: return 'M'
  }
}

/** One repository probe result. */
export interface RepoProbe {
  readonly insideWorkTree: boolean
  readonly topLevel: string
  readonly prefix: string
  readonly bare: boolean
  readonly gitDir: string
  readonly commonDir: string
}

/**
 * Parse `rev-parse --is-inside-work-tree --show-toplevel …`.
 * @param text - command stdout.
 * @returns the parsed facts, or undefined when git printed an unexpected shape.
 */
export function parseRepoProbe(text: string): RepoProbe | undefined {
  const lines = text.split('\n')
  while (lines.length > 0 && lines[lines.length - 1] === '') lines.pop()
  if (lines.length !== 6) return undefined
  const [inside, topLevel, prefix, bare, gitDir, commonDir] = lines as [string, string, string, string, string, string]
  return {
    insideWorkTree: inside.trim() === 'true',
    topLevel: topLevel.trim(),
    prefix: prefix.trim(),
    bare: bare.trim() === 'true',
    gitDir: gitDir.trim(),
    commonDir: commonDir.trim(),
  }
}

/** Head facts parsed out of a porcelain v2 stream. */
export interface ParsedStatusHead {
  readonly oid: string | null
  readonly branch: string | null
  readonly upstream: string | null
  readonly ahead: number
  readonly behind: number
  readonly stashCount: number
  readonly detached: boolean
  readonly unborn: boolean
}

/** One parsed status snapshot. */
export interface ParsedStatus {
  readonly head: ParsedStatusHead
  readonly changes: readonly ChangedEntry[]
  readonly truncated: boolean
}

/**
 * Parse `status --porcelain=v2 -z --branch --show-stash`.
 * @param text - command stdout.
 * @returns head facts plus one entry per staged/unstaged/untracked/conflicted row.
 */
export function parseStatusV2(text: string): ParsedStatus {
  const { records, truncated: streamTruncated } = nulRecords(text)
  let oid: string | null = null
  let branch: string | null = null
  let upstream: string | null = null
  let ahead = 0
  let behind = 0
  let stashCount = 0
  let detached = false
  let unborn = false
  const changes: ChangedEntry[] = []
  let truncated = streamTruncated

  for (let index = 0; index < records.length; index += 1) {
    const record = records[index] as string
    if (record.startsWith('# branch.oid ')) {
      const value = record.slice('# branch.oid '.length)
      if (value === '(initial)') unborn = true
      else oid = value
      continue
    }
    if (record.startsWith('# branch.head ')) {
      const value = record.slice('# branch.head '.length)
      if (value === '(detached)') detached = true
      else branch = value
      continue
    }
    if (record.startsWith('# branch.upstream ')) {
      upstream = record.slice('# branch.upstream '.length)
      continue
    }
    if (record.startsWith('# branch.ab ')) {
      const match = /^\+(\d+)\s+-(\d+)$/.exec(record.slice('# branch.ab '.length))
      if (match !== null) {
        ahead = Number(match[1])
        behind = Number(match[2])
      }
      continue
    }
    if (record.startsWith('# stash ')) {
      stashCount = Number(record.slice('# stash '.length)) || 0
      continue
    }
    if (record.startsWith('1 ')) {
      const parsed = takeFields(record, 2, 7)
      if (parsed === undefined) {
        truncated = true
        break
      }
      const [xy, , , , , ,] = parsed.fields as [string, string, string, string, string, string, string]
      pushOrdinary(changes, parsed.rest, xy)
      continue
    }
    if (record.startsWith('2 ')) {
      const parsed = takeFields(record, 2, 8)
      const oldPath = records[index + 1]
      if (parsed === undefined || oldPath === undefined) {
        truncated = true
        break
      }
      index += 1
      const [xy] = parsed.fields as [string, ...string[]]
      pushRenamed(changes, parsed.rest, oldPath, xy)
      continue
    }
    if (record.startsWith('u ')) {
      const parsed = takeFields(record, 2, 9)
      if (parsed === undefined) {
        truncated = true
        break
      }
      const [xy] = parsed.fields as [string, ...string[]]
      changes.push({
        path: parsed.rest,
        xy: { index: xy.charAt(0), worktree: xy.charAt(1) },
        kind: 'unmerged',
        group: 'conflict',
        status: 'U',
      })
      continue
    }
    if (record.startsWith('? ')) {
      const path = record.slice(2)
      if (path !== '') {
        changes.push({
          path,
          xy: { index: '.', worktree: '?' },
          kind: 'untracked',
          group: 'untracked',
          status: '?',
        })
      }
      continue
    }
    if (record.startsWith('! ')) {
      // Ignored files are never shown in the tool window; the default status
      // call does not request them at all.
      continue
    }
  }

  return {
    head: { oid, branch, upstream, ahead, behind, stashCount, detached, unborn },
    changes,
    truncated,
  }
}

/** Push the staged/unstaged rows one ordinary porcelain entry describes. */
function pushOrdinary(changes: ChangedEntry[], path: string, xy: string): void {
  const indexLetter = xy.charAt(0)
  const worktreeLetter = xy.charAt(1)
  if (indexLetter !== '.' && indexLetter !== ' ') {
    changes.push({
      path,
      xy: { index: indexLetter, worktree: worktreeLetter },
      kind: 'ordinary',
      group: 'staged',
      status: statusOf(indexLetter),
    })
  }
  if (worktreeLetter !== '.' && worktreeLetter !== ' ') {
    changes.push({
      path,
      xy: { index: indexLetter, worktree: worktreeLetter },
      kind: 'ordinary',
      group: 'unstaged',
      status: statusOf(worktreeLetter),
    })
  }
}

/** Push the staged/unstaged rows one rename/copy porcelain entry describes. */
function pushRenamed(changes: ChangedEntry[], path: string, oldPath: string, xy: string): void {
  const indexLetter = xy.charAt(0)
  const worktreeLetter = xy.charAt(1)
  if (indexLetter !== '.' && indexLetter !== ' ') {
    changes.push({
      path,
      oldPath,
      xy: { index: indexLetter, worktree: worktreeLetter },
      kind: 'renamed',
      group: 'staged',
      status: statusOf(indexLetter),
    })
  }
  if (worktreeLetter !== '.' && worktreeLetter !== ' ') {
    changes.push({
      path,
      oldPath,
      xy: { index: indexLetter, worktree: worktreeLetter },
      kind: 'renamed',
      group: 'unstaged',
      status: statusOf(worktreeLetter),
    })
  }
}

/** Parse one `%(upstream:track)` value. */
function parseTrack(value: string): { ahead: number; behind: number; gone: boolean } | null {
  const trimmed = value.trim()
  if (trimmed === '') return null
  if (trimmed === '[gone]' || trimmed === 'gone') return { ahead: 0, behind: 0, gone: true }
  const ahead = Number(/ahead (\d+)/.exec(trimmed)?.[1] ?? 0)
  const behind = Number(/behind (\d+)/.exec(trimmed)?.[1] ?? 0)
  return { ahead, behind, gone: false }
}

/** One parsed ref list. */
export interface ParsedRefs {
  readonly refs: readonly BranchRef[]
  readonly truncated: boolean
}

/**
 * Parse `for-each-ref` output from {@link FOR_EACH_REF_FORMAT}.
 * @param text - command stdout.
 * @returns every local branch, remote ref and tag.
 */
export function parseForEachRef(text: string): ParsedRefs {
  const refs: BranchRef[] = []
  let truncated = false
  for (const line of text.split('\n')) {
    if (line === '') continue
    const fields = line.split('\0')
    if (fields.length < 9) {
      truncated = true
      continue
    }
    const [ref, name, oid, , upstream, track, head, date, subject] = fields as [
      string, string, string, string, string, string, string, string, string,
    ]
    let type: BranchRef['type']
    if (ref.startsWith('refs/heads/')) type = 'local'
    else if (ref.startsWith('refs/remotes/')) type = 'remote'
    else if (ref.startsWith('refs/tags/')) type = 'tag'
    else continue
    refs.push({
      ref,
      name,
      oid,
      type,
      isHead: head.trim() === '*',
      upstream: upstream === '' ? null : upstream,
      track: parseTrack(track),
      date,
      subject: subject.slice(0, 200),
    })
  }
  return { refs, truncated }
}

/**
 * Parse `remote -v` into one row per remote (fetch URL).
 * @param text - command stdout.
 * @returns the configured remotes.
 */
export function parseRemoteVerbose(text: string): readonly RemoteRef[] {
  const remotes = new Map<string, string>()
  for (const line of text.split('\n')) {
    const match = /^(\S+)\t(.+) \((fetch|push)\)$/.exec(line)
    if (match === null) continue
    const name = match[1]
    const url = match[2]
    const kind = match[3]
    if (name === undefined || url === undefined) continue
    if (kind === 'fetch' && !remotes.has(name)) remotes.set(name, url)
  }
  return [...remotes.entries()].map(([name, url]) => ({ name, url }))
}

/** Split `%D` into display tokens and categorized refs. */
function parseDecorations(value: string): Pick<CommitRow, 'decorations' | 'refs'> {
  const tokens = value.split(',').map(token => token.trim()).filter(token => token !== '')
  const branches: string[] = []
  const remoteBranches: string[] = []
  const tags: string[] = []
  for (const token of tokens) {
    if (token.startsWith('tag: ')) {
      tags.push(token.slice('tag: '.length))
      continue
    }
    if (token.startsWith('HEAD -> ')) {
      branches.push(token.slice('HEAD -> '.length))
      continue
    }
    if (token === 'HEAD') continue
    if (token.includes('/')) remoteBranches.push(token)
    else branches.push(token)
  }
  return { decorations: tokens, refs: { branches, remoteBranches, tags } }
}

/** One parsed log page. */
export interface ParsedLog {
  readonly commits: readonly CommitRow[]
  readonly truncated: boolean
}

/**
 * Parse a `log -z --format` page.
 * @param text - command stdout.
 * @returns commit rows in git order.
 */
export function parseLogZ(text: string): ParsedLog {
  const { records, truncated: streamTruncated } = nulRecords(text)
  const commits: CommitRow[] = []
  let truncated = streamTruncated
  for (const record of records) {
    const fields = record.split('\x1f')
    if (fields.length < 11) {
      truncated = true
      break
    }
    const [oid, shortOid, parents, authorName, authorEmail, authorDate, committerName, committerEmail, committerDate, decorations, subject] = fields as [
      string, string, string, string, string, string, string, string, string, string, string,
    ]
    commits.push({
      oid,
      shortOid,
      parents: parents === '' ? [] : parents.split(' '),
      author: { name: authorName, email: authorEmail, date: authorDate },
      committer: { name: committerName, email: committerEmail, date: committerDate },
      subject,
      ...parseDecorations(decorations),
    })
  }
  return { commits, truncated }
}

/** One parsed commit metadata record. */
export interface ParsedCommitMeta {
  readonly commit: CommitRow
  readonly message: string
}

/**
 * Parse `show -s -z --format` for one commit.
 * @param text - command stdout.
 * @returns the row plus the full commit message.
 */
export function parseCommitMeta(text: string): ParsedCommitMeta | undefined {
  const { records } = nulRecords(text)
  const record = records[0]
  if (record === undefined) return undefined
  const fields = record.split('\x1f')
  if (fields.length < 12) return undefined
  const [oid, shortOid, parents, authorName, authorEmail, authorDate, committerName, committerEmail, committerDate, decorations, subject, message] = fields as [
    string, string, string, string, string, string, string, string, string, string, string, string,
  ]
  return {
    commit: {
      oid,
      shortOid,
      parents: parents === '' ? [] : parents.split(' '),
      author: { name: authorName, email: authorEmail, date: authorDate },
      committer: { name: committerName, email: committerEmail, date: committerDate },
      subject,
      ...parseDecorations(decorations),
    },
    message,
  }
}

/** One parsed name-status file list. */
export interface ParsedNameStatus {
  readonly files: readonly FileChange[]
  readonly truncated: boolean
}

/**
 * Parse `show --first-parent --name-status -z`.
 * @param text - command stdout.
 * @returns changed files with null line counts.
 */
export function parseNameStatusZ(text: string): ParsedNameStatus {
  const { records, truncated: streamTruncated } = nulRecords(text)
  const files: FileChange[] = []
  let truncated = streamTruncated
  for (let index = 0; index < records.length; index += 1) {
    const status = records[index] as string
    if (status === '') continue
    const letter = status.charAt(0) as FileChange['status']
    if (letter === 'R' || letter === 'C') {
      const oldPath = records[index + 1]
      const path = records[index + 2]
      if (oldPath === undefined || path === undefined) {
        truncated = true
        break
      }
      index += 2
      files.push({ path, oldPath, status: letter, additions: null, deletions: null, binary: false })
      continue
    }
    const path = records[index + 1]
    if (path === undefined) {
      truncated = true
      break
    }
    index += 1
    files.push({ path, status: letter, additions: null, deletions: null, binary: false })
  }
  return { files, truncated }
}

/** One parsed numstat row. */
export interface NumstatEntry {
  readonly path: string
  readonly oldPath?: string
  readonly additions: number | null
  readonly deletions: number | null
  readonly binary: boolean
}

/** One parsed numstat list. */
export interface ParsedNumstat {
  readonly entries: readonly NumstatEntry[]
  readonly truncated: boolean
}

/**
 * Parse `show --first-parent --numstat -z`.
 * @param text - command stdout.
 * @returns one row per file in the same order as the name-status list.
 */
export function parseNumstatZ(text: string): ParsedNumstat {
  const { records, truncated: streamTruncated } = nulRecords(text)
  const entries: NumstatEntry[] = []
  let truncated = streamTruncated
  for (let index = 0; index < records.length; index += 1) {
    const record = records[index] as string
    if (record === '') continue
    const parts = record.split('\t')
    if (parts.length < 3) {
      truncated = true
      break
    }
    const [additionsText, deletionsText, pathText] = parts as [string, string, string]
    const binary = additionsText === '-' || deletionsText === '-'
    const additions = binary ? null : Number(additionsText)
    const deletions = binary ? null : Number(deletionsText)
    if (pathText === '') {
      const oldPath = records[index + 1]
      const path = records[index + 2]
      if (oldPath === undefined || path === undefined) {
        truncated = true
        break
      }
      index += 2
      entries.push({ path, oldPath, additions, deletions, binary })
      continue
    }
    entries.push({ path: pathText, additions, deletions, binary })
  }
  return { entries, truncated }
}

/** One `git rev-parse --git-path` output. */
export function parseGitPathLines(text: string): readonly string[] {
  return text.split('\n').map(line => line.trim()).filter(line => line !== '')
}

/**
 * Parse one unified diff into hunks.
 * @param text - `show`/`diff` patch output.
 * @param path - repository-relative path the patch describes.
 * @param truncated - whether the Host cut the output.
 * @returns the displayable diff.
 */
export function parseUnifiedDiff(text: string, path: string, truncated = false): DiffView {
  const binary = /^Binary files .* differ$/m.test(text) || /^GIT binary patch$/m.test(text)
  const hunks: DiffHunk[] = []
  let current: { oldStart: number; oldLines: number; newStart: number; newLines: number; lines: DiffLine[] } | undefined
  let oldLine = 0
  let newLine = 0

  const flush = (): void => {
    if (current === undefined) return
    hunks.push(current)
    current = undefined
  }

  for (const line of text.split('\n')) {
    const header = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/.exec(line)
    if (header !== null) {
      flush()
      const oldStart = Number(header[1])
      const oldLines = header[2] === undefined ? 1 : Number(header[2])
      const newStart = Number(header[3])
      const newLines = header[4] === undefined ? 1 : Number(header[4])
      oldLine = oldStart
      newLine = newStart
      current = { oldStart, oldLines, newStart, newLines, lines: [] }
      continue
    }
    if (current === undefined) continue
    if (line.startsWith('diff --git ')) break
    if (line.startsWith('\\ No newline')) continue
    if (line.startsWith('+')) {
      current.lines.push({ kind: '+', text: line.slice(1), oldLine: null, newLine })
      newLine += 1
      continue
    }
    if (line.startsWith('-')) {
      current.lines.push({ kind: '-', text: line.slice(1), oldLine, newLine: null })
      oldLine += 1
      continue
    }
    if (line.startsWith(' ')) {
      current.lines.push({ kind: ' ', text: line.slice(1), oldLine, newLine })
      oldLine += 1
      newLine += 1
      continue
    }
  }
  flush()

  return { path, binary, truncated, hunks }
}

/**
 * Zip a name-status list with its numstat list, which git prints in the same order.
 * @param files - name-status rows.
 * @param stats - numstat rows.
 * @returns file rows with line counts and binary flags.
 */
export function mergeFileStats(
  files: readonly FileChange[],
  stats: readonly NumstatEntry[],
): readonly FileChange[] {
  return files.map((file, index) => {
    const stat = stats[index]
    if (stat === undefined) return file
    return {
      ...file,
      additions: stat.additions,
      deletions: stat.deletions,
      binary: stat.binary,
    }
  })
}
