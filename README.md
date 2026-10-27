# dsh-session-map

> A turn-tree canvas over every DSH session — nodes are users' turns, sessions are coloured lines and tags, and every fork leaves from the exact inherited turn — one conversation tab, one session-header toggle and two right-sidebar tabs. It opens on the current session's own tree, growing downward.

DSH 的会话会从某一轮 **fork** 出去，可左侧栏只是一张平铺列表：谁从谁分叉、手上这个会话在整张图里的位置，都得自己回忆。这个插件把**用户轮次**画成树——每一轮用户输入是一个节点，会话退成一条颜色和一枚会话标题标签——于是「从哪一句话分出去的」一眼可见；同一段被继承的历史只画一次，不再折成 `+N 继承` 胶囊。

默认只画**当前会话所在的那棵树**，且**自上而下**生长；工具栏上两组开关各自一键切回「全部会话」与「横向」。

[![license](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)
[![GitHub stars](https://img.shields.io/github/stars/xiguazhiPrince/dsh-session-map?style=flat&label=stars)](https://github.com/xiguazhiPrince/dsh-session-map/stargazers)

![在 DSH 右侧栏里打开的会话图谱](docs/example.png)

## 亮点

| | |
|---|---|
| **当前会话的树** | 打开即定位：只铺开当前会话所在的那棵轮次树——父链、与它并列的兄弟分支、以及它们的后代；一键切回全图 |
| **竖向生长** | 默认自上而下：同一会话的下一轮在上一轮下方，父节点居中于自己的所有子节点——fork 头在两侧展开，自己的下一轮夹在中间；会话颜色贯穿自己的轮次；一键切回横向 |
| **轮次节点** | 每个用户轮次是一个节点；当前会话及祖先路径的 steering 输入也会作为后续节点出现。轮次号、提示预览、分叉数；共享的继承前缀只画一次；0 条自有输入的会话显示为会话头 chip；长直链折叠成 `+N 条输入` |
| **画布手感** | 滚轮平移、Shift + 滚轮横向平移、Ctrl / ⌘ + 滚轮缩放、拖空白平移（不会选中文字），外加适应窗口 / 定位当前 / 100% |
| **一屏概览** | 另有一个「会话概览」标签页：轮次、步骤、模型耗时、工具耗时、输出 token、运行状态 |
| **三个入口** | 对话标签页、会话头部开关、右侧栏常驻标签页——哪里顺手用哪里（对话标签页默认关闭，见[使用](#对话标签栏的两个标签页默认关闭)） |
| **从 Git 克隆** | Settings 里的独立页面：填仓库地址、选存放目录（记住上次选择）、按需打开浅克隆，点「克隆」自动 clone 并添加工作区 |
| **技能管理** | Settings 里的「技能」页：分「用户级」（`~/.dsh/skills`、`~/.agents/skills`）与「项目级」（每个工作区项目根目录下的 `.dsh/skills`、`.agents/skills`）两组列出全部已发现的技能，带来源、调用限制、`/名称` 与文件路径，可搜索、可刷新 |

![图谱细节：会话颜色、轮次节点、会话标签与当前会话高亮](docs/example-map.png)

## 安装

npm（`@xiguazhiprince/dsh-session-map`，预构建、无安装期脚本）：

```sh
# 装进 web profile —— 就是 `dsh web` 启动的那个
dsh plugin --profile web add @xiguazhiprince/dsh-session-map

# 换你自己的 profile 名即可，例如 tui
dsh plugin --profile <你的 profile> add @xiguazhiprince/dsh-session-map
```

也可以直接从 GitHub 安装（装到的就是 main）：

```sh
dsh plugin --profile web add github:xiguazhiPrince/dsh-session-map
```

profile 名要**已经存在**于 `$DSH_HOME/profiles` 下（`dsh --help` 里 `--profile` 那一段就是它）；想新建一个就先用模板派生：`dsh myweb --from-default-profile web` 会照 `web` 模板建出 `myweb` 并启动它。安装走的是 profile 自己的 pnpm，装完这个包会同时写进它的 `dependencies` 与 `dsh.profile.bundles`。

**npm 名是 scoped 的 `@xiguazhiprince/dsh-session-map`**：未 scoped 的 `dsh-session-map` 在 npm 上已被另一个作者的同类插件占用，与本仓库无关。

**预构建分发。** 仓库里直接提交了构建产物 `lib/`，并且没有 `prepare` 脚本，所以 pnpm 只下载 tarball 解压，**不执行任何安装期代码**——不需要 `allowBuilds` 放行，也没有构建等待。

代价是产物可能与源码不同步：**改了 `src/` 必须先 `pnpm build` 再提交**（见[本地开发](#本地开发)）。

另外建议**钉住 commit**。不钉的话，仓库之后任何一次 push 都会改变你安装的内容：

```sh
dsh plugin --profile web add github:xiguazhiPrince/dsh-session-map#<sha>
```

## 安装后验证

装完不会立刻生效：**profile 的 bundle 列表是启动时读的**，正在运行的实例不会加载新行。先确认补丁栈里有这一层——

```sh
dsh --profile web --dump-config    # profile 名换成你装的那个
```

```yaml
# == @xiguazhiprince/dsh-session-map
- id: session-map
  name: '@xiguazhiprince/dsh-session-map'
```

然后重启该 profile 的进程并刷新页面。这些位置应该出现：

| 位置 | 应该看到 |
|---|---|
| 会话标签栏 | 「概览」与「会话图谱」两个标签页 |
| 会话头部工具区 | 「会话图谱」开关；右侧栏正显示图谱时再点一次会关闭它 |
| 右侧栏标签 | `dsh-session-map.map`（标题「会话图谱」）和 `dsh-session-map.overview`（标题「会话概览」） |
| 图谱页本身 | 轮次树画布；默认只画当前会话的那棵树、且自上而下，工具栏的「当前会话树 / 全部会话」与「竖向 / 横向」两组开关可切回全图与原方向，旁边显示会话数、轮次数、树数与当前缩放百分比 |
| Settings → 技能 | 两组列表：用户级技能（来自 `~/.dsh/skills`、`~/.agents/skills`）与按项目根目录分组的项目级技能；含来源、调用限制、路径与搜索框 |
| Settings → 从 Git 克隆 | 仓库地址、存放目录、「选择…」、浅克隆开关与「克隆」按钮 |

两件容易被当成故障的事：

- **切换会话后图谱没了。** 视图选择和右侧栏布局都是**按会话各存一份**的状态，没打开过的会话回落到它自己的默认值。从画布「跳转到该会话」时右侧栏的图谱会跟随过去；对话标签栏的图谱不会——那个选择属于 `ui-conversation`，插件没有接口去改。
- **点右侧栏开关没反应。** 按钮旁边会出现红色错误文字——失败不再只写进 console。把内容贴出来即可。

## 使用

### 三个入口

| 座位 | 内容 |
|---|---|
| `conversation.view` | 「概览」标签页（order 20）、「会话图谱」标签页（order 30）—— **默认关闭**，见下 |
| `conversation.session.header.utilities` | 会话头部的「会话图谱」开关（order 40）；右侧栏已打开时再点一次关闭 |
| `sidebar.right.pane.tab` | 常驻标签页 `dsh-session-map.overview` 与 `dsh-session-map.map` |

### 工具栏

| 控件 | 作用 |
|---|---|
| 「当前会话树 / 全部会话」 | 画布范围：当前会话所在的那棵树，或者列表里的全部会话 |
| 「竖向 / 横向」 | 树的生长方向：自上而下，或者自左向右 |
| 「折叠长直链」 | 直链超过 8 条输入时折叠中间段（保留头 2 + 尾 1），显示 `+N 条输入`；点击画布上的胶囊展开，取消勾选则全部展开（默认开） |
| 「隐藏子代理会话」 | 过滤 `origin: subagent` 的会话（默认开） |
| − / + / 100% / 适应窗口 / 定位当前 | 缩放与取景 |
| 键盘图标 | 快捷键表 |

### 画布交互

- 滚轮上下平移，Shift + 滚轮左右平移，Ctrl / ⌘ + 滚轮缩放；
- 拖动空白平移（不会选中文字），点空白收起菜单；
- 点击轮次节点弹出操作菜单：**跳转到该会话** / **在画布中居中**（暂时只能定位到会话，不能定位到具体轮次）；
- 点击会话标签或会话头 chip 弹出会话操作菜单；
- 点击折叠直链上的 `+N 条输入` 展开该段；工具栏的「折叠长直链」控制是否自动折叠。展开后若要重新折叠，取消再勾选一次「折叠长直链」即可（会清空逐段展开状态）。

### 画布默认只画当前会话的会话树

图谱打开时只铺开**当前会话所在的那棵树**：从树根（`parentId` 链上仍被列表列出的最远祖先）到它的所有后代，含与当前会话并列的兄弟分支。同一棵树上「还有谁从同一轮分叉」正是读当前会话时的上下文，所以整棵树一起给。

工具栏上的「当前会话树 / 全部会话」两段开关切换这个范围。范围只改画什么，不动几何：同一棵树在两种范围下的坐标完全一致。列表里还没有当前会话（快照尚未落地那一行）时，画布不缩成空图，而是照旧铺开全部，并在工具栏说明原因。

默认值写在 `src/session-map/views.ts` 的 `DEFAULT_MAP_SCOPE`（`'current'`），由 `src/session-map/index.ts` 装进插件 run 的开关。和其它工具栏开关一样，它挂在插件 run 上，所以那是**每次页面加载**的默认值：刷新后回到「当前会话树」。

### 画布默认竖向生长

树自**上而下**长：同一会话的下一轮在上一轮下方，父节点居中于自己的所有子节点——fork 出来的会话头在两侧展开，父会话自己的下一轮夹在中间；没有 fork 的父子轮次保持一条直链。fork 边从被继承的最后一轮出发，而不是从父会话的链尾出发。横向模式是自左向右，轮次往右排。

两个方向共用同一套布局：深度轴与分栏轴互换，画什么、折叠与展开状态、以及同一个节点在两种方向下的相对关系都不变。

默认值写在 `src/session-map/views.ts` 的 `DEFAULT_MAP_DIRECTION`（`'vertical'`），同样由 `src/session-map/index.ts` 装进插件 run，所以也是**每次页面加载**的默认值。

### 轮次、会话与空会话

- **节点 = 一条用户输入**：轮次 prompt 来自 `projectionValues.turnOutline`；当前会话及其祖先路径的已加载事件窗口会把同一轮里的 steering 消息追加成后续节点。没有加载历史的会话仍只有每轮首条 prompt。轮次号是会话内的 turn 号，同点分叉的兄弟会话会显示相同的号（例如两个会话各自的第 3 轮），用会话标签和颜色区分。
- **会话 = 颜色 + 标签**：颜色按会话 id 稳定哈希取 8 色之一；标签只挂在该会话**第一条自有轮次**上，显示该会话的显示标题（过长时保留头尾），完整标题与本次画布序号在 tooltip/菜单里。当前会话的整条自有链强高亮，继承路径弱高亮。
- **共享前缀只画一次**：子会话的日志以父会话的事件开头，构建时按 `turn` + prompt/response 与父 outline 求最长公共前缀；匹配到的轮次复用祖先的节点，fork 后的第一条自有轮次挂在该前缀的最后一轮下。
- **0 条自有输入的会话**：没有轮次可以放标签，就在 fork 轮上挂一个会话头 chip（`尚无输入`）。chip 本身也是树节点，所以「空会话再 fork 出空会话」会形成 chip 链，不会丢层级。
- **长直链折叠**：一段没有分叉的纯直链超过 8 条输入时，默认保留头 2 + 尾 1，中间折成 `+N 条输入`；点击展开。折叠只发生在纯直链上，分叉输入、会话头、末条输入永远可见。
- **投影缺失**：该会话只画会话头 chip（`投影未加载`），工具栏说明有几个会话没有轮次数据。

### 轮次树怎么拼出来

- 直接父会话在列表里：用父 outline 求继承前缀；父被「隐藏子代理会话」过滤掉时，仍用它的 outline 确定自有轮次起点，但只画与最近已绘制祖先共享的那段，其余继承轮次在会话头上标 `继承 N 轮（父会话已隐藏）`。
- steering 输入不在 `turnOutline` 里：客户端通过 `ctx.sessions.retain(id, { source })` 读当前会话及其祖先路径的**已加载事件窗口**，把 human `user/message` 按 `turn/start` 的 seq 归到轮；当轮第一条 prompt 已在 outline 里就跳过，其余消息各成一个节点，fork 边从该轮最后一条输入出发。未打开/未加载历史的会话仍只有每轮首条 prompt。
- 父会话不在列表里：无法判断继承，整段 outline 视为自有，作为一棵独立的树绘制。
- 子代理：有 seed 前缀时按前缀挂载，边用虚线；没有 seed 时宿主不记录 spawn 轮次，只能近似挂在父会话的最后一个自有轮次（或会话头）上。
- 直接父会话自己的自有轮次为 0 时，子会话挂在它的会话头 chip 下，而不是绕过它挂到祖先轮次上——这条规则保证空会话的层级不丢。
- 所有环（`parentId` 互相指）都按根处理，不会递归不返回。

### 对话标签栏的两个标签页默认关闭

「概览」和「会话图谱」这两个 `conversation.view` 入口由**浏览器本地偏好**控制，默认不注册。头部开关和右侧栏的两个标签页不受影响，图谱仍然可以从右侧栏正常使用；上图里的图谱就是右侧栏那个标签页。

在页面控制台里改，**刷新后生效**（不需要重新构建或重启）：

```js
localStorage.setItem('dsh.session-map.conversationViews', 'true')   // 打开
localStorage.setItem('dsh.session-map.conversationViews', 'false')  // 显式关闭
localStorage.removeItem('dsh.session-map.conversationViews')        // 回到出厂默认
```

出厂默认写在 `src/session-map/index.ts` 的 `DEFAULT_CONVERSATION_VIEWS`。

**为什么不用 profile 里的 `config`**：浏览器半由 web boot 用**裸 `{ name }`** 创建（`packages/client/web/src/boot-client.ts:50`），而 boot manifest 的插件行只带 `id` / `inject` / `immediately`——宿主行的 `config` 到不了客户端插件。给这个包写 `config` 不会有任何效果。

### 从 Git 克隆并添加工作区

入口在 **Settings → 从 Git 克隆**（`settings.section`，不占左侧边栏）：填仓库地址 → 选存放目录 → 按需打开「浅克隆」→ 点「克隆」。宿主执行 `git clone`，成功后把克隆出的目录注册成 DSH 工作区；侧边栏通过工作区自己的 follow 流自动出现这一行，不需要刷新页面。

- **存放目录有记忆**：上次的选择存在 `localStorage` 的 `dsh.git-workspace.parentDir`；第一次打开时用工作区列表里排在最前的一个的父目录当默认值（默认顺序下就是最近添加的那个，通常正是你的 projects 根目录），没有工作区才退回宿主默认目录。**浅克隆不记忆**，每次打开都回到关闭状态。
- **浅克隆默认关闭**：默认克隆完整提交历史；打开后只拉最近一次提交（`--depth 1`）。这个开关是「这一次」的选择，不会被记住。
- **目标目录** = 所选目录 + 仓库地址最后一段（去掉 `.git`）。目标已存在、父目录不存在、认证失败、仓库不存在、网络不通、超时各有独立文案；git 的 stderr 尾部会显示在错误框里。
- **克隆期间**：同一时间只允许一个克隆；超时 15 分钟；关闭设置页或刷新页面会中止请求，宿主随之终止正在跑的 `git clone`。
- **私有仓库**不会弹密码框（`GIT_TERMINAL_PROMPT=0`），请先在终端配好 SSH key / credential helper。
- **宿主路由**只有两个：`GET /plugin-git-workspace/state`、`POST /plugin-git-workspace/clone`；只接受来自 loopback 连接（`socket.remoteAddress`）并且 Host / Origin 都是 loopback 的请求，`clone` 还要求 `content-type: application/json`。把 GUI 暴露到局域网时，这个页面会被拒绝——克隆只在本机操作。
- **选目录**用的是工作区自己的原生目录选择器（`ctx.get('uiWorkspace').pickDirectory()`）；远程 / SSH 场景下该能力可能不可用，页面会显示错误并允许手输路径。

实现位置：`src/git-workspace/git.ts`（纯规则：地址校验、目录名推导、argv、失败分类）、`host.ts`（路由 + `git clone` + `workspaceRegistry.create`）、`client.ts`（Settings 页、本地记忆与宿主请求封装）。

### Git 工具窗口

侧边栏新增 Git 图标，点开是一个主面板工具窗口（`main` key = `git-workspace`，`sidebar.panellist` id 同名），面板内自带「提交 / 日志 / 控制台」三个标签页：

- **日志**：左侧分支树（HEAD / 本地 / 远程，可搜索过滤）、中间提交列表（客户端按 `%P` 计算图线、refs 胶囊、作者与时间）、右侧提交详情（完整 message、作者/提交者、哈希、所在分支、文件列表、逐文件 diff）。
- **提交**：按「暂存区 / 未暂存 / 未版本控制 / 冲突」分组；勾选即写 index（`git add` / `restore --staged`），丢弃未跟踪文件先 `clean -nd` 预览再 `clean -fd`，且必须经过服务端确认令牌；支持提交、修正上次提交、提交并推送。
- **控制台**：显示 Host 实际执行的每条 argv（凭证已脱敏）、退出码与耗时。

宿主路由与克隆页共用 `/plugin-git-workspace` 前缀；所有路径先按注册 Workspace 做 `realpath` 包含校验，写操作每仓库串行，破坏性操作由服务端二次确认。规格与安全测试矩阵见 [docs/git-workspace-spec.md](docs/git-workspace-spec.md) §6。

**当前状态（0.4.0-dev）**：只读链路与提交链路已实现，`pnpm test` 覆盖 206 个用例（含 `GIT_WS_IT=1` 的真实 git 集成用例：未确认丢弃不改文件、clean 不删 ignored、锁不清除、提交信息不执行 shell 等）。尚未实现：分支检出/新建/删除/合并/变基、Fetch/Update、stash、长任务 SSE 进度。

**本地验证**：`pnpm build` 后需要让 web profile 指向本仓库（`dsh plugin --profile web add link:<本仓库路径>`）并重启/刷新；npm 安装的副本不会热更新宿主路由。

### 技能页

入口在 **Settings → 技能**（`settings.section`，order 30，不占左侧边栏）。页面回答两个问题：用户级别有哪些技能、每个项目级别有哪些技能。

- **用户级**：`~/.dsh/skills`（`user-dsh`）与 `~/.agents/skills`（`user-agents`）两个根目录里的技能，对所有项目生效。
- **项目级**：按**项目根**分组——从每个已注册工作区的路径向上找到最近的 `.git` 目录（与技能提供方同一套规则），再读该根下的 `.dsh/skills`（`project-dsh`）与 `.agents/skills`（`project-agents`）。同一个项目根下的多个工作区合并成一组，monorepo 只列一次；还没有项目级技能的项目折叠成一行汇总。
- **项目可折叠**：每个有技能的项目是一张可展开的卡片，标题行显示项目名、技能数与展开箭头，收起时显示前 3 个技能名作为预览；**只有一个项目时默认展开，多个项目默认收起**，可用「项目级」标题右侧的「全部展开 / 全部收起」一次操作。搜索时自动展开所有命中的项目——收起一个命中项会让人误以为没搜到。
- **内置 / 其他**：`bundled`、自定义目录与运行时注册的技能；一个都没有时整节不显示。
- 每行显示名字、描述、`何时用`、来源根、`仅手动调用` / `仅模型可用` 限制与 SKILL.md 路径；描述超过 80 字时默认折成两行，行内「展开 / 收起」文本按钮切换全文；顶部搜索框按名称 / 描述 / 路径过滤，「刷新」重新读取并显示更新时间。
- **读取口径**：宿主半 `GET /plugin-skill-catalog/state` 通过默认 Agent Preset 的 revision lease 做一次 cold、scope-aware 读（与产品冷读 transcript 的读法一致），所以用户根目录里的技能不需要有会话也能列出来；`cwd` 只用来追加项目根。技能注册表没挂载时返回 `skills-unavailable`，页面显示错误而不是空列表。
- 数据来自 `ctx.skills`，插件里不重复扫描目录；自定义 provider 注册的技能按它上报的 `source` 归类，未知来源会原样显示。
- 这个路由只读，不像 Git 克隆那条路要改本机文件，因此没有 loopback 限制；但响应本身没有 CORS 头，跨站页面读不到内容。

实现位置：`src/skill-catalog/catalog.ts`（类型、来源分层、搜索过滤、信封解码）、`host.ts`（项目根解析、按层读取、只读路由）、`client.ts`（Settings 页与样式）。

## 本地开发

```sh
pnpm install
pnpm build        # 产出 lib/index.js 与 lib/client.js
pnpm typecheck    # tsc --noEmit
pnpm test         # 轮次树布局与画布渲染测试（vitest）
```

`tsdown.config.ts` 不做类型检查、也不用 project references，所以构建是自包含的，类型检查与测试是独立的两步。

**改了宿主半怎么让正在跑的 GUI 生效**：`pnpm build` 之后，改一下 profile 的 `cordis.patch.yml`（追加或改一行注释即可）触发 HMR 重新组合；DSH 0.2.1 会检测到 link 包的目标文件变化并替换宿主插件，不用重启应用。浏览器半由 `dsh-client-hmr` 轮询 bundle 变化并自动换掉，通常也不需要手动刷新。真实重启仍然是最保险的验证方式。

**提交前务必 `pnpm build`**：`lib/` 是仓库内容的一部分，安装方不会替你构建。

## 两个产物

| 产物 | 形态 | 谁用 |
|---|---|---|
| `lib/index.js` | ESM | 宿主 Loader 按包名 import |
| `lib/client.js` | CJS closure factory | 浏览器内核通过 module table 取用 |

浏览器半外面包了一层交接，由本仓库的 `tsdown.config.ts` 自己声明：

```js
window.__ModuleLoader__.load({ id: '@xiguazhiprince/dsh-session-map', factory: (require) => { … } });
```

产品自带的 `packages/client/tsdown.client.ts` 预设是**仓库内部**的（它会去读 `packages/<group>/<pkg>/package.json` 并 import 同仓的构建模块），独立仓库导不进来，所以这里自己写。React 与 `@deepseek-ai/cordis` 保持 `require` 外部化，由内核的 `require` 提供；本插件不 import 其它产品包，所以产物里只有自己的代码。

## 状态

**已在本机验证**：

- GitHub 直装全流程——下载 tarball → 解压 → 写进 profile 的 `dependencies` → 回写 `dsh.profile.bundles`；**4.6 秒，零安装期脚本**；
- `--dump-config` 里出现 `# == dsh-session-map` 层；
- 首页 HTML 的 boot manifest 列出了 `@xiguazhiprince/dsh-session-map/client.js`，合并后的插件包请求返回 200 且含 `__ModuleLoader__` 工厂交接；
- 两个产物的文件名与 React 外部化（`lib/client.js` 里是 `require("react")`，没有内联）。

**一个包同时是 bundle 和 client 插件是可行的**：产品随附的布局把两者拆成不同的包（bundle 的 patch 行去引用 `packages/client/*` 里的插件包），但自引用同样能被浏览器 roster 收下。

**已完成**：仓库结构、`dsh.bundle` 层、`dsh.client` 声明、宿主半、构建契约，以及全部画布与交互（轮次树、会话头、长直链折叠）。

**0.2.0 轮次树改造**：`pnpm test`（18 个布局与渲染用例）、`pnpm typecheck`、`pnpm build` 均通过；`lib/` 已重建。README 里的两张截图都已换成 0.2.0 的轮次树界面。

**Settings → 从 Git 克隆**：`settings.section` 已实时注册（`Slots.listSubTree` 里能看到 `@xiguazhiprince/dsh-session-map` 的 `git-workspace` 条目，order 60、active）；宿主路由用 curl 验证了 state、403 信任校验、参数校验、真实本地仓库 clone 与工作区注册；测试期间注册的临时工作区和临时目录都已清理。原生目录选择器和页面上的点击流程还需要在浏览器里人工确认一次。

**Settings → 技能**：`settings.section` 以 order 30、label「技能」注册；宿主 `GET /plugin-skill-catalog/state` 用 curl 验证过真实分层结果——本机用户级 3 个（全部来自 `~/.agents/skills`）、11 个已注册工作区中 2 个有项目级技能、其余折叠成一行；`skills-unavailable`、单项目失败隔离、路由 404/405 由单测覆盖，项目折叠（单个自动展开、多个默认收起、搜索强制展开命中项）由服务端渲染用例覆盖；`pnpm test`（93 用例）、`pnpm typecheck`、`pnpm build` 均通过。页面已在刷新后的 GUI 里实际渲染确认过用户级列表；折叠卡片与搜索的交互还需要在页面上人工点一次。

## 宿主契约（升版必读）

浏览器半读的是**运行时快照**，产品不承诺它们稳定。已经踩到过两次，都表现为「样式坏了」但其实是契约漂移：

| 读的东西 | 现在怎么读 | 漂移前 |
|---|---|---|
| 当前会话 | Session 列表快照里 `retainedBy.mainView > 0` 的那一行（`mainSessionId`），退而用座位上自己的 `sessionId` | 快照曾直接给 `current` |
| 排队条数 | `pendingSubmissions`（0.1.7 的名字） | 曾叫 `queue` |

判断「当前会话」时不要发明新口径：产品自己的每个包都按 `retainedBy.mainView` 推导（标题栏、open-in-app、agent-preset 皆然）。快照里还没有 `current` 时，旧写法只会拿到 `undefined`，而 `undefined` 不会报错——画布只是安静地退回「整张全局图」，也没有任何节点亮起当前会话的描边。

轮次树新增的读法只有 `projectionValues.turnOutline`：每项是 `{ turn, seq, prompt, response }`。继承前缀按 `turn` + prompt/response 与父 outline 匹配；`seq` 只保留在数据里，不参与匹配（fork seed 可能重编号，而 turn 号是宿主分配并随事件复制的）。投影缺失时只画会话头并在工具栏提示。steering 输入不在这份投影里，只从 `ctx.sessions` 的已加载事件窗口补充，所以覆盖范围是当前会话及其祖先路径；其他会话要等历史加载后才会有这些节点。

同一次审计过了其余接口：`useSessions` 的 `ids` / `byId` / `phase`、`useWorkspaces` 的 `items`、投影键 `title` / `sessionStats` / `turnOutline`、以及会话快照的 `running` / `hasMore` 都还在。

## 源码结构

```
src/index.ts            宿主半：安装 /plugin-git-workspace 与 /plugin-skill-catalog 路由（缺服务时保持空转）
src/git-workspace/git.ts    纯规则：地址校验、仓库目录名、argv、失败分类、状态信封类型
src/git-workspace/host.ts   宿主路由：state / clone，调用 subprocess 与 workspaceRegistry
src/git-workspace/client.ts Settings 页（settings.section）、本地记忆与宿主请求封装
src/git-workspace/git.test.ts    规则测试（vitest）
src/git-workspace/client.test.ts 页面服务端渲染冒烟测试（vitest）
src/skill-catalog/catalog.ts    技能目录类型：来源分层、排序去重、搜索过滤、信封解码
src/skill-catalog/host.ts       宿主只读路由：项目根解析、按层读取 ctx.skills
src/skill-catalog/client.ts     Settings 页（settings.section）与样式
src/skill-catalog/catalog.test.ts 分层与过滤规则测试（vitest）
src/skill-catalog/host.test.ts    项目根、分组与路由测试（vitest）
src/skill-catalog/client.test.ts  页面服务端渲染冒烟测试（vitest）
src/session-map/index.ts     apply：样式表、插件级开关、座位与标签页注册
src/session-map/views.ts     概览页、头部按钮、轮次树画布工厂
src/session-map/graph.ts     布局：范围过滤、生长方向、轮次联合树、steering 输入、会话头、长直链折叠、连边
src/session-map/graph.test.ts 轮次树布局测试（vitest）
src/session-map/views.test.ts 画布服务端渲染冒烟测试（vitest）
src/session-map/css.ts       样式表字符串
src/session-map/constants.ts 几何常量、折叠阈值与 tab type id
src/session-map/flags.ts     跨挂载存活的插件级开关
src/session-map/format.ts    数字与耗时格式化
docs/example.png        界面截图（README 用）
docs/example-map.png    图谱细节截图（README 用）
```

样式表以字符串形式随包分发，由 `apply` 里的一个 effect 建 `<style>` 元素并负责移除。产品的 `styles` 服务只存在于动态运行时，正式插件没有它。

**改完源码务必 `pnpm build` 再提交**——`lib/` 是仓库内容的一部分，安装方不会替你构建。
