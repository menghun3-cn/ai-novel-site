# Agent Note: AI serialization workbench UI

Status: implemented

English | [中文](2026-08-24-ai-serial-ui.md)

## Problem

The V5 core and endpoints existed but had no operator surface: enabling
serialization meant curl-ing four endpoints by hand, batch bootstrap had no
button, job outcomes were invisible without SQL, and the roadmap's 人工确认
step had no visible switch.

## Decision

One new card appended to the AI 创作中心 (`/admin/story`), reusing the
page's white-card shell language (h-14 gradient header `#0ea5e9→#2563eb`,
p-5 body, ui.tsx primitives):

- **Config row** — 状态 Select (启用/停用), 每日时刻 (0-23), 每日生成章数
  (1-20), 发布模式 Select (送审核队列/自动发布), 质检字数下限; a single
  保存连载配置 primary action PUTs the whole patch. The header carries a
  live 已启用/未启用 badge so state is readable at a glance.
- **Actions row** — 批量生成入队 (count input 1-50 → POST enqueue) and
  立即处理队列 (POST run; disabled when no pending jobs exist). After run:
  dispatches `admin:review-changed` so the sidebar review counter updates,
  reloads the story bundle (chapter max moves), and refreshes the jobs
  table filtered to the current book.
- **Jobs table** — newest 10 with status Badge mapping
  (published→已发布/success, submitted→待审核/info, rejected→质检拒绝/
  warning, failed→失败/danger, pending|running→排队中|执行中/running),
  chapter number, chars, resolved model, time, truncated error (full text
  on title hover); empty state guides to the actions above.

Loading strategy: config + jobs load in parallel per book switch; all
mutations are guarded by one `serialBusy` lock so double-clicks can't
double-enqueue.

Verification: CDP audit **11/11** in a clean single pass against a fresh
DB (seeded book + seeded LLM settings pointing at a local mock upstream,
server process carrying **no AI_\* env vars**): card renders with 未启用
badge → config save flips badge and persists across reload → batch-enqueue
2 shows the queued notice → 立即处理队列 processes both through discovery +
generation + QC into two 待审核 rows → 375px viewport has zero page
overflow with the table scrolling inside its own container. typecheck and
production build green.

## Alternatives considered

**Dedicated /admin/serial page.** Rejected: serialization is per-book work
that belongs beside Story Core facts and the manual generation workbench;
a separate page would force book re-selection and split one mental model.

**Toggle switch component for 启用.** ui.tsx has no Switch primitive;
introducing one for a single boolean would add surface without reuse —
Select matches the existing 发布模式 control and keeps the form uniform.

**Auto-run right after enqueue.** Deliberately not wired: enqueue is intent,
run is execution; keeping them separate lets an operator stage a large
batch, review pending counts, then drain once — same semantics as the
nightly cycle.

## Consequences

Gained: the full §8 loop is operable from the console — enable, stage a
batch, drain now or let the scheduler do it overnight, watch outcomes in
one table. Costs: the jobs table caps at 10 rows for the current book
(history beyond that lives behind the API); error column truncates long
provider messages (hover reveals them) — acceptable until a detail drawer
is warranted.
