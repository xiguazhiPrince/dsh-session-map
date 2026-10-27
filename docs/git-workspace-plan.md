# DSH Git 工具窗口实施计划（测试夹具先行）

> 状态：**已完成**（2026-10-27）｜ 对应规格：[git-workspace-spec.md](git-workspace-spec.md)
> 实现提交：`1c6f3d9`（只读/提交/分支）、`541a6ea`（fetch/update/push 作业）、`ffc5b44`（历史写操作/ stash / tag / 打磨）
> 最终验证：253 个用例（238 个本地 + 15 条真实 git 集成）、`pnpm typecheck`、`pnpm build` 全绿。

## 1. 目标与交付边界

在 `src/git-workspace` 内实现 IDEA 风格的 Git 工具窗口：DSH 宿主通过 `subprocess` 执行真实 git，客户端是 `main` 面板 + `sidebar.panellist` 图标。按阶段推进，每阶段独立通过 `pnpm typecheck && pnpm test && pnpm build`。

| 阶段 | 交付 | 状态 |
|---|---|---|
| P0 夹具 | 假进程、假宿主、临时仓库、真实 subprocess 适配器 | ✅ |
| P1 纯函数层 | 路径/引用校验、argv 构造、解析器、动作策略、脱敏 | ✅ |
| P2 只读闭环 | 宿主只读 API + 只读面板（日志/详情/分支树/控制台） | ✅ |
| P3 提交链路 | 暂存/丢弃/提交/修正/提交并推送 + 确认令牌 + 写队列 | ✅ |
| P4 分支/同步/历史 | 分支动作、fetch/update/push 作业、merge/rebase/reset/revert/stash/tag、SSE 进度 | ✅ |

**不做**：变更列表、Shelf 补丁、blame、PR 集成、冲突三窗格合并编辑器、多仓库/子模块递归、对 Agent 暴露 Git 工具。

## 2. 已核实的现状与约束

- 原有 `src/git-workspace/{git,host,client}.ts` 只服务 Settings → 从 Git 克隆；`git.ts` 的 clone 规则保持不变，克隆逻辑拆到 `host-clone.ts`。
- 浏览器半唯一入口是 `src/session-map/index.ts`（tsdown/package.json 钉死）；宿主半入口是 `src/index.ts`。
- `main` 只接受 `key`（无 order/label/ownerProps），由 `sidebar.panellist` 的 `id` 投递；图标组件收到 `{ size, active }`；`ctx.layout.selectPanel()` 可程序化切换。
- 面板选中态不持久化：刷新后回到会话页，插件用 `localStorage` + 注册时 `selectPanel` 恢复。
- 运行中 web profile 需要 link 到本仓库（`dsh plugin --profile web add link:<repo>`）才能看到宿主路由变化；npm 安装副本不会热更新。
- `subprocess` 的 env 会合并到脱敏后的父环境（保留 `PATH/HOME/SSH_AUTH_SOCK`）。
- `webServer.register` 的 handler 拥有完整响应生命周期，可直接做 SSE。
- git 写操作**不受** workspace-write 沙箱与 approval 约束：路径白名单 + 服务端确认 + 不注册 Tool 是唯一边界。

## 3. P0 测试夹具（`src/git-workspace/testing/`）

| 文件 | 内容 |
|---|---|
| `fake-subprocess.ts` | 记录每次 spawn 的 argv/cwd/env/stdio/graceMs/signal；按脚本回放退出码、stdout/stderr、延迟、超时、取消、截断；提供 `lastArgv()` 等断言辅助 |
| `fake-host.ts` | `FakeWebServer` + `FakeWorkspaceRegistry` + 进程内 `invokeRoute`；保留真实 `isTrustedRequest` 路径 |
| `temp-repo.ts` | 真实临时仓库：init/commit/branch/merge conflict/bare remote/index.lock |
| `real-subprocess.ts` | 集成测试用的本地 subprocess 适配器（生产只经 seam） |
| `output-fixtures.ts` | status v2 / log -z / show / numstat / refs 等字节级 fixture |
| `harness.test.ts` | 夹具自测：录制 spawn、abort 回放、route 调用、临时仓库提交与冲突 |

## 4. P1 纯函数层

