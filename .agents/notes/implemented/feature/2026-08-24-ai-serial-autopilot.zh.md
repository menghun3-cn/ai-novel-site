# Agent Note: AI 自动连载

Status: implemented

English | [中文](2026-08-24-ai-serial-autopilot.md)

## Problem

V4 引擎已能单次生成并质检一章,但全靠运营者驱动:没有排程,没有批量起稿
(「AI 生成前 10 章」),不记得流水线今天已经产出过什么,常驻调度器也只处
理定时发布(V3)。路线图 §8 的闭环——每天自动生成 → 自动检查 → 自动发布
——还没有机器去转。

## Decision

两张新表,一个模块(`core/src/ai-serial.ts`):

- **`ai_serialization`**——每书配置:`enabled`、`hour`(本地时 0-23)、
  `count`(每日 1-20)、`autoPublish`、`minChars`(200-20000)、
  `last_run_date`。未配置的书读虚拟默认值(停用/8 点/1 章/送审模式/500 字)。
  校验失败用新错误码 `INVALID_AI_SERIALIZATION`(HTTP 400)。
- **`generation_jobs`**——只追加的结果日志:`pending → running →`
  `published | submitted | rejected | failed`,带尝试次数、错误、字数与解
  析出的模型名。被拒任务不占章号(引擎根本没落稿),章号保持连续。

流程件:

- `enqueueGenerationJobs(bookId, count)`——「AI 生成前 N 章」的批量起稿
  (单次上限 50)。
- `processGenerationJobs(limit)`——按最旧 pending 逐个执行,走
  `generateChapterDraft` 且 `submitForReview: true`;成功后要么停在
  `pending_review`(人工确认),要么在书开启 `autoPublish` 时立即经 V3 的
  `approveChapter(mode:'now')` 批准发布。Provider 解析统一走
  `resolveProviderFromStore()`(后台设置 > 环境变量),调度器与 API 语义一致。
- `runAiSerializationCycle(now)`——对所有启用且 `last_run_date < 今天`
  **且**时刻已到的书:入队 count 个任务、记 `last_run_date = 今天`,然后处
  理队列。日期守卫保证一天内重复 tick 幂等。
- 调度器脚本现在每 tick 先跑发布周期再跑本周期;AI 失败仅记日志,绝不杀进程。

验证:`npm run test:ai-serial`(24 项断言:虚拟默认值、校验边界含读操作抛
BOOK_NOT_FOUND、批量入队上限、送审模式章节落在 pending_review、autoPublish
原地发布、minChars 透传产生零写入拒绝、上游宕机任务标 failed 且不污染队列、
模拟跨日的日守卫幂等、hour 门挡住未到时刻的启用书、停用书跳过)。
typecheck + 构建 + 全部既有测试套件绿。

## Alternatives considered

**应用外 cron。**落选:失去 Windows 开发环境对等性和一条命令的运维故事;
V3 起进程内调度器已存在。

**pending 任务预分配章号。**并发下是错的:手动生成与周期生成两个来源会在
章号上相撞;执行时才取号让 `max+1` 保持权威。

**executeJob 内部重试。**延后:记录 attempt 但失败保持终态,直到运营者重
新入队。对抖动网关自动重试会悄悄烧预算;失败如实出现在任务列表里才是诚实
的默认。

## Consequences

收益:启用 AI 连载只需保存一次配置;隔夜系统就能按配置的字数下限产出待审
(或直接发布)的章节。代价/注意:日守卫与 V3 autopilot 一样基于**本地时**
(夏令时切换每年可能漏跑或多跑一次);任务在一个 tick 内串行执行,慢网关会
拖住后面其他书的生成(后续可做按任务的并发);`auto_publish` 按设计绕过人
工审核——把它视为路线图里那步「人工确认」的开关。
