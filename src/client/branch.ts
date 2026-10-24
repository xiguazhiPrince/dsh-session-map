/**
 * Composer Git branch badge.
 *
 * The browser cannot run `git`, so the branch is read from the repository's
 * metadata through the Host's `workspaceFiles` Remote: `.git/HEAD` names the
 * checked-out branch, a `.git` file points at the real directory of a linked
 * worktree, and a change notification on whichever HEAD was found keeps the
 * badge current when the reader switches branch.
 *
 * A folder without a repository is a normal state, not an error: the badge
 * says so and follows `.git` itself, so initialising a repository later also
 * reaches the display.
 *
 * @module dsh-session-map/client/branch
 */
import * as React from 'react'
import { errorText } from './format'

/** One page of text from the Host's `workspaceFiles.read`. */
export interface WorkspaceFileText {
  readonly absolutePath: string
  readonly text: string
  readonly version?: string | undefined
  readonly lines?: number | undefined
  readonly offset?: number | undefined
  readonly eof?: boolean | undefined
}

/** A failure carried by a Remote result; the code, not the message, is the discriminator. */
export interface RemoteFailure {
  readonly code?: string | undefined
  readonly message?: string | undefined
}

/** The unary result every Remote call uses. */
export type RemoteResult<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly error: RemoteFailure }

/** One frame of a file watch. Only a real change ends the wait for the badge. */
export type GitWatchFrame =
  | { readonly kind: 'ready' }
  | { readonly kind: 'change'; readonly change: unknown }

/** The stream a `changes` call returns; breaking out of it disposes the watch. */
export interface GitWatchHandle extends AsyncIterable<GitWatchFrame> {
  dispose?(): void
}

/** The Host file Remote as this badge reads it. */
export interface WorkspaceFilesRemote {
  read(
    sessionId: string,
    path: string,
    range: { readonly offset?: number; readonly limit?: number },
    signal?: AbortSignal,
  ): Promise<RemoteResult<WorkspaceFileText>>
  changes(sessionId: string, path: string, signal?: AbortSignal): GitWatchHandle
}

/** The Remote face this badge needs from `ctx.remote`. */
export interface GitBranchRuntime {
  readonly workspaceFiles: WorkspaceFilesRemote
}

/** The slot props a Session-scoped list entry receives. */
export interface GitBranchProps {
  readonly sessionId: string
}

/** What the badge knows about the current repository. */
export type GitBranchState =
  | { readonly status: 'loading' }
  | {
    readonly status: 'branch'
    readonly branch: string
    readonly detached: boolean
    readonly headPath: string
  }
  | { readonly status: 'none'; readonly watchPath: string }
  | { readonly status: 'error'; readonly message: string; readonly watchPath?: string | undefined }

/** A parsed HEAD: the checked-out branch, or the short hash of a detached commit. */
export interface ParsedHead {
  readonly branch: string
  readonly detached: boolean
}

/**
 * Parse `.git/HEAD`.
 *
 * Symbolic HEADs name a branch under `refs/heads/`; any other ref is kept whole
 * and marked detached because it is not the branch people mean when they ask
 * for the current branch. A plain commit id is a detached HEAD and is shortened
 * the way `git` shortens it.
 * @param text - the complete HEAD file.
 * @returns the parsed value, or `undefined` when the file is not a HEAD this
 * display understands.
 */
export function parseHead(text: string): ParsedHead | undefined {
  const first = text.replace(/^\uFEFF/, '').split(/\r?\n/, 1)[0]
  const line = first === undefined ? '' : first.trim()
  if (line.startsWith('ref: ')) {
    const ref = line.slice('ref: '.length).trim()
    if (ref === '') return undefined
    if (ref.startsWith('refs/heads/')) {
      const branch = ref.slice('refs/heads/'.length)
      return branch === '' ? undefined : { branch, detached: false }
    }
    return { branch: ref, detached: true }
  }
  if (/^[0-9a-f]{7,64}$/i.test(line)) return { branch: line.slice(0, 7), detached: true }
  return undefined
}

/**
 * Parse the first line of a `.git` file.
 * @param text - the complete `.git` file of a linked worktree or submodule.
 * @returns the `gitdir:` target, or `undefined` when the file is not one.
 */
export function parseGitdir(text: string): string | undefined {
  const first = text.replace(/^\uFEFF/, '').split(/\r?\n/, 1)[0]
  const line = first === undefined ? '' : first.trim()
  const match = /^gitdir:\s*(.+)$/i.exec(line)
  if (match === null) return undefined
  const target = match[1]?.trim() ?? ''
  return target === '' ? undefined : target
}

/**
 * Resolve a `gitdir:` target against the `.git` file that named it.
 *
 * Git writes an absolute path in most linked worktrees and a path relative to
 * the directory holding the `.git` file in submodules; both forms are accepted,
 * with either slash direction.
 * @param baseFile - absolute path of the `.git` file.
 * @param target - the `gitdir:` value.
 * @returns the absolute target path, without a trailing slash.
 */
