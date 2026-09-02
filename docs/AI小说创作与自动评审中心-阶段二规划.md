# AI 小说创作与自动评审中心 · 阶段二规划

> 依据：[AI小说创作与自动评审中心-产品技术规格书.md](AI小说创作与自动评审中心-产品技术规格书.md) v1.0.0  
> 范围：阶段二 = D 短篇入读者站 + A 长篇创作中心(混合评审)+ G 调度器加固 + 增量 用户端语音朗读  
> 状态：规划待确认

---

## 0. 起点

阶段一已落地（M1-M6 全部提交并通过验证）：

- V9 数据层 7 张表 + 短篇/评审规则/Prompt/任务/记录服务
- 结构化输出评审引擎 + 优化引擎 + 创作流水线
- 18 个 admin API + AI 创作中心/评审中心后台
- 调度器目前仅跑 `runPublishCycle` + `runAiSerializationCycle`（V3/V5），**不处理 ai_tasks**——ai_tasks 完全依赖 web 进程 `kickStoryWorker`，多 web 实例 / web 重启会丢任务

读者站已有：
- SSR 详情页 / SSR 章节页 / 阅读控件（字号）/ 阅读进度 / 滑页 / 收藏订阅
- Markdown 渲染 `lib/markdown.ts`、阅读者会话 cookie、热度与完读统计

---

## 1. 关键设计决策

| # | 决策 | 理由 |
|---|---|---|
| D1 | **短篇"发布"= 物化为 Book+Chapter(1 章,status='completed')**，复用现有 books/chapters 与读者站 reader 页 | 0 新增读者组件；与长篇共用 SEO/RSS/书架/订阅/热度统计；spec §34 Novel/NovelVersion 实际可视为对 Book/Chapter 的特殊视图（V1 是文档版本、读者看的是已发布产物） |
| D2 | 短篇发布前必须 `status='passed'`；发布后产生新表 `short_story_publications`(id, story_id, book_id, published_at)做可追溯(规格书 §3.3 可追溯原则) | 历史短篇记录不能丢链接；可二次回溯 |
| D3 | 短篇详情页(读者站)走独立路径 `/short/[id]`,**不** 强行套 Book 详情页(短篇的"封面/简介/标签"字段更少,版式更轻) | 短篇阅读场景与长篇不同(一次读完 vs 追更),UI 应区分 |
| D4 | 长篇评审采用**混合语义**:① 单章评审(在 ai-serial 生成后自动评审,产出 review_records.story_id=null 而 record 挂在 chapter_id);② 卷/弧级评审(按 Story Core arc 范围,产物 `arc_review_records` 新表) | 10 万字长篇单次 LLM 读不完;章节级保证单章质量,弧级评估整本节奏(开端-发展-高潮-结局) |
| D5 | 长篇评审任务系统不另起炉:复用 `ai_tasks` 表,新增 type `AI_REVIEW_CHAPTER` 与 `AI_REVIEW_ARC`;Chapter 评审触发由 ai-serial 在 `llmReview=true` 时入队,弧级评审由 scheduler 周期(每 N 章或 N 天)入队 | 单一任务表、单一 worker、单一 UI;避免两套管道 |
| D6 | 调度器统一:scheduler tick 额外执行 `processAiTasks(limit=N)`;web kick 仍保留(改善延迟),但不再"独苗" | 多 web 实例/重启期间任务不再丢;web 与 scheduler 互斥(同进程级) |
| D7 | 语音朗读 v1 走 **Web Speech API `SpeechSynthesis`**(零依赖零成本) | 浏览器原生支持,Chrome/Edge/Safari/Firefox 全部覆盖;离线可用;无需 API key/账单;已知限制(OS 语音质量,无神经语音)v2 评估云端 TTS(Edge/Azure/Google) |
| D8 | 语音控件并入 `ReaderControls` 一行(🔊 朗读/暂停/停止 + 语速 + 语音下拉);移动端折叠为浮动按钮 | 复用既有 UI 上下文(章节顶),不影响阅读节奏;语音偏好持久化到 localStorage |
| D9 | 语音客户端 only,长文分段(按段落断句)避免 utterance 过长被截断 | 浏览器单次 utterance 文本过长会被截断/卡死;段落切片是最稳定的策略 |
| D10 | **不破坏** 现有 books/chapters 长篇体系;长篇创作中心不重写 admin/story 页,而是新增"评审/对比/导出"子模块挂到 story 页面 | 阶段一约定的"不破坏既有功能"延续 |

---

## 2. 数据模型(新增 3 表 + 1 改字段)

