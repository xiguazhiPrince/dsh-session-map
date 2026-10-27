# DSH Git 工具窗口功能规格（IDEA 风格）

> 状态：草案 v0.3 ｜ 日期：2026-10-27 ｜ 落点：`src/git-workspace/`
> 参考对象：IntelliJ IDEA 新 UI 的 **Commit 工具窗口** + **Git 工具窗口（日志 / 控制台）**
> 参考截图：`docs/git-workspace-reference.png`（2568×1400，中文界面）

![IDEA Git 工具窗口参考](git-workspace-reference.png)

## 阅读指引

| 想知道什么 | 看哪里 |
|---|---|
| 产品要长什么样、每个区域有什么 | §3、§4 |
| 在 DSH 里放在哪、怎么搭 | §5.1–§5.3 |
| 客户端数据结构与宿主 API | §5.4–§5.5 |
| 每条功能对应什么 git 命令、怎么解析 | §5.6 |
| 安全、性能、错误码 | §5.7–§5.9 |
| git 操作的安全性如何用测试保证 | **§6**（安全不变量、测试矩阵、集成用例、CI 门禁） |
| 文件怎么拆、怎么测、怎么验收 | §5.10、§7 |
| 还有哪些没定的决策 | §9（含待核实清单） |

## 0. 一句话

在 DSH Web GUI 里做一个「Git 工具窗口」：左侧分支树、中间提交列表、右侧提交详情，另有本地更改与提交面板；覆盖 **本地更改 → 提交**、**分支 → 历史 → 提交详情**、**更新 / 获取** 三条主链路。所有读写都通过 DSH 宿主已有的 `subprocess` 通道执行真实 `git` 命令，不引入额外 git 库，也不依赖产品内部未公开的 UI 组件。

---

## 1. 目标、非目标与原则

### 1.1 v1 目标（必须做到）

| # | 目标 | 验收口径 |
|---|---|---|
| G1 | 仓库识别与状态快照 | 选中一个 Workspace 后，能识别其仓库根、当前分支、ahead/behind、进行中的 merge/rebase 等操作 |
| G2 | 本地更改与提交 | 看到已暂存/未暂存/未跟踪/冲突文件；能暂存、取消暂存、丢弃、写提交信息、修正上次提交、提交、提交并推送 |
| G3 | 分支树 | 展示 HEAD / 本地 / 远程分组，能搜索、检出、新建、删除、重命名、合并、变基、比较 |
| G4 | 提交日志 | 按分支/用户/日期/路径/文本或哈希过滤，支持分页、多选、图线渲染、右键操作 |
| G5 | 提交详情 | 展示提交信息、作者/提交者/时间/哈希/引用/所属分支、完整文件树与逐文件 diff |
| G6 | 获取（Fetch） | 拉取所有远端引用并更新远程分支与 ahead/behind，不触碰工作区 |
| G7 | 更新（Update） | 把选中分支更新到本地（等价 pull），支持 merge/rebase 两种策略 |
| G8 | 安全与反馈 | 破坏性操作二次确认；长任务可取消；错误有稳定错误码与中文文案 |

### 1.2 非目标（v1 不做，列入后续）

- 冲突三窗格合并编辑器（v1 只展示冲突文件与「两端内容」对照，冲突解决引导用户到终端/编辑器）。
- 代码编辑器、Blame/Annotate、行级暂存（`git add -p` 交互）、交互式 rebase 编辑器。
- GitHub/GitLab Pull Request、Issue 集成；GPG 签名校验徽标。
- IDEA 的 Shelf（补丁搁置）机制：v1 用 `git stash` 承载「搁置」，不实现 patch shelf。
- 变更列表（Changelist）多列表管理：v1 固定「默认更改列表」语义，等价于 IDEA 关闭暂存区时的单列表模式。

### 1.3 设计原则

1. **读多写少、读快写慢**：打开面板只读快照；任何写操作都是用户显式动作，且默认串行执行。
2. **不碰用户工作区的「隐形」状态**：不做自动 stash、不自动合并、不自动 push；唯一的自动行为是只读刷新。
3. **真实 git 语义**：UI 动作必须能映射为一条可解释的 git 命令（并记录在「控制台」里），不靠插件自建状态模拟。
4. **失败可解释**：git stderr 转成稳定错误码 + 中文文案 + 可展开的原始输出。
5. **性能有硬上限**：所有读接口有分页/条数/字节上限，超限明确提示「已截断」。
6. **与现有插件一致**：沿用 `src/git-workspace` 的 `host.ts` / `git.ts` / `client.ts` 三层，沿用现有路由信任校验、信封格式与中文文案风格；样式走 `--dsw-alias-*` 主题变量，不写死颜色。
7. **安全边界由测试守卫**：动作白名单、命令构造、确认门禁、路径白名单、串行队列每一道都有对应测试（§6），不依赖 UI 自觉。

---

## 2. 术语

| 术语 | 含义 |
|---|---|
| Workspace | DSH 的工作区实体，对应磁盘上一个目录 |
| 仓库（repo） | 从 Workspace 路径向上找到的 `git rev-parse --show-toplevel` 根目录 |
| HEAD | 当前检出的提交；可能是分支，也可能是 detached 状态 |
| 暂存区（index） | `git add` 后、待提交的内容 |
| 上游（upstream） | 当前分支跟踪的远程分支，如 `origin/main` |
| ahead / behind | 本地分支相对上游多出 / 缺少的提交数 |
| Fetch（获取） | 只更新远程引用（`refs/remotes/*`）与对象库，不动工作区与本地分支 |
| Update / Pull（更新） | 取回上游并合入本地分支；IDEA 依设置走 merge 或 rebase |
| 进行中操作 | merge / rebase / cherry-pick / revert / bisect 尚未完成的状态 |
| 图线（lane） | 日志列表中表示提交父子关系的彩色竖线 |

---

## 3. IDEA 参考实现解剖

### 3.1 窗口结构（先对齐概念，再谈复刻）

IDEA 新 UI（2023.1+）把 Git 相关能力拆成**两个**工具窗口，截图里同时可见：

| 截图区域 | IDEA 工具窗口 | 默认入口 | 内容 |
|---|---|---|---|
| 1 | **Commit（提交）** 工具窗口 | `Alt+0` | 标签页「提交 / 搁置」；本地更改树 + 提交信息 + 提交按钮 |
| 2 / 3 / 4 | **Git** 工具窗口的「日志」标签页 | `Alt+9` | 左侧分支树、中间提交列表、右侧提交详情 |
| （未展开） | **Git** 工具窗口的「控制台」标签页 | 同上 | 插件执行过的 git 命令与输出 |
| 5 / 6 | Git 工具窗口工具栏 / 分支右键菜单 | — | 5 = 更新（Update），6 = 获取（Fetch） |

旧 UI（2022.x 及以前）只有一个 Git 工具窗口，标签页是「本地更改 / 日志 / 控制台」；新 UI 从 2023.1 引入、2024.2 起成为默认。IDEA **默认使用变更列表模型，暂存区默认关闭**，需要在 `设置 → 版本控制 → Git → 启用暂存区` 显式启用。本规格按**新 UI + 启用暂存区**的截图形态对齐，因为暂存区模型与 git 原生命令一一对应、最容易做对；变更列表模型列为 P2。

> DSH 没有「底部停靠区」，复刻时把两个窗口合并成**一个主面板工具窗口**，用顶部标签页区分「提交 / 日志 / 控制台」；区域 1 与区域 2 在 IDEA 里分属两个窗口，合并后仍是同一套信息架构。详见 §5.1。

### 3.2 布局与尺寸（IDEA 参考值）

- Commit 工具窗口：宽约 800px；上部变更树自适应高度，下部提交表单固定约 190px（信息框约 100px + 选项行 + 按钮行）。
- Git 工具窗口「日志」页：左分支树约 240–280px，中提交列表自适应，右提交详情约 360px；三列之间可拖拽；分支树可整体折叠。
- 行高：树/列表约 22–26px；提交详情文件树 22px；工具栏 32–36px。
- 分隔条：1px 边框色（`border-l1/l2`），可拖拽最小宽度 180/280px。
- 字体：UI 13px；提交主题 13px；哈希与 diff 用等宽字体；次要信息（作者、日期）12px。

### 3.3 区域 1：提交面板（Commit）

#### 3.3.1 组成

1. **标签页**：`提交` / `搁置`（Shelf；DSH v1 用 stash 列表承载）。
2. **工具栏**（从左到右）：
   - 刷新（重读状态）；
   - 新建变更列表 / 分组方式（按目录、按模块；v1 只保留「按目录」）；
   - 预览差异（眼睛图标：打开选中文件的 diff）；
   - 提交选项（§ 图标，打开选项浮层）；
   - 提交信息历史（上下箭头 + 时钟：最近提交信息、模板）；
   - 清空提交信息（×）。
3. **本地更改树**：
   - 分组：`暂存区`（已暂存）/ `未暂存` / `未版本控制` / `冲突`（有冲突时置顶并标红）。
   - 每一行：复选框（是否纳入本次提交）、文件类型图标、文件名、灰色目录路径、状态字母/颜色。
   - 目录行复选框支持三态（全选/部分/未选），勾选目录等价于勾选其下全部文件。
   - 空态文案：`没有要提交的内容，工作树是干净的`。
4. **提交信息区**：多行文本框；`Ctrl+Enter` 提交；支持历史（上/下键调出最近信息）；空信息提交时按钮禁用并提示。
5. **选项行**：`修正(M) 上次提交` 复选框；「上次提交」下拉（选一条历史提交信息）；提交前检查开关/说明图标；签名（`Signed-off-by`）开关（P1）。
6. **按钮行**：`提交(I)`（主按钮）、`提交并推送(P...)`、齿轮（提交选项：提交前检查、提交后动作等）。
7. **提交前检查**（IDEA 的 Commit Checks）：可配置「分析代码 / 运行检查 / 运行测试」，失败时弹出结果并可选择仍提交。v1 不做代码分析，只保留**钩子（hook）输出**的展示（见 §5.7）。

#### 3.3.2 行为

| 交互 | 行为 |
|---|---|
| 勾选/取消勾选 | **暂存区模式（v1 采用）**：勾选未暂存文件 = 立即 `git add -- <path>`（移入「暂存区」）；取消已暂存 = 立即 `git restore --staged`；「暂存区」组内勾选只决定本次提交范围。变更列表模式（P2）才延迟到提交时统一 add。 |
| 单击文件 | 选中并在可用时更新右侧/下方 diff 预览 |
| 双击文件 | 打开 diff（DSH 里为面板内 diff 预览，§5.3） |
| 右键文件 | 显示差异、还原（丢弃更改）、从提交中排除/包含、移到其他更改列表（P2）、搁置更改、复制路径、在文件管理器中打开（P2）、本地历史（P2） |
| 撤销/丢弃 | `还原` 对已跟踪文件等价 `git restore -- <path>`；未跟踪文件为删除文件，必须二次确认（不可恢复） |
| 提交 | 校验信息非空 → 检查冲突 → 按勾选路径提交（amend 时替换 HEAD）→ 成功后静默清空树并刷新日志（IDEA 提交成功不弹通知；DSH 的轻提示列为 P1 差异化） |
| 提交并推送 | 提交成功后 `git push`；无上游时先弹「定义远端分支」 |
| 修正提交 | 勾选后信息框预填上次提交信息；提交时 `--amend`；若与上次提交完全无差异则只改提交信息 |
| 冲突时 | 冲突文件置顶标红，提交按钮禁用或提交后由 git 拒绝；提示先解决冲突 |

#### 3.3.3 git 语义（详见 §5.6）

> 注意：修正提交会改写 HEAD 的哈希。amend 之后再推送必须 `--force-with-lease` 并二次确认；IDEA 的推送对话框同样会显式提示「强制推送」。

- 暂存：`git add -- <paths>`；取消暂存：`git restore --staged -- <paths>`。
- 提交：默认 `git commit -m <msg> -- <勾选路径>`（等价 `--only`，不误提交其他已暂存内容）；全选时 `git commit -m <msg>`。
- 修正：`git commit --amend -m <msg> [-- <paths>]`；仅改信息时 `git commit --amend -m <msg>`。
- 签名：追加 `-s`。

### 3.4 区域 2：分支树（Branches）

#### 3.4.1 组成

1. **搜索框**：`分支或标签`，实时模糊过滤；过滤时只显示命中节点及其祖先。
2. **左侧竖排工具栏（11 个图标）**：截图核实存在；其中第 3 个 = 更新（区域 5），第 7 个 = 获取（区域 6）；其余为新建、检出、删除、搜索、收藏、设置、展开/折叠、清除过滤等（语义以 IDEA tooltip 为准）。同时提供右键菜单与日志工具栏入口，复刻按语义实现、不照抄图标顺序。
3. **树结构**（自上而下）：
   - `HEAD(当前分支)`：当前分支快捷入口（含 detached 提示）；
   - `本地`：本地分支；当前分支加粗 + 勾选/高亮；名称可带层级目录（`feature/xxx` 折叠为目录节点，可展开）；
   - `远程`：`origin/*`、`upstream/*` 等远程跟踪分支；
   - `标签`（可选配置显示）；
   - `收藏`（P1：星标分支置顶）。
4. **节点徽标**：当前分支标记、上游分支名、`↑n`/`↓n`（ahead/behind）、合并/变基目标高亮（P1）。
5. **双击分支** = 检出（IDEA 语义）；右键 = 完整操作菜单。

#### 3.4.2 右键菜单（本地分支 / 远程分支）