export function resolveGitPath(baseFile: string, target: string): string {
  const normalized = target.replace(/\\/g, '/')
  const drive = /^[A-Za-z]:/.exec(normalized)
  if (normalized.startsWith('/') || normalized.startsWith('//') || drive !== null) {
    return normalizePath(normalized)
  }
  const base = baseFile.replace(/\\/g, '/')
  const slash = base.lastIndexOf('/')
  const directory = slash >= 0 ? base.slice(0, slash) : ''
  return normalizePath(directory === '' ? normalized : directory + '/' + normalized)
}

/**
 * Collapse `.` and `..` segments while preserving the path's root form.
 * @param path - an absolute or relative slash path.
 * @returns the collapsed path.
 */
function normalizePath(path: string): string {
  const prefix = path.startsWith('//')
    ? '//'
    : /^[A-Za-z]:/.exec(path)?.[0] ?? (path.startsWith('/') ? '/' : '')
  const rest = path.slice(prefix.length)
  const parts: string[] = []
  for (const part of rest.split('/')) {
    if (part === '' || part === '.') continue
    if (part === '..') {
      parts.pop()
      continue
    }
    parts.push(part)
  }
  const body = parts.join('/')
  if (prefix === '/') return '/' + body
  if (prefix === '//') return '//' + body
  if (prefix === '') return body
  return prefix + '/' + body
}

/**
 * Whether a failed read means the path simply is not there in the form asked
 * for, which is how a linked-worktree `.git` file and a folder without a
 * repository both present themselves.
 * @param error - the Remote failure.
 * @returns true when the caller should try the next path.
 */
function isMissing(error: RemoteFailure): boolean {
  return error.code === 'workspace-file/not-found'
    || error.code === 'workspace-file/not-regular-file'
    || error.code === 'workspace-file/not-text'
}

/**
 * Resolve the current branch of one Session's workspace.
 *
 * The common case reads `.git/HEAD` directly. A `gitdir:` file (a linked
 * worktree or a submodule checkout) is followed to its HEAD. Everything else is
 * reported as "not a repository"; only a genuine failure becomes an error.
 * @param files - the `workspaceFiles` Remote.
 * @param sessionId - the Session whose filesystem authorizes the read.
 * @param signal - cancellation for unmount or Session change.
 * @returns the branch, the no-repository state, or an error with its message.
 */
export async function readGitBranch(
  files: WorkspaceFilesRemote,
  sessionId: string,
  signal: AbortSignal,
): Promise<GitBranchState> {
  try {
    const head = await files.read(sessionId, '.git/HEAD', {}, signal)
    if (head.ok) {
      const parsed = parseHead(head.value.text)
      if (parsed !== undefined) {
        return {
          status: 'branch',
          branch: parsed.branch,
          detached: parsed.detached,
          headPath: head.value.absolutePath,
        }
      }
      return {
        status: 'error',
        message: '无法解析 .git/HEAD',
        watchPath: head.value.absolutePath,
      }
    }
    if (!isMissing(head.error)) return failureState(head.error)

    // A linked worktree or submodule has a `.git` FILE naming the real
    // directory; a normal repository has a `.git` directory, whose `HEAD` the
    // first read would have found. Reading the marker as text distinguishes
    // the two without a directory listing.
    const marker = await files.read(sessionId, '.git', {}, signal)
    if (!marker.ok) {
      if (isMissing(marker.error)) return { status: 'none', watchPath: '.git' }
      return failureState(marker.error)
    }
    const gitdir = parseGitdir(marker.value.text)
    if (gitdir === undefined) return { status: 'none', watchPath: '.git' }

    const headPath = resolveGitPath(marker.value.absolutePath, gitdir) + '/HEAD'
    const linked = await files.read(sessionId, headPath, {}, signal)
    if (!linked.ok) {
      if (isMissing(linked.error)) return { status: 'none', watchPath: '.git' }
      return failureState(linked.error)
    }
    const parsed = parseHead(linked.value.text)
    if (parsed === undefined) {
      return { status: 'error', message: '无法解析 ' + headPath, watchPath: headPath }
    }
    return {
      status: 'branch',
      branch: parsed.branch,
      detached: parsed.detached,
      headPath,
    }
  } catch (cause) {
    if (signal.aborted) return { status: 'loading' }
    return { status: 'error', message: errorText(cause) }
  }
}

/**
 * Turn a Remote failure into display state.
 * @param error - the failure.
 * @returns the error state, with the Host message when it has one.
 */
function failureState(error: RemoteFailure): GitBranchState {
  const message = error.message ?? error.code ?? '读取 Git 分支失败'
  return { status: 'error', message }
}

