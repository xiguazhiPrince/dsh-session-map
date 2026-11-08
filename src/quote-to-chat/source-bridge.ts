/**
 * 预览已加载源码的**旁路登记**。
 *
 * 引用按钮挂在 `sidebar.right.tab.document.actions`（预览头工具栏），它能拿到
 * 文件绝对路径与输入框动作，却拿不到预览的源码。源码只在正文侧的
 * `sidebar.right.tab.document.action`（渲染器专属控件）里以 `content` 出现。
 *
 * 于是这里注册一个「什么都不画」的旁路组件到后者：它把 `content.text`（已加载
 * 的源码页，从第 1 行开始）写进一张以预览根节点为键的 WeakMap。引用按钮点击时
 * 从同一张表读回源码——两个组件在同一个预览根里，DOM 元素就是共同的身份。
 *
 * 键是预览根（`[data-document-preview]`），所以多个 tab 同时挂载也不会串：
 * 每个 tab 有自己的根节点；tab 卸载时 WeakMap 条目随之可回收。
 *
 * @module dsh-session-map/quote-to-chat/source-bridge
 */

import * as React from 'react'

/** 渲染器专属控件插槽里，正文 owner 传下来的内容（这里只关心文本形态）。 */
export interface BridgeContentProps {
  /** 文档正文：`{ kind: 'text', text, … }` 时可见源码；字节/渲染器形态不登记。 */
  readonly content?: unknown
}

/** 预览根节点选择器：产品在 `PreviewFrame` 上写的渲染器 id。 */
const PREVIEW_ROOT_SELECTOR = '[data-document-preview]'

/** 每个预览根已加载的源码文本。 */
const loadedSources = new WeakMap<Element, string>()

/**
 * 从正文 owner props 里取已加载的源码文本。
 * @param content - 文档正文。
 * @returns 源码文本；不是文本形态时为 `undefined`。
 */
export function textOfContent(content: unknown): string | undefined {
  if (content === null || typeof content !== 'object') return undefined
  const value = content as { readonly kind?: unknown; readonly text?: unknown }
  if (value.kind !== 'text' || typeof value.text !== 'string') return undefined
  return value.text
}

/**
 * 读一个预览根已加载的源码。
 * @param root - 预览根节点。
 * @returns 源码文本；尚未加载或渲染器不提供时为 `undefined`。
 */
export function loadedSourceOf(root: Element | null): string | undefined {
  if (root === null) return undefined
  return loadedSources.get(root)
}

/**
 * 造旁路组件：注册进 `sidebar.right.tab.document.action` 的每个可引用渲染器 key。
 * @returns 只画一个隐藏锚点的组件。
 */
export function createSourceBridge(): (props: BridgeContentProps) => React.ReactElement {
  function SourceBridge(props: BridgeContentProps): React.ReactElement {
    const anchorRef = React.useRef<HTMLSpanElement | null>(null)
    const text = textOfContent(props.content)

    React.useEffect(() => {
      const anchor = anchorRef.current
      if (anchor === null || text === undefined) return
      const root = anchor.closest(PREVIEW_ROOT_SELECTOR)
      if (root === null) return
      loadedSources.set(root, text)
      return () => {
        // 只删自己写的那一份：重渲染时新 effect 会写入新文本。
        loadedSources.delete(root)
      }
    }, [text])

    return React.createElement('span', { ref: anchorRef, className: 'dsm-quote__anchor', hidden: true })
  }
  return SourceBridge
}