| 动作 | 本地 | 远程 | 说明 |
|---|---|---|---|
| 检出（Checkout） | ✓ | ✓ | 远程分支检出时自动建同名本地跟踪分支 |
| 新建分支自 "<分支>"（New Branch from…） | ✓ | ✓ | 弹名称输入；可勾选「检出」 |
| 更新（Update） | ✓ | — | 区域 5：把选中分支更新到本地（§3.7） |
| 推送（Push…） | ✓ | — | 无上游时先定义远端；默认禁止 force |
| 拉取（Pull…） | ✓ | — | 显式拉取并选择 merge/rebase |
| 合并 "<分支>" 到当前分支 | ✓ | ✓ | `git merge --no-ff?` 默认按 IDE 设置，v1 用 `--no-ff` 关闭、保留 git 默认 |
| 将当前分支变基到 "<分支>" | ✓ | ✓ | 先确认工作区干净（脏则拒绝并提示 stash） |
| 与当前分支比较 | ✓ | ✓ | 打开两分支 diff（提交列表 + 文件树） |
| 显示与工作树的差异 | ✓ | — | 分支 vs 工作区 |
| 重命名 | ✓ | — | 只改本地名，不动上游配置 |
| 删除 | ✓ | 远程 P2 | 未合并分支需二次确认，默认 `-d`，强制删除显式勾选 |
| 跟踪分支 / 取消跟踪 | ✓ | — | 设置/移除 upstream（P1） |
| 收藏 / 取消收藏 | ✓ | ✓ | P1 |
| 复制分支名 | ✓ | ✓ | 写剪贴板 |

### 3.5 区域 3：提交日志（Log）

#### 3.5.1 工具栏

- **搜索框**：`文本或哈希`；支持消息子串、作者、哈希前缀；截图有 `.*`（正则）与 `Cc`（大小写敏感）两个开关，v1 先把固定串匹配做实，开关可置灰或隐藏（P1 再接正则）。
- **过滤 chips**：`分支: ×`（当前为某分支时显示；× 清除）、`用户`、`日期`、`路径`。
- **排序**：按时间/作者切换（P2）。
- **动作**：刷新、获取（= 区域 6）、显示/隐藏详情面板、显示设置（列、显示提交图、显示标签、紧凑引用、包含无分支提交）。
- **状态**：加载中骨架/进度条；加载更多（滚动到底自动追加）；「已加载 N 条，还有更多」。

#### 3.5.2 列表行

| 元素 | 说明 |
|---|---|
| 图线 | 左侧 60–120px，彩色竖线 + 圆点；merge 提交显示分叉/汇合；颜色按 lane 稳定分配 |
| 提交主题 | 单行截断；选中行高亮；未提交更改节点（P2）置顶 |
| 引用徽标 | 分支/标签/远程分支的小胶囊；同一提交上的本地与远程同名分支合并显示（如 `origin & main`）；超出折叠为 `+n` |
| 作者 | 右对齐灰色小字（可配置为列） |
| 时间 | `今天 15:04` / `32 分钟之前` / `2026/10/23 18:05`；12px 灰色 |
| 哈希 | 默认隐藏，显示设置为「显示哈希」时出现在行尾等宽小字 |

- 单选：右侧详情联动。
- 多选（Ctrl/Cmd 点击、Shift 连选）：详情显示并集文件列表 + `N 个提交`；批量操作对所选提交全部生效（拣选/撤销按顺序执行）。
- 键盘：↑/↓ 移动选择，Enter 打开详情/差异，空格多选（P1），Ctrl+C 复制哈希（P1）。

#### 3.5.3 右键菜单

| 分组 | 动作 |
|---|---|
| 复制 | 复制哈希、复制提交信息、复制作者/日期 |
| 分支/标签 | 从此提交新建分支、在此提交打标签（轻量/附注） |
| 检出 | 检出修订（detached，带确认） |
| 重置 | 将当前分支重置到此处…（Soft / Mixed / Hard，Hard 红色警告） |
| 撤销/拣选 | 撤销提交（Revert Commit）、拣选（Cherry-Pick） |
| 改写历史（P1） | 编辑提交信息（Reword）、修复提交（Fixup）、压缩（Squash）、交互式变基 |
| 比较/查看 | 与本地比较、显示差异、比较两个版本、在仓库中显示、本地历史（P2） |
| 外部 | 在浏览器打开（远程托管集成，P2） |

- 改写历史类操作在「提交已推送」时给出二次确认（改写了共享历史）。
- Revert 产生新提交（`git revert --no-edit`），不弹编辑器；冲突时进入进行中状态并提示。

### 3.6 区域 4：提交详情（Commit Details）

#### 3.6.1 组成

1. **头部动作**：返回（回到工作区/本地更改视图）、刷新、撤销提交（仅最新且未推送时可用，P1）、历史（P2）、显示差异（多文件合并 diff）。
2. **文件树**：按目录层级分组（根行显示 `N 个文件`，目录行显示 `xxx 个文件`）；文件行 = 状态色 + 文件类型图标（IDEA 用颜色/图标而非字母徽标；DSH 可在 tooltip 里补充 M/A/D/R/C）；双击打开 diff；右键：显示差异、在编辑器中打开（P2）、与本地比较、复制路径、还原所选更改（P1）。
3. **元信息**：
   - 完整提交信息（多行，保留空行与 `Co-authored-by` 等 trailer）；
   - 短哈希（可点击复制）、完整哈希（悬浮显示）；
   - `作者 姓名 <邮箱>，YYYY/MM/DD HH:mm`；
   - 提交时间与作者时间不同时显示 `在 YYYY/MM/DD HH:mm 提交`；
   - 引用徽标：标签（`v2.1`）、远程分支（`origin/v2.1`）、本地分支；
   - `在 N 个分支中: HEAD, main, origin/main, …`（提交可达的分支列表）；
   - 父提交链接（P1）。
4. **多选提交时**：文件树为并集；头部显示 `N 个提交已选择`；文件去重并标注来源提交（P1）。

#### 3.6.2 diff 展示（v1 范围）

- 单文件 diff：统一 diff 视图（行号 + `+/-` 行着色），支持展开上下文（默认 3 行）；二进制文件显示「二进制文件不可预览」+ 大小。
- 多文件：文件列表 + 每次渲染一个文件的 diff（点击切换），避免一次性渲染超大内容。
- 上限：单文件 diff 1MB / 5000 行，超过则截断并提示；单次最多返回 100 个文件的元信息。

### 3.7 区域 5：更新所选分支到本地（Update）

| 维度 | 规格 |
|---|---|
| 入口 | 分支树工具栏「更新」（截图竖排工具栏第 3 个图标）、分支右键「更新」、面板顶部「更新」按钮（均可映射 `Ctrl+T`） |
| 前提 | 选中的是**本地分支**；工作区干净（有未提交更改时提示先提交/搁置，不自动 stash；P1 可提供「搁置并更新」） |
| 语义 | 当前分支：先 `git fetch`，再按设置 `merge @{upstream}` 或 `rebase @{upstream}`（分两步执行，错误更可解释）；非当前分支：先确认「将检出 `<branch>` 并更新」，或选择「仅快进该分支引用」（`fetch <remote> <branch>:<branch>`，仅当分支未被检出且可快进）——默认选检出；仅 fetch 不检出属于「获取」，不属于本操作 |
| 结果 | 快进/合并/变基成功 → 刷新快照、日志、ahead/behind，通知「已更新 N 个提交」；冲突 → 进入合并/变基进行中状态，提示解决冲突，提供「中止」 |
| 失败 | 无上游、认证失败、网络失败、非快进且策略为 merge 时由 git 自行合并或报冲突；全部给出错误码与原始 stderr |
| 长任务 | 走作业模型（§5.5），可取消；期间禁止第二个写操作 |

> 决策点 D1：非当前分支的「更新」是否允许自动 checkout。推荐：允许，但确认框写明「将切换工作区到 <branch> 并拉取」，避免用户以为只更新了引用。

### 3.8 区域 6：获取远程更新（Fetch）

| 维度 | 规格 |
|---|---|
| 入口 | Git 工具窗口工具栏「获取」、分支树工具栏「获取」（截图竖排工具栏第 7 个图标）、日志工具栏刷新旁的下拉菜单 |
| 语义 | `git fetch --all --prune`；只更新 `refs/remotes/*`、对象库与 `FETCH_HEAD`，**不修改工作区、不移动本地分支** |
| 结果 | 远程分支节点刷新；当前分支 ahead/behind 更新；通知「已获取 N 个远端更新」；无更新时静默或轻提示 |
| 选项 | 远端范围：所有远端（默认，符合截图「获取所有更新」，`--all`）/ 仅当前上游远端；prune 默认开（`--prune`）；tags 是否获取随 git 配置（默认不额外加 `--tags`） |
| 失败 | 认证、网络、远端不存在；保留上次成功数据并在工具栏标红图标 |
| 长任务 | 作业模型，可取消；典型耗时 1s–60s |

### 3.9 控制台（Console）

- 记录本插件执行过的每条 git 命令：时间、完整 argv（含工作目录）、退出码、耗时、stdout/stderr 摘要。
- 支持复制命令、清空、过滤（只看失败）。
- 失败操作的 stderr 全文可展开；与错误弹窗中的「查看详情」指向同一份日志。
- 目的：让用户能验证插件到底执行了什么（对「真实 git 语义」原则的兜底）。

### 3.10 全局交互

| 场景 | 规格 |
|---|---|
| 自动刷新 | 面板可见且聚焦时 2s 一次 A 级轻量快照（`status -uno` + 引用版本短路）；空闲 60s 后降为 10s；不可见即停。提交/检出/更新/获取/推送后立即全量刷新；P1 用 `fs.watch`（`.git` 非递归 + `refs/` 递归，工作区仅在 <20k 文件时递归）做 300ms 防抖的即时刷新 |
| 手动刷新 | 工具栏刷新按钮 + `F5`；只读，不触发网络 |
| 通知 | 操作成功用面板内轻提示（3s）；失败用可展开的错误条；破坏性操作结果显示「已丢弃 N 个文件的更改」 |
| 进度 | 写操作在面板底部状态条显示「正在获取…」+ 取消；期间相关按钮禁用 |
| 快捷键 | 见 §8.1 |
| 空态 | 无仓库：「当前工作区不是 git 仓库」+「初始化仓库」（P2）；无提交：`没有提交`；无更改：`没有要提交的内容，工作树是干净的` |
| detached HEAD | 顶部黄条：`HEAD 已分离` +「检出分支」 |
| 进行中操作 | 顶部黄条：`正在合并 / 正在变基 / 正在拣选…` +「继续 / 中止」 |
| 多仓库 | 面板顶部「仓库」下拉，列出当前 Workspace 下的仓库（含子模块）；默认选当前 Workspace 根仓库 |

### 3.11 裁剪建议（P0 / P1 / P2）

| 优先级 | 范围 |
|---|---|
| **P0（v1 必做）** | 仓库识别、快照、本地更改树、暂存/取消暂存/丢弃、提交/修正/提交并推送、分支树只读 + 检出/新建/删除、日志只读 + 分支过滤 + 搜索 + 分页、提交详情 + 文件树 + 单文件 diff、Fetch、Update、错误与确认、控制台（只读记录） |
| **P1** | stash 面板、Revert/Cherry-Pick/Reset、标签、多选批量操作、收藏分支、ahead/behind 徽标、diff 上下文展开、冲突双栏对照、`.git` 监听自动刷新、撤销上次提交 |
| **P2** | Reword/Fixup/Squash/交互式 rebase、Shelf、变更列表、blame、PR/Issue 集成、签名校验、子模块操作、worktree 管理、多仓库子模块深度支持 |

---

## 4. 功能清单（编号 / 优先级 / 读写）

> 优先级：P0 = v1 必须；P1 = v1.1 重要增强；P2 = 后续。读写列指该功能是否修改仓库或工作区。

### 4.1 提交面板（区域 1）

| 编号 | 功能 | 优先级 | 读写 | git 语义 | 验收要点 |
|---|---|---|---|---|---|
| C-01 | 仓库状态快照 | P0 | 读 | `rev-parse` + `status --porcelain=v2` | 分支、ahead/behind、四类更改、进行中操作齐全 |
| C-02 | 更改树分组/三态复选框 | P0 | 读 | 同上 | 暂存/未暂存/未跟踪/冲突分组正确，目录三态正确 |
| C-03 | 状态着色与状态字母 | P0 | 读 | 同上 | M/A/D/R/C/U/? 颜色与字母符合 §5.2 |
| C-04 | 暂存 / 取消暂存 | P0 | 写 | `add` / `restore --staged` | 树立即刷新，日志不变 |
| C-05 | 丢弃更改 | P0 | 写 | `restore` / `clean -f` | 已跟踪与未跟踪分别确认；不可恢复提示 |
| C-06 | 提交 | P0 | 写 | `commit` | 只提交勾选路径；空信息禁用；成功后清空树 |
| C-07 | 修正上次提交 | P0 | 写 | `commit --amend` | 预填上次信息；无差异时只改信息 |
| C-08 | 提交并推送 | P0 | 写 | `commit` + `push` | 无上游时引导定义；push 失败保留提交并提示 |
| C-09 | 提交信息历史 | P1 | 本地 | — | 上/下键可调出最近 20 条 |
| C-10 | 搁置（stash） | P1 | 写 | `stash push/pop/apply/drop` | 列表、应用、删除、冲突提示 |
| C-11 | 提交前钩子输出 | P1 | 读 | `commit` stderr | 钩子失败展示输出并可重试 |
| C-12 | 冲突文件列表 | P1 | 读 | `status` 的 `u` 行 | 冲突置顶标红，提交被阻止并提示 |

### 4.2 分支树（区域 2）

| 编号 | 功能 | 优先级 | 读写 | git 语义 | 验收要点 |
|---|---|---|---|---|---|
| B-01 | 分支/远程/标签树 | P0 | 读 | `for-each-ref` | HEAD/本地/远程分组；当前分支加粗标记 |
| B-02 | 分支搜索 | P0 | 本地 | — | 实时过滤，保留祖先节点 |
| B-03 | 检出 | P0 | 写 | `switch`（旧版 `checkout`） | 脏工作区冲突时给出可解释失败 |
| B-04 | 新建分支 | P0 | 写 | `switch -c` | 可指定起点；可勾选立即检出 |
| B-05 | 删除分支 | P0 | 写 | `branch -d/-D` | 未合并默认拒绝；强制删除需勾选确认 |
| B-06 | 重命名 | P1 | 写 | `branch -m` | 保留 upstream 配置 |
| B-07 | 合并到当前分支 | P1 | 写 | `merge --no-edit` | 冲突进入进行中状态，可中止 |
| B-08 | 变基当前分支 | P1 | 写 | `rebase` | 脏工作区拒绝；冲突可中止 |
| B-09 | 与当前分支比较 | P1 | 读 | `diff` + `log` | 显示双向差异与提交对比 |
| B-10 | 跟踪分支 | P1 | 写 | `branch --set-upstream-to` | 设置/移除 upstream |
| B-11 | 收藏分支 | P2 | 本地 | — | 星标置顶，localStorage 持久 |

