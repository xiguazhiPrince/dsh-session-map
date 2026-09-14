# dsh-session-map

把所有会话的 fork 关系画成一张可平移缩放的画布，作为一个标签页加进 DSH 的 Web 界面。

> **当前状态：骨架。** 仓库结构、bundle 层、构建产物契约都已就位，但画布本体还没搬进来（见 [状态](#状态)）。

## 安装（GitHub 直装）

```sh
dsh plugin --profile <你的 profile> add github:<你的账号>/dsh-session-map
```

**预构建分发。** 仓库里直接提交了构建产物 `lib/`，并且没有 `prepare` 脚本，所以 pnpm 只下载 tarball 解压，**不执行任何安装期代码**——不需要 `allowBuilds` 放行，也没有构建等待。

代价是产物可能与源码不同步：**改了 `src/` 必须先 `pnpm build` 再提交**（见[本地开发](#本地开发)）。

另外建议**钉住 commit**。不钉的话，仓库之后任何一次 push 都会改变你安装的内容：

```sh
dsh plugin --profile <name> add github:<账号>/dsh-session-map#<sha>
```

## 验证

```sh
dsh --profile <name> --dump-config   # 应能看到一行 "# == dsh-session-map" 层
dsh --profile <name>
```

启动后打开任意会话，头部标签栏应出现「**会话图谱**」，点进去显示「N 个会话 · 当前 <会话 id>」。

## 本地开发

```sh
pnpm install
pnpm build        # 产出 lib/index.js 与 lib/client.js
pnpm typecheck    # tsc --noEmit
```

`tsdown.config.ts` 不做类型检查、也不用 project references，所以构建是自包含的，类型检查是独立的一步。

**提交前务必 `pnpm build`**：`lib/` 是仓库内容的一部分，安装方不会替你构建。

## 两个产物

| 产物 | 形态 | 谁用 |
|---|---|---|
| `lib/index.js` | ESM | 宿主 Loader 按包名 import |
| `lib/client.js` | CJS closure factory | 浏览器内核通过 module table 取用 |

浏览器半外面包了一层交接，由本仓库的 `tsdown.config.ts` 自己声明：

```js
window.__ModuleLoader__.load({ id: 'dsh-session-map', factory: (require) => { … } });
```

产品自带的 `packages/client/tsdown.client.ts` 预设是**仓库内部**的（它会去读 `packages/<group>/<pkg>/package.json` 并 import 同仓的构建模块），独立仓库导不进来，所以这里自己写。React 与 `@deepseek-ai/cordis` 保持 `require` 外部化，由内核的 `require` 提供；本插件不 import 其它产品包，所以产物里只有自己的代码。

## 状态

**已在本机验证**：

- GitHub 直装全流程——下载 tarball → 解压 → 写进 profile 的 `dependencies` → 回写 `dsh.profile.bundles`；**4.6 秒，零安装期脚本**；
- `--dump-config` 里出现 `# == dsh-session-map` 层；
- 首页 HTML 的 boot manifest 列出了 `dsh-session-map/client.js`，合并后的插件包请求返回 200 且含 `__ModuleLoader__` 工厂交接；
- 两个产物的文件名与 React 外部化（`lib/client.js` 里是 `require("react")`，没有内联）。

**一个包同时是 bundle 和 client 插件是可行的**：产品随附的布局把两者拆成不同的包（bundle 的 patch 行去引用 `packages/client/*` 里的插件包），但自引用同样能被浏览器 roster 收下。

**已完成**：仓库结构、`dsh.bundle` 层、`dsh.client` 声明、宿主半、构建契约，以及全部画布与交互。

## 贡献了什么

| 座位 | 内容 |
|---|---|
| `conversation.view` | 「概览」标签页（order 20）、「会话图谱」标签页（order 30） |
| `conversation.session.header.utilities` | 会话头部的「会话图谱」开关（order 40）；右侧栏已打开时再点一次关闭 |
| `sidebar.right.pane.tab` | 常驻标签页 `dsh-session-map.overview` 与 `dsh-session-map.map` |

画布交互：滚轮上下平移、Shift + 滚轮左右平移、Ctrl / ⌘ + 滚轮缩放、拖动空白平移（不会选中文字）、点击会话节点弹出操作菜单（跳转到会话 / 在画布中居中）、点击链首胶囊展开或收起该线的用户输入、点击输入珠子弹出该轮操作、fork 继承的输入前缀折叠成 `+N 继承` 胶囊。工具栏的键盘图标后面收着这份快捷键表。

## 源码结构

```
src/index.ts            宿主半（空实现，只为占据 bundle 行）
src/client/index.ts     apply：样式表、插件级开关、座位与标签页注册
src/client/views.ts     概览页、头部按钮、画布视图工厂
src/client/graph.ts     布局：fork 树、珠子、折叠标记、连边
src/client/css.ts       样式表字符串
src/client/constants.ts 几何常量与 tab type id
src/client/flags.ts     跨挂载存活的插件级开关
src/client/format.ts    数字与耗时格式化
```

样式表以字符串形式随包分发，由 `apply` 里的一个 effect 建 `<style>` 元素并负责移除。产品的 `styles` 服务只存在于动态运行时，正式插件没有它。

**改完源码务必 `pnpm build` 再提交**——`lib/` 是仓库内容的一部分，安装方不会替你构建。
