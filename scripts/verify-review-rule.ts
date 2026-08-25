/**
 * V9 评审规则版本化验证:默认规则播种、维度校验(权重和=100)、版本自动递增、
 * 发布后全局唯一生效、published/disabled 不可改、状态转换限制。
 *
 * 运行:npm run test:review-rule
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

process.env.NOVEL_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'novel-review-rule-'));

const {
  CoreError,
  ensureDefaultReviewRule,
  getActiveRuleVersion,
  createReviewRule,
  addRuleVersion,
  updateRuleVersion,
  publishRuleVersion,
  disableRuleVersion,
  getRule,
  getRuleVersion,
  listReviewRules,
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

// ---------- 默认规则播种 ----------
{
  const active = getActiveRuleVersion();
  assertOk(active !== null, '空库读取生效版本时自动播种默认规则');
  const dims = active!.dimensions;
  assertOk(dims.length === 7, '默认规则含七个维度');
  assertOk(
    JSON.stringify(dims.map((d) => `${d.name}:${d.weight}`)) ===
      JSON.stringify([
        '故事完整性:20',
        '情节与冲突:20',
        '人物塑造:15',
        '逻辑合理性:15',
        '情绪感染力:10',
        '语言表达:10',
        '创意与独特性:10',
      ]),
    '默认维度名称与权重符合规格书 §13'
  );
  assertOk(active!.qualityThreshold === 80 && active!.maxAutoOptimizeRounds === 3, '默认阈值 80 / 最大优化 3 轮');
  assertOk(active!.status === 'published' && active!.publishedAt !== null, '默认版本直接发布并带发布时间');
  assertOk(active!.promptId !== null, '默认版本关联播种的评审 Prompt');
}

// ---------- 维度校验 ----------
const rule = createReviewRule({ name: '实验规则', description: '测试用', dimensions: [{ name: 'A', weight: 60 }, { name: 'B', weight: 40 }] });
{
  assertOk(rule.version.status === 'draft' && rule.version.version === 'v1.0', '新建规则首个版本为 draft v1.0');
  await assertThrows('INVALID_RULE_DIMENSIONS', () => addRuleVersion(rule.rule.id, { dimensions: [] }), '空维度 → INVALID_RULE_DIMENSIONS');
  await assertThrows(
    'INVALID_RULE_DIMENSIONS',
    () => addRuleVersion(rule.rule.id, { dimensions: [{ name: 'A', weight: 50 }, { name: 'A', weight: 50 }] }),
    '维度重名 → INVALID_RULE_DIMENSIONS'
  );
  await assertThrows(
    'INVALID_RULE_DIMENSIONS',
    () => addRuleVersion(rule.rule.id, { dimensions: [{ name: 'A', weight: 50 }, { name: 'B', weight: 30 }] }),
    '权重和≠100 → INVALID_RULE_DIMENSIONS'
  );
}

// ---------- 版本递增 / 编辑守卫 / 发布唯一性 ----------
{
  const v2 = addRuleVersion(rule.rule.id, { dimensions: [{ name: 'X', weight: 100 }] });
  assertOk(v2.version === 'v1.1' && v2.status === 'draft', '缺省版本号自动 minor+1');
  const edited = updateRuleVersion(v2.id, { qualityThreshold: 70 });
  assertOk(edited.qualityThreshold === 70, 'draft 版本可编辑阈值');
  await assertThrows('INVALID_INPUT', () => updateRuleVersion(v2.id, { status: 'published' }), 'draft→published 必须走 publish');

  // draft → testing → draft 允许;testing 可编辑
  updateRuleVersion(v2.id, { status: 'testing' });
  assertOk(getRuleVersion(v2.id).status === 'testing', 'draft→testing 转换成功');
  updateRuleVersion(v2.id, { status: 'draft' });

  // 发布 v1.1:成为全局唯一生效,默认规则版本被停用
  const before = getActiveRuleVersion();
  publishRuleVersion(v2.id);
  const after = getActiveRuleVersion();
  assertOk(after?.id === v2.id, '发布后 v1.1 成为生效版本');
  assertOk(before !== null && getRuleVersion(before.id).status === 'disabled', '旧生效版本(默认规则 v1.0)被停用');
  assertOk(listReviewRules().filter((r) => r.versions.some((v) => v.status === 'published')).length === 1, '全局仅一个 published 版本');
  await assertThrows('RULE_VERSION_IMMUTABLE', () => updateRuleVersion(v2.id, { qualityThreshold: 60 }), 'published 版本不可修改');

  // 再建一版并发布,旧版让位;然后停用当前版本
  const v3 = addRuleVersion(rule.rule.id, { dimensions: [{ name: 'Y', weight: 100 }] });
  publishRuleVersion(v3.id);
  assertOk(getActiveRuleVersion()?.id === v3.id, 'v1.2 接棒生效');
  disableRuleVersion(v3.id);
  assertOk(getActiveRuleVersion() === null, '停用唯一生效版本后全局无生效版本');
  await assertThrows('RULE_VERSION_CONFLICT', () => addRuleVersion(rule.rule.id, { version: 'v1.1', dimensions: [{ name: 'Z', weight: 100 }] }), '重复版本号 → RULE_VERSION_CONFLICT');
  await assertThrows('REVIEW_RULE_NOT_FOUND', () => getRule('rrule_nope'), '规则不存在 → REVIEW_RULE_NOT_FOUND');
}

console.log(failed === 0 ? '\n全部通过 ✓' : `\n${failed} 项失败 ✗`);
process.exit(failed === 0 ? 0 : 1);