### 4.3 提交日志（区域 3）

| 编号 | 功能 | 优先级 | 读写 | git 语义 | 验收要点 |
|---|---|---|---|---|---|
| L-01 | 提交列表 | P0 | 读 | `log` | 主题/引用/作者/时间完整，分页正确 |
| L-02 | 提交图线 | P0 | 客户端 | 由 `%P` 计算 | 分叉/汇合正确，颜色稳定，跨页连续 |
| L-03 | 分支过滤 | P0 | 读 | `log <ref>` | chip 显示当前过滤分支，× 可清除 |
| L-04 | 文本或哈希搜索 | P0 | 读 | `--grep` / 哈希前缀 | 防抖 300ms；无结果空态 |
| L-05 | 用户过滤 | P1 | 读 | `--author` | 与搜索可叠加 |
| L-06 | 日期过滤 | P1 | 读 | `--since/--until` | 预设（今天/7 天/30 天）+ 自定义 |
| L-07 | 路径过滤 | P1 | 读 | `-- <path>` | 路径相对仓库根，非法路径提示 |
| L-08 | 分页/加载更多 | P0 | 读 | `--max-count/--skip` | 每页 100，滚动追加，不重复不丢行 |
| L-09 | 多选 | P1 | 本地 | — | 详情并集；批量动作按时间顺序 |
| L-10 | 右键写操作 | P1 | 写 | `revert/cherry-pick/reset/tag/branch` | 破坏性操作确认；成功后刷新 |
| L-11 | 改写历史（reword/fixup/squash） | P2 | 写 | `rebase -i` 脚本化 | 已推送时二次确认 |

### 4.4 提交详情（区域 4）

| 编号 | 功能 | 优先级 | 读写 | git 语义 | 验收要点 |
|---|---|---|---|---|---|
| D-01 | 提交元信息 | P0 | 读 | `show -s` | 信息全文、作者/提交者、时间、哈希、refs |
| D-02 | 所属分支列表 | P0 | 读 | `branch --contains` | `在 N 个分支中: …` 与截图一致 |
| D-03 | 文件树 | P0 | 读 | `diff-tree --name-status` | 目录分组、文件数、状态字母正确 |
| D-04 | 单文件 diff | P0 | 读 | `show/diff` | 统一 diff、行号、截断提示、二进制提示 |
| D-05 | 文件级操作 | P1 | 写 | `checkout <hash> -- <path>` | 还原单文件需确认 |
| D-06 | 父提交展示 | P1 | 读 | `%P` | 点击父提交可跳转详情 |

### 4.5 更新 / 获取 / 控制台 / 全局

| 编号 | 功能 | 优先级 | 读写 | git 语义 | 验收要点 |
|---|---|---|---|---|---|
| U-01 | 更新所选分支 | P0 | 写 | `pull`（merge/rebase） | 当前分支直接更新；非当前分支需确认检出；脏工作区拒绝 |
| F-01 | 获取所有远端 | P0 | 写 | `fetch --all --prune` | 不动工作区；更新远程分支与 ahead/behind |
| S-01 | 控制台记录 | P1 | 本地 | — | 记录 argv/cwd/退出码/耗时；失败可展开 |
| G-01 | 自动刷新 | P0 | 读 | 轮询 + 焦点刷新 | 2s 轮询（A 级）；空闲 10s；不可见即停 |
| G-02 | 多仓库选择 | P2 | 读 | `rev-parse` | 顶部下拉切换；记忆上次选择 |
| G-03 | 进行中操作横幅 | P1 | 读 | 检测 `.git/MERGE_HEAD` 等 | 显示继续/中止 |
| G-04 | detached HEAD 提示 | P0 | 读 | `symbolic-ref -q HEAD` | 黄条 +「检出分支」 |
| G-05 | 非仓库/空仓库提示 | P0 | 读 | `rev-parse --is-inside-work-tree` | 明确空态，不报错刷屏 |
| G-06 | 错误与确认 | P0 | — | — | 错误码 + 中文文案 + 原始输出；破坏性操作确认 |

---

## 5. DSH 落地设计

### 5.1 承载位置与信息架构

**结论：主面板（`main` 插槽，key = `git-workspace`）+ 侧边栏工具窗口图标（`sidebar.panellist`，id = `git-workspace`）。**

依据（来自运行时插槽目录）：

- `main` 是 keyed 插槽：「Central panel selected by sidebar entry id」，key 开放，当前只占用 `conversation`；
- `sidebar.panellist` 的目录说明是「Each list id addresses the matching main panel; the sidebar owns the button and resolves its label from list metadata」——即**侧边栏拥有按钮**，插件只提供图标组件与 label，点击后由产品把主面板切到同 id 的 key；
- 图标组件收到的 owner props 为 `{ size: number; active: boolean }`，`active` 可直接做选中态；
- `ctx.layout.selectPanel(panelId)` 可用于程序化打开（例如从提交通知、分支徽标跳转）。
- `main` 的注册**只有 `key`**，没有 order/label/ownerProps；排序与文案由 `sidebar.panellist` 的元数据决定；面板组件由框架注入 `useWorkspaces` / `usePanelInfo` / `useSessions` 等 hooks。
- **选中态不持久化**：DSH 的 layout store 是内存态（`activePanelId` 初始为 `null`），刷新页面会回到会话页。若希望「刷新后仍停在 Git」，插件需在 `localStorage` 记录并在挂载时调用 `ctx.layout.selectPanel('git-workspace')`（该 key 未注册时会抛错，调用前需确认已注册）。
- 主面板**没有多标签、没有分栏**能力：顶部「提交 / 日志 / 控制台」与三栏布局全部是插件自建 DOM/CSS。
- **右侧栏与主面板互斥**：主面板活跃时 `sidebarRight.mounted === undefined`，且分栏最多两栏；右侧栏只能作为「在侧栏打开某个 commit 的 diff / 分支比较」的补充视图（P1），不能承载主窗口。

备选方案对比：

| 方案 | 优点 | 缺点 | 结论 |
|---|---|---|---|
| 主面板 + 侧边栏图标 | 宽度足够做三栏；常驻、可切换；与 IDEA 工具窗口心智一致 | 需要自己做窗口内标签页 | **采用** |
| 右侧栏 tab（`sidebar.right.pane.tab`） | 与文件/预览并列 | 宽度 360–480，放不下三栏；与主面板互斥（主面板活跃时右栏不挂载）；分栏最多两栏 | 不采用为主载体（可作补充视图，P1） |
| Conversation view 标签页 | 无需新入口 | 只在会话内可见，不是全局工具窗口 | 不采用 |
| `shell.bottom` | 最像 IDEA 底部停靠 | **该版本不存在这个插槽键**（`shell.*` 只有 leading / overlay / quota-notice），无法承载 | 不存在，不采用 |

**注册代码（客户端）**：

```ts
// src/git-workspace/panel.ts
import type { Context } from '@deepseek-ai/cordis'

export function installGitWorkspacePanel(ctx: Context): void {
  const slots = lookup<SlotsService>(ctx, 'slots')
  if (slots === undefined) return

  // 侧边栏图标：产品负责按钮、选中与切换；本插件只画图标。
  ctx.effect(() => slots.inject('sidebar.panellist', () => slots.register(
    { name: 'sidebar.panellist', id: 'git-workspace', order: 30, label: 'Git' },
    GitPanelIcon, // (props: { size: number; active: boolean }) => ReactElement
  )), 'git-workspace: panel icon')

  // 主面板：key 必须与上面 id 相同。
  ctx.effect(() => slots.inject('main', () => slots.register(
    { name: 'main', key: 'git-workspace' },
    GitPanel,
  )), 'git-workspace: main panel')
}
```

由 `src/session-map/index.ts`（浏览器半唯一入口）调用一次；现有「从 Git 克隆」设置页保留不动，两者共用 `/plugin-git-workspace` 路由族。

**面板内部结构**：因为 DSH 没有底部停靠，把 IDEA 的两个工具窗口合并为一个带标签页的主面板：

```
┌ Git  [工作区: dsh-session-map ▾]      [刷新] [获取] [推送] [设置] ┐
│ 提交 | 日志 | 控制台                                               │
├───────────────────────────────────────────────────────────────────┤
│ 提交页：更改树（自适应） / 提交表单（420px，窄屏改为上下堆叠）      │
│ 日志页：分支树 260px │ 提交列表 flex │ 提交详情 360px（可拖拽）     │
│ 控制台：全宽命令日志                                               │
└───────────────────────────────────────────────────────────────────┘
```

- **工作区选择器是必需的**：DSH 是「多 Workspace」模型，而 IDEA 是「单 Project」；主面板不绑定会话，因此顶部必须能选工作区，并记忆上次选择（`localStorage: dsh.git-workspace.repo`）。
- 面板宽度 < 1100px：提交页改为单列（树在上、表单在下），日志页隐藏详情列（点击某行后以抽屉覆盖）；< 780px：分支树折叠为下拉。
- 标签页状态保存在 `localStorage`（`dsh.git-workspace.tab`），重开面板回到上次标签。
- 注册到 `main` 的组件卸载即停止轮询；重新进入面板时重新拉快照。

### 5.2 视觉规格

**主题变量（全部复用现有 token，不写死颜色）**

| 用途 | token |
|---|---|
| 面板底色 | `--dsw-alias-bg-base` |
| 卡片/行底色 | `--dsw-alias-bg-layer-1` |
| hover / 选中底色 | `--dsw-alias-bg-layer-2` |
| 浮层（菜单/确认框） | `--dsw-alias-bg-overlay` |
| 分隔线 | `--dsw-alias-border-l1` |
| 控件边框 | `--dsw-alias-border-l2` |
| 主文本 | `--dsw-alias-label-primary` |
| 次要文本（路径/作者/时间） | `--dsw-alias-label-secondary` |
| 品牌色（选中、主按钮、链接） | `--dsw-alias-brand-primary` |
| 错误/危险 | `--dsw-alias-state-error-primary` |
| 成功 | `--dsw-alias-state-success-primary` |
| 警告（detached、进行中） | `--dsw-alias-state-warn-primary` |

**Git 语义色（优先复用产品 token；没有对应 token 时用插件自定义 `--dgw-*`，深浅色各一套，`light-dark()` + `color-scheme` 兜底）**

| 语义 | 深色 | 浅色 |
|---|---|---|
| 修改 M / 重命名 R | `#4d9fec` | `#1a5fb4` |
| 新增 A / 未跟踪 ? | `#73c991` | `#1a7f37` |
| 删除 D | `#9aa0a6` | `#6e7781` |
| 冲突 U | `#f14c4c` | `#cf222e` |
| 暂存区标题 | `#e5c07b` | `#9a6700` |
| diff 新增行 | `--dsw-alias-file-diff-added-bg` / `-gutter` / `-marker`（以及 `--dsw-alias-code-diff-*`） | 直接复用产品 token，不自造 rgba |
| diff 删除行 | `--dsw-alias-file-diff-deleted-bg` / `-gutter` / `-marker`（以及 `--dsw-alias-code-diff-*`） | 同上 |
| 图线 lane 1–8 | `#4f9cf9 #b48ead #7ec699 #e8a87c #f07178 #56b6c2 #e5c07b #c678dd` | 同色降饱和 20% |

**尺寸**

| 元素 | 值 |
|---|---|
| 面板标题栏 | 40px |
| 标签页栏 | 32px |
| 工具栏 | 32px |
| 树/列表行高 | 24px（紧凑 22px） |
| 文件图标 | 16px |
| 状态字母 | 10px，700 字重，等宽 |
| 分支树默认宽 | 260px（可拖 200–360） |
| 详情默认宽 | 360px（可拖 300–520） |
| 提交表单宽 | 420px（窄屏堆叠） |
| 拖拽条 | 4px，hover 显示品牌色 |
| 滚动条 | 复用产品默认样式，不自绘 |

**图标**：内联 SVG（16px，`stroke-width: 1.5`，`currentColor`），沿用 `src/session-map/views.ts` 的内联 SVG 做法，不引入图标库。至少需要：分支、远程分支、标签、提交、合并、变基、检出、更新、获取、推送、暂存、冲突、刷新、更多、文件夹、文件。

### 5.3 交互规格

**选择模型（面板级单一状态）**

```ts
interface GitPanelSelection {
  workspaceId: string | null      // 顶部工作区选择
  tab: 'commit' | 'log' | 'console'
  commitSelection: string[]       // 提交哈希，可多选
  branchRef: string | null        // 分支树选中项
  focusedPath: string | null      // 当前查看 diff 的文件
  filters: LogFilters             // 搜索/作者/日期/路径/分支
}
```

- 单选提交 → 详情立即加载；多选 → 详情展示并集；切换分支 → 清空提交选择、重置分页、重新拉 log。
- 所有异步请求带 `AbortController`：切换选择/卸载面板时中止旧请求，防止竞态覆盖。
- 刷新不闪屏：保留旧数据，加载中新数据到达后原地替换（stale-while-revalidate）。

**面板恢复**：`activePanelId` 不持久化，刷新后主面板会回到会话页。插件在 `localStorage` 记 `dsh.git-workspace.panelOpen`；面板组件挂载时若该值为 `true` 且 main 槽已注册，调用 `ctx.layout.selectPanel('git-workspace')` 恢复，关闭时写 `false`。`selectPanel` 对未注册 key 会抛错，调用前先判断注册状态。

**确认弹层（自建，无产品对话框服务）**

| 操作 | 确认级别 | 文案要点 |
|---|---|---|
| 丢弃已跟踪更改 | 普通确认 | 列出文件数；「此操作不可撤销」 |
| 丢弃未跟踪文件 | 危险确认 | 红色主按钮；「文件将被永久删除」 |
| Reset --hard | 危险确认 | 目标哈希；「本地未提交更改将丢失」 |
| 删除未合并分支 | 危险确认 | 勾选「强制删除」后才用 `-D` |
| 强推 | 危险确认 | 必须勾选 `--force-with-lease`；默认不提供 |
| 检出到非当前分支（Update 5） | 普通确认 | 「将切换工作区到 <branch> 并拉取」 |

