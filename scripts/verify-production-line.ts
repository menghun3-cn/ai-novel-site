/**
 * V10 内容工厂:产线(Production Line)验证
 *   - normalizeLineConfig:题材非空/权重/调度/配额校验
 *   - assignRunKinds:按权重分配一批「不同题材/类型」的短篇(多样性保障)
 *   - deriveBriefForItem:产线基线 ⊕ 题材 brief ⊕ 种子 合成单篇需求
 *   - runProductionLine:创建短篇 + 逐篇入队 CREATE_NOVEL + 落运行记录
 *   - 每日产线:同日去重;手动触发 bypass 去重
 *   - 配额:每日上限拦截;停用产线拒绝运行
 *   - 启停/删除;总览/队列/闸门/异常/成本聚合返回
 */
process.env.AI_MODEL = 'mock-model';

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { LlmProvider } from '@novel/core';

// 关键:必须在 import @novel/core 之前设置 NOVEL_DATA_DIR(其 db.ts 在模块加载时解析 data dir),
// 否则会污染仓库 data/novel.db。这里用动态 import 保证顺序。
process.env.NOVEL_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'novel-plin-'));

const {
  CoreError,
  assignRunKinds,
  createFakeProvider,
  createProductionLine,
  deleteProductionLine,
  deriveBriefForItem,
  ensureDefaultReviewRule,
  fireDueDailyProductionRuns,
  getProductionCost,
  getProductionExceptions,
  getProductionGate,
  getProductionLinesWithMeta,
  getProductionOverview,
  getProductionQueue,
  getProductionRun,
  getProductionLine,
  getActiveRuleVersion,
  getShortStory,
  listAiTasks,
  listDueDailyProductionLines,
  listProductionRuns,
  processAiTasks,
  runProductionLine,
  setProductionLineEnabled,
  tryGetProductionLine,
  updateProductionLine,
} = (await import('@novel/core')) as typeof import('@novel/core');

let failed = 0;
function assertOk(cond: boolean, name: string): void {
  if (cond) console.log(`✓ ${name}`);
  else { console.error(`✗ ${name}`); failed++; }
}
async function assertThrows(code: string, fn: () => unknown | Promise<unknown>, name: string): Promise<void> {
  try {
    await fn();
    assertOk(false, `${name}(未抛错)`);
  } catch (err) {
    assertOk(err instanceof CoreError && err.code === code, name);
  }
}

const KIND_CFG = {
  kinds: [
    { genre: '都市言情', weight: 2, seeds: [{ theme: '雨夜重逢' }, { theme: '十年后的快递' }] },
    { genre: '悬疑', weight: 1, seeds: [{ theme: '午夜谜案' }] },
    { genre: '科幻', weight: 1, brief: { languageStyle: '冷峻', emotionalTone: '悬疑' } },
  ],
  schedule: { mode: 'manual', count: 6 },
};

const DIM_NAMES = ['故事完整性', '情节与冲突', '人物塑造', '逻辑合理性', '情绪感染力', '语言表达', '创意与独特性'];
function reviewJson(score: number): string {
  return JSON.stringify({
    dimensions: DIM_NAMES.map((name) => ({ name, score, reason: '基于章节文本证据的具体评分理由,不少于三十字。' })),
    strengths: ['衔接自然'],
    weaknesses: ['节奏稍缓'],
    suggestions: ['加强张力'],
    summary: '总评。',
  });
}
function longContent(): string {
  return `# 初稿\n\n` + '这是测试正文段落,用于满足质检的最低字数要求。'.repeat(60);
}
function makeProvider(score: number): LlmProvider {
  return createFakeProvider((prompt: string) => {
    if (prompt.includes('请根据以下创作要求') || prompt.includes('创作要求')) return longContent();
    if (prompt.includes('# 本次评审发现的问题')) return longContent();
    return reviewJson(score);
  });
}

