# Git Hooks(仓库内共享)

Agent Note 门禁通过**本地 pre-push hook** 强制,不需要 CI / GitHub Actions。
钩子文件随仓库分发(放在 `.githooks/`,通过 `core.hooksPath` 激活,不写入
`.git/hooks`)。

## 包含的 hook

- `pre-push` — 推送前运行 `scripts/hooks/verify-push-notes.mjs`:
  1. **master 直推守卫**:local ref 为 `refs/heads/master` 且 SHA 不同于远端的
     push 直接拒绝(提示走 develop → master PR)。权威强制是 GitHub 分支保护,
     本地守卫只为快速失败。
  2. **Agent Note 覆盖检查**:push 的 diff 含非平凡改动(代码/配置/脚本)时,
     同一 push 必须至少变更一个 `.agents/notes/{proposed,implemented,rejected}/`
     文件(对应 `.agents/notes/README.md` 的 "same PR" 规则)。
     纯文档(`*.md`)、package.json 版本行、锁文件、notes 自身不算非平凡。
  3. **doc-sync**:分类 + 格式 + 归档完整性三闸全绿。

## 激活(clone 后任选其一)

```bash
# 方式一:install 自动激活(package.json 的 prepare 脚本执行 git config)
pnpm install

# 方式二:手动
git config core.hooksPath .githooks

# 验证
git config core.hooksPath   # 应输出 .githooks
```

## 限制与逃生门

- 本地钩子**拦不住**未激活钩子的人或 `git push --no-verify`;它是兜底 +
  团队约定,不是堡垒。若未来需要真正不可绕过的门禁,需 GitHub Actions
  (status check)或 GitHub Enterprise 的 pre-receive hook。
- `git push --no-verify` 可跳过本门禁(不推荐)。