**键盘**（§8.1 为总表）：`Ctrl/Cmd+Enter` 提交；`F5` 刷新；`Ctrl/Cmd+Shift+K` 推送；`Ctrl/Cmd+T` 更新；`Ctrl/Cmd+Shift+F` 获取；`Ctrl/Cmd+D` 显示差异；`Delete` 丢弃（需确认）；`Space` 勾选；`Esc` 关闭浮层/抽屉。

**空态 / 加载 / 错误**

| 状态 | 表现 |
|---|---|
| 未选择工作区 | 居中提示「选择工作区以查看 Git 状态」 |
| 工作区不是仓库 | 「当前工作区不是 git 仓库」+「初始化仓库」（P2） |
| 无更改 | 「没有要提交的内容，工作树是干净的」 |
| 无提交 | 「仓库还没有提交」 |
| 加载中 | 骨架行（列表 3 行灰条），不显示转圈遮罩 |
| 请求失败 | 顶部错误条：错误码对应中文 +「重试」+「查看详情」（展开原始 stderr） |
| 大仓库截断 | 行尾提示「结果已截断（上限 1MB）」 |

### 5.4 客户端数据模型

```ts
/** 一次快照：四区渲染的最小集合；轮询的最小单元。 */
interface RepoSnapshot {
  takenAt: number
  stale: boolean                      // 写操作进行中，内容为上一版成功快照
  truncated: boolean                  // 任一子查询因上限被截断
  repo: { root: string; gitDir: string; commonDir: string; isBare: boolean; isWorktree: boolean }
  head: {
    oid: string | null; ref: string | null; shortName: string | null
    detached: boolean; unborn: boolean                          // unborn = 空仓库（无首个提交）
    upstream: { ref: string; ahead: number; behind: number; gone: boolean } | null
    operation: 'none' | 'merge' | 'rebase' | 'rebase-apply' | 'cherry-pick' | 'revert' | 'bisect'
  }
  changes: ChangedEntry[]
  counts: { staged: number; unstaged: number; untracked: number; conflicted: number }
  stashCount: number
  branches: BranchRef[]
  tags: TagRef[]
  remotes: Array<{ name: string; url: string }>
}

interface ChangedEntry {
  path: string
  origPath?: string                                  // 仅重命名/复制
  xy: { index: string; worktree: string }            // porcelain v2 的两位状态
  kind: 'ordinary' | 'renamed' | 'unmerged' | 'untracked' | 'ignored'
  conflict?: { stages: [string | null, string | null, string | null] }  // u 行的三份 blob
  binary?: boolean
}

interface BranchRef {
  ref: string; name: string; oid: string
  type: 'local' | 'remote' | 'tag'
  isHead: boolean
  upstream?: string
  track?: { ahead: number; behind: number; gone: boolean }
  date: string; subject: string
}

interface CommitRow {
  oid: string; shortOid: string; parents: string[]
  author: { name: string; email: string; date: string }
  committer: { name: string; email: string; date: string }
  subject: string
  decorations: string[]                               // 仅展示，不可反解析（§5.6.4）
}

interface CommitDetail extends CommitRow {
  message: string                                     // %B，保留换行与 Co-authored-by
  files: FileChange[]
  containedInBranches: string[]                       // for-each-ref --contains
}

interface FileChange {
  path: string; origPath?: string
  status: 'A' | 'M' | 'D' | 'R' | 'C' | 'T' | 'U'
  additions: number | null; deletions: number | null  // 二进制为 null
  binary: boolean
}

interface DiffView {
  path: string; binary: boolean; truncated: boolean
  hunks: Array<{
    oldStart: number; oldLines: number; newStart: number; newLines: number
    lines: Array<{ kind: '+' | '-' | ' '; text: string; oldLine: number | null; newLine: number | null }>
  }>
}
```

- 时间统一用 epoch（`%at/%ct`，秒）或 iso-strict 字符串，由客户端本地化；不依赖宿主 locale/时区。
- 图线在客户端用 `CommitRow.parents` 增量计算（复用 `src/session-map/graph.ts` 的泳道思路）；宿主禁用 `--graph`。
- 页缓存 key = `repo + ref + filters`；写操作后整表失效。详情按 oid 缓存（上限 50 条）。
- `unborn` 仓库不调用 `log`（会 128），日志页直接空态；状态树仍可用。

### 5.5 宿主 API 设计

沿用现有路由族 `/plugin-git-workspace` 与信封格式，新增子路径（全部同源、GET 读 / POST 写）：

| 方法 | 路径 | 入参 | 返回 | 说明 |
|---|---|---|---|---|
| GET | `/snapshot` | `workspaceId` | `{ ok, version, stale?, truncated?, repo }` | 轮询入口；包含 head、四类更改、分支/标签/远端、stashCount、进行中操作 |
| GET | `/log` | `workspaceId`、`ref?`、`limit=50`、`skip=0`、`query?`、`author?`、`since?`、`until?`、`file?` | `{ ok, commits, hasMore, truncated? }` | 单页上限 100；默认只查当前分支 |
| GET | `/commit` | `workspaceId`、`hash` | `{ ok, commit }` | 元数据 + `show --first-parent` 文件列表 |
| GET | `/diff` | `workspaceId`、`hash?`、`file`、`staged?`、`context=3` | `{ ok, diff }` | 工作区/暂存/提交三种来源 |
| GET | `/console` | `workspaceId`、`since` | `{ ok, entries }` | 控制台增量读取（P1） |
| POST | `/action` | `{ kind, workspaceId, ... }` | `ActionEnvelope` | 统一写入口；同步动作直接返回 result，长任务返回 job |
| GET | `/job` | `id` | `{ ok, job }` | 作业状态（进度行、完成/失败/中断） |
| POST | `/cancel` | `{ id }` | `{ ok }` | 取消作业；**必须显式调用**——`/action` 返回 job 后连接关闭不等于取消 |
| GET | `/events` | `workspaceId` | `text/event-stream` | v1 即用 SSE 推送快照变化与作业进度（handler 持有响应生命周期，gzip 会跳过 `event-stream`）；断线时客户端退回 `/snapshot` 轮询 |
| GET | `/repos` | `workspaceId` | `{ ok, repos }` | 仓库识别（子模块/嵌套仓库，P2） |

**统一约定**

- 响应信封：`{ ok: true, ... } | { ok: false, error: { code, message, detail? } }`；HTTP 状态沿用现有 clone 端点风格（400/401/404/409/500/502/504）。
- 只接受 `application/json`，body ≤ 16KB；`Host`/`Origin`/socket 对端必须本机（复用 `isTrustedRequest`）。
- **路径白名单**：客户端只传 `workspaceId`；宿主用 `workspaceRegistry.get(id)` 取路径，`rev-parse --show-toplevel` 得到仓库根后 `realpath` 校验仍在 Workspace 内。**不接受任意绝对路径**，避免插件变成任意目录的 git 执行器。
- **作业模型**：fetch/update/push/checkout 等可能 >2s 的操作返回 `job.id`；客户端通过 `/events`（SSE）接收进度，断线时退回 500ms 轮询 `/job`。取消必须显式 `POST /cancel`——`/action` 返回 job 后连接关闭不等于取消。读操作同步返回。
- **响应上限**：总响应 16MiB 硬保护；snapshot 8MiB；log 1MiB/页；详情 2MiB（>300 文件截断并标记）；单文件 patch 2MiB（展示截断 512KiB）；超限一律 `truncated: true`，UI 明示「仅显示前 N 项」。
- **命令回执**：每个响应带 `result.commands`（argv、cwd、exitCode、ms），客户端写入「控制台」；URL 中的凭证写回执前脱敏。
- **404/空态语义**：未注册的 `workspaceId` → 404；不是 git 仓库 → `200 + { ok:false, error.code:'not-a-repository' }`（面板渲染空态而非错误页）。

### 5.6 git 执行层规范

#### 5.6.1 公共前缀与环境

读操作前缀（`-C` 固定仓库根，不经 shell）：

```ts
const READ = [git, '-C', root, '--no-pager', '--no-optional-locks',
  '-c', 'core.quotepath=false', '-c', 'color.ui=false', '-c', 'core.pager=cat',
  '-c', 'log.showSignature=false', '-c', 'i18n.logOutputEncoding=UTF-8']
```

写操作前缀去掉 `--no-optional-locks`，并追加：

```ts
const WRITE = [git, '-C', root, '--no-pager',
  '-c', 'core.quotepath=false', '-c', 'color.ui=false', '-c', 'core.pager=cat',
  '-c', 'core.editor=false', '-c', 'sequence.editor=false']   // 误开编辑器时立即失败，而不是挂到超时
```

环境变量（继承宿主环境后覆盖；`spawn({env})` 是合并还是替换**待核实**，若是替换必须补齐 `PATH`/`HOME`/`USERPROFILE`/`SystemRoot`）：

| 变量 | 值 | 目的 |
|---|---|---|
| `LC_ALL` / `LANG` / `LANGUAGE` | `C` | 错误输出固定英文，便于 stderr 分类；日期仍用 iso-strict/epoch |
| `GIT_TERMINAL_PROMPT` | `0` | 禁止 git 在服务端弹凭证提示 |
| `GIT_OPTIONAL_LOCKS` | `0` | 只读命令不抢 `index.lock`（对忘记加 flag 的调用兜底） |
| `GIT_LITERAL_PATHSPECS` | `1` | 路径按字面处理，禁用 `:(glob)` 等 pathspec 魔法（安全关键） |
| `GIT_PAGER` / `PAGER` | `cat` | 防分页 |
| `GIT_MERGE_AUTOEDIT` | `no` | merge 不自动开编辑器 |
| `GIT_EDITOR` / `GIT_SEQUENCE_EDITOR` | `:` | 兜底；正常路径仍必须显式给消息或 `--no-edit` |

- **版本门槛**：`git --version` 解析并缓存，低于 2.30 直接提示升级；只在较新版本出现的选项用 `git <cmd> -h` 做一次性能力探测（退出码 129 属正常），不猜版本号。`rev-parse --path-format` 需 2.31+，2.30 基线用 `--show-toplevel` 自行归一化。
- **`stdin: 'ignore'` 的硬约束**：`commit -F -`、无文件参数的 `apply`、`check-ignore -z`（要求 `--stdin`）等不可用；提交信息一律 `-m <msg>`，merge 收尾用 `--no-edit`。

#### 5.6.2 读命令

| 数据 | argv（省略公共前缀） | 解析要点 |
|---|---|---|
| 仓库边界 | `rev-parse --is-inside-work-tree --show-toplevel --show-prefix --is-bare-repository --git-dir --git-common-dir` | 逐行输出；`git-common-dir ≠ git-dir` 即 linked worktree；Windows 返回 `C:/…` 正斜杠；非仓库 128 |
| 工作区状态 | `status --porcelain=v2 -z --branch --show-stash --untracked-files=normal` | 轮询用 `-uno`（廉价版）；展开未跟踪时 `-uall`；`# stash N` 省一次 stash 进程 |
| 分支/标签/远端 | `for-each-ref --format='…' refs/heads refs/remotes refs/tags` | 字段 `%00` 分隔，记录按换行；`%(HEAD)` 为 `*` 或空格；`%(upstream:track)` 形如 `[ahead 1, behind 2]` / `[gone]` |
| 上游计数（懒） | `rev-list --count --left-right '<branch>...<upstream>'` | 输出 `L\tR`；无上游 128 |
| stash | `stash list -z --format='%gd%x1f%H%x1f%ct%x1f%s'` | 不要传 `--date`（会把 `%gd` 变成 ISO 时间） |
| 操作标记 | `rev-parse --git-path MERGE_HEAD --git-path rebase-merge --git-path rebase-apply --git-path CHERRY_PICK_HEAD --git-path REVERT_HEAD --git-path BISECT_LOG --git-path sequencer` | 逐行返回路径后由 fs 服务 `stat` 是否存在；不读内容 |
| 提交元数据 | `show -s -z --format='%H%x1f%h%x1f%P%x1f%an%x1f%ae%x1f%at%x1f%cn%x1f%ce%x1f%ct%x1f%D%x1f%B' <hash>` | `-s` 不可与 `--name-status` 同用（fatal）；`%B` 含换行，只能靠 `%x1f` 分隔 |
| 提交文件列表 | `show --first-parent --format= --name-status -z -M <hash>` | **merge 提交默认 `--cc` 输出为空，必须 `--first-parent`** |
| 提交文件统计 | `show --first-parent --format= --numstat -z -M <hash>` | 二进制为 `-\t-`；与列表按 (old,new) 对齐 |
| 所属分支 | `for-each-ref --contains <hash> --format='%(refname:short)' refs/heads refs/remotes` | 一次进程拿到「在 N 个分支中」 |
| 工作区 diff | `diff --no-color --no-ext-diff --no-textconv --unified=3 -- <path>` | 暂存区加 `--cached` |
| 提交内 diff | `show --no-color --no-ext-diff --no-textconv --format= --unified=3 <hash> -- <path>` | 根提交也适用 |
| 日志页 | `log <ref> --max-count=50 --skip=0 -z --format='%H%x1f%h%x1f%P%x1f%an%x1f%ae%x1f%ad%x1f%cn%x1f%ce%x1f%cd%x1f%D%x1f%s' --date=iso-strict` | 记录以 NUL 分隔；`%P` 供客户端画泳道；**禁用 `--graph`**；不要加 `--no-decorate` |
| 日志过滤 | 追加 `--grep=<q> [-F]`、`--author=<a>`、`--since=<d>`、`--until=<d>`；路径在 `--` 之后 | 用户输入作为独立 argv，绝不拼 shell/正则字符串；各条件 AND |
| 远端 | `remote -v` | `<name>\t<url> (fetch\|push)` |
| 配置 | `config --get <key>` | 缺键退出码 1；`--list -z` 是 `key<LF>value<NUL>` |
| 冲突文件 | `diff --name-only --diff-filter=U -z` | 与 status `u` 行互为校验 |
| 祖先判断 | `merge-base --is-ancestor <a> <b>` | 0 是 / 1 否 / 128 对象缺失 |

#### 5.6.3 写命令

