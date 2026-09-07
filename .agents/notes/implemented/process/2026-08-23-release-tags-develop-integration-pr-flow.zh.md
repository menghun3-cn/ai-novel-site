# Agent Note: Release tags, develop integration, and PR-per-change flow

Status: implemented

English | [中文](2026-08-23-release-tags-develop-integration-pr-flow.md)

## Problem

V1 已完成并打标，但路线图（`docs/AI原创内容创作平台.md`）还定义了大量后续
里程碑（V2 内容管理、V3 发布系统、V4 Story Core + AI Writer……），每个里程碑
都包含多个可独立评审的变更。直接在 `master` 上开发会把整个里程碑糊成一条
无法评审的提交线，里程碑边界没有回滚点，agent 各轮开发还会把互不相关的特性
耦合在一起。在第一个 V2 变更落地之前，仓库需要一套明确的分支与合并纪律。

## Decision

开发流程是一条三步流水线:

1. **从 `develop` 切分支。** 每一个开发项——特性、修复或杂务——都在从
   `develop` 切出的独立分支(`feat|fix|chore/<topic>`)上进行;禁止向
   `master` 或 `develop` 直接提交工作提交。
2. **向 `develop` 提 PR。** 每个分支只能通过针对 `develop` 的编号 PR
   (`gh pr create --base develop`)落地,并以 `gh pr merge --merge` 合并,
   由 GitHub 记录可评审的 PR 与合并提交。分支推送到 `origin`;自 `gh` CLI
   (v2.98.0)可用后——通过 `GH_PAT` 环境变量映射为 `GH_TOKEN` 完成认证。
   PR #1–#2 早于 gh 可用,当时以本地 `--no-ff` 合并落地——拓扑上与
   GitHub 合并提交等价。
3. **从 `develop` 向 `master` 提 PR。** `develop` 是当前里程碑的常设集成
   分支;通过专门的 PR(`gh pr create --base master --head develop`)以
   `--merge` 合并提升到发布线 `master`,每次发布合并都打注解标签
   `vN.M.0`。`v1.0.0` 标记已完成的 V1 内容基线(MD/TXT 导入、Content
   Core、Web Publisher、RSS、SEO)。

## Alternatives considered

**GitHub flow（所有 PR 直入 `master`）。**现阶段落选：里程碑级的工作需要
一个可见的集成点让 V2 各特性先汇聚再发布合并；若每个特性都直入发布线，
里程碑边界处「打不打标签」就会变得含混。

**继续直接提交 `master`。**落选：没有 `v1.0.0` 式的干净回滚点，没有逐变更
的评审与回滚边界，不相关的 agent 轮次还会在同一里程碑内互相穿插。

## Consequences

收益：`v1.0.0` 永久标识 V1 基线；每个变更是带 PR 编号、独立可回滚的合并；
里程碑完成成为显式、可打标的事件（`develop` → `master` → `v2.0.0`）。
代价：每个变更多一次合并提交与分支开销，两次发布之间 `develop` 会与
`master` 分叉——以本项目变更量而言可以接受，发布合并就是显式的对账点。
