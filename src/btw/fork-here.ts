/**
 * "btw · 从这里分叉"：把正在运行的会话按**当前精确进度**分叉成一个只读会话，并把
 * 界面切过去。
 *
 * 为什么切在精确事件点而不是"最后一个完整回合"：`sessions.fork({ atSeq })` 的 Host
 * 端会把切点所在的未完成回合用合成事件收尾（`session/end-seed` → 未完成工具调用的
 * 合成 `tool/result` → `step/end` → `turn/end{kind:'forked'}`），所以新会话拿到的
 * 是"主任务执行到一半"的全部已落盘上下文，而且主会话完全不受影响。
 *
 * 只读不靠提示词求模型自觉：分叉完成后立刻用产品自己那条命令通道
 * （`/permission <preset>`，Web 的权限选择器发的也是这一条）把新会话的 sandbox
 * 切到 `read-only`，然后再导航过去。这样新会话的第一回合就活在只读沙箱里，
 * 写文件会被 sandbox 直接拒绝。
 *
 * @module dsh-session-map/btw/fork-here
 */

/** 事件窗口里的一格：只需要区分是否已落盘，以及它的 seq。 */
export interface BtwEventEntry {
  readonly type: 'event' | 'transient'
  readonly event: { readonly type: string; readonly seq: number }
}

/** Client Session 事件窗口，只取本流程需要的两个字段。 */
export interface BtwEventWindow {
  readonly entries: readonly BtwEventEntry[]
}

/** Remote 失败体的窄视图：code 是判别依据，message 只是给人看的。 */
export interface BtwRemoteFailure {
  readonly code?: string | undefined
  readonly message?: string | undefined
}

/** 本流程用到的唯一 Remote 结果形状（command 回执）。 */
export interface BtwRemoteResult<T> {
  readonly ok: boolean
  readonly value?: T | undefined
  readonly error?: BtwRemoteFailure | undefined
}

/** Session 的命令通道与标题写入（`command('/permission read-only')`、`rename(title)`）。 */
export interface BtwSessionFace {
  command(line: string): Promise<BtwRemoteResult<{ readonly matched: boolean }>>
  rename?(title: string): Promise<BtwRemoteResult<{ readonly title: string; readonly seq: number }>>
}

/** 一个已保留 Session 的绑定：命令通道 + 可订阅的事件窗口。 */
export interface BtwSessionBinding {
  readonly session: BtwSessionFace
  readonly eventSource: { getSnapshot(): BtwEventWindow }
}

/** 一次 Session 保留（引用计数 + 首次历史打开）。 */
export interface BtwSessionReference {
  readonly sessionId: string
  readonly ready: Promise<BtwSessionBinding>
  release(): void
}

/** Client `ctx.sessions` 里本流程用到的两个方法。 */
export interface BtwSessionsFace {
  /**
   * 保留一个 Session 并开始它的历史打开。
   * @param target - Session id。
   * @param options - 保留来源（引用计数按来源分类）。
   */
  retain(target: string, options: { readonly source: string }): BtwSessionReference
  /**
   * 从源 Session 的精确前缀分叉出一个新 Session。
   * @param options - 源、切点（省略即最后一个完整回合），及标题后缀开关。
   * @returns 新 Session id。
   */
  fork(options: {
    readonly sessionId: string
    readonly atSeq?: number
    readonly increaseTitle?: boolean
  }): Promise<string>
  /**
   * 客户端会话列表快照；只用来读源会话的标题（Host 自己生成分叉标题时也读这里）。
   * 省略时标题后缀退化为只有 `BTW`。
   */
  readonly list?: {
    getSnapshot(): {
      readonly byId: Readonly<Record<string, { readonly title?: string | undefined } | undefined>>
    }
  }
}

/** 本流程依赖的两个外部动作，测试里可以整体替换。 */
export interface ForkHereDependencies {
  /** Client Session 服务。 */
  readonly sessions: BtwSessionsFace
  /** 把主视图切到目标 Session。 */
  readonly openSession: (sessionId: string) => void
  /**
   * 放弃一个已经建好、但没能切成只读的会话（例如归档掉）。
   * 省略时只报告失败，不清理。
   */
  readonly discard?: (sessionId: string) => Promise<void> | void
  /**
   * 记住这个子会话是 btw 分叉（驱动侧栏行标记）。只读切换成功后才调用。
   */
  readonly mark?: (sessionId: string) => void
  /**
   * 分叉成功后报告精确的父子关系（插件账本用）。只读切换成败与此无关，
   * 所以紧接着 fork 调用；省略时只依赖通用的 `sessions.fork` 观测层。
   */
  readonly onForked?: (childId: string, parentId: string, atSeq: number | undefined) => void
  /** 只读预设名；省略时用 Host 默认的 `read-only`。 */
  readonly readOnlyPreset?: string
}

