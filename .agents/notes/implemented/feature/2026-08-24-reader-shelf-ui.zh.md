# Agent Note: 书架 UI 与阅读进度上报

Status: implemented

English | [中文](2026-08-24-reader-shelf-ui.md)

## Problem

PR33 的个性化端点没有脸:路线图 §9 的界面——我的书架(阅读至第N章·进度%·
有更新)、详情页 收藏/订阅 按钮、章节级进度同步、阅读历史——全都缺失。
/shelf 还是 PR32 的占位页。

## Decision

三个客户端组件 + 一个页面重写 + 一个新页面:

- **BookActions**(详情页)——♡收藏 / +订阅 药丸按钮组。挂载时探测
  `/api/auth/me` 与两个状态端点;点击 POST 切换并回显布尔。匿名点击跳转
  /login。
- **ProgressReporter**(章节页)——passive scroll 监听,算
  `scrollY / (scrollHeight - innerHeight)`,章内单调(不回退)。首次有效滚
  动即报,之后节流:变化≥5% 且距上次>1.5s,或 8s 心跳;
  `pagehide`/`visibilitychange` 用 keepalive 兜底最后一写。以登录为门(一
  次 /me 探测)。渲染 null——纯副作用组件。
- **/shelf**——拉 /api/me/shelf;全部/收藏/订阅 页签;每行显示书名、命中
  `hasUpdate` 时的 有更新·最新第N章 绿色徽章、作者 + 阅读至第N章·进度P%
  一行,以及 继续阅读 按钮指向
  `min(progressChapter + (percent≥95 ? 1 : 0), latest)`——读完自动进下一
  章,读到一半原地续。空态/登录态/匿名态都有设计。
- **/me**——账号卡(首字头像、用户名、邮箱、退出登录)+ 最近阅读 列表,
  从 /api/me/history 取,直达对应章节。

验证:干净库 CDP 审计(新库 → 种子一书两章 → headless Edge)12/12:页面内
注册、按钮翻转为 已收藏/已订阅、书架条目 第1章 100%、徽章渲染、继续阅读→
chapter/2、追平后徽章消失、历史显示 第2章 · 100%、登出恢复匿名头。
typecheck + 完整构建绿。

## Alternatives considered

**Cookie 服务端渲染书架。**首屏更快但页签筛选反正要客户端 JS;保持与读者
面其他部分一致的单一 fetch 形态。

**按段落 IntersectionObserver 算进度。**用不上的精度;滚动比例与用户已经
看到的顶栏进度条一致。

**独立 history 表。**reading_progress 本身就是历史(每书一行=当前位置);
日志表会让存储翻倍而 §9 并不需要。

## Consequences

收益:§9 全链路端到端可见;进度跨设备跟随账号。代价:ProgressReporter 每
个活跃读者最多约 1 请求/8 秒(keepalive 写入极小);书架排序只依赖进度
updated_at(无进度的收藏经 COALESCE 按收藏时间排);/me 历史上限为客户端
请求的 20 行。
