# Agent Note: Continuous production lines — backpressure-driven creation with a circuit breaker

Status: implemented

English | [中文](2026-09-03-continuous-production-line.md)

## Problem

V10 产线(production line)原本只有 `manual` / `daily` 两种调度。想让平台
**持续创作、永不停止**——每篇走完整流水线(生成 → 评审 → 自动优化 → 发布/入池)
并自动发布——没有现成机制:`daily` 每天只触发一次且同日去重;失控的成本与反复失败
也没有兜底。同时没有内置随机题材池(kinds 必须显式配置),唯一的停止门禁是手动
`enabled=false`。

## Decision

在既有产线(`core/src/production-line.ts`)上扩展 `continuous` 调度模式,不新建实体。
三个机制一起落地:

1. **背压驱动的无间隙生产(不设时间间隔)。** `continuous` 产线由调度器每个 tick
   (`PUBLISH_TICK_SECONDS`,默认 60s,下限 5s)通过
   `listDueContinuousProductionLines()` / `fireDueContinuousProductionRuns()`
   检查。满足 `enabled=1`、未熔断、且"在飞"短篇数低于 `max(2, count*2)` 时触发。
   在飞数**包含 `draft` 状态**——短篇从创建到 worker 领取其 `CREATE_NOVEL` 任务
   之前一直是 `draft`,若不统计,调度器会以远超 worker 消费速度的速度无限入队。
   显式拒绝 `intervalSeconds` 配置让设计保持诚实:任何固定间隔都会人为制造生产
   间隙,与"无间隙生产"目标矛盾。
2. **停止门禁:人工暂停 OR 连续失败熔断。** `production_lines` 新增
   `consecutive_failures`、`max_consecutive_failures`(默认 3,可配 1..20)、
   `tripped_reason`、`tripped_at`。失败按**轮**计数:`runProductionLine` 抛错则
   +1,成功一轮清零;达到阈值自动停线并记录原因/时间;`resumeProductionLine`
   重新启用并清零(幂等)。手动暂停走 `enabled=false`,不动计数。
   `isLineTripped()` 供前端徽标判断。每日配额(`dailyLimit` / `dailyBudgetUsd`)
   对 `continuous` 同样生效,作为软上限。
3. **内置随机题材池(`DEFAULT_KINDS`)。** 10 种题材 × 每种 3 个种子主题。未配置
   `kinds` 的 `continuous` 产线注入该池(默认即随机);显式配置仍优先。每轮运行前
   对题材顺序 shuffle 并对权重做 ±20% 抖动(下限 1),避免连续多轮产出同一批题材。
   `manual` / `daily` 仍拒绝空题材(向后兼容)。

观测面在 `production-ops.ts` 扩展:总览 lanes 与 `getProductionLinesWithMeta()`
为持续产线返回 `inFlight` / `backpressureThreshold`;运营中心新增 `tripped_line`
告警与带 `resume_line` 动作的熔断异常项。管理端 UI(创作中心)新增持续模式表单
(模式、每轮篇数 1..10、熔断阈值、未配每日上限/预算时的二次确认)、持续/已熔断
徽标、恢复动作,以及总览的「持续创作」状态卡。

## Alternatives considered

**新建独立实体。** 单独的 `continuous_creation_tasks` 表语义更清晰,但会重复产线
机制(kinds、配额、质量闸门、运行记录、运营聚合)并分裂维护。扩展既有产线可免费
复用 `runProductionLine`、`ai_tasks`、发布物化与 production-ops。

**固定间隔(如每 30s)。** 一轮 `count` 篇耗时分钟级(LLM 生成 + 评审 + 可能的
优化),固定间隔要么无限堆积队列、要么空转。背压——只在在飞数降到阈值以下时
触发——才是真正的无间隙生产,节奏自然跟随消费速度。

## Consequences

- 持续产线在手动暂停或熔断之前无人值守运行;调度器 tick 即触发粒度,重启安全
  (重启后恢复 due 检查即续跑)。
- `production_runs.trigger` 新增 `'continuous'`;运行记录保留完整审计轨迹
  (错误落在 run 上,也留在 `ai_tasks`)。
- 成本只有在配置了 `dailyLimit` / `dailyBudgetUsd` 时才受控;两者都未配置时 UI
  弹二次确认——无限生产意味着无限花费。
- 熔断按轮级抛错计数;一轮内创建成功但篇篇评审失败不会触发熔断——这是已知缺口,
  有意延后(见方案文档 §8)。
- 由 `scripts/verify-continuous-production-line.ts` 验证(连跑多轮、背压、熔断→
  恢复、随机池、运营聚合);`scripts/verify-production-line.ts` 无回归。
