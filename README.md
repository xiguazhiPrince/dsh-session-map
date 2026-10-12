# dsh-session-map

把所有会话的 fork 关系画成一张可平移缩放的画布，作为一个标签页加进 DSH 的 Web 界面。

这个包还带一个**可选的宿主组件**：把 DSH 的子代理委派给**任何支持 ACP 的命令行 agent**（本机实测过 `cursor-agent acp` 与 `opencode acp`）。一份 agent 列表放在一行里，每个 agent 的 `command` / `args` / `env` / `mode` / `configOptions` / `permission` 都能单独配。默认关闭，见 [ACP 子代理（任意 ACP agent）](#acp-子代理任意-acp-agent)。

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

## ACP 子代理（任意 ACP agent）

宿主半侧把任务委派给**任何支持 ACP 的命令行 agent**：每次委派都 spawn 一个全新的进程，在委派会话的工作目录里建一个 ACP 会话，把任务发过去，等它收尾，返回最后的 assistant 文本。agent 的会话、模型、工具是它自己的一套，父会话只出任务和目录。

**配置在设置页面里，不用改配置文件。** 一行 `dsh-session-map/acp` 承载整份配置——一个 `agents` 列表——后端为每个启用的 agent 派生出一个 `ctx.subagents` provider **和一个委派工具行**。所以加一个 agent 就是在卡片上点「添加 agent」：

```
设置 → ACP 子代理 → 添加 agent
  名称     cursor                      # 注册名，也是工具名的来源
  命令     cursor-agent                # CLI 名字或可执行文件路径
  参数     acp
  权限     allow / reject
  工具名   （留空则 subagent_cursor）
```

保存即生效——不用重启，也不用碰 YAML。想同时挂 Cursor 和 opencode，就加两条。

| 字段（每个 agent） | 默认 | 含义 |
|---|---|---|
| `name` | **必填** | `ctx.subagents` 上的注册名，同一行内必须唯一；也是默认工具名的来源 |
| `command` | **必填** | 要跑的 CLI 名字（在 PATH 上）或可执行文件绝对路径；Windows 上的解析顺序见下 |
| `args` | `['acp']` | 传给它的参数 |
| `toolName` | `subagent_<name>` | 模型侧看到的委派工具名 |
| `cwd` | 委派会话的 cwd | 子进程与 ACP 会话的工作目录；相对路径按 Harness 启动目录解析一次 |
| `mode` | 不设置 | agent 声明过的任意模式 id。**不设置就不切模式**，让 agent 用它自己的默认 |
| `configOptions` | 不设置 | `session/new` 之后按 id 应用的会话选项（常见是 `model`）。**被 agent 拒绝就整次委派失败**——静默换一个模型比直接报错更糟 |
| `permission` | `allow` | `allow` 选第一个 `allow_once`（没有则 `allow_always`）；`reject` 一律拒绝。见下面的安全说明 |
| `env` | `{}` | 叠加在进程 seam 的凭据清洗之后，例如某个 CLI 自己的 API key |
| `enabled` | `true` | 关掉即不注册 provider、也不挂工具行（草稿仍留在配置里） |

这一行整体可配 `disposeEofGraceMs`（`6000`）/ `disposeGraceMs`（`3000`）：stdin EOF 后留给子进程自行收尾的宽限，以及观察失败、逐级升级终止的宽限。

### 工具行为什么是派生的

provider 只是个注册表项，**模型够不到它**：每个 agent 必须再有一行 `@deepseek-ai/dsh-tool-subagent` 指过去（这正是 Claude Code / Codex 后端的接法）。而平台的插件管理面只能装卸包、改 `disabled`，**写不了一行的 `name` 和 `config`**——所以设置卡片永远没法自己长出工具行。

本组件的做法是让后端**自己挂**：每次激活按 agent 列表创建对应的工具行，agent 没了就移除（[src/acp/mount.ts](src/acp/mount.ts)）。它们是运行时派生出来的，不是 profile 内容——只存在于运行时，**不会写进你的 patch**，重启后按配置重建。产品自带的那个委派工具原样复用，这里没有重新实现任何面向模型的约定。

### 本机实测过的 agent

| `command` | 落到的真实入口（Windows） | 结果 |
|---|---|---|
| `cursor-agent` | `%LOCALAPPDATA%\cursor-agent\versions\<最新>\node.exe index.js` | 完整跑通 |
| `opencode` | `%APPDATA%\npm\opencode.cmd` 声明的 `…\node_modules\opencode-ai\bin\opencode.exe` | 握手/建会话/改模型/发任务全通；`session/prompt` 被 opencode 自己拒了（1.17.15 < 免费档要求的 1.18.0） |

### 打开

这一行默认关闭（见 `cordis.patch.yml`）：装这个包只为画布的人不应该莫名多出一个能在工作目录里改文件的后端。不打开时那行根本不会被加载，agent 相关代码一行都不执行，设置页面里也不会出现「ACP 子代理」。

打开它**也不需要改配置文件**：设置 → 插件 里把这一行从禁用改成启用（插件管理页写的正是 profile patch），重启该 profile 后「ACP 子代理」这一页就出现了，接着在卡片里加 agent。

`dsh --profile <name> --dump-config` 应该能看到这一行；派生的工具行**不会**出现在里面，那是对的——它们不是 profile 内容。

模型侧看到的是 `subagent_cursor`（换 `toolName` 就换名字）；后台调用返回 job id，交给通用的 `job_output` / `job_kill` 处理。

### 配置怎么存

配置就是那一行的 `config`，设置卡片写进去的也是它。表格里的字段在 YAML 里长这样，两种写法等价——卡片只是把同样的值写进 profile patch：

```yaml
- id: subagent-acp
  disabled: false
  config:
    agents:
      - name: cursor
        command: cursor-agent
        permission: allow
```

`agents` 是这份 schema 里**唯一**标了 `.volatile()` 的字段，卡片能改它就是因为这一点：设置服务只把 volatile 字段做成可编辑项，而 volatile 写入会被 Loader 原地提交进运行中的引用，并发出 `loader/volatile-update`——后端据此**重新同步** provider 与工具行，不需要重挂插件。

类型错误、缺失的 `name` / `command`、以及重名的 agent 都会在**加载期或写入时**报错：写入被设置服务按 schema 拒掉，卡片会当场把问题标在对应那一项上；加载期则在 Host 日志里给出一行带 `dsh-session-map/acp` 前缀的原因。配置整体不可用时（比如 `cwd` 指不到），运行中的 agent **保持不动**，不会因为一次手滑把正在用的委派路径拆掉。

### 安全说明（`permission`）

`permission: allow` 意味着 **agent 自己的工具在无人审批下运行**——它能在子进程的工作目录里改文件、跑命令，而 **DSH 自己的审批策略与沙箱管不到它**。这一点与 Codex / Claude Code 后端一致（它们各自保留自己的权限系统），但代价必须讲明白。

只读用法：`mode: plan`（或该 agent 的只读模式）+ `permission: reject`。

没有登录时**不会**自动替你登录：ACP 的 `authenticate` 可能是交互式的，驱动不会去调用它。先在终端把那个 CLI 登录好，或者把它的 key 放进 `env`（卡片里的「环境变量」）。失败时 Host 日志里有带本包前缀的原始错误。

### 命令解析（Windows 上是关键）

进程 seam **从不做 shell 解释**（`argv[0]` 就是程序），而且不提供 `windowsVerbatimArguments` 这类变通参数，所以 Windows 上的 `.cmd` / `.bat` 必须找到真实入口。顺序如下，命中即止：

1. **已知启动器表**（`src/acp/resolve.ts` 的 `knownLaunchers`）：`cursor-agent` / `agent` → 版本目录里的 `node.exe index.js`。这张表只是为了少绕一步，删掉也不影响正确性，只是会退到第 3 步（多一层 PowerShell 跳转）；
2. **shim 自己声明的目标**：读 `.cmd` 里的 `"%dp0%\<相对路径>"`（npm / pnpm / yarn 的 `cmd-shim` 模板）。目标是二进制就直接 spawn；带 `%_prog%` 或 `.js` 结尾就在前面加 `node.exe`。安装路径含空格也没问题——这正是不走命令解释器的理由；
3. **命令解释器兜底**：没有可解析目标时用 `cmd.exe /d /s /c "<命令行>"`（Node 自己 `shell: true` 的形状）。这条路没法保证普遍安全——seam 不提供 verbatim 参数，含空格或引号的 token 会被 Node 二次转义后交给 `cmd.exe`——所以**只有命令行里没有空格/引号时才会走**，否则直接报错并给出配置指引。

`command` 是绝对路径或含 `/`、`\` 时不查 PATH；裸名字按 `.exe` 优先、`.cmd`/`.bat` 次之的顺序扫 PATH（没有任何扩展名的文件直接跳过——Windows 起不来这样的程序）。

每次委派都重新解析（自更新的 CLI 会多出新的版本目录），代价是一次目录列举加一次 PATH 扫描。

### 行为边界

- **只回最终答案**：思考、工具活动、plan、todo、命令列表都在子进程那侧，不进父会话。
- **一次性**：每次委派一个新进程、新会话；不支持续接、`session/load`、跨进程恢复。
- **不声明客户端能力**：`clientCapabilities: {}`——不提供 `fs/*` 与 `terminal/*`，让 agent 自己在子进程里处理。这不只是保守：声明一个没有真正实现的能力会让 agent 读到空文件；实测 Cursor 在拿不到这些能力时照样能把文件写下去。
- **未知扩展方法**：ACP 之外的阻塞请求（已知的是 Cursor 的 `cursor/ask_question`、`cursor/create_plan`）被确定性回绝（空对象）并记入诊断，不会把一次运行挂死；`cursor/update_todos`、`cursor/task`、`cursor/generate_image` 是通知，注册为空处理。表在 `src/acp/run.ts`，换 agent 出新扩展方法时往那里加。
- **MCP 不桥接**：`session/new` 的 `mcpServers` 传空数组，agent 用自己的配置（Cursor 读 `.cursor/mcp.json`）。
- **安全诊断**：失败只记一行固定事实 `ACP failure (provider: <名>; stage: …; category: …)`，不含 stderr、异常文本、任务内容、路径、环境值或协议 payload；≤4096 字节。同时配了多个 agent 时，`provider:` 就是用来区分是谁失败的。


## 本地开发

```sh
pnpm install
pnpm build        # 产出 lib/index.js、lib/acp.js、lib/acp-model.js 与 lib/client.js
pnpm typecheck    # tsc --noEmit
pnpm test         # node --test，驱动 lib/ 产物 + 一个脚本化的 ACP agent
```

`tsdown.config.ts` 不做类型检查、也不用 project references，所以构建是自包含的，类型检查是独立的一步。

**提交前务必 `pnpm build`**：`lib/` 是仓库内容的一部分，安装方不会替你构建。

### 测试

`pnpm test` 不需要任何真 agent、不需要登录、不联网：

- `test/acp.test.mjs` 通过插件的公开面（`apply(ctx, config)` → `provider.start(request)`）驱动 **构建产物**，配一个 stub Host ctx 与真实子进程（`test/mock-acp-agent.mjs`，一个脚本化的 ACP agent）。覆盖握手参数、prompt 映射与折叠、四态权限应答、阻塞扩展方法不挂死、模式切换与「agent 没声明该模式」、会话选项的下发与拒绝、`stopReason` 映射、取消、幂等释放、失败时子进程真被回收、诊断里不出现测试埋的哨兵路径与密文、stdout 混入非 JSON 帧时不破坏会话，以及 `agents` 列表这一层：两个 agent 各自独立、**改动列表后自动重同步**（旧 provider 与旧工具行一起撤掉）、列表非法时运行中的 agent 保持不动、`enabled: false` 什么都不挂、工具行挂载失败不会殃及 provider。
- `test/acp-card.test.mjs` 驱动设置卡片那份纯逻辑：草稿↔配置往返、写入时丢掉空值与默认值、校验规则与后端一致、`KEY=VALUE` 与带引号参数的解析、列表编辑的边界，以及**用真实的构建产物 schema 验证卡片怎么认出自己那个命名空间**（行被改过 id 也认得出来）。
- `test/command.test.mjs` 用记录型 spawn stub 断言解析顺序（已知启动器取最新且跳过不完整版本、npm shim 声明的二进制直连、声明了 `%_prog%` 的脚本前面加 node、`.cmd` 走命令解释器、PATH 上找不到时给配置指引）与逐 agent 的加载期校验；其中一条会**真的**起一个 `.cmd` 转发器，跑完一整段 ACP 会话。

另有一个人工实机冒烟，**不在** `pnpm test` 里（要装好并登录目标 CLI，会花真实额度）：

```sh
node test/live-acp.mjs "reply with exactly: pong"                       # 默认 cursor-agent
node test/live-acp.mjs --command opencode "reply with exactly: pong"    # 换一个 agent
node test/live-acp.mjs --edit                                           # 让它建一个文件并核对内容
node test/live-acp.mjs --command opencode --config-option model=opencode-go/deepseek-v4-flash "say hi"
```

`--edit` 探针就是为「不声明客户端能力」这个选择准备的：如果 agent 在拿不到客户端提供的 `fs` 能力时写不了文件，这个探针会失败，那时才需要真正实现 `fs/read_text_file` 与 `fs/write_text_file`。**2026-10-12 实测通过**——Cursor 自己写了文件，所以驱动继续不声明任何客户端能力。

### 加载链路验证

用一个隔离的 `DSH_HOME`，不碰真实 profile：

```sh
$env:DSH_HOME = "$PWD\.dsh-dev"
dsh plugin --profile dev add "$PWD"
dsh --profile dev --dump-config      # 应看到 # == dsh-session-map 层与两行
```

`.dsh-dev/` 已 gitignore。实测结论：`--dump-config` 里出现的正是 `session-map` 与 `subagent-acp`（`dsh-session-map/acp`）；profile 侧的裸覆盖能把 `disabled` 改回 `false` 且保住 `name`；把配置写坏时启动会给出带行名与 specifier 的警告（说明 Loader 确实 import 了这个入口并把原始 config 交给了 `apply`）；配置正确时启动**没有** "entry did not activate" 警告。

**派生的工具行是专门验过的**，不是靠"没报错"推断的：把 `TOOL_PLUGIN_NAME` 暂时改成一个不存在的包名并重启，启动立刻给出

```
dsh: warning: 1 entry did not activate
6dc33ab5 (@deepseek-ai/dsh-tool-subagent-DOES-NOT-EXIST): failed to import
```

也就是说：这条路径确实跑到了，且一个挂不上的派生行会**明确报出来**；换回真名后同样的启动是安静的，所以那次安静就说明它挂上了。派生的行也不会写进 profile——`--dump-config` 里从来只有我们自己那两行。

## 四个产物

| 产物 | 形态 | 谁用 |
|---|---|---|
| `lib/index.js` | ESM | 宿主 Loader 按包名 import（画布那一行） |
| `lib/acp.js` | ESM | 宿主 Loader 按子路径 `dsh-session-map/acp` import（ACP 那一行） |
| `lib/acp-model.js` | ESM | 设置卡片那份纯逻辑（草稿转换、校验、列表编辑、认出自己的命名空间）；也打进浏览器半侧，这份只是为了让它在 Node 里可测 |
| `lib/client.js` | CJS closure factory | 浏览器内核通过 module table 取用 |

**为什么 ACP 那行用子路径 specifier。** 浏览器客户端发现只认**裸包名**（`exactPackageSpecifier` 对含 `/` 的 specifier 返回 `undefined`，见 `packages/client/modules/src/index.ts`），所以同一个包的第二个入口对客户端模块表**不可见**——不会重复注册、也不会触发「同一包有多个活跃 Loader 来源」的组合错误。先例是 `@deepseek-ai/dsh-tool-subagent-control/list-agents`；这也是同一个入口能被多行同时挂载的原因。

宿主半侧同样不 import 任何产品包：`ctx` 注入的对象 + 本地结构化类型就够（`src/acp/contract.ts` 记了出处）。`@agentclientprotocol/sdk@1.4.0`、`zod` 与 `@deepseek-ai/schemastery@3.18.4` 只是 **devDependency**，由 tsdown 内联进产物——所以安装期依然不跑任何脚本、也不装任何运行时依赖（代价是 `lib/acp.js` 约 380 KB，含 SDK 与 zod）。

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

**ACP 组件的验证**（隔离 `DSH_HOME`，见[加载链路验证](#加载链路验证)）：

- `--dump-config` 里两行齐全，ACP 那行 `disabled: true`；profile 侧裸覆盖能改成 `false` 且保住 `name`；配置正确时启动没有 "entry did not activate" 警告；
- 从 profile 的 `node_modules` 解析 `dsh-session-map/acp` 成功，导出是 `apply` / `inject` / `name` / `Config`（**没有 default**——`export default` 会让 Loader 折叠模块并丢掉 `inject`）；
- 配置写坏时那一行仍然加载（schema 负责类型，`apply` 负责语义并记日志），日志里给出一行带 `dsh-session-map/acp` 前缀的原因；
- **派生的工具行**：把包名临时改成不存在的名字，启动立刻报 `failed to import` 的 "did not activate" 警告；改回真名后同样的启动是安静的——路径确实跑到了，且失败会明确报出来（详见[加载链路验证](#加载链路验证)）；
- `pnpm test`：46 通过、1 跳过（POSIX 专属），覆盖真实子进程的完整运行、取消与释放、经 `.cmd` 解释器的一整段会话、两个 agent 的独立性与**自动重同步**，以及卡片那份纯逻辑（含用真实构建产物 schema 验证命名空间的识别）；
- **实机 Cursor**（`cursor-agent` 已登录，2026-10-12）：文本探针 `stop: completed`、输出 `pong`、释放后子进程退出；`--edit` 探针 **PASSED**——Cursor 在 `clientCapabilities: {}`（不提供 `fs/*`、`terminal/*`）的情况下自己把文件写下去了。所以**不需要**实现客户端文件系统能力；
- **实机 opencode**（同一个组件、换 `command`，2026-10-12）：npm `.cmd` shim 被解析到真实二进制 → `initialize` / `session/new` / `session/set_config_option`（换模型生效）/ `session/prompt` 全部送达；最后一步被 **opencode 自己**拒了（`1.17.15 < 免费档要求的 1.18.0`；换成 Go 模型后又是区域隐私设置）。驱动侧的表现正合预期：`stop: error`、诊断 `ACP failure (provider: live; stage: prompt; category: protocol)`、原始 payload 只留在子进程的 stderr、子进程安静地退出了。**换 vendor 不成功也没变成一次泄漏或一次挂死**，这比一次成功更能说明通用性。

**设置卡片已经在真实应用里走完整圈**（2026-10-12，桌面 profile）：卡片渲染出「ACP 代理」这一页 → 添加一个 agent → 保存 → profile patch 里真的出现了那条 agent → 模型侧出现 `subagent_cursor` → 一次真实委派返回 `pong`，子进程回收干净（事后按命令行复查，没有带 `acp` 的残留进程）。这也是派生的工具行第一次在真实部署里被走通。

落盘的 YAML 本身就是卡片写的指纹：`args` 和 `permission` 都不见了，因为两者都在默认值上，而卡片只写真正设过的字段——手写的一般会留着 `args: [acp]`、`permission: allow`。默认值由 schema 补齐，读起来仍然完整：

```yaml
- id: subagent-acp
  disabled: false
  config:
    agents:
      - name: cursor
        command: cursor-agent
```

**一个包同时是 bundle 和 client 插件是可行的**：产品随附的布局把两者拆成不同的包（bundle 的 patch 行去引用 `packages/client/*` 里的插件包），但自引用同样能被浏览器 roster 接受。第二个 host 入口用**子路径 specifier**，对客户端发现不可见，因此两个入口不会在同一张模块表里撞车。

**已完成**：仓库结构、`dsh.bundle` 层、`dsh.client` 声明、宿主半侧、构建约定、全部画布与交互，以及 ACP 子代理后端——厂商中立、一份 agent 列表、派生的委派工具、默认关闭，并带一张设置卡片。

## 宿主契约（升版必读）

浏览器半读的是**运行时快照**，产品不承诺它们稳定。已经踩到过两次，都表现为「样式坏了」但其实是契约漂移：

| 读的东西 | 现在怎么读 | 漂移前 |
|---|---|---|
| 当前会话 | Session 列表快照里 `retainedBy.mainView > 0` 的那一行（`mainSessionId`），退而用座位上自己的 `sessionId` | 快照曾直接给 `current` |
| 排队条数 | `pendingSubmissions`（0.1.7 的名字） | 曾叫 `queue` |

判断「当前会话」时不要发明新口径：产品自己的每个包都按 `retainedBy.mainView` 推导（标题栏、open-in-app、agent-preset 皆然）。快照里还没有 `current` 时，旧写法只会拿到 `undefined`，而 `undefined` 不会报错——画布只是安静地退回「整张全局图」，也没有任何卡片亮起当前会话的描边。

同一次审计过了其余接口：`useSessions` 的 `ids` / `byId` / `phase`、`useWorkspaces` 的 `items`、投影键 `title` / `sessionStats` / `turnOutline`、以及会话快照的 `running` / `hasMore` 都还在。

## 贡献了什么

| 座位 | 内容 |
|---|---|
| `conversation.view` | 「概览」标签页（order 20）、「会话图谱」标签页（order 30）—— **默认关闭**，见下 |
| `conversation.session.header.utilities` | 会话头部的「会话图谱」开关（order 40）；右侧栏已打开时再点一次关闭 |
| `sidebar.right.pane.tab` | 常驻标签页 `dsh-session-map.overview` 与 `dsh-session-map.map` |
| `settings.section`（Client） | 「ACP 子代理」设置页（order 45）：配置 agent 的卡片；只在 Host 真的服务了本组件的命名空间时才注册 |
| `ctx.subagents`（Host） | 每个启用的 agent 一个 ACP provider；**默认关闭**，见 [ACP 子代理（任意 ACP agent）](#acp-子代理任意-acp-agent) |
| `loader`（Host） | 按 agent 列表挂载/卸载派生的 `@deepseek-ai/dsh-tool-subagent` 行（运行时派生，不写进 profile） |

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
src/acp/index.ts            Host：按 agent 列表注册 provider、挂载工具行，并在配置改变时自动重同步
src/acp/config.ts           schemastery Config（`agents` 是唯一的 volatile 字段）+ 每个 agent 的解析与校验
src/acp/mount.ts            派生工具行：挂载/卸载，以及为什么必须这么做
src/acp/run.ts              ACP 客户端：spawn、握手、prompt、update 折叠、权限、扩展方法、模式与会话选项、取消、清理
src/acp/resolve.ts          启动顺序：已知启动器表 → shim 声明的目标 → 命令解释器；以及 cwd 校验
src/acp/settle.ts           结果结算、运行句柄、文本折叠（与 Host seam 同义，注明出处）
src/acp/contract.ts         对 ctx.subagents / ctx.subprocess / ctx.loader 的最小结构化类型 + 出处
src/client/acp-model.ts     卡片那份纯逻辑：草稿↔配置、校验、列表编辑、按 schema 认出命名空间
src/client/acp-card.ts      卡片本体（createElement，不引产品包），只负责渲染与调用上面那份逻辑
src/client/index.ts         apply：样式表、插件级开关、座位与标签页注册、设置页注册
src/client/views.ts         概览页、头部按钮、画布视图工厂
src/client/graph.ts         布局：fork 树、珠子、折叠标记、连边
src/client/css.ts           样式表字符串（含卡片的样式）
src/client/constants.ts     几何常量与 tab type id
src/client/flags.ts         跨挂载存活的插件级开关
src/client/format.ts        数字与耗时格式化
test/                       node --test 套件、脚本化 ACP agent、实机冒烟脚本
```

样式表以字符串形式随包分发，由 `apply` 里的一个 effect 建 `<style>` 元素并负责移除。产品的 `styles` 服务只存在于动态运行时，正式插件没有它。

**改完源码务必 `pnpm build` 再提交**——`lib/` 是仓库内容的一部分，安装方不会替你构建。