| 动作 | argv（省略公共前缀） | 要点 |
|---|---|---|
| 暂存 | `add -A -- <paths…>`；全部 `add -A` | 不自动 `-f`（不暂存 ignored） |
| 取消暂存 | `restore --staged -- <paths…>` | **unborn HEAD 上会 128**（`could not resolve HEAD`）→ 改用 `rm --cached -- <paths…>` |
| 丢弃已跟踪 | `restore --worktree --source=HEAD -- <paths…>`；连暂存一起丢 `restore --staged --worktree --source=HEAD -- <paths…>` | 只对 HEAD 中存在的路径有效 |
| 丢弃未跟踪 | `clean -nd -- <paths…>`（预览）→ `clean -fd -- <paths…>` | 危险确认；**绝不自动加 `-x`**；先按快照确认路径确为未跟踪 |
| 提交 | `commit -m <msg> --cleanup=whitespace [-- <paths…>]` | 消息是单个 argv，可含换行；带 pathspec = `--only` 语义，不误提交其他已暂存内容；`--cleanup=whitespace` 保留 `#` 开头行 |
| 修正 | `commit --amend -m <msg>`；只改信息 `commit --amend --no-edit` | 无文件变更时只改提交信息 |
| 推送 | `push --porcelain --progress [--dry-run] [-u] <remote> <local>:<remote>` | 默认不带 force；强推仅 `--force-with-lease`（L3）；`--dry-run` 先展示将改的 ref |
| 获取 | `fetch --prune [--all \| <remote>]` | 不解析 fetch 输出，用 refs 前后快照 diff 判断变化 |
| 更新（当前分支） | `fetch` 后 `merge --no-edit @{upstream}` 或 `rebase @{upstream}` | 分两步执行；rebase 可选 `--autostash`（用户显式开启） |
| 更新（非当前分支） | `fetch <remote> <branch>:<branch>`（仅未检出 + 可快进），或先 `switch` 再更新 | 默认选「检出后更新」，确认框写明会切换工作区 |
| 检出 | `switch <branch>`；新建跟踪 `switch -c <local> --track <remote>/<branch>`；分离 `switch --detach <hash>`；强制 `switch -f`（L2） | 旧 git fallback `checkout`；分支名先 `check-ref-format --branch` 校验 |
| 新建/删除/重命名分支 | `branch <name> [<start>]`、`branch -d\|-D <name>`、`branch -m <old> <new>`、`branch --set-upstream-to=<remote>/<b> <branch>` | `-d` 未合并会 1 并提示用 `-D`；`-D` 需确认 |
| 合并 | `merge --no-edit <ref>`；仅快进 `merge --ff-only`；强制合并点 `merge --no-ff -m <msg>` | 冲突 exit 1 + `CONFLICT` + `u` 行 + `MERGE_HEAD` |
| 变基 | `rebase <upstream>`；中止/继续/跳过 `rebase --abort\|--continue\|--skip` | **禁用 `-i`**；冲突目录 `rebase-merge` 或 `rebase-apply` |
| 拣选/撤销 | `cherry-pick <hash…>`；`revert --no-edit <hash>` | 多选按时间顺序；revert merge 提交需 `-m 1` |
| 重置 | `reset --soft\|--mixed <hash>`（L1/L2）、`reset --hard <hash>`（L2） | hard 不清理未跟踪文件；soft/mixed 可经 reflog 恢复 |
| 搁置 | `stash push -m <msg> [-u]`、`stash apply [--index] <ref>`、`stash pop <ref>`、`stash drop <ref>`（L2） | pop 冲突时 stash 保留并 exit 1 |
| 标签 | `tag <name> [<hash>]`；附注 `tag -a <name> -m <msg>`；删除 `tag -d <name>`（L2） | `-a` 必须给 `-m`（否则开编辑器） |
| 继续/中止 | `merge --abort`、`cherry-pick --abort\|--continue`、`revert --abort` | 中止类操作需要二次确认 |

#### 5.6.4 解析规范

**`status --porcelain=v2 -z`**：整条流是 **NUL 结尾的记录序列（含 `#` 头）**，不能按行切。

| 记录 | 结构 | 说明 |
|---|---|---|
| `# branch.oid` | oid 或 `(initial)` | `(initial)` = 空仓库 |
| `# branch.head` | 分支名或 `(detached)` | detached 时没有 upstream/ab 头 |
| `# branch.upstream` / `# branch.ab` | `+A -B` | 仅上游存在且可达时出现 |
| `# stash N` | `--show-stash` 且非 0 时 | 一次 status 拿 stash 计数 |
| `1` | `XY sub mH mI mW hH hI <path>` | `XY[0]`=暂存、`XY[1]`=工作区，`.` 为无变化；path 可含空格，**定长字段后取剩余，不能 split(' ')` |
| `2` | 同 `1` + `X<score> <path>\0<origPath>` | `-z` 下两个路径各占一个 NUL 字段 |
| `u` | `XY sub m1 m2 m3 mW h1 h2 h3 <path>` | 未合并；XY ∈ DD/AU/UD/UA/DU/AA/UU |
| `?` | `<path>` | 未跟踪；`-u normal` 下目录折叠为 `dir/` |
| `!` | `<path>` | 仅 `--ignored` 时出现 |

**`log -z --format`**：字段用 `%x1f`、记录用 NUL；**不要用 `%x00` 作字段分隔**（与记录分隔冲突）。`%D` 形如 `HEAD -> main, tag: v1, side`，因分支名可含逗号**只用于展示、不可反解析**；「在 N 个分支中」用 `for-each-ref --contains`。空仓库 `log` 退出 128，先判 `(initial)` 跳过。

**for-each-ref**：`%00` 分隔字段、换行分隔记录；`%(HEAD)` 当前分支为 `*`、其余为空格（trim）；`%(upstream:track)` 可为空 / `[behind 2]` / `[gone]`。

**stash list**：`%gd` 在传 `--date` 时会变成 `stash@{<iso>}`，列表不要传 `--date`。

**diff**：`--numstat -z` 的重命名项是 `ins\tdel\t` 后接**空字段 + NUL + old + NUL + new + NUL**；`--name-status -z` 为重命名三项。hunk 解析放客户端纯函数（识别 `@@`、`+`/`-`/空格、`\ No newline at end of file`）。

**config**：`--list -z` 每项是 `key<LF>value<NUL>`，不是 `key=value`；定向读取优先 `config --get`（缺键 exit 1）。

#### 5.6.5 退出码、编码与截断

| 退出码 | 含义 | 典型场景 |
|---|---|---|
| 0 | 成功，但不代表有内容 | 空 diff、up-to-date、status 恒 0 |
| 1 | 语义失败 | 冲突、`commit` 无变更、hook 失败、push 被拒、`branch -d` 未合并、`config --get` 缺键 |
| 2 / 129 | 用法错误 | argv 构造 bug；`git <cmd> -h` 正常退出 129 |
| 128 | fatal | 非仓库、空仓库 `log`、`index.lock`、认证/网络、`dubious ownership` |
| 126 / 127 | 无法执行 | git 路径/权限问题 |
| `null` | 被信号杀死 | 取消/超时（Windows 上为 null + signal） |

- **冲突永不靠退出码判定**：冲突 = 1，但 1 还可能是 hook、无变更、push 拒绝。判定 = status 有 `u` 行，或 §5.6.2 的操作标记存在。
- 解码：`-z` 是原始字节，Linux 上可能非 UTF-8 文件名 → lossy UTF-8 解码并在 UI 标 `encoding-lossy`，**该类路径禁止用于写操作**。
- 截断：`stdout.maxBytes` 截断时退出码仍可能 0 → 解析器必须发现「记录不完整」（字段数不足/无结尾 NUL）并给快照打 `truncated: true`，绝不静默展示半条数据。

#### 5.6.6 刷新、并发、锁与取消

- **A 级刷新（轮询/事件后，≤3 个进程）**：缓存的仓库根 + `status -uno` +（refs 信号变化时）`for-each-ref`，约 120ms。
- **B 级刷新（面板打开/写操作后，≤6 个进程）**：A 级 + 全量 `status` + `stash list` + `remote -v` + 操作标记，目标 <300ms。
- **C 级（按需懒加载）**：日志页、提交详情、diff、上游计数；展开才拉，禁止每次轮询都跑 `log --all`、全量 diff、blame。
- 轮询：可见且聚焦 2s 一次 A 级；空闲 60s 后 10s；不可见停止；`visibilitychange` 回前台立即刷新。大仓库（status >1.5s 或跟踪文件 >50k）关闭自动全量，只保留手动/操作后刷新。
- 监听：`<git-common-dir>` 非递归（`HEAD`/`index`/`packed-refs`/`FETCH_HEAD`/`ORIG_HEAD`/`refs/stash`）+ `refs/` 递归；工作区仅当文件数 <20k 且平台支持递归 watch 时启用，否则轮询。事件 150–300ms 防抖；Windows 上「临时文件+rename」可能漏事件，300ms 后再 stat 二次确认。
- 并发：**每仓库一个写队列**（add/commit/switch/merge/rebase/reset/stash/push/pull 串行）；读操作同仓库 ≤4；网络操作独占仓库锁并在 UI 显示 busy；写期间允许 A 级读，C 级大读暂缓。
- `index.lock`：写命令遇锁重试 3 次 ×200ms，仍失败报 `lock`；**绝不自动删锁**。
- 取消：读 5–15s、本地写 60s、网络 120s、clone 15min，全部经 `AbortSignal` + `graceMs`。被信号杀死后必须重跑操作标记探测 + status，把「操作中断、状态可能不一致」写进快照并提示 `--abort`/`--continue`；写操作取消/超时后先探测「是否其实已成功」（HEAD/refs 是否变化），UI 区分「已取消」与「已取消但可能已生效」。

#### 5.6.7 超时与限额

| 类别 | 超时 | 输出上限 |
|---|---|---|
| 读（status/refs/log/diff） | 5–15s | status 8MiB/20k 记录；log 1MiB/页；详情 2MiB；单文件 patch 2MiB（展示 512KiB） |
| 本地写（add/commit/reset/merge/rebase） | 60s | 1MiB |
| 网络（fetch/pull/push） | 120s | 1MiB |
| 检出/切换 | 5min | 1MiB |
| hook | 5min | 1MiB |
| 总响应 | — | 16MiB 硬保护 |

- 关闭昂贵能力：`--no-ext-diff`、`--no-textconv`、`-c log.showSignature=false`、不用 `--graph`、不用 `--follow`；大提交（>1000 文件）可降级 `--no-renames` 并标「未做重命名检测」；二进制/超大 diff 只给入口，点开再单独请求并强制截断。

#### 5.6.8 平台差异

| 维度 | Windows | macOS | Linux |
|---|---|---|---|
| 路径 | toplevel 为 `C:/…` 正斜杠；显示转 `\`；长路径需 `core.longpaths`；大小写不敏感 | 大小写不敏感；文件名可能 NFD，比较前 `normalize('NFC')` | 大小写敏感；文件名可能非 UTF-8 |
| 换行 | `core.autocrlf` 常见 true，status/diff 会有 LF→CRLF 警告；不改写仓库配置 | 一般 false | 一般 false |
| 锁/IO | 杀软/索引器导致 rename 短暂失败 → 重试；`index.lock` 残留概率高 | 正常 | inotify watch 数量有限，大目录递归 watch 慎用 |
| 进程 | 创建约 40ms，批量调用更划算 | 较快 | 最快 |

入库路径统一用 `/`；`--git-dir`/`--git-common-dir` 可能是相对路径 → 与 cwd 拼接后再 stat/比较。

#### 5.6.9 实测陷阱清单

1. `show <merge>` 默认 `--cc` 文件列表为空 → 必须 `--first-parent`；`show -s --name-status` 直接 fatal。
2. `status -z` 每条记录（含 `#` 头）都以 NUL 结尾，不能按行切。
3. `1` 行 path 可含空格 → 定长字段后取剩余。
4. 空仓库 status 头是 `# branch.oid (initial)`；`log`/`rev-parse --verify HEAD` 会 128。
5. `commit` 无变更退出 1，提示在 stdout（`nothing to commit`）。
6. `merge --abort` 无进行中合并 → 128，不是 0。
7. unborn HEAD 上 `restore --staged` → 128；改用 `rm --cached`。
8. `%D` 逗号分隔不可解析（分支名可含逗号）；用 `for-each-ref --points-at/--contains` 做精确映射。
9. `stash list` 的 `%gd` 传 `--date` 会变成 `stash@{<iso>}`。
10. `config --list -z` 是 `key<LF>value<NUL>`。
11. 输出被 `maxBytes` 截断时退出码仍 0 → 必须检测不完整记录。
12. `stdin:'ignore'` 使 `commit -F -`、无文件 `apply`、`check-ignore -z` 不可用。
13. `status` 不返回「正在 merge/rebase」→ 用 `rev-parse --git-path` + stat。
14. 只读命令也会写 index（status 刷新）：不加 `--no-optional-locks` 会污染 mtime、和外部 git 抢锁。
15. push 无 upstream 退出 128（不是 1）。
16. hook/编辑器/凭证弹窗都可能让进程「假死」：必须超时 + `--no-verify` 开关 + 关闭编辑器。
17. 写前路径可能已消失：`add -A -- <gone>` 会 128（`pathspec did not match`）→ 写前按快照校验存在性，128 后立即刷新并提示「文件已变化」。

### 5.7 安全与权限

| 层面 | 措施 |
|---|---|
| 请求可信 | 复用 `isTrustedRequest`：socket 对端 + Host + Origin 三段校验；只收 `application/json`；无 CORS 头 |
| 路径边界 | 只接受 `workspaceId`；宿主解析仓库根后 `realpath`，必须落在注册 Workspace 内；拒绝 `..`、绝对外部路径、NUL/控制字符；跨平台大小写规则见 §5.6.8；所有路径参数放在 `--` 之后，配合 `GIT_LITERAL_PATHSPECS=1` |
| 引用名校验 | 分支/标签名先 `check-ref-format --branch`；引用名不作为首个 argv（`switch -- <name>`） |
| 破坏性分级 | 见下表 L0–L3；确认框展示将执行的 git 命令与受影响文件/提交 |
| 凭证 | 不接收密码；`GIT_TERMINAL_PROMPT=0`；依赖系统 SSH agent / Git Credential Manager；`GCM_INTERACTIVE=never` 作为可选加固（是否生效待核实）；检测 stderr `Permission denied (publickey)` / `Host key verification failed` 并提示先在终端完成认证 |
| hook | 默认执行用户 hook（pre-commit/commit-msg/pre-push）；失败展示输出并中止；「跳过 hook（--no-verify）」只作为显式设置项，默认关 |
| `safe.directory` | 2.35+ 遇 `detected dubious ownership` 返回 128 → 提示用户自行执行 `git config --global --add safe.directory <path>`；**不默认加 `-c safe.directory=*`** |
| 审计 | 实际 argv（URL 脱敏）、cwd、exitCode、耗时写入「控制台」；不记录凭证 |
| Agent 边界 | 这些路由只服务 UI，不注册为工具，Agent 无法直接调用；路由仍限本机 |

