/**
 * The ACP 供应商 settings page: the page that makes the ACP route configurable
 * without editing a profile patch.
 *
 * The page edits ONE field — the `agents` list of the `acp-agent` row — through
 * the settings domain's shared configuration form, which persists into the
 * active profile's Cordis patch and fences every write with the namespace
 * revision. It registers as a `settings.section` page, because the settings
 * shell is where a person looks for it; the entry is chosen by schema shape
 * rather than by row id (see `selectAcpNamespace`).
 *
 * It is written with `createElement` and this plugin's own classes: the product's
 * browser packages are prerelease, so this repository pins none of them and
 * imports none of them. The page therefore closes over the service handles that
 * `apply` looked up, instead of receiving injected props.
 *
 * @module dsh-session-map/client/acp-card
 */
import { createElement, useCallback, useEffect, useMemo, useState, type ReactElement } from 'react'
import {
  ACP_VENDORS,
  KNOWN_ENTRY_ID,
  addAgent,
  draftsFromValue,
  moveAgent,
  patchAgent,
  removeAgent,
  selectAcpNamespace,
  validateDrafts,
  valueFromDrafts,
  vendorAgent,
  type AgentDraft,
  type DraftProblem,
  type NamespaceView,
} from './acp-model'
import { useSnapshot } from './snapshot'

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
   * Replace one field of the namespace with a whole new value.
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
  /**
   * The shared code-tools preference, which is the single gate over preset
   * selection in this product.
   *
   * Optional because it is the providing service's own field rather than part of
   * the form contract: a composition whose settings provider predates the switch
   * has none, and the composer notice reads that absence as "presets are
   * available" rather than inventing a blocker the person cannot find.
   */
  readonly developerTools?: {
    readonly enabled: {
      /** @returns whether code tools — and therefore preset selection — are on. */
      getSnapshot(): boolean
      /**
       * @param listener - invoked after each change.
       * @returns the disposer removing this listener.
       */
      subscribe(listener: () => void): () => void
    }
  }
}

/** A form-shaped placeholder so the hook order never depends on discovery. */
const EMPTY_FORM: ConfigFormLike = {
  getSnapshot: () => ({ status: 'loading', value: undefined, writable: false, mode: 'host' }),
  subscribe: () => () => {},
  set: async () => false,
}

/** The page's own state: a draft list that is dirty until written or discarded. */
interface CardState {
  readonly drafts: readonly AgentDraft[]
  readonly problems: readonly DraftProblem[]
  readonly dirty: boolean
  readonly saving: boolean
  readonly failure: string | null
}

/**
 * Build the page component over a fixed configuration-form service.
 * @param forms - the shared configuration-form service.
 * @returns the settings-section component.
 */
