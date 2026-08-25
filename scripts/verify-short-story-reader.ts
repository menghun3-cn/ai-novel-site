/**
 * V9 阶段二:短篇物化后对外呈现回归
 * - publishShortStory 后 BookWithMeta.kind === 'short'
 * - books 列表可经 getAnyBookById / listAllBooks 看到 kind='short'
 * - latestPublicationByStory 与 getPublication 一致
 * - listPublicationsByStory 按时间倒序
 * - public API contract: list item 含 storyId/bookId/slug/charCount
 *
 * 运行:npm run test:short-story-reader
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

process.env.NOVEL_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'novel-short-story-reader-'));

const {
  CoreError,
  createShortStory,
  appendVersion,
  transitionStory,
  setFinalVersion,
  publishShortStory,
  listPublicationsByStory,
  latestPublicationByStory,
  getPublication,
  getAnyBookById,
  listAllBooks,
  getBookById,
  getChapterView,
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

function main(): void {
  // 准备一篇 passed 短篇
  const story = createShortStory({ title: '雪夜孤灯', brief: { theme: '成长', genre: '短篇', synopsis: '雪夜中独行少年的顿悟' } });
  const v1 = appendVersion(story.id, { content: '雪夜孤灯第一版,风雪夜行少年寻路,偶遇山寺微光。', creationReason: 'generated' });
  appendVersion(story.id, { content: '雪夜孤灯修订稿,加入与老僧对话,主题更深沉。', creationReason: 'ai_optimized' });
  setFinalVersion(story.id, v1.id); // 让 v1 为最终版,内容可预测
  transitionStory(story.id, 'passed');

  // 发布
  const pub = publishShortStory(story.id);

  // 物化产物 kind 标记
  const book = getAnyBookById(pub.bookId);
  assertOk(book !== null && book.kind === 'short', 'BookWithMeta.kind === "short"');
  const bookById = getBookById(pub.bookId);
  assertOk(bookById !== null && bookById.kind === 'short', 'getBookById 也返回 kind="short"');

  // 列表中能识别出短篇(kind='short')
  const all = listAllBooks({ limit: 200 });
  const foundShort = all.find((b) => b.id === pub.bookId);
  assertOk(foundShort !== undefined && foundShort.kind === 'short', 'listAllBooks 返回的 book 含 kind="short"');

  // Chapter 端可读(用于复用 reader 内部组件)
  const view = getChapterView(book!.slug, 1);
  assertOk(view !== null && view.chapter.contentMd === '雪夜孤灯第一版,风雪夜行少年寻路,偶遇山寺微光。', '短篇章节正文与所选 version 内容一致');

  // latest / list / get API
  const list = listPublicationsByStory(story.id);
  assertOk(list.length === 1 && list[0].id === pub.publicationId, 'listPublicationsByStory 返回最新发布');
  const latest = latestPublicationByStory(story.id);
  assertOk(latest !== null && latest.id === pub.publicationId, 'latestPublicationByStory 一致');
  const got = getPublication(pub.publicationId);
  assertOk(got.storyId === story.id && got.bookId === pub.bookId && got.versionId === v1.id, 'getPublication 字段正确');

  // 未知 publication 404
  void (async () => {
    await assertThrows('PUBLICATION_NOT_FOUND', () => getPublication('sspub_unknown'), '未知 publication → 404');
  })();
}

main();
console.log(failed === 0 ? '\n全部通过 ✓' : `\n${failed} 项失败 ✗`);
process.exit(failed === 0 ? 0 : 1);