证据：`SubprocessSpawnSpec` **没有 sandbox 字段**，`approval.request` 需要 Agent 与 open turn，因此插件发起的 git 写操作**不受 workspace-write 沙箱与 approval 策略约束**，等价于应用进程权限。路径白名单 + 自建二次确认 + 不注册 Tool 是唯一边界；`subprocess` 的 env 已由产品脱敏但会保留 `PATH`/`HOME`/`SSH_AUTH_SOCK`。

**破坏性操作分级**

| 级别 | 操作 | 确认 | 可撤销性 |
|---|---|---|---|
| L0 只读 | 全部读命令 | 无 | — |
| L1 非破坏写 | add、restore --staged、commit（新提交）、branch/tag 新建、fetch、stash push | 无或表单内确认 | 高（reflog/新对象） |
| L2 破坏本地 | restore --worktree（丢弃）、reset --hard、reset --mixed（有暂存时）、switch -f、clean -fd、branch -D、stash drop、tag -d、amend（已推送时） | 二次确认 + 列出受影响文件/提交；`clean` 先 `-n` 预览 | 部分可救（reflog/ORIG_HEAD）；未跟踪文件不可恢复 |
| L3 破坏远端 | push --force-with-lease、push --delete、push --tags、删远程 tag | 强确认（勾选「我明白」+ 先 `--dry-run`） | 不可撤销，影响他人 |

- 不静默 stash：需要保护工作区时由用户显式选择「搁置并更新」；`rebase`/`pull --rebase` 的 `--autostash` 仅在用户设置开启后使用。

### 5.8 性能预算

实测基线（git 2.45 / Windows，38 个跟踪文件、40 个提交、1812 个工作区文件；Node 直连 spawn 通常更低）：

| 命令 | 实测 | 说明 |
|---|---|---|
| rev-parse / for-each-ref / 操作标记 | 39–42ms | 进程启动主导；合并调用、缓存仓库根 |
| status 全量 | 50ms | 与工作区/未跟踪文件数线性 |
| status `-uno` | 48ms | 大仓库才拉开差距 |
| diff --numstat | 42ms | 只取统计，不取 patch |
| log 50 条 | 43ms | `--skip` 深翻 O(skip)，深翻改用日期/oid 游标 |
| 提交详情（列表+统计） | 1–2 次 spawn | 按 oid 缓存 |

**目标**：一次 B 级快照 <300ms；首屏 <1.5s（快照与分支树并行，日志延后 100ms）；10k 提交列表虚拟滚动只渲染可视区 ±20 行；lane 布局 O(n) 增量计算；页缓存上限 20 页，超出淘汰；面板常驻内存 <60MB。

### 5.9 错误码与文案

| code | HTTP | 触发 | 中文文案 |
|---|---|---|---|
| `git-not-found` | 500 | `resolveExecutable('git')` 失败 | 没有找到 git 可执行文件，请先安装 git。 |
| `not-a-repository` | 200 | 非仓库 | 当前工作区不是 git 仓库。 |
| `workspace-not-found` | 404 | workspaceId 不在注册表 | 找不到这个工作区，请刷新后重试。 |
| `invalid-path` | 400 | 路径越界/不存在 | 路径无效或不在当前仓库内。 |
| `busy` | 409 | 已有写操作在跑 | 正在执行另一个 Git 操作，请稍候。 |
| `lock` | 409 | `index.lock` 存在且重试失败 | 另一个 git 进程正在操作仓库（index.lock 存在）。 |
| `invalid-request` | 400 | 参数缺失/非法 | 请求参数无效，请刷新后重试。 |
| `invalid-ref` | 400 | 分支/哈希不存在 | 分支或提交不存在，可能已被删除。 |
| `confirmation-required` | 409 | 破坏性动作缺少服务端确认 | 这个操作需要确认后才能执行。 |
| `confirmation-mismatch` | 409 | 确认与目标不一致 | 确认信息与当前操作不匹配，请重新确认。 |
| `branch-not-merged` | 409 | `branch -d` 删除未合并分支 | 分支还有未合并的提交，如确认删除请使用强制删除。 |
| `state-interrupted` | 409 | 上次操作被中断/超时，状态未核实 | 上一个操作可能未完成，请刷新或继续/中止后再操作。 |
| `dirty-worktree` | 409 | 检出/变基/更新前有未提交更改 | 工作区有未提交的更改，请先提交或搁置。 |
| `conflict` | 409 | 合并/变基/拣选产生冲突 | 操作产生冲突，请解决冲突后继续或中止。 |
| `nothing-to-commit` | 409 | 无勾选文件/无差异 | 没有要提交的内容。 |
| `no-upstream` | 409 | push/pull 无上游 | 当前分支没有上游分支，请先设置跟踪。 |
| `auth-required` | 401 | 认证失败 | Git 认证失败：请先在终端配置 SSH key 或凭据。 |
| `safe-directory` | 409 | dubious ownership | 仓库属主与当前用户不一致，请按提示配置 safe.directory。 |
| `network` | 502 | 无法连接远端 | 无法连接远端仓库，请检查网络后重试。 |
| `timeout` | 504 | 超时 | 操作超时，请检查网络或仓库大小后重试。 |
| `push-rejected` | 409 | 非快进/受保护分支 | 推送被拒绝：远端有新的提交，请先获取并合并。 |
| `hook-failed` | 409 | hook 退出码非 0 | 提交被 Git 钩子阻止，请查看输出。 |
| `detached-head` | 409 | 更新/推送时 HEAD 分离 | 当前处于分离 HEAD 状态，请先检出一个分支。 |
| `cancelled` | 499 | 客户端取消 | 操作已取消；若已生效请刷新查看。 |
| `internal` | 500 | 其他异常 | Host 内部错误，请重试；持续失败请查看 DSH 日志。 |

- 错误统一带 `detail`（原始 stderr 末尾 4KB，凭证脱敏），面板错误条可展开。
- 未知 code 显示通用文案 + code 本身，便于反馈。

### 5.10 模块划分、构建与测试

```
src/git-workspace/
  git.ts             纯规则（扩展）：argv 构造、status/refs/log/diff 解析、错误分类、类型
  host.ts            宿主（扩展）：路由分发、仓库解析、进程调用、响应信封
  jobs.ts            作业注册表（新）：id、进度行、中断/完成、TTL 清理
  panel.ts           客户端入口（新）：注册 main + sidebar.panellist，Git 图标
  window.ts          面板壳（新）：标签页、工作区选择器、工具栏、错误条、确认弹层
  window-commit.ts   提交页（新）：更改树、提交表单、暂存/丢弃/提交
  window-log.ts      日志页（新）：分支树、提交列表、详情、图线布局
  window-console.ts  控制台页（新）
  window-runtime.ts  客户端运行时（新）：请求封装、轮询、缓存、动作调用
  window-css.ts      样式字符串（新）
  panel.test.ts      SSR 冒烟（新）
  git.test.ts        解析/argv 单测（扩展）
  host.test.ts       路由/校验单测（扩展）
```

- **注册**：`src/session-map/index.ts` 的 `apply` 里调用 `installGitWorkspacePanel(ctx)`（新增一行 import + 一行调用）；现有 `installGitWorkspaceHost` 继续由 `src/index.ts` 安装，路由族不变。
- **构建硬约束**：浏览器半入口只能是被 `tsdown.config.ts` / `package.json` 钉死的 `src/session-map/index.ts`，所有新客户端模块必须从它可达；宿主半入口是 `src/index.ts`。
- **分层约束**：`git.ts` 不 import Node/React，只做纯函数；`host.ts` 不 import React；客户端组件不直接拼 git 命令。
- **测试**：
  - 安全测试的完整设计（不变量、38 条用例、假进程/临时仓库夹具、真实 git 集成、CI 门禁）见 **§6**；本节只列常规功能性测试。
  - 解析单测：用真实 `git status --porcelain=v2 -z` / `log -z` / `show --first-parent` 输出做 fixture，覆盖 rename、冲突、根提交、空仓库、路径含空格、merge 提交。
  - 路由单测：沿用 `host.test.ts` 假服务模式，伪造 `webServer`/`subprocess`/`workspaceRegistry`，断言路由、白名单、错误码、写队列、截断标记。
  - SSR 冒烟：`react-dom/server` 渲染面板空态与快照态（同现有 `client.test.ts`）。
  - 图线布局：纯函数测试（分叉、汇合、跨页、根提交）。
  - 可选集成测试：`describe.skipIf(!gitAvailable)` 建临时仓库跑真实命令（commit/checkout/merge 冲突），只在本地/CI 有 git 时执行。
- **构建**：改完 `pnpm typecheck && pnpm test && pnpm build`；`lib/` 是仓库内容的一部分，必须一起提交。

### 5.11 实施阶段（建议）

| 阶段 | 范围 | 产出 | 预估（1 人） |
|---|---|---|---|
| M0 骨架 + 只读 | 注册 main/sidebar.panellist、工作区选择器、`/snapshot`、分支树、日志只读、详情只读 | 能看：分支、提交历史、提交详情 | 2–3 天 |
| M1 提交链路 | 更改树、暂存/取消暂存/丢弃、提交/修正/提交并推送、`/action` 写队列；**每个写动作先写 §6 的安全测试** | 能改：提交一次完整流程 | 2–3 天 |
| M2 日志体验 | 分支/文本/用户/日期/路径过滤、分页、diff 查看器、详情文件树 | 接近截图的信息密度 | 2 天 |
| M3 分支与同步 | 检出/新建/删除/重命名、合并/变基、Fetch/Update、推送、作业 + SSE 进度 | 主链路闭环 | 3 天 |
| M4 完善 | stash、revert/cherry-pick/reset、控制台、快捷键、空态/错误、性能与虚拟滚动、单测/SSR 冒烟、README | 达到 §7 验收 | 3–4 天 |

- 每个阶段结束都跑 `pnpm typecheck && pnpm test && pnpm build` 并更新 `lib/`；M0 结束即可在真实 DSH 里走查布局，尽早暴露插槽/契约问题。

---

## 6. git 操作安全性测试设计

前提：**安全不靠 UI 自觉**。真正的边界是四道宿主侧硬约束——动作白名单、命令构造白名单、路径白名单、每仓库串行队列；UI 的二次确认只是体验层。每一道约束都必须有测试守卫，且测试直接断言「最终 spawn 了什么 argv / 有没有 spawn / 工作区有没有变」，而不是只断言返回值。

单测只能证明「函数按预期拼参数」，证明不了「仓库没被改坏」。所以安全验证拆成三类证据：**① argv 层**——断言最终 spawn 的完整 argv / env / cwd；**② 行为层**——在临时真实仓库里断言文件内容、引用、锁文件的实际变化；**③ 架构层**——防止后来者绕过门禁或引入 shell。三类都通过，才算这个动作「安全」。

### 6.1 不可妥协的安全不变量

| # | 不变量 | 实现点 | 测试层级 | 用例 |
|---|---|---|---|---|
| I1 | 只执行白名单动作，未知 `kind` 一律拒绝 | `ActionKind` 联合类型 + `switch` 穷尽 + `default` 抛错 | L1/L2 | S-01 |
| I2 | 写命令 argv 只能由固定 builder 生成，flag 集合封闭 | `git.ts` 的 `buildCommand()`，不接收任意 flag | L1 | S-02–S-09 |
| I3 | 破坏性动作由**服务端**强制确认，绕过 UI 也无效 | `assertAuthorizedMutation()` 在路由内部执行 | L2/L3 | S-11–S-14 |
| I4 | 所有路径都 `realpath` 后落在注册 Workspace 的仓库根内 | `resolveRepo()` + `normalizeRepoPath()` | L1/L2/L4 | S-15–S-21 |
| I5 | 同一仓库同时最多一个写进程；读路径不产生写命令 | `MutationQueue`；读命令 builder 独立 | L2/L3 | S-22–S-24 |
| I6 | 取消/超时后不自动重试写操作，先探测真实状态 | `JobRegistry` + `probeInterrupted()` | L2/L3/L4 | S-25–S-28 |
| I7 | 请求面只接受本机、同源、JSON、≤16KB | `isTrustedRequest` + `readJsonBody` | L2 | S-29–S-30 |
| I8 | 凭证不进 argv、不进控制台回执 | 强制 env + `redactArgv()` | L1/L2 | S-31–S-32 |
| I9 | 不对 Agent 暴露 git 写能力 | 不调用 `tools.register`；架构守卫扫描 | L5 | S-33 |
| I10 | 解析失败/截断不得产生「看似成功」的状态 | 解析器返回 `truncated`/`lossy`，写路径拒绝不确定数据 | L1/L4 | S-34–S-36 |
| I11 | 架构上禁止 shell 与自建子进程 | 只经 `subprocess` seam；源码扫描 | L5 | S-37–S-38 |

### 6.2 测试分层与夹具

| 层 | 对象 | 依赖 | 何时跑 |
|---|---|---|---|
| L1 纯函数单测 | `git.ts`：argv builder、路径/引用校验、动作分级、解析器、脱敏 | 无 fs / 无 git / 无网络 | 每次 `pnpm test` |
| L2 路由单测 | `host.ts`：信任校验、参数校验、确认门禁、队列、错误码 | Fake `webServer`/`subprocess`/`workspaceRegistry` | 每次 `pnpm test` |
| L3 脚本化进程 | `subprocess` 的退出码、stderr、超时、取消、截断 | `FakeSubprocess` 回放脚本 | 每次 `pnpm test` |
| L4 真实 git 集成 | 临时仓库里的真实行为（工作区是否被改动、锁、冲突） | 本机 git，`GIT_WS_IT=1` 才跑 | CI（Windows + Linux）与发版前 |
| L5 架构守卫 | 源码不允许出现 shell/`child_process`/绕过门禁的写路由 | 直接读源码文件断言 | 每次 `pnpm test` |

