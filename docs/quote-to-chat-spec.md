# 引用文件预览里的选中文本到对话（quote-to-chat）

> 状态：v0.2 已实现 ｜ 日期：2026-11-08 ｜ 落点：`src/quote-to-chat/`

## 0. 一句话

右侧栏打开的文件 tab（Markdown / 代码 / 纯文本预览）里选中一段文本，选区上方浮出「引用到对话」；点一下就把 **宿主机绝对路径 + 起止行号 + 源码原文** 插进当前会话的输入框。

## 1. 目标与非目标

### 1.1 目标

- 在右侧栏原生文件预览里**选中即引用**，不需要离开预览、不需要复制粘贴。
- 载荷以**来源坐标开头**：`完整路径:起止行号`，模型据此定位到原文。
- 内容**优先取源码原文**（Markdown 的 `**`、缩进、代码原文都保留），拿不到源码才退回渲染后的可见文本。
- 视觉与聊天里原生的「引用文本」气泡一致（同主题 token、同胶囊形状）。

### 1.2 非目标

- 不引用 HTML / PDF / Office / 表格预览的选区：HTML 在沙箱 iframe 里，跨不出选区；PDF 文本层与 Office 画布没有稳定的源码行映射。
- 不直接发送：只写草稿，不替用户提交。
- 不做「整个文件」引用：那是输入框里 `@路径` 的职责。
- 不改产品侧代码，全部通过公开扩展点实现。

## 2. 契约依赖

产品（DSH 0.2.2-rc.1）提供、本功能依赖的公开或稳定的结构：

| 依赖 | 值 | 用途 |
|---|---|---|
| Slot `sidebar.right.tab.document.actions` | list / session | 预览头工具栏：浮动按钮的挂载点 |
| 该 Slot 的 owner props | `{ absolutePath: string }` | **来源坐标的路径**（宿主机绝对路径） |
| Slot `sidebar.right.tab.document.action` | keyed by 渲染器 id / session | 渲染器专属控件：源码旁路 |
| 该 Slot 的 owner props | `{ content }` | `content.text` 是已加载的源码页 |
| 标准 Session props | `sessionId`、`useInput`、`inputActions` | 读草稿、插文本 |
| `inputActions.captureInsertion()` | `{ start, end, draftRev }` | 插入点 + 修订号保护 |
| `inputActions.insertText(text, span)` | `boolean` | 一次插入（多行会拆段落）；草稿变了/提交中返回 false |
| 预览根标记 `[data-document-preview]` | 渲染器 id | 判形态与行号策略 |
| 预览内容 `[data-textpreview-content]` / 正文 `[data-textpreview-body]` | — | 限定选区范围（工具栏、导航器不算） |
| 资源地址 `data-textpreview-url` | `dsh-resource://file/session/<id>/<path>` | 相对路径兜底、解析内容会话 |
| 纯文本行号 `[data-textpreview-line]` | 绝对行号 | 纯文本预览的行号来源 |
| 代码行 `pre .line` | 行元素序列 | 代码预览的行号来源（与产品跳行同一套索引） |

渲染器 id（keyed slot 的 key，也是判形态依据）：

- `@deepseek-ai/dsh-client-ui-sidebar-documentpreview/markdown`
- `@deepseek-ai/dsh-client-ui-sidebar-documentpreview/text`
- `@deepseek-ai/dsh-client-ui-sidebar-documentpreview/code`

> 升级 DSH 大版本后若气泡不出现、行号错位或内容变回渲染文本，先怀疑这里漂移。

## 3. 交互

### 3.1 出现

- 拖选过程中不打扰；`pointerup` 或键盘选区变化后评估。
- 条件：选区非空、**两端**都落在正文容器内、渲染器是可引用形态、矩形非零。
- 位置：选区矩形上方居中；顶部空间不足时放到下方；左右距视口边缘至少 84px。

### 3.2 消失

任意 `pointerdown`（按钮自身除外）、滚动（捕获）、`Escape`、窗口 resize / 失焦、页面隐藏、预览被 `display:none`（Tab 切走，用 IntersectionObserver 兜底）。

### 3.3 点击

1. `pointerdown.preventDefault()` 保住选区（否则浏览器会先收起选区）；
2. 读选区 → 投影文本 → 解析绝对路径、行号范围、源码原文；
3. 若草稿在插入点前已有内容且不是空行，先补分隔（`\n` 或 `\n\n`）；
4. `inputActions.insertText(载荷 + "\n", captureInsertion())`；
5. 失败（提交中、草稿修订号变化）只 `console.warn`，不弹卡片；成功则隐藏气泡。

## 4. 载荷格式

### 4.1 Markdown / 纯文本（引用块）

```
/Users/me/repo/README.md:86-88

> **版本提醒**：npm 上最新是 **0.4.0**——……
> 第二行原文
```

- 首行是**来源坐标**：宿主机绝对路径 + `:起止行号`（单行写 `:86`）；
- 之后是引用块，内容是**源码原文**；源码本身是引用块时只剥一层 `>`，不产生嵌套引用；
- 发出后会被产品的 quote 规则识别成原生引用卡片。

### 4.2 代码（围栏）

