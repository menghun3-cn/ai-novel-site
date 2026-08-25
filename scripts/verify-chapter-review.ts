/**
 * V9 阶段二:长篇单章自动评审
 * - runChapterReview(published chapter) → 落 review_records(ref_type='chapter', story_id/version_id NULL)
 * - 规则 active + fake provider → 返回合格 + 加权总分/等级正确
 * - 不存在章节 → CHAPTER_NOT_FOUND_IN_ARC
 * - 草稿章节 → CHAPTER_NOT_FOUND_IN_ARC(只评 published)
 * - listChapterReviews / latestChapterReview 查询
 *
 * 运行:npm run test:chapter-review
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

process.env.NOVEL_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'novel-chapter-review-'));
process.env.AI_MODEL = 'mock-model';

const {
  CoreError,
  upsertAuthor,
  upsertCategory,
  createBook,
  createChapter,
  ensureDefaultReviewRule,
  getActiveRuleVersion,
  createFakeProvider,
  runChapterReview,
  listChapterReviews,
  latestChapterReview,
  getReviewRecord,
} = await import('@novel/core');

let failed = 0;
function assertOk(cond: boolean, name: string): void {
  if (cond) console.log(`✓ ${name}`);
  else {
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
  // 触发 ensureDefaultReviewRule 的种子规则(只要求函数被调过一次即可,数据库幂等)
  ensureDefaultReviewRule();
  const rule = getActiveRuleVersion();
  if (!rule) {
    console.error('未找到已发布规则,前置环境失败');
    process.exit(2);
  }

  // 建书 + 章节
  upsertAuthor('测试作者');
  upsertCategory('测试分类');
  const book = createBook({
    slug: 'book-chapter-review-test',
    title: '长篇测试书',
    authorName: '测试作者',
    categoryName: '测试分类',
    tags: [],
  });
  const chapter1 = createChapter({
    bookId: book.id,
    number: 1,
    title: '第一章',
    contentMd: '第一章正文,一段完整故事。'.repeat(20),
    status: 'published',
  });
  // 草稿章节
  const draft = createChapter({
    bookId: book.id,
    number: 2,
    title: '第二章草稿',
    contentMd: '未发布章节。',
    status: 'draft',
  });

  // fake provider:返回 90 分(全维度)
  const provider = createFakeProvider((_prompt: string) => reviewJson(90));

  // 1. 评 published 章节 → 合格,落库
  const rec = await runChapterReview(chapter1.id, { provider });
  assertOk(rec.qualified === true, '高分 → qualified=true');
  assertOk(rec.score >= 80, '加权总分 >= 80');
  assertOk(rec.storyId === null, 'chapter review: storyId=null');
  assertOk(rec.storyVersionId === null, 'chapter review: storyVersionId=null');
  assertOk(rec.modelName !== null, '记录了 modelName');
  assertOk(rec.dimensionScores.length === DIM_NAMES.length, `记录了 ${DIM_NAMES.length} 个维度分数`);

  // 2. 落库后 review_records 字段
  {
    const loaded = getReviewRecord(rec.id);
    assertOk(loaded !== null, 'getReviewRecord 可查');
    assertOk(loaded.storyId === null, 'getReviewRecord 返回 storyId=null(章节评审)');
  }

  // 3. listChapterReviews / latestChapterReview
  {
    const list = listChapterReviews(chapter1.id);
    assertOk(list.length === 1 && list[0].id === rec.id, 'listChapterReviews 含 1 条');
    const latest = latestChapterReview(chapter1.id);
    assertOk(latest !== null && latest.id === rec.id, 'latestChapterReview 一致');
  }

  // 4. 草稿章节评审拒绝
  await assertThrows('CHAPTER_NOT_FOUND_IN_ARC', () => runChapterReview(draft.id, { provider }), '草稿章节评审 → 拒绝');

  // 5. 不存在章节 → 拒绝
  await assertThrows('CHAPTER_NOT_FOUND_IN_ARC', () => runChapterReview('ch_nonexistent', { provider }), '不存在章节 → 拒绝');

  // 6. 低分 → 不合格,但记录落库
  {
    const lowProvider = createFakeProvider((_prompt: string) => reviewJson(30));
    const ch3 = createChapter({
      bookId: book.id,
      number: 3,
      title: '第三章',
      contentMd: '内容。'.repeat(30),
      status: 'published',
    });
    const lowRec = await runChapterReview(ch3.id, { provider: lowProvider });
    assertOk(lowRec.qualified === false, '低分 → qualified=false');
    assertOk(lowRec.score < 60, '低分总分 < 60');
  }
}

await main();
console.log(failed === 0 ? '\n全部通过 ✓' : `\n${failed} 项失败 ✗`);
process.exit(failed === 0 ? 0 : 1);
