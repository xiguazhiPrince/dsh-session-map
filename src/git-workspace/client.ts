/**
 * Browser half of the Git workspace feature: the Settings page that clones a
 * repository and adds it as a Workspace.
 *
 * The page owns only presentation and the two Host round-trips. Cloning,
 * validation and Workspace registration stay in `host.ts`; the remembered
 * parent directory is a browser-local preference, while the shallow switch is
 * a per-clone choice that resets to full history on every visit.
 *
 * @module dsh-session-map/git-workspace/client
 */
import type { Context } from '@deepseek-ai/cordis'
import * as React from 'react'
import type {
  GitWorkspaceCloneEnvelope,
  GitWorkspaceStateEnvelope,
} from './git'

/** Browser-local key holding the last parent directory the user chose. */
const PARENT_DIRECTORY_KEY = 'dsh.git-workspace.parentDir'

/** Route family shared with the Host half. */
const ROUTE = '/plugin-git-workspace'

/** Chinese copy for the stable Host failure codes. */
const FAILURE_COPY: Readonly<Record<string, string>> = {
  'invalid-url': '仓库地址无效，请检查后重试。',
  'unsupported-url': '地址格式不受支持：请使用 https / ssh / git / file 地址，或 git@host:path 形式。',
  'invalid-directory': '存放目录无效：请选择一个绝对路径目录。',
  'git-not-found': '没有找到 git 可执行文件，请先安装 git。',
  'parent-missing': '存放目录不存在或不可写，请重新选择。',
  'target-exists': '目标目录已存在，请换一个存放目录，或先移走旧目录。',
  authentication: 'Git 认证失败：请先在终端配置 SSH key 或 git 凭据；本页面不接收密码。',
  'not-found': '仓库不存在，或当前账号无权访问。',
  network: '无法连接仓库所在的服务器，请检查网络后重试。',
  timeout: '克隆超时，请检查网络，或打开浅克隆后重试。',
  busy: '已有克隆任务正在进行，请稍候再试。',
  'workspace-failed': '仓库已克隆成功，但添加工作区失败。',
  'clone-failed': '克隆失败，请查看下方 git 输出。',
  'invalid-request': '请求内容无效，请刷新页面后重试。',
  'unsupported-media-type': '请求格式不被接受，请刷新页面后重试。',
  'picker-failed': '打开目录选择器失败。',
  forbidden: '这个页面只允许从本机操作；当前连接来自其他机器，已拒绝。',
  internal: 'Host 内部错误，请重试；持续失败时可查看 DSH 日志。',
  'bad-response': 'Host 返回了无法解析的响应，请刷新页面后重试。',
}

/** One read of a browser-local preference. */
function readStored(key: string): string | undefined {
  if (typeof localStorage === 'undefined') return undefined
  try {
    const value = localStorage.getItem(key)
    return value === null ? undefined : value
  } catch {
    return undefined
  }
}

/** One write of a browser-local preference; denial is not an error. */
function writeStored(key: string, value: string): void {
  if (typeof localStorage === 'undefined') return
  try {
    localStorage.setItem(key, value)
  } catch {
    // Storage can be denied (private mode, blocked site data); the page still works.
  }
}

/** Whether an unknown thrown value is the abort of a page-owned request. */
function isAbortError(error: unknown): boolean {
  return typeof error === 'object' && error !== null && (error as { name?: unknown }).name === 'AbortError'
}

/** Printable text for an unknown thrown value. */
function errorText(error: unknown): string {
  if (error instanceof Error) return error.message
  if (typeof error === 'string') return error
  return String(error)
}

/** Successful state read, normalized for the page. */
export interface GitWorkspaceState {
  readonly gitAvailable: boolean
  readonly defaultParentDir: string | null
}

/** One clone request the page sends. */
export interface GitWorkspaceCloneInput {
  readonly url: string
  readonly parentDir: string
  readonly shallow: boolean
}

/** One clone result the page consumes. */
export type GitWorkspaceCloneResult =
  | { readonly ok: true; readonly workspace: { readonly id: string; readonly path: string; readonly title: string } }
  | { readonly ok: false; readonly error: { readonly code: string; readonly message: string; readonly detail?: string } }

/** Everything the page needs from its Host and the browser. */
export interface GitWorkspaceRuntime {
  /** Open the Host's native directory picker; null when the user cancelled. */
  pickDirectory(): Promise<string | null>
  /** Read git availability and the first-use parent directory. */
  loadState(signal?: AbortSignal): Promise<GitWorkspaceState>
  /** Clone one repository and add it as a Workspace. */
  clone(input: GitWorkspaceCloneInput, signal?: AbortSignal): Promise<GitWorkspaceCloneResult>
}

