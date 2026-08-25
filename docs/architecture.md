# 架构（Architecture）

AI 原创小说内容平台的系统架构参考。本文回答"系统由哪些部分组成、如何协作、关键设计为什么这样定"；开发上手与部署操作见 [README.md](../README.md)，旧 EPUB/BookOrbit 构建线见 [README-部署.md](../README-部署.md)，产品路线与版本规划见 [AI原创内容创作平台.md](AI原创内容创作平台.md)。

---

## 1. 总体形态

三个 npm workspaces（`core` / `importer` / `web`）+ 一份 SQLite，外加一个常驻调度器进程：

```text
 novels/（MD/TXT 小说源，导入期事实来源）
        │
        ▼
┌───────────────────┐   幂等导入   ┌────────────────────────────────────┐
│    Importer CLI   │ ──────────▶ │       Content Core（core/）         │
│ book.yaml + 章节MD │             │  领域模型 · 状态机 · 业务服务         │
└───────────────────┘             │  SQLite WAL（data/novel.db，单库共享）│
                                  └──────────────┬─────────────────────┘
                                                 │ 直接函数调用（同进程）
                     ┌───────────────────────────┴──────────────────────┐
                     ▼                                                  ▼
        ┌──────────────────────────┐                    ┌─────────────────────────────┐
        │   Web Publisher（web/）   │                    │   Scheduler（常驻调度器）      │
        │   Next.js 15 App Router  │                    │  · 到期定时章节发布            │
        │  ├─ 读者站 /(site)        │                    │  · 每书每日自动发布            │
        │  ├─ 管理后台 /admin       │                    │  · AI 自动连载(生成→质检→发布) │
        │  └─ API Routes /api/**   │                    └─────────────────────────────┘
        └──────────────────────────┘
```

支撑整个架构的四条核心决策：

1. **单一 SQLite 库是运行期唯一事实来源。** 所有子系统读写同一份 `data/novel.db`（WAL 模式）；`novels/` 目录只是导入期的输入事实来源。
2. **无内部 RPC。** web、scheduler、importer 都是 `@novel/core` 的同进程调用方，跨进程协作只通过数据库发生——调度器扫表发布，web 轮询任务表取 AI 生成结果。
3. **Core 是零框架服务层。** 只依赖 `better-sqlite3` 与 node 标准库，导出纯函数；HTTP 语义（状态码、鉴权、校验）全部留在 web 的 API 层。
4. **队列即数据库表。** AI 生成任务（`generation_jobs`）、待审章节（`status='pending_review'`）、到期定时章节（`status='scheduled'`）都是可扫描的持久化状态，任何进程崩溃重启后不丢工作。

---

## 2. 运行单元

| 进程 | 入口 | 职责 | 生命周期 |
|---|---|---|---|
| Web | `next start`（`web/`，端口由 `PORT` 控制，镜像内默认 33000） | 读者站 SSR 页面、管理后台、全部 API Routes | 常驻 |
| Scheduler | `scripts/publish-scheduler.ts` | 每 tick 执行发布周期 + AI 连载周期 | 常驻 |
| Importer CLI | `importer/src/index.ts` | `novels/<书名>/` → Content Core 幂等导入 | 一次性 |

- 调度器 tick 间隔由 `PUBLISH_TICK_SECONDS` 控制（默认 60s，下限 5s），单次周期失败只记日志不终止循环。
- Docker Compose 以同一镜像启动 `web` 与 `scheduler` 两容器，共享挂载的 `./data` 卷；裸机部署与环境变量见 README「部署」。

---

## 3. Content Core（`core/src/`）

领域模型、SQLite 访问与业务规则的唯一归属地，经 `core/src/index.ts` 统一出口供三个调用方复用。

### 3.1 模块地图

