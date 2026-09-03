#!/usr/bin/env node
/**
 * pre-push 门禁:Agent Note 覆盖检查 + doc-sync 全绿。
 *
 * 规则(.agents/notes/README.md § When to write one):
 *   Every non-trivial change MUST add or update at least one Agent Note in the same PR.
 *
 * 机械近似:
 *   本次 push 变更的非平凡文件(代码/配置/脚本)非空时,同一 push 必须至少
 *   变更一个 .agents/notes/{proposed,implemented,rejected}/ 下的文件。
 *   纯文档(*.md)、package.json 版本行、锁文件、notes 自身不算非平凡。
 *
 * 由 .githooks/pre-push 调用;也可手动跑:
 *   printf 'refs/heads/x <sha> refs/heads/x <base>\n' | node scripts/hooks/verify-push-notes.mjs
 */

import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

const root = process.cwd();

function git(args) {
  const r = spawnSync('git', args, { cwd: root, encoding: 'utf8' });
  if (r.status !== 0) throw new Error(`git ${args.join(' ')} failed: ${r.stderr}`);
  return r.stdout.trim();
}

/** 非平凡文件的判定(路径相对仓库根)。 */
function isNonTrivial(p) {
  if (/\.md$/i.test(p)) return false; // 文档(含 CHANGELOG/README/docs)
  if (/(^|\/)(package\.json|package-lock\.json|pnpm-lock\.yaml|.*\.lock|\.gitattributes|\.gitignore|\.dockerignore)$/.test(p)) return false;
  return true;
}

const NOTE_DIR_RE = /^\.agents\/notes\/(proposed|implemented|rejected)\//;

// pre-push stdin:每行 "<local ref> <local sha> <remote ref> <remote sha>"
const stdin = readFileSync(0, 'utf8');
const refs = stdin.split('\n').filter(Boolean).map((l) => l.trim().split(/\s+/));

let checkedAny = false;

for (const [localRef, localSha, , remoteSha] of refs) {
  if (/^0+$/.test(localSha)) continue; // 删除分支
  if (localRef.startsWith('refs/tags/')) continue; // tag 推送不要求笔记
  checkedAny = true;

  let base = remoteSha;
  if (!base || /^0+$/.test(base)) {
    // 新分支:以与默认分支的 merge-base 为基线
    try {
      base = git(['merge-base', localSha, 'origin/master']);
    } catch {
      process.stderr.write(`[notes-gate] 无法确定 ${localRef} 的基线,跳过该 ref。\n`);
      continue;
    }
  }

  let changed = [];
  try {
    // --numstat 区分纯文件模式改动(chmod, 0 0)与内容改动:
    // 模式改动判平凡,不给 chmod 强加笔记;仅收集有增删行的文件。
    changed = git(['diff', '--numstat', base, localSha])
      .split('\n')
      .filter(Boolean)
      .map((l) => l.split('\t'))
      .filter(([a, d]) => !(a === '0' && d === '0'))
      .map((p) => p[p.length - 1]);
  } catch {
    continue;
  }

  const nonTrivial = changed.filter(isNonTrivial);
  const hasNote = changed.some((p) => NOTE_DIR_RE.test(p));

  if (nonTrivial.length > 0 && !hasNote) {
    process.stderr.write(
      `[notes-gate] 拦截:push 包含非平凡改动但没有 Agent Note。\n` +
        `  非平凡文件:\n` +
        nonTrivial.map((p) => `    - ${p}`).join('\n') +
        `\n  修复:.agents/notes/README.md —— 非平凡改动必须同 PR 新增或更新笔记\n` +
        `        (implemented/{class}/yyyy-mm-dd-topic.{md,zh.md,i18n.yaml}),\n` +
        `        或确认本次改动确实平凡后用 git push --no-verify 逃生。\n`
    );
    process.exit(1);
  }
}

if (!checkedAny) process.exit(0);

// 笔记树全绿:分类 + 格式 + 归档完整性
const pnpm = process.platform === 'win32' ? 'pnpm.cmd' : 'pnpm';
const sync = spawnSync(pnpm, ['run', 'doc-sync'], {
  cwd: root,
  stdio: 'inherit',
  shell: process.platform === 'win32',
});
if (sync.status !== 0) {
  process.stderr.write('[notes-gate] doc-sync 未通过,拒绝 push。\n');
  process.exit(1);
}

process.stderr.write('[notes-gate] 通过:非平凡改动已携带 Agent Note,doc-sync 全绿。\n');
process.exit(0);
