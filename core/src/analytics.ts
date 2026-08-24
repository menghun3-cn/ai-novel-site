// V8 数据分析:章节漏斗、流失分析、阅读时长、聚合指标。
//
// 数据来源:
// - chapters.view_count / finish_count (V7 discovery.ts 已采集)
// - reading_sessions (本模块新建,记录每次阅读会话)
// - favorites / subscriptions / reading_progress (V6 reader.ts 已采集)
//
// 用途:
// - 运营概览:平台总 PV/完读/收藏/订阅
// - 章节漏斗:每章的 PV 与完读,标注流失 >30% 的章节
// - 每书看板: 章节列表 + 热度趋势 + 流失警告
// - (未来) AI 分析流失原因并建议修改

import { getDb } from './db';
import { CoreError, type AnalyticsOverview, type BookFunnel, type ChapterMetric } from './domain';

// ===================== reading_sessions 表 =====================
// 轻量记录:每次打开章页时记 started;滚动到底完读时 upsert finished。
// 仅记录已完成(有结束时间)的会话用于时长统计。

interface SessionRow {
  id: number;
  book_id: string;
  chapter_number: number;
  started_at: string;
  finished_at: string | null;
  duration_sec: number | null;
}

/** 开始一次阅读会话(章页挂载即调用)。忽略重复(同书同章 30s 内)。 */
export function startReadingSession(bookId: string, chapterNumber: number): number {
  const db = getDb();
  // 防重:30s 内同书同章的未结束会话视为相同
  const cutoff = new Date(Date.now() - 30_000).toISOString();
  const existing = db
    .prepare(
      `SELECT id FROM reading_sessions
       WHERE book_id = ? AND chapter_number = ? AND started_at > ? AND finished_at IS NULL
       ORDER BY started_at DESC LIMIT 1`
    )
    .get(bookId, chapterNumber, cutoff) as { id: number } | undefined;
  if (existing) return existing.id;

  const result = db
    .prepare('INSERT INTO reading_sessions (book_id, chapter_number, started_at, finished_at, duration_sec) VALUES (?, ?, ?, NULL, NULL)')
    .run(bookId, chapterNumber, new Date().toISOString());
  return Number(result.lastInsertRowid);
}

/** 结束阅读会话(完读或离开时调用):记录结束时间与时长。 */
export function finishReadingSession(sessionId: number): void {
  const db = getDb();
  const session = db.prepare('SELECT * FROM reading_sessions WHERE id = ?').get(sessionId) as SessionRow | undefined;
  if (!session || session.finished_at !== null) return; // 已结束则幂等

  const finishedAt = new Date();
  const durationSec = Math.round((finishedAt.getTime() - new Date(session.started_at).getTime()) / 1000);
  db.prepare('UPDATE reading_sessions SET finished_at = ?, duration_sec = ? WHERE id = ?').run(
    finishedAt.toISOString(),
    Math.max(0, Math.min(durationSec, 7200)), // 上限 2h 防异常
    sessionId
  );
}

// ===================== 聚合查询 =====================

/** 平台运营总览：总 PV / 总完读 / 总收藏 / 总订阅 / 总阅读时长(分钟) / 最近 7 天活跃。 */
export function getAnalyticsOverview(): AnalyticsOverview {
  const db = getDb();

  const bookPv = (
    db.prepare('SELECT COALESCE(SUM(view_count), 0) AS n FROM books').get() as { n: number }
  ).n;
  // 章节级 PV 总和(比 book 级更细,含重读)
  const chapterPv = (
    db
      .prepare("SELECT COALESCE(SUM(view_count), 0) AS n FROM chapters WHERE status = 'published'")
      .get() as { n: number }
  ).n;
  const totalFinish = (
    db
      .prepare("SELECT COALESCE(SUM(finish_count), 0) AS n FROM chapters WHERE status = 'published'")
      .get() as { n: number }
  ).n;
  const favoriteCount = (db.prepare('SELECT COUNT(*) AS n FROM favorites').get() as { n: number }).n;
  const subscriptionCount = (db.prepare('SELECT COUNT(*) AS n FROM subscriptions').get() as { n: number }).n;
  const readerCount = (db.prepare('SELECT COUNT(*) AS n FROM users').get() as { n: number }).n;
  const bookCount = (db.prepare('SELECT COUNT(*) AS n FROM books').get() as { n: number }).n;
  const publishedCount = (
    db.prepare("SELECT COUNT(*) AS n FROM chapters WHERE status = 'published'").get() as { n: number }
  ).n;

  // 总阅读时长(分钟)
  const totalDurationMin = Math.round(
    ((db.prepare('SELECT COALESCE(SUM(duration_sec), 0) AS n FROM reading_sessions WHERE finished_at IS NOT NULL').get() as { n: number }).n) / 60
  );

  // 最近 7 天活跃:有阅读会话的独立书籍数 + 会话数
  const sevenDaysAgo = new Date(Date.now() - 7 * 86_400_000).toISOString();
  const activeReaders7d = (
    db
      .prepare(
        `SELECT COUNT(DISTINCT rp.user_id) AS n FROM reading_progress rp WHERE rp.updated_at > ?`
      )
      .get(sevenDaysAgo) as { n: number }
  ).n;
  const activeSessions7d = (
    db
      .prepare('SELECT COUNT(*) AS n FROM reading_sessions WHERE started_at > ?')
      .get(sevenDaysAgo) as { n: number }
  ).n;

  return {
    totalPv: chapterPv,
    totalBookPv: bookPv,
    totalFinish,
    totalFavorites: favoriteCount,
    totalSubscriptions: subscriptionCount,
    totalReaders: readerCount,
    totalBooks: bookCount,
    totalPublishedChapters: publishedCount,
    totalDurationMin,
    overallFinishRate: chapterPv > 0 ? Math.min(1, totalFinish / chapterPv) : 0,
    activeReaders7d,
    activeSessions7d,
  };
}

