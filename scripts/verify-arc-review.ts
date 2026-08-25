/**
 * V9 阶段二:长篇弧级自动评审
 * - runArcReview(bookId, from-to) → 落 arc_review_records + 更新 last_arc_review_chapter
 * - 不存在区间 → CHAPTER_NOT_FOUND_IN_ARC
 * - arc_review_enabled=0 → 拒绝
 * - listArcReviewRecords / getArcReviewRecord
 * - shouldTriggerAutoArcReview 阈值判断(0/5/已达标)
 *
 * 运行:npm run test:arc-review
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

process.env.NOVEL_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'novel-arc-review-'));
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
  runArcReview,
  listArcReviewRecords,
  getArcReviewRecord,
  shouldTriggerAutoArcReview,
  getBookById,
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
    dimensions: DIM_NAMES.map((name) => ({ name, score, reason: '基于弧内章节文本证据的具体评分理由,不少于三十字。' })),
    strengths: ['弧结构清晰'],
    weaknesses: ['人物转变略快'],
    suggestions: ['增加过渡'],
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
    slug: 'book-arc-test',
    title: '长篇弧评测试',
    authorName: '测试作者',
    categoryName: '测试分类',
    tags: [],
  });

  // 建 5 个 published 章节
  for (let i = 1; i <= 5; i++) {
    createChapter({
      bookId: book.id,
      number: i,
      title: `第${i}章`,
      contentMd: `第${i}章正文,故事推进。`.repeat(50),
      status: 'published',
    });
  }

  // 1. 评第 1-3 章
  const provider = createFakeProvider((_p: string) => reviewJson(85));
  const arcRec = await runArcReview(book.id, { arcLabel: '开篇弧', fromChapter: 1, toChapter: 3, provider });
  assertOk(arcRec.bookId === book.id, 'bookId 正确');
  assertOk(arcRec.fromChapter === 1 && arcRec.toChapter === 3, '区间正确');
  assertOk(arcRec.qualified === true, '85 分 → qualified');
  assertOk(arcRec.score >= 80, '加权总分 >= 80');
  assertOk(arcRec.dimensionScores.length === DIM_NAMES.length, '维度分数齐');

  // 2. last_arc_review_chapter 已更新
  {
    const b = getBookById(book.id);
    assertOk(b !== null && b.lastArcReviewChapter === 3, 'last_arc_review_chapter 同步推进到 3');
  }

  // 3. getArcReviewRecord / listArcReviewRecords
  {
    const got = getArcReviewRecord(arcRec.id);
    assertOk(got.id === arcRec.id, 'getArcReviewRecord 字段一致');
    const list = listArcReviewRecords(book.id);
    assertOk(list.length === 1 && list[0].id === arcRec.id, 'listArcReviewRecords 含 1 条');
  }

  // 4. 区间不存在章节(草稿 6-10 章)→ 拒绝
  await assertThrows(
    'CHAPTER_NOT_FOUND_IN_ARC',
    () => runArcReview(book.id, { arcLabel: '空弧', fromChapter: 6, toChapter: 10, provider }),
    '区间无 published 章节 → 拒绝'
  );

  // 5. 反向区间 → 拒绝
  await assertThrows(
    'CHAPTER_NOT_FOUND_IN_ARC',
    () => runArcReview(book.id, { arcLabel: '反向', fromChapter: 5, toChapter: 1, provider }),
    '反向区间 → 拒绝'
  );

  // 6. shouldTriggerAutoArcReview:已评 3 章,新增 2 章,阈值 5 → 不应触发
  {
    const dec = shouldTriggerAutoArcReview(book.id);
    assertOk(dec.should === false, '5 章减 3 = 2 < 5 阈值 → 不触发');
    assertOk(dec.fromChapter === 4 && dec.toChapter === 5, 'from/to 正确(from=last+1, to=maxChapter)');
  }

  // 7. last 推进到 5 后,新增 0 章 → 不触发
  {
    const b = getBookById(book.id);
    // 实际:runArcReview(1-3) 已设 last=3,再 runArcReview(1-5) 让 last=5
    await runArcReview(book.id, { arcLabel: '扩弧', fromChapter: 1, toChapter: 5, provider });
    const dec = shouldTriggerAutoArcReview(b!.id);
    assertOk(dec.should === false, 'last=5,max=5 → 新增 0 章,不触发');
  }

  // 8. arc_review_enabled=0 → 拒绝
  {
    const { getDb } = await import('@novel/core');
    getDb().prepare('UPDATE books SET arc_review_enabled = 0 WHERE id = ?').run(book.id);
    const b = getBookById(book.id);
    const dec = shouldTriggerAutoArcReview(b!.id);
    assertOk(dec.should === false, 'arc_review_enabled=0 → 不触发');
    await assertThrows(
      'ARC_NOT_FOUND',
      () => runArcReview(book.id, { arcLabel: '禁用后', fromChapter: 1, toChapter: 5, provider }),
      'arc_review_enabled=0 → runArcReview 拒绝'
    );
  }

  // 9. 不存在 book → 拒绝
  await assertThrows(
    'ARC_NOT_FOUND',
    () => runArcReview('book_nope', { arcLabel: 'x', fromChapter: 1, toChapter: 1, provider }),
    '不存在 book → 拒绝'
  );
}

await main();
console.log(failed === 0 ? '\n全部通过 ✓' : `\n${failed} 项失败 ✗`);
process.exit(failed === 0 ? 0 : 1);
