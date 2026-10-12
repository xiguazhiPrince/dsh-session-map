/**
 * The ACP agents settings card: the page that makes the backend configurable
 * without editing a profile patch.
 *
 * The card edits ONE field — the `agents` list of the ACP row — through the
 * settings service's shared configuration form, which persists into the active
 * profile's Cordis patch and fences every write with the namespace revision. It
 * is registered as a `settings.section` page and only while the Host actually
 * serves a namespace of ours, so a composition without the backend shows no
 * trace of the page (and a canvas-only install pays nothing for it).
 *
 * Written with `createElement` and the same local structural service types as
 * the rest of this plugin: this repository does not pin the product's
 * prerelease browser packages, so the client bundle must not import them.
 *
 * @module dsh-session-map/client/acp-card
 */
import { createElement, useCallback, useEffect, useMemo, useState, type ReactElement } from 'react'
import {
  addAgent,
  defaultToolName,
  draftsFromValue,
  moveAgent,
  patchAgent,
  removeAgent,
  selectAcpNamespace,
  validateDrafts,
  valueFromDrafts,
  type AgentDraft,
  type DraftProblem,
  type NamespaceView,
} from './acp-model'

/** One namespace's form, as `ui-settings` provides it. */
export interface ConfigFormLike {
  /** @returns the current sync snapshot. */
  getSnapshot(): {
    readonly status: 'loading' | 'ready' | 'unavailable'
    readonly value: unknown
    readonly writable: boolean
    readonly mode: 'host' | 'memory'
  }
  /**
   * @param listener - invoked after each snapshot change.
   * @returns the disposer removing this listener.
   */
  subscribe(listener: () => void): () => void
  /**
   * Replace one field of the namespace.
   * @param field - the field name.
   * @param value - the whole new value.
   * @returns true when the Host accepted the write.
   */
  set(field: string, value: unknown): Promise<boolean>
}

/** The shared configuration-form service. */
export interface ConfigFormsLike {
  /** @param entryId - the Host plugin entry id. @returns that entry's form. */
  get(entryId: string): ConfigFormLike
  /** @returns the shared describe mirror. */
  describe(): {
    getSnapshot(): { readonly view?: { readonly namespaces: readonly NamespaceView[] } | undefined }
    subscribe(listener: () => void): () => void
  }
}

/** The shipped row id, used when a profile renamed nothing and the schema marker is absent. */
export const KNOWN_ENTRY_ID = 'subagent-acp'

/**
 * Subscribe one component to a snapshot source.
 * @param source - the store.
 * @returns the current snapshot, re-rendering on change.
 */
function useSnapshot<T>(source: { getSnapshot(): T; subscribe(listener: () => void): () => void }): T {
  const [snapshot, setSnapshot] = useState(() => source.getSnapshot())
  useEffect(() => {
    setSnapshot(() => source.getSnapshot())
    return source.subscribe(() => { setSnapshot(() => source.getSnapshot()) })
  }, [source])
  return snapshot
}

/** The card's own state: a draft list that is dirty until written or discarded. */
interface CardState {
  readonly drafts: readonly AgentDraft[]
  readonly problems: readonly DraftProblem[]
  readonly dirty: boolean
  readonly saving: boolean
  readonly failure: string | null
}

/**
 * Build the card component over a fixed configuration-form service.
 * @param forms - the shared configuration-form service.
 * @returns the settings-section component.
 */
