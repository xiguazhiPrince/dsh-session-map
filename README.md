# dsh-session-map

> **会话图谱 · BTW 分叉 · 技能与指令面板 · Git 工具窗口** —— 把 DSH 里的分叉、能力和代码状态收进同一个界面。

DSH 的会话会从某一轮分叉出去，可左侧栏只是一张平铺列表。这个插件把「从哪一句话分出来」画成一张图，也把日常最费手的技能查看、AGENTS.md 管理和 Git 操作搬进同一套界面。

[![license](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE) [![GitHub stars](https://img.shields.io/github/stars/xiguazhiPrince/dsh-session-map?style=flat&label=stars)](https://github.com/xiguazhiPrince/dsh-session-map/stargazers)

## 功能

<table>
  <tr>
    <td width="50%" align="center" valign="top">
      <img src="docs/example-map.png" height="240" alt="会话图谱">
      <p align="left">
        <b>🗺️ 会话图谱</b><br>
        把每个用户轮次画成节点、每个会话画成一条彩色线：fork 从真正被继承的那一轮长出来，当前会话整条链高亮，一眼看清「这是从哪句话分出去的」。新版 DSH 的分叉不再记录父会话：图谱优先使用插件自己观察到的 fork 关系（本地账本，跨页面/重启共享），其余按被复制的轮次前缀在同一工作目录内推断，并用 Host 侧会话创建时间确定主干方向。
      </p>
      <p align="left">
        <sub>入口：会话头「会话图谱」开关，或右侧栏「会话图谱」标签页</sub>
      </p>
    </td>
    <td width="50%" align="center" valign="top">
      <img src="docs/example.png" height="240" alt="BTW 分叉">
      <p align="left">
        <b>⏱️ BTW：从当前进度分叉</b><br>
        主任务还在跑的时候，点一下输入框左侧的 BTW，就按当前进度分叉出一个只读会话并切过去——主任务在后台继续跑，新会话只能看、不能改。
      </p>
      <p align="left">
        <sub>入口：会话运行时，输入框左侧的 BTW 按钮</sub>
      </p>
    </td>
  </tr>
  <tr>
    <td width="50%" align="center" valign="top">
      <img src="docs/example-skills.png" height="240" alt="技能与指令">
      <p align="left">
        <b>🧩 技能与指令</b><br>
        「技能」标签页只列当前会话真正能用 <code>/</code> 调用的技能；「指令」标签页按注入顺序列出会读到的 AGENTS.md，可直接新建、编辑、删除。
      </p>
      <p align="left">
        <sub>入口：对话标签栏；全机技能在 Settings →「技能」</sub>
      </p>
    </td>
    <td width="50%" align="center" valign="top">
      <img src="docs/example-git-window.png" height="240" alt="Git 工具窗口">
      <p align="left">
        <b>🌿 Git 工作区</b><br>
        左侧栏 Git 工具窗口：分支树、带图线的提交列表、逐文件 diff，暂存、提交、推送都在 DSH 里完成；输入框左侧常驻当前分支，右侧栏还能开一页式 Git。
      </p>
      <p align="left">
        <sub>入口：左侧栏 Git 图标 / 会话头「Git」按钮；Settings →「从 Git 克隆」</sub>
      </p>
    </td>
  </tr>
</table>

## 引用文件预览里的选中文本

右侧栏打开的文件 tab（Markdown / 代码 / 纯文本预览）里选中一段文本，选区上方会浮出「引用到对话」——点一下把 **宿主机绝对路径 + 起止行号 + 源码原文** 插进当前会话的输入框，接着补问题即可发送。

- **首行永远是来源坐标**：`/Users/me/repo/README.md:86-88`（单行写 `:86`）；
- **Markdown / 纯文本** → 空行后接 Markdown 引用块，内容是源码原文（`**`、缩进都保留），发出去会被识别成原生引用卡片；
- **代码** → 围栏代码块，信息行同样是绝对路径:起止行，正文是源码行；
- **Markdown 预览的行号**由「源码投影 → 选区匹配」得到（它渲染的是 HTML，DOM 本身给不出行号）；匹配不到时降级为只写路径；
- 内容只是「酌情」的摘要：单次引用上限 100 字，超出会在行边界截断、把行号范围收窄到实际引用的行，并注明原文总字数；
- 插入块以一行 `---` 收尾：空行 + 分割线 + 空行，光标停在分割线下面隔一行处，接着写自己的问题即可。

> 入口：右侧栏文件预览里拖选文本。规格见 [引用到对话规格](docs/quote-to-chat-spec.md)。

## 安装

**从 npm 安装**（预构建，无安装期脚本）：

```sh
# 装进 dsh web 启动的 web profile
dsh plugin --profile web add @xiguazhiprince/dsh-session-map
```

**或直接从 GitHub main 安装**（最新功能都在这里）：

```sh
dsh plugin --profile web add github:xiguazhiPrince/dsh-session-map
```

装完**重启该 profile 的进程并刷新页面**，插件才会加载（profile 的 bundle 列表在启动时读取）。profile 名要已经存在于 `$DSH_HOME/profiles` 下；想新建可以先用模板派生：`dsh myweb --from-default-profile web`。

> **版本提醒**：npm 上最新是 **0.5.0**——引用文件预览选中文本、Git 工具窗口、技能页、指令页与 BTW 都已上架。GitHub main 可能比 npm 领先若干提交，想第一时间试新功能再从 GitHub 装。

## 本地开发

```sh
pnpm install
pnpm build      # 产出 lib/index.js 与 lib/client.js
pnpm typecheck
pnpm test
```

改了 `src/` 记得先 `pnpm build` 再提交——`lib/` 也是仓库内容的一部分。更深入的功能规格与安全设计见 [docs](docs)；界面约定见 [界面视觉规范](docs/ui-visual-spec.md)。

## 许可证

MIT
