# 用量统计规格

Settings →「用量统计」把 `$DSH_HOME/sessions` 下的全部会话日志汇总成每日用量。页面视觉以 [usage-stats-design.html](usage-stats-design.html) 为准。数据只在本机计算。

## 数据来源

- 目录布局：`<sessions>/<cwd-slug>/<session-id>/session[.vN].jsonl[.zstd]`。每个会话目录只读版本号最高的一个文件；同一版本同时有压缩版和明文版时，读压缩版。空文件是刚创建的会话，不计入，也不报错。
- 压缩日志是多帧 zstd，每次追加写入一帧。Node 的 `zstdDecompressSync` 只解第一帧，流式解压器遇到帧间字典前缀会报 `prefix_unknown`。因此 `scanZstdFrames` 先按帧头、块头和校验和切出各帧边界（可跳过帧会被跳过），再逐帧同步解压。末尾半帧是正在写入的部分，忽略。实测逐帧同步比异步快（5.7 s 对 9.3 s，12 万帧）。为了不阻塞 Host，每跑 12 ms 用 `setImmediate` 让出一次事件循环。
- 无法解压或解析的日志会列入 `skipped`，页面以警告条形式列出，其余数据照常显示。

## 统计口径

| 指标 | 来源 |
| --- | --- |
| 改动行数（新增 / 删除） | 成功的 `tool/result.meta.diffs[]`，对 `oldText`/`newText` 做行级 diff。新建文件（`operation:'create'` 且没有 diff）按调用参数 `content` 的行数计为新增。 |
| 对话轮次 | `turn/start`；`turn/end.reason.kind` 区分 error / aborted |
| Agent 运行时长 | 同一轮 `turn/start` → `turn/end` 的时间差；超过 24 小时的视为异常，不计。时长计在该轮开始的那个桶里 |
| 用户消息（活跃时段） | `user/message` 且 `source.kind === 'user'`，即用户亲手发出的消息 |
| 步数 / Token | 每条 `assistant/message` 计一步；`usage.{input,output,cacheRead,cacheWrite}Tokens`。模型取 `message.source.model` |
| 工具调用 / 失败 | `tool/call`；`tool/result.message.isError` 或 `error` |
| 文件类型 | 改动文件的扩展名（没有扩展名时取文件名，如 `Makefile`） |

- **分叉前缀**：带 `isSeeded` 的日志只统计最后一个 `session/end-seed {inherited:true}` 之后的事件。前缀里发起的工具调用，就算结果在前缀之后，也不计入。如果分叉日志里没有这个标记，整个日志按无法读取处理，以免重复计入。实测本机 110 个分叉日志共继承了 1,912 轮，占原始总数 3,487 轮的一半以上。
- **主会话 / 子代理**：按会话头的 `origin === 'subagent'` 区分。Agent Teams 的队友会话不带这个标记，计入主会话。
- **不计入**：通过 bash（`sed -i`、`cat >`、`git apply` 等）改的文件，因为没有 diff 记录。
- **缺失时间**：没有 `time` 的事件沿用上一条事件的时间，初始值为会话头的 `createdAt`。

## 经典问题与解法

- **行级 diff 的最小编辑距离**：先剥掉公共前缀和公共后缀，对剩下的中段做 Myers O((N+M)D) diff，D 上限 4000。超过上限时退回「剥离后剩余行数」的上界估计。得到的是 git 口径的 `+/-`，不是简单地比较行数。
- **增量计算**：类似 make 的新鲜度检查。每个日志的折叠结果按「相对路径 + size + mtime + 口径版本」缓存，只有变化的文件才重读。缓存文件用「临时文件 + rename」原子写入，权限 0600。
- **stale-while-revalidate + single-flight**：快照超过 30 秒后，请求先拿到旧结果（`refreshing:true`），后台同时只跑一个扫描。首次打开时还没有快照，返回 `scanning` 和进度，页面每 800 ms 轮询一次。
- **时区**：Host 按 15 分钟的 UTC 桶存储。报表按浏览器时区（`tz` 参数）重新归入本地日期和小时。15 分钟能整除所有现行时区偏移（包括 +5:45、+8:45），所以重新归类是精确的。
- **热力分档**：和 GitHub 一样，按非零日的四分位分成 1–4 档，最大值固定为第 4 档。每日用量高度偏斜，线性刻度会让绝大多数日子发白。
- **连续天数**：最长连续是最长的一段非零日。当前连续从今天往回数；如果今天还没有记录，就从昨天开始数，避免一早打开页面时连续天数归零。

## 路由

`GET /plugin-usage-stats/state?range=365|180|90|30|all&tz=<IANA>&refresh=1`

- 只接受本机回环地址的请求，其他来源返回 403。未知路径返回 404，非 GET 请求返回 405。未知时区改用 Host 的时区。
- 响应信封：`{ ok:true, version:1, status:'scanning', progress }`、`{ ok:true, version:1, status:'ready', refreshing, scannedAt, report, skipped }`，或 `{ ok:false, error:{code,message} }`。页面发现版本号不一致时，会提示刷新或重启。

## 页面状态

- **首次扫描**：显示转圈、「已读 X / Y 个会话」和进度条。
- **没有数据**：当前范围内没有会话活动，提供「查看全部时间」按钮。
- **读取失败**：还没有任何数据时显示错误卡片和「重试」。已有数据时，只在顶部显示红色提示条，下面继续显示上一次的结果。
- 热力图按卡片宽度均分周列，格子是正方形，边长在 5–14px 之间、间距 2px：设置弹窗宽度（约 560px）下一整年 53 列不用滚动就能放下，30 天这种短范围的格子最大 14px，不会被拉得很大。格子小于 5px 时才回退成横向滚动，自动滚到最新一周，左侧星期标签固定不动。KPI 和表格用 auto-fit 网格自动换行。