| 模块 | 职责 |
|---|---|
| `domain.ts` | 全部类型与常量：五对象模型、章节状态机、Story Core 实体、任务状态、`CoreError` 错误码 |
| `db.ts` | 连接管理（单例）、幂等 DDL、按 `PRAGMA table_info` 检查后的轻量列迁移、数据目录解析 |
| `service.ts` | 书籍 / 章节 / 作者 / 分类 / 标签 CRUD 与查询；发布状态机与审核流；autopilot 自动发布周期 |
| `story.ts` / `story-context.ts` | Story Core 六类实体的维护与只读上下文组装（见 §5） |
| `ai-writer.ts` | LLM Provider 抽象、OpenAI 兼容适配器、整章生成、规则质检与可选 LLM 复核 |
| `ai-serial.ts` | 每书连载配置、生成任务队列、每日流水线执行器 |
| `reader.ts` | 读者注册登录（scrypt）、30 天会话、书架 / 收藏 / 订阅 / 阅读进度 |
| `admin-auth.ts` | 管理员账号：默认账号播种、登录、强制改密、24h 会话 |
| `discovery.ts` | 热度信号记录（PV / 完读）与发现位推荐打分 |
| `analytics.ts` | 阅读会话聚合、平台总览指标、单章指标与留存漏斗 |
| `settings.ts` | 运行时配置（`app_settings` 键值表）：后台 LLM 配置读写与密钥掩码 |

### 3.2 错误模型

服务层只抛 `CoreError(code)`，错误码枚举在 `domain.ts`；HTTP 语义由 web 层的映射表（`web/lib/admin-api.ts` 的 `STATUS_BY_CODE`）统一翻译，例如 `SLUG_TAKEN → 409`、`AI_NOT_CONFIGURED → 503`。Core 自身不知道 HTTP 的存在。

### 3.3 数据模型

SQLite 表按子系统分组：

| 分组 | 表 |
|---|---|
| 内容五对象 | `authors` `categories` `tags` `books` `book_tags` `chapters` |
| Story Core | `story_worlds` `story_characters` `story_relationships` `story_arcs` `story_outlines` `story_foreshadowing` |
| 运行配置 | `app_settings`（键值） |
| AI 连载 | `ai_serialization`（每书配置）`generation_jobs`（任务历史） |
| 读者 | `users` `sessions` `favorites` `subscriptions` `reading_progress` |
| 分析 | `reading_sessions` |
| 管理账号 | `admin_users` `admin_sessions` |

约定：

- **确定性主键**：书 id = `book_<去掉连字符的 slug>`，章节 id = `<bookId>_ch<number>`。这是导入幂等的基础——重跑导入命中同一行变成 UPDATE。
- **连接初始化**：`journal_mode = WAL` + `foreign_keys = ON`；建库即执行全量幂等 DDL，再对老库做列级迁移（`ALTER TABLE ... ADD COLUMN`，先查 `PRAGMA` 保证幂等）。没有独立迁移脚本体系。
- **数据目录解析**：`NOVEL_DATA_DIR` 环境变量优先；否则从 `process.cwd()` 向上最多 5 层查找含 `data/` 的仓库根；兜底 `cwd/data`。生产构建中 `import.meta.url` 会被打包改写，因此一律以 cwd 为锚点。

---

## 4. 发布流水线

章节状态机（定义于 `domain.ts`，转换逻辑在 `service.ts`）：

```text
draft ──送审──▶ pending_review ──批准(now)──▶ published
  ▲                  │
  │                  └──批准(scheduled + scheduledAt)──▶ scheduled ──到期──▶ published
  └──────── 驳回(带 review_note，送审/批准时清空) ◀──────────────────────────┘
```

此外，任意状态都可经章节编辑置为 `hidden`（下线，`publishedAt` 保留）；恢复即改回目标状态。

两个自动入口都收敛到 `runPublishCycle()`，由调度器每 tick 调用：

1. **到期定时发布**（`publishDueChapters`）：把 `scheduled_at <= now` 的 scheduled 章节转 published。
2. **Autopilot 每日自动发布**（`runAutopilot`）：每书配置 `{ enabled, hour, count }`；本地时刻到达 hour 后的首次扫描中，从最旧的 draft 章节起在事务内直接发布 count 章（清 `review_note`）。`last_run_date` 记录本地 `YYYY-MM-DD` 作为日守卫，保证每天至多触发一次。

---

## 5. AI 创作子系统

