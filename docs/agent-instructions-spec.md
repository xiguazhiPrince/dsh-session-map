# AGENTS.md 指令管理器（实施规格）

> 状态：**已实现**（2026-11-03）｜ 对应入口：对话标签栏 →「指令」
> 依赖的产品能力：`@deepseek-ai/dsh-agent-instructions`（发现与注入）、`@deepseek-ai/dsh-session-query`（会话目录）、`@deepseek-ai/dsh-working-directory`（会话当前目录）。

## 1. 要解决的问题

DSH 会把若干 `AGENTS.md` / `CLAUDE.md` 注入模型上下文。它们散落在：

- **用户级**：`~/.dsh/AGENTS.md`、`~/.agents/AGENTS.md`（对所有项目生效）；
- **项目级**：从项目根目录（最近的 `.git`）**逐层到会话当前目录**，每层都可能有
  `AGENTS.md`、`CLAUDE.md`、`AGENTS.local.md`、`CLAUDE.local.md`。

用户看不到这个链条：不知道哪几个文件生效、顺序如何、内容是否被去重、某层文件是不是根本不存在。本功能在对话标签栏（`conversation.view`）增加「指令」页：按真实注入顺序列出候选，就地新建 / 编辑 / 删除。

## 2. 发现与注入规则（与产品一致）

1. 顺序：先两个用户根（`~/.dsh` → `~/.agents`），再从项目根到会话目录逐层；同层先基础文件再 `.local.md` 覆盖文件。越靠后越具体、优先级越高。
2. 项目根 = 从会话目录向上找到的第一个含 `.git` 的目录；找不到时项目根就是会话目录本身（界面会提示没有项目标记）。
3. 去重：同一候选组内（两个用户根算一组；每个项目目录各算一组）**trim 后内容 SHA-1 相同**的文件只注入第一份，后面的标记「内容重复」。
4. 单文件源码上限 1 MiB；超过或读不了的文件不注入，界面明确标出。

会话目录的解析与产品 `sessionSkillCatalog` 一致：`sessionQuery.observeSession(sessionId)` 的 `projections.values.workingDirectory` → `header.cwd` → `workingDirectory.defaultDirectory`；若会话有 live agent 且服务存在，再用 `workingDirectory.ensure` 修正。

## 3. 界面

- **列表页**：左右分栏的主从（master-detail）布局。左侧是用户级两行 + 项目级每层一张卡片（全部四个候选，未创建的也显示「新建」），行内展示 `生效 #N`、`本地覆盖`、`未创建`、`内容重复`、`超过 1 MiB，未注入`、大小与修改时间、相对路径；右侧是只读预览。顶部展示会话目录 / 项目根、生效文件总数、刷新与更新时间。
- **右侧预览**：点击左侧任意一行即在右侧显示该文件内容（等宽、只读、可滚动），或「尚未创建」的建文件提示；读取中、读取失败、空文件各有明确文案。预览区的「编辑 / 新建」按钮仍打开原来的编辑页，预览本身不提供编辑。窗口较窄时预览叠到列表上方，保证点击总有可见结果。
- **编辑页**：路径、层级、绝对路径、字节数（1 MiB 上限）、保存 / 还原 / 删除 / 返回；保存成功显示时间，外部修改冲突时提示重新加载，不覆盖他人改动。
- 空态、加载态、失败态、旧数据上的刷新失败横幅与既有「技能」页一致；预览的主从选中态在静默刷新后保留，切换会话时清空。

视觉分层（避免「边界不清晰」）的原则：每个实体只套**一层**外壳——卡片加一条 header 分隔，而不是卡片里再套一个带边框的列表（Gestalt 的 common region）；亮色主题下 `bg-layer-1` 与 `bg-layer-2` 都是白色，所以层次主要由边框粗细承担：`border-l2` 1px 画卡片轮廓、同色 0.5px 画 header 与行分隔，`border-l1` 只用于装饰性提示，品牌色只标记当前预览行。预览栏用一条左边线与列表分开，窄屏改到底部横线并将预览叠到列表上方。

## 4. Host 路由契约

统一前缀 `/plugin-agent-instructions`，全部 JSON，全部先过 `isTrustedRequest`（loopback + 同源）。

| 方法 | 路径 | 请求 | 成功响应 |
|---|---|---|---|
| GET | `/state?sessionId=` | — | `{ ok:true, state: AgentInstructionsState }` |
| GET | `/file?sessionId=&id=` | — | `{ ok:true, file: InstructionFileDetail }` |
| POST | `/save` | `SaveInstructionRequest` | `{ ok:true, file: InstructionFileDetail }` |
| POST | `/delete` | `DeleteInstructionRequest` | `{ ok:true }` |

失败统一 `{ ok:false, error:{ code, message } }`。错误码：`not-trusted`、`bad-request`、`session-not-found`、`session-cwd-unavailable`、`unknown-file`、`not-regular-file`、`symlink-not-allowed`、`conflict`、`too-large`、`not-text`、`write-failed`、`delete-failed`、`internal`。

`id` 由 Host 在 state 中给出，客户端只回传；Host 每次重新发现并据此解析**绝对路径**，从不接受客户端路径。

## 5. 安全模型

- 写操作只允许四类候选文件名，且必须落在用户根目录或当前会话的项目链目录内。
- 目标为符号链接时拒绝写入 / 删除（避免顺着链接改到别处）。
- 保存使用同目录临时文件 + `rename` 原子替换；已存在文件保留原权限位。
- 并发编辑用 SHA-1 乐观锁：编辑页带上加载时的 `expectedSha1`，不一致返回 `conflict`；新建时若文件已被创建同样返回 `conflict`。
- 路由仅本机同源可达；不接受客户端提供的任何绝对路径。

## 6. 代码与测试映射

| 文件 | 责任 |
|---|---|
| `src/agent-instructions/model.ts` | 共享类型、路径 / id / 注入顺序 / 去重 / 信封解析（纯函数，浏览器与 Host 共用） |
| `src/agent-instructions/host.ts` | 会话目录解析、发现、去重、读写删、四条路由 |
| `src/agent-instructions/client.ts` | 「指令」标签页：列表页、编辑页、容器状态机、样式 |
| `src/agent-instructions/*.test.ts` | 模型规则、发现/读写/路由（临时目录 + fake host）、SSR 渲染 |

验证：`pnpm typecheck && pnpm test && pnpm build`。

## 7. 已知边界

- 只管理上述候选文件名，不管理预设或 Settings 里的其它指令来源。
- 只读 `.git` 作为项目根标记（产品默认值；暂不读取自定义 `projectRootMarkers` 配置）。
- 依赖 Host 侧的 `sessionQuery`；缺这个服务的极简组合会返回明确错误而不是降级猜目录。
