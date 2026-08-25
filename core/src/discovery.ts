// V7 Discovery:热度信号(阅读量/完读)记录与统计。
// 设计取向:匿名可记、写路径极轻(两条 UPDATE),评分在 getDiscoveryFeed 完成。

import { Database } from 'better-sqlite3';
import { CoreError, type BookStats, type DiscoverySection } from './domain';
import { getDb } from './db';

/** 记录章节页打开(PV):书级与章级各 +1 */
export function trackChapterView(bookId: string, chapterNumber: number): void {
  assertPublishedChapter(bookId, chapterNumber);
  const db = getDb();
  db.prepare('UPDATE books SET view_count = view_count + 1 WHERE id = ?').run(bookId);
  db.prepare("UPDATE chapters SET view_count = view_count + 1 WHERE book_id = ? AND number = ? AND status = 'published'").run(
    bookId,
    chapterNumber
  );
}

/** 记录章节完读(滚动到底):finish_count +1;重复上报按一次计由客户端节流保证 */
export function trackChapterFinish(bookId: string, chapterNumber: number): void {
  assertPublishedChapter(bookId, chapterNumber);
  getDb()
    .prepare("UPDATE chapters SET finish_count = finish_count + 1 WHERE book_id = ? AND number = ? AND status = 'published'")
    .run(bookId, chapterNumber);
}

function assertPublishedChapter(bookId: string, chapterNumber: number): void {
  if (!getDb().prepare("SELECT 1 FROM chapters WHERE book_id = ? AND number = ? AND status = 'published'").get(bookId, chapterNumber)) {
    throw new CoreError('CHAPTER_NOT_FOUND', `published chapter not found: #${chapterNumber}`);
  }
}

interface StatsRow {
  view_count: number;
  favorite_count: number;
  published_count: number;
  total_finish: number;
  total_view: number;
}

/** 书籍热度统计:总 PV、收藏数、整体完读率 */
export function getBookStats(bookId: string): BookStats {
  const row = getDb()
    .prepare(
      `SELECT b.view_count AS view_count,
         (SELECT COUNT(*) FROM favorites f WHERE f.book_id = b.id) AS favorite_count,
         (SELECT COUNT(*) FROM chapters c WHERE c.book_id = b.id AND c.status = 'published') AS published_count,
         (SELECT COALESCE(SUM(c.finish_count), 0) FROM chapters c WHERE c.book_id = b.id AND c.status = 'published') AS total_finish,
         (SELECT COALESCE(SUM(c.view_count), 0) FROM chapters c WHERE c.book_id = b.id AND c.status = 'published') AS total_view
       FROM books b WHERE b.id = ?`
    )
    .get(bookId) as StatsRow | undefined;
  if (!row) throw new CoreError('BOOK_NOT_FOUND', `book not found: ${bookId}`);
  return {
    viewCount: row.view_count,
    favoriteCount: row.favorite_count,
    finishRate: row.total_view > 0 ? Math.min(1, row.total_finish / row.total_view) : 0,
    publishedCount: row.published_count,
  };
}

/** 供 feed 查询共用的行形状 */
export interface FeedBookRow {
  id: string;
  slug: string;
  title: string;
  author_name: string;
  description: string | null;
  cover_path: string | null;
  status: string;
  category_id: string | number;
  created_at: string;
  updated_at: string;
  last_published_at: string | null;
  latest_chapter_number: number | null;
  published_count: number;
  view_count: number;
  favorite_count: number;
  finish_rate: number;
  category_name: string;
  kind: 'short' | 'long';
}

const FEED_SELECT = `SELECT b.id, b.slug, b.title, a.name AS author_name, b.description, b.cover_path, b.status,
    b.category_id AS category_id,
    b.created_at, b.updated_at,
    (SELECT MAX(c.published_at) FROM chapters c WHERE c.book_id = b.id AND c.status = 'published') AS last_published_at,
    (SELECT MAX(c.number) FROM chapters c WHERE c.book_id = b.id AND c.status = 'published') AS latest_chapter_number,
    (SELECT COUNT(*) FROM chapters c WHERE c.book_id = b.id AND c.status = 'published') AS published_count,
    b.view_count AS view_count,
    (SELECT COUNT(*) FROM favorites f WHERE f.book_id = b.id) AS favorite_count,
    CASE WHEN COALESCE((SELECT SUM(c.view_count) FROM chapters c WHERE c.book_id = b.id AND c.status = 'published'), 0) > 0
      THEN MIN(1.0, CAST((SELECT SUM(c.finish_count) FROM chapters c WHERE c.book_id = b.id AND c.status = 'published') AS REAL)
                 / (SELECT SUM(c.view_count) FROM chapters c WHERE c.book_id = b.id AND c.status = 'published'))
      ELSE 0 END AS finish_rate,
    k.name AS category_name
  FROM books b
  JOIN authors a ON a.id = b.author_id
  JOIN categories k ON k.id = b.category_id`;

function toSection(row: FeedBookRow, score = 0, reason?: string): DiscoverySection['items'][number] {
  return {
    bookId: row.id,
    slug: row.slug,
    title: row.title,
    authorName: row.author_name,
    description: row.description,
    coverPath: row.cover_path,
    categoryName: row.category_name,
    status: row.status === 'completed' ? 'completed' : 'serializing',
    publishedCount: row.published_count,
    score,
    reason,
    viewCount: row.view_count,
    favoriteCount: row.favorite_count,
    latestChapterNumber: row.latest_chapter_number,
    lastPublishedAt: row.last_published_at,
    kind: row.kind,
  };
}

