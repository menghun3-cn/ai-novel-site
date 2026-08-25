# Agent Note: Agent Notes tree and gates adoption

Status: implemented

English | [中文](2026-08-23-agent-notes-gates-adoption.md)

## Problem

从 V2 迭代开始，本仓库将围绕多里程碑路线图（`docs/AI原创内容创作平台.md`）由
AI agent 进行多轮长期开发。代码、提交信息与普通文档无法承载非平凡变更背后的
*为什么*与*被放弃的备选方案*；没有它们的持久存放处，决策依据只会留在聊天记录里，
每一轮新开发都要重新争论一遍早已定下的事情。项目同时需要机械可查的保证：
这类记录始终格式正确、分类正确、双语一致，且不会被悄悄改写。

## Decision

决策记录以 **Agent Note** 的形式存放在 `.agents/notes/`——由
[.agents/notes/README.md](../../../.agents/notes/README.md) 规范的 RFC 式记录。
每个非平凡变更必须在同一个 PR 中新增或更新至少一份 Agent Note。笔记在
`proposed/`、`implemented/`、`rejected/` 之间随生命周期移动；完全退役的
implemented 笔记冻结到 `archived/`。

三门禁负责强制执行该标准，并已接入 package.json：

- `npm run verify-agent-note-format`（`scripts/verify-agent-note-format.ts`）——
  头部语法（`# Agent Note: <title>` / 空行 / `Status: <status>` / 空行）、
  各生命周期必需章节、强制的 `## Alternatives considered`，以及禁止在
  implemented 笔记中出现提案期标题。
- `npm run verify-agent-note-classification`
  （`scripts/verify-agent-note-classification.ts`）——封闭的生命周期/类别
  文件夹集合与带日期文件名，经由共享遍历器 `scripts/agent-note-tree.ts`。
- `npm run verify-archived-agent-notes`
  （`scripts/verify-archived-agent-notes.ts`，辅助模块
  `scripts/archived-agent-notes.ts` 及 `archived-agent-notes.spec.ts`）——
  校验并对冻结的 `archived/` manifest 做仅追加封存。

`npm run check:notes` 按顺序运行全部门禁。

每份笔记是一个三件套：英文 `.md`、结构逐章节一致的中文 `.zh.md`
（头部机器检查标记保持英文），以及记录双方 git blob hash 的
`.i18n.yaml` 伴随记录（以上次确认一致时的状态为准）。

## Alternatives considered

**`docs/` 下的自由格式 RFC。**没有机械门禁，结构与生命周期几周内就会腐烂；
因为可强制性正是核心诉求，故被否决。

**集中式 INDEX.md / ADR 表格。**Agent Note 规则明令禁止：索引会复制状态，
并与所列文件漂移；浏览应通过生命周期/类别目录树与仓库搜索完成。

**只靠 git 历史充当决策记录。**git 记录的是*改了什么*，而不是权衡过哪些
备选方案、或重新引入的条件；聊天记录不持久、也无法在仓库内评审。

## Consequences

收益：决策依据、备选方案与验证要求能够跨越多轮 agent 开发留存；
取代与归档变为机器可查而非尽力而为。代价：每个非平凡 PR 都背负文档成本——
每份笔记两种语言版本加一份 hash 记录——这是真实但有边界的开销，
远小于反复重建丢失决策的成本。