/** 一次"从这里分叉"的结果。 */
export type ForkHereResult =
  | {
    readonly ok: true
    /** 分叉出来的新 Session。 */
    readonly childId: string
    /** 实际使用的切点；`undefined` 表示退化为 Host 的"最后一个完整回合"。 */
    readonly atSeq: number | undefined
    /** 只读预设是否切换成功。 */
    readonly readOnly: boolean
  }
  | {
    readonly ok: false
    /** 给用户看的失败原因。 */
    readonly message: string
  }

/**
 * 保留来源。用 Host 声明过的 `gateway` 来源：前台判定只看 `mainView` 计数，
 * 不会把这里的临时保留误认成主视图。
 */
const RETAIN_SOURCE = 'gateway'

/** Host 的 `permission` 行在 base 层默认定义的只读预设名。 */
export const DEFAULT_READ_ONLY_PRESET = 'read-only'

/** 会话标题上的 btw 后缀；Web 权限选择器那种"先原名、后标记"的读法。 */
export const BTW_TITLE_SUFFIX = ' · BTW'

/** 源会话没有标题时使用的名字。 */
const BTW_TITLE_FALLBACK = 'BTW'

/**
 * 给分叉出来的会话起名：源标题加一个可识别的后缀。
 *
 * 已经是 btw 会话再分叉时不叠后缀——否则链一长就会出现 `标题 · BTW · BTW`。
 * @param sourceTitle - 源会话当前标题，可为空。
 * @returns 新标题。
 */
export function composeBtwTitle(sourceTitle: string | undefined): string {
  const base = (sourceTitle ?? '').trim()
  if (base === '') return BTW_TITLE_FALLBACK
  if (base.endsWith(BTW_TITLE_SUFFIX)) return base
  return `${base}${BTW_TITLE_SUFFIX}`
}

/**
 * 读源会话在客户端列表里的标题。
 * @param sessions - Client Session 服务。
 * @param sessionId - 源会话。
 * @returns 标题，或 `undefined`（列表里还没有这一行时）。
 */
function readSourceTitle(sessions: BtwSessionsFace, sessionId: string): string | undefined {
  try {
    const title = sessions.list?.getSnapshot().byId[sessionId]?.title
    return typeof title === 'string' ? title : undefined
  } catch {
    return undefined
  }
}

/**
 * 读取事件窗口里最后一条**已落盘**事件的 seq。
 *
 * 分叉边界必须是真实事件 seq，正在流的 `transient` 事件还不算；窗口为空时
 * 返回 `undefined`，让调用方退化成 Host 的完成回合语义。
 * @param window - Session 事件窗口。
 * @returns 最大的 durable seq，或 `undefined`。
 */
export function lastDurableSeq(window: BtwEventWindow): number | undefined {
  let last: number | undefined
  for (const entry of window.entries) {
    if (entry.type !== 'event') continue
    const seq = entry.event.seq
    if (typeof seq !== 'number' || !Number.isFinite(seq)) continue
    if (last === undefined || seq > last) last = seq
  }
  return last
}

/**
 * 把任意抛出物整理成一句给人看的原因。
 * @param error - 捕获到的错误。
 * @returns 失败原因文本。
 */
export function describeFailure(error: unknown): string {
  if (error instanceof Error && error.message !== '') return error.message
  const record = typeof error === 'object' && error !== null
    ? error as { readonly message?: unknown; readonly code?: unknown }
    : undefined
  if (typeof record?.message === 'string' && record.message !== '') return record.message
  if (typeof record?.code === 'string' && record.code !== '') return record.code
  return String(error)
}

/**
 * 读取源 Session 当前进度对应的分叉切点。
 * @param sessions - Client Session 服务。
 * @param sessionId - 源 Session。
 * @returns 最后一个已落盘事件的 seq，或 `undefined`。
 */
async function latestBoundary(sessions: BtwSessionsFace, sessionId: string): Promise<number | undefined> {
  const reference = sessions.retain(sessionId, { source: RETAIN_SOURCE })
  try {
    const binding = await reference.ready
    return lastDurableSeq(binding.eventSource.getSnapshot())
  } finally {
    reference.release()
  }
}

/** 保留重试的间隔（毫秒）。 */
const RETAIN_RETRY_DELAY_MS = 60

/** 保留重试的次数。 */
const RETAIN_ATTEMPTS = 8

