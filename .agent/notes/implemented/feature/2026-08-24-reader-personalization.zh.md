# Agent Note: 读者个性化(收藏/订阅/阅读进度)

Status: implemented

English | [中文](2026-08-24-reader-personalization.md)

## Problem

读者能注册了,但无可个性化的东西:路线图 §9 的 我的书架(阅读至第N章/进度
%)、阅读历史、收藏、订阅+新章节提示 既无存储也无服务与端点。V2 的
localStorage 进度无法跨设备跟随账号。

## Decision

三张表,复合主键 `(user_id, book_id)` + CASCADE:

- **favorites**——纯切换集合。
- **subscriptions**——多一个 `last_seen_chapter`(单调:每次上报进度取
  `MAX(旧值, n)`),读旧章绝不会清掉新章提示。
- **reading_progress**——`{chapter_number, percent}` upsert;percent 钳到
  0-100;章号必须**已发布**,否则 CHAPTER_NOT_FOUND。

服务层在 reader.ts:`toggleFavorite/toggleSubscription` 返回切换后的布尔;
`getReaderShelf` 把 收藏∪订阅 联发布章数与最新进度,算出
`hasUpdate = publishedCount > max(progressChapter, 0)` 并按最近阅读排序;
`getReadingHistory` 是按时间倒序的投影。

端点(全部走会话 Cookie,匿名 401 `UNAUTHENTICATED`;未知 slug → 404
`BOOK_NOT_FOUND`;CoreError 走共享 handleError):

```
GET|POST /api/books/[slug]/favorite     GET|POST /api/books/[slug]/subscribe
POST     /api/books/[slug]/chapters/[n]/progress   {percent?}
GET      /api/me/shelf                 GET /api/me/history?limit=
```

路由文件是 Next-15 薄壳,委托 `web/lib/reader-handlers.ts`,逻辑可脱离 HTTP
直测。

验证:test:reader 增至 26 项断言(切换幂等、未发布章拒绝、重读旧章时进度仍
取最近一次上报、追平后 hasUpdate 翻转、退订后收藏仍在书架、两者皆撤则空),
test:reader-api 增至 31 项(401 门、状态查询 vs 切换语义、404、书架/历史载
荷)。typecheck 与完整构建绿。

## Alternatives considered

**每用户单个 JSON blob。**失去按书索引,书架 JOIN 也别扭;三张窄表让查询
保持简单,未来功能(下载计数、推荐信号)各自独立。

**百分比用浮点。**边界处四舍五入为整数——展示粒度就是整数百分比,还避免
比较时的浮点噪声。

**把「稍后再读」从收藏里拆出来。**路线图只要求 收藏;出现真实需求前先合
并概念。

## Consequences

收益:服务端的账号级阅读状态,PR34 UI 的地基已就绪。代价:书架对每本书用
相关子查询算发布章数——当前规模没问题,目录变大后需要物化计数;退订保留进
度行(有意为之,历史不丢),用户数据清理依赖删号 CASCADE 路径。