/** 单书漏斗：每章的 PV / 完读 / 完读率 + 流失标记 */
export function getBookFunnel(bookId: string): BookFunnel {
  const db = getDb();
  const book = db.prepare('SELECT id, title FROM books WHERE id = ?').get(bookId) as { id: string; title: string } | undefined;
  if (!book) throw new CoreError('BOOK_NOT_FOUND', `book not found: ${bookId}`);

  const chapters = db
    .prepare(
      `SELECT number, title, view_count, finish_count
       FROM chapters WHERE book_id = ? AND status = 'published'
       ORDER BY number ASC`
    )
    .all(bookId) as Array<{ number: number; title: string; view_count: number; finish_count: number }>;

  // 取第一章 PV 作为基线
  const baselinePv = chapters.length > 0 ? Math.max(chapters[0].view_count, 1) : 1;

  const metrics: ChapterMetric[] = chapters.map((ch, i) => {
    const finishRate = ch.view_count > 0 ? Math.min(1, ch.finish_count / ch.view_count) : 0;
    const retention = baselinePv > 0 ? Math.min(1, ch.view_count / baselinePv) : 0;
    // 流失:留存率较前一章下降 ≥30% 或完读率 <30%
    const prevRetention = i > 0 ? Math.min(1, chapters[i - 1].view_count / baselinePv) : 1;
    const dropOff = i > 0 && prevRetention - retention >= 0.30;
    const lowFinish = finishRate < 0.30 && ch.view_count >= 3;

    // 阅读时长(秒):该章所有已完成会话的平均时长
    const avgDuration = (
      db
        .prepare(
          `SELECT COALESCE(AVG(duration_sec), 0) AS n FROM reading_sessions
           WHERE book_id = ? AND chapter_number = ? AND finished_at IS NOT NULL`
        )
        .get(bookId, ch.number) as { n: number }
    ).n;

    return {
      chapterNumber: ch.number,
      title: ch.title,
      viewCount: ch.view_count,
      finishCount: ch.finish_count,
      finishRate: Math.round(finishRate * 100),
      retention: Math.round(retention * 100),
      avgDurationSec: Math.round(avgDuration),
      flagged: dropOff || lowFinish,
      flagReason: dropOff ? 'drop-off' : lowFinish ? 'low-finish' : undefined,
    };
  });

  // 书级统计
  const totalPv = metrics.reduce((s, m) => s + m.viewCount, 0);
  const totalFinish = metrics.reduce((s, m) => s + m.finishCount, 0);
  const favorites = (
    db.prepare('SELECT COUNT(*) AS n FROM favorites WHERE book_id = ?').get(bookId) as { n: number }
  ).n;
  const subscriptions = (
    db.prepare('SELECT COUNT(*) AS n FROM subscriptions WHERE book_id = ?').get(bookId) as { n: number }
  ).n;

  return {
    bookId: book.id,
    bookTitle: book.title,
    totalPv,
    totalFinish,
    overallFinishRate: totalPv > 0 ? Math.round((totalFinish / totalPv) * 100) : 0,
    favorites,
    subscriptions,
    baselinePv,
    chapters: metrics,
  };
}

/** 单书章节列表的简化指标(后台表格用) */
export function getBookChapterMetrics(bookId: string): ChapterMetric[] {
  return getBookFunnel(bookId).chapters;
}
