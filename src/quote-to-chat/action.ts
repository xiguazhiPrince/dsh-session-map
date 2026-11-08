/**
 * 右侧栏文件预览里的「引用到对话」浮动按钮。
 *
 * 挂载点是 `sidebar.right.tab.document.actions`（预览头工具栏，Session 作用域），
 * 因此组件拿到产品注入的标准 Session props：`absolutePath`（owner 给的预览文件
 * 绝对路径）与 `inputActions`（当前会话输入框的公开动作面）。组件自身在工具栏里
 * 只画一个隐藏锚点，真正的按钮 portal 到 `document.body`，跟随选区定位。
 *
 * 交互约定与聊天里原生的「引用文本」一致：
 * - 拖选过程中不打扰；松手（或键盘选完）后才评估选区；
 * - 选区必须完全/起始于预览内容区，且渲染器是可引用形态（markdown/text/code）；
 * - 点击按钮时用 `pointerdown.preventDefault()` 保住选区，再把载荷插进输入框。
 *
 * 插入走 `inputActions.insertText(text, captureInsertion())`——和产品自己插入文本
 * 同一条修订号保护通道；输入框正忙（提交中）或草稿在点击瞬间变化时返回 false，
 * 这里只留一条 console.warn，不弹卡片。
 *
 * @module dsh-session-map/quote-to-chat/action
 */

import * as React from 'react'
import { createPortal } from 'react-dom'
import { selectionLineRange, type QueryRootLike } from './dom'
import {
  buildQuotePayload,
  insertionPrefix,
  isMarkdownRenderer,
  pathOfFileAddress,
  QUOTE_DIVIDER,
  quoteKindOf,
  type QuoteKind,
} from './format'
import { projectSelectionText, type DomNodeLike } from './project'
import { sourceLineRange, sourceTextOfLines } from './source'
import { loadedSourceOf } from './source-bridge'

/** 输入框动作面：产品 `InputActions` 里本功能用到的两项。 */
export interface QuoteInputActions {
  /** 读取当前编辑器选区（带草稿修订号）。 */
  captureInsertion(): QuoteInsertionSpan
  /** 在给定区间插入纯文本；修订号不匹配或输入框被冻结时返回 false。 */
  insertText(text: string, span: QuoteInsertionSpan): boolean
}

/** 插入点的草稿坐标。 */
export interface QuoteInsertionSpan {
  readonly start: number
  readonly end: number
  readonly draftRev: number
}

/** 预览头工具栏条目拿到的 props（窄视图）。 */
export interface QuoteActionProps {
  /** 预览文件的绝对路径；owner 只在路径已知时渲染本条目。 */
  readonly absolutePath?: string | undefined
  /** 当前会话输入框的公开动作面。 */
  readonly inputActions?: QuoteInputActions | undefined
  /** 输入状态选择器；用来判断插入点前面是否已经是空行。 */
  readonly useInput?: ((select: (state: { readonly draft: string }) => string) => string) | undefined
}

/** 浮层位置（视口坐标；元素自身以 `translateX(-50%)` 居中）。 */
interface BubblePosition {
  readonly x: number
  readonly y: number
}

/** 气泡文案；与聊天里的原生引用区分开，明确这是「进对话」。 */
const BUBBLE_LABEL = '引用到对话'

/** 气泡高度估计值（padding + 行高），用来把气泡放到选区上方。 */
const BUBBLE_HEIGHT = 26

/** 气泡中心距视口左右边缘的最小距离，保证窄屏也能完整显示。 */
const EDGE = 84

/** 预览根节点标记：产品在 `PreviewFrame` 上写的渲染器 id。 */
const PREVIEW_ROOT_SELECTOR = '[data-document-preview]'

/** 预览内容区标记：选区必须落在这里面（工具栏不算）。 */
const PREVIEW_CONTENT_SELECTOR = '[data-textpreview-content]'

/** 预览正文标记：可引用文本都在这里面（Markdown 的浮动大纲等旁挂件不在）。 */
const PREVIEW_BODY_SELECTOR = '[data-textpreview-body]'

/** 资源地址标记：从里面解析工作区相对路径。 */
const PREVIEW_URL_ATTRIBUTE = 'data-textpreview-url'

/** 代码渲染器的滚动容器，行号按它内部的 `pre .line` 顺序数。 */
const CODE_CONTENT_SELECTOR = '[data-code-block-content]'

