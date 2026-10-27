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
import { isSafeHash, isSafeRefName, isSafeRemoteName, normalizeRepoRelativePath } from './git-repo'
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
  | 'merge'
  | 'rebase'
  | 'reset'
  | 'revert'
  | 'cherryPick'
  | 'abortOperation'
  | 'stashPush'
  | 'stashPop'
  | 'stashDrop'
  | 'tagCreate'
  | 'tagDelete'
  | 'continueOperation'

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

/** Merge one ref into the current branch. */
export interface MergeAction {
  readonly kind: 'merge'
  readonly workspaceId: string
  readonly ref: string
}

/** Rebase the current branch onto one ref. */
export interface RebaseAction {
  readonly kind: 'rebase'
  readonly workspaceId: string
  readonly onto: string
}

/** Reset the current branch to one commit. */
export interface ResetAction {
  readonly kind: 'reset'
  readonly workspaceId: string
  readonly hash: string
  readonly mode: 'soft' | 'mixed' | 'hard'
}

/** Revert one commit into a new commit. */
export interface RevertAction {
  readonly kind: 'revert'
  readonly workspaceId: string
  readonly hash: string
}

/** Cherry-pick one commit onto the current branch. */
export interface CherryPickAction {
  readonly kind: 'cherryPick'
  readonly workspaceId: string
  readonly hash: string
}

/** Abort the operation currently in progress. */
export interface AbortOperationAction {
  readonly kind: 'abortOperation'
  readonly workspaceId: string
  readonly operation: 'merge' | 'rebase' | 'cherry-pick' | 'revert'
}

/** Stash the working tree changes. */
export interface StashPushAction {
  readonly kind: 'stashPush'
  readonly workspaceId: string
  readonly message?: string | undefined
  readonly includeUntracked: boolean
}

/** Pop one stash entry (defaults to the latest). */
export interface StashPopAction {
  readonly kind: 'stashPop'
  readonly workspaceId: string
  readonly ref?: string | undefined
}

/** Drop one stash entry without applying it. */
export interface StashDropAction {
  readonly kind: 'stashDrop'
  readonly workspaceId: string
  readonly ref?: string | undefined
}

/** Create a lightweight or annotated tag. */
export interface TagCreateAction {
  readonly kind: 'tagCreate'
  readonly workspaceId: string
  readonly name: string
  readonly hash?: string | undefined
  readonly message?: string | undefined
}

/** Delete one tag. */
export interface TagDeleteAction {
  readonly kind: 'tagDelete'
  readonly workspaceId: string
  readonly name: string
}

