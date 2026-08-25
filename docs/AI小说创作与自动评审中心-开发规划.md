# AI小说创作与自动评审中心 · 开发规划

> 依据：[AI小说创作与自动评审中心-产品技术规格书.md](AI小说创作与自动评审中心-产品技术规格书.md) v1.0.0  
> 范围：第一阶段（规格书 §44）完整落地；第二/三阶段仅预留接口，不在本期实现  
> 状态：已确认开工（§10 决策点 1–4 均采纳推荐方案）

---

## 1. 现状盘点（先检查现有项目 · 规格书 §48.1）

平台当前为 v8.x：三个 npm workspaces（`core` / `importer` / `web`）+ 单一 SQLite（WAL，`data/novel.db`），无内部 RPC，队列即数据库表。

### 1.1 可直接复用的能力

| 规格书要求 | 现有实现 | 复用方式 |
|---|---|---|
| §36 统一模型服务层 | `core/src/ai-writer.ts` 的 `LlmProvider` 抽象 + OpenAI 兼容适配器 + 模型自动发现 | 直接复用；业务代码只面向 `LlmProvider.complete()` |
| LLM 配置管理 | `core/src/settings.ts`：后台配置优先、环境变量回退、密钥掩码 | 直接复用 `resolveProviderFromStore()` |
| AI 任务队列范式 | `generation_jobs` 表 + 进程内 worker（`web/lib/serial-worker.ts` 的 `kickProcessing()`，挂 globalThis 单飞防 HMR 多实例）+ 前端每 3s 轮询至终态（客户端 10 分钟截止） | 照此范式新建短篇任务系统；已知局限（串行、failed 即终态、单任务类型）正是新建 `ai_tasks` 的原因 |
| 错误模型 | `CoreError(code)` + web 层 `STATUS_BY_CODE` 映射（`web/lib/admin-api.ts`） | 新增错误码沿用同一机制 |
| 后台鉴权 | 双轨：账号会话 + `ADMIN_TOKEN` 机器令牌（`withAdmin` 包装器） | 全部新 API 走 `withAdmin` |
| 前端组件 | `web/components/admin/ui.tsx`（Button/Modal/Field/Badge/ConfirmDialog 等）+ `web/lib/admin-client.ts` 的 `api()` | 新页面直接用现有原语与请求封装；⚠️ 套件中**没有 Tab 与分页组件**，需新增轻量 Tabs，列表沿用"全量拉取 + 客户端过滤"惯例 |
| 页面壳层与导航 | `web/components/admin/AdminShell.tsx` 的 `NAV` 数组 + `PAGE_TITLE` 映射 | 新页面在这两处注册即得侧栏入口与面包屑 |
| 测试体系 | `scripts/verify-*.ts` 断言式回归（临时库 `NOVEL_DATA_DIR`） | 新功能照此新增验证脚本 |
| 长篇创作 | `admin/story` 页（Story Core 六类实体 + AI 章节生成工作台）、`story-context.ts` | 长篇 Tab 直接链接/嵌入既有能力 |

### 1.2 主要缺口（本期需新建）

1. **短篇小说实体与版本化**——现有 `books`/`chapters` 是长篇连载模型（章号 + 发布状态机），与短篇"单文档多版本"模型不匹配。
2. **评审规则版本 / Prompt 版本 / 评审记录**——无任何表与服务。
3. **结构化 JSON 输出**——现有 `llmReviewChapter` 是 PASS/FAIL 文本协议，不满足 §37 结构化输出要求。
4. **自动评审 → 自动优化 → 再评审流水线**——不存在。
5. **字段级 AI 建议/生成/优化**——现有 AI 能力只有整章生成。
6. **统一 AI 任务记录**——`generation_jobs` 与 book 强绑定且语义是章节生成，需要独立的通用任务表。

### 1.3 明确不做（防破坏既有功能 · §48.2）

不改动 `books/chapters` 状态机、发布审核流、读者站、RSS/SEO、媒体库、调度器既有周期。短篇子系统全部为新增表、新增模块、新增路由。

