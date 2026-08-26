/**
 * V9.5 阶段二补丁:评审统计补全(getReviewTrendStats)
 * - 7 日趋势桶:章节/弧级计数 + 章节日均分(空日 null)
 * - 维度均分:薄弱维度排在最前
 * - 弧评汇总:total/qualified/avg
 *
 * 运行:npm run test:review-stats
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

process.env.NOVEL_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'novel-review-stats-'));
process.env.AI_MODEL = 'mock-model';

const {
  upsertAuthor,
  upsertCategory,
  createBook,
  createChapter,
  ensureDefaultReviewRule,
  getActiveRuleVersion,
  createFakeProvider,
  runChapterReview,
  runArcReview,
  getDb,
  getReviewTrendStats,
} = await import('@novel/core');

let failed = 0;
function assertOk(cond: boolean, name: string): void {
  if (cond) console.log(`✓ ${name}`);
  else {
    console.error(`✗ ${name}`);
    failed++;
  }
}

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

async function main(): Promise<void> {
  ensureDefaultReviewRule();
  if (!getActiveRuleVersion()) {
    console.error('未找到已发布规则,前置环境失败');
    process.exit(2);
  }
  upsertAuthor('测试作者');
  upsertCategory('测试分类');
  const book = createBook({ slug: 'book-review-stats', title: '统计测试书', authorName: '测试作者', categoryName: '测试分类', tags: [] });

  const provider = createFakeProvider((_p: string) => reviewJson(80));
  // 3 条章节评审(80 分)
  for (let n = 1; n <= 3; n++) {
    const ch = createChapter({ bookId: book.id, number: n, title: `第${n}章`, contentMd: '正文。'.repeat(40), status: 'published' });
    await runChapterReview(ch.id, { provider });
  }
  // 1 条弧评(90 分)
  const arcProvider = createFakeProvider((_p: string) => reviewJson(90));
  await runArcReview(book.id, { arcLabel: '开篇弧', fromChapter: 1, toChapter: 3, provider: arcProvider });

  const trend = getReviewTrendStats(7);

  // 趋势桶:7 天连续
  assertOk(trend.days.length === 7, `趋势返回 7 天,实际 ${trend.days.length}`);
  const todayKey = new Date().toLocaleDateString('zh-CN', { timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit' }).replace(/\//g, '-');
  const today = trend.days.find((d) => d.date === todayKey);
  assertOk(today !== undefined, `含今日桶(${todayKey})`);
  assertOk(today!.chapterCount === 3, `今日章节评审 3 次,实际 ${today!.chapterCount}`);
  assertOk(today!.arcCount === 1, `今日弧评 1 次,实际 ${today!.arcCount}`);
  assertOk(today!.chapterAvgScore === Math.round(80), `今日章节均分 80,实际 ${today!.chapterAvgScore}`);
  assertOk(trend.days.filter((d) => d.chapterCount === 0).length === 6, '其余 6 天为空桶');

  // 维度均分:7 个维度全部出现,score 为 0-100 原始分 → 均分 = 80
  assertOk(trend.chapterDimensionAverages.length === DIM_NAMES.length, `维度数 ${DIM_NAMES.length},实际 ${trend.chapterDimensionAverages.length}`);
  assertOk(trend.chapterDimensionAverages.every((d) => d.avg === 80), '每维均分 80/100');
  assertOk(trend.chapterDimensionAverages.every((d) => d.count === 3), '每维样本数 3');

  // 弧评汇总
  assertOk(trend.arcSummary.total === 1 && trend.arcSummary.qualified === 1, '弧评汇总 total=1 qualified=1');
  assertOk(trend.arcSummary.avgScore === 90, `弧评均分 90,实际 ${trend.arcSummary.avgScore}`);

  // 幂等:重复调用结果一致
  const again = getReviewTrendStats(7);
  assertOk(again.days.length === 7 && again.chapterDimensionAverages.length === DIM_NAMES.length, '重复调用结果一致(幂等)');
}

await main();
console.log(failed === 0 ? '\n全部通过 ✓' : `\n${failed} 项失败 ✗`);
process.exit(failed === 0 ? 0 : 1);