/** Structural view of the context's untyped service lookup. */
interface ServiceLocator {
  get(name: string): unknown
}

/** The directory-picking capability the page uses. */
interface UiWorkspaceService {
  pickDirectory(): Promise<string | null>
}

/** One Host JSON round-trip. */
interface HostRequest {
  readonly method: 'GET' | 'POST'
  readonly body?: unknown
}

/** One raw Host response. */
interface HostResponse {
  readonly status: number
  readonly body: unknown
}

/**
 * Fetch one Host route on the page's own origin.
 * @param path - route path under this plugin's prefix.
 * @param request - method and optional JSON body.
 * @returns the HTTP status and decoded body.
 */
async function requestHost(path: string, request: HostRequest, signal?: AbortSignal): Promise<HostResponse> {
  const init: RequestInit = { method: request.method, cache: 'no-store' }
  if (signal !== undefined) init.signal = signal
  if (request.method === 'POST') {
    init.headers = { 'content-type': 'application/json' }
    if (request.body !== undefined) init.body = JSON.stringify(request.body)
  }
  const response = await fetch(new URL(path, document.baseURI), init)
  const text = await response.text()
  if (text === '') return { status: response.status, body: undefined }
  try {
    return { status: response.status, body: JSON.parse(text) as unknown }
  } catch {
    return { status: response.status, body: undefined }
  }
}

/**
 * Build the page runtime over the live client context.
 *
 * Services are read lazily on use: the directory picker belongs to a separate
 * plugin bundle that may compose after this one.
 * @param ctx - browser root context.
 * @returns the runtime the Settings page calls.
 */
export function createGitWorkspaceRuntime(ctx: Context): GitWorkspaceRuntime {
  const locator = ctx as unknown as ServiceLocator
  return {
    async pickDirectory(): Promise<string | null> {
      const uiWorkspace = locator.get('uiWorkspace') as UiWorkspaceService | undefined
      if (uiWorkspace === undefined || typeof uiWorkspace.pickDirectory !== 'function') {
        throw new Error('目录选择服务不可用')
      }
      return await uiWorkspace.pickDirectory()
    },
    async loadState(signal?: AbortSignal): Promise<GitWorkspaceState> {
      const response = await requestHost(`${ROUTE}/state`, { method: 'GET' }, signal)
      const envelope = response.body as GitWorkspaceStateEnvelope | undefined
      if (response.status !== 200 || envelope?.ok !== true) {
        throw new Error(`Host 状态读取失败（HTTP ${response.status}）`)
      }
      return {
        gitAvailable: envelope.git?.available === true,
        defaultParentDir: typeof envelope.defaultParentDir === 'string' ? envelope.defaultParentDir : null,
      }
    },
    async clone(input: GitWorkspaceCloneInput, signal?: AbortSignal): Promise<GitWorkspaceCloneResult> {
      const response = await requestHost(`${ROUTE}/clone`, { method: 'POST', body: input }, signal)
      const envelope = response.body as GitWorkspaceCloneEnvelope | undefined
      if (envelope?.ok === true) {
        const workspace = envelope.workspace
        if (workspace === undefined) {
          return { ok: false, error: { code: 'bad-response', message: 'the Host returned no workspace' } }
        }
        return { ok: true, workspace: { id: workspace.id, path: workspace.path, title: workspace.title } }
      }
      const failure = envelope?.error
      return {
        ok: false,
        error: {
          code: typeof failure?.code === 'string' ? failure.code : 'clone-failed',
          message: typeof failure?.message === 'string' ? failure.message : `HTTP ${response.status}`,
          ...(typeof failure?.detail === 'string' ? { detail: failure.detail } : {}),
        },
      }
    },
  }
}

/** One failure notice the page renders. */
interface FailureView {
  readonly code: string
  readonly message: string
  readonly detail?: string
}

/**
 * Build the Settings section body.
 * @param runtime - Host and browser capabilities.
 * @returns a slot component rendering the clone form.
 */
