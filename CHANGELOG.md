# 更新日志

本文件记录面向使用者的重要变更。格式参考 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.1.0/),
版本号遵循语义化版本。

## [Unreleased]

### V10.7 移动端听书默认本地引擎(v8.3.2)

- **听书默认引擎改为 Kokoro 本地语音**:edge 在线合成是长时 POST(浏览器 → /api/tts → 服务器 → bing WebSocket,单次数秒~15s),移动网络路径上的中间层(运营商透明代理/CDN 边缘节点)等待超时后会替服务器返回 502 错误页(非 JSON,前端因此显示笼统的「语音合成失败(502)」而非服务端具体错误)——PC 走宽带直连无此拦截,故同一本小说 PC 正常、手机端 502。kokoro 在服务器本地 CPU 合成、不走外网、响应 <1s,天然规避中间层拦截与出口受限,移动端更稳。
- **自动切换逻辑**:本地引擎可用(镜像 `ENABLE_LOCAL_TTS=1` 且模型已挂载)且用户从未手动选过引擎时,默认自动使用 Kokoro;本地引擎不可用或用户显式选了 edge/系统语音时尊重原选择;kokoro 失效时自动回退 edge 保证能出声。
- **文案同步**:引擎下拉 Kokoro 置顶并标注「推荐」,错误提示优先建议「Kokoro 本地语音」;`/api/tts` GET 探测的 `engines` 数组改为 kokoro 优先。
- **验收**:`npm run test:tts-reader`(纯函数回归)、`npm run test:tts-local`(依赖已装环境验证本地合成);`typecheck` + `build:web` 通过。

### V10.6 僵尸任务自动恢复(v8.3.1)

- **修复创作中心「执行中」永久卡死**:容器重建/崩溃导致执行进程消失时,被认领为 `RUNNING` 的 AI 任务因无超时机制永远不再被重新认领(调度器只领取 `PENDING`)。调度器每个 tick 新增 `recoverStaleRunningTasks()`——`started_at` 超过 `AI_TASK_STALE_GRACE_MS`(默认 10 分钟)仍为 `RUNNING` 的任务重置回 `PENDING` 自动重跑,执行痕迹清空、attempt 历史保留。
- **阈值可配**:`AI_TASK_STALE_GRACE_MS` 环境变量(毫秒,下限 60000),默认 10 分钟——远超整篇生成最长耗时(约 3 分钟),不会误伤正常执行中的任务;web 侧 story-worker 不做恢复,防止与执行中任务双跑。
- **验收**:`scripts/verify-stale-task-recovery.ts`(僵尸恢复、阈值内不误伤、状态不受扰、恢复后可重新认领并执行成功)。

### V10.5 持续创作产线(背压驱动的无间隙生产)

- **产线新增 `continuous` 持续模式**:不设时间间隔,由调度器按背压驱动——上一批短篇消化到阈值以下即触发下一轮(在飞数含 draft,阈值 = max(2, count×2)),真实节奏由 LLM 消费速度决定,永不停止、不堆积。
- **停止门禁**:人工暂停(`enabled=false`)+ 连续失败自动熔断——连续 `max_consecutive_failures`(默认 3)轮运行失败自动停线并记录熔断原因/时间,「恢复」一键清零续跑;熔断阈值可在产线编辑中配置(1..20)。
- **默认随机题材池**:持续模式未配置题材时启用内置 10 题材 × 3 种子主题的 `DEFAULT_KINDS`,每轮题材 shuffle + 权重抖动,保证多轮不重样;指定题材配置优先。
- **调度器接入**:`fireDueContinuousProductionRuns()` 每个 tick 检查一次(触发粒度 = `PUBLISH_TICK_SECONDS`),单线失败不阻断其他线。
- **创作中心 UI**:产线编辑新增「持续(背压驱动)」模式、每轮篇数(1..10)、熔断阈值;未配置每日上限/预算时二次确认;产线卡片与总览「持续创作」状态卡显示 生产中/已暂停/已熔断、在飞数/背压阈值、连续失败计数;异常分诊新增「熔断产线」一键恢复。
- **观测**:总览告警新增 `tripped_line`(持续产线已熔断);产线清单与总览 lanes 返回在飞数与背压阈值。
- **新增表列**(列迁移,幂等):`production_lines` + `consecutive_failures` / `max_consecutive_failures` / `tripped_reason` / `tripped_at`。
- **验收**:`scripts/verify-continuous-production-line.ts`(连跑多轮、背压拦截、熔断→恢复、随机题材池、观测聚合)。