/**
 * 首页 Discovery 各板块。规则打分(无 AI):
 * 热度分 = log10(1+PV)*40 + log10(1+收藏)*30 + 完读率*20 + 更新近因*10
 * - hot:热度分 TopN
 * - recent:最新更新(last_published_at 倒序)
 * - new:新书(created_at 倒序,发布章数≥1)
 * - completed:完结好书(status='completed',按完读率×收藏)
 * - today:今日推荐 = hot 与 recent 的去重混排(编辑位语义,取前几)
 */
export function getDiscoveryFeed(userId?: string): { sections: DiscoverySection[] } {
  const db = getDb();
  const all = db.prepare(`${FEED_SELECT} WHERE published_count > 0`).all() as FeedBookRow[];

  const now = Date.now();
  const scored = all.map((r) => {
    const days = r.last_published_at ? (now - new Date(r.last_published_at).getTime()) / 86_400_000 : 999;
    // 更新近因:7 天内满分,之后线性衰减到 30 天归零
    const recency = Math.max(0, 1 - Math.max(0, days - 7) / 23);
    const score =
      Math.log10(1 + r.view_count) * 40 +
      Math.log10(1 + r.favorite_count) * 30 +
      r.finish_rate * 20 +
      recency * 10;
    return { row: r, score };
  });

  const byHot = [...scored].sort((x, y) => y.score - x.score);
  const byRecent = [...scored].sort(
    (x, y) => new Date(y.row.last_published_at ?? 0).getTime() - new Date(x.row.last_published_at ?? 0).getTime()
  );
  const byNew = [...scored]
    .filter((s) => now - new Date(s.row.created_at).getTime() < 30 * 86_400_000)
    .sort((x, y) => new Date(y.row.created_at).getTime() - new Date(x.row.created_at).getTime());
  const byCompleted = scored
    .filter((s) => s.row.status === 'completed')
    .sort((x, y) => y.row.finish_rate * 100 + Math.log10(1 + y.row.favorite_count) * 10 - (x.row.finish_rate * 100 + Math.log10(1 + x.row.favorite_count) * 10));

  const sections: DiscoverySection[] = [
    {
      key: 'today',
      title: '今日推荐',
      items: dedupe([...byHot.slice(0, 3), ...byRecent.filter((s) => !byHot.slice(0, 3).includes(s)).slice(0, 2)]).map((s) =>
        toSection(s.row, s.score)
      ),
    },
    { key: 'hot', title: '热门小说', items: byHot.slice(0, 6).map((s) => toSection(s.row, s.score)) },
    { key: 'recent', title: '最新更新', items: byRecent.slice(0, 6).map((s) => toSection(s.row, s.score)) },
    {
      key: 'new',
      title: '新书推荐',
      items: (byNew.length > 0 ? byNew : byRecent).slice(0, 4).map((s) => toSection(s.row, s.score)),
    },
    { key: 'completed', title: '完结好书', items: byCompleted.slice(0, 4).map((s) => toSection(s.row, s.score)) },
  ];

  if (userId) sections.push(buildForYou(db, userId, scored));
  return { sections };
}

function dedupe(list: Array<{ row: FeedBookRow; score: number }>): Array<{ row: FeedBookRow; score: number }> {
  const seen = new Set<string>();
  return list.filter((s) => (seen.has(s.row.id) ? false : (seen.add(s.row.id), true)));
}

/** 猜你喜欢:按读者已收藏/订阅/读过的书的分类聚合,推同分类未读书,按热度分排 */
function buildForYou(db: Database, userId: string, scored: Array<{ row: FeedBookRow; score: number }>): DiscoverySection {
  const catIds = new Set<string>(
    (
      db
        .prepare(
          `SELECT DISTINCT b.category_id AS category_id FROM favorites f JOIN books b ON b.id = f.book_id WHERE f.user_id = ?
           UNION
           SELECT DISTINCT b.category_id AS category_id FROM subscriptions s JOIN books b ON b.id = s.book_id WHERE s.user_id = ?`
        )
        .all(userId, userId) as Array<{ category_id: string | number }>
    ).map((r) => String(r.category_id))
  );
  // 已读/已收藏/已订阅的书不再推(书架与继续阅读位负责召回)
  const excluded = new Set<string>(
    (
      db
        .prepare(
          `SELECT book_id AS id FROM favorites WHERE user_id = ?
           UNION SELECT book_id AS id FROM subscriptions WHERE user_id = ?
           UNION SELECT DISTINCT book_id AS id FROM reading_progress WHERE user_id = ?`
        )
        .all(userId, userId, userId) as Array<{ id: string }>
    ).map((r) => r.id)
  );

  let picks: Array<{ row: FeedBookRow; score: number }>;
  if (catIds.size > 0) {
    picks = scored.filter((s) => catIds.has(String(s.row.category_id)) && !excluded.has(s.row.id)).slice(0, 6);
    if (picks.length === 0) picks = scored.filter((s) => !excluded.has(s.row.id)).slice(0, 6); // 同分类无候选→全局未读热门
    if (picks.length === 0) picks = scored.slice(0, 6); // 极端兜底
  } else {
    picks = scored.slice(0, 6); // 新读者:热门兜底
  }

  const catNames = new Map<string, string>(
    (db.prepare('SELECT id, name FROM categories').all() as Array<{ id: string | number; name: string }>).map((c) => [
      String(c.id),
      c.name,
    ])
  );

  return {
    key: 'foryou',
    title: '猜你喜欢',
    items: picks.map((s) => toSection(s.row, s.score, catNames.get(String(s.row.category_id)))),
  };
}
