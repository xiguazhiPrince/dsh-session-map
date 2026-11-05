/**
 * Composer 里的 `BTW` 按钮：只在会话**正在跑一个回合**时出现，点一下就是
 * "从当前进度分叉出一个只读会话，并切过去"。
 *
 * 它是一个 list-slot 的普通条目（`conversation.input.left`），拿到的是产品注入的
 * 标准 props：`sessionId` 与 `useSession` 选择器。运行状态不是 props 直接给的，
 * 必须从 `useSession(state => state.running)` 读——这也是产品自己的输入栏做法。
 *
 * 失败时不弹任何东西（这里没有卡片）：按钮短暂变成错误态，`title` 里写着原因，
 * 同时 `console.warn` 留一条记录。成功时主视图已切到新会话，本组件随之卸载。
 *
 * @module dsh-session-map/btw/button
 */
import * as React from 'react'
import type { ForkHereResult } from './fork-here'
import { createBtwGlyph } from './glyph'

/** 一次分叉动作的入口，由插件体注入（测试里换成假实现）。 */
export interface BtwRuntime {
  /**
   * 从给定会话的当前进度分叉出一个只读会话并导航过去。
   * @param sessionId - 正在运行的源 Session。
   */
  forkHere(sessionId: string): Promise<ForkHereResult>
}

/** `conversation.input.left` 里本按钮读到的标准 props（窄视图）。 */
export interface BtwButtonProps {
  /** 当前 Session；没有 Session 时插槽仍可能渲染，需自行跳过。 */
  readonly sessionId?: string | undefined
  /**
   * Session 快照选择器。产品以 hook 形式注入，必须在组件里无条件调用；
   * 省略时（例如静态测试）按"未运行"处理。
   */
  readonly useSession?: ((select: (state: { readonly running?: boolean | undefined }) => boolean) => boolean) | undefined
}

/** 错误态持续多久后回到常态。 */
const ERROR_VISIBLE_MS = 8000

/** 按钮的三种外观状态。 */
type BtwPhase = 'idle' | 'working' | 'error'

/** 常态下的提示文案。 */
const IDLE_TITLE = 'btw：从当前进度分叉出一个只读会话并切过去'

/** 旁注图形：一个带三个点的对话气泡，按钮与侧栏行标记共用。 */
const BTW_GLYPH = createBtwGlyph('dsm-btw__glyph', 13)

/**
 * 造一个绑定到具体 runtime 的按钮组件。
 * @param runtime - 分叉动作。
 * @returns 可注册进 `conversation.input.left` 的组件。
 */
export function createBtwButton(
  runtime: BtwRuntime,
): (props: BtwButtonProps) => React.ReactElement | null {
  function BtwButton(props: BtwButtonProps): React.ReactElement | null {
    // 无条件调用：它和产品 hook 一样，不能放进条件分支。
    const running = props.useSession === undefined
      ? false
      : props.useSession(state => state.running === true)

    const [phase, setPhase] = React.useState<BtwPhase>('idle')
    const [message, setMessage] = React.useState<string | undefined>(undefined)
    // A second click can land before the first render reflects `working`, so the
    // guard also lives outside React state: one click, one fork.
    const pending = React.useRef(false)

    // 错误态自愈：一段时间后回到常态，避免按钮一直是红的。
    React.useEffect(() => {
      if (phase !== 'error') return
      const timer = window.setTimeout(() => {
        setPhase('idle')
        setMessage(undefined)
      }, ERROR_VISIBLE_MS)
      return () => { window.clearTimeout(timer) }
    }, [phase])

    const sessionId = props.sessionId
    if (running !== true || sessionId === undefined) return null

    const working = phase === 'working'
    const activate = (): void => {
      if (working || pending.current) return
      pending.current = true
      setPhase('working')
      setMessage(undefined)
      void runtime.forkHere(sessionId).then((result) => {
        pending.current = false
        // 成功时主视图已经切走，这个组件随之卸载；只有失败结果留在这里。
        if (result.ok) {
          setPhase('idle')
          return
        }
        setPhase('error')
        setMessage(result.message)
        console.warn(`[btw] ${result.message}`)
      }, (error: unknown) => {
        pending.current = false
        const text = error instanceof Error ? error.message : String(error)
        setPhase('error')
        setMessage(text)
        console.warn(`[btw] ${text}`)
      })
    }

    return React.createElement(
      'button',
      {
        type: 'button',
        className: phase === 'error' ? 'dsm-btw dsm-btw--error' : 'dsm-btw',
        title: message ?? IDLE_TITLE,
        'aria-label': IDLE_TITLE,
        disabled: working,
        onClick: activate,
      },
      BTW_GLYPH,
      React.createElement('span', { className: 'dsm-btw__label' }, working ? '…' : 'BTW'),
    )
  }
  return BtwButton
}
