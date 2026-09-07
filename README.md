# 云燕阅读 · AI 原创小说内容平台

云燕阅读（AI Novel Site）是 AI 生成小说的**内容管理 + Web 阅读**一体化平台：从小说源文件导入、后台编审、AI 自动连载、短篇批量生产，到读者站阅读、听书与数据闭环。

| | |
|---|---|
| 当前版本 | v8.3.8（V1–V10.7 里程碑全量落地，详见[功能规划](#功能规划与完成情况)） |
| 技术栈 | Node.js ≥ 20 · Next.js 15 (App Router) · TypeScript · better-sqlite3 (SQLite WAL) · Tailwind CSS · Zod · Kokoro 本地听书 |
| 协议 | [MIT](#协议mit) |

---

## 截图

<p align="center">
  <img src="screenshot/1.png" alt="截图 1" width="49%" />
  <img src="screenshot/5.png" alt="截图 5" width="49%" />
</p>

更多截图请查看 [screenshot.md](screenshot.md)（含全部界面截图）。

---

## 架构

```text
 novels/（MD/TXT 小说源，事实来源）
        │
        ▼
┌───────────────────┐   幂等导入   ┌────────────────────────────────────┐
│    Importer CLI   │ ──────────▶ │          Content Core（core/）      │
│ book.yaml + 章节MD │             │  领域模型 · 状态机 · 业务服务         │
└───────────────────┘             │  SQLite WAL（data/novel.db，单库共享）│
                                  └──────────────┬─────────────────────┘
                                                 │ 直接函数调用（同进程）
                     ┌───────────────────────────┴──────────────────────┐
                     ▼                                                  ▼
        ┌────────────────────────────┐                    ┌──────────────────────────────────────────────────┐
        │   Web Publisher（web/）   │                     │   Scheduler（常驻调度器 · 单实例文件锁）         │
        │   Next.js 15 App Router  │                      │  · 到期定时章节发布 + 每书每日自动发布（V3）     │
        │  ├─ 读者站 /(site)        │                     │  · AI 自动连载（生成→质检→发布，V5）             │
        │  ├─ 管理后台 /admin       │                     │  · 短篇定时创作 / 批量排期（V9.6–V9.8）          │
        │  └─ API Routes /api/**   │                      │  · AI 任务消化：章节/弧评审等（V9.5）            │
        │  （听书：Kokoro / Edge /  │                     │  · 每日产线 / 持续产线触发（V10 / V10.5）        │
        │   系统语音）              │                     │  · 僵尸任务自动恢复（V10.6）                     │
        └────────────────────────────┘                    └──────────────────────────────────────────────────┘
```

**三个 npm workspaces + 一份 SQLite**：Web 与调度器以只读/写同库方式解耦运行；管理后台与调度器通过机器令牌或账号会话访问同一套 Core 服务；调度器以 `scheduler.lock` 文件锁保证单实例（详见[部署](#部署)）。更完整的架构说明（运行单元 / 数据模型 / 发布流水线 / AI 创作子系统）见 [docs/architecture.md](docs/architecture.md)。

### Content Core 模块划分（`core/src/`）

| 模块 | 职责 |
|---|---|
| `service.ts` | 书籍 / 章节 / 作者 / 分类 / 标签 CRUD 与查询，发布状态机（draft → pending_review → scheduled → published → hidden）、autopilot 自动发布周期 |
| `story.ts` / `story-context.ts` | Story Core：世界观、人物、关系、故事线、章节大纲、伏笔；生成时组装上下文注入 AI |
| `ai-writer.ts` | AI 写手：调用 LLM 生成章节（OpenAI 兼容协议，支持模型自动发现），可选 LLM 质检 |
| `ai-serial.ts` | AI 自动连载：每书每日定时入队 → 生成 → 质检 → 送审 / 直接发布 |
| `short-story.ts` | V9 短篇 CRUD、brief 归一化、版本只增不改、状态流转 |
| `short-story-pipeline.ts` | V9 整篇创作闭环 + AI 任务串行分发器（CREATE_NOVEL / 字段辅助 / 评审 / 手动优化） |
| `review-rule.ts` / `review-prompt.ts` | V9 评审规则 / Prompt 版本化：同名迭代、历史不可覆盖、全局唯一生效版本 |
| `ai-task.ts` | V9 统一 AI 任务账本：创建 / 领取 / 完成 / 失败 / 重试 / 取消 |
| `structured-output.ts` | V9 结构化输出：提示词约束 + 容错 JSON 提取 + zod-free 校验 + 自纠重试 ≤2 次 |
| `review-engine.ts` | V9 评审引擎：读生效规则 + Prompt → 加权计分定级 → 全链路评审记录落库 |
| `optimize-engine.ts` / `chapter-optimize.ts` | V9 / V9.5 评审驱动的针对性改稿（短篇整篇 / 长篇单章，受最大优化轮数约束） |
| `ai-assist.ts` | V9 字段级 AI 建议 / 生成 / 优化统一执行器 |
| `short-story-publication.ts` | V9.5 passed 短篇物化为 `Book(kind='short')` + Chapter（读者站可读） |
| `chapter-review.ts` / `arc-review.ts` | V9.5 长篇单章 / 弧级自动评审（`review_records` / `arc_review_records`，半自动阈值判定） |
| `review-stats.ts` | V9.5 补丁 评审统计聚合（评审量趋势 / 章节维度均分 / 弧评汇总） |
| `short-story-batch-schedule.ts` | V9.6–V9.8 短篇批量定时创作：到点批量建篇入队、每天重复、计划编辑与标题 AI 辅助 |
| `production-line.ts` | V10 内容工厂：产线（题材模板 / 调度 / 配额 / 质量闸门）+ 混合题材分配 + 每日调度；V10.5 持续模式（背压驱动 + 自动熔断） |
| `production-ops.ts` | V10 内容工厂：运营聚合（总览 / 队列 / 质量闸门 / 异常分诊 / 成本估算） |
| `reader.ts` | 读者系统：注册登录（scrypt 哈希）、会话、书架、收藏、订阅、阅读进度 |
| `discovery.ts` | Discovery 热度信号：PV / 完读统计，推荐候选 |
| `analytics.ts` | 数据分析：阅读会话、总览指标、单书完读率 / 留存漏斗 |
| `settings.ts` | 后台 LLM 配置（密钥掩码存储、连通性测试、模型发现） |
| `admin-auth.ts` | 管理员账号体系：默认账号播种、登录、强制改密、24h 会话 |
| `db.ts` | 连接管理 + 幂等 DDL + 轻量列迁移 |

### Web 页面结构（`web/app/`）

- **读者站 `(site)`**：首页发现位 / 全部小说（分类折叠展开 + 无封面书按题材动态生成书本 SVG 封面）/ 详情页 / 章节阅读（字号、深色模式、进度条、滑动翻页、听书）/ 短篇独立阅读页 `/short/[id]` / 分类 / 搜索 / RSS · Sitemap · Robots / 注册登录 / 书架 / 阅读历史 / 页头 GitHub 源码链接
- **管理后台 `/admin`**：概览、小说管理（含书籍详情）、审核队列、**内容工厂** `/admin/creation`（总览 / 产线 / 队列 / 质量闸门 / 异常分诊 / 成本 / 作品）、长篇工作台 `/admin/story`（Story Core 六类实体 + AI 章节生成）、**AI 评审中心** `/admin/review-center`（评审任务 / 评审记录 / 评审规则 / Prompt 版本 / 质量数据）、数据分析、作者 / 分类 / 标签、媒体库、系统设置（LLM）
- **API Routes `/api`**：
  - 读者端：`auth/*`（注册 / 登录 / 会话）、`books/*`（详情 / 阅读进度 / 收藏 / 订阅 / 统计）、`discovery`、`me/*`（书架 / 历史）、`covers/*`（动态封面 SVG）、`short-stories/*`（短篇公开 API）、`tts`（听书合成：Kokoro / Edge 代理）
  - 管理端 `admin/*`（令牌 / 账号会话鉴权）：`auth`、`books`（含 story / autopilot / ai-serialization / chapters 评审）、`ai`（assist / generate-chapter / serial / tasks）、`analytics`、`media`、`review-queue`、`review-records`、`review-rules` / `review-rule-versions`、`review-prompts`、`review/stats`、`chapter-reviews`、`arc-reviews`、`short-stories`（创作 / 评审 / 优化 / 发布 / 重新发布 / 排期 / 版本）、`short-story-batch-schedules`、`production-lines`、`production`（overview / queue / gate / exceptions / cost）、`publish/run`、`settings/llm`

---

## 功能规划与完成情况

> 版本路线源自 [`docs/AI原创内容创作平台.md`](docs/AI原创内容创作平台.md)，✅ = 已完成并带验证脚本，🚧 = 规划中。

### ✅ V1 内容基础
- MD/TXT 小说目录幂等导入（元数据 + 章节解析 + 封面复制）
- Content Core 五对象模型（Book / Chapter / Author / Category / Tag），SQLite WAL
- Web Publisher 阅读站（首页 / 书库 / 详情 / 阅读页 / 分类 / 搜索）
- RSS / Sitemap / Robots SEO 输出

### ✅ V2 内容管理（Admin）
- 管理后台：小说管理（含隐藏 / 恢复）、章节接排与重排、作者 / 分类 / 标签管理
- 媒体库：白名单格式上传、路径穿越防护、CSP 沙箱化对外服务
- **管理员账号体系**（v8.1）：初始化默认账号 `admin / Admin@123456`，首登强制改为复杂密码（≥10 位，含大小写 / 数字 / 特殊字符且不含账号名）；未改密前业务接口一律 `403 PASSWORD_CHANGE_REQUIRED`
- 双轨鉴权：账号会话（24h）+ `ADMIN_TOKEN` 机器令牌（供调度器 / 集成脚本）

### ✅ V3 发布系统
- 章节状态机：draft → 送审 → 批准（立即 / 定时）→ published；驳回带备注回 draft
- 审核队列工作台；每书自动发布配置（autopilot：开关 / 小时 / 每日篇数）
- 常驻调度器逐 tick 扫描到期章节并发布

### ✅ V4 AI 创作
- AI Writer：按书配置 LLM 生成整章，Story Core 上下文（世界观 / 人物 / 关系 / 大纲 / 伏笔）注入提示词
- Story Core 六类实体维护界面（AI 创作中心内）
- AI 质检：LLM Review 生成后自检再送审

### ✅ V5 AI 自动连载
- 每书每日自动生成 N 章：入队 → 生成 → 质检 → 自动送审 / 直接发布
- 生成任务队列（重试、错误记录、字数下限、模型指定）；手动触发与任务列表
- 后台 LLM 设置：密钥掩码、连通性测试、OpenAI 兼容模型自动发现

### ✅ V9 AI 小说创作与自动评审中心
- **AI 创作中心**（`/admin/creation`）：一级 Tab 短篇 / 长篇
  - 短篇 Tab：创作需求 18 字段（基础信息 / 故事结构 / 创作参数），每字段 ✨AI建议 / AI生成 / AI优化（异步任务 + 轮询）;整篇创作流水线（生成 → AI 质量检查 → 评审 → 自动优化 → 再评审，受规则版本轮数约束，达标即停 / 超过上限入低质量池）
  - 长篇 Tab：第一阶段为占位，链接既有长篇工作台（V10 起 `/admin/creation` 重构为内容工厂，长篇工作台独立为 `/admin/story`，见下文 V10 小节）
- **AI 评审中心**（`/admin/review-center`）：五视图
  - 评审任务：AI 任务历史可重试 + 详情； 评审记录：每次评审全链路快照（小说 / 版本 / 规则版本 / Prompt 版本 / 模型 / 轮次 / 原始响应）
  - 评审规则：维度化规则（权重 / 标准四档 / 阈值 / 最大优化轮数）版本化、全局唯一生效版本、published 不可改（必须新建版本）
  - Prompt 版本：同名即迭代、历史不可覆盖、可关联规则版本
  - 质量数据：基础统计（评审数 / 通过率 / 平均分 / 平均优化次数 / 作品状态分布）
- **数据层**：短篇 + 版本（只增不改） + 评审规则/版本 + Prompt + 评审记录 + 统一 AI 任务（CREATE_NOVEL / 字段辅助 / 评审 / 手动优化）共 7 张新表
- **结构化输出**：核心层 `structured-output.ts` 提示词约束 + 容错 JSON 提取 + zod-free 校验 + 自纠重试 ≤2 次，耗尽抛 `STRUCTURED_OUTPUT_FAILED`
- 验证脚本：`test:short-story` / `test:review-rule` / `test:review-prompt` / `test:structured-output` / `test:review-engine` / `test:auto-optimize` / `test:ai-assist` / `test:creation-api` / `test:review-api` 全部通过

### ✅ V9.5 阶段二:短篇上线 + 长篇评审 + 语音朗读

- **短篇发布到读者站**：通过评审的短篇在 `/admin/creation` 一键发布 → 物化为 `Book(kind='short')` + 1 章 + `short_story_publications` 记录。多次发布不同 version 各得独立 URL(同 version 重复发布拒绝)
- **短篇发现位**：首页/分类/搜索 + 公开 API `/api/short-stories` & `/api/short-stories/[id]`。`BookCard` 绿色"短篇"角标
- **短篇独立阅读页**：`/short/[storyId]` 轻量布局(标题 + 简介 + 渲染正文 + 回链)
- **长篇单章自动评审**：`runChapterReview(chapterId)` → 复用评审引擎 → 落 `review_records(ref_type='chapter', chapter_id=...)`。`story_id`/`story_version_id` 改可空,以兼容长篇场景
- **长篇弧级评审**：`runArcReview(bookId, fromChapter, toChapter, arcLabel)` → 拼接弧内章节(单章 6000 字/总 8000 字硬控)→ 落 `arc_review_records`(独立表,因实体边界不同)
- **半自动弧评**：`books.arc_review_every_n`(默认 5,0=关)+ `last_arc_review_chapter` 记录游标;`shouldTriggerAutoArcReview(bookId)` 阈值判定
- **长篇自动评审配置**：`books.chapter_review_enabled`(默认开)、`chapter_review_max_rounds`(默认 1 轮)、`arc_review_enabled`(默认开)
- **统一 AI 任务扩展**：`AI_REVIEW_CHAPTER` / `AI_REVIEW_ARC` / `PUBLISH_SHORT_STORY` 三类新任务;调度器第三块 `processAiTasks({limit:5})` 拉起章节/弧评任务
- **调度器互斥**:ai_tasks 的 PENDING→RUNNING 转换是抢抢式,多实例会重复处理——V9.5 补丁起以 `<数据目录>/scheduler.lock` 文件锁(pid 存活检测、崩溃残留自动接管)强制单实例,`NOVEL_SCHEDULER_LOCK=0` 可跳过;生产环境仅启一个调度器实例
- **语音朗读(听书)**:`/short/[id]` 与长篇章节阅读页挂载 `TtsPlayer` 客户端组件;**三引擎**:本地 Kokoro(服务器 CPU 合成,移动端默认,规避长时在线合成被中间层 502)、Edge 在线神经语音(经 `/api/tts` 代理)、Web Speech 系统语音;段落切片顺序朗读(play/pause/stop + 语速 0.5-2.0× + 语音/引擎下拉);偏好持久化(语速/语音/引擎);朗读段自动滚动至视区;移动端适配:手势内预热解锁、iOS 取消式暂停、按句二次切片防安卓超长截断、语音列表多重试且下拉常显
- **新表**:`short_story_publications`、`arc_review_records`;`review_records` 加 `chapter_id` + `ref_type` 列;`books` 加 5 列长篇评审配置、`chapters` 加 `optimize_round` 列
- **新公开端点**:`/api/short-stories`(列表)、`/api/short-stories/[id]`(详情)
- **V9.5 阶段二补丁(M13–M18)**:长篇单章自动优化闭环(评审不合格自动入队 `AI_OPTIMIZE_CHAPTER`,按问题清单改写后重评,受 `chapter_review_max_rounds` 约束);章节发布自动入队评审(importChapter / approveChapter 双路径去重,失败不阻塞发布);调度器单实例文件锁(`scheduler.lock`);TTS 朗读段高亮(当前段左侧琥珀竖条 + 渐变底色);评审中心统计补全(近 7 日章节/弧级评审量双柱趋势、章节维度均分、弧评汇总);章节评审批量入队(多选已发布章节,逐章校验返回跳过明细);弧评区间模板(全书 / 上次弧评后 / 最近 5 章一键预填);章节评审差异对比(分数轨迹、维度首评→最新对比、遗留问题清单)
- 验证脚本:`test:short-story-publication` / `test:short-story-reader` / `test:chapter-review` / `test:arc-review` / `test:scheduler-tasks` / `test:tts-reader` 全部通过;补丁新增 `test:chapter-optimize` / `test:chapter-review-auto-enqueue` / `test:scheduler-lock` / `test:review-stats`;截至 V10.7 `test:*` 共 44 套(含 Playwright E2E)覆盖全部分子系统

### ✅ V9.6–V9.8 短篇批量定时创作

- **批量定时计划**(V9.6):一个计划 = 到点创建 `count` 篇短篇并逐篇入队创作流水线(生成 → 评审 → 达标自动发布),标题不填时由流水线自动生成;与单篇定时(`short_stories.scheduled_at`)互补
- **每天重复**(V9.7):`repeat_daily=1` 时按 `scheduled_at` 时刻每日触发一次(本地日期同日去重)
- **计划编辑与标题 AI 辅助**(V9.8):批量计划支持编辑与批量标题 AI 一键生成
- **调度器**:tick 新增 `fireBatchSchedule()`;建篇 + 入队均为本地 DB 操作(无 LLM 调用),到点执行瞬时完成
- 验证脚本:`test:short-story-schedule` 全部通过

### ✅ V10 内容工厂(Production Line · P0-P2)

面向**批量化不同题材/类型**的短篇生产运营。

- **产线(`production_lines`)是一等实体**:一整套「题材/类型模板 + 调度 + 配额 + 质量闸门」配置。
  - **混合题材分配** `assignRunKinds`:按每个题材的 `weight` 给一次运行分配 `count` 篇,保证**同一批产出覆盖不同题材、类型**;`count >= 题材数` 时每个题材至少 1 篇。
  - **种子池**:每个题材可配多组种子(主题/梗概),运行内 round-robin 分配,让**同题材也各不相同**。
  - 单篇需求 = 产线基线 ⊕ 题材 brief ⊕ 种子,`genre` 强制写入,再逐篇走既有「生成→评审→自动优化→再评审→达标自动发布/入池」闭环(复用 `CREATE_NOVEL` 任务)。
- **运行(`production_runs`)**:手动/每日触发;每日产线同日去重(`last_run_date`);`production_run_items` 关联表把每篇映射到其产线/题材,供聚合查询。
- **运营指挥中心**(`/admin/creation` 重构为内容工厂,一级 Tab):
  - **总览**:产线健康(今日产出/达标/在制/池/失败/通过率)、产出漏斗、产线泳道、告警、最近运行。
  - **产线**:列表 + 编辑/启停/删除 + 一键运行;新建/编辑含题材清单(weight/种子池)、调度、配额(每日上限/预算/超预算跳过)、质量闸门(达标分/最大优化轮数/自动发布)。
  - **队列**:按类型积压/运行/近 7 日成败 + 当前 RUNNING。
  - **质量闸门**:低质量池 + 各产线达标情况(均分/通过率/阈值)。
  - **异常分诊**:失败任务/失败创作/低质池/配额超限/规则离线/停用产线 → 一键重试/优化/启用。
  - **成本**:按日/按产线 token 与估算成本、单篇发布成本。
- **数据层**:新增 `production_lines` / `production_runs` / `production_run_items` 三表;所有权由产线 → 运行 → 作品,级联删除。
- **调度**:scheduler tick 新增 `fireDueDailyProductionRuns()`,每日产线到点自动触发。
- **候选决策点**:产线默认取全局当前生效评审规则(`ruleId` 可覆盖);达标线 `qualityGate.minScore` 缺省回落规则阈值,`reworkMaxRounds` 缺省回落规则值。
- 验证脚本:`test:production-line`(隔离临时库,全部通过)。

**V10 后续迭代:**

- **V10.1 发布闭环补全 + 长篇工作台聚焦**:内容工厂新增「作品」Tab——已达标作品列表展示**线上版本 vs 最新版本**,线上落后时高亮并一键「重新发布」(`republishShortStory` 原地更新 Book+Chapter,读者链接 `/short/[id]` 不变,发布记录追加保留);长篇工作台独立聚焦流水线:选书只拉长篇(`kind` 过滤)、可搜索选择器(连载状态/章节数徽标)、一级 Tab 重组「章节流水线 / 故事设定」、新书空态步骤化引导(世界观→人物→大纲→生成首章)
- **V10.2 产线运营 UI 优化**:产线卡片关键信息前置(调度 / 每批篇数 / 配额 / 达标线 / 自动发布 / 最近运行状态徽章);编辑器弹窗改右侧 720px 抽屉
- **V10.5 持续创作产线(背压驱动的无间隙生产)**:产线新增 `continuous` 持续模式——不设时间间隔,由调度器按背压驱动(在飞数低于阈值即触发下一轮,阈值 = max(2, count×2)),真实节奏由 LLM 消费速度决定;人工暂停 + 连续失败自动熔断(`max_consecutive_failures` 默认 3,可配置 1..20),「恢复」一键清零续跑;未配置题材时启用内置 10 题材 × 3 种子随机题材池(每轮 shuffle + 权重抖动);调度器 `fireDueContinuousProductionRuns()` 每 tick 检查,单线失败不阻断其他线;异常分诊新增「熔断产线」一键恢复;`production_lines` 加 4 列(consecutive_failures / max_consecutive_failures / tripped_reason / tripped_at)
- **V10.6 僵尸任务自动恢复**:容器重建/崩溃导致执行进程消失时,被认领为 `RUNNING` 的 AI 任务不再永久卡死——调度器每 tick `recoverStaleRunningTasks()`:超过 `AI_TASK_STALE_GRACE_MS`(默认 10 分钟,下限 60s)仍为 RUNNING 的任务重置回 PENDING 自动重跑,执行痕迹清空、attempt 历史保留
- **V10.7 听书默认本地引擎 + 部署修复**:本地 Kokoro 引擎可用(镜像 `ENABLE_LOCAL_TTS=1` 且模型已挂载)且用户从未手动选过引擎时默认自动使用 Kokoro,失效自动回退 Edge;引擎下拉 Kokoro 置顶并标注「推荐」;修复链:compose 写死 `ENABLE_LOCAL_TTS=0` 覆盖命令行构建参数 → webpack 把 `createRequire` 编译成必抛错 stub 导致线上 kokoro 恒 false(改 fs 向上探测 node_modules)→ 低配主机内存换页风暴(V8 堆限 768MB + 容器 `mem_limit` 1500m)→ kokoro 并发合成内存峰值叠加 + 300 字文本上限(单次合成,前端切片约 52 字/次)
- **V10.7.5 读者站分类浏览优化**:「全部小说」页分类默认只展示前 8 个主要分类(按书籍数量排序),「展开全部 / 收起」切换;分类名以「小说」结尾时(如「短篇小说」)不再拼接出「短篇小说小说」
- **V10.7.6 动态封面**:无封面书籍不再显示首字占位——所有封面位(首页主推/全部小说/发现/热门榜/最新更新/搜索/详情)按 分类/题材 渲染书本形 SVG 封面(300×400,10 套题材配色/装饰/字体,纯中文书名竖排、含拉丁/数字横排按词换行);列表行改用 48×48 圆角小图标;有真实封面的书保持原图权威,隐藏/不存在的书 404;验证 `test:cover`(37 项断言)

### ✅ V6 用户阅读
- 读者注册 / 登录 / 登出（httpOnly Cookie 会话，30 天）
- 书架（收藏 ∪ 订阅）、更新提示、订阅追更
- 阅读进度跨设备同步（节流上报）、最近阅读历史

### ✅ V7 推荐发现（Discovery）
- 热度信号采集：PV、滚动完读（匿名可报）
- 发现位推荐卡片（含推荐理由徽章）

### ✅ V8 数据闭环（Analytics）
- 阅读会话记录（时长 / 完读）
- 总览指标（7 日活跃会话等）+ 单章指标（PV / 完读率 / 平均时长 / 流失标记）+ 单书留存漏斗
- 分析结果反哺 AI 创作中心选题

### 🚧 规划中（未开始）
- 全文搜索（SQLite FTS5）、PostgreSQL 适配层
- 评论 / 打赏等读者互动
- 个性化推荐（基于阅读历史的猜你喜欢）
- Hermes 引擎深度集成、EPUB Publisher 与 BookOrbit 对接主流程化（现有独立 EPUB 构建线见 [`README-部署.md`](README-部署.md)）

---

## 目录结构

```text
.
├── core/                  # Content Core:领域模型 + SQLite + 业务服务(npm workspace)
├── importer/              # Importer CLI:novels/ → Content Core(npm workspace)
├── web/                   # Web Publisher:Next.js 15 读者站 + 管理后台 + 听书(npm workspace)
├── scripts/               # verify-* 测试套件(44 套)、publish-scheduler 调度器、hooks 门禁
├── src/                   # 旧 EPUB/BookOrbit 构建线(保留,见 README-部署.md)
├── docs/                  # 产品规划文档(路线图 / architecture.md / 产品规格书)
├── novels/                # 小说导入源(事实来源)
├── data/                  # 运行时数据:data/novel.db(gitignore)
├── e2e/                   # Playwright E2E(独立数据目录 e2e/.tmpdata,gitignore)
├── screenshot/            # README 界面截图(索引见 screenshot.md)
├── models/kokoro/         # 本地听书模型权重(compose 挂载卷,rebuild.sh 自动下载)
├── .githooks/             # pre-push 门禁(Agent Note + master 直推守卫)
├── playwright.config.ts   # E2E 配置(E2E_BROWSER_CHANNEL 可换系统浏览器)
├── docker-compose.yml     # web(:33000) + scheduler 编排(含 models/kokoro 卷)
├── Dockerfile             # 三阶段构建(零编译,预编译 better-sqlite3;ENABLE_LOCAL_TTS 内置 Kokoro)
└── package.json           # npm workspaces 根
```

---

## 项目开发

### 环境要求

- Node.js ≥ 20(推荐 22)、npm;无原生编译依赖(better-sqlite3 使用预编译二进制)

### 本地开发

```bash
npm install                 # 安装全部 workspace 依赖

npm run dev:web             # 启动 Next.js 开发服务器(http://localhost:33000)
npm run import:novel -- novels/星海余烬   # 导入一本小说
npm run seed:100            # 生成 100 章测试小说(可选)

npm run scheduler           # 前台运行调度器(默认 60s 一 tick)
```

### 常用命令

| 命令 | 说明 |
|---|---|
| `npm run typecheck` | 根 + core + web 三层 TS 类型检查 |
| `npm run test:admin-auth` | 管理员账号体系验证(默认密码 / 强制改密 / 会话) |
| `npm run test:api` / `test:publish-api` | 管理 API / 发布工作流回归 |
| `npm run test:ai-api` / `test:ai-serial-api` | AI 写手 / 自动连载 API 回归 |
| `npm run test:reader` / `test:reader-api` | 读者核心 / 读者 API 回归 |
| `npm run test:media` / `test:settings` / `test:analytics` / `test:discovery-api` | 对应子系统回归 |
| `npm run test:short-story*` / `test:chapter-review*` / `test:arc-review` / `test:short-story-schedule` | V9 / V9.5 / V9.6–V9.8 短篇创作、评审、批量排期回归 |
| `npm run test:review-*` / `test:structured-output` / `test:auto-optimize` / `test:ai-assist` | V9 评审中心与结构化输出回归 |
| `npm run test:production-line` / `test:continuous-production-line` | V10 内容工厂产线 / V10.5 持续产线回归 |
| `npm run test:scheduler-lock` / `test:stale-task-recovery` / `test:review-stats` | V9.5+ 调度器锁 / 僵尸任务恢复 / 评审统计回归 |
| `npm run test:tts-reader` / `test:tts-local` / `test:cover` | 听书播放器 / 本地 Kokoro 合成 / 动态封面回归 |
| `npm run test:e2e` | Playwright 浏览器冒烟(登录/评审 Tab/TTS 阅读页;独立数据目录 `e2e/.tmpdata`;首次需 `npx playwright install chromium`,或设 `E2E_BROWSER_CHANNEL=msedge` 复用系统浏览器) |
| `npm run build:web` && `npm run start:web` | 生产构建与启动 |

所有验证脚本使用临时数据库(`NOVEL_DATA_DIR`),不触碰 `data/novel.db`;E2E 使用独立目录 `e2e/.tmpdata`(每次运行重置,`E2E_KEEP_DATA=1` 可复用)。截至 V10.7,`test:*` 共 44 套覆盖全部子系统。

### 管理后台首次使用

1. 启动 Web 后访问 `http://localhost:33000/admin/login`;
2. 初始账号 **`admin` / `Admin@123456`**(数据库初始化时自动创建);
3. 首次登录**强制修改为复杂密码**,改密前无法访问任何后台业务功能;
4. 之后可随时通过顶栏 🔑 图标再次改密(会吊销该账号其他会话)。

---

## 部署

### 方式一:Docker Compose(推荐)

```bash
docker compose up -d          # 启动 web(:33000) + scheduler 两个服务
./rebuild.sh                  # 一键重建镜像并重启(默认已启用本地 Kokoro TTS 并自动下载模型,见 README-部署.md Q3.3)
```

- `web`:Next.js 生产包,暴露 `33000`,挂载 `./data`(SQLite)、封面目录、`novels/` 与 `./models/kokoro`(本地听书模型卷);容器内存调优(V8 堆限 768MB + `mem_limit: 1500m`);
- `scheduler`:不暴露端口,与 web 共享同一份 SQLite,负责定时发布、AI 连载、短篇定时/批量排期、产线触发与 AI 任务消化(`mem_limit: 256m`);
- Dockerfile 默认走国内镜像源(npmmirror + better-sqlite3 预编译),海外环境用 build-arg 切回官方源;`ENABLE_LOCAL_TTS=1` 构建参数决定镜像是否内置 kokoro-js-zh 本地语音(裸 `docker compose build` 默认 `0`)。

### 方式二:裸机运行

```bash
npm run build:web
NOVEL_DATA_DIR=/var/lib/novel PORT=33000 npm run start:web &
PUBLISH_TICK_SECONDS=60 NOVEL_DATA_DIR=/var/lib/novel npm run scheduler &
```

### 环境变量

| 变量 | 说明 | 默认值 |
|------|------|--------|
| `NOVEL_DATA_DIR` | SQLite 数据目录 | `../data`(仓库内) |
| `PORT` | Web 监听端口 | `3000`(compose 内为 33000) |
| `NOVEL_SITE_URL` | RSS/Sitemap 站点地址 | `http://localhost:33000` |
| `PUBLISH_TICK_SECONDS` | 调度器扫描间隔(≥5) | `60` |
| `AI_FETCH_TIMEOUT_MS` | LLM 上游单次请求超时 | `300000`(5 分钟) |
| `AI_BASE_URL` / `AI_API_KEY` / `AI_MODEL` | LLM 配置回退(后台「系统设置」逐字段优先) | 后台设置 |
| `ADMIN_TOKEN` | 可选机器令牌(Bearer/x-admin-token),供脚本集成;账号会话不受影响 | 未配置 |
| `NOVEL_SCHEDULER_LOCK` | 设为 `0` 跳过调度器单实例文件锁(自行保证单实例时) | 启用锁 |
| `AI_TASK_STALE_GRACE_MS` | 僵尸 RUNNING 任务恢复阈值(毫秒,≥60000) | `600000`(10 分钟) |
| `ENABLE_LOCAL_TTS` | Docker 构建参数:镜像是否内置 kokoro-js-zh 本地语音(`rebuild.sh` 默认 `1`) | `0`(裸 compose build) |
| `KOKORO_MODEL_DIR` | 本地语音模型目录(compose 内 `/app/models/kokoro`;存在 `onnx/model_quantized.onnx` 才启用) | `/app/models/kokoro` |
| `EDGE_TTS_PROXY` | Edge 在线合成出口代理(服务器无法直连 bing 时填 `http://user:pass@host:port`) | 空 |

> 每日连载/自动发布的「时刻」均按**北京时间**(UTC+8)解释,与宿主机时区无关;compose 已为容器设置 `TZ=Asia/Shanghai`。

### V9.5+ 评审行为、调度器与听书

- **调度器单实例锁**:启动时在数据目录创建 `scheduler.lock`(记录 pid,存活检测,崩溃残留自动接管)。同一数据目录下第二个调度器会拒绝启动并打印持有者诊断;确认无实例后删除该文件或停掉旧进程即可。跨主机共享网络盘的部署此锁不适用。
- **章节自动评审**:书籍默认 `chapter_review_enabled=1`,章节发布后自动入队一次 AI 评审(由调度器消化);不想要的书在管理后台关闭。
- **章节自动改写**:评审不合格且 `chapter_review_max_rounds > 0`(默认 1)时,**每章最多自动消耗 N 次 LLM 改写并重评**,直到达标或轮数耗尽;只评分不改稿的书请把轮数设为 `0`。
- **弧级半自动评审**:`arc_review_every_n`(默认 5,0=关),每发布 N 章在评审中心提示触发一次区间评审。
- **僵尸任务自动恢复**(V10.6):容器重建/崩溃导致执行进程消失时,被认领为 `RUNNING` 的 AI 任务超过 `AI_TASK_STALE_GRACE_MS`(默认 10 分钟)自动重置回 `PENDING` 重跑,创作中心不再永久卡死。
- **短篇定时与批量排期**(V9.6–V9.8):单篇定时、批量定时(含每天重复)均由调度器到点触发并入队创作流水线;到点执行仅为本地 DB 操作,瞬时完成。
- **听书引擎选择**(V10.7):本地 Kokoro 可用(镜像内置 + 模型已挂载)且用户从未手动选过引擎时默认本地合成(不走外网,规避移动端中间层对长时在线合成的 502 拦截),失效自动回退 Edge;模型未挂载或镜像未内置时仅 Edge / 系统语音。

### 上线核对清单

- [ ] `NOVEL_SITE_URL` 改为实际域名(RSS/Sitemap 用)
- [ ] 首次登录 `/admin` 并完成强制改密
- [ ] 系统设置里配置 LLM(AI 创作功能依赖)
- [ ] 如需听书「本地语音」:确认 `./models/kokoro` 已挂载模型且镜像以 `ENABLE_LOCAL_TTS=1` 构建(裸 `docker compose build` 默认不内置)
- [ ] `docker compose logs -f scheduler` 确认调度心跳正常

---

## 协议(MIT)

本项目采用 **[MIT License](LICENSE)** 开源协议:

- ✅ 商用、修改、分发、私用均自由;
- ℹ️ 唯一条件:保留版权与许可声明;
- ⚠️ 软件按"现状"提供,作者不承担担保与责任。

```
MIT License © 2026 menghun3-cn
```