async function main(): Promise<void> {
  ensureDefaultReviewRule();
  if (!getActiveRuleVersion()) { console.error('无已发布规则'); process.exit(2); }

  // ---------- 1. 创建与校验 ----------
  const line = createProductionLine({ name: '混合题材线', config: KIND_CFG });
  assertOk(!!getProductionLine(line.id), '创建后可读取');
  assertOk(getProductionLine(line.id).config.kinds.length === 3, 'kinds 归一化为 3 种题材');
  assertOk(getProductionLine(line.id).config.schedule.count === 6, '调度 count=6');
  await assertThrows('INVALID_LINE_CONFIG', () => createProductionLine({ name: 'x', config: { kinds: [], schedule: { mode: 'manual', count: 1 } } }), '空题材抛 INVALID_LINE_CONFIG');
  await assertThrows('INVALID_LINE_CONFIG', () => createProductionLine({ name: 'x', config: { kinds: [{ genre: 'a' }, { genre: 'a' }], schedule: { mode: 'manual', count: 1 } } }), '题材重复抛 INVALID_LINE_CONFIG');

  // ---------- 2. 混合题材分配 ----------
  const items = assignRunKinds(getProductionLine(line.id).config, 6);
  assertOk(items.length === 6, 'assignRunKinds 返回 6 篇');
  const genres = new Set(items.map((i) => i.genre));
  assertOk(genres.has('都市言情') && genres.has('悬疑') && genres.has('科幻'), '6 篇覆盖全部 3 种题材');
  // 权重 2:1:1 → 都市言情应较多,其余各至少 1
  const romance = items.filter((i) => i.genre === '都市言情').length;
  assertOk(romance >= 2, `都市言情按权重分配 ≥2 篇,实际 ${romance}`);
  assertOk(items.every((i) => i.storyId === null), '分配阶段 storyId=null');

  // 某篇种子被 round-robin 应用
  const seedItem = items.find((i) => i.genre === '都市言情' && i.seedIndex !== null);
  assertOk(!!seedItem, '都市言情有种子下标');
  if (seedItem) {
    const brief = deriveBriefForItem(getProductionLine(line.id).config, seedItem);
    assertOk(brief.genre === '都市言情', '合成 brief.genre=都市言情');
    assertOk(brief.theme === '雨夜重逢' || brief.theme === '十年后的快递', '合成 brief 注入主题种子');
  }

  // ---------- 3. 运行:创建 + 入队 ----------
  const { run, createdStoryIds } = runProductionLine(line.id, { trigger: 'manual' });
  assertOk(createdStoryIds.length === 6, '运行创建 6 篇');
  assertOk(run.status === 'done', '运行状态 done');
  assertOk(run.items.every((i) => i.storyId !== null), '运行完成 storyId 已落库');
  const run2 = getProductionRun(run.id);
  assertOk(run2.items.length === 6, '运行记录 items 6 条');
  // 每篇 brief.genre 与被分配题材一致
  const genreOk = createdStoryIds.every((sid) => {
    const s = getShortStory(sid);
    const it = run2.items.find((i) => i.storyId === sid);
    return s.brief.genre === it?.genre;
  });
  assertOk(genreOk, '每篇短篇 brief.genre 与其被分配题材一致');
  // 每篇均入队 CREATE_NOVEL
  const tasks = listAiTasks({ refType: 'short_story', limit: 100 }).filter((t) => t.type === 'CREATE_NOVEL' && t.refId && createdStoryIds.includes(t.refId));
  assertOk(tasks.length === 6, `入队 6 个 CREATE_NOVEL,实际 ${tasks.length}`);

  // ---------- 4. 端到端:流水线通过 ----------
  const results = await processAiTasks({ provider: makeProvider(92), limit: 20 });
  const failing = results.filter((r) => !r.ok);
  if (failing.length) console.error('  未通过的 CREATE_NOVEL:', JSON.stringify(failing, null, 2));
  const missing: string[] = [];
  const allOk = createdStoryIds.every((sid) => {
    const t = tasks.find((x) => x.refId === sid);
    if (!t) { missing.push(`${sid}:no-task`); return false; }
    const r = results.find((x) => x.taskId === t.id);
    if (!r) { missing.push(`${sid}:not-processed`); return false; }
    return r.ok;
  });
  if (missing.length) console.error('  missing:', missing.join(', '), '| results.length=', results.length, '| tasks.length=', tasks.length, '| resultTypes=', results.map((r) => r.type).join(','));
  assertOk(allOk, '6 篇创作流水线全部通过');

  // ---------- 5. 每日产线同日去重 ----------
  const dl = createProductionLine({ name: '每日线', config: { kinds: [{ genre: '都市言情', weight: 1 }], schedule: { mode: 'daily', hour: 0, count: 2 } } });
  const dueNow = listDueDailyProductionLines();
  assertOk(dueNow.some((l) => l.id === dl.id), '每日产线(时刻已到)出现在 due 列表');
  const fired1 = fireDueDailyProductionRuns();
  assertOk(fired1.length === 1, 'fire 每日产线触发 1 次');
  const fired2 = fireDueDailyProductionRuns();
  assertOk(fired2.length === 0, '同日再次 fire 不再触发(去重)');
  assertOk(getProductionLine(dl.id).lastRunDate !== null, '每日产线记录 last_run_date');

  // ---------- 6. 配额 ----------
  const ql = createProductionLine({ name: '配额线', config: { kinds: [{ genre: '悬疑', weight: 1 }], schedule: { mode: 'manual', count: 3 }, quota: { dailyLimit: 5 } } });
  runProductionLine(ql.id, { trigger: 'manual' });
  await assertThrows('LINE_QUOTA_EXCEEDED', () => runProductionLine(ql.id, { trigger: 'manual' }), '超每日上限抛 LINE_QUOTA_EXCEEDED');

  // ---------- 7. 停用拒绝运行 / 启停 ----------
  const pl = createProductionLine({ name: '开关线', config: { kinds: [{ genre: '科幻', weight: 1 }], schedule: { mode: 'manual', count: 1 } } });
  setProductionLineEnabled(pl.id, false);
  assertOk(getProductionLine(pl.id).enabled === false, '停用生效');
  await assertThrows('INVALID_LINE_CONFIG', () => runProductionLine(pl.id, { trigger: 'manual' }), '停用产线运行抛 INVALID_LINE_CONFIG');
  setProductionLineEnabled(pl.id, true);
  assertOk(getProductionLine(pl.id).enabled === true, '重新启用');

  // ---------- 8. 修改与删除 ----------
  const updated = updateProductionLine(line.id, { name: '混合题材线(改)', config: { ...KIND_CFG, schedule: { mode: 'manual', count: 8 } } });
  assertOk(updated.name === '混合题材线(改)', '修改名称生效');
  assertOk(updated.config.schedule.count === 8, '修改调度生效');
  assertOk(listProductionRuns({ lineId: line.id, limit: 100 }).length === 1, '产线运行历史可见');
  deleteProductionLine(pl.id);
  assertOk(tryGetProductionLine(pl.id) === null, '删除后不可读');

  // ---------- 9. 聚合 ----------
  const ov = getProductionOverview();
  assertOk(ov.kpis.total >= 6, `总览累计注入 ≥6,实际 ${ov.kpis.total}`);
  assertOk(ov.lanes.some((l) => l.line.id === line.id), '总览产线泳道含目标产线');
  assertOk(Array.isArray(ov.funnel) && ov.funnel.length === 5, '漏斗 5 阶段');
  const q = getProductionQueue();
  assertOk(q.totalPending >= 0 && Array.isArray(q.byType), '队列聚合返回');
  const g = getProductionGate();
  assertOk(Array.isArray(g.pool) && Array.isArray(g.lines), '质量闸门聚合返回');
  const ex = getProductionExceptions();
  assertOk(Array.isArray(ex), '异常分诊聚合返回');
  const c = getProductionCost();
  assertOk(typeof c.totalEstUsd === 'number', '成本聚合返回');
  const withMeta = getProductionLinesWithMeta();
  assertOk(withMeta.some((l) => l.id === line.id && l.total >= 6), '产线带概览返回');
}

await main();
console.log(failed === 0 ? '\n全部通过 ✓' : `\n${failed} 项失败 ✗`);
process.exit(failed === 0 ? 0 : 1);
