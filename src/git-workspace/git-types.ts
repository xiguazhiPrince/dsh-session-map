/**
 * Shared vocabulary for the Git tool window: the snapshot, history and diff
 * shapes the Host builds and the browser renders, plus the response envelope
 * both halves agree on.
 *
 * Type-only module: the browser half imports these with `import type`, so no
 * runtime code crosses the bundle boundary.
 *
 * @module dsh-session-map/git-workspace/git-types
 */

/** Execution-world platform reported by the Host's subprocess seam. */
export type GitPlatform = 'posix' | 'windows'

/** Which VCS operation is currently in progress in a repository. */
export type GitOperation = 'none' | 'merge' | 'rebase' | 'rebase-apply' | 'cherry-pick' | 'revert' | 'bisect'

/** One change entry, already split into the group it belongs to. */
export interface ChangedEntry {
  /** Repository-relative POSIX path. */
  readonly path: string
  /** Previous path for a rename or copy. */
  readonly oldPath?: string
  /** porcelain v2 `XY`: index status in `[0]`, worktree status in `[1]`. */
  readonly xy: { readonly index: string; readonly worktree: string }
  readonly kind: 'ordinary' | 'renamed' | 'unmerged' | 'untracked' | 'ignored'
  readonly group: 'staged' | 'unstaged' | 'untracked' | 'conflict'
  /** Normalized status letter; `?` for untracked. */
  readonly status: 'M' | 'A' | 'D' | 'R' | 'C' | 'T' | 'U' | '?'
}

/** Upstream tracking facts for the current branch. */
export interface UpstreamState {
  readonly ref: string
  readonly ahead: number
  readonly behind: number
  readonly gone: boolean
}

/** The current HEAD of the repository. */
export interface HeadState {
  readonly oid: string | null
  readonly branch: string | null
  readonly detached: boolean
  /** True when the branch has no commit yet (`# branch.oid (initial)`). */
  readonly unborn: boolean
  readonly upstream: UpstreamState | null
  readonly operation: GitOperation
}

/** One local branch, remote-tracking ref or tag. */
export interface BranchRef {
  readonly ref: string
  readonly name: string
  readonly oid: string
  readonly type: 'local' | 'remote' | 'tag'
  readonly isHead: boolean
  readonly upstream: string | null
  readonly track: { readonly ahead: number; readonly behind: number; readonly gone: boolean } | null
  readonly date: string
  readonly subject: string
}

/** One configured remote. */
export interface RemoteRef {
  readonly name: string
  readonly url: string
}

/** One resolved repository: root, git directory and execution platform. */
export interface ResolvedRepo {
  readonly root: string
  readonly gitDir: string
  readonly platform: GitPlatform
}

/** One repository snapshot: everything the panel needs for its first paint. */
export interface RepoSnapshot {
  readonly takenAt: number
  /** True when a write operation is running and this is the previous snapshot. */
  readonly stale: boolean
  /** True when any sub-read hit its output cap. */
  readonly truncated: boolean
  /** Cheap fingerprint of `.git` files; the client only uses it for change detection. */
  readonly version: string
  readonly repo: {
    readonly root: string
    readonly gitDir: string
    readonly isBare: boolean
    readonly isWorktree: boolean
  }
  readonly head: HeadState
  readonly changes: readonly ChangedEntry[]
  readonly counts: {
    readonly staged: number
    readonly unstaged: number
    readonly untracked: number
    readonly conflicted: number
  }
  readonly stashCount: number
  readonly branches: readonly BranchRef[]
  readonly remotes: readonly RemoteRef[]
}

/** One log row. */
export interface CommitRow {
  readonly oid: string
  readonly shortOid: string
  readonly parents: readonly string[]
  readonly author: { readonly name: string; readonly email: string; readonly date: string }
  readonly committer: { readonly name: string; readonly email: string; readonly date: string }
  readonly subject: string
  /** Raw `%D` decoration tokens, display only. */
  readonly decorations: readonly string[]
  readonly refs: {
    readonly branches: readonly string[]
    readonly remoteBranches: readonly string[]
    readonly tags: readonly string[]
  }
}

/** One changed file inside a commit. */
export interface FileChange {
  readonly path: string
  readonly oldPath?: string
  readonly status: 'A' | 'M' | 'D' | 'R' | 'C' | 'T' | 'U'
  readonly additions: number | null
  readonly deletions: number | null
  readonly binary: boolean
}

/** One commit with its file list and the branches that contain it. */
export interface CommitDetail extends CommitRow {
  readonly message: string
  readonly files: readonly FileChange[]
  readonly containedInBranches: readonly string[]
}

/** One line inside a unified diff hunk. */
export interface DiffLine {
  readonly kind: '+' | '-' | ' '
  readonly text: string
  readonly oldLine: number | null
  readonly newLine: number | null
}

/** One unified diff hunk. */
export interface DiffHunk {
  readonly oldStart: number
  readonly oldLines: number
  readonly newStart: number
  readonly newLines: number
  readonly lines: readonly DiffLine[]
}

/** One parsed diff. */
export interface DiffView {
  readonly path: string
  readonly binary: boolean
  readonly truncated: boolean
  readonly hunks: readonly DiffHunk[]
}

/** One git command the Host actually executed; the console renders these. */
export interface CommandReceipt {
  /** Argv with credential-bearing URLs redacted. */
  readonly argv: readonly string[]
  readonly cwd: string
  readonly exitCode: number | null
  readonly ms: number
  readonly cancelled?: boolean
  readonly truncated?: boolean
}

/** Stable Host error codes for the Git window. */
export type GitWindowErrorCode =
  | 'invalid-request'
  | 'workspace-not-found'
  | 'not-a-repository'
  | 'invalid-path'
  | 'invalid-ref'
  | 'git-not-found'
  | 'parse-failed'
  | 'busy'
  | 'lock'
  | 'conflict'
  | 'nothing-to-commit'
  | 'confirmation-required'
  | 'confirmation-mismatch'
  | 'branch-not-merged'
  | 'branch-checked-out'
  | 'dirty-worktree'
  | 'no-upstream'
  | 'auth-required'
  | 'safe-directory'
  | 'network'
  | 'timeout'
  | 'push-rejected'
  | 'hook-failed'
  | 'detached-head'
  | 'cancelled'
  | 'unsupported-action'
  | 'internal'

/** The failure body every Git window route returns inside an HTTP response. */
export interface GitWindowError {
  readonly code: GitWindowErrorCode
  readonly message: string
  readonly detail?: string
}

/** The success/failure envelope shared by every Git window route. */
export type GitEnvelope<T> =
  | ({ readonly ok: true } & T)
  | { readonly ok: false; readonly error: GitWindowError }

/** Snapshot route payload. */
export interface SnapshotPayload {
  readonly snapshot: RepoSnapshot
  readonly commands: readonly CommandReceipt[]
}

/** Log route payload. */
export interface LogPayload {
  readonly commits: readonly CommitRow[]
  readonly hasMore: boolean
  readonly truncated: boolean
  readonly commands: readonly CommandReceipt[]
}

/** Commit-detail route payload. */
export interface CommitPayload {
  readonly commit: CommitDetail
  readonly commands: readonly CommandReceipt[]
}

/** Diff route payload. */
export interface DiffPayload {
  readonly patch: string
  readonly binary: boolean
  readonly truncated: boolean
  readonly commands: readonly CommandReceipt[]
}