/** Continue the operation currently in progress after resolving conflicts. */
export interface ContinueOperationAction {
  readonly kind: 'continueOperation'
  readonly workspaceId: string
  readonly operation: 'merge' | 'rebase' | 'cherry-pick' | 'revert'
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
  | MergeAction
  | RebaseAction
  | ResetAction
  | RevertAction
  | CherryPickAction
  | AbortOperationAction
  | StashPushAction
  | StashPopAction
  | StashDropAction
  | TagCreateAction
  | TagDeleteAction
  | ContinueOperationAction

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
  merge: { level: 'l1', requiresConfirmation: false, summary: '合并分支' },
  rebase: { level: 'l1', requiresConfirmation: false, summary: '变基当前分支' },
  reset: { level: 'l2', requiresConfirmation: true, summary: '重置当前分支' },
  revert: { level: 'l1', requiresConfirmation: false, summary: '撤销提交' },
  cherryPick: { level: 'l1', requiresConfirmation: false, summary: '拣选提交' },
  abortOperation: { level: 'l1', requiresConfirmation: false, summary: '中止当前操作' },
  stashPush: { level: 'l1', requiresConfirmation: false, summary: '搁置更改' },
  stashPop: { level: 'l1', requiresConfirmation: false, summary: '弹出搁置' },
  stashDrop: { level: 'l2', requiresConfirmation: true, summary: '删除搁置' },
  tagCreate: { level: 'l1', requiresConfirmation: false, summary: '创建标签' },
  tagDelete: { level: 'l2', requiresConfirmation: true, summary: '删除标签' },
  continueOperation: { level: 'l1', requiresConfirmation: false, summary: '继续当前操作' },
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
    case 'merge': {
      const ref = record['ref']
      if (typeof ref !== 'string' || (!isSafeRefName(ref) && !isSafeHash(ref))) {
        return { ok: false, code: 'invalid-ref', message: 'the ref is not valid' }
      }
      return { ok: true, action: { kind, workspaceId, ref } }
    }
    case 'rebase': {
      const onto = record['onto']
      if (typeof onto !== 'string' || (!isSafeRefName(onto) && !isSafeHash(onto))) {
        return { ok: false, code: 'invalid-ref', message: 'the ref is not valid' }
      }
      return { ok: true, action: { kind, workspaceId, onto } }
    }
    case 'reset': {
      const hash = record['hash']
      if (typeof hash !== 'string' || !isSafeHash(hash)) {
        return { ok: false, code: 'invalid-ref', message: 'the commit hash is not valid' }
      }
      const mode = record['mode'] === undefined ? 'mixed' : record['mode']
      if (mode !== 'soft' && mode !== 'mixed' && mode !== 'hard') {
        return { ok: false, code: 'invalid-request', message: '"mode" must be "soft", "mixed" or "hard"' }
      }
      return { ok: true, action: { kind, workspaceId, hash, mode } }
    }
    case 'revert':
    case 'cherryPick': {
      const hash = record['hash']
      if (typeof hash !== 'string' || !isSafeHash(hash)) {
        return { ok: false, code: 'invalid-ref', message: 'the commit hash is not valid' }
      }
      return { ok: true, action: { kind, workspaceId, hash } }
    }
    case 'abortOperation': {
      const operation = record['operation']
      if (operation !== 'merge' && operation !== 'rebase' && operation !== 'cherry-pick' && operation !== 'revert') {
        return { ok: false, code: 'invalid-request', message: 'the operation is not valid' }
      }
      return { ok: true, action: { kind, workspaceId, operation } }
    }
    case 'stashPush': {
      const message = record['message']
      if (message !== undefined && (typeof message !== 'string' || message.length > 200 || /[\u0000]/.test(message))) {
        return { ok: false, code: 'invalid-request', message: 'the stash message is not valid' }
      }
      const includeUntracked = record['includeUntracked'] === undefined ? false : record['includeUntracked']
      if (typeof includeUntracked !== 'boolean') {
        return { ok: false, code: 'invalid-request', message: '"includeUntracked" must be a boolean' }
      }
      return {
        ok: true,
        action: {
          kind,
          workspaceId,
          includeUntracked,
          ...(message === undefined || message.trim() === '' ? {} : { message }),
        },
      }
    }
    case 'stashPop':
    case 'stashDrop': {
      const ref = record['ref']
      if (ref !== undefined && (typeof ref !== 'string' || !/^stash@\{\d+\}$/.test(ref))) {
        return { ok: false, code: 'invalid-ref', message: 'the stash reference is not valid' }
      }
      return { ok: true, action: { kind, workspaceId, ...(ref === undefined ? {} : { ref }) } }
    }
    case 'tagCreate': {
      const name = record['name']
      if (typeof name !== 'string' || !isSafeRefName(name)) {
        return { ok: false, code: 'invalid-ref', message: 'the tag name is not valid' }
      }
      const hash = record['hash']
      if (hash !== undefined && (typeof hash !== 'string' || !isSafeHash(hash))) {
        return { ok: false, code: 'invalid-ref', message: 'the tag target is not valid' }
      }
      const message = record['message']
      if (message !== undefined && (typeof message !== 'string' || message.length > 500 || /[\u0000]/.test(message))) {
        return { ok: false, code: 'invalid-request', message: 'the tag message is not valid' }
      }
      return {
        ok: true,
        action: {
          kind,
          workspaceId,
          name,
          ...(hash === undefined ? {} : { hash }),
          ...(message === undefined || message.trim() === '' ? {} : { message }),
        },
      }
    }
    case 'tagDelete': {
      const name = record['name']
      if (typeof name !== 'string' || !isSafeRefName(name)) {
        return { ok: false, code: 'invalid-ref', message: 'the tag name is not valid' }
      }
      return { ok: true, action: { kind, workspaceId, name } }
    }
    case 'continueOperation': {
      const operation = record['operation']
      if (operation !== 'merge' && operation !== 'rebase' && operation !== 'cherry-pick' && operation !== 'revert') {
        return { ok: false, code: 'invalid-request', message: 'the operation is not valid' }
      }
      return { ok: true, action: { kind, workspaceId, operation } }
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
  if (action.kind === 'reset') {
    return `reset:${root}:${action.mode}:${action.hash}`
  }
  if (action.kind === 'stashDrop') {
    return `stash-drop:${root}:${action.ref ?? 'stash@{0}'}`
  }
  if (action.kind === 'tagDelete') {
    return `tag-delete:${root}:${action.name}`
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
    case 'merge':
      return [writeInvocation(gitPath, root, ['merge', '--no-edit', action.ref], { label: 'merge' })]
    case 'rebase':
      return [writeInvocation(gitPath, root, ['rebase', action.onto], { label: 'rebase' })]
    case 'reset':
      return [writeInvocation(gitPath, root, ['reset', `--${action.mode}`, action.hash], { label: `reset --${action.mode}` })]
    case 'revert':
      return [writeInvocation(gitPath, root, ['revert', '--no-edit', action.hash], { label: 'revert' })]
    case 'cherryPick':
      return [writeInvocation(gitPath, root, ['cherry-pick', action.hash], { label: 'cherry-pick' })]
    case 'abortOperation':
      return [writeInvocation(gitPath, root, [action.operation, '--abort'], { label: `${action.operation} --abort` })]
    case 'continueOperation':
      if (action.operation === 'merge') {
        // Completing a merge is an ordinary commit with the prepared MERGE_MSG;
        // `merge --continue` would open an editor on some git versions.
        return [writeInvocation(gitPath, root, ['commit', '--no-edit'], { label: 'commit --no-edit' })]
      }
      return [writeInvocation(gitPath, root, [action.operation, '--continue'], { label: `${action.operation} --continue` })]
    case 'stashPush':
      return [writeInvocation(
        gitPath,
        root,
        ['stash', 'push', ...(action.message === undefined ? [] : ['-m', action.message]), ...(action.includeUntracked ? ['-u'] : [])],
        { label: 'stash push' },
      )]
    case 'stashPop':
      return [writeInvocation(gitPath, root, ['stash', 'pop', ...(action.ref === undefined ? [] : [action.ref])], { label: 'stash pop' })]
    case 'stashDrop':
      return [writeInvocation(gitPath, root, ['stash', 'drop', ...(action.ref === undefined ? [] : [action.ref])], { label: 'stash drop' })]
    case 'tagCreate':
      return [writeInvocation(
        gitPath,
        root,
        action.message === undefined
          ? ['tag', action.name, ...(action.hash === undefined ? [] : [action.hash])]
          : ['tag', '-a', action.name, '-m', action.message, ...(action.hash === undefined ? [] : [action.hash])],
        { label: action.message === undefined ? 'tag' : 'tag -a' },
      )]
    case 'tagDelete':
      return [writeInvocation(gitPath, root, ['tag', '-d', action.name], { label: 'tag -d' })]
  }
}