export function createGitWorkspaceSettings(runtime: GitWorkspaceRuntime): () => React.ReactElement {
  return function GitWorkspaceSettings(): React.ReactElement {
    const [url, setUrl] = React.useState('')
    const [parentDir, setParentDir] = React.useState(() => readStored(PARENT_DIRECTORY_KEY) ?? '')
    // Full history is the default and the switch is per-clone: it is never
    // remembered, so a shallow choice for one repository cannot silently apply
    // to the next one.
    const [shallow, setShallow] = React.useState(false)
    const [gitAvailable, setGitAvailable] = React.useState<boolean | null>(null)
    const [cloning, setCloning] = React.useState(false)
    const [failure, setFailure] = React.useState<FailureView | null>(null)
    const [added, setAdded] = React.useState<{ readonly title: string; readonly path: string } | null>(null)
    // One request at a time; unmounting the Settings page aborts it so the
    // Host sees a closed connection and stops its git process.
    const inFlight = React.useRef<AbortController | null>(null)

    React.useEffect(() => {
      const controller = new AbortController()
      let cancelled = false
      runtime.loadState(controller.signal).then((state) => {
        if (cancelled) return
        setGitAvailable(state.gitAvailable)
        // A remembered directory always wins; the Host default only fills an
        // empty field, and is not persisted so the next session can propose it
        // again until the user actually chooses.
        setParentDir(previous => previous === '' ? (state.defaultParentDir ?? '') : previous)
      }).catch((error: unknown) => {
        if (cancelled || isAbortError(error)) return
        setGitAvailable(null)
        setFailure({ code: 'state-unavailable', message: `无法连接 Host：${errorText(error)}` })
      })
      return () => {
        cancelled = true
        controller.abort()
      }
    }, [])

    React.useEffect(() => () => { inFlight.current?.abort() }, [])

    const updateParentDir = (next: string): void => {
      setParentDir(next)
      setFailure(null)
      setAdded(null)
      writeStored(PARENT_DIRECTORY_KEY, next)
    }

    const chooseDirectory = async (): Promise<void> => {
      setFailure(null)
      try {
        const picked = await runtime.pickDirectory()
        if (picked !== null) updateParentDir(picked)
      } catch (error) {
        setFailure({ code: 'picker-failed', message: FAILURE_COPY['picker-failed'] ?? errorText(error) })
      }
    }

    const submit = async (event: React.FormEvent<HTMLFormElement>): Promise<void> => {
      event.preventDefault()
      if (cloning) return
      const trimmedUrl = url.trim()
      const trimmedParent = parentDir.trim()
      if (trimmedUrl === '') {
        setFailure({ code: 'invalid-url', message: '请先填写 Git 仓库地址。' })
        return
      }
      if (trimmedParent === '') {
        setFailure({ code: 'invalid-directory', message: '请先选择存放目录。' })
        return
      }
      setCloning(true)
      setFailure(null)
      setAdded(null)
      const controller = new AbortController()
      inFlight.current = controller
      try {
        const result = await runtime.clone({ url: trimmedUrl, parentDir: trimmedParent, shallow }, controller.signal)
        if (result.ok) {
          setAdded({ title: result.workspace.title, path: result.workspace.path })
          writeStored(PARENT_DIRECTORY_KEY, trimmedParent)
        } else {
          setFailure({
            code: result.error.code,
            message: FAILURE_COPY[result.error.code] ?? `克隆失败：${result.error.message}`,
            ...(result.error.detail === undefined ? {} : { detail: result.error.detail }),
          })
        }
      } catch (error) {
        if (!isAbortError(error)) setFailure({ code: 'network', message: `请求 Host 失败：${errorText(error)}` })
      } finally {
        inFlight.current = null
        setCloning(false)
      }
    }

    const toggleShallow = (): void => {
      setShallow(previous => !previous)
    }

    return React.createElement(
      'div',
      { className: 'gw-page' },
      React.createElement('style', null, CSS),
      React.createElement(
        'div',
        { className: 'gw-inner' },
        React.createElement(
          'header',
          { className: 'gw-head' },
          React.createElement('h1', { className: 'gw-title' }, '从 Git 克隆工作区'),
          React.createElement(
            'p',
            { className: 'gw-desc' },
            '填写仓库地址并选择存放目录。克隆完成后，这个目录会自动添加为 DSH 工作区。',
          ),
        ),
        gitAvailable === false
          ? React.createElement(
            'div',
            { className: 'gw-status gw-status--warn', role: 'status' },
            React.createElement('div', { className: 'gw-statusTitle' }, '没有检测到 git'),
            React.createElement('div', null, '请先安装 git 后可再回来克隆；本机已安装却仍看到这条提示时，刷新页面重试。'),
          )
          : null,
        React.createElement(
          'form',
          { className: 'gw-form', onSubmit: submit, 'aria-busy': cloning },
          React.createElement(
            'div',
            { className: 'gw-field' },
            React.createElement('label', { className: 'gw-label', htmlFor: 'gw-url' }, '仓库地址'),
            React.createElement('input', {
              id: 'gw-url',
              className: 'gw-input',
              type: 'text',
              inputMode: 'url',
              autoComplete: 'off',
              spellCheck: false,
              placeholder: 'https://github.com/owner/repo.git',
              value: url,
              disabled: cloning,
              onChange: (event) => { setUrl(event.currentTarget.value); setFailure(null); setAdded(null) },
            }),
            React.createElement(
              'p',
              { className: 'gw-hint' },
              '支持 https、ssh、git、file 地址，或 git@host:path 形式。私有仓库请先在终端配置好凭据。',
            ),
          ),
          React.createElement(
            'div',
            { className: 'gw-field' },
            React.createElement('label', { className: 'gw-label', htmlFor: 'gw-parent' }, '存放目录'),
            React.createElement(
              'div',
              { className: 'gw-dirRow' },
              React.createElement('input', {
                id: 'gw-parent',
                className: 'gw-input',
                type: 'text',
                autoComplete: 'off',
                spellCheck: false,
                placeholder: '例如 /Users/you/Developer/projects',
                value: parentDir,
                disabled: cloning,
                onChange: (event) => updateParentDir(event.currentTarget.value),
              }),
              React.createElement(
                'button',
                { type: 'button', className: 'gw-btn', onClick: chooseDirectory, disabled: cloning },
                '选择…',
              ),
            ),
            React.createElement(
              'p',
              { className: 'gw-hint' },
              '仓库会克隆到这个目录下新建的同名子目录；这里会记住你上次选择的目录。',
            ),
          ),
          React.createElement(
            'div',
            { className: 'gw-switchRow' },
            React.createElement(
              'button',
              {
                type: 'button',
                role: 'switch',
                'aria-checked': shallow,
                'aria-label': '浅克隆',
                className: 'gw-switch',
                onClick: toggleShallow,
                disabled: cloning,
              },
              React.createElement('span', { className: 'gw-switchThumb' }),
            ),
            React.createElement(
              'div',
              { className: 'gw-switchText' },
              React.createElement('div', { className: 'gw-switchTitle' }, '浅克隆（--depth 1）'),
              React.createElement(
                'div',
                { className: 'gw-hint' },
                '默认关闭，克隆完整提交历史；打开后只拉取最近一次提交，更快、更省空间。',
              ),
            ),
          ),
          React.createElement(
            'div',
            { className: 'gw-actions' },
            React.createElement(
              'button',
              { type: 'submit', className: 'gw-btn gw-btn--primary', disabled: cloning || gitAvailable === false },
              cloning ? '克隆中…' : '克隆',
            ),
            cloning
              ? React.createElement('span', { className: 'gw-hint', role: 'status' }, '正在克隆并添加工作区，仓库较大时请稍候…')
              : null,
          ),
        ),
        added === null
          ? null
          : React.createElement(
            'div',
            { className: 'gw-status gw-status--ok', role: 'status' },
            React.createElement('div', { className: 'gw-statusTitle' }, `已添加工作区「${added.title}」`),
            React.createElement('div', { className: 'gw-statusPath' }, added.path),
          ),
        failure === null
          ? null
          : React.createElement(
            'div',
            { className: 'gw-status gw-status--error', role: 'alert' },
            React.createElement('div', { className: 'gw-statusTitle' }, failure.message),
            failure.detail === undefined || failure.detail === ''
              ? null
              : React.createElement('pre', { className: 'gw-detail' }, failure.detail),
          ),
      ),
    )
  }
}

