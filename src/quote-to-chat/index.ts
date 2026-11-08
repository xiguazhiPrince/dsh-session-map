/**
 * 「引用到对话」的浏览器侧安装：一个预览头工具栏条目 + 一份样式表。
 *
 * 条目的宿主是产品的文档预览包（`ui-sidebar-documentpreview`），它在
 * `PreviewFrame` 头部渲染 `sidebar.right.tab.document.actions`，并把预览文件的
 * 绝对路径作为 owner props 传给条目；Session 作用域又让条目拿到标准 Session
 * props（`inputActions`）。条目本身只画一个隐藏锚点，浮动按钮与选区逻辑在
 * `./action`。
 *
 * 除工具栏条目外，这里还为三种可引用渲染器注册「源码旁路」条目（见
 * `./source-bridge`）：Markdown 的行号与源码原文都要靠它。
 *
 * 只依赖 `slots` 服务：没有它就没有可注册的座位，直接跳过；插槽晚到由
 * `slots.inject` 等声明，避免冷启动时抢跑。
 *
 * @module dsh-session-map/quote-to-chat
 */

import type { Context } from '@deepseek-ai/cordis'
import { lookup, type SlotsService } from '../session-map/sidebar-right'
import { createQuoteToChatAction } from './action'
import { QUOTE_CSS } from './css'
import { CODE_RENDERER_ID, MARKDOWN_RENDERER_ID, TEXT_RENDERER_ID } from './format'
import { createSourceBridge } from './source-bridge'

/** 预览头工具栏的 list slot（由文档预览包声明）。 */
const SLOT = 'sidebar.right.tab.document.actions'

/** 渲染器专属控件插槽：正文 owner 在这里把已加载源码交给旁路组件。 */
const RENDERER_SLOT = 'sidebar.right.tab.document.action'

/** 需要登记源码的渲染器：本功能可引用的三种预览。 */
const SOURCE_RENDERERS = [MARKDOWN_RENDERER_ID, TEXT_RENDERER_ID, CODE_RENDERER_ID] as const

/** 本条目在工具栏里的稳定 id。 */
const ENTRY_ID = 'session-map-quote-to-chat'

/** 排在预览自带控件之后、其它动作之前。 */
const ENTRY_ORDER = 30

/**
 * 安装「引用到对话」：注入样式，并在工具栏插槽声明后注册条目。
 * @param ctx - 浏览器根上下文。
 */
export function installQuoteToChat(ctx: Context): void {
  const slots = lookup<SlotsService>(ctx, 'slots')
  if (slots === undefined) return

  // 与 `btw` 同样的做法：产品没有 styles 服务，样式元素随 fiber 回收。
  ctx.effect(() => {
    const element = document.createElement('style')
    element.textContent = QUOTE_CSS
    document.head.appendChild(element)
    return () => { element.remove() }
  }, 'quote-to-chat: stylesheet')

  const QuoteToChatAction = createQuoteToChatAction()
  ctx.effect(() => slots.inject(SLOT, () => slots.register(
    { name: SLOT, id: ENTRY_ID, order: ENTRY_ORDER },
    QuoteToChatAction,
  )), 'quote-to-chat: document action')

  // 源码旁路：每个可引用渲染器一个 keyed 条目，只登记源码、不画东西。
  const SourceBridge = createSourceBridge()
  for (const key of SOURCE_RENDERERS) {
    ctx.effect(() => slots.inject(RENDERER_SLOT, () => slots.register(
      { name: RENDERER_SLOT, key },
      SourceBridge,
    )), `quote-to-chat: source bridge ${key}`)
  }
}
