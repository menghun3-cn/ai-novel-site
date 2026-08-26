/**
 * V9.5 阶段二补丁:长篇单章自动优化闭环
 * - 评审不合格 → 自动入队 AI_OPTIMIZE_CHAPTER(受 chapter_review_max_rounds 约束 + 去重守卫)
 * - 优化执行 → content_md in-place 更新 + optimize_round+=1 → 自动入队重评
 * - 重评合格 → 不再入队优化(闭环终止)
 * - 轮数耗尽 → 不再入队优化;直接调 runChapterOptimization 抛 INVALID_INPUT
 * - 非 published 章节 → runChapterOptimization 拒绝
 * - buildChapterOptimizePrompt 携带问题清单与薄弱维度
 *
 * 运行:npm run test:chapter-optimize
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

process.env.NOVEL_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'novel-chapter-optimize-'));
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
  listAiTasks,
  getDb,
  getReviewRecord,
  buildChapterOptimizePrompt,
  runChapterOptimization,
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

/** 优化 prompt 特征串(runChapterOptimization 的 buildChapterOptimizePrompt 输出) */
const OPTIMIZE_MARKER = '# 本次评审发现的问题';
const OPTIMIZED_CONTENT = '# 第一章\n\n修订后的正文:冲突前置,张力拉满,人物动机补全。'.repeat(6);

/** 双态 fake provider:评审 prompt 回 JSON 分数,优化 prompt 回修订正文 */
function makeDualProvider(reviewScore: number) {
  return createFakeProvider((prompt: string) => (prompt.includes(OPTIMIZE_MARKER) ? OPTIMIZED_CONTENT : reviewJson(reviewScore)));
}

function tasksOf(type: string, refId: string): Array<{ id: string; status: string }> {
  return listAiTasks({ type, refId, limit: 20 }).map((t) => ({ id: t.id, status: t.status }));
}