export function createAcpCard(forms: ConfigFormsLike): () => ReactElement {
  return function AcpVendorsCard(): ReactElement {
    const describe = useMemo(() => forms.describe(), [forms])
    const mirror = useSnapshot(describe)
    const namespace = selectAcpNamespace(mirror.view?.namespaces ?? [], KNOWN_ENTRY_ID)
    const form = useMemo(() => (namespace === undefined ? undefined : forms.get(namespace)), [forms, namespace])
    const snapshot = useSnapshot(form ?? EMPTY_FORM)
    const [state, setState] = useState<CardState>(() => ({
      drafts: [], problems: [], dirty: false, saving: false, failure: null,
    }))

    // Adopt the Host's value whenever the page is not holding unsaved edits, so a
    // write from anywhere else (another window, a patch reload) shows up here.
    const served = snapshot.value
    useEffect(() => {
      if (form === undefined) return
      setState(current => {
        if (current.dirty) return current
        const { drafts } = draftsFromValue(served)
        return { ...current, drafts, problems: validateDrafts(drafts) }
      })
    }, [form, served])

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
          ? { ...current, problems: [], dirty: false, saving: false, failure: null }
          : { ...current, saving: false, failure: 'Host 拒绝了这次写入（按卡片上的提示改完再保存）' }))
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

    // Before the describe mirror's first answer there is no namespace list to
    // judge, and "not loaded" would be a lie for that window.
    const loading = mirror.view === undefined
    const unavailable = !loading && (namespace === undefined || snapshot.status === 'unavailable')
    const readOnly = snapshot.writable !== true || snapshot.mode === 'memory'
    const servedPage = !loading && !unavailable
    // Nothing drafted and nothing stored: this page's one chance to state the
    // order of operations (configure an agent → its card appears), which is the
    // reading most people arrive with backwards.
    const emptyAgents = servedPage && state.drafts.length === 0

    return createElement(
      'section',
      { className: 'dsm-acp-page' },
      createElement('h2', { className: 'dsm-acp-page__title' }, 'ACP 供应商'),
      createElement(
        'p',
        { className: 'dsm-acp-page__note' },
        '这里配置的 agent 会成为 acp 路由上的一个模型，并在新会话的模式菜单里出现一张卡。顺序上容易误会：组件本身默认已经启用，但列表为空时它什么都不注册——所以「ACP 组件已启用」不等于「菜单里有 ACP」。保存后立即生效，不用重启，也不用改配置文件。',
      ),
      createElement(
        'p',
        { className: 'dsm-acp-page__warn' },
        'permission: allow 意味着远端 agent 的工具无人干预地跑，它能在会话工作目录里写文件。要收紧就把这一项换成 reject，或在 profile 里把 approval 设成 ask（approval / fs / 回收时间这些行级字段仍只在 cordis.patch.yml 里）。',
      ),
      createElement(
        'p',
        { className: 'dsm-acp-page__note' },
        '各家文档：',
        ...ACP_VENDORS.map((vendor, index) => createElement(
          'span',
          { key: vendor.id },
          index === 0 ? null : ' · ',
          createElement('a', {
            className: 'dsm-acp-page__link',
            href: vendor.docs,
            target: '_blank',
            rel: 'noreferrer',
          }, vendor.label),
        )),
      ),
      loading
        ? createElement('p', { className: 'dsm-acp-page__empty' }, '读取中…')
        : null,
      unavailable
        ? createElement(
          'p',
          { className: 'dsm-acp-page__empty' },
          '当前 Host 没有加载 ACP 组件（acp-agent 那一行没打开，或者被禁用了）。在 profile 的 cordis.patch.yml 里把这一行的 disabled 去掉（或改成 false），重载后回到这个页面。',
        )
        : null,
      servedPage && readOnly
        ? createElement('p', { className: 'dsm-acp-page__empty' }, '当前 Host 不接受写入（只有本机页面可以写），这里只能查看。')
        : null,

      servedPage ? createElement(
        'div',
        { className: 'dsm-acp-page__presets' },
        createElement('span', { className: 'dsm-acp-page__presetLabel' }, '添加：'),
        ...ACP_VENDORS.map(vendor => createElement(
          'button',
          {
            key: vendor.id,
            type: 'button',
            className: 'dsm-acp-page__button',
            title: vendor.note === undefined ? vendor.docs : `${vendor.note}（${vendor.docs}）`,
            disabled: readOnly,
            onClick: () => { edit([...state.drafts, vendorAgent(vendor, state.drafts)]) },
          },
          `+ ${vendor.label}`,
        )),
        createElement(
          'button',
          {
            type: 'button',
            className: 'dsm-acp-page__button',
            disabled: readOnly,
            onClick: () => { edit(addAgent(state.drafts)) },
          },
          '+ 自定义',
        ),
      ) : null,

      servedPage ? createElement(
        'ul',
        { className: 'dsm-acp-page__list' },
        ...state.drafts.map((draft, index) => renderAgent(draft, index, state, edit, readOnly)),
      ) : null,

      servedPage ? createElement(
        'div',
        { className: 'dsm-acp-page__actions' },
        createElement(
          'button',
          {
            type: 'button',
            className: 'dsm-acp-page__button dsm-acp-page__button--primary',
            disabled: readOnly || !state.dirty || state.saving || state.problems.length > 0,
            onClick: () => { void save() },
          },
          state.saving ? '保存中…' : '保存',
        ),
        createElement(
          'button',
          {
            type: 'button',
            className: 'dsm-acp-page__button',
            disabled: readOnly || !state.dirty || state.saving,
            onClick: discard,
          },
          '放弃修改',
        ),
        state.dirty && state.problems.length === 0
          ? createElement('span', { className: 'dsm-acp-page__dirty' }, '有未保存的修改')
          : null,
      ) : null,

      state.failure === null ? null : createElement('p', { className: 'dsm-acp-page__error' }, state.failure),
      emptyAgents
        ? createElement('p', { className: 'dsm-acp-page__empty' }, '还没有 agent。点上面的「+ Cursor CLI」或「+ 自定义」，填上 CLI 名字再保存。')
        : null,
      emptyAgents
        ? createElement('p', { className: 'dsm-acp-page__note' }, '保存后不用重启、也不用刷新：回到新会话页，模式菜单里就会出现「ACP · 名称」。第一次真的用它时会现场启动这个 CLI 完成握手（本机 cursor-agent 约 7–8 秒）。')
        : null,
    )
  }
}

/**
 * Render one agent card.
 * @param draft - the agent's draft.
 * @param index - its position.
 * @param state - the page state, for problems.
 * @param edit - applies a whole new draft list.
 * @param readOnly - whether writes are available.
 * @returns the card element.
 */
