# Agent Note: Pre-push Agent Note gate (local enforcement without CI)

Status: implemented

English | [中文](2026-09-03-pre-push-agent-notes-gate.md)

## Problem

Agent Notes 规则(`.agents/notes/README.md` § When to write one)要求每个非平凡改动
在同一 PR 中新增或更新至少一条笔记,但仓库**没有任何机械强制**。`doc-sync`
门禁(`verify-agent-note-{classification,format}` 与 `verify-archived-agent-notes`)
只校验已存在的笔记——当某次改动本应携带笔记却没有时,它们永远不会失败。仓库没有
git hooks、没有 CI workflow,且 GitHub Actions 被明确推迟,于是规则只是纸面约定:
只有 agent 或评审人碰巧在提交前读了 README 才会生效。v8.2.1 产线 UI 改动未经笔记
就发布(事后在 #103/#104 补记),正是这个缺口的表现。

## Decision

新增**共享本地 pre-push hook**,机械地强制规则的两个半边:

- `.githooks/pre-push` — 薄 `sh` 壳;hooks 存放在仓库内 `.githooks/` 目录,
  通过 `core.hooksPath` 按克隆激活(由根 `package.json` 的 `prepare` 脚本自动
  设置:`git config core.hooksPath .githooks`)。
- `scripts/hooks/verify-push-notes.mjs` — 零依赖 Node 门禁:
  1. 读取 pre-push stdin 的 ref 行(`<local ref> <local sha> <remote ref>
     <remote sha>`),跳过删除分支与 tag,用 `git diff --numstat <base> <local>`
     计算变更文件集(base = 远端 SHA;新分支退化为与 `origin/master` 的
     `merge-base`)。增删行为 `0 0` 的行——纯文件模式改动(chmod)——被剔除:
     它们不携带内容,不应强制笔记。
  2. 把文件分为平凡与非平凡:`*.md`(文档)、`package.json`/锁文件/`.gitignore`
     等判为平凡;笔记自身(`.agents/notes/{proposed,implemented,rejected}/`)
     视为"携带了笔记"。其余文件(代码、配置、脚本)均为非平凡。
  3. 若存在非平凡文件但同一 push 没有任何笔记文件变更,打印违规文件清单并
     exit 1——**阻止本次 push**。
  4. 否则运行 `pnpm run doc-sync`,笔记树未全绿同样阻止 push。

## Alternatives considered

**用 GitHub Actions workflow 做 status check。** 这是普通 GitHub 上唯一真正
服务端、不可绕过的方案,也是长期答案——但被团队明确推迟。pre-push 在此之前
充当本地兜底。

**服务端 `pre-receive` hook。** github.com 托管不提供(需要 GitHub Enterprise),
因此否决。

**把 hooks 复制进 `.git/hooks`。** 只对一个检出有效,不会随 clone 分发;
`core.hooksPath` 指向受版本控制的 `.githooks/` 目录才能把门禁随仓库分发。

**Husky / lint-staged。** 为一个小型 Node 脚本加 sh 壳就能完成的事引入依赖与
配置面,过度工具化,否决。

## Consequences

- 每个运行过 `pnpm install`(或手动设置过 `core.hooksPath`)的贡献者,在非平凡
  改动缺笔记、或笔记树 `doc-sync` 未全绿时都会在 push 时被拦截——规则现在会
  机械地触发。
- 门禁是**本地且可绕过的**:未激活 hooks 的克隆或 `git push --no-verify` 可以
  绕过。它是团队约定的兜底,不是堡垒;README 明确记录了这一限制。
- 非平凡判定刻意粗糙(任何非文档、非 package.json 文件都算)。`package.json`
  内的依赖升级即使非平凡也不会强制笔记;对 v1 可接受,门禁偏向不阻塞常规 push。
- push 延迟增加 `doc-sync` 的运行时间(约几秒)。