```sql
-- 短篇发布追溯
CREATE TABLE IF NOT EXISTS short_story_publications (
  id TEXT PRIMARY KEY,
  story_id TEXT NOT NULL REFERENCES short_stories(id) ON DELETE CASCADE,
  book_id TEXT NOT NULL REFERENCES books(id) ON DELETE CASCADE,
  version_id TEXT NOT NULL,        -- 发布时短篇的哪一版(短篇短文可重发,旧 book 仍可访问)
  published_at TEXT NOT NULL,
  UNIQUE(story_id, version_id)
);
CREATE INDEX IF NOT EXISTS idx_short_story_publications_story ON short_story_publications(story_id);

-- 弧级评审记录(长篇)
CREATE TABLE IF NOT EXISTS arc_review_records (
  id TEXT PRIMARY KEY,
  book_id TEXT NOT NULL REFERENCES books(id) ON DELETE CASCADE,
  arc_id TEXT,                     -- Story Core arc.id,弧不存在时为 NULL
  arc_label TEXT NOT NULL,         -- 显示用,如「第一卷」「主角觉醒弧」
  from_chapter INTEGER NOT NULL,
  to_chapter INTEGER NOT NULL,
  rule_id TEXT NOT NULL,
  rule_version TEXT NOT NULL,
  prompt_id TEXT,
  prompt_version TEXT,
  model_name TEXT,
  score INTEGER NOT NULL,
  level TEXT NOT NULL,
  qualified INTEGER NOT NULL,
  dimension_scores_json TEXT NOT NULL,
  strengths_json TEXT NOT NULL DEFAULT '[]',
  weaknesses_json TEXT NOT NULL DEFAULT '[]',
  suggestions_json TEXT NOT NULL DEFAULT '[]',
  summary TEXT,
  duration_ms INTEGER,
  raw_response TEXT,
  structured_result_json TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_arc_review_records_book ON arc_review_records(book_id, created_at);
```

**改字段**:在 `ai_tasks.type` 检查守卫(`isAiTaskType`)中加入 `'AI_REVIEW_CHAPTER' | 'AI_REVIEW_ARC'`(enum 扩展;阶段一已留缝,只需加值)

新增错误码:
- `SHORT_STORY_NOT_PUBLISHED`(400):非 passed 状态短篇不可发布
- `PUBLICATION_NOT_FOUND`(404)
- `ARC_REVIEW_RECORD_NOT_FOUND`(404)
- `ARC_NOT_FOUND`(404)

迁移:
- 旧库无 `short_story_publications` / `arc_review_records` → CREATE TABLE IF NOT EXISTS 自动建
- 旧库 ai_tasks.type 列无新增枚举值 → TEXT 列,不需迁移

---

## 3. 服务层(`core/src/` 新增 + 扩展)

| 模块 | 改动 |
|---|---|
| `domain.ts` | + `ArcReviewRecord` / `ShortStoryPublication` 类型;`AI_TASK_TYPES` 加 `AI_REVIEW_CHAPTER`/`AI_REVIEW_ARC`;新错误码 |
| `db.ts` | + 2 张新表 DDL;无需列迁移 |
| `short-story-publication.ts`(新) | `publishShortStory(storyId, opts?)`:passed → 创建 book(completed,作者="AI 短篇"/分类="短篇"或当前 default,description=brief 摘要)+ chapter(全文本,publishedAt=now);落 `short_story_publications`;返回 `{bookId, chapterId, publicationId}`;幂等(同 version 已发布 → 409) |
| `arc-review-engine.ts`(新) | `runArcReview(bookId, arcId?)`:读 arc 范围章节 → 拼接(每章 N 字摘录,总长控 8000 字)→ 调 `completeStructured` → 加权计分定级 → 写 `arc_review_records` → 返回;若该弧已审过(同 from_chapter/to_chapter)默认覆盖确认后更新或新增(默认新增保留历史) |
| `chapter-review.ts`(新) | `reviewChapter(chapterId, opts?)`:对单章做完整评审(沿用 `runAutoReview` 范式,目标实体是 chapter 而非 story_version;新表 chapter_review_records? 见决策);**简化方案:复评字段复用 review_records 但 story_id 字段允许 null,加 `chapter_id TEXT NULL` 兼容——先看是否影响既有类型** |
| `short-story-pipeline.ts` | + `enqueuePublishShortStory(storyId)`:CREATE task type='PUBLISH_SHORT_STORY';execute 调 `publishShortStory`;pipeline 状态机不动 |
| `ai-assist.ts` | 不变 |
| `review-engine.ts` | 不变(单章评审后续可加复用入口) |