### V10.2.1 构建修复(v8.2.2)

- **修复 `next build` 编译失败(UnhandledSchemeError: node:crypto)**:`lib/markdown.ts` 原先用 `node:crypto` 生成缓存键,但该模块同时被客户端组件(admin 作品详情页「渲染预览」)引用,webpack 打包浏览器 bundle 时无法解析 `node:` scheme。缓存键改为纯 JS 双通道 FNV-1a(64 位),服务端与浏览器行为一致,内容寻址语义不变。

### V10.2 产线运营 UI 优化(v8.2.1)

- **产线卡片关键信息前置**:调度(每日时刻/手动触发)、每批篇数、单次/每日上限、每日预算、达标线、自动发布直接展示在卡片上,无需进入编辑即可掌握执行周期;标题旁常显启用/停用与最近一次运行状态徽章,底部展示上次运行详情(触发方式 + 篇数)。
- **产线编辑器弹窗改抽屉**:编辑/新建从 512px 弹窗改为右侧 720px 抽屉,表单分区白底描边、头部常显启停状态,多区块配置不再拥挤。

### V10.1 发布闭环补全 + 长篇工作台聚焦流水线(v8.2.0)

- **创作中心「作品」Tab(发布闭环)**:已达标作品列表,展示**线上版本 vs 最新版本**,线上落后时高亮并一键「重新发布」;core 新增 `republishShortStory`——线上 Book+Chapter 原地更新为最新应发版本,读者链接 `/short/[id]` 不变,发布记录追加保留追溯;作品 Tab 提供「复制读者链接」「查看读者页」入口。
- **短篇阅读页 metadata 修复**:标题不再重复拼接(`${title} · 短篇 · ${title}` → `${title} · 短篇`)。
- **长篇工作台 UI/UX 聚焦**:选书只拉长篇(`listAllBooks` 新增 `kind` 过滤,books 路由透传 `kind` 参数);原生下拉改可搜索选择器(搜索过滤 + 连载状态/章节数徽标);一级 Tab 重组——「章节流水线」(AI 工作台 + 自动连载,默认)与「故事设定」(六类事实收纳);新书空态步骤化引导(世界观→人物→大纲→生成首章)。

### V10 内容工厂(P0–P2)

- **新增「产线(Production Line)」一等实体**:一整套「题材/类型模板 + 调度 + 配额 + 质量闸门」配置;一次运行按每个题材的权重分配一批短篇,支持**同一批生成不同题材/类型**(`count >= 题材数` 时每题材至少 1 篇,题材种子池 round-robin 保证同题材也不重样)。
- **`/admin/creation` 重构为「内容工厂」运营指挥中心**:一级 Tab 总览 / 产线 / 队列 / 质量闸门 / 异常分诊 / 成本。
  - 总览:产线健康(今日产出/达标/在制/池/失败/通过率)+ 产出漏斗 + 产线泳道 + 告警 + 最近运行。
  - 产线:创建/编辑(题材清单 weight+种子池、调度、配额、质量闸门)/启停/删除/一键运行。
  - 队列:按类型积压/运行/近 7 日成败 + 执行中任务。
  - 质量闸门:低质量池 + 各产线达标情况。
  - 异常分诊:失败任务/失败创作/低质池/配额超限/规则离线/停用产线,一键重试/优化/启用。
  - 成本:按日/按产线 token 与估算成本、单篇发布成本。