export function createAcpAgentsCard(forms: ConfigFormsLike): () => ReactElement {
  return function AcpAgentsCard(): ReactElement {
    const describe = useMemo(() => forms.describe(), [])
    const mirror = useSnapshot(describe)
    const namespace = selectAcpNamespace(mirror.view?.namespaces ?? [], KNOWN_ENTRY_ID)
    const form = useMemo(() => (namespace === undefined ? undefined : forms.get(namespace)), [namespace])
    const snapshot = useSnapshot(form ?? EMPTY_FORM)
    const [state, setState] = useState<CardState>(() => ({
      drafts: [], problems: [], dirty: false, saving: false, failure: null,
    }))

    // Adopt the Host's value whenever the card is not holding unsaved edits, so
    // a write from anywhere else (another window, a patch reload) shows up here.
    const served = snapshot.value
    useEffect(() => {
      if (form === undefined || state.dirty) return
      const { drafts } = draftsFromValue(served)
      setState(current => (current.dirty
        ? current
        : { ...current, drafts, problems: validateDrafts(drafts) }))
    }, [form, served, state.dirty])

    const edit = useCallback((next: readonly AgentDraft[]) => {
      setState(current => ({ ...current, drafts: next, problems: validateDrafts(next), dirty: true, failure: null }))
    }, [])

    const save = useCallback(async () => {
      if (form === undefined) return
      const written = valueFromDrafts(state.drafts)
      if (!written.ok) {
        setState(current => ({ ...current, problems: written.problems }))
        return
      }
      setState(current => ({ ...current, saving: true, failure: null }))
      try {
        const accepted = await form.set('agents', written.value)
        setState(current => (accepted
          ? { ...current, drafts: current.drafts, problems: [], dirty: false, saving: false, failure: null }
          : { ...current, saving: false, failure: 'Host 拒绝了这次写入（按上面的提示改完再保存）' }))
      } catch (error: unknown) {
        setState(current => ({
          ...current,
          saving: false,
          failure: `写入失败：${error instanceof Error ? error.message : String(error)}`,
        }))
      }
    }, [form, state.drafts])

    const discard = useCallback(() => {
      const { drafts } = draftsFromValue(served)
      setState(current => ({ ...current, drafts, problems: validateDrafts(drafts), dirty: false, failure: null }))
    }, [served])

    const unavailable = namespace === undefined || snapshot.status === 'unavailable'
    const readOnly = snapshot.writable !== true || snapshot.mode === 'memory'

    return createElement(
      'section',
      { className: 'dsh-acp-card' },
      createElement('h2', { className: 'dsh-acp-title' }, 'ACP 子代理'),
      createElement(
        'p',
        { className: 'dsh-acp-note' },
        '这里配置的 agent 会注册成子代理，并自动配上一个委派工具。保存后立即生效，不用重启，也不用改配置文件。',
      ),
      unavailable
        ? createElement('p', { className: 'dsh-acp-empty' }, '当前 Host 没有加载 ACP 组件（那一行没打开，或者被禁用了）。')
        : null,
      readOnly && !unavailable
        ? createElement('p', { className: 'dsh-acp-empty' }, '当前 Host 不接受写入（只有本机页面可以写），这里只能查看。')
        : null,

      unavailable ? null : createElement(
        'ul',
        { className: 'dsh-acp-list' },
        ...state.drafts.map((draft, index) => renderAgent(draft, index, state, edit, readOnly)),
      ),
      unavailable ? null : createElement(
        'div',
        { className: 'dsh-acp-actions' },
        createElement(
          'button',
          { type: 'button', className: 'dsh-acp-button', disabled: readOnly, onClick: () => edit(addAgent(state.drafts)) },
          '添加 agent',
        ),
        createElement(
          'button',
          {
            type: 'button',
            className: 'dsh-acp-button dsh-acp-primary',
            disabled: readOnly || !state.dirty || state.saving || state.problems.length > 0,
            onClick: () => { void save() },
          },
          state.saving ? '保存中…' : '保存',
        ),
        createElement(
          'button',
          { type: 'button', className: 'dsh-acp-button', disabled: readOnly || !state.dirty || state.saving, onClick: discard },
          '放弃修改',
        ),
        state.dirty && state.problems.length === 0
          ? createElement('span', { className: 'dsh-acp-dirty' }, '有未保存的修改')
          : null,
      ),

      state.failure === null ? null : createElement('p', { className: 'dsh-acp-error' }, state.failure),
      unavailable || state.drafts.length > 0
        ? null
        : createElement('p', { className: 'dsh-acp-empty' }, '还没有 agent。点「添加 agent」，填上 CLI 名字就行。'),
    )
  }
}

/** A form-shaped placeholder so the hook order never depends on discovery. */
const EMPTY_FORM: ConfigFormLike = {
  getSnapshot: () => ({ status: 'loading', value: undefined, writable: false, mode: 'host' }),
  subscribe: () => () => {},
  set: async () => false,
}

/**
 * Render one agent row.
 * @param draft - the agent's draft.
 * @param index - its position.
 * @param state - the card state, for problems.
 * @param edit - applies a whole new draft list.
 * @param readOnly - whether writes are available.
 * @returns the row element.
 */
