/**
 * Write-action vocabulary for the Git tool window: the action union, the policy
 * levels, the confirmation target and the argv each action produces.
 *
 * Pure module: parsing and argv construction are testable without a Cordis
 * context, a real git, or the network. The Host still owns repository resolution
 * and confirmation-token consumption.
 *
 * @module dsh-session-map/git-workspace/git-actions
 */
import type { GitWindowErrorCode } from './git-types'
import { isSafeRefName, isSafeRemoteName, normalizeRepoRelativePath } from './git-repo'
import { writeInvocation, type GitInvocation } from './git-command'

/** Every write action the tool window can ask the Host to perform. */
export type ActionKind =
  | 'stage'
  | 'unstage'
  | 'discard'
  | 'commit'
  | 'push'
  | 'checkout'
  | 'createBranch'
  | 'deleteBranch'
  | 'renameBranch'
  | 'fetch'
  | 'update'

/** Stage one set of paths. */
export interface StageAction {
  readonly kind: 'stage'
  readonly workspaceId: string
  readonly paths: readonly string[]
}

/** Unstage one set of paths. */
export interface UnstageAction {
  readonly kind: 'unstage'
  readonly workspaceId: string
  readonly paths: readonly string[]
}

/** Discard tracked changes and/or delete untracked files. */
export interface DiscardAction {
  readonly kind: 'discard'
  readonly workspaceId: string
  readonly tracked: readonly string[]
  readonly untracked: readonly string[]
}

/** Create one commit from the staged changes. */
export interface CommitAction {
  readonly kind: 'commit'
  readonly workspaceId: string
  readonly message: string
  readonly amend: boolean
}

/** Push the current branch; a lease-forced push is the L3 variant. */
export interface PushAction {
  readonly kind: 'push'
  readonly workspaceId: string
  readonly remote?: string | undefined
  readonly branch?: string | undefined
  readonly setUpstream?: boolean | undefined
  readonly forceWithLease?: boolean | undefined
}

/** Check out one local branch. */
export interface CheckoutAction {
  readonly kind: 'checkout'
  readonly workspaceId: string
  readonly ref: string
}

/** Create (and switch to) a local branch. */
export interface CreateBranchAction {
  readonly kind: 'createBranch'
  readonly workspaceId: string
  readonly name: string
  readonly start?: string | undefined
}

/** Delete a local branch; `force` maps to `-D`. */
export interface DeleteBranchAction {
  readonly kind: 'deleteBranch'
  readonly workspaceId: string
  readonly name: string
  readonly force: boolean
}

/** Rename a local branch. */
export interface RenameBranchAction {
  readonly kind: 'renameBranch'
  readonly workspaceId: string
  readonly from: string
  readonly to: string
}

/** Fetch remote refs without touching the working tree. */
export interface FetchAction {
  readonly kind: 'fetch'
  readonly workspaceId: string
  readonly all: boolean
  readonly remote?: string | undefined
}

/** Fetch the upstream and merge or rebase it into the current branch. */
export interface UpdateAction {
  readonly kind: 'update'
  readonly workspaceId: string
  readonly mode: 'merge' | 'rebase'
}

/** One parsed write action. */
export type GitAction =
  | StageAction
  | UnstageAction
  | DiscardAction
  | CommitAction
  | PushAction
  | CheckoutAction
  | CreateBranchAction
  | DeleteBranchAction
  | RenameBranchAction
  | FetchAction
  | UpdateAction

/** Validation result for one raw action body. */
export type ActionParseResult =
  | { readonly ok: true; readonly action: GitAction }
  | { readonly ok: false; readonly code: GitWindowErrorCode; readonly message: string }

/** Policy facts for one action kind. */
export interface ActionPolicy {
  /** `l1` writes are recoverable and run without a confirmation; `l2`/`l3` need one. */
  readonly level: 'l1' | 'l2' | 'l3'
  readonly requiresConfirmation: boolean
  readonly summary: string
}

/** Policy for every action the panel exposes. */
export const ACTION_POLICY: Readonly<Record<ActionKind, ActionPolicy>> = {
  stage: { level: 'l1', requiresConfirmation: false, summary: '暂存文件' },
  unstage: { level: 'l1', requiresConfirmation: false, summary: '取消暂存' },
  discard: { level: 'l2', requiresConfirmation: true, summary: '丢弃更改' },
  commit: { level: 'l1', requiresConfirmation: false, summary: '提交' },
  push: { level: 'l1', requiresConfirmation: false, summary: '推送' },
  checkout: { level: 'l1', requiresConfirmation: false, summary: '检出分支' },
  createBranch: { level: 'l1', requiresConfirmation: false, summary: '新建分支' },
  deleteBranch: { level: 'l2', requiresConfirmation: true, summary: '删除分支' },
  renameBranch: { level: 'l1', requiresConfirmation: false, summary: '重命名分支' },
  fetch: { level: 'l1', requiresConfirmation: false, summary: '获取远端更新' },
  update: { level: 'l1', requiresConfirmation: false, summary: '更新当前分支' },
}

