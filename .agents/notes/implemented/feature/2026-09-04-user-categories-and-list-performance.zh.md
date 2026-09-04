# Agent Note: 用户端分类分层、数量一致与列表提速

Status: implemented

English | [中文](2026-09-04-user-categories-and-list-performance.zh.md)

## Problem

用户端分类体验有三处缺陷。(1) 分类是平铺一堆,没有分层:明明 `books` 带
`kind` 列('long'/'short'),却没有「长篇小说 / 短篇小说」的区分,分类列表
也没有内置市面上常见的主流题材。(2) 数量不一致:「全部小说」页与分类页数字
对不上——`listCategories()` 统计所有书(不看 `status`),而 `listBooks()` 只
统计公开书(`status <> 'hidden'`),两边口径不同。(3) 约 100 本书时切换
首页 / 全部小说 / 分类明显卡顿:书单 SQL 每本书跑 6 个关联子查询,且每个
列表页每次请求都走服务端重渲染。

## Decision

`categories` 表保持扁平(`id`/`slug`/`name`),**不加** `kind`/`parent` 列。
分层在读时由书自身的 `kind` 推导:分类页按「长篇小说(`longCount`)/
短篇小说(`shortCount`)」分组展示,全部小说页与分类详情页提供客户端
长篇/短篇 Tab 切换。

- **内置主流分类种子。** `core/src/db.ts` 新增 `DEFAULT_CATEGORIES`
  (约 75 个主流题材,已去重),迁移后经 `INSERT OR IGNORE` 幂等播种
  (slug 逻辑内联,避免循环依赖)。种子刻意不含「短篇小说 / 长篇小说」,
  把这两个名字留给短篇发布管线的 `SHORT_STORY_DEFAULT_CATEGORY` 与验证脚本。
- **数量口径一致。** `listCategories()` 现在只统计公开书
  (`LEFT JOIN books ... AND b.status <> 'hidden'`),返回 `id` 与
  `count`/`longCount`/`shortCount`(**camelCase 别名**——曾用 snake_case
  导致 JS 端求和得 NaN),`countPublicBooks()` 与 `listBooks()` 过滤口径
  完全一致。「全部小说」页的「共 N 本」与分类 chips 数字同源。
- **列表性能。** `BOOK_LIST_SQL` 从每本书 6 个关联子查询重写为分组聚合 +
  `ROW_NUMBER() OVER (PARTITION BY book_id ORDER BY number DESC)` 窗口函数
  取最新章节——全书只扫两遍 `chapters`。`discovery.ts` 的 `FEED_SELECT`
  同样改为分组连接(并补上此前运行时缺失的 `b.kind`)。读者列表页改为 ISR
  (`revalidate = 60`):服务端一次取全量书 + 分类统计,`BooksBrowser` /
  `CategoryBrowser` 客户端组件在浏览器内完成全部筛选,Tab/分类切换零服务端
  往返。这是被实测逼出来的:Next 15 中**读取** `searchParams` 的页面即使声明
  `export const revalidate` 也会退化为 dynamic(`Cache-Control: no-store`);
  因此页面不在服务端读 searchParams,客户端组件用 `useEffect` +
  `window.location.search` 读初始 `?category=`/`?kind=`(不用
  `useSearchParams`,那会让整段边界退化为纯客户端渲染)。BookCard/
  DiscoveryCard/HotRanking/RecentUpdates/搜索页的卡片图加
  `loading="lazy" decoding="async"`。
- **文案。** TtsPlayer(按钮、引擎选项、错误提示)与 tts API 错误消息中用户
  可见的「朗读」全部改为「听书」。
- **默认听书引擎改为 Kokoro。** 本地 Kokoro 引擎可用且用户无显式偏好时,
  默认引擎自动切为 Kokoro,否则回退 `edge`;移动端 502 根因与切换逻辑见
  更新后的 [local-kokoro-tts](../../implemented/feature/2026-09-03-local-kokoro-tts.md)。

## Alternatives considered

**给 `categories` 加 `kind`/`parent` 列(分类树)。** 否决:扁平表 +
`book.kind` 分组能得到同样的用户效果,且无需 schema 迁移、无需双写分类
归属、不动管理端 UI;分类保持为纯粹的题材词表。

**保留 `searchParams` 驱动服务端筛选并依赖 `revalidate`。** 生产实测后否决:
Next 15.5 读取 `searchParams` 的页面无视 `revalidate` 一律退化为 dynamic,
每次切换都会重跑 SQL、重渲染——正是要消除的卡顿本身。

**听书默认引擎保持 `edge`。** 否决:edge 是长时在线 POST(浏览器 → /api/tts
→ 服务器 → bing WebSocket,数秒~15s),移动网络路径上的中间层(运营商透明
代理/CDN 边缘节点)等待超时后替服务器返回 502 错误页(非 JSON,前端因此显示
笼统的「语音合成失败(502)」)——PC 宽带直连无此拦截,所以同一本小说 PC 正常、
手机端 502。Kokoro 本地合成 <1s、无外网一跳,天然规避中间层拦截。

## Consequences

- 分类计数、「全部小说」总数、分类页求和现在是同一个数(实测:70 本 =
  3 长篇 + 67 短篇)。
- 78 个种子分类占用了分类命名空间:对已播种名字 `createCategory` 会抛
  `CATEGORY_NAME_TAKEN`,故 `verify-admin-core.ts` 改用非种子名。
- 列表页用最多 60s 的发布新鲜度(ISR 窗口)换显著更低的延迟;首页保持
  `force-dynamic`(cookie 个性化),仍受益于 `FEED_SELECT` 重写。
- 客户端筛选依赖 JS;无 JS 时 /books 与分类页仍渲染完整静态列表(limit 500)。
- `listCategories()` 现在返回 `id`,顺带修复了管理端分类页 rename/delete
  曾调用 `/api/admin/categories/undefined` 的 bug。
- 默认听书引擎在镜像以 `ENABLE_LOCAL_TTS=1` 构建且模型已挂载时为 Kokoro;
  未启用本地引擎的镜像静默沿用 edge——两种情况都不破坏用户体验。