---

## 2. 关键设计决策

| # | 决策 | 理由 |
|---|---|---|
| D1 | 短篇小说独立建模（`short_stories` + `short_story_versions`），不复用 books/chapters | 版本语义不同；避免污染长篇状态机；符合 §34 数据模型 |
| D2 | 长篇 Tab 第一阶段做占位页：说明 + 跳转既有 Story Core 工作台 | 规格书 §10 允许"先完成页面和数据结构" |
| D3 | 通用任务表 `ai_tasks` 承接全部新 AI 操作（§35 的九种类型中本期实现前六种） | 字段辅助、生成、评审、优化统一可观测、可重试、可追溯 |
| D4 | 结构化输出 = 提示词内嵌 JSON Schema + 容错提取 + zod 校验 + 失败带错误反馈重试 ≤2 次 | OpenAI 兼容上游不一定支持 `response_format.json_schema`，提示词约束是稳妥路径；重试语义满足 §37 |
| D5 | 流水线在 core 实现（`short-story-pipeline.ts`），由 web 进程内 worker 执行 + 前端轮询进度；调度器不参与 | 用户触发的交互式流程无需定时扫描；完全复刻 ai-serial 已验证的执行范式 |
| D6 | 权重/阈值/最大优化轮数全部存于规则版本行，代码零硬编码 | §13/§15/§22 强制要求 |
| D7 | 一切 AI 写入皆建新版本；规则/Prompt 修改即新版本；历史行永不 UPDATE 内容字段 | §43 安全要求 |
| D8 | 低质量内容池 = `short_stories.status='pool'` 标记 + 列表筛选，不建独立表 | 池本质是状态，不是新实体 |
| D9 | 字段级 AI 辅助也走异步任务 + 轮询 | 与整篇生成统一体验，规避反代 60s 超时边界（架构文档 §5 同款考量）；天然满足"生成中…禁止重复提交" |
| D10 | 新建 `web/lib/story-worker.ts` 镜像 `serial-worker.ts` 的 globalThis 单飞 kick 模式驱动短篇流水线 | 已验证的长任务执行方式；不碰调度器 |
| D11 | 在 `ui.tsx` 新增轻量 `Tabs` 分段控件（受控组件，按钮组样式）；列表沿用现有「全量拉取 + 客户端过滤」惯例，暂不做分页组件 | 规格书要求一级/二级 Tab 而套件缺失该原语；分页是二期优化 |

---

## 3. 数据模型（新增表）

