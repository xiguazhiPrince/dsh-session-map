/**
 * Browser runtime for the Git tool window: the four read round-trips over the
 * plugin's own route family. Components receive this object, so an SSR test can
 * render them over a fixture instead of the network.
 *
 * @module dsh-session-map/git-workspace/window/runtime
 */
import type {
  CommandReceipt,
  CommitDetail,
  DiffPayload,
  GitEnvelope,
  LogPayload,
  RepoSnapshot,
} from '../git-types'
import type { GitAction } from '../git-actions'

/** Route family shared with the Host half. */
const ROUTE = '/plugin-git-workspace'

/** One failed round-trip, already decoded from the Host envelope. */
export class GitApiError extends Error {
  readonly code: string
  readonly detail: string | undefined

  constructor(code: string, message: string, detail?: string) {
    super(message)
    this.name = 'GitApiError'
    this.code = code
    this.detail = detail
  }
}

/** Snapshot round-trip result. */
export interface SnapshotResult {
  readonly snapshot: RepoSnapshot
  readonly commands: readonly CommandReceipt[]
}

/** Log round-trip parameters. */
export interface LogRequest {
  readonly workspaceId: string
  readonly ref?: string | undefined
  readonly limit?: number | undefined
  readonly skip?: number | undefined
  readonly query?: string | undefined
  readonly author?: string | undefined
  readonly since?: string | undefined
  readonly until?: string | undefined
  readonly file?: string | undefined
}

/** Commit-detail round-trip result. */
export interface CommitResult {
  readonly commit: CommitDetail
  readonly commands: readonly CommandReceipt[]
}

/** Diff round-trip parameters. */
export interface DiffRequest {
  readonly workspaceId: string
  readonly hash?: string | undefined
  readonly file: string
  readonly staged?: boolean | undefined
  readonly context?: number | undefined
}

/** Diff round-trip result. */
export interface DiffResult {
  readonly patch: string
  readonly binary: boolean
  readonly truncated: boolean
  readonly commands: readonly CommandReceipt[]
}

/** Everything the panel asks the Host. */
export interface GitWindowApi {
  snapshot(workspaceId: string, signal?: AbortSignal): Promise<SnapshotResult>
  log(request: LogRequest, signal?: AbortSignal): Promise<LogPayload>
  commit(workspaceId: string, hash: string, signal?: AbortSignal): Promise<CommitResult>
  diff(request: DiffRequest, signal?: AbortSignal): Promise<DiffResult>
  /** Ask the Host for a single-use confirmation token. */
  confirm(action: GitAction, signal?: AbortSignal): Promise<{ readonly token: string; readonly expiresAt: number }>
  /** Execute one write action, optionally carrying its confirmation token. */
  action(action: GitAction, confirmToken?: string, signal?: AbortSignal): Promise<{ readonly commands: readonly CommandReceipt[]; readonly summary: string }>
}

/** Chinese copy for the stable Host error codes. */
const ERROR_COPY: Readonly<Record<string, string>> = {
  'git-not-found': '没有找到 git 可执行文件，请先安装 git。',
  'not-a-repository': '当前工作区不是 git 仓库。',
  'workspace-not-found': '找不到这个工作区，请刷新后重试。',
  'invalid-path': '路径无效或不在当前仓库内。',
  'invalid-ref': '分支或提交不存在，可能已被删除。',
  'invalid-request': '请求参数无效，请刷新后重试。',
  busy: '正在执行另一个 Git 操作，请稍候。',
  lock: '另一个 git 进程正在操作仓库（index.lock 存在）。',
  conflict: '操作产生冲突，请解决冲突后继续或中止。',
  'nothing-to-commit': '没有要提交的内容。',
  'confirmation-required': '这个操作需要确认后才能执行。',
  'confirmation-mismatch': '确认信息与当前操作不匹配，请重新确认。',
  'branch-not-merged': '分支还有未合并的提交，确认删除请勾选强制删除。',
  'branch-checked-out': '不能删除当前已检出的分支，请先切换到其他分支。',
  'dirty-worktree': '工作区有未提交的更改，请先提交或搁置。',
  'no-upstream': '当前分支没有上游分支，请先设置跟踪。',
  'auth-required': 'Git 认证失败：请先在终端配置 SSH key 或凭据。',
  'safe-directory': '仓库属主与当前用户不一致，请按提示配置 safe.directory。',
  network: '无法连接远端仓库，请检查网络后重试。',
  timeout: '操作超时，请检查网络或仓库大小后重试。',
  'push-rejected': '推送被拒绝：远端有新的提交，请先获取并合并。',
  'hook-failed': '提交被 Git 钩子阻止，请查看输出。',
  'detached-head': '当前处于分离 HEAD 状态，请先检出一个分支。',
  cancelled: '操作已取消；若已生效请刷新查看。',
  'unsupported-action': '这个操作尚未支持。',
  'parse-failed': 'Host 无法解析 git 输出，请刷新后重试。',
  internal: 'Host 内部错误，请重试；持续失败请查看 DSH 日志。',
}