/**
 * Follow one repository's HEAD and re-resolve on every write.
 * @param runtime - the Remote face.
 * @param sessionId - the Session whose workspace is read.
 * @returns the latest state, starting as loading.
 */
function useGitBranch(runtime: GitBranchRuntime, sessionId: string): GitBranchState {
  const [state, setState] = React.useState<GitBranchState>({ status: 'loading' })

  React.useEffect(() => {
    const controller = new AbortController()
    let disposed = false
    let handle: GitWatchHandle | undefined

    const run = async (): Promise<void> => {
      for (;;) {
        const reading = await readGitBranch(runtime.workspaceFiles, sessionId, controller.signal)
        if (disposed || controller.signal.aborted) return
        setState(reading)
        if (reading.status === 'loading') return

        // A branch and a missing repository both know what to follow. A parse
        // failure follows its HEAD too, so a momentarily empty file during a
        // checkout recovers as soon as git finishes writing it.
        const watchPath = reading.status === 'branch' ? reading.headPath : reading.watchPath
        if (watchPath === undefined) return
        let changed = false
        try {
          handle = runtime.workspaceFiles.changes(sessionId, watchPath, controller.signal)
          for await (const frame of handle) {
            if (disposed || controller.signal.aborted) return
            if (frame.kind === 'change') {
              changed = true
              break
            }
          }
        } catch {
          // The resolved value stays on screen; following failed, so stop here
          // rather than spin on a watch the Host will not serve.
          return
        } finally {
          handle?.dispose?.()
          handle = undefined
        }
        if (!changed) return
      }
    }

    void run()
    return () => {
      disposed = true
      controller.abort()
      handle?.dispose?.()
      handle = undefined
    }
  }, [runtime, sessionId])

  return state
}

/** The glyph and text one state projects. */
export interface BranchView {
  readonly text: string
  readonly title: string
  readonly className: string
}

/**
 * Project one state into its visible text and its tooltip.
 * @param state - the current reading.
 * @returns text, title, and the modifier class.
 */
export function branchBadgeView(state: GitBranchState): BranchView {
  switch (state.status) {
    case 'loading':
      return { text: 'Git …', title: '正在读取当前 Git 分支', className: 'dsm-git dsm-git--muted' }
    case 'branch':
      return state.detached
        ? { text: state.branch, title: '分离 HEAD：' + state.branch, className: 'dsm-git' }
        : { text: state.branch, title: '当前 Git 分支：' + state.branch, className: 'dsm-git' }
    case 'none':
      return { text: '无 Git 仓库', title: '当前会话的工作区不是 Git 仓库', className: 'dsm-git dsm-git--muted' }
    case 'error':
      return {
        text: 'Git 读取失败',
        title: '读取当前 Git 分支失败：' + state.message,
        className: 'dsm-git dsm-git--error',
      }
  }
}

/** The branch glyph, drawn inline so the bundle carries no icon dependency. */
const BRANCH_GLYPH = React.createElement(
  'svg',
  {
    className: 'dsm-git__glyph',
    width: 13,
    height: 13,
    viewBox: '0 0 16 16',
    'aria-hidden': 'true',
    focusable: 'false',
  },
  React.createElement('path', {
    d: 'M5 4.5v7',
    fill: 'none',
    stroke: 'currentColor',
    strokeWidth: 1.2,
    strokeLinecap: 'round',
  }),
  React.createElement('circle', {
    cx: 5, cy: 3, r: 1.6, fill: 'none', stroke: 'currentColor', strokeWidth: 1.2,
  }),
  React.createElement('circle', {
    cx: 5, cy: 13, r: 1.6, fill: 'none', stroke: 'currentColor', strokeWidth: 1.2,
  }),
  React.createElement('circle', {
    cx: 11, cy: 5.5, r: 1.6, fill: 'none', stroke: 'currentColor', strokeWidth: 1.2,
  }),
  React.createElement('path', {
    d: 'M11 7.1c0 2.4-2.2 2.9-4.5 3.4',
    fill: 'none',
    stroke: 'currentColor',
    strokeWidth: 1.2,
    strokeLinecap: 'round',
  }),
)

/**
 * Build the badge component for one plugin run.
 * @param runtime - the Remote face captured at apply time.
 * @returns the component to register in `conversation.input.left`.
 */
export function createGitBranchBadge(
  runtime: GitBranchRuntime,
): (props: GitBranchProps) => React.ReactElement {
  function GitBranchBadge(props: GitBranchProps): React.ReactElement {
    const state = useGitBranch(runtime, props.sessionId)
    const view = branchBadgeView(state)
    return React.createElement(
      'span',
      {
        className: view.className,
        title: view.title,
        'aria-label': view.title,
      },
      BRANCH_GLYPH,
      React.createElement('span', { className: 'dsm-git__name' }, view.text),
    )
  }
  return GitBranchBadge
}