**关于 chapter 级评审的最终方案**:经分析,长篇章节评审产物本质与短篇版评审同构,新增独立表 `chapter_review_records` 会造成规则/Prompt/统计重复。**改为**:扩 `review_records` 表(加可选列 `chapter_id TEXT NULL`、`ref_type TEXT NOT NULL DEFAULT 'short_story'`,schema 演进)用 PRAGMA 列迁移;新统计加 union。这样所有评审(短篇/章节/弧)一处查询即可,AI 评审中心视图自然统一。**不** 单建表。phase 2 改 1 张表 + 加 task type + 加 engine 即可。

```sql
-- 列迁移(PRAGMA 检测后 ALTER)
ALTER TABLE review_records ADD COLUMN chapter_id TEXT;
ALTER TABLE review_records ADD COLUMN ref_type TEXT NOT NULL DEFAULT 'short_story';
```

---

## 4. API(web/app/api/admin 与 /api 公开)

### 4.1 短篇发布与公开访问

- `POST /api/admin/short-stories/[id]/publish` — 入队 PUBLISH_SHORT_STORY 任务
- `GET  /api/short-stories` — 读者站短篇列表(已发布,按发布时间倒序,limit 50)
- `GET  /api/short-stories/[id]` — 读者站短篇详情(book + 章节 + publication 信息)
- `GET  /short/[id]`(site 路由) — 短篇阅读页(SSR)

### 4.2 长篇评审

- `POST /api/admin/books/[id]/review-arc` — 入队 AI_REVIEW_ARC(body: {arcId?});可选章节范围
- `POST /api/admin/books/[id]/chapters/[number]/review` — 入队 AI_REVIEW_CHAPTER(单章)
- `POST /api/admin/ai/tasks/[id]/retry` 复用
- `GET  /api/admin/books/[id]/reviews` — 合并 chapter + arc 评审记录(给 admin/analytics 后续用)

### 4.3 调度器/任务

- 调度器 tick 增加 `processAiTasks({limit: 5, scope: 'all'})` 调用(web kick 也调;互斥见决策 D6)
- 现有 `/api/admin/ai/tasks` 已经支持 type 过滤,无需新增
- review-center 的 tasks 视图加 type 列展示 `整书发布`/`章节评审`/`弧级评审`

---

## 5. 前端

### 5.1 短篇读者页

- `web/app/(site)/short/[id]/page.tsx` — SSR 拉取 book + chapter,版式轻(单栏,无章节列表,显示短篇元信息 + 简介 + tags + 完读按钮);首屏后调已有 ReadProgress/ViewTracker(走 books 路径下的 progress API,需确认短篇 chapter 的 progress 上报——book_id 已建好,沿用即可)
- 短篇卡片(首页/分类页)复用 `BookCard`,传 `kind='short'`,显示"短篇"角标
- 小说管理后台:已发布短篇在 `admin/books` 列表的 `source` 列显示"短篇"或加 type 列
- `admin/creation` 详情页加"发布到读者站"按钮(passed 状态可点)

### 5.2 长篇评审 UI

- `web/app/admin/(dash)/books/[id]/page.tsx` 现已存在,新增 tab"评审",展示:章节评审记录列表 + 弧级评审卡片 + 评审趋势图(简单 sparkline,后续完善)
- `web/app/admin/(dash)/story/page.tsx` 现状(Story Core 工作台)在"AI 工作台"卡上方加一栏"长篇评审":最近 5 条评审(章节+弧混合),带"评审全书"按钮(触发弧级评审)
- `web/components/admin/ReviewCard.tsx`(新):统一渲染 review_record/arc_review_record,显示分数/等级/维度条

### 5.3 语音朗读(ReaderControls 扩展)

`ReaderControls.tsx` 增加第二行控件(PC),移动端折叠为浮动按钮:

```tsx
// 第二行(PC)/浮动按钮(移动): 🔊 朗读 | 暂停 | 停止 | 语速下拉(0.8/1.0/1.2/1.5) | 语音下拉
```

- 语音下拉:首次播放时懒加载 `speechSynthesis.getVoices()`(异步触发 `voiceschanged`);空列表时显示"系统未安装语音"
- 段落切片:`Array.from(document.querySelectorAll('article p'))`,按段落入队 utterance,串行 onend 触发下一个,首段带 onstart 标记高亮
- 状态机:`idle | playing | paused`,按钮在 playing 时显示"暂停" / "停止"
- 进度:朗读过程中给当前段加 class `bg-yellow-100`(轻微背景闪烁),CSS transition 200ms
- 离开页面 / 切换章节:`speechSynthesis.cancel()` 防串读
- 偏好持久化:`novel:tts:rate` / `novel:tts:voiceURI` localStorage
- 短篇页 `<ReaderControls>` 复用同一组件(只传 `bookSlug`/`chapterNumber`,朗读内容取 `article p` 段落,长篇/短篇通用)

