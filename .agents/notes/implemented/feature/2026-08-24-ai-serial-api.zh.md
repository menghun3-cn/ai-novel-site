# Agent Note: AI 连载管理端点

Status: implemented

English | [中文](2026-08-24-ai-serial-api.md)

## Problem

V5 核心(配置表/任务队列/每日周期)落地时没有 HTTP 面:运营者控制台既不能
查看/修改每书连载配置,也不能批量入队「AI 生成前 N 章」、手动清空队列或浏
览任务历史。调度器是唯一的执行者。

## Decision

四组路由,全部走 `withAdmin`:

- `GET/PUT /api/admin/books/[id]/ai-serialization`——按书的配置。GET 对未
  配置的书返回虚拟默认值;PUT 接受部分补丁(`enabled/hour/count/autoPublish/
  minChars`),zod 边界与服务层规则一致。动态路由上下文用显式
  `{ params: Promise<{ id }> }` 形状(Next 15)。
- `POST /api/admin/ai/serial/enqueue`——`{bookId, count≤50}`;返回创建的
  pending 任务。执行刻意**不内联**:真实 LLM 批量会超出请求预算,入队只记
  录意图。
- `POST /api/admin/ai/serial/run`——`{limit?}` 清空至多 N 个 pending 任务,
  走与调度器相同的执行器,并返回最新任务列表,让 UI 一次往返即可刷新。
- `GET /api/admin/ai/serial/jobs?bookId=&limit=`——最新在前的历史,可按书过滤。

验证:`npm run test:ai-serial-api`(14 项断言)对本地 mock OpenAI 上游直调
真实路由处理器:默认与已存配置、zod 边界拒绝且响应体带错误码、每个动词都要
鉴权、批量入队数量、手动处理在 autoPublish 下把两任务推到 published 且章号
从 1 连续、按书过滤列表。typecheck 与生产构建绿。

## Alternatives considered

**POST /enqueue 内联生成。**落选:20 章批量打真实网关要跑几分钟,会死在代
理超时上;把意图(入队)与执行(run/调度器)分开让请求保持轻快。

**一个通用 /jobs 变更端点加 action 枚举。**否决:三个窄动词自带文档且与
UI 按钮一一对应;switch-on-action 处理器会长成小 DSL。

## Consequences

收益:运营者从控制台完全掌控 V5 闭环,含一个与夜间周期同语义的手动「立即
处理」。代价:`POST /serial/run` 是同步的,耗时随任务量走(limit≤100 封顶);
任务还是串行时可接受,将来引入并发后这里应改成 202 + 轮询模式。
