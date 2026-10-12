# dsh-session-map

把所有会话的 fork 关系画成一张可平移缩放的画布，作为一个标签页加进 DSH 的 Web 界面。

这个包还带一个**可选的宿主组件**：

- **ACP 会话**：把整个会话交给任何支持 ACP 的命令行 agent —— DSH 当它的客户端。你在 DSH 里发消息、看思考与正文、看工具卡片、点审批，背后跑的是远端 agent（本机实测过 `cursor-agent acp` 与 `opencode acp`）。见 [ACP 会话（把 ACP agent 直接当成一个会话）](#acp-会话把-acp-agent-直接当成一个会话)。

这一行默认开着但**agent 列表是空的**：空列表什么都不注册，加一个 agent 才有东西跑——加的地方是 Settings → **ACP**（或 profile patch 里的 `agents`）。

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

## 安装后验证

装完不会立刻生效：**profile 的 bundle 列表是启动时读的**，正在运行的实例不会加载新行。先确认补丁栈里有这一层——

```sh
dsh --profile <name> --dump-config
```

```yaml
# == dsh-session-map
- id: session-map
  name: dsh-session-map
```

然后重启该 profile 的进程并刷新页面。四处应该出现：

| 位置 | 应该看到 |
|---|---|
| 会话标签栏 | 「概览」与「会话图谱」两个标签页 |
| 会话头部工具区 | 「会话图谱」开关；右侧栏正显示图谱时再点一次会关闭它 |
| 右侧栏标签 | `dsh-session-map.map`（标题「会话图谱」）和 `dsh-session-map.overview`（标题「会话概览」） |
| 图谱页本身 | fork 树画布；工具栏显示会话数、树数与当前缩放百分比 |

两件容易被当成故障的事：

- **切换会话后图谱没了。** 视图选择和右侧栏布局都是**按会话各存一份**的状态，没打开过的会话回落到它自己的默认值。从画布「跳转到该会话」时右侧栏的图谱会跟随过去；对话标签栏的图谱不会——那个选择属于 `ui-conversation`，插件没有接口去改。
- **点右侧栏开关没反应。** 按钮旁边会出现红色错误文字——失败不再只写进 console。把内容贴出来即可。

## ACP 会话（把 ACP agent 直接当成一个会话）

**把整个会话交给远端 agent**，DSH 当 ACP 客户端：你在 DSH 里发消息、看思考与正文、看工具卡片、点审批，而这一切背后跑的是 `cursor-agent`、`opencode` 或任何说 ACP 的命令行 agent。它自己的会话、模型、工具、上下文都是它的一套。

默认这一行**开着，但 agent 列表是空的**——空列表什么都不注册，所以默认不跑任何 agent 代码。要加一个 agent，两个入口：

1. **设置页**：Settings → **ACP**。点「+ Cursor CLI / + opencode / + Gemini CLI」任何一个都会按该 vendor 的默认命令填好一张卡片，改完按「保存」即生效（写进当前 profile 的 `cordis.patch.yml`，不用重启；页面上的说明见下）。
2. **profile patch**：直接写这一行的 `agents` 列表：

```yaml
- id: acp-agent
  config:
    agents:
      - name: cursor
        command: cursor-agent
        args: [ 'acp' ]
        permission: allow
```

然后**新建会话**，在「预设」卡片里选 **ACP · cursor**（每个 agent 一张卡）。选中的会话此后每一次请求都走这个远端 agent——预设会把路由钉死，所以这一行会话里换不了别的模型。

### 设置页（Settings → ACP）

- 一个 agent 一张卡片：名称、命令、参数、模式、权限、工作目录，`<details>` 里是环境变量与会话选项（都是每行 `KEY=VALUE`）；另有「启用 / 停用」「上移 / 下移」「删除」。
- 所有改动先留在页面里，按「保存」才一次写入 `agents`——页面校验与后端同源（名称必填/字符集/唯一、命令必填、工作目录必须是绝对路径、`KEY=VALUE` 行号报错），有问题的草稿不会落进 patch。
- 写入走 settings 服务并带 revision 栅栏：别处（另一个窗口、手改 patch）改了配置，页面会重新读取；被拒的写入保留草稿并提示。
- **仍然只能在 YAML 里改的**：`approval` / `fs` / `idleDisposeMs` / `utilityProvider` + `utilityModel` / `disposeEofGraceMs` / `disposeGraceMs`。它们是这条行的非 volatile 字段，settings 服务拒绝写——页面里也只读地提了一句。
- 行的开关（`disabled`）仍在 Settings → 内置插件 里；把那行关掉时页面会显示怎么打开，而不是静默消失。
- 供应商表就是代码里的三条（Cursor / opencode / Gemini CLI），写错了照旧可以用「+ 自定义」手填；各家文档见页面上的链接。

### 会话里会出现什么

| DSH 里的东西 | 来自哪里 |
|---|---|
| 思考（reasoning） | ACP 的 `agent_thought_chunk` |
| 正文（text） | ACP 的 `agent_message_chunk` |
| 工具卡片 | 远端每一次 `tool_call`；DSH 侧镜像成 `acp_read` / `acp_edit` / … 十个工具，卡片显示远端自己的标题、类型与涉及的路径，展开能看到远端返回的输出 |
| 审批卡片 | 远端问 `session/request_permission`（当 `approval: ask`） |
| 停止按钮 | 真的会让远端 `session/cancel`，并且 DSH 侧的等待会立刻结束 |

### 一行配置的字段

| 字段 | 默认 | 作用 |
|---|---|---|
| `agents` | `[]` | agent 列表；每个 agent 派生出一张预设卡片与一个 `acp` 模型 |
| `approval` | `policy` | `policy` 用每个 agent 自己的 `permission` 自动应答。`ask` 把决定交给 DSH 的审批服务：问题出现在该会话的对话里，先过会话自己的审批策略，且和别的审批一样进审计日志。审批服务不可用时**回到** `policy`，不会凭空授权 |
| `fs` | `bridge` | `bridge` 在握手里声明 `fs/read_text_file` 与 `fs/write_text_file`，并**用 `ctx.fs` 提供**：远端读的是 DSH 执行世界里的文件，写的是带**该会话沙箱策略**的 Host 写入——只读会话会被后端直接拒掉，文件根本不会创建。`isolate` 声明什么都不提供，让 agent 用自己的文件系统 |
| `idleDisposeMs` | `600000` | 会话安静这么久之后回收那条 agent 进程。**注意**：`channel.ts` 把 `<= 0` 当「不回收」，但 `src/acp-agent/config.ts` 的解析会把非正数当作未设置、回落到 10 分钟，所以 `0` 目前不可达——见 [docs/p8-acp-settings-page.md](docs/p8-acp-settings-page.md) 最后一节 |
| `utilityProvider` / `utilityModel` | 未设 | 压缩与标题这类 **Host 工具调用**往哪走。两个必须同时给。不设就是本行拒绝，Host 用自己的兜底标题 |

#### 每个 agent 的字段

| 字段 | 默认 | 含义 |
|---|---|---|
| `name` | **必填** | 同一行内必须唯一；它就是 `acp` 路由上的模型 id，也是预设卡片 id 的来源 |
| `command` | **必填** | 要跑的 CLI 名字（在 PATH 上）或可执行文件绝对路径；Windows 上的解析顺序见下 |
| `args` | `['acp']` | 传给它的参数 |
| `cwd` | 会话的 cwd | 子进程与 ACP 会话的工作目录；相对路径按 Harness 启动目录解析一次 |
| `mode` | 不设置 | agent 声明过的任意模式 id。**不设置就不切模式**，让 agent 用它自己的默认 |
| `configOptions` | 不设置 | `session/new` 之后按 id 应用的会话选项（常见是 `model`）。**被 agent 拒绝就整轮失败**——静默换一个模型比直接报错更糟 |
| `permission` | `allow` | 只在 `approval: policy` 下生效：`allow` 选第一个 `allow_once`（没有则 `allow_always`）；`reject` 一律拒绝。见下面的安全说明 |
| `env` | `{}` | 叠加在进程 seam 的凭据清洗之后，例如某个 CLI 自己的 API key |
| `enabled` | `true` | 关掉即不注册模型、也不给预设卡片（草稿仍留在配置里） |

这一行整体可配 `disposeEofGraceMs`（`6000`）/ `disposeGraceMs`（`3000`）：stdin EOF 后留给子进程自行收尾的宽限，以及观察失败、逐级升级终止的宽限。

### 命令解析（Windows 上是关键）

进程 seam **从不做 shell 解释**（`argv[0]` 就是程序），而且不提供 `windowsVerbatimArguments` 这类变通参数，所以 Windows 上的 `.cmd` / `.bat` 必须找到真实入口。顺序如下，命中即止：

1. **已知启动器表**（`src/acp-core/resolve.ts` 的 `knownLaunchers`）：`cursor-agent` / `agent` → 版本目录里的 `node.exe index.js`。这张表只是为了少绕一步，删掉也不影响正确性，只是会退到第 3 步（多一层 PowerShell 跳转）；
2. **shim 自己声明的目标**：读 `.cmd` 里的 `"%dp0%\<相对路径>"`（npm / pnpm / yarn 的 `cmd-shim` 模板）。目标是二进制就直接 spawn；带 `%_prog%` 或 `.js` 结尾就在前面加 `node.exe`。安装路径含空格也没问题——这正是不走命令解释器的理由；
3. **命令解释器兜底**：没有可解析目标时用 `cmd.exe /d /s /c "<命令行>"`（Node 自己 `shell: true` 的形状）。这条路没法保证普遍安全——seam 不提供 verbatim 参数，含空格或引号的 token 会被 Node 二次转义后交给 `cmd.exe`——所以**只有命令行里没有空格/引号时才会走**，否则直接报错并给出配置指引。

`command` 是绝对路径或含 `/`、`\` 时不查 PATH；裸名字按 `.exe` 优先、`.cmd`/`.bat` 次之的顺序扫 PATH（没有任何扩展名的文件直接跳过——Windows 起不来这样的程序）。

**每次启动都重新解析**（自更新的 CLI 会多出新的版本目录），代价是一次目录列举加一次 PATH 扫描。

### 安全说明（`permission` / `approval`）

`permission: allow` 意味着**远端 agent 的工具无人干预地跑**，它能在会话工作目录里写文件，DSH 的沙箱对**它自己的**进程不适用。两条把这件事收紧：`approval: ask` 让审批真的问人；`fs: bridge` 让远端**通过客户端**做的文件访问走 DSH 的文件系统与沙箱。

只读用法：`mode: plan`（或该 agent 的只读模式）+ `permission: reject`，或者把部署沙箱设成 `read-only`。

没有登录时**不会**自动替你登录：ACP 的 `authenticate` 可能是交互式的，驱动不会去调用它。先在终端把那个 CLI 登录好，或者把它的 key 放进 `env`。

### 已知边界

- **一轮 vs 一次调用。** 一次 ACP `session/prompt` 跑完的是远端的一整轮；DSH 的循环要求每次工具调用各结束一次调用。这一行通过在**每个新出现的远端工具调用处切断流**来对齐，代价是 DSH 侧的步数比远端自己的步数多。
- **远端进程死了就没有远端上下文了。** DSH 的 transcript 还在，通道会自动重建，但远端会话不保留（`session/load` 没实现）。
- **`terminal/*` 没有桥接。** 远端 agent 用自己的 shell（P1 起就是这样，Cursor 也验证过能自己写文件）。桥接它换来的是 Host 渲染的终端，而 `fs` 桥接换来的是**强制**——沙箱围栏是一条安全边界，终端桥接只是呈现。理由与取舍记在 [docs/p6-fs-bridge.md](docs/p6-fs-bridge.md)。
- **未知扩展方法**：ACP 之外的阻塞请求（已知的是 Cursor 的 `cursor/ask_question`、`cursor/create_plan`）被确定性回绝（空对象）并记入诊断，不会把一轮挂死；`cursor/update_todos`、`cursor/task`、`cursor/generate_image` 是通知，注册为空处理。表在 `src/acp-core/client.ts`，换 agent 出新扩展方法时往那里加。
- **MCP 不桥接**：`session/new` 的 `mcpServers` 传空数组，agent 用自己的配置（Cursor 读 `.cursor/mcp.json`）。
- **工具卡片显示的是公告时刻的参数快照。** Cursor 的 `rawInput` 往往在后续 `tool_call_update` 里才补全，那时它已经进了输出而不是输入。
- **从 `agents` 里删掉一个 agent 之后，用它建过的会话打不开了。** 会话日志记着当初的 `agentPreset`，重建会话时 Host 会去解析那个 id；id 不存在就报 `agent-preset/not-found`（错误详情里带 `available` 列表）。删掉那些旧会话即可，或者把 agent 加回去。**注意这不是浏览器缓存问题**：`session/create` 请求本身不带 preset，那个 id 是从磁盘上那条会话记录里读出来的，所以刷新、清 localStorage、换标签页都没用。
- **安全诊断**：失败只记一行固定事实 `ACP failure (agent: <名>; stage: …; category: …)`，不含 stderr、异常文本、任务内容、路径、环境值或协议 payload；原始 cause 只留在 Host 日志的 cause 链里。

### 实测与阶段记录

每一步都有可复现的证据，各自记了一份：

| 阶段 | 内容 | 记录 |
|---|---|---|
| P0 | 路由可行性探针（脚本化 adapter 证明 DSH 循环能被外部驱动） | [docs/p0-spike.md](docs/p0-spike.md) |
| P1 | 只读镜像：思考/正文/工具卡片进 DSH UI | [docs/p1-acp-route.md](docs/p1-acp-route.md) |
| P2 | 预设卡片：新会话选中即把路由钉到某个 agent | [docs/p2-preset-cards.md](docs/p2-preset-cards.md) |
| P3 | 生命周期：停止真的能停、通道回收、每轮重置、固定行诊断、utility 委派 | [docs/p3-lifecycle.md](docs/p3-lifecycle.md) |
| P4 | 审批桥接：`approval: ask`，审批卡片进对话、进审计日志 | [docs/p4-approval-bridge.md](docs/p4-approval-bridge.md) |
| P5 | 客户端工具视图：卡片显示远端标题/类型/路径 | [docs/p5-client-tool-views.md](docs/p5-client-tool-views.md) |
| P6 | 文件系统桥接：远端读写走 `ctx.fs` 与沙箱 | [docs/p6-fs-bridge.md](docs/p6-fs-bridge.md) |
| P7 | 删除子代理委派：把首次抽取没做完的共享核心接上，移除整条委派链路 | [docs/p7-remove-delegation.md](docs/p7-remove-delegation.md) |
| P8 | 设置页：Settings → ACP 一页管理 `agents`，含 Cursor / opencode / Gemini CLI 三个供应商预设 | [docs/p8-acp-settings-page.md](docs/p8-acp-settings-page.md) |

本机实测过的 agent：`cursor-agent acp`（真实会话、工具卡片、停止、审批都跑通）。脚本化 agent（`test/mock-acp-agent.mjs`）用于确定性地验审批与文件系统两条路径，因为它不依赖某个 Cursor 版本愿不愿意发问。

## 本地开发

```sh
pnpm install
pnpm build        # 产出 lib/index.js、lib/acp-agent.js、lib/acp-preset.js、lib/acp-model.js 与 lib/client.js
pnpm typecheck    # tsc --noEmit
pnpm test         # node --test，驱动 lib/ 产物
```

`tsdown.config.ts` 不做类型检查、也不用 project references，所以构建是自包含的，类型检查是独立的一步。

**提交前务必 `pnpm build`**：`lib/` 是仓库内容的一部分，安装方不会替你构建。

### 测试

`pnpm test` 不需要任何真 agent、不需要登录、不联网。它覆盖的是**与具体路由无关的那一半**——也就是最平台敏感的那一半：

- `test/core.test.mjs` 直接调用构建产物里的纯函数：`resolveAcpCommand`（已知启动器取最新且跳过不完整版本、npm shim 声明的二进制直连、声明了 `%_prog%` 的脚本前面加 node、`.cmd` 走命令解释器、裸 `node` 优先 `.exe`、PATH 上找不到时给配置指引）、`resolveChildCwd` / `assertUsableCwd`，以及 `resolveOptions` / `agentSchema` 的逐 agent 校验（缺失的 `name` / `command`、类型与枚举错误、重名、`cwd` 不可用、以及 graces 的边界）。Windows 专属用例在非 Windows 上跳过。
- `test/acp-card.test.mjs` 直接调用 `lib/acp-model.js`：草稿 ↔ wire 往返、写回时丢掉默认值、校验规则、`KEY=VALUE` 与参数解析、列表编辑、供应商预设的命名去重，以及用**真实 `Config.toJSON()`** 验的命名空间识别。

会话路由本身没有自动化测试：它的验证靠 `.dsh-dev` 探针 profile（真实 agent / 脚本化 agent）与人工实测，见上面那张阶段表。

### 加载链路验证

用一个隔离的 `DSH_HOME`，不碰真实 profile：

```sh
$env:DSH_HOME = "$PWD\.dsh-dev"
dsh plugin --profile dev add "$PWD"
dsh --profile dev --dump-config      # 应看到 # == dsh-session-map 层与两行
```

`.dsh-dev/` 已 gitignore。实测结论：`--dump-config` 里出现的正是 `session-map` 与 `acp-agent`（`dsh-session-map/acp-agent`，默认**不再** `disabled`，`agents: []`）；设置页写进去的那一份会作为 profile 覆盖出现在同一份 dump 里；把配置写坏时启动会给出带行名的警告（说明 Loader 确实 import 了这个入口并把原始 config 交给了 `apply`）；配置正确时启动**没有** "entry did not activate" 警告。

## 产物

| 产物 | 形态 | 谁用 |
|---|---|---|
| `lib/index.js` | ESM | 宿主 Loader 按包名 import（画布那一行） |
| `lib/acp-agent.js` | ESM | 宿主 Loader 按子路径 `dsh-session-map/acp-agent` import（ACP 会话那一行） |
| `lib/acp-preset.js` | ESM | 预设卡片为每个新会话挂的子插件；只注册一条 `agent/request` 拦截把路由钉住 |
| `lib/acp-model.js` | ESM | 设置页的纯模型（草稿转换、校验、列表编辑、供应商表、schema 识别）；同时被 `lib/client.js` 打包进去，给 `test/acp-card.test.mjs` 在 Node 里直接跑 |
| `lib/client.js` | CJS closure factory | 浏览器内核通过 module table 取用 |

**为什么 ACP 那两行用子路径 specifier。** 浏览器客户端发现只认**裸包名**（`exactPackageSpecifier` 对含 `/` 的 specifier 返回 `undefined`，见 `packages/client/modules/src/index.ts`），所以同一个包的其它入口对客户端模块表**不可见**——不会重复注册、也不会触发「同一包有多个活跃 Loader 来源」的组合错误。先例是 `@deepseek-ai/dsh-tool-subagent-control/list-agents`；这也是同一个入口能被多行同时挂载的原因。

宿主半侧同样不 import 任何产品包：`ctx` 注入的对象 + 本地结构化类型就够（`src/acp-agent/contract.ts` 记了出处）。`@agentclientprotocol/sdk@1.4.0`、`zod` 与 `@deepseek-ai/schemastery@3.18.4` 只是 **devDependency**，由 tsdown 内联进产物——所以安装期依然不跑任何脚本、也不装任何运行时依赖（代价是 `lib/acp-agent.js` 约 400 KB，含 SDK 与 zod）。

浏览器半侧外面包了一层交接，由本仓库的 `tsdown.config.ts` 自己声明：

```js
window.__ModuleLoader__.load({ id: 'dsh-session-map', factory: (require) => { … } });
```

产品自带的 `packages/client/tsdown.client.ts` 预设是**仓库内部**的（它会去读 `packages/<group>/<pkg>/package.json` 并 import 同仓的构建模块），独立仓库引用不到，所以这里自己写。React 与 `@deepseek-ai/cordis` 保持 `require` 外部化，由内核的 `require` 提供；本插件不 import 其它产品包，所以产物里只有自己的代码。

## 状态

**已在本机验证**：

- GitHub 直装全流程——下载 tarball → 解压 → 写进 profile 的 `dependencies` → 回写 `dsh.profile.bundles`；**4.6 秒，零安装期脚本**；
- `--dump-config` 里出现 `# == dsh-session-map` 层；
- 首页 HTML 的 boot manifest 列出了 `dsh-session-map/client.js`，合并后的插件包请求返回 200 且含 `__ModuleLoader__` 工厂交接；
- 产物文件名与 package.json 的声明一致，React 保持外部化（`lib/client.js` 里是 `require("react")`，没有内联）。

**ACP 会话行的验证**（隔离 `DSH_HOME`，见[加载链路验证](#加载链路验证)）：

- `--dump-config` 里 `session-map` 与 `acp-agent` 两行齐全，后者默认开着、`agents: []`；设置页写进去的 `agents` 会作为 profile 覆盖出现在同一份 dump 里；
- 配置写坏时那一行仍然加载（schema 负责类型，`apply` 负责语义并记日志），日志里给出一行带 `dsh-session-map/acp-agent` 前缀的原因；
- `pnpm test`：26 通过、1 跳过（POSIX 专属），覆盖命令解析、cwd 校验、逐 agent 的配置校验，以及设置页模型（草稿往返、校验、供应商预设、命名去重、schema 识别）——见[测试](#测试)；
- **命令解析这条链在本机实测过两种 vendor**：`cursor-agent` 走已知启动器表；`opencode` 走 npm `.cmd` shim 声明的真实二进制，`initialize` / `session/new` / `session/set_config_option`（换模型生效）全部送达。换 vendor 不成功时也没有变成一次泄漏或一次挂死：远端自己的拒绝变成 `stop: error` 与一行固定诊断，原始 payload 只留在子进程的 stderr。

**ACP 会话（P0–P6）的验证**：每一阶段都要有可复现的证据，而不是「看起来能用」——

- **路由**：脚本化 adapter 证明 DSH 的循环能被外部驱动（P0）；真实 `cursor-agent` 会话建了文件、回了话，工具卡片带远端 diff（P1）；
- **预设卡片**：新会话选中卡片后 `agent/request` 瀑布被 `{prepend:true}` 拦下，provider/model 被钉住、`reasoningEffort` 被丢掉——用**真实构建产物**跑的三层瀑布探针，不是读代码推断的（P2）；
- **停止**：空队列上的等待在 **51ms** 内返回 `aborted`（改动前会一直挂到远端又发了别的东西才结束）；镜像工具同样接受取消；每轮开始重置信号队列（P3）；
- **utility 委派**：当时把 `utilityProvider` 指向一个脚本化 adapter（P0 那个，现已删除），会话标题由委派路由产出（`source.kind: 'provider'`，标题正是那个 adapter 的固定输出），不配则保留 Host 自己的兜底（`source.kind: 'fallback'`）（P3）；
- **审批**：三次差分（`ask`+`reject`、`ask`+`allow`、`policy` 控制组）证明请求确实到了 Host 审批服务——会话日志里成对的 `approval/asked` / `approval/decided`，内容正是我们传的 `toolName: acp_execute` 与 `reason: Run a command`——且不可路由时回落到行策略而不是凭空授权；浏览器里点出的三次决定（允许/拒绝/允许）让远端 agent 依次收到 `opt-once` / `opt-no` / `opt-once`（P4）；
- **工具视图**：REA 驱动无头 Chromium 跑真实应用，工具行渲染为 `读取 ignored +`，而不是 `工具调用 · acp_read · session-…::mock#1`（P5）；
- **文件系统桥接**：同一个脚本化 agent、同一个 profile，只换部署沙箱模式——`workspace-write` 下读回真实内容、写真的落盘；`read-only` 下读仍然成功，写被后端以 `file access denied under read-only mode` 拒绝且文件不存在（P6）。

**一个包同时是 bundle 和 client 插件是可行的**：产品随附的布局把两者拆成不同的包（bundle 的 patch 行去引用 `packages/client/*` 里的插件包），但自引用同样能被浏览器 roster 接受。第二个 host 入口用**子路径 specifier**，对客户端发现不可见，因此两个入口不会在同一张模块表里撞车。

**已完成**：仓库结构、`dsh.bundle` 层、`dsh.client` 声明、宿主半侧、构建约定、全部画布与交互，以及 **ACP 会话路由**：预设卡片选中一个 agent、思考/正文/工具卡片/审批卡片/停止按钮都进 DSH 的原生 UI，远端文件访问走 Host 文件系统与沙箱。这一行默认开着、agent 列表默认为空——加 agent 的地方是 Settings → **ACP**（P8，见 [docs/p8-acp-settings-page.md](docs/p8-acp-settings-page.md)），或直接写 profile patch。

## 宿主契约（升版必读）

浏览器半读的是**运行时快照**，产品不承诺它们稳定。已经踩到过两次，都表现为「样式坏了」但其实是契约漂移：

| 读的东西 | 现在怎么读 | 漂移前 |
|---|---|---|
| 当前会话 | Session 列表快照里 `retainedBy.mainView > 0` 的那一行（`mainSessionId`），退而用座位上自己的 `sessionId` | 快照曾直接给 `current` |
| 排队条数 | `pendingSubmissions`（0.1.7 的名字） | 曾叫 `queue` |
| 插件配置读写 | `ctx.configForms.get(entryId)`（`getSnapshot` / `subscribe` / `set`）与它背后的 `settings.describe` 镜像；`describe()` 的 `view.namespaces[].ns` / `.schema` 用来找自己的命名空间 | settings 服务与 `configForms` 都是 0.1.7 起才有的面 |
| 设置页座位 | `settings.section`（list，root 作用域，owner props 只有 `{ close }`；注册项 `id` / `order` / `label`） | 无 |

判断「当前会话」时不要发明新口径：产品自己的每个包都按 `retainedBy.mainView` 推导（标题栏、open-in-app、agent-preset 皆然）。快照里还没有 `current` 时，旧写法只会拿到 `undefined`，而 `undefined` 不会报错——画布只是安静地退回「整张全局图」，也没有任何卡片亮起当前会话的描边。

同一次审计过了其余接口：`useSessions` 的 `ids` / `byId` / `phase`、`useWorkspaces` 的 `items`、投影键 `title` / `sessionStats` / `turnOutline`、以及会话快照的 `running` / `hasMore` 都还在。

## 贡献了什么

| 座位 | 内容 |
|---|---|
| `conversation.view` | 「概览」标签页（order 20）、「会话图谱」标签页（order 30）—— **默认关闭**，见下 |
| `conversation.session.header.utilities` | 会话头部的「会话图谱」开关（order 40）；右侧栏已打开时再点一次关闭 |
| `sidebar.right.pane.tab` | 常驻标签页 `dsh-session-map.overview` 与 `dsh-session-map.map` |
| `tool.call.toolview`（Client，keyed） | 每个 `acp_*` 工具名一条视图：状态点、类型、远端标题、文件路径、可展开的输入与输出 |
| `settings.section`（Client） | Settings → **ACP** 一页（order 25）：agent 卡片、供应商预设、行级说明；读写的是 `acp-agent` 那一行的 `agents`，写进当前 profile 的 `cordis.patch.yml` |
| `ctx.llm`（Host） | 一个 `acp` adapter：每个 agent 一个模型，只负责把远端更新流成 DSH 的 chunk 协议 |
| `ctx.tools`（Host） | 每个 ACP 工具类型一个镜像工具（`acp_read` / `acp_edit` / …），执行它们等于等远端那条调用的结果 |
| `ctx.agentPresets`（Host） | 每个 agent 一张预设卡片；卡片挂一个只做一件事的子插件——把这条会话的路由钉死 |

画布交互：滚轮上下平移、Shift + 滚轮左右平移、Ctrl / ⌘ + 滚轮缩放、拖动空白平移（不会选中文字）、点击会话节点弹出操作菜单（跳转到会话 / 在画布中居中）、点击链首胶囊展开或收起该线的用户输入、点击输入珠子弹出该轮操作、fork 继承的输入前缀折叠成 `+N 继承` 胶囊。工具栏的键盘图标后面收着这份快捷键表。

### 对话标签栏的两个标签页默认关闭

「概览」和「会话图谱」这两个 `conversation.view` 入口由**浏览器本地偏好**控制，默认不注册。头部开关和右侧栏的两个标签页不受影响，图谱仍然可以从右侧栏正常使用。

在页面控制台里改，**刷新后生效**（不需要重新构建或重启）：

```js
localStorage.setItem('dsh.session-map.conversationViews', 'true')   // 打开
localStorage.setItem('dsh.session-map.conversationViews', 'false')  // 显式关闭
localStorage.removeItem('dsh.session-map.conversationViews')        // 恢复出厂默认
```

出厂默认写在 `src/client/index.ts` 的 `DEFAULT_CONVERSATION_VIEWS`。

**为什么不用 profile 里的 `config`**：浏览器半侧由 web boot 用**裸 `{ name }`** 创建（`packages/client/web/src/boot-client.ts:50`），而 boot manifest 的插件行只带 `id` / `inject` / `immediately`——宿主行的 `config` 到不了客户端插件。给这个包写 `config` 不会有任何效果。

## 源码结构

```
src/index.ts                宿主半侧（空实现，只为占据 bundle 行）
src/acp-core/config.ts      agent 列表的 schema 与解析（`agents` 是唯一的 volatile 字段）+ 每个 agent 的校验
src/acp-core/resolve.ts     命令解析顺序：已知启动器表 → shim 声明的目标 → 命令解释器；以及 cwd 校验
src/acp-core/client.ts      ACP 客户端里与路由无关的部分：权限应答、扩展方法表、进程回收阶梯
src/acp-core/contract.ts    对 ctx.subprocess 的最小结构化类型 + 出处
src/acp-agent/index.ts      Host：注册 acp adapter、镜像工具，并为每个 agent 注册一张预设卡片（重同步先释放上一代）
src/acp-agent/adapter.ts    adapter 本体：按 (会话 × agent) 复用通道、把远端更新映射成 chunk、在工具调用处切断流、utility 委派
src/acp-agent/channel.ts    一条 ACP 连接：握手、会话、prompt、通知折叠、工具调用记录、权限应答、文件系统桥接、取消与回收
src/acp-agent/tools.ts      镜像工具定义：参数、输出、`presentCall` 渲染意图，以及等待远端结果或取消
src/acp-agent/presets.ts    预设卡片：id 推导、顺序、子插件 specifier
src/acp-agent/config.ts     本行的 Config（agent 列表 + approval / fs / idleDisposeMs / utility 路由）
src/acp-agent/contract.ts   对 ctx.llm / ctx.tools / ctx.agentPresets / ctx.fs / ctx.sandboxPolicy 的最小结构化类型 + 出处
src/acp-preset/index.ts     预设子插件：一条 `agent/request` 拦截，把 provider/model 钉死并丢掉继承来的 reasoningEffort
src/client/acp-model.ts      设置页的纯模型：草稿形状、写回转换、校验、列表编辑、供应商表、按 schema 形状识别自己的命名空间
src/client/acp-card.ts       Settings → ACP 那一页（createElement 自绘，只依赖 ctx.configForms 的结构化类型）
src/client/acp-tool-row.ts  镜像调用的那行工具视图（createElement 自绘，claim 十个 `acp_*` key）
src/client/index.ts         apply：样式表、插件级开关、座位、标签页与工具视图注册
src/client/views.ts         概览页、头部按钮、画布视图工厂
src/client/graph.ts         布局：fork 树、珠子、折叠标记、连边
src/client/css.ts           样式表字符串
src/client/constants.ts     几何常量与 tab type id
src/client/flags.ts         跨挂载存活的插件级开关
src/client/format.ts        数字与耗时格式化
test/                       node --test 套件与脚本化 ACP agent（探针用）
```

样式表以字符串形式随包分发，由 `apply` 里的一个 effect 建 `<style>` 元素并负责移除。产品的 `styles` 服务只存在于动态运行时，正式插件没有它。

**改完源码务必 `pnpm build` 再提交**——`lib/` 是仓库内容的一部分，安装方不会替你构建。
