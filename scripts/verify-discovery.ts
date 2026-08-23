/**
 * V7 Discovery 验证:热度信号记录 + 规则推荐各板块。
 * 运行:npm run test:discovery
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

process.env.NOVEL_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'novel-discovery-'));

const core = await import('@novel/core');
const { getDb } = core;

let failed = 0;
function assertOk(cond: boolean, name: string): void {
  console.log(`${cond ? '✓' : '✗'} ${name}`);
  if (!cond) failed++;
}
async function assertThrows(code: string, fn: () => unknown | Promise<unknown>, name: string): Promise<void> {
  try {
    await fn();
    assertOk(false, `${name}(未抛错)`);
  } catch (e) {
    assertOk(e instanceof core.CoreError && e.code === code, name);
  }
}

// ---------- 种子:3 本书(2 科幻连载 + 1 完结),章数与发布时间不同 ----------
function seedBook(slug: string, title: string, category: string, chapters: number[], status: 'serializing' | 'completed', daysAgoCreated: number, daysAgoPublished: number) {
  const book = core.createBook({ slug, title, authorName: '测', categoryName: category, tags: [] });
  for (let i = 0; i < chapters.length; i++) {
    core.createChapter({ bookId: book.id, number: i + 1, title: `第${i + 1}章`, contentMd: `# 第${i + 1}章\n\n` + '正文'.repeat(300) });
    core.submitChapterForReview(book.id, i + 1);
    core.approveChapter(book.id, i + 1, { mode: 'now' });
  }
  // 回填创建/发布时间以模拟新旧书
  const db = getDb();
  db.prepare('UPDATE books SET created_at = ?, updated_at = ? WHERE id = ?').run(
    new Date(Date.now() - daysAgoCreated * 86_400_000).toISOString(),
    new Date(Date.now() - daysAgoCreated * 86_400_000).toISOString(),
    book.id
  );
  const pub = new Date(Date.now() - daysAgoPublished * 86_400_000).toISOString();
  db.prepare("UPDATE chapters SET published_at = ? WHERE book_id = ?").run(pub, book.id);
  if (status === 'completed') db.prepare('UPDATE books SET status = ? WHERE id = ?').run('completed', book.id);
  return book;
}

const hotBook = seedBook('d-hot', '热门之书', '科幻', [1, 2, 3], 'serializing', 100, 1);
const staleBook = seedBook('d-stale', '沉寂之书', '都市', [1], 'serializing', 200, 90);
const doneBook = seedBook('d-done', '完结好书', '科幻', [1, 2], 'completed', 300, 30);

// ---------- 信号记录 ----------
{
  await assertThrows('CHAPTER_NOT_FOUND', () => core.trackChapterView(hotBook.id, 99), '未发布章 PV → CHAPTER_NOT_FOUND');
  await assertThrows('CHAPTER_NOT_FOUND', () => core.trackChapterFinish(hotBook.id, 0), '非法章号完读 → CHAPTER_NOT_FOUND');

  for (let i = 0; i < 5; i++) core.trackChapterView(hotBook.id, 1); // 热门书第1章 5 PV
  core.trackChapterView(hotBook.id, 2);
  core.trackChapterFinish(hotBook.id, 1); // 1 次完读
  core.trackChapterView(doneBook.id, 1);

  const st = core.getBookStats(hotBook.id);
  assertOk(st.viewCount === 6 && st.favoriteCount === 0, `统计 PV=6(${st.viewCount})`);
  assertOk(st.finishRate > 0 && st.finishRate <= 1, `完读率 ${st.finishRate.toFixed(2)} 在 (0,1]`);
  await assertThrows('BOOK_NOT_FOUND', () => core.getBookStats('book_nope'), '未知书统计 → BOOK_NOT_FOUND');

  // 收藏计数进统计
  const me = (() => {
    const u = core.registerReader({ username: 'discovery读友', email: 'd@x.com', password: 'password123' });
    return u.user;
  })();
  core.toggleFavorite(me.id, hotBook.id);
  assertOk(core.getBookStats(hotBook.id).favoriteCount === 1, '收藏计入 favoriteCount');
}

// ---------- Discovery 板块 ----------
{
  const { sections } = core.getDiscoveryFeed();
  const keys = sections.map((s) => s.key);
  assertOk(keys.join(',') === 'today,hot,recent,new,completed', `板块顺序 ${keys.join('/')}`);
  const hot = sections.find((s) => s.key === 'hot');
  assertOk(hot?.items[0]?.slug === 'd-hot', `热门榜首=热门之书(${hot?.items[0]?.title})`);
  const recent = sections.find((s) => s.key === 'recent');
  assertOk(recent?.items[0]?.slug === 'd-hot' || recent?.items[0]?.slug === 'd-done', `最新更新首位合理(${recent?.items[0]?.slug})`);
  const todaySlugs = sections.find((s) => s.key === 'today')?.items.map((i) => i.slug) ?? [];
  assertOk(todaySlugs.includes('d-hot'), `今日推荐含热门之书(${todaySlugs.join(',')})`);
  assertOk(todaySlugs.length === new Set(todaySlugs).size, '今日推荐无重复');
}

// ---------- 登录后 猜你喜欢 ----------
{
  const me = core.getSessionReader(core.loginReader({ login: 'd@x.com', password: 'password123' }).token);
  core.toggleSubscription(me.id, hotBook.id); // 订阅科幻 → 应推同分类的完结好书
  const { sections } = core.getDiscoveryFeed(me.id);
  const fy = sections.find((s) => s.key === 'foryou');
  assertOk(Boolean(fy), '登录后出现 猜你喜欢 板块');
  assertOk((fy?.items.length ?? 0) > 0, `猜你喜欢有内容(${fy?.items.length} 条)`);
  assertOk(!fy!.items.some((i) => i.bookId === hotBook.id), '猜你喜欢不推已订阅的书');
}

console.log(failed === 0 ? '\nDiscovery 全部验证通过' : `\n${failed} 项失败`);
process.exit(failed === 0 ? 0 : 1);
