/**
 * V9 阶段二:调度器第三块(ai_tasks 后台驱动)单元测试
 * - 直接调 processAiTasks({limit:5}) 而不启 loop
 * - 入队一个真实 chapter review task → 拉起并落 review_records
 * - 验证 ProcessedTaskResult.ok=true 且 chapter_id 落对
 *
 * 运行:npm run test:scheduler-tasks
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

process.env.NOVEL_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'novel-scheduler-tasks-'));
process.env.AI_MODEL = 'mock-model';

const {
  upsertAuthor,
  upsertCategory,
  createBook,
  createChapter,
  ensureDefaultReviewRule,
  getActiveRuleVersion,
  createFakeProvider,
  enqueueChapterReview,
  processAiTasks,
  latestChapterReview,
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
    dimensions: DIM_NAMES.map((n) => ({ name: n, score, reason: '基于章节文本证据的具体评分理由,不少于三十字。' })),
    strengths: ['结构完整'],
    weaknesses: ['节奏'],
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
  const book = createBook({
    slug: 'book-sched-test',
    title: '调度器测试书',
    authorName: '测试作者',
    categoryName: '测试分类',
    tags: [],
  });
  const chapter = createChapter({
    bookId: book.id,
    number: 1,
    title: '第一章',
    contentMd: '调度器测试章节正文。'.repeat(20),
    status: 'published',
  });

  // 注入 fake provider:评分 90 → 合格
  const provider = createFakeProvider((_p: string) => reviewJson(90));
  // enqueueChapterReview(预期签名)
  const task = enqueueChapterReview(chapter.id);
  const taskId = task.id;
  assertOk(typeof taskId === 'string' && taskId.startsWith('aitask_'), `enqueueChapterReview 返回 taskId(${taskId})`);

  // 拉起一批
  const results = await processAiTasks({ limit: 5, provider });
  assertOk(results.length >= 1, `processAiTasks 拾取 ${results.length} 条任务`);
  const ours = results.find((r) => r.taskId === taskId);
  assertOk(ours !== undefined, '我们的任务在结果中');
  assertOk(ours?.ok === true, `任务执行 ok=true(error=${ours?.error ?? ''})`);

  // chapter review 落库
  const latest = latestChapterReview(chapter.id);
  assertOk(latest !== null, 'latestChapterReview 返回本次结果');
  assertOk(latest?.qualified === true, '评审合格');
}

await main();
console.log(failed === 0 ? '\n全部通过 ✓' : `\n${failed} 项失败 ✗`);
process.exit(failed === 0 ? 0 : 1);