````
```/Users/me/repo/src/deep/a.ts:12-13
const a = 1
const b = 2
```
````

- 围栏信息行是来源坐标（绝对路径 + 起止行号）；
- 正文是源码行原文（整行，含缩进）；正文里若本身含反引号串，围栏自动加长。

### 4.3 截断

内容只是「酌情」的摘要，来源坐标才是主信息：单次引用上限 **100 字符**（UTF-16 code unit）。

- 超限时优先在行边界截断；
- **行号范围同步收窄**到实际引用的行（`路径:起止行` 与正文对得上）；
- 正文后附一行 `（选区过长，已截断：原文共 N 字）`——不静默丢内容。

### 4.4 收尾分割线

插入块的末尾固定是 `\n\n---\n\n`（空行 + 一级分隔线 + 两个换行）：

- 第二个换行让光标停在分割线下面隔一行处，用户接着写自己的问题时不贴横线；
- 发送后渲染成一条水平线，把「引用的原文」和「我的问题」在视觉上分开。

## 5. 行号与内容来源

| 预览 | 行号来源 | 内容来源 |
|---|---|---|
| 代码 | DOM：`pre .line` 索引（与产品跳行一致） | 源码旁路的 `content.text` 按行切 |
| 纯文本 | DOM：`[data-textpreview-line]` 绝对行号 | 源码旁路按行切 |
| Markdown | **源码映射**：把源码投影成「可见文本 + 行号」，再匹配选区 | 源码旁路按行切 |
| 任一种（旁路缺失） | 代码/纯文本仍可用 DOM；Markdown 无行号 | 渲染后的可见文本 |

### 5.1 源码旁路

引用按钮在预览头工具栏，拿不到源码；源码只在正文侧的
`sidebar.right.tab.document.action`（渲染器专属控件）里以 `content` 出现。插件在那里注册一个
**只登记、不渲染**的条目：把 `content.text`（已加载的源码页，从第 1 行起）写进以
`[data-document-preview]` 根节点为键的 WeakMap；引用按钮点击时从同一张表读回源码。
两个组件在同一预览根里，DOM 元素就是共同身份，多个 tab 并存也不会串。

### 5.2 Markdown 源码映射

Markdown 预览渲染的是 HTML，DOM 给不出行号。`source.ts` 把源码投影成「渲染后可见文本 +
每字符源码行号」，再用同一套规则投影选区做子串匹配：

- 行内标记（`**` `_` `` ` `` `~~`）去掉；转义字符保留被转义的字符；
- 链接/图片只留可见文本，自动链接保留 URL，普通 HTML 标签丢弃；
- 行首标题/引用/列表标记去掉，表格竖线变空格；
- 代码围栏行丢弃、块内代码原样保留；分隔线、表格分隔行不产生文本；
- 空白折叠成单空格（渲染后的段落换行、DOM 块边界都表现为空白）；
- 整段匹配失败时退到「前后两段文字」定位，仍失败则降级为无行号。

CJK 场景下 `**文本**：` 这类强调可能不被解析（预览里会显示字面 `**`），因此源码与选区
**同时**去掉行内标记，匹配不受解析差异影响。代理对（emoji）按 UTF-16 code unit 逐位建表，
保证 `indexOf` 下标与行号表对齐。

## 6. 降级与边界

| 情况 | 行为 |
|---|---|
| 没有 `slots` 服务 | 不安装，静默跳过 |
| 插槽声明晚于插件激活 | `slots.inject` 等声明再注册 |
| 源码旁路尚未挂载 / 渲染器 id 变更 | Markdown 无行号、内容退回渲染文本；其余形态不受影响 |
| `inputActions` 缺失（极简组合） | 气泡可出，点击不插入并隐藏 |
| 输入框提交中 / 草稿修订号变化 | `insertText` 返回 false → `console.warn`，不重试 |
| 绝对路径缺失 | 退到地址里的工作区相对路径 |
| HTML / PDF / 图片 / Office | 不出现气泡 |

## 7. 测试

- `format.test.ts`：形态识别、地址解析（含会话 id）、来源坐标、引用块/围栏构造、源码引用块去嵌套、截断、插入分隔。
- `project.test.ts`：块边界、`<br>`、代码行空行、纯文本页拼接、不可引用子树、文档片段。
- `dom.test.ts`：两种行号来源、端点落在行首时的回退。
- `source.test.ts`：Markdown 源码投影、行号匹配（CJK 字面强调、跨行段落、链接、列表、代码围栏、行内代码）、降级、源码切片。
- `action.test.ts`：工具栏条目只画隐藏锚点，渲染期不碰输入框。

## 8. 待核实清单（产品升级时先看这里）

1. 渲染器 id 是否仍是 `…/markdown`、`…/text`、`…/code`（keyed slot 的 key 也依赖它）；
2. `sidebar.right.tab.document.actions` 的 owner props 是否仍是 `{ absolutePath }`；
3. `sidebar.right.tab.document.action` 的 owner props 是否仍是 `{ content }`，`content.text` 是否仍是已加载源码；
4. 代码预览里行元素是否仍是 `pre .line`、纯文本行是否仍带 `data-textpreview-line`；
5. `inputActions.insertText` 是否仍接受多行文本并拆段落。
