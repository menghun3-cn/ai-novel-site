/**
 * V9 评审 Prompt 版本化验证:自动版本号递增、同名迭代、历史版本不可覆盖、关联规则守卫。
 *
 * 运行:npm run test:review-prompt
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

process.env.NOVEL_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'novel-review-prompt-'));

const {
  CoreError,
  createReviewPromptVersion,
  getReviewPrompt,
  listReviewPrompts,
  groupReviewPromptsByName,
} = await import('@novel/core');

let failed = 0;

function assertOk(cond: boolean, name: string): void {
  if (cond) {
    console.log(`✓ ${name}`);
  } else {
    console.error(`✗ ${name}`);
    failed++;
  }
}

async function assertThrows(code: string, fn: () => unknown | Promise<unknown>, name: string): Promise<void> {
  try {
    await fn();
    assertOk(false, `${name}(未抛错)`);
  } catch (err) {
    assertOk(err instanceof CoreError && err.code === code, name);
  }
}

{
  const p1 = createReviewPromptVersion({ name: '短篇评审', content: '第一版评审指令', changeNote: '初始' });
  assertOk(p1.version === 'v1.0' && p1.id.startsWith('rprompt_'), '首个版本 v1.0');

  const p2 = createReviewPromptVersion({ name: '短篇评审', content: '第二版评审指令(更严格)', changeNote: '收紧分档' });
  assertOk(p2.version === 'v1.1', '同名迭代自动 minor+1');

  const p3 = createReviewPromptVersion({ name: '短篇评审', content: '大改版', version: 'v2.0', changeNote: '结构重写' });
  assertOk(p3.version === 'v2.0', '显式指定版本号生效');
  await assertThrows(
    'RULE_VERSION_CONFLICT',
    () => createReviewPromptVersion({ name: '短篇评审', content: '撞号', version: 'v2.0' }),
    '重复版本号 → RULE_VERSION_CONFLICT'
  );

  // 历史版本内容不被覆盖:v1 内容保持原样
  assertOk(getReviewPrompt(p1.id).content === '第一版评审指令', '旧版本内容原样保留');

  const grouped = groupReviewPromptsByName();
  const shortGroup = grouped.find((g) => g.name === '短篇评审');
  assertOk(shortGroup?.versions.length === 3 && shortGroup.versions[0].id === p3.id, '按名称分组且组内最新在前');

  await assertThrows('INVALID_INPUT', () => createReviewPromptVersion({ name: '', content: 'x' }), '空名称 → INVALID_INPUT');
  await assertThrows('INVALID_INPUT', () => createReviewPromptVersion({ name: 'x', content: '  ' }), '空内容 → INVALID_INPUT');
  await assertThrows('REVIEW_RULE_NOT_FOUND', () => createReviewPromptVersion({ name: 'y', content: 'c', ruleVersionId: 'rrulev_nope' }), '关联不存在的规则版本 → REVIEW_RULE_NOT_FOUND');

  assertOk(listReviewPrompts('短篇评审').length === 3, '按名称过滤列表');
}

console.log(failed === 0 ? '\n全部通过 ✓' : `\n${failed} 项失败 ✗`);
process.exit(failed === 0 ? 0 : 1);
