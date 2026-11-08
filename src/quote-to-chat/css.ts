/**
 * 「引用到对话」浮层按钮的样式。
 *
 * 产品没有对外的 `styles` 服务（动态运行时之外），所以样式以字符串形式由插件
 * 自己注入。视觉直接对齐产品的原生引用气泡（`message-quotes` 的
 * `QuoteSelection`）：同一组主题 token、同样的胶囊形状与投影——这样文件预览里
 * 的引用按钮和聊天里的「引用文本」看起来是同一个东西。
 *
 * @module dsh-session-map/quote-to-chat/css
 */

/** 浮层按钮样式；类名带 `dsm-` 前缀，避免与产品样式冲突。 */
export const QUOTE_CSS = `
/* 工具栏里只放一个不可见锚点：浮层定位需要它当 DOM 锚。 */
.dsm-quote__anchor {
  display: none;
}

/* 与产品原生引用气泡同款：floating fill + elevation panel + 胶囊圆角。 */
.dsm-quote {
  position: fixed;
  z-index: 9999;
  transform: translateX(-50%);
  corner-shape: round;
  background: var(--dsw-alias-button-floating-fill);
  --dsw-elevation-stroke-color: var(--dsw-alias-border-l3);
  box-shadow: var(--dsw-elevation-panel);
  color: var(--dsw-alias-label-primary);
  font: var(--dsw-font-xs-13);
  cursor: pointer;
  border: none;
  border-radius: 999px;
  padding: 5px 10px;
  white-space: nowrap;
  user-select: none;
  -webkit-user-select: none;
}

.dsm-quote:focus-visible {
  outline: 2px solid var(--dsw-alias-brand-primary);
  outline-offset: 2px;
}

@media (hover: hover) {
  .dsm-quote:hover {
    background: var(--dsw-alias-button-floating-hover);
  }
}
`