/**
 * Policy for one concrete action; the lease-forced push is the L3 variant of the
 * otherwise L1 push, so policy cannot be keyed by kind alone.
 * @param action - parsed action.
 * @returns the effective policy.
 */
export function policyFor(action: GitAction): ActionPolicy {
  if (action.kind === 'push' && action.forceWithLease === true) {
    return { level: 'l3', requiresConfirmation: true, summary: '强制推送（--force-with-lease）' }
  }
  return ACTION_POLICY[action.kind]
}

/** Longest commit message accepted. */
const MAX_MESSAGE_LENGTH = 5_000

/** Largest path batch one action may carry. */
const MAX_PATHS = 1_000

/** Read a value that may be a JSON object. */
function asRecord(value: unknown): Record<string, unknown> | undefined {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return undefined
  return value as Record<string, unknown>
}

/** Read one repository-relative path array. */
function readPaths(value: unknown, field: string): { readonly ok: true; readonly paths: string[] } | { readonly ok: false; readonly message: string } {
  if (!Array.isArray(value)) return { ok: false, message: `"${field}" must be an array of paths` }
  if (value.length > MAX_PATHS) return { ok: false, message: `"${field}" has too many paths` }
  const paths: string[] = []
  for (const entry of value) {
    const normalized = normalizeRepoRelativePath(entry)
    if (!normalized.ok) return { ok: false, message: `${field}: ${normalized.message}` }
    paths.push(normalized.path)
  }
  return { ok: true, paths }
}

/** Validate the workspace id shared by every action. */
function readWorkspace(record: Record<string, unknown>): string | undefined {
  const value = record['workspaceId']
  if (typeof value !== 'string' || value.trim() === '' || value.length > 200) return undefined
  return value.trim()
}

/**
 * Parse one raw `/action` (or `/confirm`) body.
 * @param input - decoded JSON.
 * @returns the typed action, or the first rejected field.
 */
