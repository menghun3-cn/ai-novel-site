# Agent Note: Production line cards surface key config; editor moves to a drawer

Status: implemented

English | [中文](2026-09-03-production-line-card-and-drawer-editor.zh.md)

## Problem

The production-line (产线) tab of the creation center hid the information
operators care about most behind the edit dialog. Cards showed only the name,
description, genre chips, and four aggregate stats (今日 / 达标 / 发布 /
通过率). The execution schedule (每日 HH:00 or 手动) was rendered **only while
a line had never run**: once `lastRunAt` existed, the footer replaced the
schedule with `上次 X`, so an operator could not see the cadence without
opening the editor. Quota (单次 / 每日上限 / 预算) and quality gate (达标线 /
自动发布) were visible only inside the editor. The editor itself was a
512px-centered modal (`max-w-lg`) holding five configuration sections
(调度 / 配额 / 质量闸门 / 创作基线 / 题材清单) — dense and cramped.

## Decision

Redesigned the line card and moved editing into a right-side drawer
(`web/app/admin/(dash)/creation/page.tsx`).

The card now surfaces, without opening the editor:

- A 执行配置 strip (light-gray block) showing schedule (每日 HH:00 /
  手动触发) and 每批 N 篇, plus conditional chips for 单次上限, 每日上限,
  预算 $/日, 达标线, and 自动发布 when configured.
- An 启用 / 停用 badge and the most recent run status badge (shared
  `RunStatus`) next to the title.
- A footer with the last-run relative time plus the run title
  (触发方式 · 篇数), or 尚未运行 when no run exists.

Editing (`LineEditorDrawer`) uses the shared `Drawer` component — right
slide-out, up to 720px wide, full height — instead of `Modal` (512px). Form
sections changed from gray `bg-[#f8fafc]` blocks to white bordered cards for
contrast on the drawer's gray background; the drawer header carries an
启用 / 停用 badge via `headerExtra`. Save / cancel stay pinned in the footer.
The 运行 and 删除 confirmations remain modals (`Modal` / `ConfirmDialog`).

## Alternatives considered

**Keep the editor in a wider modal.** A centered modal at, say, `max-w-3xl`
would also gain width, but it covers the line list and breaks spatial
continuity. The drawer keeps the list visible beside the editor and matches
the existing "列表 → 详情/编辑" secondary-panel pattern already established by
the codebase's `Drawer` (used for 作品详情). Short confirmations keep the
modal form.

**Show the schedule only when the line has never run.** That was the bug being
fixed: the schedule vanished once a run existed. Surfacing schedule, batch
size, quota, and gate on the card unconditionally — with chips appearing only
for configured values — is the entire point of the change.

## Consequences

- Operators see cadence, batch size, limits, budget, and gate threshold
  without opening the editor, and the last-run status is visible at a glance.
- The editor is roughly 40% wider and full-height, so the five-section form no
  longer fights a 512px × 85vh modal.
- Modal remains for 运行产线 and 删除产线 confirmations; the drawer is for
  editing only.
- Cards grow slightly taller; the `lg` two-column grid still holds.