async function main(): Promise<void> {
  ensureDefaultReviewRule();
  if (!getActiveRuleVersion()) {
    console.error('未找到已发布规则,前置环境失败');
    process.exit(2);
  }
  upsertAuthor('测试作者');
  upsertCategory('测试分类');

  // ---------- 场景 A:评审不合格 → 自动入队优化 → 优化 → 重评合格 → 闭环终止 ----------
  const bookA = createBook({
    slug: 'book-chapter-optimize-a',
    title: '优化闭环测试',
    authorName: '测试作者',
    categoryName: '测试分类',
    tags: [],
  });
  assertOk(getDb().prepare('SELECT chapter_review_max_rounds FROM books WHERE id=?').get(bookA.id)?.chapter_review_max_rounds === 1, '默认 max_rounds=1');

  const ch1 = createChapter({
    bookId: bookA.id,
    number: 1,
    title: '第一章',
    contentMd: '初稿正文,节奏平缓。'.repeat(30),
    status: 'published',
  });

  // 低分评审任务执行 → 应自动入队 AI_OPTIMIZE_CHAPTER
  await processAiTasks({ provider: makeDualProvider(30), limit: 5 });
  const opt1 = tasksOf('AI_OPTIMIZE_CHAPTER', ch1.id);
  console.log('· 场景 A:评审→优化→重评 闭环');
  assertOk(opt1.length === 1, `不合格评审自动入队 1 条优化任务,实际 ${opt1.length}`);

  // 优化任务执行 → content_md 更新 + optimize_round=1 + 自动入队重评
  await processAiTasks({ provider: makeDualProvider(30), limit: 5 });
  const rowAfterOptimize = getDb().prepare('SELECT content_md, optimize_round FROM chapters WHERE id=?').get(ch1.id) as {
    content_md: string;
    optimize_round: number;
  };
  assertOk(rowAfterOptimize.optimize_round === 1, `optimize_round=1,实际 ${rowAfterOptimize.optimize_round}`);
  assertOk(rowAfterOptimize.content_md.includes('冲突前置'), 'content_md 已被优化内容覆盖');
  const reReviews = tasksOf('AI_REVIEW_CHAPTER', ch1.id);
  assertOk(reReviews.length === 2, `优化后自动入队重评(共 2 条评审任务),实际 ${reReviews.length}`);

  // 重评(高分)→ 合格 → 不再入队优化
  await processAiTasks({ provider: makeDualProvider(90), limit: 5 });
  const optCountFinal = tasksOf('AI_OPTIMIZE_CHAPTER', ch1.id);
  assertOk(optCountFinal.length === 1, `重评合格后不再入队优化(仍 1 条),实际 ${optCountFinal.length}`);
  const latestRec = getDb()
    .prepare(`SELECT structured_result_json FROM review_records WHERE chapter_id=? ORDER BY created_at DESC LIMIT 1`)
    .get(ch1.id) as { structured_result_json: string };
  assertOk(JSON.parse(latestRec.structured_result_json).dimensions[0].score === 90, '最新评审记录分数=90(高分重评已落库)');

  // ---------- 场景 B:轮数耗尽 → 不再入队优化 ----------
  console.log('· 场景 B:max_rounds 上限约束');
  const bookB = createBook({
    slug: 'book-chapter-optimize-b',
    title: '轮数上限测试',
    authorName: '测试作者',
    categoryName: '测试分类',
    tags: [],
  });
  getDb().prepare('UPDATE books SET chapter_review_max_rounds = 1 WHERE id=?').run(bookB.id);
  const chB = createChapter({
    bookId: bookB.id,
    number: 1,
    title: '第一章',
    contentMd: '一直不合格的正文。'.repeat(30),
    status: 'published',
  });
  // 第 1 轮:评审失败 → 入队优化
  await processAiTasks({ provider: makeDualProvider(20), limit: 5 });
  // 第 2 步:优化执行(round→1)+ 入队重评
  await processAiTasks({ provider: makeDualProvider(20), limit: 5 });
  // 第 3 步:重评仍失败,但 optimize_round(1) >= max_rounds(1) → 不再入队优化
  await processAiTasks({ provider: makeDualProvider(20), limit: 5 });
  assertOk(tasksOf('AI_OPTIMIZE_CHAPTER', chB.id).length === 1, '轮数耗尽后重评失败不再入队优化');
  assertOk(tasksOf('AI_REVIEW_CHAPTER', chB.id).length === 2, '评审任务共 2 条(首评+重评)');

  // 直接调用 runChapterOptimization → 抛 INVALID_INPUT(已达上限)
  let threwLimit = false;
  try {
    const rec = getDb()
      .prepare(`SELECT id FROM review_records WHERE chapter_id=? ORDER BY created_at DESC LIMIT 1`)
      .get(chB.id) as { id: string };
    await runChapterOptimization(chB.id, getReviewRecord(rec.id));
  } catch {
    threwLimit = true;
  }
  assertOk(threwLimit, '达上限后 runChapterOptimization 抛错');

  // ---------- 场景 C:非 published 章节拒绝优化 ----------
  console.log('· 场景 C:状态守卫');
  const draftCh = createChapter({
    bookId: bookB.id,
    number: 2,
    title: '第二章草稿',
    contentMd: '草稿。',
    status: 'draft',
  });
  let threwStatus = false;
  try {
    await runChapterOptimization(draftCh.id, {
      id: 'rec_fake',
      storyId: null,
      storyVersionId: null,
      chapterId: draftCh.id,
      sourceUrl: null,
      ruleId: 'r',
      ruleVersion: 'v1.0',
      promptId: null,
      promptVersion: null,
      modelId: null,
      modelName: null,
      modelVersion: null,
      score: 40,
      level: 'C',
      qualified: false,
      dimensionScores: [],
      strengths: [],
      weaknesses: [],
      suggestions: [],
      summary: null,
      reviewRound: 1,
      optimizationRound: 0,
      durationMs: null,
      rawResponse: null,
      createdAt: new Date().toISOString(),
    });
  } catch {
    threwStatus = true;
  }
  assertOk(threwStatus, 'draft 章节拒绝优化');

  // ---------- 场景 D:prompt 构建携带问题清单 ----------
  console.log('· 场景 D:buildChapterOptimizePrompt');
  const built = buildChapterOptimizePrompt({
    bookTitle: '测试书',
    chapterNumber: 3,
    chapterTitle: '第三章',
    chapterContent: '原文内容。',
    record: {
      id: 'rec_x',
      storyId: null,
      storyVersionId: null,
      chapterId: 'ch_x',
      sourceUrl: null,
      ruleId: 'r',
      ruleVersion: 'v1.0',
      promptId: null,
      promptVersion: null,
      modelId: null,
      modelName: null,
      modelVersion: null,
      score: 40,
      level: 'C',
      qualified: false,
      dimensionScores: [{ name: '情节与冲突', score: 4, maxScore: 20, reason: '冲突不足' }],
      strengths: [],
      weaknesses: ['主角动机不明'],
      suggestions: ['补一段内心戏'],
      summary: null,
      reviewRound: 1,
      optimizationRound: 0,
      durationMs: null,
      rawResponse: null,
      createdAt: new Date().toISOString(),
    },
  });
  assertOk(built.prompt.includes('主角动机不明'), 'prompt 含 weakness');
  assertOk(built.prompt.includes('补一段内心戏'), 'prompt 含 suggestion');
  assertOk(built.prompt.includes('情节与冲突'), 'prompt 含薄弱维度名');
  assertOk(built.prompt.includes('第三章'), 'prompt 含章节信息');

  // ---------- 场景 E:去重守卫 ----------
  console.log('· 场景 E:重复入队守卫');
  // 手动连续触发两次低分评审入队+处理,不应产生两条 PENDING 优化任务
  const chE = createChapter({
    bookId: bookA.id,
    number: 9,
    title: '第九章',
    contentMd: '去重测试正文。'.repeat(30),
    status: 'published',
  });
  enqueueChapterReview(chE.id);
  await processAiTasks({ provider: makeDualProvider(25), limit: 5 });
  enqueueChapterReview(chE.id); // 第二次手动入队
  await processAiTasks({ provider: makeDualProvider(25), limit: 5 });
  // 两次不合格评审,但第二次时已有 DONE 的优化(第一轮已消耗 round=1/1)→ 不应新增
  assertOk(tasksOf('AI_OPTIMIZE_CHAPTER', chE.id).length <= 1, `去重/上限生效:优化任务 ≤1,实际 ${tasksOf('AI_OPTIMIZE_CHAPTER', chE.id).length}`);
}

await main();
console.log(failed === 0 ? '\n全部通过 ✓' : `\n${failed} 项失败 ✗`);
process.exit(failed === 0 ? 0 : 1);
