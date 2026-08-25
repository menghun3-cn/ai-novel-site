/**
 * V9.5 阶段二补丁:章节发布时自动入队 AI_REVIEW_CHAPTER
 * - chapter_review_enabled=1 → importChapter(status='published') 自动入队
 * - chapter_review_enabled=1 → approveChapter(mode='now') 自动入队
 * - chapter_review_enabled=0 → 不入队
 * - 重复入队守卫:同 chapter_id 已有 PENDING/RUNNING 任务时跳过
 * - 非 published 状态 → 不入队
 *
 * 运行:npm run test:chapter-review-auto-enqueue
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

process.env.NOVEL_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'novel-chapter-auto-enqueue-'));

const {
  upsertAuthor,
  upsertCategory,
  createBook,
  createChapter,
  importChapter,
  approveChapter,
  getBookById,
  listAiTasks,
  getDb,
} = await import('@novel/core');

let failed = 0;
function assertOk(cond: boolean, name: string): void {
  if (cond) console.log(`✓ ${name}`);
  else {
    console.error(`✗ ${name}`);
    failed++;
  }
}

function chapterReviewTasks(chapterId: string): Array<{ id: string; status: string }> {
  return listAiTasks({ type: 'AI_REVIEW_CHAPTER', refId: chapterId, limit: 10 }).map((t) => ({
    id: t.id,
    status: t.status,
  }));
}

function main(): void {
  upsertAuthor('测试作者');
  upsertCategory('测试分类');
  const book = createBook({
    slug: 'book-auto-enqueue',
    title: '自动入队测试',
    authorName: '测试作者',
    categoryName: '测试分类',
    tags: [],
  });
  // 默认 chapter_review_enabled=1
  assertOk(getBookById(book.id)!.chapterReviewEnabled === true, '默认 chapter_review_enabled=1');

  // 1. importChapter(status='published') → 自动入队
  const c1 = importChapter({ bookId: book.id, number: 1, title: '第一章', contentMd: '正文一', status: 'published' });
  assertOk(c1.added, 'importChapter 返回 added=true');
  // 实际 chapter id 由 bookId + '_ch' + number 拼接;bookId 是 bookIdFromSlug(slug) → "book_<去连字符>"
  const expectedChapterId1 = `${book.id}_ch1`;
  const tasks1 = chapterReviewTasks(expectedChapterId1);
  assertOk(tasks1.length === 1, `importChapter(published) 自动入队 1 条, 实际 ${tasks1.length}`);
  assertOk(tasks1[0]?.status === 'PENDING', '入队状态=PENDING');

  // 2. 重复入队守卫:同 chapter_id 已有 PENDING 任务时跳过
  const dupImport = importChapter({ bookId: book.id, number: 1, title: '第一章', contentMd: '正文一(覆盖)', status: 'published' });
  assertOk(!dupImport.added, '重复 importChapter 返回 added=false');
  const tasks1After = chapterReviewTasks(expectedChapterId1);
  assertOk(tasks1After.length === 1, '重复入队守卫:仍只有 1 条 PENDING');

  // 3. 非 published 状态 → 不入队
  importChapter({ bookId: book.id, number: 2, title: '第二章', contentMd: '草稿', status: 'draft' });
  const tasks2 = chapterReviewTasks(`${book.id}_ch2`);
  assertOk(tasks2.length === 0, 'draft 章节不入队');

  // 4. approveChapter(mode='now') → 自动入队
  importChapter({ bookId: book.id, number: 3, title: '第三章', contentMd: '待审', status: 'pending_review' });
  approveChapter(book.id, 3, { mode: 'now' });
  const tasks3 = chapterReviewTasks(`${book.id}_ch3`);
  assertOk(tasks3.length === 1, 'approveChapter(mode=now) 自动入队');

  // 5. chapter_review_enabled=0 → 不入队
  getDb().prepare('UPDATE books SET chapter_review_enabled = 0 WHERE id = ?').run(book.id);
  importChapter({ bookId: book.id, number: 4, title: '第四章', contentMd: '关闭后', status: 'published' });
  const tasks4 = chapterReviewTasks(`${book.id}_ch4`);
  assertOk(tasks4.length === 0, 'chapter_review_enabled=0 时发布不入队');

  // 6. approveChapter 不入队(在 chapter_review_enabled=0 时)
  importChapter({ bookId: book.id, number: 5, title: '第五章', contentMd: '关闭后待审', status: 'pending_review' });
  approveChapter(book.id, 5, { mode: 'now' });
  const tasks5 = chapterReviewTasks(`${book.id}_ch5`);
  assertOk(tasks5.length === 0, 'chapter_review_enabled=0 时 approveChapter 不入队');

  // 7. approved 章节不再入队(状态机非法路径验证;approveChapter 自身会先抛错)
  // 跳过:路径不通,不需要测
}

main();
console.log(failed === 0 ? '\n全部通过 ✓' : `\n${failed} 项失败 ✗`);
process.exit(failed === 0 ? 0 : 1);