function renderAgent(
  draft: AgentDraft,
  index: number,
  state: CardState,
  edit: (next: readonly AgentDraft[]) => void,
  readOnly: boolean,
): ReactElement {
  const problems = state.problems.filter(problem => problem.index === index)
  const toolName = draft.toolName.trim() === '' ? defaultToolName(draft.name) : draft.toolName
  const field = (key: keyof AgentDraft, label: string, placeholder: string): ReactElement => createElement(
    'label',
    { className: 'dsh-acp-field' },
    createElement('span', { className: 'dsh-acp-label' }, label),
    createElement('input', {
      type: 'text',
      className: 'dsh-acp-input',
      value: String(draft[key]),
      placeholder,
      disabled: readOnly,
      onChange: (event: { target: { value: string } }) => edit(patchAgent(state.drafts, index, { [key]: event.target.value })),
    }),
  )
  return createElement(
    'li',
    {
      className: draft.enabled ? 'dsh-acp-agent' : 'dsh-acp-agent dsh-acp-agent-off',
      key: `${index}-${draft.name}`,
    },
    createElement(
      'div',
      { className: 'dsh-acp-agent-head' },
      createElement('span', { className: 'dsh-acp-name' }, draft.name.trim() === '' ? `agent ${index + 1}` : draft.name),
      createElement('span', { className: draft.enabled ? 'dsh-acp-chip dsh-acp-chip-on' : 'dsh-acp-chip dsh-acp-chip-off' },
        draft.enabled ? '已启用' : '已停用'),
      createElement('span', { className: 'dsh-acp-chip' }, `工具 ${toolName}`),
      createElement('span', { className: 'dsh-acp-spacer' }),
      createElement('button', {
        type: 'button', className: 'dsh-acp-button', disabled: readOnly || index === 0,
        onClick: () => edit(moveAgent(state.drafts, index, -1)),
      }, '上移'),
      createElement('button', {
        type: 'button', className: 'dsh-acp-button', disabled: readOnly || index === state.drafts.length - 1,
        onClick: () => edit(moveAgent(state.drafts, index, 1)),
      }, '下移'),
      createElement('button', {
        type: 'button', className: 'dsh-acp-button dsh-acp-danger', disabled: readOnly,
        onClick: () => edit(removeAgent(state.drafts, index)),
      }, '删除'),
    ),
    createElement(
      'div',
      { className: 'dsh-acp-grid' },
      field('name', '名称', 'cursor'),
      field('command', '命令', 'cursor-agent 或 C:\\path\\to\\agent.exe'),
      field('args', '参数', 'acp'),
      field('mode', '模式（可留空）', 'agent / plan / ask'),
    ),
    createElement(
      'div',
      { className: 'dsh-acp-grid' },
      createElement(
        'label',
        { className: 'dsh-acp-field' },
        createElement('span', { className: 'dsh-acp-label' }, '权限'),
        createElement(
          'select',
          {
            className: 'dsh-acp-input',
            value: draft.permission,
            disabled: readOnly,
            onChange: (event: { target: { value: string } }) => edit(patchAgent(state.drafts, index, {
              permission: event.target.value === 'reject' ? 'reject' : 'allow',
            })),
          },
          createElement('option', { value: 'allow' }, 'allow —— 自动批准 agent 的权限请求'),
          createElement('option', { value: 'reject' }, 'reject —— 一律拒绝（配合只读模式）'),
        ),
      ),
      field('toolName', '工具名（可留空）', 'subagent_cursor'),
      field('cwd', '工作目录（可留空）', '默认用委派会话的目录'),
      createElement(
        'label',
        { className: 'dsh-acp-field dsh-acp-check' },
        createElement('input', {
          type: 'checkbox',
          checked: draft.enabled,
          disabled: readOnly,
          onChange: (event: { target: { checked: boolean } }) => edit(patchAgent(state.drafts, index, { enabled: event.target.checked })),
        }),
        createElement('span', { className: 'dsh-acp-label' }, '启用这个 agent'),
      ),
    ),
    createElement(
      'details',
      { className: 'dsh-acp-more' },
      createElement('summary', null, '环境变量与会话选项'),
      createElement(
        'div',
        { className: 'dsh-acp-grid' },
        textarea('env', '环境变量（每行 KEY=VALUE）', draft, index, state.drafts, edit, readOnly),
        textarea('configOptions', '会话选项（每行 KEY=VALUE，例如 model=…）', draft, index, state.drafts, edit, readOnly),
      ),
    ),
    problems.length === 0
      ? null
      : createElement(
        'ul',
        { className: 'dsh-acp-problems' },
        ...problems.map(problem => createElement('li', { key: problem.message }, problem.message)),
      ),
  )
}

/**
 * Render one `KEY=VALUE` textarea.
 * @param key - the draft field it edits.
 * @param label - its label.
 * @param draft - the agent's draft.
 * @param index - its position.
 * @param drafts - the whole draft list the edit replaces.
 * @param edit - applies a whole new draft list.
 * @param readOnly - whether writes are available.
 * @returns the field element.
 */
function textarea(
  key: 'env' | 'configOptions',
  label: string,
  draft: AgentDraft,
  index: number,
  drafts: readonly AgentDraft[],
  edit: (next: readonly AgentDraft[]) => void,
  readOnly: boolean,
): ReactElement {
  return createElement(
    'label',
    { className: 'dsh-acp-field dsh-acp-wide' },
    createElement('span', { className: 'dsh-acp-label' }, label),
    createElement('textarea', {
      className: 'dsh-acp-input',
      rows: 3,
      value: draft[key],
      disabled: readOnly,
      onChange: (event: { target: { value: string } }) => edit(patchAgent(drafts, index, { [key]: event.target.value })),
    }),
  )
}