export function parseActionRequest(input: unknown): ActionParseResult {
  const record = asRecord(input)
  if (record === undefined) {
    return { ok: false, code: 'invalid-request', message: 'the request body must be a JSON object' }
  }
  const workspaceId = readWorkspace(record)
  if (workspaceId === undefined) {
    return { ok: false, code: 'invalid-request', message: '"workspaceId" must be a non-empty string' }
  }
  const kind = record['kind']
  switch (kind) {
    case 'stage':
    case 'unstage': {
      const paths = readPaths(record['paths'], 'paths')
      if (!paths.ok) return { ok: false, code: 'invalid-path', message: paths.message }
      if (paths.paths.length === 0) return { ok: false, code: 'invalid-request', message: 'at least one path is required' }
      return { ok: true, action: { kind, workspaceId, paths: paths.paths } }
    }
    case 'discard': {
      const tracked = readPaths(record['tracked'] ?? [], 'tracked')
      if (!tracked.ok) return { ok: false, code: 'invalid-path', message: tracked.message }
      const untracked = readPaths(record['untracked'] ?? [], 'untracked')
      if (!untracked.ok) return { ok: false, code: 'invalid-path', message: untracked.message }
      if (tracked.paths.length === 0 && untracked.paths.length === 0) {
        return { ok: false, code: 'invalid-request', message: 'at least one path is required' }
      }
      return { ok: true, action: { kind, workspaceId, tracked: tracked.paths, untracked: untracked.paths } }
    }
    case 'commit': {
      const message = record['message']
      if (typeof message !== 'string' || message.trim() === '') {
        return { ok: false, code: 'invalid-request', message: 'a commit message is required' }
      }
      if (message.length > MAX_MESSAGE_LENGTH) {
        return { ok: false, code: 'invalid-request', message: 'the commit message is too long' }
      }
      if (/[\u0000]/.test(message)) {
        return { ok: false, code: 'invalid-request', message: 'the commit message contains a NUL character' }
      }
      const amend = record['amend'] === undefined ? false : record['amend']
      if (typeof amend !== 'boolean') return { ok: false, code: 'invalid-request', message: '"amend" must be a boolean' }
      return { ok: true, action: { kind, workspaceId, message, amend } }
    }
    case 'push': {
      const remote = record['remote']
      const branch = record['branch']
      const setUpstream = record['setUpstream'] === undefined ? false : record['setUpstream']
      const forceWithLease = record['forceWithLease'] === undefined ? false : record['forceWithLease']
      if (typeof setUpstream !== 'boolean') return { ok: false, code: 'invalid-request', message: '"setUpstream" must be a boolean' }
      if (typeof forceWithLease !== 'boolean') return { ok: false, code: 'invalid-request', message: '"forceWithLease" must be a boolean' }
      if (remote !== undefined && !isSafeRemoteName(remote)) {
        return { ok: false, code: 'invalid-request', message: 'the remote name is not valid' }
      }
      if (branch !== undefined && !isSafeRefName(branch)) {
        return { ok: false, code: 'invalid-ref', message: 'the branch name is not valid' }
      }
      if (setUpstream && (remote === undefined || branch === undefined)) {
        return { ok: false, code: 'invalid-request', message: 'setting an upstream needs both remote and branch' }
      }
      return {
        ok: true,
        action: {
          kind,
          workspaceId,
          ...(remote === undefined ? {} : { remote }),
          ...(branch === undefined ? {} : { branch }),
          ...(setUpstream ? { setUpstream: true } : {}),
          ...(forceWithLease ? { forceWithLease: true } : {}),
        },
      }
    }
    case 'checkout': {
      const ref = record['ref']
      if (typeof ref !== 'string' || !isSafeRefName(ref)) {
        return { ok: false, code: 'invalid-ref', message: 'the branch name is not valid' }
      }
      return { ok: true, action: { kind, workspaceId, ref } }
    }
    case 'createBranch': {
      const name = record['name']
      if (typeof name !== 'string' || !isSafeRefName(name)) {
        return { ok: false, code: 'invalid-ref', message: 'the branch name is not valid' }
      }
      const start = record['start']
      if (start !== undefined && (typeof start !== 'string' || !isSafeRefName(start))) {
        return { ok: false, code: 'invalid-ref', message: 'the branch start point is not valid' }
      }
      return { ok: true, action: { kind, workspaceId, name, ...(start === undefined ? {} : { start }) } }
    }
    case 'deleteBranch': {
      const name = record['name']
      if (typeof name !== 'string' || !isSafeRefName(name)) {
        return { ok: false, code: 'invalid-ref', message: 'the branch name is not valid' }
      }
      const force = record['force'] === undefined ? false : record['force']
      if (typeof force !== 'boolean') return { ok: false, code: 'invalid-request', message: '"force" must be a boolean' }
      return { ok: true, action: { kind, workspaceId, name, force } }
    }
    case 'renameBranch': {
      const from = record['from']
      const to = record['to']
      if (typeof from !== 'string' || !isSafeRefName(from) || typeof to !== 'string' || !isSafeRefName(to)) {
        return { ok: false, code: 'invalid-ref', message: 'the branch name is not valid' }
      }
      if (from === to) return { ok: false, code: 'invalid-request', message: 'the new name equals the old name' }
      return { ok: true, action: { kind, workspaceId, from, to } }
    }
    case 'fetch': {
      const all = record['all'] === undefined ? true : record['all']
      if (typeof all !== 'boolean') return { ok: false, code: 'invalid-request', message: '"all" must be a boolean' }
      const remote = record['remote']
      if (remote !== undefined && !isSafeRemoteName(remote)) {
        return { ok: false, code: 'invalid-request', message: 'the remote name is not valid' }
      }
      if (!all && remote === undefined) {
        return { ok: false, code: 'invalid-request', message: 'a remote is required when not fetching all remotes' }
      }
      return { ok: true, action: { kind, workspaceId, all, ...(remote === undefined ? {} : { remote }) } }
    }
    case 'update': {
      const mode = record['mode']
      if (mode !== 'merge' && mode !== 'rebase') {
        return { ok: false, code: 'invalid-request', message: '"mode" must be "merge" or "rebase"' }
      }
      return { ok: true, action: { kind, workspaceId, mode } }
    }
    default:
      return { ok: false, code: 'unsupported-action', message: `unsupported action: ${String(kind)}` }
  }
}

/** Stable fingerprint for a sorted path batch. */
function pathFingerprint(paths: readonly string[]): string {
  const text = [...paths].sort().join('\u0000')
  let hash = 5381
  for (let index = 0; index < text.length; index += 1) {
    hash = ((hash << 5) + hash) ^ text.charCodeAt(index)
  }
  return (hash >>> 0).toString(16)
}