建议文件布局（与仓库现有 co-located `*.test.ts` 风格一致）：

```
src/git-workspace/
  git.safety.test.ts          # L1：builder / validator / policy / parser / redact
  host.safety.test.ts         # L2/L3：路由门禁、队列、取消、信任校验
  safety.integration.test.ts  # L4：真实 git（describe.skipIf(!hasGit || !process.env.GIT_WS_IT)）
  testing/fake-subprocess.ts  # 记录 SpawnSpec、按脚本回放 exit/stderr/timeout/abort
  testing/temp-repo.ts        # 临时仓库：init/commit/branch/mergeConflict/bareRemote
```

**夹具要点**

- `FakeSubprocess` 记录每次 `spawn(spec)` 的 `{ argv, cwd, env, stdio, graceMs, signal }`，并提供 `expectNoSpawn()`、`expectSingleSpawn()`、`lastArgv()`；回放脚本可指定 exitCode、stdout/stderr、超时（`done` reject）、中止信号。
- `FakeWorkspaceRegistry` 只返回预置路径；任何未注册 id 都应导致 404。
- `invokeRoute(path, body, headers?)` 直接调用 `host.ts` 注册的 handler（不走真实 HTTP），但使用与生产相同的 `isTrustedRequest`，头部由测试显式构造（loopback / 非 loopback / 带/不带 Origin）。
- `TempRepo` 每个用例独立目录，`afterEach` 清理；Windows 上用短路径避免 260 字符限制。

### 6.3 安全测试矩阵

| ID | 保什么 | 构造 | 期望 | 层 |
|---|---|---|---|---|
| S-01 | 未知动作 | `kind: 'run-shell'` / 空 kind | 400 + `invalid-request`，**零 spawn** | L1/L2 |
| S-02 | 永不出现 `--force` | 请求 `{ kind:'push', force:true }` | argv 含 `--force-with-lease`，**不含 `--force`** | L1 |
| S-03 | `push --delete` 属 L3 | 未确认请求 | 409 + `confirmation-required`，零 spawn | L2 |
| S-04 | `clean` 先预览 | `discard` 未跟踪文件 | 首次 spawn argv 含 `-n`/`-nd`；确认后才 `-fd`；**任何情况不含 `-x`** | L1/L2 |
| S-05 | 删除分支默认安全 | 未合并分支 + 无 force | 使用 `-d` 且失败 → `branch-not-merged`；force 确认后才 `-D` | L4 |
| S-06 | `reset --hard` 门禁 | 无 confirm | 拒绝且**工作区文件未变** | L2/L4 |
| S-07 | 引用名注入 | 分支名 `-x`、`--upload-pack=evil`、含空格/换行/NUL | `check-ref-format` 拒绝；不进入 argv（或仅在 `--` 后） | L1 |
| S-08 | 参数注入 | 文件名 `--force`、`; rm -rf /`、`$(id)`、`a b` | 作为**单个 argv 元素**且位于 `--` 之后；无 shell 展开 | L1 |
| S-09 | hook 默认执行 | 普通 commit | argv 不含 `--no-verify`；仅显式设置才含 | L1 |
| S-10 | argv[0] 可信 | 任意动作 | `argv[0]` 等于 `resolveExecutable('git')` 的绝对路径 | L1/L3 |
| S-11 | 服务端确认门禁 | 直接 POST `/action`（模拟绕过 UI） | L2/L3 动作 → 409；不 spawn | L2 |
| S-12 | 确认绑定目标 | 确认 A 哈希、提交 B 哈希 | 409 `confirmation-mismatch` | L1/L2 |
| S-13 | 确认不可复用 | 同一确认执行两次 | 第二次 409（一次性 token） | L2 |
| S-14 | UI 确认不是边界 | 删除 UI 门禁后的请求 | 仍被服务端拒绝（等价 S-11） | L2 |
| S-15 | 未注册 workspace | 伪 `workspaceId` | 404，零 spawn | L2 |
| S-16 | 非仓库 | 普通目录 | `not-a-repository`，无写命令 | L2/L4 |
| S-17 | 仓库根越界 | `rev-parse` 返回 Workspace 外路径（junction/symlink） | `invalid-path`，零 spawn | L4 |
| S-18 | 路径穿越 | `../outside`、`C:\Windows\...`、含 NUL/控制字符 | `invalid-path` | L1 |
| S-19 | 大小写/分隔符 | Windows `C:\Repo` vs `c:/repo` | 归一化后判定为同一路径 | L1 |
| S-20 | 符号链接逃逸 | 仓库内 symlink 指向外部文件 | `realpath` 后拒绝写/删 | L4 |
| S-21 | 子模块边界 | 提交子模块内路径 | 拒绝或定位到子模块自己的仓库（P2 必须显式） | L2 |
| S-22 | 写串行 | 同仓库并发两个写请求 | 第二次排队或 409 `busy`；spawn 不重叠 | L2/L3 |
| S-23 | 读不写 | 调用 snapshot/log/diff | 不产生任何写命令；无 `index.lock` 写入（`--no-optional-locks`） | L3 |
| S-24 | 写不重试 | 第一次 spawn 退出码 1 | 只 spawn 一次；不自动重跑 | L3 |
| S-25 | 取消作业 | 发起 fetch 后 `/cancel` | signal 触发、job=`cancelled`、不重试 | L2/L3 |
| S-26 | 中断后状态 | 模拟 kill 后调用 snapshot | 返回 `interrupted` 标记；下一次写被拒绝直到刷新/中止 | L2/L3 |
| S-27 | 锁冲突 | 预置 `.git/index.lock` | 重试 3 次后 `lock`；**锁文件仍在** | L4 |
| S-28 | 超时不误判成功 | spawn 超时 | 不返回成功；刷新后状态以实际为准 | L3 |
| S-29 | 请求可信 | 非 loopback socket / 伪造 Host / 跨源 Origin | 403，零 spawn | L2 |
| S-30 | 请求体限制 | `text/plain`、17KB body | 415 / 413，零 spawn | L2 |
| S-31 | 凭证脱敏 | 远端 URL `https://u:token@host/r.git` | 控制台回执/日志中为 `https://***@host/r.git` | L1/L2 |
| S-32 | 环境强制 | 任意写动作 | spawn env 含 `GIT_TERMINAL_PROMPT=0`、`GIT_LITERAL_PATHSPECS=1` | L1/L3 |
| S-33 | 不暴露给 Agent | 源码扫描 | `src/git-workspace` 不调用 `tools.register`，路由不注册为 Tool | L5 |
| S-34 | 截断检测 | 输出末尾记录不完整 | `truncated: true`；快照不把半条数据当完整 | L1 |
| S-35 | 编码异常 | 非 UTF-8 文件名 | `encoding-lossy` 标记；该路径写操作被拒绝 | L1 |
| S-36 | 怪字符输出 | status/log 中出现换行/控制字符/超长行 | 解析不崩溃、UI 按文本渲染（不拼 HTML） | L1 |
| S-37 | 禁止 shell | 源码扫描 | 无 `child_process`、无 `exec(`、无 `shell: true`、无 `rm -rf` 字符串 | L5 |
| S-38 | 门禁不可绕过 | 源码扫描/导出断言 | 每个 mutating 路由都调用 `assertAuthorizedMutation()` | L5 |

### 6.4 关键断言示例

**① argv 封闭（S-02/S-04/S-09）**

```ts
it('push 永远不生成 --force，最多 --force-with-lease', async () => {
  await invoke('/action', { kind: 'push', workspaceId: ws, force: true, confirm: true })
  const argv = fakeSubprocess.lastArgv()
  expect(argv).toContain('--force-with-lease')
  expect(argv).not.toContain('--force')
  expect(argv).not.toContain('-f')
})

it('clean 先 -n 预览，且永不带 -x', async () => {
  await action.discardUntracked({ paths: ['tmp'] })
  expect(fakeSubprocess.spawns[0].argv).toEqual(
    expect.arrayContaining(['clean', '-nd', '--']),
  )
  expect(fakeSubprocess.spawns.every(s => !s.argv.includes('-x'))).toBe(true)
})
```

**② 确认门禁（S-11/S-12/S-13）**

```ts
it('无确认的 hard reset 被服务端拒绝，且不 spawn', async () => {
  const res = await invoke('/action', { kind: 'reset-hard', workspaceId: ws, hash: 'abc123' })
  expect(res.status).toBe(409)
  expect(res.body.error.code).toBe('confirmation-required')
  expect(fakeSubprocess.spawns).toHaveLength(0)
})

it('确认与目标绑定，不可移花接木', async () => {
  const token = await confirm('reset-hard', 'abc123')
  const res = await invoke('/action', { kind: 'reset-hard', hash: 'def456', confirm: token })
  expect(res.body.error.code).toBe('confirmation-mismatch')
})
```

**③ 路径校验（表驱动，S-18/S-19）**

```ts
const cases: Array<[string, 'ok' | 'invalid-path']> = [
  ['src/app.ts', 'ok'],
  ['src/../src/app.ts', 'ok'],                    // 归一化后仍在仓库内
  ['../outside.txt', 'invalid-path'],
  ['C:\\Windows\\System32\\x', 'invalid-path'],
  ['src/\u0000evil', 'invalid-path'],
  ['-rf', 'ok-but-after--'],                      // 合法文件名，但必须放在 -- 之后
]
it.each(cases)('normalizeRepoPath(%s) → %s', (input, expected) => { … })
```

**④ 取消与恢复（S-25/S-26）**

```ts
it('取消后不重试，且下一次写要求先刷新', async () => {
  const job = await startFetch()
  await invoke('/cancel', { id: job.id })
  expect(fakeSubprocess.lastSpec().signal?.aborted).toBe(true)
  expect(jobRegistry.get(job.id)?.status).toBe('cancelled')
  const next = await invoke('/action', { kind: 'commit', … })
  expect(next.body.error.code).toBe('state-interrupted')
})
```

**⑤ 架构守卫（S-37/S-38）**

```ts
it('git 写操作只经 subprocess seam，且必须过门禁', () => {
  const sources = readAllSource('src/git-workspace')
  expect(sources).not.toMatch(/child_process|exec\(|shell:\s*true/)
  for (const mutating of MUTATING_ACTIONS) {
    expect(routeSource).toContain(`assertAuthorizedMutation('${mutating}')`)
  }
})
```

### 6.5 真实 git 集成用例（L4）

| 用例 | 步骤 | 断言 |
|---|---|---|
| 未确认丢弃 | 改工作区文件 → 调 `discard` 无 confirm | 拒绝；文件内容**逐字节未变** |
| 丢弃已确认 | 同上 + confirm | 文件恢复 HEAD 内容 |
| clean 不删 ignored | `.gitignore` + ignored 文件 + 未跟踪文件 → confirm 丢弃 | 未跟踪文件删除、ignored 文件仍在 |
| 删除未合并分支 | 建分支+提交 → `deleteBranch` 无 force | 失败、分支仍在；force 后删除 |
| 强推保护 | 本地 bare remote + 改写历史 → push | 被拒；confirm 后 `--force-with-lease` 成功 |
| symlink 逃逸 | 仓库内 symlink 指向外部文件 → discard | `invalid-path`；外部文件未变 |
| 锁冲突 | 创建 `.git/index.lock` → commit | `lock`；锁文件仍在 |
| 空仓库 | `git init` 后 stage/unstage/commit | 走 `rm --cached` 回退路径，首次提交成功 |
| 合并冲突 | 两分支改同一行 → merge | 检测为 `conflict`；commit 被阻止；`merge --abort` 可恢复 |
| kill 恢复 | 启动长操作后中止子进程 | 快照含 `interrupted`；标记文件可被继续/中止 |

### 6.6 覆盖率与 CI 门禁

| 项 | 要求 |
|---|---|
| 单测/路由/架构守卫 | `pnpm test` 必跑，不允许跳过 |
| 集成测试 | `GIT_WS_IT=1 pnpm vitest run src/git-workspace/safety.integration.test.ts`（Windows：`$env:GIT_WS_IT=1; pnpm vitest run …`）；CI 在 Windows + Linux 各跑一次 |
| 覆盖率 | `git.ts` 的 builder/validator/policy **100% 分支**；`host.ts` 的校验分支 100%；整体语句 ≥85% |
| PR 门禁 | 新增写动作必须同时提交：builder 单测 + 门禁测试 + 至少 1 条集成用例；新增路由必须过信任校验测试 |
| 禁止项 | 引入 `child_process`/`exec`、Web 路由未过 `isTrustedRequest`、写动作绕过 `assertAuthorizedMutation`、测试里 `skip` 安全用例（L4 缺 git 时除外，需在输出中显式说明） |

可选（P2）：对安全关键模块跑一次 mutation testing（Stryker），确认测试能杀死「删掉门禁/改错 flag」这类变异。

### 6.7 安全 DoD

- [ ] §6.3 的 38 条安全用例全部有对应测试（或在实现计划中明确标注「随功能补」）。
- [ ] 每条破坏性动作都有「拒绝路径 + 接受路径」两个方向的测试。
- [ ] 集成测试在 Windows 与 Linux 实际跑过；锁、symlink、空仓库、冲突四类场景至少各一条。
- [ ] 架构守卫测试通过；源码中不存在 shell 拼接与自建进程。
- [ ] 取消/超时/中断后的状态恢复有测试，且不会出现「UI 显示成功但仓库没变」或相反。

---

## 7. 验收标准（Definition of Done）