| 文件 | 责任 |
|---|---|
| `git-types.ts` | 快照/提交/文件/diff/作业/信封/错误码等共享类型 |
| `git-repo.ts` | 路径归一化与包含判断、ref/hash/remote 名预检 |
| `git-command.ts` | 只读/写公共前缀与 env、每个动作的 argv builder、凭证脱敏 |
| `git-parse.ts` | status v2 -z、log -z + `%x1f`、name-status/numstat -z、unified diff、refs、repo probe；截断检测 |
| `git-actions.ts` | 动作白名单、L1/L2/L3 策略、确认目标、写命令构造、请求解析 |

## 5. P2 宿主只读 API

`host.ts` 只做信任校验与分发；`host-http.ts` 承载 req/res、JSON 读取与 loopback 校验；`host-errors.ts` 承载状态码与 stderr 分类；`host-process.ts` 是唯一的 git 执行者。

| 方法 | 路径 | 说明 |
|---|---|---|
| GET | `/plugin-git-workspace/snapshot` | head、四类更改、分支/标签/远端、stashCount、进行中操作；1s 内缓存 |
| GET | `/plugin-git-workspace/log` | 单页 ≤100，ref/文本/作者/日期/路径过滤，hasMore |
| GET | `/plugin-git-workspace/commit` | `show -s` + `show --first-parent --name-status/--numstat` + `for-each-ref --contains` |
| GET | `/plugin-git-workspace/diff` | 原始 patch + binary/truncated，客户端解析 hunk |

所有路径先按注册 Workspace 做 `realpath` 包含校验；每个响应带 `commands` 回执。

## 6. P2 只读面板

`window/` 下按职责拆分：`index.ts`（注册 + 恢复）、`shell.ts`（标签页/工作区选择/轮询/选择）、`log.ts`（分支树/列表/详情/diff）、`console.ts`、`runtime.ts`（fetch/轮询/作业）、`lanes.ts`（图线布局）、`css.ts`、`icons.ts`、`branch.ts`/`history.ts`/`commit.ts`（弹层与提交页）。

- 注册：`sidebar.panellist{ id:'git-workspace', order:30, label:'Git' }` + `main{ key:'git-workspace' }`。
- 工作区：`useWorkspaces().items`，默认顺序 = localStorage → 当前会话所属 workspace → 第一项。
- 轮询：可见 3s、隐藏 10s、不可见即停；请求都带 AbortController。
- 空态/错误态/加载态、主题 token、内联 SVG，无产品组件 import。

## 7. P3 提交链路与安全门禁

- 动作：stage / unstage / discard（`clean -nd` 预览 → `-fd`，永不带 `-x`）/ commit（amend）/ push。
- `/confirm` 签发一次性令牌（60s，绑定 repo + 动作 + 目标）；`/action` 服务端校验，绕过 UI 也无效。
- 每仓库写串行；`index.lock` 返回 `lock` 且不删除锁；错误码映射中文文案。
- 控制台显示实际 argv（凭证脱敏）、退出码、耗时。

## 8. P4 分支 / 同步 / 历史写操作

- **分支**：checkout、createBranch、deleteBranch（L2 确认，默认 `-d`，强制 `-D`）、renameBranch；分支树右键菜单、双击检出、目录折叠。
- **同步**：fetch、update（fetch + merge）、push（可强制 `--force-with-lease`，L3 确认）；长任务返回 job，`/job` 查询、`/cancel` 取消、`/events` SSE 进度。
- **历史**：merge、rebase、reset（Soft/Mixed/Hard，L2）、revert、cherryPick、abortOperation、continueOperation；日志右键菜单。
- **stash / tag**：stashPush（含未跟踪）、stashPop、stashDrop（L2）、tagCreate、tagDelete（L2）。

## 9. 测试映射与验证

| 层 | 范围 | 用例数 |
|---|---|---|
| L1 纯函数 | 路径/引用/argv/解析/动作策略/脱敏 | `git-*.test.ts` |
| L2 路由 | 信任、白名单、确认门禁、队列、错误码 | `host-git.test.ts` |
| L3 脚本化进程 | 取消、超时、截断、busy | 同上 |
| L4 真实 git | 丢弃/提交/锁/空仓库、分支、stash、tag、fetch/update、force-with-lease、symlink | `safety.integration.test.ts` |
| L5 架构守卫 | 禁止 shell/child_process、写路由必须过门禁 | `safety.architecture.test.ts` |
| SSR | 面板/分支树/日志/详情/提交页 | `window.test.ts` |

验证命令：

