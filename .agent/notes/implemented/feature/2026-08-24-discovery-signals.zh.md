# Agent Note: Discovery 热度信号

Status: implemented

English | [中文](2026-08-24-discovery-signals.md)

## Problem

路线图 §10 要求 Discovery 首页(今日推荐/热门/最新更新/新书/完结/猜你喜欢),
以 阅读量+更新频率+完读率+收藏 打分——但平台此前不记录任何阅读信号:PV、
完读、收藏都没有可查询的量化。

## Decision

**信号就是三个整数列,不是事件表:**

- `books.view_count`——书级 PV,章页打开即 +1(含匿名)。
- `chapters.view_count` / `chapters.finish_count`——章级 PV 与滚到底完成
  数;完读率 = 已发布章 SUM(finish)/SUM(view),SQL 内聚合。
- 收藏无需计数器——对现有表 `COUNT(*)` 即得。

写入走 `core/src/discovery.ts` 的 `trackChapterView` / `trackChapterFinish`
(各两条单行 UPDATE;章必须已发布,否则 CHAPTER_NOT_FOUND)。公开端点:
`POST /api/books/[slug]/chapters/[n]/view|finish`,另有
`GET /api/books/[slug]/stats` 返回 `{viewCount, favoriteCount, finishRate,
publishedCount}` 与 feed 端点 `GET /api/discovery`。列经幂等的 PRAGMA 检查
迁移落地(`migrateDiscoveryColumns`);**ALTER TABLE 绝不能放进共享 DDL 模
板**——DDL 每次启动都执行,在老库上会报 duplicate column。

验证:test:discovery——15 项断言:未发布章拒绝、跨章 PV 聚合、完读率边界、
统计 404、收藏计数、板块顺序 today→hot→recent→new→completed、热门榜首为
6 PV 的书、今日推荐去重、登录态 猜你喜欢 不推已订阅书。typecheck 绿。

## Alternatives considered

**只增事件表(page_views)。**对 V8 数据分析(PV/UV/时长)是对的形态,对 V7
评分是错的成本——每次 feed 查询都要聚百万行。计数器读取 O(1);V8 要历史时
再补事件,计数器仍是快路径(可用事件回放校准)。V8 兑现的正是这一约定——
见 [数据分析阅读会话](2026-08-24-analytics-reading-sessions.zh.md)。

**章节 RSC 里做服务端计数。**服务端组件无法可靠区分客户端导航与预取,会双
计;显式客户端 POST 意图清晰,后续也留了节流/去重的钩子。

**仅登录读者计入。**会掏空阅读站的 阅读量——多数读者不注册;此规模下计数便
宜且可容忍滥用。

## Consequences

收益:路线图的四个输入成为可查数字,PR38 的打分只是 SQL+算术。代价:计数器
在备份回放场景下有损(与代码假设的精确性不同源);反复刷新会抬高 PV(排序用
途下可接受的偏差;按 Cookie/IP 去重在排名真正被刷之前列为非目标);finish 由
客户端声明,度量的是「到达底部」而非「认真读完」。
