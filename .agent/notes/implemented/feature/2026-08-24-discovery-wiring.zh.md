# Agent Note: Discovery 接线与书籍热度展示

Status: implemented

English | [中文](2026-08-24-discovery-wiring.md)

## Problem

PR37 落了信号列与端点,但 UI 无人调用:章节页不记 PV,读者也看不到书的
热度。feed 只是个没从浏览器验证过的 API。

## Decision

- **ViewTracker**(章节页,client)——挂载即 `POST …/view` 一次(keepalive),
  passive scroll 监听在滚动比 ≥95% 时恰好一次 `…/finish`,触发后自摘监听。
  匿名友好,并刻意与登录门控的 ProgressReporter 分离:热度信号必须计入大
  多数从不注册的读者。
- **BookStatsLine**(详情页,server component)——直接由
  `getBookStats(book.id)` 渲染 `{n} 次阅读 · {n} 人收藏 · 完读率 {p}%`;
  书还没有任何 PV/收藏时整行不渲染,保持 V2 的干净观感。
- **verify-discovery-api**——13 项路由断言:未知书/章 404、PV 累加(2 次→
  viewCount 2)、2 PV 1 完读 → 完读率 0.5、统计形状、匿名 feed 无猜你喜欢、
  登录 feed 含猜你喜欢。

顺带修了一个潜伏的构建断裂:discovery.ts 起初写成 `./domain.js` /
`./db.js`——web 构建直接编译 core 源码,本仓库惯例是无扩展名相对导入;
typecheck 没抓住是因为 tsx 两种都能解析。

## Alternatives considered

**把 ViewTracker 并进 ProgressReporter。**少一个组件,但把常开的匿名写和登
录门控写耦在一起,完读阈值(95%)还得跟进度节流共享状态;两个单一职责的小组
件胜出。

**统计走客户端 fetch。**详情页本就 force-dynamic 服务端渲染,再绕一圈客户
端请求只为渲染时可得的数字,徒增闪烁。服务端组件即可。

**完读率 0% 也展示。**对一本只有 1 次 PV 的书,「完读率 0%」读起来像坏了而
不是诚实;有信号之前隐藏该段。

## Consequences

收益:信号闭环端到端跑通——读一章就会动 PR39 首页排序所依据的数字。代价:
每次打开章节多一个微型 POST(可接受;keepalive、不 await);同一页面加载内
反复滚动 finish 只记一次(会话级诚实,非按读者去重);`.js` 导入事故提醒:
web 构建对 core 源码的编译路径与 tsx 不同,**build:web 应进每个 PR 的门
禁**,而不只是发布清单。
