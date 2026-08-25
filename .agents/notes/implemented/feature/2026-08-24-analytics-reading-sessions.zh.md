# Agent Note: 数据分析——阅读会话与章节漏斗

Status: implemented

[English](2026-08-24-analytics-reading-sessions.md) | 中文

## Problem

路线图 V8 要求运营数据分析:PV、UV、阅读时长、章节完成率、收藏、订阅,
外加逐章流失分析(如「第 4 章明显流失」),并要求 AI 之后能基于这些数据
分析原因。V7 已落地 PV/完读计数器,V6 已有收藏/订阅/阅读进度,多数输入
已是可查数字——但没有任何东西度量**时长**,没有推导留存与漏斗形态,
后台也没有任何展示面。

## Decision

**为计数器无法表达的唯一指标(时长)建一张事件形态的表。**
`reading_sessions(id, book_id, chapter_number, started_at, finished_at,
duration_sec)`,附 `(book_id, chapter_number)` 与 `started_at` 两个索引,
经共享 DDL 的 `CREATE TABLE IF NOT EXISTS` 落地;`migrateAnalyticsColumns`
是有意的空占位,守住 [热度信号](2026-08-24-discovery-signals.zh.md) 的
教训——共享 DDL 里绝不放 ALTER TABLE。

- `core/src/analytics.ts` 的 `startReadingSession(bookId, chapterNumber)`
  防重:同书同章 30 秒内未结束的会话直接返回已有 id,挂载/刷新风暴不会
  倍增行数。
- `finishReadingSession(sessionId)` 幂等,时长钳制在 [0, 7200] 秒——
  2 小时上限防后台标签页的离谱值。

其余全部聚合自已采集的表:`getAnalyticsOverview` 对已发布章计数器求和
得 PV/完读,COUNT 收藏/订阅/读者/书,已完成会话秒数取整为
`totalDurationMin`,最近 7 天活跃取 `reading_progress.user_id` 去重数加
会话数。`getBookFunnel` 以第 1 章 PV(下限 1)为基线;留存率 = 本章 PV /
基线;标记是静态规则——留存率较前一章下降 ≥30 个百分点记 `drop-off`,
完读率 <30% 且 PV ≥3 记 `low-finish`——以 `flagReason` 暴露,供后续 AI
分析消费的结构化钩子。`getBookChapterMetrics` 为后台表格投影漏斗行。

后台端点(全部过 `requireAdmin`;Next-15 薄壳委托
`web/lib/analytics-handlers.ts`):

```
GET /api/admin/analytics/overview
GET /api/admin/analytics/books/[id]
GET /api/admin/analytics/books/[id]/chapters
```

`/admin/analytics` 页面渲染六张总览卡、单书选择器、逐章表格(留存率/
完读率进度条、标记高亮),以「数据分析」接入 AdminShell 导航。

验证:test:analytics——21 项断言,覆盖会话防重、含 2h 钳制的幂等
finish、总览聚合、漏斗基线留存计算、两条标记规则的边界、BOOK_NOT_FOUND,
以及章节指标投影。typecheck 绿。

## Alternatives considered

**每条 PV 都进 page_views 事件表。**即热度信号明确推迟的形态(「对 V8
是对的……要历史时再补事件」)。V8 兑现了这一半:PV/完读仍走 O(1)
计数器快路径,事件表只在天然需要两个时间戳的场景(时长)存在。

**纯客户端计时(localStorage + beacon 批量上报)。**匿名读者完全丢失,
也无法与服务端按书/章关联;服务端会话行让时长可查,即便它是匿名的。

**第三方统计(自托管 umami/plausible)。**把路线图要求的 AI 分析所需
数据拆到另一套系统;这个规模下,行留在 AI 将要查询的同一个 SQLite 里
更划算。

**现在就做分章 UV。**没有可数的匿名身份;基于 Cookie 的 UV 与彼处的
PV 去重一样列为明确的非目标——因此 activeReaders7d 仅用注册读者代理。

## Consequences

收益:漏斗与流失标记是对已采集计数器的纯 SQL;阅读时长成为可查行;
后台有了实时展示面;`flagReason` 给 AI 分析结构化输入而非裸表。
代价:会话匿名,「UV」是代理值而非实测;30 秒窗口是启发式(超 30 秒后
刷新会计两次);放弃的会话(`finished_at IS NULL`)不计入时长统计,
时间被低估;2h 上限静默截断离群值;流失阈值(≥30 个百分点相对下降、
PV ≥3 时完读率 <30%)是静态启发式,等待真实 AI 分析校准。
