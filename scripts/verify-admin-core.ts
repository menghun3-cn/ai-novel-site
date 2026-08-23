/**
 * Content Core 管理侧(V2)服务层验证:createBook/updateBook/deleteBook/listAllBooks、
 * 隐藏书籍公开可见性、章节创建/编辑/删除/重排。
 *
 * 运行:npm run test:core
 * 数据库使用临时目录(NOVEL_DATA_DIR),不触碰 data/novel.db。
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

process.env.NOVEL_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'novel-core-admin-'));

const {
  CoreError,
  createBook,
  updateBook,
  deleteBook,
  listBooks,
  listAllBooks,
  getBookBySlug,
  getAnyBookById,
  createChapter,
  updateChapter,
  deleteChapter,
  getChapterByNumber,
  listChapters,
  reorderChapters,
  latestUpdates,
  rssItems,
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

function expectCoreError(code: string, fn: () => unknown, name: string): void {
  try {
    fn();
    console.error(`✗ ${name}(未抛错)`);
    failed++;
  } catch (err) {
    if (err instanceof CoreError && err.code === code) {
      console.log(`✓ ${name}`);
    } else {
      console.error(`✗ ${name}(抛出 ${String(err)})`);
      failed++;
    }
  }
}

// ---------- 小说管理 ----------

const book = createBook({
  slug: 'test-book',
  title: '测试之书',
  authorName: '测试作者',
  categoryName: '科幻',
  tags: ['AI', '末世'],
});
assertOk(book.id === 'book_testbook', 'createBook 返回 BookWithMeta,id 由 slug 派生');
assertOk(book.tags.includes('AI') && book.categoryName === '科幻', '新建携带标签与分类');

expectCoreError('SLUG_TAKEN', () => createBook({ slug: 'test-book', title: '重复', authorName: 'x', categoryName: '都市' }), '重复 slug 抛 SLUG_TAKEN');

const updated = updateBook(book.id, { title: '测试之书(改)', description: '简介', coverPath: '/covers/t.svg' });
assertOk(updated.title === '测试之书(改)' && updated.coverPath === '/covers/t.svg', 'updateBook 局部字段生效');
expectCoreError('BOOK_NOT_FOUND', () => updateBook('book_missing', { title: 'x' }), '编辑不存在小说抛 BOOK_NOT_FOUND');

// 章节先建好,再隐藏书,验证公开面全部不可见
const ch1 = createChapter({ bookId: book.id, title: '第一章', contentMd: '# 1' });
const ch2 = createChapter({ bookId: book.id, title: '第二章', contentMd: '# 2' });
assertOk(ch1.number === 1 && ch2.number === 2, 'createChapter 自动接排章号');
updateChapter(book.id, 1, { status: 'published' });

updateBook(book.id, { status: 'hidden' });
assertOk(getBookBySlug('test-book') === null, '隐藏后 getBookBySlug 不可见');
assertOk(listBooks().length === 0, '隐藏后 listBooks 不返回');
assertOk(latestUpdates(10).length === 0, '隐藏后 latestUpdates 不返回其章节');
assertOk(rssItems(10).length === 0, '隐藏后 rssItems 不返回其章节');
assertOk(listAllBooks().length === 1, 'listAllBooks 后台仍可见');
assertOk(listAllBooks({ status: 'hidden' }).length === 1, 'listAllBooks 按状态筛选 hidden');

updateBook(book.id, { status: 'serializing' });
assertOk(getBookBySlug('test-book') !== null, '恢复后重新可见');

// ---------- 章节管理 ----------

updateChapter(book.id, 2, { status: 'scheduled', scheduledAt: '2030-01-01T00:00:00.000Z' });
const sched = getChapterByNumber(book.id, 2);
assertOk(sched?.status === 'scheduled' && sched.scheduledAt === '2030-01-01T00:00:00.000Z', '定时章节保留 scheduledAt');

const pub = updateChapter(book.id, 1, { title: '第一章(修)' });
assertOk(pub.status === 'published' && pub.publishedAt !== null, '编辑已发布章节保持 published');
const pub2 = updateChapter(book.id, 1, { contentMd: '# 1 改' });
assertOk(pub2.publishedAt === pub.publishedAt, '首次发布时间不被后续编辑改变');

const backToDraft = updateChapter(book.id, 2, { status: 'draft' });
assertOk(backToDraft.status === 'draft' && backToDraft.scheduledAt === null, '退回草稿取消定时');

expectCoreError(
  'CHAPTER_NUMBER_CONFLICT',
  () => createChapter({ bookId: book.id, number: 1, title: '撞号', contentMd: 'x' }),
  '显式章号冲突抛 CHAPTER_NUMBER_CONFLICT'
);

assertOk(deleteChapter(book.id, 2), 'deleteChapter 删除成功');
assertOk(deleteChapter(book.id, 2) === false, '重复删除返回 false');

// 重排:现有 [1],再建一章自动接排为 2(复用已删章号)
const ch3 = createChapter({ bookId: book.id, title: '第三章', contentMd: '# 3' });
assertOk(ch3.number === 2, '删除后再新建接排在最大章号之后(2)');

const reordered = reorderChapters(book.id, [ch3.number, 1]);
assertOk(
  reordered[0].title === '第三章' && reordered[1].title === '第一章(修)' && reordered[0].number < reordered[1].number,
  'reorderChapters 整卷重排生效'
);
expectCoreError('INVALID_CHAPTER_ORDER', () => reorderChapters(book.id, [1]), '非排列抛 INVALID_CHAPTER_ORDER');

// ---------- 级联删除 ----------

assertOk(deleteBook(book.id), 'deleteBook 删除成功');
expectCoreError('BOOK_NOT_FOUND', () => createChapter({ bookId: book.id, title: '孤儿', contentMd: 'x' }), '删除后建章抛 BOOK_NOT_FOUND');
assertOk(deleteBook('book_missing') === false, '删除不存在小说返回 false');

if (failed > 0) {
  console.error(`\n${failed} 项验证失败`);
  process.exit(1);
}
console.log('\n核心管理侧服务全部验证通过');
