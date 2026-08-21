// Content Core 服务层:所有内容读写都经由这里,统一发布可见性判定

import { getDb } from './db';
import {
  isBookStatus,
  isChapterStatus,
  type Book,
  type BookStatus,
  type BookWithMeta,
  type CategoryWithCount,
  type Chapter,
  type ChapterStatus,
  type ChapterView,
  type FeedItem,
  type ImportChapterInput,
  type ImportChapterResult,
  type Tag,
  type UpdateItem,
  type UpsertBookInput,
} from './domain';

// ---------- 工具 ----------

function nowIso(): string {
  return new Date().toISOString();
}

export function slugifyName(name: string): string {
  return name.trim().replace(/\s+/g, '-').toLowerCase();
}

export function bookIdFromSlug(slug: string): string {
  return 'book_' + slug.replace(/-/g, '');
}

export function chapterId(bookId: string, number: number): string {
  return `${bookId}_ch${number}`;
}

// ---------- 行类型与映射 ----------

interface BookRow {
  id: string;
  slug: string;
  title: string;
  description: string | null;
  cover_path: string | null;
  status: BookStatus;
  author_id: number;
  category_id: number;
  created_at: string;
  updated_at: string;
}

function toBook(r: BookRow): Book {
  return {
    id: r.id,
    slug: r.slug,
    title: r.title,
    description: r.description,
    coverPath: r.cover_path,
    status: r.status,
    authorId: r.author_id,
    categoryId: r.category_id,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
}

interface BookMetaRow extends BookRow {
  author_name: string;
  category_name: string;
  chapter_count: number;
  published_count: number;
  latest_chapter_number: number | null;
  latest_chapter_title: string | null;
  latest_published_at: string | null;
}

interface ChapterRow {
  id: string;
  book_id: string;
  number: number;
  title: string;
  slug: string | null;
  content_md: string;
  status: ChapterStatus;
  scheduled_at: string | null;
  published_at: string | null;
  created_at: string;
  updated_at: string;
}

function toChapter(r: ChapterRow): Chapter {
  return {
    id: r.id,
    bookId: r.book_id,
    number: r.number,
    title: r.title,
    slug: r.slug,
    contentMd: r.content_md,
    status: r.status,
    scheduledAt: r.scheduled_at,
    publishedAt: r.published_at,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
}

// 小说列表基础 SQL(含聚合元数据),WHERE 与 ORDER 由调用方拼接
const BOOK_LIST_SQL = `
SELECT b.*,
       a.name AS author_name,
       c.name AS category_name,
       (SELECT COUNT(*) FROM chapters ch WHERE ch.book_id = b.id) AS chapter_count,
       (SELECT COUNT(*) FROM chapters ch WHERE ch.book_id = b.id AND ch.status = 'published') AS published_count,
       (SELECT ch.number FROM chapters ch WHERE ch.book_id = b.id AND ch.status = 'published' ORDER BY ch.number DESC LIMIT 1) AS latest_chapter_number,
       (SELECT ch.title FROM chapters ch WHERE ch.book_id = b.id AND ch.status = 'published' ORDER BY ch.number DESC LIMIT 1) AS latest_chapter_title,
       (SELECT ch.published_at FROM chapters ch WHERE ch.book_id = b.id AND ch.status = 'published' ORDER BY ch.number DESC LIMIT 1) AS latest_published_at
FROM books b
JOIN authors a ON a.id = b.author_id
JOIN categories c ON c.id = b.category_id`;

function tagsForBooks(bookIds: string[]): Map<string, string[]> {
  if (bookIds.length === 0) return new Map();
  const db = getDb();
  const placeholders = bookIds.map(() => '?').join(',');
  const rows = db
    .prepare(
      `SELECT bt.book_id AS book_id, t.name AS name
       FROM book_tags bt JOIN tags t ON t.id = bt.tag_id
       WHERE bt.book_id IN (${placeholders})
       ORDER BY t.name`
    )
    .all(...bookIds) as { book_id: string; name: string }[];
  const map = new Map<string, string[]>();
  for (const r of rows) {
    const list = map.get(r.book_id) ?? [];
    list.push(r.name);
    map.set(r.book_id, list);
  }
  return map;
}

function toBookWithMeta(r: BookMetaRow, tags: Map<string, string[]>): BookWithMeta {
  return {
    ...toBook(r),
    authorName: r.author_name,
    categoryName: r.category_name,
    tags: tags.get(r.id) ?? [],
    chapterCount: r.chapter_count,
    publishedCount: r.published_count,
    latestChapterNumber: r.latest_chapter_number,
    latestChapterTitle: r.latest_chapter_title,
    latestPublishedAt: r.latest_published_at,
  };
}

function mapBookRows(rows: BookMetaRow[]): BookWithMeta[] {
  const tags = tagsForBooks(rows.map((r) => r.id));
  return rows.map((r) => toBookWithMeta(r, tags));
}

// ---------- 写入:作者 / 分类 / 标签 / 小说 / 章节 ----------

export function upsertAuthor(name: string): number {
  const db = getDb();
  const row = db.prepare('SELECT id FROM authors WHERE name = ?').get(name) as { id: number } | undefined;
  if (row) return row.id;
  const res = db.prepare('INSERT INTO authors (name) VALUES (?)').run(name);
  return Number(res.lastInsertRowid);
}

export function upsertCategory(name: string): { id: number; slug: string } {
  const db = getDb();
  const slug = slugifyName(name);
  const row = db
    .prepare('SELECT id, slug FROM categories WHERE name = ?')
    .get(name) as { id: number; slug: string } | undefined;
  if (row) return row;
  const res = db.prepare('INSERT INTO categories (slug, name) VALUES (?, ?)').run(slug, name);
  return { id: Number(res.lastInsertRowid), slug };
}

export function upsertTag(name: string): number {
  const db = getDb();
  const slug = slugifyName(name);
  const row = db.prepare('SELECT id FROM tags WHERE name = ?').get(name) as { id: number } | undefined;
  if (row) return row.id;
  const res = db.prepare('INSERT INTO tags (slug, name) VALUES (?, ?)').run(slug, name);
  return Number(res.lastInsertRowid);
}

export function setBookTags(bookId: string, tagNames: string[]): void {
  const db = getDb();
  db.prepare('DELETE FROM book_tags WHERE book_id = ?').run(bookId);
  const insert = db.prepare('INSERT OR IGNORE INTO book_tags (book_id, tag_id) VALUES (?, ?)');
  for (const name of tagNames) insert.run(bookId, upsertTag(name));
}

/** 幂等:按 slug 判断存在则更新,否则插入;标签全量重建 */
export function upsertBook(input: UpsertBookInput): Book {
  const db = getDb();
  const now = nowIso();
  const authorId = upsertAuthor(input.authorName);
  const categoryId = upsertCategory(input.categoryName).id;
  const status: BookStatus = isBookStatus(input.status) ? input.status : 'serializing';

  const existing = db.prepare('SELECT * FROM books WHERE slug = ?').get(input.slug) as BookRow | undefined;
  const id = existing ? existing.id : input.id || bookIdFromSlug(input.slug);

  if (existing) {
    db.prepare(
      `UPDATE books SET title = ?, description = ?, cover_path = ?, status = ?, author_id = ?, category_id = ?, updated_at = ?
       WHERE slug = ?`
    ).run(
      input.title,
      input.description ?? null,
      input.coverPath ?? null,
      status,
      authorId,
      categoryId,
      now,
      input.slug
    );
  } else {
    db.prepare(
      `INSERT INTO books (id, slug, title, description, cover_path, status, author_id, category_id, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(
      id,
      input.slug,
      input.title,
      input.description ?? null,
      input.coverPath ?? null,
      status,
      authorId,
      categoryId,
      now,
      now
    );
  }

  setBookTags(id, input.tags);
  return getBookRow(id)!;
}

/** 幂等:按 (book_id, number) 判断存在则更新,否则插入;首次发布记录 publishedAt 不因重复导入而改变 */
export function importChapter(input: ImportChapterInput): ImportChapterResult {
  const db = getDb();
  const now = nowIso();
  const status: ChapterStatus = isChapterStatus(input.status) ? input.status : 'draft';

  const existing = db
    .prepare('SELECT * FROM chapters WHERE book_id = ? AND number = ?')
    .get(input.bookId, input.number) as ChapterRow | undefined;

  if (existing) {
    const publishedAt =
      input.publishedAt ??
      (status === 'published' ? (existing.published_at ?? now) : existing.published_at);
    db.prepare(
      `UPDATE chapters
       SET title = ?, slug = ?, content_md = ?, status = ?, scheduled_at = ?, published_at = ?, updated_at = ?
       WHERE id = ?`
    ).run(
      input.title,
      input.slug ?? null,
      input.contentMd,
      status,
      input.scheduledAt ?? existing.scheduled_at,
      publishedAt,
      now,
      existing.id
    );
    return { added: false };
  }

  const publishedAt = input.publishedAt ?? (status === 'published' ? now : null);
  db.prepare(
    `INSERT INTO chapters (id, book_id, number, title, slug, content_md, status, scheduled_at, published_at, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    chapterId(input.bookId, input.number),
    input.bookId,
    input.number,
    input.title,
    input.slug ?? null,
    input.contentMd,
    status,
    input.scheduledAt ?? null,
    publishedAt,
    now,
    now
  );
  return { added: true };
}

// ---------- 查询 ----------

function getBookRow(id: string): Book | null {
  const db = getDb();
  const row = db.prepare('SELECT * FROM books WHERE id = ?').get(id) as BookRow | undefined;
  return row ? toBook(row) : null;
}

export function getBookBySlug(slug: string): BookWithMeta | null {
  const db = getDb();
  const row = db
    .prepare(`${BOOK_LIST_SQL} WHERE b.slug = ?`)
    .get(slug) as BookMetaRow | undefined;
  return row ? mapBookRows([row])[0] : null;
}

export function getBookById(id: string): BookWithMeta | null {
  const db = getDb();
  const row = db
    .prepare(`${BOOK_LIST_SQL} WHERE b.id = ?`)
    .get(id) as BookMetaRow | undefined;
  return row ? mapBookRows([row])[0] : null;
}

export interface ListBooksOptions {
  categorySlug?: string;
  q?: string;
  limit?: number;
  offset?: number;
}

/** 小说列表:支持分类筛选、书名/作者/标签模糊搜索 */
export function listBooks(opts: ListBooksOptions = {}): BookWithMeta[] {
  const db = getDb();
  const where: string[] = [];
  const params: unknown[] = [];
  if (opts.categorySlug) {
    where.push('c.slug = ?');
    params.push(opts.categorySlug);
  }
  if (opts.q) {
    where.push(
      `(b.title LIKE ? OR a.name LIKE ? OR EXISTS (
        SELECT 1 FROM book_tags bt JOIN tags t ON t.id = bt.tag_id
        WHERE bt.book_id = b.id AND t.name LIKE ?
      ))`
    );
    const like = `%${opts.q}%`;
    params.push(like, like, like);
  }
  const sql = `${BOOK_LIST_SQL}${where.length ? ` WHERE ${where.join(' AND ')}` : ''}
    ORDER BY latest_published_at DESC, b.updated_at DESC
    LIMIT ? OFFSET ?`;
  const rows = db
    .prepare(sql)
    .all(...params, opts.limit ?? 100, opts.offset ?? 0) as BookMetaRow[];
  return mapBookRows(rows);
}

export function searchBooks(q: string): BookWithMeta[] {
  return listBooks({ q });
}

export function listCategories(): CategoryWithCount[] {
  const db = getDb();
  return db
    .prepare(
      `SELECT c.slug AS slug, c.name AS name, COUNT(b.id) AS count
       FROM categories c LEFT JOIN books b ON b.category_id = c.id
       GROUP BY c.id
       ORDER BY count DESC, c.name`
    )
    .all() as unknown as CategoryWithCount[];
}

export function listTags(): Tag[] {
  const db = getDb();
  return db.prepare('SELECT id, slug, name FROM tags ORDER BY name').all() as unknown as Tag[];
}

/** 只返回已发布章节,按 number 升序 */
export function listPublishedChapters(bookId: string): Chapter[] {
  const db = getDb();
  const rows = db
    .prepare(
      `SELECT * FROM chapters WHERE book_id = ? AND status = 'published' ORDER BY number ASC`
    )
    .all(bookId) as ChapterRow[];
  return rows.map(toChapter);
}

/** 阅读页:只允许访问已发布章节;附上一章/下一章 */
export function getChapterView(bookSlug: string, number: number): ChapterView | null {
  const db = getDb();
  const book = getBookBySlug(bookSlug);
  if (!book) return null;
  const chapter = db
    .prepare(
      `SELECT * FROM chapters WHERE book_id = ? AND number = ? AND status = 'published'`
    )
    .get(book.id, number) as ChapterRow | undefined;
  if (!chapter) return null;
  const prev = db
    .prepare(
      `SELECT * FROM chapters WHERE book_id = ? AND number < ? AND status = 'published' ORDER BY number DESC LIMIT 1`
    )
    .get(book.id, number) as ChapterRow | undefined;
  const next = db
    .prepare(
      `SELECT * FROM chapters WHERE book_id = ? AND number > ? AND status = 'published' ORDER BY number ASC LIMIT 1`
    )
    .get(book.id, number) as ChapterRow | undefined;
  return {
    book,
    chapter: toChapter(chapter),
    prev: prev ? toChapter(prev) : null,
    next: next ? toChapter(next) : null,
  };
}

/** 首页「最新更新」:最近发布的章节 */
export function latestUpdates(limit = 10): UpdateItem[] {
  const db = getDb();
  const rows = db
    .prepare(
      `SELECT ch.*, b.slug AS bookSlug, b.title AS bookTitle
       FROM chapters ch JOIN books b ON b.id = ch.book_id
       WHERE ch.status = 'published'
       ORDER BY ch.published_at DESC, ch.number DESC
       LIMIT ?`
    )
    .all(limit) as (ChapterRow & { bookSlug: string; bookTitle: string })[];
  return rows.map((r) => ({
    bookId: r.book_id,
    bookSlug: r.bookSlug,
    bookTitle: r.bookTitle,
    chapter: toChapter(r),
  }));
}

/** 首页「今日推荐」:取最新章节的书(连载中优先) */
export function featuredBook(): BookWithMeta | null {
  const top = latestUpdates(1)[0];
  if (!top) return null;
  const book = getBookById(top.bookId);
  if (!book) return null;
  return book;
}

/** RSS 条目:最近发布的章节 */
export function rssItems(limit = 20): FeedItem[] {
  const db = getDb();
  const rows = db
    .prepare(
      `SELECT b.id AS bookId, b.slug AS bookSlug, b.title AS bookTitle,
              ch.number AS chapterNumber, ch.title AS chapterTitle, ch.published_at AS publishedAt
       FROM chapters ch JOIN books b ON b.id = ch.book_id
       WHERE ch.status = 'published'
       ORDER BY ch.published_at DESC, ch.number DESC
       LIMIT ?`
    )
    .all(limit) as unknown as FeedItem[];
  return rows;
}

/** 统计某本书的章节总数(含全部状态) */
export function countChapters(bookId: string): number {
  const db = getDb();
  const row = db
    .prepare('SELECT COUNT(*) AS n FROM chapters WHERE book_id = ?')
    .get(bookId) as { n: number };
  return row.n;
}