```text
 Story Core 六类实体            Content Core 近况
 (世界观/人物/关系/故事线/        (最近章节摘录/下一章大纲)
  章节大纲/伏笔)                      │
      │                              │
      └──────────┬───────────────────┘
                 ▼ 只读组装，不写表
        story-context.getGenerationContext()
                 │ renderGenerationPrompt()
                 ▼
            ai-writer（LLM）
     生成草稿 → 规则质检 → 可选 LLM Review
                 │ 复用既有状态机落稿
                 ▼
   createChapter(draft) → submitChapterForReview()
                 │
        autoPublish=false：停在 pending_review 等人工
        autoPublish=true ：approveChapter 直接发布
```

分层职责：

- **Provider 抽象**（`ai-writer.ts`）：`LlmProvider.complete(req)` 接口 + OpenAI 兼容 chat completions 适配器，DeepSeek / OpenAI / 本地网关均可接入；网络与服务端错误统一抛 `AI_PROVIDER_FAILED`。
- **LLM 配置取源**（`settings.ts`）：后台配置（`app_settings`）逐字段优先，环境变量 `AI_BASE_URL` / `AI_API_KEY` / `AI_MODEL` 回退；API Key 只以掩码形式出服务层，明文仅在服务端合并 Provider 时使用。
- **自动连载流水线**（`ai-serial.ts`）：每书配置 `{ enabled, hour, count, autoPublish, minChars }` + 同样的本地日期守卫；到点按 count 入队 `generation_jobs`，随后逐任务执行"生成 → 质检 → 送审或直接批准"。任务状态：`pending → running → published | submitted | draft | rejected | held | failed`，带 attempt 重试计数与错误记录。
- **执行位置**：两条路径触发同一套队列处理——调度器 tick 内直接处理；或 web 进程内 `kickProcessing()`（`web/lib/serial-worker.ts`）。后者立即返回、在进程内继续跑完（挂在 `globalThis` 上保证 HMR 多实例下也只有一个 worker），前端轮询任务列表取结果——这是为了不在反代默认 60s 超时内同步等待长 LLM 调用。

---

## 6. Web Publisher（`web/`）

Next.js 15 App Router 单应用，三块结构：

| 区块 | 路径 | 内容 |
|---|---|---|
| 读者站 | `(site)/` | 首页发现位 / 书库 / 详情 / 章节阅读（字号、深色模式、进度条、滑动翻页）/ 分类 / 搜索 / 登录注册 / 书架 / 阅读历史；RSS · Sitemap · Robots |
| 管理后台 | `admin/(dash)/` | 概览、小说管理、审核队列、AI 创作中心（Story Core + 生成任务）、数据分析、作者 / 分类 / 标签、媒体库、LLM 设置；`admin/login` 与 `admin/change-password` 独立于仪表盘布局 |
| API | `api/` | 见下 |

### 6.1 API 分区

| 前缀 | 鉴权 | 用途 |
|---|---|---|
| `/api/auth/*` | 读者 Cookie 会话 | 注册 / 登录 / 登出 / 当前用户 |
| `/api/admin/*` | 双轨管理鉴权 | 内容管理、审核、AI 生成与任务、分析、设置、媒体上传 |
| `/api/books/*` | 公开（匿名可报） | PV / 完读信号上报、阅读进度（登录态）、收藏 / 订阅 |
| `/api/discovery` | 公开 | 发现位推荐数据 |
| `/api/me/*` | 读者 Cookie 会话 | 书架、阅读历史 |
| `/media/**` | 无（CSP 沙箱化对外服务） | 媒体文件读取 |

### 6.2 鉴权模型

**管理侧双轨**（实现集中在 `web/lib/admin-api.ts` 的 `requireAdmin`）：

1. **机器令牌**：环境变量 `ADMIN_TOKEN`，经 `authorization: Bearer` 或 `x-admin-token` 头传入；比较前做定长 SHA-256 摘要后 `timingSafeEqual`，防时序与长度泄露。供调度器和集成脚本使用。
2. **管理员账号会话**：`admin_users` 表 + scrypt 口令哈希 + 24h SQLite 会话令牌。库初始化即播种默认账号 `admin / Admin@123456`（`must_change_password=1`），首登未改密时除 `/api/admin/auth/*` 外的业务 API 一律 `403 PASSWORD_CHANGE_REQUIRED`。

