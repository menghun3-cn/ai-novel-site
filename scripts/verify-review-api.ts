/**
 * V9 评审中心 API 回归:规则版本化(发布唯一生效/不可变守卫)、Prompt 版本化、
 * 评审记录查询与 404、质量统计形状。不依赖 LLM。
 *
 * 运行:npm run test:review-api
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

process.env.NOVEL_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'novel-review-api-'));
process.env.ADMIN_TOKEN = 't';

let failed = 0;
function assertOk(cond: boolean, name: string): void {
  if (cond) {
    console.log(`✓ ${name}`);
  } else {
    console.error(`✗ ${name}`);
    failed++;
  }
}

const DIMS_A = [{ name: '维度甲', weight: 60 }, { name: '维度乙', weight: 40 }];
const H = { 'content-type': 'application/json', 'x-admin-token': 't' };
function req(path: string, init?: RequestInit): Request {
  return new Request(`http://localhost${path}`, { headers: H, ...init });
}

async function main(): Promise<void> {
  const { getActiveRuleVersion, createShortStory, appendVersion } = await import('@novel/core');
  const defaultRuleVersion = getActiveRuleVersion(); // 触发默认规则播种并留作后续显式回放
  assertOk(defaultRuleVersion !== null, '默认规则播种就绪');

  const rulesRoute = await import('../web/app/api/admin/review-rules/route');
  const versionsRoute = await import('../web/app/api/admin/review-rules/[id]/versions/route');
  const rvRoute = await import('../web/app/api/admin/review-rule-versions/[vid]/route');
  const publishRoute = await import('../web/app/api/admin/review-rule-versions/[vid]/publish/route');

  // 规则列表含默认播种
  {
    const res = await rulesRoute.GET(req('/api/admin/review-rules'), undefined as never);
    assertOk(res.status === 200, 'GET 规则列表 → 200');
    const body = (await res.json()) as { rules: Array<{ rule: { name: string }; versions: unknown[] }> };
    assertOk(body.rules.some((r) => r.rule.name === '短篇小说评审标准'), '默认规则已播种可见');
  }

  // 新建规则 → 追加版本 → 编辑 draft → 发布唯一生效
  const created = await rulesRoute.POST(req('/api/admin/review-rules', {
    method: 'POST',
    body: JSON.stringify({ name: '实验规则', dimensions: DIMS_A }),
  }), undefined as never);
  assertOk(created.status === 201, 'POST 规则 → 201(draft)');
  const { version: v1, rule } = (await created.json()) as { version: { id: string }; rule: { id: string } };

  const badDims = await rulesRoute.POST(req('/api/admin/review-rules', {
    method: 'POST',
    body: JSON.stringify({ name: '坏权重', dimensions: [{ name: 'A', weight: 50 }] }),
  }), undefined as never);
  assertOk(badDims.status === 400 && (await badDims.json()).error === 'INVALID_RULE_DIMENSIONS', '权重和≠100 → 400 INVALID_RULE_DIMENSIONS');

  const v2Res = await versionsRoute.POST(req(`/api/admin/review-rules/${rule.id}/versions`, {
    method: 'POST',
    body: JSON.stringify({ dimensions: [{ name: 'X', weight: 100 }], qualityThreshold: 75 }),
  }), { params: Promise.resolve({ id: rule.id }) } as never);
  assertOk(v2Res.status === 201, '追加版本 → 201');
  const { version: v2 } = (await v2Res.json()) as { version: { id: string; version: string } };
  assertOk(v2.version === 'v1.1', '版本号自动 minor+1');

  const putDraft = await rvRoute.PUT(req(`/api/admin/review-rule-versions/${v2.id}`, {
    method: 'PUT',
    body: JSON.stringify({ qualityThreshold: 70 }),
  }), { params: Promise.resolve({ vid: v2.id }) } as never);
  assertOk(putDraft.status === 200, 'draft 版本可编辑');

  // 发布 v1.0(默认规则当前生效)→ 再发布 v1.1 抢占
  await publishRoute.POST(req(`/api/admin/review-rule-versions/${v1.id}/publish`, { method: 'POST' }), { params: Promise.resolve({ vid: v1.id }) } as never);
  await publishRoute.POST(req(`/api/admin/review-rule-versions/${v2.id}/publish`, { method: 'POST' }), { params: Promise.resolve({ vid: v2.id }) } as never);
  const active = getActiveRuleVersion();
  assertOk(active?.id === v2.id, '发布后 v1.1 为全局唯一生效');

  const immutable = await rvRoute.PUT(req(`/api/admin/review-rule-versions/${v2.id}`, {
    method: 'PUT',
    body: JSON.stringify({ qualityThreshold: 60 }),
  }), { params: Promise.resolve({ vid: v2.id }) } as never);
  assertOk(immutable.status === 409, 'published 版本编辑 → 409 RULE_VERSION_IMMUTABLE');

  // Prompt 版本化
  {
    const promptsRoute = await import('../web/app/api/admin/review-prompts/route');
    const p1 = await promptsRoute.POST(req('/api/admin/review-prompts', {
      method: 'POST',
      body: JSON.stringify({ name: '短篇评审B', content: '第一版', changeNote: 'init' }),
    }), undefined as never);
    assertOk(p1.status === 201, 'POST Prompt → 201');
    const dup = await promptsRoute.POST(req('/api/admin/review-prompts', {
      method: 'POST',
      body: JSON.stringify({ name: '短篇评审B', content: '撞号', version: 'v1.0' }),
    }), undefined as never);
    assertOk(dup.status === 409, '重复 Prompt 版本号 → 409');
    const list = await promptsRoute.GET(req('/api/admin/review-prompts?grouped=1'), undefined as never);
    const groups = (await list.json()) as { groups: Array<{ name: string }> };
    assertOk(groups.groups.some((g) => g.name === '短篇评审B'), '分组列表含新名称');
  }

  // 评审记录:空列表 + 未知详情 404
  {
    const recordsRoute = await import('../web/app/api/admin/review-records/route');
    const detailRoute = await import('../web/app/api/admin/review-records/[id]/route');
    const empty = await recordsRoute.GET(req('/api/admin/review-records'), undefined as never);
    assertOk(empty.status === 200 && ((await empty.json()).records as unknown[]).length === 0, '记录空列表 → 200');
    const missing = await detailRoute.GET(req('/api/admin/review-records/rrec_nope'), { params: Promise.resolve({ id: 'rrec_nope' }) } as never);
    assertOk(missing.status === 404, '未知记录 → 404');
  }

  // 质量统计:造一条真实记录后形状正确(用引擎直调避免 HTTP 层 LLM)
  {
    const story = createShortStory({ title: '统计样本' });
    const v = appendVersion(story.id, { content: 'x'.repeat(600), creationReason: 'generated' });
    const fake = {
      name: 'fake',
      complete: async () => JSON.stringify({
        dimensions: [
          { name: '故事完整性', score: 90, reason: 'r1' },
          { name: '情节与冲突', score: 90, reason: 'r2' },
          { name: '人物塑造', score: 90, reason: 'r3' },
          { name: '逻辑合理性', score: 90, reason: 'r4' },
          { name: '情绪感染力', score: 90, reason: 'r5' },
          { name: '语言表达', score: 90, reason: 'r6' },
          { name: '创意与独特性', score: 90, reason: 'r7' },
        ],
        strengths: [], weaknesses: [], suggestions: [], summary: 's',
      }),
    };
    const { runAutoReview } = await import('@novel/core');
    await runAutoReview(v.id, { provider: fake as never, ruleVersion: defaultRuleVersion! });
    const statsRoute = await import('../web/app/api/admin/review/stats/route');
    const body = (await (await statsRoute.GET(req('/api/admin/review/stats'), undefined as never)).json()) as {
      stats: { totalRecords: number; passRate: number; avgScore: number | null };
    };
    assertOk(body.stats.totalRecords === 1 && body.stats.avgScore === 90 && body.stats.passRate === 100, '统计聚合正确(1条/90分/100%通过)');
  }
}

await main();
console.log(failed === 0 ? '\n全部通过 ✓' : `\n${failed} 项失败 ✗`);
process.exit(failed === 0 ? 0 : 1);