```sql
-- 短篇小说主档;brief_json 存最新一次创作输入(基础信息/故事结构/创作参数约18字段)
CREATE TABLE IF NOT EXISTS short_stories (
  id TEXT PRIMARY KEY,                -- ss_<随机>
  title TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'draft',
    -- draft | generating | reviewing | optimizing | passed | pool | failed
  brief_json TEXT NOT NULL DEFAULT '{}',
  current_version_id TEXT,
  source_url TEXT,
  review_round INTEGER NOT NULL DEFAULT 0,      -- 已执行评审次数
  optimize_round INTEGER NOT NULL DEFAULT 0,    -- 已执行自动优化次数
  last_score INTEGER,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

-- 短篇小说版本:只增不改
CREATE TABLE IF NOT EXISTS short_story_versions (
  id TEXT PRIMARY KEY,
  story_id TEXT NOT NULL REFERENCES short_stories(id),
  version INTEGER NOT NULL,            -- V1..Vn
  content TEXT NOT NULL,
  char_count INTEGER NOT NULL,
  creation_reason TEXT NOT NULL,       -- generated | ai_optimized | user_edited
  generation_prompt TEXT,
  model_name TEXT,
  is_final INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  UNIQUE(story_id, version)
);

-- 评审规则主档
CREATE TABLE IF NOT EXISTS review_rules (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  description TEXT,
  current_version_id TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

-- 评审规则版本;dimensions_json 含每维度的定义/权重/评分标准(分档)/加分/扣分/说明
CREATE TABLE IF NOT EXISTS review_rule_versions (
  id TEXT PRIMARY KEY,
  rule_id TEXT NOT NULL REFERENCES review_rules(id),
  version TEXT NOT NULL,               -- v1.0 / v1.1 / v2.0
  dimensions_json TEXT NOT NULL,       -- [{name,weight,definition,standards,bonus,penalty,notes}]
  quality_threshold INTEGER NOT NULL DEFAULT 80,
  max_auto_optimize_rounds INTEGER NOT NULL DEFAULT 3,
  prompt_id TEXT,
  status TEXT NOT NULL DEFAULT 'draft', -- draft | testing | published | disabled
  created_at TEXT NOT NULL,
  published_at TEXT,
  UNIQUE(rule_id, version)
);

-- 评审 Prompt 版本:不可覆盖,改即新版本
CREATE TABLE IF NOT EXISTS review_prompts (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  version TEXT NOT NULL,
  content TEXT NOT NULL,
  rule_version_id TEXT,
  model_hint TEXT,
  change_note TEXT,
  created_at TEXT NOT NULL
);

-- 评审记录:全链路快照,只增不改(规格书 §34.6)
CREATE TABLE IF NOT EXISTS review_records (
  id TEXT PRIMARY KEY,
  story_id TEXT NOT NULL,
  story_version_id TEXT NOT NULL,
  source_url TEXT,

  rule_id TEXT NOT NULL,
  rule_version TEXT NOT NULL,

  prompt_id TEXT,
  prompt_version TEXT,

  model_id TEXT,
  model_name TEXT,
  model_version TEXT,

  score INTEGER NOT NULL,
  level TEXT NOT NULL,                 -- S/A/B/C/D
  qualified INTEGER NOT NULL,

  dimension_scores_json TEXT NOT NULL, -- [{name,score,maxScore,reason}]
  strengths_json TEXT,
  weaknesses_json TEXT,
  suggestions_json TEXT,
  summary TEXT,

  review_round INTEGER NOT NULL,
  optimization_round INTEGER NOT NULL,

  duration_ms INTEGER,
  raw_response TEXT,
  structured_result_json TEXT NOT NULL,
  created_at TEXT NOT NULL
);

-- 统一 AI 任务(规格书 §35)
CREATE TABLE IF NOT EXISTS ai_tasks (
  id TEXT PRIMARY KEY,
  type TEXT NOT NULL,        -- CREATE_NOVEL | AI_SUGGEST | AI_GENERATE | AI_OPTIMIZE | AI_REVIEW | AI_REVIEW_RETRY
  status TEXT NOT NULL DEFAULT 'PENDING',  -- PENDING | RUNNING | SUCCESS | FAILED | CANCELLED
  ref_type TEXT,             -- short_story | short_story_version | field_assist ...
  ref_id TEXT,
  input_json TEXT,
  prompt TEXT,
  provider_name TEXT,
  model_name TEXT,
  output_json TEXT,
  error TEXT,
  attempt INTEGER NOT NULL DEFAULT 0,
  started_at TEXT,
  finished_at TEXT,
  duration_ms INTEGER,
  tokens_prompt INTEGER,
  tokens_completion INTEGER,
  created_at TEXT NOT NULL
);
```

配套索引：`short_stories(status)`、`short_story_versions(story_id, version)`、`review_rule_versions(rule_id, status)`、`review_records(story_id, created_at)`、`ai_tasks(type, status, created_at)`。

**幂等种子播种**（db 初始化时）：库中无任何 `review_rules` 时插入默认规则「短篇小说评审 v1.0」并直接置 `published`：

- 七维度默认权重（20/20/15/15/10/10/10）+ 各维度定义与四档评分标准文案（取自规格书 §13/§14）
- `quality_threshold = 80`、`max_auto_optimize_rounds = 3`
- 默认 Prompt「短篇评审 v1.0」（结构化 JSON 输出指令模板），关联该规则版本

