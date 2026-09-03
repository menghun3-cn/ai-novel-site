# Agent Note: Stale RUNNING ai_tasks are never re-queued after the executor dies

Status: implemented

English | [中文](2026-09-03-stale-running-ai-task-recovery.zh.md)

## Problem

`ai_tasks` 的任务由 `processAiTasks()` 领取执行:`startAiTask()` 把 `PENDING` 翻转为 `RUNNING`,任务运行完后由 `completeAiTask()` / `failAiTask()` 收尾。取件器 `claimPendingTasks()` 永远只选 `status = 'PENDING'`,而 `RUNNING` 行没有任何超时或崩溃恢复路径。

当执行进程在运行中途消失——例如 `docker compose up -d --build` 部署时的容器重建或崩溃、OOM 被杀、手动重启——`RUNNING` 行就永远成为孤儿:无人再领取、永不收尾,创作中心一直把该短篇显示为「执行中」。该问题在生产环境实测发生(2026-09-03):短篇 `ss_5d3fe803d3ae409fb130` 的 `CREATE_NOVEL` 任务在 `novel-web`/`novel-scheduler` 容器于 06:11:35Z 重建前 44 秒被认领;此后数小时一直停留在 `RUNNING`,卡住该短篇流水线,而同批次的其他短篇均正常完成并发布。

## Decision

由调度器驱动的僵尸 `RUNNING` 恢复步骤:

- `core/src/ai-task.ts` 新增 `recoverStaleRunningTasks(maxAgeMs = 10 * 60 * 1000)`:把 `status = 'RUNNING'` 且 `started_at` 早于阈值的所有任务重置回 `PENDING`,清空执行痕迹(`started_at`/`finished_at`/`duration_ms`/`error`/`output_json`),保留 `attempt` 计数(重试历史仍可见)。重置在单个事务内完成。
- 调度器 tick(`scripts/publish-scheduler.ts`)每轮在 `processAiTasks()` 之前调用一次,恢复的任务在同一轮就被重新认领并执行。恢复数量与 id 以 `stale-recovered: count=N ids=...` 记录日志。
- 阈值通过 `AI_TASK_STALE_GRACE_MS` 配置(毫秒,下限 60000,默认 600000)。默认值远超正常任务最长耗时(整篇生成约 3 分钟),在跑任务不会被误判为僵尸。
- 只有调度器执行恢复;web 侧 `story-worker.ts` 不做恢复,避免把 web worker 真正在执行的任务重复拉起造成双跑。

## Alternatives considered

**执行器启动时接管(仿 `scheduler-lock.ts` 的 stale takeover)。** 锁文件携带 pid/hostname 且每 tick 续约,新调度器实例能区分存活持有者与已死持有者。但任务行不携带任何执行者身份,启动清扫无法区分真正在跑的任务(例如 web worker 仍在执行)与孤儿。tick 内基于时间的清扫是唯一可用的信号,且每分钟一次的粒度本身就限制了恢复延迟。

**给每个任务行加心跳/租约。** 健壮(任务行可携带刷新时间戳),但每个在跑任务每 tick 多一次写入并要加迁移;10 分钟时间阈值以零 schema 变更达到同样的实际效果。

**只提供管理后台手动「重跑」按钮。** 会让创作中心一直卡到有人发现;而这整个故障模式恰恰是"数小时无人察觉"。

**把恢复逻辑放进 `claimPendingTasks()` 本身。** 会在每次取件时(包括 web worker)静默改写行,重新引入本修复刻意避免的双跑风险。

## Consequences

- 容器重建/崩溃不再让 `ai_tasks` 留下永久「执行中」僵尸:下一个调度器 tick(≤ 60 秒)即重新入队并完成流水线。
- `attempt` 保留,重试历史与失败可观测性完好;执行元数据清空,重跑从干净状态开始。
- web 侧 worker 刻意不参与恢复:web 容器崩溃时,调度器(独立容器)仍能恢复其孤儿;调度器容器自身崩溃时,web worker 继续处理 `PENDING` 任务直到调度器回归。
- 代价:若某任务合法运行超过宽限期(LLM 调用挂起超过 10 分钟,或未来出现运行更久的任务类型),原始执行者可能仍存活时任务就被重新入队——双跑窗口取决于原调用超出阈值多远。以当前任务最长耗时(约 3 分钟)无法触达。
- 验收:`scripts/verify-stale-task-recovery.ts` 覆盖僵尸恢复、阈值内不误伤、`PENDING`/新近 `RUNNING` 行不受扰、可重新认领、以及端到端重跑成功。

## Related

- [background generation execution](../feature/2026-08-24-background-generation.md) 记录了 `generation_jobs`(V5 连载作业)在进程重启后同样停留在 `running` 的已知缺口。本笔记仅覆盖 `ai_tasks`;`generation_jobs` 的清扫仍是待办的后续工作。
