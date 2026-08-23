# Agent Note: Publishing HTTP API and resident scheduler

Status: implemented

English | [中文](2026-08-23-publish-scheduler-api.md)

## Problem

审核工作流与自动发布此前只是服务层函数
([相关](2026-08-23-publish-review-workflow.md)):运营者没有 HTTP 入口去
送审/批准/驳回、查看审核队列、配置每书自动发布——也没有任何东西周期性执行
`runPublishCycle`,定时章节会永远躺着。

## Decision

四个管理端点,全部经 `withAdmin`:

- `POST /api/admin/books/[id]/chapters/[number]/review` —— 请求体
  `{action:'submit'} | {action:'approve',mode:'now'|'scheduled',scheduledAt?} |
  {action:'reject',note?}`;zod 可辨识联合,缺 `scheduledAt` 返 400,
  服务层错误照常映射(409 非法转换、404 未知章节)
- `GET /api/admin/review-queue?limit&offset` —— 带书籍摘要的 FIFO 队列
- `GET|PUT /api/admin/books/[id]/autopilot` —— 配置读/写;路由层 zod 边界
  (hour 0–23、count 1–50)先以 VALIDATION_FAILED 拦截,服务层守卫保留作纵深防御
- `POST /api/admin/publish/run` —— 手动触发 `runPublishCycle()`

通用章节 PATCH 的 status 枚举同步补上 `pending_review`,与领域枚举一致。

自动化是 `scripts/publish-scheduler.ts`(`npm run scheduler`):顺序循环
(tick 不重叠)每 `PUBLISH_TICK_SECONDS`(默认 60,下限 5 秒)调用一次
`runPublishCycle`,只记录有发布的周期;单次异常不终止进程;
SIGINT/SIGTERM 干净退出。验证:`npm run test:publish-api`(16 项 handler 级
断言:鉴权、正常路径、400/404/409 映射、队列形状、配置往返),另对调度器
进程做实机冒烟;typecheck 与生产构建全绿。

## Alternatives considered

**外部 cron + 一次性 CLI。**延后:cron 强绑部署环境,而项目当前尚无 Docker
编排;进程内循环让 V3 自洽,tick 函数日后可被任何外部调度器复用。

**Webhook/任务队列(BullMQ 等)。**落选:为"每书至多每日一次"的任务引入 Redis
过重;SQLite 事务已给到期扫描提供原子性。

**把审核动作并进 PATCH /chapters/[number]。**落选:批准需要 mode+时刻载荷,
会把编辑 schema 搅浑;独立端点语义更利于审计。通用 PATCH 仍保留直接改状态
的能力给高级用法。

**调度器内嵌进 next start 自启。**落选:生命周期耦合意味着重启 Web 就杀死
发布;独立进程可独立重启/扩缩,与导入器保持独立的思路一致。

## Consequences

收益:V3 全链路可通过 HTTP 驱动;部署清单加入 `scheduler` 进程后即可无人值守
运行;手动触发覆盖运维排查场景。代价:恰好一个调度器进程是运维假设(两个
调度器在同一天边界竞态下可能双发自动发布);tick 循环按间隔睡眠而非对齐
整分,"08:00"最多晚一个 tick 触发。