```sh
pnpm typecheck
pnpm test                                   # 238 个本地用例（集成默认跳过）
GIT_WS_IT=1 pnpm test                       # 253 用例（含 15 条真实 git）
pnpm build                                  # 重建 lib/
```

## 10. 实际偏差与剩余可选项

### 10.1 未完成可选项（路线图）

**已完成（0.4.0）**：**R1 右侧栏一页式 Git 页面** —— 原生右栏 tab type `dsh-session-map.git`（kind `git-window`）+ 会话头「Git」按钮（order 41）+ 右栏 `+` 指南卡片；会话级、自动跟随会话工作区；一页内「提交面板 + 差异查看器」在上、「分支树 + 提交列表 + 提交详情」在下；差异支持统一/并排，断点 760/700/520/800；每会话 UI 偏好 `dsh.git-window.rightbar.<sessionId>`。实现：`src/git-workspace/window/rightbar/`、`window/diff-view.ts`、`window/feedback.ts`、`src/session-map/sidebar-right.ts`。主面板 Git 工具窗口保留不变。

| # | 可选项 | 当前现状 | 说明 |
|---|---|---|---|
| O1 | 冲突合并编辑器 | 只有「继续 / 中止」，冲突文件需在外部编辑器解决 | 可先做双栏 ours/theirs 选择，再做三窗格合并 |
| O2 | stash 完整列表 / 逐条 drop | 面板只暴露 push/pop 最近一条 + stashCount；`stashDrop` 后端与确认策略已就绪 | 需要在快照中返回 stash 列表并加一个列表区 |
| O3 | 远程标签删除 | 只做本地 `tag -d`，未做 `push --delete` | L3 操作，需要确认与远端影响提示 |
| O4 | 子模块 / worktree 管理 | 单仓库（注册 Workspace 根），未识别子模块与 linked worktree | 仓库解析已返回 `gitDir`，可在此之上扩展 |
| O5 | 超大仓库虚拟滚动 | 提交列表按页加载（50/页），未做虚拟滚动；快照每次完整 `status` | 大仓库可先拆 A/B 级轻量刷新 |
| O6 | 非当前分支 Update「仅快进」 | 当前默认确认后检出再更新 | 仅当分支未检出且可快进时可用 |
| O7 | kill 恢复集成用例 | 取消作业与 busy 已测；被 kill 后的状态恢复只有设计说明 | 需要模拟长任务被杀后重探测操作标记 |
| — | 变更列表、Shelf、blame、PR/Issue、GPG 徽标、对 Agent 暴露 Git 工具 | 明确不做 | 规格 §1.2 的非目标 |

### 10.2 已实现与设计的偏差

- **快照刷新**：v1 每次轮询跑完整 status（未拆 A/B 级 `-uno`）；大仓库可后续优化。
- **stash 列表**：目前只提供 push/pop 最近一条与 stashCount，完整列表/逐条 drop UI 未做（后端 `stashDrop` 已实现）。
- **标签删除**：仅本地 `tag -d`，未提供远程标签删除。
- **冲突解决**：提供继续/中止，未做双栏/三窗格合并编辑器。
- **性能**：提交列表按页加载，未做虚拟滚动；超大仓库需后续优化。
- **kill 恢复**：取消作业与 busy 已测，进程被 kill 后的状态恢复只有设计说明，未加集成用例。
- **其它**：子模块/worktree 管理、远程标签删除、非当前分支 Update 的「仅快进」选项。
- **右侧栏页面与主面板的读写处理器同形状但独立实现**：本阶段共享的是展示组件（`diff-view` / `feedback` / `log` / `commit`）与注册助手（`session-map/sidebar-right.ts`），状态机与动作接线各写一份；后续可收敛为一个共享 controller，避免两套逻辑漂移。

## 11. 本地运行

```sh
pnpm build
dsh plugin --profile web add link:C:\Users\54647\Developer\myProjects\dsh-session-map
# 刷新页面；宿主半由 HMR 重载，客户端半刷新后生效
```

详见 [README](../README.md) 的「Git 工具窗口」与「本地开发」。

## 12. 交接说明（给下一个会话 / 工程师）

### 12.1 先读什么

1. `docs/git-workspace-spec.md`：§1 目标与原则、§3 IDEA 行为、§5 DSH 落地（API/数据模型/git 命令）、§6 安全测试设计；
2. 本文档：§1 阶段表、§9 测试映射、§10 路线图与偏差；
3. `README.md` 的「Git 工具窗口」「本地开发」「宿主契约」。