**读者侧**：`users` + scrypt 哈希 + httpOnly Cookie 会话，TTL 30 天；过期会话读取时顺带清理。

### 6.3 lib 支撑层

- `admin-api.ts`：鉴权、JSON 响应、`CoreError`→HTTP 映射、`withAdmin` 路由包装（鉴权 → 业务 → 错误翻译）、`readJson` zod 请求体解析。
- `reader-handlers.ts` / `discovery-handlers.ts` / `analytics-handlers.ts`：对应 API 族的处理函数复用层。
- `admin-media.ts`：媒体白名单扩展名（png/jpg/jpeg/webp/gif/svg）、路径穿越防护；对外经 `/media/**` 路由以 CSP 沙箱响应头提供服务。
- `serial-worker.ts`：见 §5 执行位置。
- Markdown 渲染走 `unified` + `remark-gfm` + `rehype-stringify`。

### 6.4 Next.js 集成要点（`next.config.ts`）

- `transpilePackages: ['@novel/core']`：core 以 TS 源码形式被编译进 web 包。
- `serverExternalPackages: ['better-sqlite3']`：原生模块不参与打包。
- HTML 页面统一覆盖为 `no-cache, no-store, must-revalidate`：防止反向代理缓存 Next 对静态预渲染页面默认设置的 `s-maxage=31536000`，避免部署后出现旧页面或 Stale 404；`_next/static`、`api`、`media` 不受影响。

---

## 7. 数据闭环

V7 Discovery 与 V8 Analytics 把阅读行为接回创作：

```text
 阅读(PV/滚动完读/时长会话) ─▶ discovery/analytics 信号表
        │                            │
        │                   Discovery 发现位推荐（读时规则打分）
        │                   Analytics 总览/单章指标/留存漏斗
        ▼                            │
   书架/订阅/进度 ◀──────────────────┘ 反哺选题与章节优化
                                     │
                        AI 创作中心 → 审核 → 发布 → 阅读
```

信号采集的设计取向：匿名可报、写路径极轻（PV/完读各一条 `UPDATE` 计数列）、重复上报由客户端节流保证、推荐评分在读路径完成而不落物化表。

---

## 8. 导入线（`importer/`）

`npm run import:novel -- <novels/小说目录>`：

1. `book.yaml` 经 zod schema 校验（title/slug/author/category 必填，slug 限字母数字连字符）。
2. 封面按 `cover` 字段复制到 `web/public/covers/<slug><ext>`。
3. `chapters/*.md|txt` 按文件名前缀数字排序定章号（无前缀则按序号补位）；首个 H1 作标题并从正文剥离，否则标题为「第 N 章」。
4. 经 `upsertBook` + `importChapter` 写入，章节默认按 `chapterStatus`（默认 published）入状态机；输出新增/更新/总数报告。

重复导入因确定性主键而幂等：同章号已存在时整章覆盖更新（保留原 `published_at`），不产生重复行。

---

## 9. 旧构建线（`src/`，保留）

独立的 EPUB / BookOrbit 构建线，早于本平台、与主平台并行保留：

- 入口 `src/index.ts`（bin: `novel-builder`），配置来自 `config/config.yaml`；
- 流向：`novels/` → md/txt 解析（`src/parsers/`）→ EPUB 生成（`src/epub/`）→ `output/`，并可投递 Book Dock（`bookdock/`）；支持文件监听增量构建与本地 HTTP 服务（默认 `127.0.0.1:8320`）。

它与主平台仅共享 `novels/` 目录，不接触 `data/novel.db`；细节见 [README-部署.md](../README-部署.md)。深度集成进主流程仍在规划中（见产品文档）。

---

## 10. 测试与质量门

- `scripts/verify-*.ts` 是断言式回归套件（无测试框架依赖），按子系统划分：core、admin API/auth/media/settings、publish 工作流/API、AI writer/serial 及其 API、reader、discovery、analytics 等。全部使用 `NOVEL_DATA_DIR` 指向的临时库，不触碰 `data/novel.db`。
- `npm run typecheck`：根（EPUB 线）+ core + web 三层 TS 检查。
- `npm run doc-sync`：Agent Notes 分类 / 格式 / 归档三重校验（`.agents/notes/` 治理，与本架构文档无耦合）。
