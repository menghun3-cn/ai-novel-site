# Agent Note: Chapter review workflow and per-book autopilot

Status: implemented

English | [中文](2026-08-23-publish-review-workflow.md)

## Problem

路线图的 V3 发布核心要求:AI 生成的内容绝不能未经审核直接上线——
Draft → Quality Check → Review → Scheduled → Published。V2 的章节状态机
([相关](2026-08-23-admin-book-chapter-management.md))没有审核闸门——草稿
一个 PATCH 就能直接翻成 `published`;"每天 08:00 自动发布 1 章"的连载能力
也没有任何存储与执行器。

## Decision

`CHAPTER_STATUSES` 增加 `'pending_review'`,章节新增可空 `review_note`
(驳回反馈,重送审/批准时清空)。三个服务方法强制严格转换,都会联动刷新
所属书籍的 `updated_at`:

- `submitChapterForReview`:仅 `draft` → `pending_review`
- `approveChapter(bookId, number, {mode:'now'} | {mode:'scheduled', scheduledAt})`:
  仅 `pending_review` → 立即发布(保留首次发布时间语义)或转定时
- `rejectChapter(bookId, number, note?)`:仅 `pending_review` → `draft`,
  写入备注

非法跳转抛新错误码 `INVALID_REVIEW_TRANSITION`(API 层映射 409)。
`listPendingReview()` 返回按提交先后排序的队列(附书籍摘要);
`BOOK_LIST_SQL` 新增聚合列,让 `BookWithMeta.pendingReviewCount` 支撑
徽章与 KPI。

自动发布是每书配置,存在 `books` 表(`autopilot_enabled/hour/count/
last_date`,默认关/8/1,与文档示例一致),经
`getAutopilotConfig`/`configureAutopilot` 读写(hour 0–23、count 1–50,
否则 `INVALID_AUTOPILOT`)。执行器是可注入时钟的纯服务代码:
`publishDueChapters(now)` 在事务内把到期定时章节转发布;
`runAutopilot(now)` 每书每本地日至多触发一次(`lastRunDate` 守卫),
从最旧的 draft 起发布 count 章;`runPublishCycle(now)` 组合两者。
老库由 `migratePublishColumns` 幂等迁移;`(status, scheduled_at)` 索引
服务到期扫描。验证在 `npm run test:publish`(28 项断言:转换、队列顺序、
配置校验、到期扫描幂等、日守卫,全部跑在临时库上)。

## Alternatives considered

**自动发布从 `pending_review` 队列取稿而非 draft。**落选:审核队列是显式
的人工闸门——静默自动批准队列里的章节会让闸门形同虚设。自动发布是按书
opt-in 的可信管线;想走审核的运营者保持关闭即可。

**在 `status` 之外另设 `reviewState` 列。**落选:生命周期位置出现两个事实
来源必然漂移;路线图本身就把审核建模为流水线阶段,理应进入状态枚举。

**驳回理由只进日志/API 响应。**写驳回路径时落选:V4 的 AI 引擎需要机器可读
的驳回反馈来重新生成;可空列现在很便宜,以后补很贵。

**每书任意 cron 表达式调度。**延后:路线图里的真实示例都是"每天 HH:MM 发
N 章";日粒度守卫加 hour/count 已覆盖,无需引入调度 DSL 和表达式解析器。

## Consequences

收益:内容必须通过配置的闸门才能到达读者;连载自动化在服务层端到端成立,
且时钟可测。代价:`updateChapter` 仍接受裸 `status` 补丁(管理端全控),
严格转换由审核方法而非通用编辑器执法——UI 必须走审核方法;调度进程本身
尚未存在(只有执行器),PR #8 接上 runner 之前不会有任何东西自动发布。
