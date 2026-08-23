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
  upsertAuthor,
  listAuthors,
  getAuthor,
  updateAuthor,
  deleteAuthor,
  getCategory,
  createCategory,
  updateCategory,
  deleteCategory,
  getTag,
  createTag,
  updateTag,
  deleteTag,
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

// ---------- 作者/分类/标签管理 ----------

const authorId = upsertAuthor('作者甲');
const authorUpdated = updateAuthor(authorId, { bio: '简介甲', avatarPath: '/avatars/a.svg' });
assertOk(authorUpdated.bio === '简介甲' && authorUpdated.avatarPath === '/avatars/a.svg', 'updateAuthor 写入简介与头像');

createBook({ slug: 'author-use', title: '在用之书', authorName: '作者乙', categoryName: '都市' });
const authorB = listAuthors().find((a) => a.name === '作者乙')!;
assertOk(authorB.bookCount === 1, 'listAuthors 附作品数');
expectCoreError('AUTHOR_NAME_TAKEN', () => updateAuthor(authorB.id, { name: '作者甲' }), '作者改名撞车抛 AUTHOR_NAME_TAKEN');
expectCoreError('AUTHOR_IN_USE', () => deleteAuthor(authorB.id), '删除有作品的作者抛 AUTHOR_IN_USE');
expectCoreError('AUTHOR_NOT_FOUND', () => updateAuthor(99999, { bio: 'x' }), '编辑不存在作者抛 AUTHOR_NOT_FOUND');

// 在用之书的分类被引用
const inUseCategoryId = getAnyBookById('book_authoruse')!.categoryId;
expectCoreError('CATEGORY_IN_USE', () => deleteCategory(inUseCategoryId), '删除被书籍引用的分类抛 CATEGORY_IN_USE');

// 书删掉后,作者与分类都可删
assertOk(deleteBook('book_authoruse'), '清理在用之书');
assertOk(deleteAuthor(authorB.id) === true && getAuthor(authorB.id) === null, '书删后作者可删且不可见');
assertOk(deleteCategory(inUseCategoryId) === true && getCategory(inUseCategoryId) === null, '书删后分类可删且不可见');
expectCoreError('CATEGORY_NOT_FOUND', () => deleteCategory(inUseCategoryId), '重复删除分类抛 CATEGORY_NOT_FOUND');

const cat = createCategory('奇幻');
assertOk(cat.slug.trim().length > 0, 'createCategory 派生 slug');
expectCoreError('CATEGORY_NAME_TAKEN', () => createCategory('科幻'), '重复分类抛 CATEGORY_NAME_TAKEN');
const catRenamed = updateCategory(cat.id, { name: '东方奇幻' });
const catAfter = getCategory(cat.id);
assertOk(catRenamed.name === '东方奇幻' && catAfter !== null && catAfter.slug === cat.slug, '分类重命名生效且 slug 不变');

const tag = createTag('星际');
expectCoreError('TAG_NAME_TAKEN', () => createTag('AI'), '重复标签抛 TAG_NAME_TAKEN(AI 已存在)');
const tagRenamed = updateTag(tag.id, { name: '深空' });
assertOk(tagRenamed.name === '深空' && getTag(tag.id)?.slug === tag.slug, '标签重命名生效且 slug 不变');
assertOk(deleteTag(tag.id) && getTag(tag.id) === null, 'deleteTag 连同关联删除');
expectCoreError('TAG_NOT_FOUND', () => deleteTag(tag.id), '重复删除标签抛 TAG_NOT_FOUND');

if (failed > 0) {
  console.error(`\n${failed} 项验证失败`);
  process.exit(1);
}
console.log('\n核心管理侧服务全部验证通过');