/**
 * Compute the exact target a confirmation is bound to.
 * @param action - parsed action.
 * @param root - resolved repository root.
 * @returns a token target, or undefined for actions that need no confirmation.
 */
export function confirmationTarget(action: GitAction, root: string): string | undefined {
  if (!policyFor(action).requiresConfirmation) return undefined
  if (action.kind === 'discard') {
    return `discard:${root}:${pathFingerprint([...action.tracked, ...action.untracked])}`
  }
  if (action.kind === 'deleteBranch') {
    return `delete-branch:${root}:${action.name}:${action.force ? 'force' : 'safe'}`
  }
  if (action.kind === 'push' && action.forceWithLease === true) {
    return `force-push:${root}:${action.remote ?? ''}:${action.branch ?? ''}`
  }
  return `${action.kind}:${root}`
}

/** Context one action builder needs. */
export interface ActionBuildContext {
  readonly gitPath: string
  readonly root: string
}

/**
 * Build the ordered git invocations for one action.
 *
 * A discard runs tracked restores first, then a `clean -nd` preview, then the
 * actual `clean -fd`: the preview is what the preview panel and the test suite
 * read, and `-x` is never added.
 * @param action - parsed action.
 * @param context - resolved executable and repository.
 * @returns the invocations in execution order.
 */
export function buildActionInvocations(action: GitAction, context: ActionBuildContext): readonly GitInvocation[] {
  const { gitPath, root } = context
  switch (action.kind) {
    case 'stage':
      return [writeInvocation(gitPath, root, ['add', '-A', '--', ...action.paths], { label: 'add' })]
    case 'unstage':
      return [writeInvocation(gitPath, root, ['restore', '--staged', '--', ...action.paths], { label: 'restore' })]
    case 'discard': {
      const invocations: GitInvocation[] = []
      if (action.tracked.length > 0) {
        invocations.push(writeInvocation(
          gitPath,
          root,
          ['restore', '--worktree', '--source=HEAD', '--', ...action.tracked],
          { label: 'restore' },
        ))
      }
      if (action.untracked.length > 0) {
        invocations.push(writeInvocation(gitPath, root, ['clean', '-nd', '--', ...action.untracked], { label: 'clean-preview' }))
        invocations.push(writeInvocation(gitPath, root, ['clean', '-fd', '--', ...action.untracked], { label: 'clean' }))
      }
      return invocations
    }
    case 'commit':
      return [writeInvocation(
        gitPath,
        root,
        action.amend
          ? ['commit', '--amend', '-m', action.message, '--cleanup=whitespace']
          : ['commit', '-m', action.message, '--cleanup=whitespace'],
        { label: action.amend ? 'commit --amend' : 'commit' },
      )]
    case 'push': {
      const args: string[] = ['push', '--porcelain', '--progress']
      if (action.forceWithLease === true) args.push('--force-with-lease')
      if (action.setUpstream === true && action.remote !== undefined && action.branch !== undefined) {
        args.push('-u', action.remote, action.branch)
      } else if (action.remote !== undefined && action.branch !== undefined) {
        args.push(action.remote, action.branch)
      }
      return [writeInvocation(gitPath, root, args, { label: action.forceWithLease === true ? 'push --force-with-lease' : 'push' })]
    }
    case 'checkout':
      return [writeInvocation(gitPath, root, ['switch', '--', action.ref], { label: 'switch' })]
    case 'createBranch':
      return [writeInvocation(
        gitPath,
        root,
        ['switch', '-c', action.name, ...(action.start === undefined ? [] : [action.start])],
        { label: 'switch -c' },
      )]
    case 'deleteBranch':
      return [writeInvocation(
        gitPath,
        root,
        ['branch', action.force ? '-D' : '-d', '--', action.name],
        { label: action.force ? 'branch -D' : 'branch -d' },
      )]
    case 'renameBranch':
      return [writeInvocation(gitPath, root, ['branch', '-m', action.from, action.to], { label: 'branch -m' })]
    case 'fetch': {
      const args = ['fetch', '--prune']
      if (action.all) args.push('--all')
      else if (action.remote !== undefined) args.push(action.remote)
      return [writeInvocation(gitPath, root, args, { label: 'fetch' })]
    }
    case 'update':
      return [
        writeInvocation(gitPath, root, ['fetch', '--prune'], { label: 'fetch' }),
        writeInvocation(
          gitPath,
          root,
          action.mode === 'rebase' ? ['rebase', '@{upstream}'] : ['merge', '--no-edit', '@{upstream}'],
          { label: action.mode === 'rebase' ? 'rebase' : 'merge' },
        ),
      ]
  }
}