/** 把任意节点抬成元素（文本节点取父元素）。 */
function elementOf(node: unknown): Element | null {
  if (node === null || typeof node !== 'object') return null
  if (node instanceof Element) return node
  const parent = (node as { parentElement?: Element | null }).parentElement
  return parent ?? null
}

/**
 * 造一个绑定到插件生命周期的「引用到对话」工具栏条目。
 * @returns 可注册进 `sidebar.right.tab.document.actions` 的组件。
 */
export function createQuoteToChatAction(): (props: QuoteActionProps) => React.ReactElement {
  function QuoteToChatAction(props: QuoteActionProps): React.ReactElement {
    const anchorRef = React.useRef<HTMLSpanElement | null>(null)
    const bubbleRef = React.useRef<HTMLButtonElement | null>(null)
    const [bubble, setBubble] = React.useState<BubblePosition | null>(null)
    // 提交动作活在 effect 闭包里（它要读预览根与内容区），按钮通过 ref 调它。
    const commitRef = React.useRef<() => void>(() => {})

    // 条件调用的前提：插槽在组件生命周期内不会换宿主实现。
    const draft = props.useInput === undefined ? '' : props.useInput(state => state.draft)
    // 事件处理器读最新值，避免闭包过期。
    const latest = React.useRef<{
      draft: string
      absolutePath: string | undefined
      inputActions: QuoteInputActions | undefined
    }>({ draft: '', absolutePath: undefined, inputActions: undefined })
    latest.current = { draft, absolutePath: props.absolutePath, inputActions: props.inputActions }

    React.useEffect(() => {
      const anchor = anchorRef.current
      if (anchor === null) return
      const doc = anchor.ownerDocument
      const view = doc.defaultView
      if (view === null) return
      const root = elementOf(anchor.closest(PREVIEW_ROOT_SELECTOR))
      const content = elementOf(root?.querySelector(PREVIEW_CONTENT_SELECTOR) ?? null)
      if (root === null || content === null) return
      // 正文容器优先：Markdown 预览的浮动大纲、文件导航器都挂在内容区两侧，
      // 选中它们不算「引用文件内容」。
      const surface = elementOf(content.querySelector(PREVIEW_BODY_SELECTOR) ?? null) ?? content

      /** 隐藏浮层（幂等；同一状态 React 会跳过重渲染）。 */
      const hide = (): void => { setBubble(null) }

      /** 读当前选区并判断它能否被引用。 */
      const readTarget = (): { range: Range; kind: QuoteKind } | null => {
        const selection = view.getSelection()
        if (selection === null || selection.rangeCount !== 1 || selection.isCollapsed) return null
        const range = selection.getRangeAt(0)
        // 两端都要在正文里：只起点在、终点拖到预览外时，投影会把别处的文本也带进来。
        if (!surface.contains(range.startContainer) || !surface.contains(range.endContainer)) return null
        const kind = quoteKindOf(root.getAttribute('data-document-preview'))
        if (kind === undefined) return null
        return { range, kind }
      }

      /** 选区有效时按选区矩形摆放浮层。 */
      const evaluate = (): void => {
        const target = readTarget()
        if (target === null) {
          hide()
          return
        }
        const text = projectSelectionText(target.range.cloneContents() as unknown as DomNodeLike, target.kind)
        if (text.trim() === '') {
          hide()
          return
        }
        const rect = target.range.getBoundingClientRect()
        if (rect.width <= 0 && rect.height <= 0) {
          hide()
          return
        }
        const x = Math.min(Math.max(rect.left + rect.width / 2, EDGE), view.innerWidth - EDGE)
        const above = rect.top - BUBBLE_HEIGHT - 8
        setBubble({ x, y: above < 8 ? rect.bottom + 8 : above })
      }

      /** 点击气泡：把选区构造成载荷并插入当前会话输入框。 */
      const commit = (): void => {
        const target = readTarget()
        const inputActions = latest.current.inputActions
        if (target === null || inputActions === undefined) {
          hide()
          return
        }
        const projected = projectSelectionText(target.range.cloneContents() as unknown as DomNodeLike, target.kind)
        // 来源坐标用宿主机绝对路径（owner 给的），拿不到才退回地址里的相对路径。
        const path = latest.current.absolutePath ?? pathOfFileAddress(root.getAttribute(PREVIEW_URL_ATTRIBUTE)) ?? ''
        if (projected.trim() === '' || path === '') {
          hide()
          return
        }
        const rendererId = root.getAttribute('data-document-preview')
        const source = loadedSourceOf(root)
        const codeRoot: QueryRootLike | null = target.kind === 'code'
          ? content.querySelector(CODE_CONTENT_SELECTOR) ?? content
          : null
        // 行号：纯文本/代码预览按 DOM 行结构精确取；Markdown 预览回源码里做投影匹配。
        const lines = target.kind === 'prose' && isMarkdownRenderer(rendererId)
          ? source === undefined ? undefined : sourceLineRange(source, projected)
          : selectionLineRange(target.range, target.kind, codeRoot)
        // 内容优先取源码原文（Markdown 标记、缩进都保留）；拿不到源码再退回可见文本。
        const text = source === undefined ? undefined : sourceTextOfLines(source, lines)
        const payload = buildQuotePayload({ kind: target.kind, text: text ?? projected, path, lines })
        const span = inputActions.captureInsertion()
        const inserted = inputActions.insertText(
          `${insertionPrefix(latest.current.draft, span.start)}${payload.text}${QUOTE_DIVIDER}`,
          span,
        )
        if (!inserted) console.warn('[quote-to-chat] 引用插入失败：输入框正忙，或草稿在点击后发生变化')
        hide()
      }

      commitRef.current = commit

      let pointerDown = false
      const onPointerDown = (event: Event): void => {
        const target = event.target
        if (bubbleRef.current !== null && target instanceof Node && bubbleRef.current.contains(target)) return
        pointerDown = true
        hide()
      }
      const onPointerUp = (): void => {
        pointerDown = false
        evaluate()
      }
      const onSelectionChange = (): void => {
        if (!pointerDown) evaluate()
      }
      const onScroll = (): void => { hide() }
      const onKeyDown = (event: KeyboardEvent): void => {
        if (event.key === 'Escape') hide()
      }
      const onResize = (): void => { hide() }
      const onBlur = (): void => { hide() }
      const onVisibilityChange = (): void => {
        if (doc.hidden) hide()
      }

      doc.addEventListener('selectionchange', onSelectionChange)
      doc.addEventListener('pointerdown', onPointerDown, true)
      doc.addEventListener('pointerup', onPointerUp, true)
      // 滚动会让浮层的视口坐标失效：捕获阶段监听所有可滚动容器。
      doc.addEventListener('scroll', onScroll, true)
      doc.addEventListener('keydown', onKeyDown, true)
      doc.addEventListener('visibilitychange', onVisibilityChange)
      view.addEventListener('resize', onResize)
      view.addEventListener('blur', onBlur)

      // Tab 切走时宿主只是隐藏（display:none），没有 DOM 事件；用可见性观察兜底。
      let observer: IntersectionObserver | null = null
      if (typeof view.IntersectionObserver === 'function') {
        observer = new view.IntersectionObserver((entries) => {
          if (entries.every(entry => !entry.isIntersecting)) hide()
        })
        observer.observe(root)
      }

      return () => {
        doc.removeEventListener('selectionchange', onSelectionChange)
        doc.removeEventListener('pointerdown', onPointerDown, true)
        doc.removeEventListener('pointerup', onPointerUp, true)
        doc.removeEventListener('scroll', onScroll, true)
        doc.removeEventListener('keydown', onKeyDown, true)
        doc.removeEventListener('visibilitychange', onVisibilityChange)
        view.removeEventListener('resize', onResize)
        view.removeEventListener('blur', onBlur)
        observer?.disconnect()
      }
    }, [])

    const portal = bubble === null || typeof document === 'undefined'
      ? null
      : createPortal(
        React.createElement(
          'button',
          {
            ref: bubbleRef,
            type: 'button',
            className: 'dsm-quote',
            style: { left: `${bubble.x}px`, top: `${bubble.y}px` },
            title: BUBBLE_LABEL,
            'aria-label': BUBBLE_LABEL,
            // 保住选区：mousedown/pointerdown 的默认行为会把选区收起。
            onPointerDown: (event: React.PointerEvent<HTMLButtonElement>) => { event.preventDefault() },
            onClick: () => { commitRef.current() },
          },
          BUBBLE_LABEL,
        ),
        document.body,
      )

    return React.createElement(
      React.Fragment,
      null,
      React.createElement('span', { ref: anchorRef, className: 'dsm-quote__anchor', hidden: true }),
      portal,
    )
  }
  return QuoteToChatAction
}