/** Component-local stylesheet; every color is a Harness theme token. */
const CSS = `
.gw-page { box-sizing: border-box; padding: 2px 0 28px; color: var(--dsw-alias-label-primary); font-size: 13px; line-height: 1.55; font-family: inherit; }
.gw-page * { box-sizing: border-box; }
.gw-inner { display: flex; flex-direction: column; gap: 14px; max-width: 560px; }
.gw-head { display: flex; flex-direction: column; gap: 4px; }
.gw-title { margin: 0; font-size: 15px; font-weight: 600; line-height: 1.4; }
.gw-desc { margin: 0; color: var(--dsw-alias-label-secondary); font-size: 12.5px; }
.gw-form { display: flex; flex-direction: column; }
.gw-field { display: flex; flex-direction: column; gap: 6px; padding: 12px 0; }
.gw-field + .gw-field { border-top: 0.5px solid var(--dsw-alias-border-l1); }
.gw-label { font-size: 13px; font-weight: 500; }
.gw-input { width: 100%; min-width: 0; height: 34px; padding: 0 12px; border: 0.5px solid var(--dsw-alias-border-l1); border-radius: 8px; background: var(--dsw-alias-bg-layer-1); color: var(--dsw-alias-label-primary); font: inherit; font-size: 13px; line-height: 1.5; }
.gw-input::placeholder { color: var(--dsw-alias-label-secondary); opacity: 0.7; }
.gw-input:focus-visible { outline: none; border-color: var(--dsw-alias-brand-primary); }
.gw-input:disabled { opacity: 0.6; cursor: default; }
.gw-dirRow { display: flex; align-items: center; gap: 8px; }
.gw-btn { flex: none; height: 34px; padding: 0 14px; border: 0.5px solid var(--dsw-alias-border-l1); border-radius: 8px; background: var(--dsw-alias-bg-layer-1); color: var(--dsw-alias-label-primary); font: inherit; font-size: 13px; cursor: pointer; white-space: nowrap; }
.gw-btn:hover:not(:disabled) { border-color: var(--dsw-alias-border-l2); background: var(--dsw-alias-bg-layer-2); }
.gw-btn:focus-visible { outline: 2px solid var(--dsw-alias-brand-primary); outline-offset: 1px; }
.gw-btn:disabled { cursor: not-allowed; opacity: 0.45; }
.gw-btn--primary { background: var(--dsw-alias-brand-primary); border-color: var(--dsw-alias-brand-primary); color: #fff; font-weight: 500; }
.gw-btn--primary:hover:not(:disabled) { background: var(--dsw-alias-brand-primary); filter: brightness(1.06); }
.gw-hint { margin: 0; color: var(--dsw-alias-label-secondary); font-size: 12px; }
.gw-switchRow { display: flex; align-items: flex-start; gap: 10px; padding: 14px 0 2px; }
.gw-switch { position: relative; flex: none; width: 36px; height: 20px; margin-top: 1px; padding: 2px; border: 0; border-radius: 999px; background: var(--dsw-alias-border-l2); cursor: pointer; }
.gw-switch[aria-checked='true'] { background: var(--dsw-alias-brand-primary); }
.gw-switch:disabled { cursor: default; opacity: 0.5; }
.gw-switch:focus-visible { outline: 2px solid var(--dsw-alias-brand-primary); outline-offset: 2px; }
.gw-switchThumb { display: block; width: 16px; height: 16px; border-radius: 50%; background: #fff; transition: transform 120ms ease; }
.gw-switch[aria-checked='true'] .gw-switchThumb { transform: translateX(16px); }
.gw-switchText { display: flex; flex-direction: column; gap: 2px; min-width: 0; }
.gw-switchTitle { font-size: 13px; font-weight: 500; }
.gw-actions { display: flex; align-items: center; gap: 10px; padding-top: 14px; }
.gw-status { display: flex; flex-direction: column; gap: 4px; padding: 10px 12px; border: 0.5px solid var(--dsw-alias-border-l1); border-radius: 8px; background: var(--dsw-alias-bg-layer-1); font-size: 12px; }
.gw-statusTitle { font-weight: 500; }
.gw-statusPath { font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; font-size: 11px; color: var(--dsw-alias-label-secondary); overflow-wrap: anywhere; }
.gw-status--ok { border-color: var(--dsw-alias-state-success-primary); }
.gw-status--ok .gw-statusTitle { color: var(--dsw-alias-state-success-primary); }
.gw-status--warn { border-color: var(--dsw-alias-state-warn-primary); }
.gw-status--warn .gw-statusTitle { color: var(--dsw-alias-state-warn-primary); }
.gw-status--error { border-color: var(--dsw-alias-state-error-primary); }
.gw-status--error .gw-statusTitle { color: var(--dsw-alias-state-error-primary); }
.gw-detail { margin: 2px 0 0; max-height: 160px; overflow: auto; white-space: pre-wrap; overflow-wrap: anywhere; font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; font-size: 11px; line-height: 1.5; color: var(--dsw-alias-label-secondary); }
`
