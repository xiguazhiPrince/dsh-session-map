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

**已在本机验证**：GitHub 直装全流程（克隆 → 解压 → 装进 profile → 写回 `dsh.profile.bundles`）、两个产物的构建与文件名、浏览器半的 `__ModuleLoader__` 交接与 React 外部化。

**已完成**：仓库结构、`dsh.bundle` 层、`dsh.client` 声明、宿主半、构建契约。

**待办**：把画布搬进来。目标形态包括——对话标签页里的全宽画布、右侧栏标签页、会话头部的「会话图谱」按钮、Ctrl+滚轮缩放、滚轮/拖动平移、节点操作菜单、逐线展开/收起用户输入、fork 继承前缀折叠。

**尚未验证的一点**：本包同时声明 `dsh.bundle` 和 `dsh.client`，即"一个包既是 bundle 又是 client 插件"。产品随附的布局把两者分成不同的包（bundle 的 patch 行去引用 `packages/client/*` 里的插件包），但文档里的最小例子（`hello-plugin`）是一个包自引用，所以这里按后者做。若 profile 启动后浏览器 roster 里找不到本行，把它拆成 `dsh-session-map`（插件）+ 一个只含 patch 的 bundle 包即可，不需要改插件代码。