/**
 * Localize one Host error code, falling back to the Host message.
 * @param code - stable error code.
 * @param fallback - Host message when the code is unknown.
 * @returns display text.
 */
export function describeGitError(code: string, fallback: string): string {
  return ERROR_COPY[code] ?? fallback
}

/** Whether a thrown value is an abort from a replaced request. */
export function isAbortError(error: unknown): boolean {
  return typeof error === 'object' && error !== null && (error as { name?: unknown }).name === 'AbortError'
}

/** Build a query string, omitting undefined/empty values. */
function queryString(params: Readonly<Record<string, string | number | undefined>>): string {
  const search = new URLSearchParams()
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined) continue
    if (typeof value === 'string' && value === '') continue
    search.set(key, String(value))
  }
  const text = search.toString()
  return text === '' ? '' : `?${text}`
}

/** GET one route and decode its envelope. */
async function getJson<T>(path: string, signal?: AbortSignal): Promise<T> {
  const init: RequestInit = { method: 'GET', cache: 'no-store' }
  if (signal !== undefined) init.signal = signal
  const response = await fetch(new URL(path, document.baseURI), init)
  const text = await response.text()
  let body: unknown
  try {
    body = text === '' ? undefined : JSON.parse(text) as unknown
  } catch {
    throw new GitApiError('bad-response', `Host 返回了无法解析的响应（HTTP ${response.status}）`)
  }
  const envelope = body as (GitEnvelope<unknown> & T) | undefined
  if (envelope === undefined || envelope.ok !== true) {
    const failure = (envelope as { error?: { code?: unknown; message?: unknown; detail?: unknown } } | undefined)?.error
    throw new GitApiError(
      typeof failure?.code === 'string' ? failure.code : 'bad-response',
      typeof failure?.message === 'string' ? failure.message : `HTTP ${response.status}`,
      typeof failure?.detail === 'string' ? failure.detail : undefined,
    )
  }
  return envelope as T
}

/** POST one route and decode its envelope. */
async function postJson<T>(path: string, body: unknown, signal?: AbortSignal): Promise<T> {
  const init: RequestInit = {
    method: 'POST',
    cache: 'no-store',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  }
  if (signal !== undefined) init.signal = signal
  const response = await fetch(new URL(path, document.baseURI), init)
  const text = await response.text()
  let decoded: unknown
  try {
    decoded = text === '' ? undefined : JSON.parse(text) as unknown
  } catch {
    throw new GitApiError('bad-response', `Host 返回了无法解析的响应（HTTP ${response.status}）`)
  }
  const envelope = decoded as (GitEnvelope<unknown> & T) | undefined
  if (envelope === undefined || envelope.ok !== true) {
    const failure = (envelope as { error?: { code?: unknown; message?: unknown; detail?: unknown } } | undefined)?.error
    throw new GitApiError(
      typeof failure?.code === 'string' ? failure.code : 'bad-response',
      typeof failure?.message === 'string' ? failure.message : `HTTP ${response.status}`,
      typeof failure?.detail === 'string' ? failure.detail : undefined,
    )
  }
  return envelope as T
}

/** Build the live runtime over `fetch`. */
export function createGitWindowRuntime(): GitWindowApi {
  return {
    async snapshot(workspaceId: string, signal?: AbortSignal): Promise<SnapshotResult> {
      return await getJson<SnapshotResult>(
        `${ROUTE}/snapshot${queryString({ workspaceId })}`,
        signal,
      )
    },
    async log(request: LogRequest, signal?: AbortSignal): Promise<LogPayload> {
      return await getJson<LogPayload>(
        `${ROUTE}/log${queryString({
          workspaceId: request.workspaceId,
          ref: request.ref,
          limit: request.limit,
          skip: request.skip,
          query: request.query,
          author: request.author,
          since: request.since,
          until: request.until,
          file: request.file,
        })}`,
        signal,
      )
    },
    async commit(workspaceId: string, hash: string, signal?: AbortSignal): Promise<CommitResult> {
      return await getJson<CommitResult>(
        `${ROUTE}/commit${queryString({ workspaceId, hash })}`,
        signal,
      )
    },
    async diff(request: DiffRequest, signal?: AbortSignal): Promise<DiffResult> {
      const payload = await getJson<DiffPayload>(
        `${ROUTE}/diff${queryString({
          workspaceId: request.workspaceId,
          hash: request.hash,
          file: request.file,
          staged: request.staged === true ? 1 : undefined,
          context: request.context ?? 3,
        })}`,
        signal,
      )
      return payload
    },
    async confirm(action: GitAction, signal?: AbortSignal): Promise<{ readonly token: string; readonly expiresAt: number }> {
      return await postJson<{ readonly token: string; readonly expiresAt: number }>(`${ROUTE}/confirm`, action, signal)
    },
    async action(action: GitAction, confirmToken?: string, signal?: AbortSignal): Promise<{ readonly commands: readonly CommandReceipt[]; readonly summary: string }> {
      const body = confirmToken === undefined ? action : { ...action, confirm: confirmToken }
      return await postJson<{ readonly commands: readonly CommandReceipt[]; readonly summary: string }>(`${ROUTE}/action`, body, signal)
    },
  }
}