/**
 * 等一会儿。
 * @param milliseconds - 等待时长。
 */
function sleep(milliseconds: number): Promise<void> {
  return new Promise(resolve => { setTimeout(resolve, milliseconds) })
}

/**
 * 保留一个刚刚分叉出来的 Session。
 *
 * `sessions.retain` 对"客户端列表里还没认领的 id"会同步抛 `unknown session`：
 * 分叉的 Host 回执先到，列表行随后才 reconcile。这里做几次短重试把这个正常
 * 竞态吃掉，而不是把它当成失败。
 * @param sessions - Client Session 服务。
 * @param sessionId - 要保留的 Session。
 * @returns 已保留的引用。
 */
async function retainWithRetry(sessions: BtwSessionsFace, sessionId: string): Promise<BtwSessionReference> {
  let lastError: unknown
  for (let attempt = 0; attempt < RETAIN_ATTEMPTS; attempt += 1) {
    try {
      return sessions.retain(sessionId, { source: RETAIN_SOURCE })
    } catch (error) {
      lastError = error
      if (attempt + 1 < RETAIN_ATTEMPTS) await sleep(RETAIN_RETRY_DELAY_MS)
    }
  }
  throw lastError instanceof Error ? lastError : new Error(String(lastError))
}

/**
 * 给新分叉的 Session 命名并切成只读。
 *
 * 两件事都走这个会话自己的写路径：标题走 `rename`（Host 会记成 `user` 来源的
 * 标题，之后自动标题不会再覆盖它），权限走 `/permission` 命令——与 Web 权限
 * 选择器同一条命令。标题失败只是少一个后缀，不算失败；只读失败才算失败。
 * @param sessions - Client Session 服务。
 * @param childId - 新分叉的 Session。
 * @param title - 要写入的标题。
 * @param preset - 只读预设名。
 * @returns 只读是否切换成功。
 */
async function prepareChild(
  sessions: BtwSessionsFace,
  childId: string,
  title: string,
  preset: string,
): Promise<boolean> {
  let reference: BtwSessionReference | undefined
  try {
    reference = await retainWithRetry(sessions, childId)
    const binding = await reference.ready
    try {
      await binding.session.rename?.(title)
    } catch {
      // 标题只是可读性加成；写不进去不影响只读这条硬要求。
    }
    const result = await binding.session.command(`/permission ${preset}`)
    return result.ok && result.value?.matched === true
  } catch {
    return false
  } finally {
    reference?.release()
  }
}

/**
 * 从会话的当前进度分叉出一个只读会话，并把它显示出来。
 *
 * 顺序是刻意的：先取切点、再分叉、再切只读、最后才导航——保证用户落进去之前
 * 那个会话已经不可能写文件。
 * @param deps - Session 服务、导航动作与只读预设名。
 * @param sessionId - 正在运行的源 Session。
 * @returns 成功时的子会话身份与诊断信息，或失败原因。
 */
export async function forkHere(deps: ForkHereDependencies, sessionId: string): Promise<ForkHereResult> {
  let atSeq: number | undefined
  try {
    atSeq = await latestBoundary(deps.sessions, sessionId)
  } catch {
    // 读不到实时进度不是致命错误：让 Host 退化成"最后一个完整回合"。
    atSeq = undefined
  }

  let childId: string
  try {
    childId = await deps.sessions.fork({
      sessionId,
      ...atSeq === undefined ? {} : { atSeq },
    })
  } catch (error) {
    return { ok: false, message: `分叉失败：${describeFailure(error)}` }
  }
  deps.onForked?.(childId, sessionId, atSeq)

  const readOnly = await prepareChild(
    deps.sessions,
    childId,
    composeBtwTitle(readSourceTitle(deps.sessions, sessionId)),
    deps.readOnlyPreset ?? DEFAULT_READ_ONLY_PRESET,
  )
  if (!readOnly) {
    // 不把用户送进一个"承诺只读、实际可写"的会话：放弃它（能归档就归档），
    // 让按钮把原因说出来。分叉出来的会话本身是只读父日志得到的，没有写入风险。
    try {
      await deps.discard?.(childId)
    } catch {
      // 清理是尽力而为；清理失败不影响"不导航"这个决定。
    }
    return {
      ok: false,
      message: `分叉成功，但没能把子会话切到只读预设「${deps.readOnlyPreset ?? DEFAULT_READ_ONLY_PRESET}」，已放弃切换`,
    }
  }

  deps.mark?.(childId)
  deps.openSession(childId)
  return { ok: true, childId, atSeq, readOnly }
}