- [ ] 侧边栏出现 Git 图标，点击打开主面板；再次点击/切换到会话后状态保持正确；面板卸载后不再轮询。
- [ ] 选择工作区后 1.5s 内显示分支树、当前分支、ahead/behind 与更改列表；非仓库工作区显示空态而非报错。
- [ ] 更改树四类分组、目录三态复选框、状态色/图标（字母在 tooltip）与 §5.2 一致；「没有要提交的内容」文案正确。
- [ ] 暂存/取消暂存/丢弃/提交/修正/提交并推送全链路可用；暂存区模式勾选即写 index；提交只包含勾选路径；空信息无法提交。
- [ ] 分支树可搜索、检出、新建、删除（含未合并保护）、重命名；当前分支标记与远程分组正确。
- [ ] 日志列表分页、图线、refs 徽标、作者/时间正确；分支/文本/用户/日期/路径过滤可叠加。
- [ ] 提交详情元信息与文件树正确（merge 提交也能列出文件）；`在 N 个分支中` 列表正确；单文件 diff 可读、可截断提示。
- [ ] Fetch 不改变工作区与本地分支；Update 当前分支走 fetch + merge/rebase 两步、非当前分支需确认检出（或仅快进）；脏工作区给出 `dirty-worktree` 提示。
- [ ] 空仓库、分离 HEAD、merge/rebase 进行中都有对应空态/横幅（继续、中止）。
- [ ] 破坏性操作全部二次确认；取消/超时/认证失败/推送被拒都有对应中文文案与原始输出。
- [ ] §6 的安全测试矩阵（38 条）全部有测试并通过；服务端门禁可拦住绕过 UI 的请求。
- [ ] 真实 git 集成测试在 Windows 与 Linux 各跑过一次（锁/symlink/空仓库/冲突场景齐全）。
- [ ] 架构守卫测试通过：无 shell 拼接、无 `child_process`、写路由全部经过确认门禁与路径白名单。
- [ ] 控制台能看到实际执行的 argv、退出码与耗时；凭证已脱敏。
- [ ] 10k 提交的仓库滚动不卡；B 级快照 <300ms（本机基准，见 §5.8）。
- [ ] `pnpm typecheck`、`pnpm test`、`pnpm build` 全绿；`lib/` 已更新。

---

## 8. 交互总表

### 8.1 快捷键

| 快捷键 | 动作 | 作用域 |
|---|---|---|
| `Ctrl/Cmd+Enter` | 提交 | 提交页 |
| `Ctrl/Cmd+Shift+K` | 推送 | 全局 |
| `Ctrl/Cmd+T` | 更新（Update） | 全局 |
| `Ctrl/Cmd+Shift+F` | 获取（Fetch） | 全局 |
| `F5` | 刷新快照 | 全局 |
| `Ctrl/Cmd+D` | 显示差异 | 列表/树 |
| `Delete` | 丢弃更改（确认） | 更改树 |
| `Space` | 勾选/取消勾选文件 | 更改树 |
| `Enter` | 打开 diff / 检出分支（树） | 列表/树 |
| `↑` / `↓` | 移动选择 | 列表/树 |
| `Esc` | 关闭浮层/抽屉/取消编辑 | 全局 |

> DSH 有 `ctx.shortcuts`（产品内部使用，命令 id 是品牌类型），第三方更稳的做法是在面板容器上挂 `keydown`（焦点在面板内时生效），并在帮助浮层里说明「面板内快捷键」。IDEA 的 Fetch/刷新没有默认快捷键，表中 Fetch 的 `Ctrl/Cmd+Shift+F` 是 DSH 自定。

### 8.2 右键菜单汇总

- 更改树：显示差异、还原、暂存/取消暂存、从提交中排除、搁置、复制路径。
- 分支树：检出、新建分支自、更新、推送、拉取、合并到当前、变基当前到此处、与当前比较、重命名、删除、跟踪分支、收藏、复制名称。
- 日志：复制哈希/信息、新建分支、打标签、检出修订、重置到此处、撤销提交、拣选、编辑信息（P1）、比较、显示差异。
- 详情：显示差异、在编辑器中打开（P2）、与本地比较、复制路径、还原所选文件（P1）。

### 8.3 文案约定

- 中文文案以截图为准（`提交`、`搁置`、`修正(M) 上次提交`、`提交并推送(P...)`、`分支或标签`、`文本或哈希`、`在 N 个分支中`）。
- 破坏性确认使用「不可撤销 / 将永久删除 / 将丢失」等明确后果描述，不使用模糊的「确定吗？」。
- 错误文案先说结论再说下一步（「推送被拒绝：远端有新的提交，请先获取并合并。」）。

---

## 9. 风险与开放决策

| 编号 | 问题 | 选项 | 建议 |
|---|---|---|---|
| D1 | 非当前分支的「更新」是否自动检出 | A 确认后检出并更新；B 拒绝并提示先检出；C 仅快进该分支引用（分支未被检出时） | **A 为默认**，下拉提供 C；文案必须写明「将切换工作区」 |
| D2 | 暂存区 vs 变更列表 | A 只做暂存区；B 兼容两种；C 只做变更列表 | **A**（IDEA 默认关闭暂存区，但本规格显式启用；变更列表 P2） |
| D3 | 搁置实现 | A git stash；B IDEA Shelf 补丁；C 都不做 | **A**（P1），Shelf 明确不做 |
| D4 | 更新策略（merge/rebase） | A 每次询问；B 记住每仓库设置；C 跟随 repo 配置 | **B**，默认读 `pull.rebase`；执行时先 fetch 再 merge/rebase 两步 |
| D5 | 长任务进度 | A SSE（v1）+ 轮询兜底；B 纯轮询；C 阻塞请求 | **A**（handler 持有响应生命周期、gzip 跳过 `event-stream`，成本低），取消走显式 `POST /cancel` |
| D6 | diff 渲染 | A 自建统一 diff；B 复用产品文件预览；C 只给原始 patch | **A**（产品无公开 diff 组件） |
| D7 | 冲突解决 | A 只展示+引导终端；B 双栏选择 ours/theirs；C 完整合并编辑器 | **B**（P1），C 不做 |
| D8 | 是否暴露为 Agent 工具 | A 不暴露；B 暴露只读查询工具 | **A**（v1 聚焦 UI，避免 Agent 误操作仓库） |
| D9 | 多仓库/子模块 | A v1 单仓库（工作区根）；B 仓库下拉；C 子模块递归 | **B**（P2 做 A→B），C 更后 |
| D10 | 大仓库日志默认范围 | A 当前分支；B 所有分支；C 最近 7 天 | **A**，过滤器可切「所有分支」 |
| D11 | Fetch 的远端范围 | A 所有远端 + prune；B 仅当前上游远端 | **A**（符合截图「获取所有更新」），B 作为设置项 |
| D12 | 提交成功反馈 | A 静默刷新；B 面板内轻提示 | **A 为 IDEA 行为**，B 作为 P1 差异化（可关） |

其它风险：

- **没有底部停靠区**：DSH 只有 sidebar / main / rightbar / shell.overlay / shell.leading；打开 Git 面板会替换中央面板（对话不可见），这是产品布局限制，不硬造 dock。缓解：需要对照会话时可把单个 commit diff 或分支比较开成右侧栏标签（P1，右侧栏与主面板互斥）。
- **主面板选中态不持久化**：刷新页面回到会话页；必须用 `localStorage` + 挂载时 `selectPanel` 恢复（见 §5.3）。
- **IDE 语义偏差**：IDEA 的「更新」在非当前分支上的行为随版本变化；实现时以本规格 D1 为准，并在 UI 文案里写清楚。
- **Windows 文件锁**：杀软/编辑器占用会让 checkout/reset 失败，错误需保留原始 stderr。
- **编码**：仓库可能含非 UTF-8 文件名；解析按 UTF-8 with replacement，路径显示用 git 输出原样，不做解码猜测。
- **认证**：HTTPS 私有仓库依赖系统凭据；无凭据时只能给出「请先在终端配置」的引导。GCM 在 Windows 上仍可能弹 GUI（`GIT_TERMINAL_PROMPT` 不一定被尊重），实现时加 `GCM_INTERACTIVE=never` 并设超时。
- **DSH 契约漂移**：插槽/服务是运行时快照，升级 DSH 后需回归验证（现有 README「宿主契约」章节已有先例）。

**实现前待核实（来自截图与实测调研，按影响排序）**

| # | 待核实项 | 影响 |
|---|---|---|
| 1 | 5/6 的控件位置已核实为分支面板竖排工具栏第 3/7 个图标；需在目标 IDEA 版本回归确认没有变化 | 入口布局 |
| 2 | 暂存区模式下勾选是否**立即**执行 `add` / `restore --staged` | 交互实现（本规格按「立即」设计） |
| 3 | Fetch 默认远端范围与 `--all/--prune/tags` 默认值 | 操作语义 |
| 4 | 非当前分支「更新」的真实 git 行为（检出后拉取 vs 仅快进引用） | D1 实现 |
| 5 | `subprocess.spawn({env})` 是合并还是替换宿主环境；`PATH/HOME/USERPROFILE/SystemRoot` 是否保留 | 认证与配置读取 |
| 6 | `fetch --porcelain` 的引入版本与逐行格式 | 保守方案：用 refs 前后快照 diff |
| 7 | `for-each-ref %(upstream:track,nobracket)`、`status --show-stash` 在 git 2.30 的可用性 | 能力探测 |
| 8 | `ctx.shortcuts` 能否被第三方安全使用（当前按面板内 `keydown` 实现） | §8.1 注册方式 |

---

## 10. 附录

### 10.1 与现有 git-workspace 的关系

- 保留现有 Settings →「从 Git 克隆」页面与 `/plugin-git-workspace/state|clone` 路由，不动其行为。
- 新增路由挂在同一前缀下（`/snapshot`、`/log`、`/action` …），共用 `isTrustedRequest`、JSON 读取与信封格式。
- 新面板与克隆页共享 `git.ts` 的仓库/路径纯函数，避免两套规则。

### 10.2 参考资料

- JetBrains IDEA：[Log tab](https://www.jetbrains.com/help/idea/log-tab.html)、[Commit and push](https://www.jetbrains.com/help/idea/commit-and-push-changes.html)、[Sync with a remote repository（fetch/pull/update）](https://www.jetbrains.com/help/idea/sync-with-a-remote-repository.html)、[Merge/rebase/cherry-pick](https://www.jetbrains.com/help/idea/apply-changes-from-one-branch-to-another.html)、[Shelve or stash](https://www.jetbrains.com/help/idea/shelving-and-unshelving-changes.html)、[Use Git worktrees](https://www.jetbrains.com/help/idea/use-git-worktrees.html)、[Settings | Version Control | Git](https://www.jetbrains.com/help/idea/settings-version-control-git.html)。
- git 官方文档：[git-status（porcelain v2）](https://git-scm.com/docs/git-status)、[git-log（format）](https://git-scm.com/docs/git-log)、[git-for-each-ref](https://git-scm.com/docs/git-for-each-ref)、[git-show](https://git-scm.com/docs/git-show)、[git-diff](https://git-scm.com/docs/git-diff)、[git-restore](https://git-scm.com/docs/git-restore)、[git-switch](https://git-scm.com/docs/git-switch)、[git-fetch](https://git-scm.com/docs/git-fetch)、[git-pull](https://git-scm.com/docs/git-pull)。
- 本仓库：`README.md`「宿主契约」「源码结构」、`src/git-workspace/*`、`src/session-map/index.ts`。

### 10.3 版本历史

| 版本 | 日期 | 变更 |
|---|---|---|
| 0.1 | 2026-10-27 | 首版草案：IDEA 行为解剖、功能清单、DSH 落地设计、API 与验收标准 |
| 0.2 | 2026-10-27 | 按 git 2.45 实测与 IDEA 行为调研修订：暂存区即时勾选、merge 文件列表 `--first-parent`、`log -z`+`%x1f`、刷新分级、L0–L3 安全分级、实测性能与陷阱清单 |
| 0.3 | 2026-10-27 | 新增 §6「git 操作安全性测试设计」：11 条安全不变量、38 条安全用例矩阵、假进程/临时仓库夹具、真实 git 集成用例、覆盖率与 CI 门禁 |

### 10.4 实现状态（2026-10-27）

| 层 | 已落地 | 位置 |
|---|---|---|
| 测试夹具 | 假进程（argv/env/取消/截断回放）、假 webServer/registry、临时真实仓库、真实 subprocess 适配器 | `testing/` |
| 纯函数层 | 路径/引用校验、读写命令构造、status/log/refs/diff 解析、动作策略与确认目标、凭证脱敏 | `git-repo.ts`、`git-command.ts`、`git-parse.ts`、`git-actions.ts` |
| 宿主读路由 | `/snapshot`、`/log`、`/commit`、`/diff`，Workspace→仓库根 `realpath` 校验、快照缓存、命令回执 | `host-git.ts` |
| 宿主写路由 | `/confirm`（一次性令牌）、`/action`（写队列 + 作业）、`/job`、`/cancel`、`/events`（SSE 进度） | `host-actions.ts` |
| 动作 | stage/unstage/discard/commit(amend)/push(force-with-lease)/checkout/createBranch/deleteBranch/renameBranch/fetch/update/merge/rebase/reset/revert/cherryPick/abortOperation/continueOperation/stashPush/stashPop/stashDrop/tagCreate/tagDelete | `git-actions.ts` |
| 面板 | 提交/日志/控制台、工作区选择、分支目录折叠、标签分组、日志图线、提交详情/diff、作业进度、确认/重置/标签/强制推送弹层 | `window/` |
| 安全用例 | S-01–S-16、S-19、S-22、S-24–S-33、S-37、S-38 已覆盖；S-20 以「clean 不跟随符号链接、外部文件不变」的集成用例覆盖；S-17/S-18/S-21/S-23/S-34–S-36 为单元或路由级覆盖 | `git-*.test.ts`、`host-git.test.ts`、`safety.integration.test.ts` |

**尚未实现（后续可选，路线图见 [git-workspace-plan.md](git-workspace-plan.md) §10.1）**：冲突合并编辑器（O1）、stash 完整列表与逐条 drop（O2）、远程标签删除（O3）、子模块/worktree 管理（O4）、超大仓库虚拟滚动与轻量刷新（O5）、非当前分支 Update 的「仅快进引用」选项（O6）、kill 恢复集成用例（O7）。
**验证**：约 236 个用例（`GIT_WS_IT=1` 时含 15 条真实 git 集成），`pnpm typecheck && pnpm test && pnpm build` 全绿；`lib/` 已重建。