- **新增表**:`production_lines` / `production_runs` / `production_run_items`(产线 → 运行 → 作品,级联删除);使用权属清晰、可聚合。
- **调度器集成**:`fireDueDailyProductionRuns()` 每日到点自动触发,每日产线同日去重。
- **数据闭环**:单篇需求 = 产线基线 ⊕ 题材 brief ⊕ 种子,复用既有「生成 → 评审 → 自动优化 → 再评审 → 达标发布/入池」流水线,无破坏性改动。


## [9.5.0] — 2026-08-26

首个 tag 版本:V9 创作评审中心 + V9.5 阶段二 + 阶段二补丁(M13–M18),全部合入 master(#64/#65/#66/#67/#68)。

### 修复

- **TTS 移动端播放**:首次「朗读」在手势内静音预热解锁并清掉 iOS 卡住的暂停态(WKWebView 点击无声);iOS 改用取消式暂停保留进度;段落按句二次切片、单片字符上限随语速动态钳制,规避安卓 Chrome 超长朗读静音截断;语音列表多重试获取且下拉常显(#67)

### V9.5 阶段二补丁(M13–M18,#66)

- **长篇单章自动优化闭环**:章节评审不合格时自动入队 `AI_OPTIMIZE_CHAPTER`,按评审问题清单改写正文后自动重评,直到达标或达到 `chapter_review_max_rounds` 上限;`chapters.optimize_round` 记录已用轮数
- **调度器单实例互斥锁**:`<数据目录>/scheduler.lock`(O_EXCL + pid 存活检测),第二实例启动即退出,崩溃残留自动接管;`NOVEL_SCHEDULER_LOCK=0` 可跳过
- **TTS 朗读段高亮**:当前朗读段落左侧琥珀色竖条 + 渐变底色(dark 模式适配)
- **评审中心统计补全**:近 7 日章节/弧级评审量双柱趋势、章节维度均分(薄弱维度升序)、弧评汇总
- **章节评审批量入队**:管理端支持多选已发布章节批量入队,逐章校验并返回跳过明细
- **弧评区间模板**:全书 / 上次弧评后 / 最近 5 章一键预填
- **章节评审差异对比**:同章多次评审的分数轨迹、维度首评→最新对比、遗留问题清单

### V9.5 阶段二(M7–M12)

- **短篇发布物化**(M7):`short_story_publications` 表 + `publishShortStory`(passed → Book(kind='short') + Chapter);books 新增长篇评审配置 6 列
- **短篇上线读者站**(M8):公开 API `/api/short-stories`、阅读页 `(site)/short/[id]`、BookCard「短篇」角标
- **长篇章节/弧级评审引擎**(M9):`chapter-review` / `arc-review`;`arc_review_records`;`books.arc_review_every_n`(默认 5)半自动阈值
- **调度器驱动 ai_tasks**(M10):tick 第三块 `processAiTasks({limit:5})`
- **Web Speech API TTS**(M11):零依赖播放器,段落切片、语速/语音偏好持久化
- **文档同步**(M12):README 与 architecture.md 覆盖 V9.5

### 收尾补丁

- 章节发布自动入队评审:`importChapter(published)` 与 `approveChapter(now)` 双路径,去重守卫,失败不阻塞发布
- 评审中心新增「章节评审」「弧级评审」管理 Tab

## [9.0.0] — V9 AI 创作与评审中心(M1–M5)

> 说明:V9 功能随 develop 合入 master 的 squash 提交进入主线(PR #64/#65),未单独打 tag。

- 数据层:short_stories / short_story_versions / review_rules / review_rule_versions / review_prompts / review_records / ai_tasks 七表与状态机
- 引擎:结构化输出容错提取 + 校验 + 自纠重试 ≤2;加权定级服务端计算;全链路留痕
- 自动优化:不合格自动改稿再评审,受规则版本轮数上限约束;低质量池兜底
- 管理 API 18 个路由;/admin/creation 创作中心 + /admin/review-center 评审中心五视图

## [8.1.0] — 2026-08-25

- 平台更名「云燕阅读」(此前为「云雀小说」)
- 连载每日流水线按北京时间调度展示;LLM 网络错误透出根因并加重试