---

## 4. Core 服务层（`core/src/` 新增模块）

| 模块 | 职责 |
|---|---|
| `domain.ts`（增补） | 短篇/规则/Prompt/任务类型与常量、状态守卫函数、新错误码：`SHORT_STORY_NOT_FOUND`、`REVIEW_RULE_NOT_FOUND`、`RULE_VERSION_CONFLICT`、`REVIEW_PROMPT_NOT_FOUND`、`REVIEW_RECORD_NOT_FOUND`、`AI_TASK_NOT_FOUND`、`INVALID_INPUT`（复用）、`STRUCTURED_OUTPUT_FAILED` |
| `structured-output.ts`（新） | `completeStructured<T>(provider, req, schema)`：提示词注入 JSON Schema → 容错提取 JSON（剥 ``` 围栏）→ zod 校验 → 失败把解析错误反馈给模型重试，最多 2 次；仍失败抛 `STRUCTURED_OUTPUT_FAILED` 并保留原始响应 |
| `short-story.ts`（新） | 短篇 CRUD、brief 校验（zod：三组共约 18 字段可选填）、版本追加（事务内递增 version 号，禁止 UPDATE content）、设最终版、状态流转守卫 |
| `review-rule.ts`（新） | 规则/版本 CRUD；发布 = 事务内将旧 published 置 disabled + 新版本置 published（保证全局单一生效版本）；停用；读取生效版本 |
| `review-prompt.ts`（新） | Prompt 版本列表/新建（新版本指向同 name）/读取；不可修改已有版本内容 |
| `review-engine.ts`（新） | `runAutoReview(storyVersionId)`：读生效规则版本 + 关联 Prompt → 组装评审 Prompt（含各维度评分标准）→ `completeStructured` → 计算加权总分（维度按 maxScore=weight×100 折算或直接百分制加权，取后者）→ 定级（S/A/B/C/D 分档可由规则版本配置，默认 §15）→ 写 `review_records` → 返回结果 |
| `optimize-engine.ts`（新） | `runOptimization(storyVersionId, record)`：读原版本 + 评审问题/建议 → 按 §20 约束生成修订稿（Prompt 中显式声明"保留主题/人物/核心剧情，仅针对评审问题修改"）→ 新建版本 → 返回 |
| `short-story-pipeline.ts`（新） | 编排器：`startCreationPipeline(storyId)` → 整篇生成(V1) → 自动评审 → `score < threshold` 则循环【优化→新版本→再评审】至通过或达 `max_auto_optimize_rounds` → 通过置 `passed` + 最终版标记；未达标置 `pool`；每步写 `ai_tasks` 并回写 `short_stories.status/review_round/optimize_round/last_score`；单步失败置 `failed` 且错误可见（不静默）。提供 `getPipelineState(storyId)` 供前端轮询 |
| `ai-task.ts`（新） | 任务创建/领取（PENDING→RUNNING）/完成/失败/重试/查询；供 pipeline 与 assist 端点共用 |
| `index.ts`（增补） | 导出以上全部公共函数 |

**评分折算**：AI 对每个维度按 0-100 打分，总分 = Σ(维度分 × weight)，四舍五入为整数；维度展示分 = 维度分 × weight（如故事完整性 90 × 20% = 18/20），与规格书 §17 示例一致。

---

## 5. API 设计（全部挂在 `/api/admin/*`，走 `withAdmin`）

```
POST   /api/admin/short-stories                 创建草稿(brief 可空)
GET    /api/admin/short-stories                 列表(?status=&q=&page=)
GET    /api/admin/short-stories/:id             详情(含 brief、版本列表、各版最新评审摘要、pipeline 状态)
PATCH  /api/admin/short-stories/:id             改标题/brief/source_url(不动版本)
DELETE /api/admin/short-stories/:id             仅 draft/pool/failed 可删

POST   /api/admin/short-stories/:id/create      启动创作流水线(异步,返回 taskId)
POST   /api/admin/short-stories/:id/review      手动重新评审当前最终版
POST   /api/admin/short-stories/:id/optimize    手动触发一次优化(受 max 轮数约束之外,独立计数)

POST   /api/admin/ai/assist                     字段辅助 {action: suggest|generate|optimize,
                                                field, context} → 异步任务,返回 taskId
GET    /api/admin/ai/tasks?type=&refId=&status= 任务列表
GET    /api/admin/ai/tasks/:id                  任务详情(含输出/错误/token)
POST   /api/admin/ai/tasks/:id/retry            重试 FAILED 任务

GET    /api/admin/review-rules                  规则列表(含各版本)
POST   /api/admin/review-rules                  新建规则(首个版本)
GET    /api/admin/review-rules/:id              规则详情
POST   /api/admin/review-rules/:id/versions     新建版本(基于某版本复制修改)
PUT    /api/admin/review-rule-versions/:vid     仅 draft 可改;published/disabled 拒绝
POST   /api/admin/review-rule-versions/:vid/publish   发布(唯一生效)
POST   /api/admin/review-rule-versions/:vid/disable   停用

GET    /api/admin/review-prompts                Prompt 版本列表(?name=)
POST   /api/admin/review-prompts                新版本(name 相同即迭代)
GET    /api/admin/review-prompts/:id

GET    /api/admin/review-records?storyId=&ruleVersion=&page=
GET    /api/admin/review-records/:id            含 raw_response
GET    /api/admin/review/stats                  基础统计(总数/通过率/平均分/平均优化次数)
```

错误码 → HTTP 映射在 `web/lib/admin-api.ts` 的 `STATUS_BY_CODE` 增补（如 `INVALID_INPUT→400`、`*_NOT_FOUND→404`、`AI_NOT_CONFIGURED→503`、`AI_PROVIDER_FAILED→502`、`STRUCTURED_OUTPUT_FAILED→502`）。注意该映射是穷举的 `Record<CoreErrorCode, number>`，新增错误码后 TS 会强制补齐条目。

路由文件统一惯例（与既有 admin 路由一致）：每个子路径一个 `route.ts`，`export const dynamic='force-dynamic'` + `export const GET/POST/... = withAdmin<Ctx>(...)`，请求体走 `readJson(req, zodSchema)`；浏览器侧只经 `api<T>()` 调用。

---

## 6. 前端页面（`web/app/admin/(dash)/`）

**导航与命名**：现有 `admin/story` 页已占用「AI 创作中心」名号（`AdminShell.tsx` 的 `NAV` + `PAGE_TITLE` 注册，导航第 4 项）。推荐方案：新增 `/admin/creation` 作为规格书定义的「AI 创作中心」入口（短篇默认 Tab），把现有 story 页的导航项更名为「长篇工作台」保留原路由；新增 `/admin/review-center` 为「AI 评审中心」。两处注册均在 `AdminShell.tsx` 的 `NAV` 数组与 `PAGE_TITLE` 映射完成。

**统一惯例**（照抄现有 admin 页面）：

- `'use client'` 顶部 + 文件头中文职责注释；状态四件套 loading/error/notice/data；每动作独立 busy 标志防重入
- 页面骨架顺序：`Notice(error) → Notice(success) → 页头卡(渐变图标 chip + h1 + 副题) → 内容卡`
- AI 相关页头图标 chip 用紫系渐变（`#8b5cf6→#6d28d9`）；卡片 = `rounded-xl bg-white p-5 shadow-sm mb-5`
- 状态徽章用 `Badge` tone 映射常量；时间显示一律 `formatChinaTime`；删除走 `ConfirmDialog`
- 长任务交互：入队即返回 taskId → 每 3s 轮询详情至终态（客户端 10 分钟截止兜底）→ 终态渲染 Notice
- 表格：白底圆角卡内 `<table>`，thead `bg-[#f8fafc]`，行 hover 上浮，操作按钮组 hover 渐显

### 6.1 `admin/creation/page.tsx` — AI 创作中心

- 顶部一级 Tab（新 `Tabs` 原语）：`[短篇小说] [长篇小说]`，默认短篇（§4.1）
- **短篇 Tab**
  - 左栏：作品列表（标题 + 状态徽章：评审中/优化中/已通过/未达标入池/失败 + 最近评分）
  - 右栏创作表单，三组分区（基础信息 / 故事结构 / 创作参数），约 18 个字段
  - **每个主要字段**右上角 `✨AI建议 ✨AI生成 ✨AI优化`：
    - AI建议 → 弹层列候选方案（使用 / 换一批 / 编辑）（§6.1）
    - AI生成 → 弹层展示生成结果（使用 / 编辑 / 重新生成）（§7）
    - AI优化 → 对比视图（原内容 vs 优化后，采用/放弃）（§8）
    - 请求期间按钮转 Spinner + 文案「生成中…」，禁重复提交（§39）
  - 底部 `[✨ AI 开始创作]` → 创建作品并启动流水线 → 切换到进度视图
  - **进度视图**（轮询 `GET /short-stories/:id`）：步骤条 `准备中→分析创作要求→生成中→AI质量检查→AI评审中→自动优化中→再次评审→已完成`（§40）+ 评审中面板显示七维度逐个「分析中→分数」（§41）
  - **结果页**：`86 / 100 · A级 · ✓ 达到高质量标准` + 七维度分数条 + 优点/问题/优化建议（§17/§18）+ 版本时间线（V1..Vn 各版评分与耗时）+ 正文 Markdown 查看 + 「手动优化」「重新评审」按钮
  - 作品状态为 `pool` 时明确展示「已达最大优化次数，进入低质量内容池」
- **长篇 Tab**（D2 占位）：说明卡片 + 「前往长篇工作台(admin/story)」链接

### 6.2 `admin/review-center/page.tsx` — AI 评审中心

二级 Tab：

1. **评审任务**：表格（小说/状态/评分/规则版本/Prompt版本/模型/优化次数/创建时间），行操作：查看详情、重试（FAILED）、重新评审、跳转版本/Prompt/规则（§42）
2. **评审记录**：记录列表 + 详情抽屉——完整追溯字段（小说哪个版本、source_url、规则/Prompt/模型及版本、第几次评审、第几次优化、耗时、原始响应、结构化结果），逐项回答 §47 十三个问题
3. **评审规则**：规则列表 + 版本时间线（草稿/测试中/已发布/已停用徽章）；版本编辑器含七维度编辑（名称/权重/定义/四档标准/加分/扣分/说明）、质量阈值、最大优化轮数；发布/停用操作带确认
4. **Prompt 版本**：按名称分组的版本历史；查看/新建版本（内容编辑器 + 关联规则版本 + 修改说明）；已发布版本只读
5. **质量数据**（本期基础版）：总评审数、通过率、平均分、平均优化次数、近 30 天趋势简表（深度分析留二期）

---

## 7. 测试计划（`scripts/verify-*.ts` 断言式风格，临时库运行）

| 脚本 | 覆盖 |
|---|---|
| `verify-short-story-core.ts` | 短篇 CRUD、brief 校验、版本只增不改、is_final 唯一、状态守卫 |
| `verify-review-rule.ts` | 规则版本化、发布后全局唯一生效版本、published 不可改、默认种子 v1.0 存在 |
| `verify-review-prompt.ts` | Prompt 版本不可覆盖、关联规则版本 |
| `verify-structured-output.ts` | fake provider 正常 JSON / 带 ```json 围栏 / 坏 JSON 重试 2 次 / 最终失败抛 STRUCTURED_OUTPUT_FAILED 且保留原始响应 |
| `verify-review-engine.ts` | 加权总分计算、等级分档、qualified 判定、评审记录全字段落库（含 model/rule/prompt 版本快照） |
| `verify-auto-optimize.ts` | 72→78→84 达标停止；72→75→74→77 三轮后入池；每次优化产生新版本且原版本不变；版本链完整；review/optimize 轮次计数正确 |
| `verify-ai-assist.ts` | suggest/generate/optimize 三动作任务落库、输出可取、重试 |
| `verify-creation-api.ts` / `verify-review-api.ts` | API 层：鉴权、zod 校验、错误码映射、分页查询 |

`package.json` 注册对应 npm scripts；收尾跑 `npm run typecheck`（三层）、`npm run build:web`、全部相关 verify。

**脚本骨架照抄现有惯例**：① 最先 `process.env.NOVEL_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'novel-xxx-'))`（临时库，不碰真实 data/novel.db）；② 之后才能动态 `await import('@novel/core')`；③ 断言用手写 `assertOk(cond, name)` / `assertThrows(code, fn, name)`（断 CoreError 错误码），中文用例名；④ 评审引擎测试不起真网络——脚本内起本地 `http.createServer` 假装 OpenAI 兼容端点（含 /models 发现、可控返回坏 JSON/500）再配 LLM 设置；⑤ API 测试不经网络——直接 import route handler 导出函数，构造 `new Request(...)` 调用断言状态码。

---

## 8. 里程碑（每步可独立验证）

| 里程碑 | 内容 | 出口验证 |
|---|---|---|
| M1 数据层 | db.ts 增补 DDL + 种子播种；domain 增补类型/错误码；`short-story.ts` / `review-rule.ts` / `review-prompt.ts` / `ai-task.ts` | typecheck + verify-short-story-core + verify-review-rule + verify-review-prompt |
| M2 结构化输出与评审引擎 | `structured-output.ts` + `review-engine.ts` + 评审记录落库 | verify-structured-output + verify-review-engine |
| M3 创作闭环 | 整篇生成 + `optimize-engine.ts` + `short-story-pipeline.ts`（自动评审→优化→再评审→入池） | verify-auto-optimize |
| M4 API 层 | 第 5 节全部路由 + STATUS_BY_CODE 增补 | verify-creation-api + verify-review-api + verify-ai-assist |
| M5 前端 | 创作中心（表单 + AI 辅助 + 进度 + 结果页）+ 评审中心五视图 | build:web 通过 + 手工冒烟 |
| M6 收尾 | 长篇 Tab 占位、README/architecture 文档更新、全量回归 | 全部 verify + typecheck + build |

---

## 9. 第二/三阶段预留（本期只留缝，不实现）

- 评审回放与多规则/多 Prompt/多模型对比：`review_records` 已按 rule_version/prompt_version/model 快照，天然可查（二期加对比 UI 与批量回放任务 `AI_REVIEW_RETRY`）。注意：当前 `resolveProvider` 是全局单一 (baseUrl, key, model) 取源，二期做模型对比需支持任务级模型参数覆盖
- AI 评审优化专家与回归测试：`ai_tasks.type` 枚举预留 `AI_RULE_ANALYSIS` / `AI_RULE_GENERATE` / `AI_REGRESSION_TEST`；规则版本 `testing` 状态即为回归测试挂载点

---

## 10. 待确认的决策点

1. **导航命名**：推荐把 `/admin/creation` 设为新的「AI 创作中心」，现有 story 页导航项更名为「长篇工作台」（路由与功能不变）。若你希望完全不动现有导航，则新增项需改用「短篇工坊」等别名以避免重名。
2. **短篇是否进读者站？** 建议第一阶段仅后台管理，不入 `(site)`；后续经导入线或直发对接。
3. **单次成文上限**：单次 LLM 调用 `maxTokens≈8000`（约 5000–6000 汉字）。目标字数 >6000 的短篇，第一阶段建议提示词内控制篇幅并在质检中提示截断风险；"分段生成再拼合"列为增强项。若你的目标字数普遍超过 1 万字，请告知，M3 直接实现分段拼合。
4. **AI 优化的手动入口是否绕过 max 轮数**：建议手动优化不受 3 轮限制但单独计数（表中已区分），自动流水线严格遵守。