不引入新依赖。SpeechSynthesis 是浏览器原生 Web API。

---

## 6. 调度器加固(G)

`scripts/publish-scheduler.ts` 增加第三个 try 块:

```ts
try {
  const ai = await processAiTasks({ limit: 5 });
  if (ai.processed > 0) console.log(`[${ts}] ai-tasks: processed=${ai.processed} ok=${ai.filter(r => r.ok).length}`);
} catch (err) { console.error(...); }
```

**互斥**:`processAiTasks` 内部用 `startAiTask` 切 PENDING→RUNNING——SQLite 事务 + where status='PENDING' UPDATE。web kick 和 scheduler 同时跑会导致同一个任务被两边争抢(两边都 set RUNNING 但只有一个能 commit,另一个 rowid 找不到匹配)——**单实例场景自然安全**;多 web 实例需要 pessimistic lock。生产建议 scheduler 是主执行者,web kick 仅在用户当前 session 内临时加速(同 web 实例下,scheduler 不在该实例的进程里所以不会冲突)。本期先单实例安全 + 文档说明。

新建 `core/src/ai-task.ts` 暴露 `processAiTasksTick()` 同步版(不带 provider 注入?不可能,LLM 必须 provider)——保持现状异步,scheduler 用 `await` 调用。

---

## 7. 测试(verify-*.ts 风格)

| 脚本 | 覆盖 |
|---|---|
| `verify-short-story-publication.ts` | passed → publishShortStory → book+chapter 物化;二次发布同 version → 409;失败(passing 不在 passed)→ 400 |
| `verify-arc-review.ts` | runArcReview(book,arc)→ 加权计分/记录/快照;`fake provider`;不存在的 arc → 404; |
| `verify-chapter-review.ts` | 复用 review-engine 范式,目标实体为 chapter;ref_type='chapter' 落库 |
| `verify-scheduler-tasks.ts` | 模拟 scheduler: 入队 ai_task → 调度器 tick 消费 → status SUCCESS;web kick 模式同样 |
| `verify-public-short-story.ts` | API: 已发布短篇可经 /api/short-stories/[id] 访问;未发布不返回 |
| `verify-tts-helper.ts`(可选) | 段落切片工具纯函数测试(浏览器外:输入 markdown → 段落数组) |
| `verify-pipeline-extension.ts` | 扩展后:enqueuePublishShortStory + processAiTasks 类型分发 |

---

## 8. 里程碑

| 里程碑 | 内容 | 出口 |
|---|---|---|
| M7 数据层与短篇发布 | `short_story_publications` 表 + `publishShortStory` 服务 + verify | verify-short-story-publication |
| M8 短篇读者站 | `/short/[id]` 页 + `/api/short-stories/*` + 首页/分类卡适配 | verify-public-short-story + build:web |
| M9 长篇评审(章节+弧) | review_records 列迁移 + chapter-review + arc-review-engine + ai_tasks type 扩展 + admin UI Tab | verify-chapter-review + verify-arc-review |
| M10 调度器加固 | scheduler tick 调 processAiTasks;互斥说明文档 | verify-scheduler-tasks |
| M11 语音朗读 | ReaderControls TTS 集成;移动端浮动按钮;localStorage 偏好 | build:web + 手工冒烟 |
| M12 文档与全量回归 | README/architecture 增 D/A/G/Audio 章节;9+7 验证全过 | 全部 verify + typecheck + build |

---

## 9. 待确认决策点（已确认 — 2025）

1. ✅ **短篇发布后是否进首页/分类/搜索?**
   - **进**:首页/分类/搜索统一发现位,`BookCard` 按 `kind='short'` 加"短篇"角标区分版式;读者站所有发现路径对短篇透明
2. ✅ **长篇弧级评审的触发节奏**:
   - **手动 + 半自动**:后台按钮即时触发 + 每次新增章数达到阈值自动触发;阈值存 `books.arc_review_every_n` 列(默认 5, 0=禁用自动弧评)
3. ✅ **长篇单章评审是否计入自动连载流水线**:
   - **默认开**:与短篇流水线同构——ai-serial 生成 V(n+1) 后若 `books.chapter_review_enabled=1`(默认 1)则入队章节评审;不达标自动走 V9 优化引擎生成 V'(n+1);最大优化轮数取 `books.chapter_review_max_rounds`(默认 1,长篇成本控制)
4. ✅ **G 调度器加固的互斥策略**:
   - **单实例 + 文档说明**:scheduler 主导任务消费,web kick 仍可临时加速;多实例并发不在本期范围,文档明示风险与下个迭代计划

按上述决策开 M7。