代码入口：宿主 `src/git-workspace/host.ts` → `host-git.ts` → `host-actions.ts`；客户端 `src/git-workspace/window/index.ts` → `shell.ts`。纯规则在 `git-actions.ts` / `git-command.ts` / `git-parse.ts` / `git-repo.ts`。

### 12.2 基线、环境与验证

- 基线实现：提交 `06ec71b`（`master`），工作树应保持干净；`lib/` 已随代码重建并提交，不要只改 `src/`。
- 依赖：`pnpm install`（lockfile 未提交，属预期）。
- 本地 GUI：web profile 必须 link 到本仓库才能加载新宿主路由：

  ```sh
  pnpm build
  dsh plugin --profile web add link:C:\Users\54647\Developer\myProjects\dsh-session-map
  ```

  宿主半通过编辑 profile 的 `cordis.patch.yml`（追加一行注释即可）触发 HMR；客户端半刷新浏览器后生效。**不要在 Agent 会话内部重启 `dsh web`**（当前 GUI 就是承载会话的进程），让用户手动重启/刷新。
- 验证门槛：

  ```sh
  pnpm typecheck
  pnpm test                 # 238 个本地用例，集成默认跳过
  GIT_WS_IT=1 pnpm test     # 253 个用例，含 15 条真实 git 集成（约 20s）
  pnpm build                # 必须，重建 lib/
  ```

### 12.3 继续 O1–O7 的约定

- **两个载体**：主面板（`main` key `git-workspace`）与右侧栏页（tab type `dsh-session-map.git`）共用 `window/runtime.ts` 和宿主路由；改读接口或动作时两处都要验证，右侧栏页的状态机在 `window/rightbar/model.ts`，布局在 `window/rightbar/layout.ts`。

- **测试先行**：写操作先加 L1（argv/策略）与 L2（路由门禁）测试；涉及真实副作用的再加 L4 临时仓库集成用例。
- **安全不变量**（规格 §6）：路径白名单、服务端确认令牌、每仓库写串行、凭证脱敏、不引入 shell/`child_process`、不注册 Tool。L2/L3 动作用确认令牌；L1 不要滥用确认。
- **改动同步**：完成后同时更新本文档 §10.1 的状态与 `docs/git-workspace-spec.md` §10.4；`pnpm build` 后把 `lib/` 一起提交。
- **提交风格**：沿用现有英文祈使句标题（如 `Add ... to the Git tool window`），一个主题一个提交。

最小验收建议：

| 项 | 最小验收 |
|---|---|
| O1 冲突合并编辑器 | 冲突文件列表可进入双栏/三窗格；选择结果写回工作区；`continueOperation` 后快照回到 `none`；冲突期间提交被阻止 |
| O2 stash 列表 | 快照返回 stash 列表；面板逐条 pop/drop；drop 走 L2 确认；刷新后列表正确 |
| O3 远程标签删除 | `push --delete` 仅 L3 确认后执行；远端拒绝/无权限有稳定错误码；本地标签保留 |
| O4 子模块/worktree | 多仓库选择与仓库根识别正确；路径白名单仍按 Workspace 收口；跨仓库写操作不越界 |
| O5 虚拟滚动/轻量刷新 | 10k 提交滚动不卡；轮询拆 A/B 级后仍能发现外部改动；有性能基准记录 |
| O6 仅快进 Update | 仅未检出且可快进时可用；不可快进时拒绝并提示；有集成用例 |
| O7 kill 恢复 | 模拟长任务被杀后，快照标记 `interrupted`，下一次写要求先刷新/中止；有集成用例 |

### 12.4 已知坑

- 快照每次跑完整 `status`，大仓库慢；先测量再拆 A/B 级刷新。
- 标签已进快照 `branches`（`type: 'tag'`）；stash 只有 `stashCount`，没有列表。
- Windows 上 symlink 用例需要开发者模式；没有时用例会自动 `skip`，Linux CI 必须跑。
- 对比文件内容时先归一化 CRLF；git 输出一律按 `-z`/`%x1f` 解析。
- 集成测试每个用例建真实临时仓库，整套约 20s；不要放进默认 `pnpm test`。
- `lib/client.js` 约 260KB；客户端入口只能是 `src/session-map/index.ts`。