function renderAgent(
  draft: AgentDraft,
  index: number,
  state: CardState,
  edit: (next: readonly AgentDraft[]) => void,
  readOnly: boolean,
): ReactElement {
  const problems = state.problems.filter(problem => problem.index === index)
  const field = (key: keyof AgentDraft, label: string, placeholder: string): ReactElement => createElement(
    'label',
    { className: 'dsm-acp-page__field' },
    createElement('span', { className: 'dsm-acp-page__label' }, label),
    createElement('input', {
      type: 'text',
      className: 'dsm-acp-page__input',
      value: String(draft[key]),
      placeholder,
      disabled: readOnly,
      onChange: (event: { target: { value: string } }) => {
        edit(patchAgent(state.drafts, index, { [key]: event.target.value }))
      },
    }),
  )
  return createElement(
    'li',
    {
      className: draft.enabled ? 'dsm-acp-page__agent' : 'dsm-acp-page__agent dsm-acp-page__agent--off',
      key: `${String(index)}-${draft.name}`,
    },
    createElement(
      'div',
      { className: 'dsm-acp-page__agentHead' },
      createElement('span', { className: 'dsm-acp-page__name' }, draft.name.trim() === '' ? `agent ${String(index + 1)}` : draft.name),
      createElement('span', { className: 'dsm-acp-page__chip dsm-acp-page__chip--on' },
        draft.enabled ? '已启用' : '已停用'),
      createElement('span', { className: 'dsm-acp-page__chip' },
        draft.permission === 'reject' ? '一律拒绝权限' : '自动批准权限'),
      createElement('span', { className: 'dsm-acp-page__spacer' }),
      createElement('button', {
        type: 'button', className: 'dsm-acp-page__button', disabled: readOnly || index === 0,
        onClick: () => { edit(moveAgent(state.drafts, index, -1)) },
      }, '上移'),
      createElement('button', {
        type: 'button', className: 'dsm-acp-page__button', disabled: readOnly || index === state.drafts.length - 1,
        onClick: () => { edit(moveAgent(state.drafts, index, 1)) },
      }, '下移'),
      createElement('button', {
        type: 'button', className: 'dsm-acp-page__button dsm-acp-page__button--danger', disabled: readOnly,
        onClick: () => { edit(removeAgent(state.drafts, index)) },
      }, '删除'),
    ),
    createElement(
      'div',
      { className: 'dsm-acp-page__grid' },
      field('name', '名称', 'cursor'),
      field('command', '命令', 'cursor-agent 或 C:\\path\\to\\agent.exe'),
      field('args', '参数', 'acp'),
      field('mode', '模式（可留空）', 'agent / plan / ask'),
    ),
    createElement(
      'div',
      { className: 'dsm-acp-page__grid' },
      createElement(
        'label',
        { className: 'dsm-acp-page__field' },
        createElement('span', { className: 'dsm-acp-page__label' }, '权限'),
        createElement(
          'select',
          {
            className: 'dsm-acp-page__input',
            value: draft.permission,
            disabled: readOnly,
            onChange: (event: { target: { value: string } }) => {
              edit(patchAgent(state.drafts, index, {
                permission: event.target.value === 'reject' ? 'reject' : 'allow',
              }))
            },
          },
          createElement('option', { value: 'allow' }, 'allow —— 自动批准 agent 的权限请求'),
          createElement('option', { value: 'reject' }, 'reject —— 一律拒绝（配合只读模式）'),
        ),
      ),
      field('cwd', '工作目录（可留空）', '默认用会话自己的工作目录'),
      createElement(
        'label',
        { className: 'dsm-acp-page__field dsm-acp-page__check' },
        createElement('input', {
          type: 'checkbox',
          checked: draft.enabled,
          disabled: readOnly,
          onChange: (event: { target: { checked: boolean } }) => {
            edit(patchAgent(state.drafts, index, { enabled: event.target.checked }))
          },
        }),
        createElement('span', { className: 'dsm-acp-page__label' }, '启用这个 agent'),
      ),
    ),
    createElement(
      'details',
      { className: 'dsm-acp-page__more' },
      createElement('summary', null, '环境变量与会话选项'),
      createElement(
        'div',
        { className: 'dsm-acp-page__grid' },
        textarea('env', '环境变量（每行 KEY=VALUE）', draft, index, state.drafts, edit, readOnly),
        textarea('configOptions', '会话选项（每行 KEY=VALUE，例如 model=…）', draft, index, state.drafts, edit, readOnly),
      ),
    ),
    problems.length === 0
      ? null
      : createElement(
        'ul',
        { className: 'dsm-acp-page__problems' },
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
    { className: 'dsm-acp-page__field dsm-acp-page__wide' },
    createElement('span', { className: 'dsm-acp-page__label' }, label),
    createElement('textarea', {
      className: 'dsm-acp-page__input',
      rows: 3,
      value: draft[key],
      disabled: readOnly,
      onChange: (event: { target: { value: string } }) => {
        edit(patchAgent(drafts, index, { [key]: event.target.value }))
      },
    }),
  )
}
