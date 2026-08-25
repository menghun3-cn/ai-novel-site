/**
 * V9 阶段二:短篇发布物化服务验证
 * - passed → publishShortStory 物化为 Book+Chapter+Publication
 * - 非 passed 状态 → 400 SHORT_STORY_NOT_PUBLISHED
 * - 同 version 重复发布 → 409
 * - 不同 version 可再次发布(同 short_story 多 publication)
 * - listPublicationsByStory / latestPublicationByStory 正确
 *
 * 运行:npm run test:short-story-publication
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

process.env.NOVEL_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'novel-short-story-pub-'));

const {
  CoreError,
  createShortStory,
  appendVersion,
  transitionStory,
  publishShortStory,
  listPublicationsByStory,
  latestPublicationByStory,
  getPublication,
  getShortStory,
  getBookBySlug,
  getChapterView,
  listCategories,
  getDbPath,
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

async function assertThrows(code: string, fn: () => unknown | Promise<unknown>, name: string): Promise<void> {
  try {
    await fn();
    assertOk(false, `${name}(未抛错)`);
  } catch (err) {
    assertOk(err instanceof CoreError && err.code === code, name);
  }
}

async function main(): Promise<void> {
  // 准备一篇已通过评审的短篇(模拟流水线:生成→评审→pass)
  const story = createShortStory({ title: '雨夜重逢', brief: { theme: '爱情', genre: '都市', synopsis: '十年后的相遇' } });
  const v1 = appendVersion(story.id, { content: '第一版正文(雨夜重逢的完整故事)。', creationReason: 'generated' });
  const v2 = appendVersion(story.id, { content: '修订稿正文,更加精炼。', creationReason: 'ai_optimized' });
  // setFinalVersion:让 v2 为最终版
  const { setFinalVersion } = await import('@novel/core');
  setFinalVersion(story.id, v2.id);
  // 模拟流水线走到 passed(直接置状态,避免 mock LLM)
  transitionStory(story.id, 'passed');

  // 守卫 1:非 passed 不可发布
  {
    const other = createShortStory({ title: '未达标作品' });
    appendVersion(other.id, { content: '内容', creationReason: 'generated' });
    await assertThrows('SHORT_STORY_NOT_PUBLISHED', () => publishShortStory(other.id), 'draft 状态发布 → SHORT_STORY_NOT_PUBLISHED');
  }

  // 守卫 2:passed 可发布,且物化产物完整
  const pub1 = publishShortStory(story.id);
  assertOk(pub1.publicationId.startsWith('sspub_'), 'publicationId sspub_ 前缀');
  assertOk(pub1.bookId.startsWith('book_'), 'book id 规范');
  assertOk(pub1.bookSlug.length > 0, 'book slug 非空');

  // 物化产物可经 reader 服务读取(关键回归点:复用现有 reader,无需新组件)
  {
    const book = getBookBySlug(pub1.bookSlug);
    assertOk(book !== null, 'book 可经 getBookBySlug 查询到');
    assertOk(book?.status === 'completed', 'book.status=completed');
    assertOk(book?.title === '雨夜重逢', 'title 传递正确');
    const view = getChapterView(pub1.bookSlug, 1);
    assertOk(view !== null, 'chapter 可经 getChapterView 读取');
    assertOk(view?.chapter.contentMd === '修订稿正文,更加精炼。', 'chapter content = 最终版 v2 内容');
    assertOk(view?.chapter.status === 'published', 'chapter.status=published');
  }

  // 默认作者/分类自动创建
  {
    const cat = listCategories().find((c) => c.slug === '短篇小说');
    assertOk(cat?.name === '短篇小说', '默认分类「短篇小说」已自动创建');
  }

  // 守卫 3:同 version 重复发布 → 409
  await assertThrows('SHORT_STORY_NOT_PUBLISHED', () => publishShortStory(story.id), '同 short story 默认 version 重复发布 → SHORT_STORY_NOT_PUBLISHED');

  // 显式指定不同 version 发布 → 成功
  const pub2 = publishShortStory(story.id, { versionId: v1.id });
  assertOk(pub2.publicationId !== pub1.publicationId, '不同 version 各得一条 publication');
  assertOk(pub2.bookSlug !== pub1.bookSlug, '不同 version 生成不同 book(独立链接)');
  // 旧链接仍可读
  {
    const oldBook = getBookBySlug(pub1.bookSlug);
    assertOk(oldBook !== null, '旧 version 发布的链接仍可访问(不覆盖)');
  }

  // 列表与最新
  {
    const list = listPublicationsByStory(story.id);
    assertOk(list.length === 2, '该短篇有 2 条 publication');
    const latest = latestPublicationByStory(story.id);
    assertOk(latest !== null && latest.id === pub2.publicationId, '最新发布为 v1 版本那条');
  }

  // getPublication 正常 + 未知 id 404
  {
    const p = getPublication(pub1.publicationId);
    assertOk(p.storyId === story.id && p.bookId === pub1.bookId, 'getPublication 字段正确');
    await assertThrows('PUBLICATION_NOT_FOUND', () => getPublication('sspub_nope'), '未知 publication → PUBLICATION_NOT_FOUND');
  }

  // 主档状态不变(publish 是物化,不动 short_stories.status)
  assertOk(getShortStory(story.id).status === 'passed', '发布后短篇主档 status 仍为 passed');

  void getDbPath;
}

await main();
console.log(failed === 0 ? '\n全部通过 ✓' : `\n${failed} 项失败 ✗`);
process.exit(failed === 0 ? 0 : 1);
