// Content Core 服务层:所有内容读写都经由这里,统一发布可见性判定

import { getDb } from './db';
import {
  CoreError,
  isBookStatus,
  isChapterStatus,
  type ApproveChapterInput,
  type Author,
  type AuthorWithCount,
  type AutopilotConfig,
  type Book,
  type BookStatus,
  type BookWithMeta,
  type Category,
  type CategoryWithCount,
  type Chapter,
  type ChapterStatus,
  type ChapterView,
  type ConfigureAutopilotPatch,
  type CreateBookInput,
  type CreateChapterInput,
  type FeedItem,
  type ImportChapterInput,
  type ImportChapterResult,
  type ListAllBooksOptions,
  type PublishCycleResult,
  type ReviewQueueItem,
  type Tag,
  type UpdateAuthorPatch,
  type UpdateCategoryPatch,
  type UpdateChapterPatch,
  type UpdateTagPatch,
  type UpdateItem,
  type UpdateBookPatch,
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
  autopilot_enabled: number;
  autopilot_hour: number;
  autopilot_count: number;
  autopilot_last_date: string | null;
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
  pending_review_count: number;
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
  review_note: string | null;
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
    reviewNote: r.review_note ?? null,
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
       (SELECT COUNT(*) FROM chapters ch WHERE ch.book_id = b.id AND ch.status = 'pending_review') AS pending_review_count,
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
    pendingReviewCount: r.pending_review_count,
    latestChapterNumber: r.latest_chapter_number,
    latestChapterTitle: r.latest_chapter_title,
    latestPublishedAt: r.latest_published_at,
  };
}

function mapBookRows(rows: BookMetaRow[]): BookWithMeta[] {
  const tags = tagsForBooks(rows.map((r) => r.id));
  return rows.map((r) => toBookWithMeta(r, tags));
}

/** 公开可见性:隐藏书籍不出现任何公开面(列表/详情/更新流/RSS) */
const PUBLIC_BOOK_VISIBLE = `b.status <> 'hidden'`;

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
    .prepare(`${BOOK_LIST_SQL} WHERE b.slug = ? AND ${PUBLIC_BOOK_VISIBLE}`)
    .get(slug) as BookMetaRow | undefined;
  return row ? mapBookRows([row])[0] : null;
}

/** 公开语义:隐藏书籍视为不存在 */
export function getBookById(id: string): BookWithMeta | null {
  const db = getDb();
  const row = db
    .prepare(`${BOOK_LIST_SQL} WHERE b.id = ? AND ${PUBLIC_BOOK_VISIBLE}`)
    .get(id) as BookMetaRow | undefined;
  return row ? mapBookRows([row])[0] : null;
}

export interface ListBooksOptions {
  categorySlug?: string;
  q?: string;
  limit?: number;
  offset?: number;
}

/** 小说列表(公开):隐藏书籍不可见;支持分类筛选、书名/作者/标签模糊搜索 */
export function listBooks(opts: ListBooksOptions = {}): BookWithMeta[] {
  const db = getDb();
  const where: string[] = [PUBLIC_BOOK_VISIBLE];
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

/** 首页「最新更新」:最近发布的章节(隐藏书籍除外) */
export function latestUpdates(limit = 10): UpdateItem[] {
  const db = getDb();
  const rows = db
    .prepare(
      `SELECT ch.*, b.slug AS bookSlug, b.title AS bookTitle
       FROM chapters ch JOIN books b ON b.id = ch.book_id
       WHERE ch.status = 'published' AND ${PUBLIC_BOOK_VISIBLE}
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

/** RSS 条目:最近发布的章节(隐藏书籍除外) */
export function rssItems(limit = 20): FeedItem[] {
  const db = getDb();
  const rows = db
    .prepare(
      `SELECT b.id AS bookId, b.slug AS bookSlug, b.title AS bookTitle,
              ch.number AS chapterNumber, ch.title AS chapterTitle, ch.published_at AS publishedAt
       FROM chapters ch JOIN books b ON b.id = ch.book_id
       WHERE ch.status = 'published' AND ${PUBLIC_BOOK_VISIBLE}
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

// ---------- 管理侧:小说(V2 Content Management) ----------

/** 管理语义:包含隐藏书籍 */
export function getAnyBookById(id: string): BookWithMeta | null {
  const db = getDb();
  const row = db.prepare(`${BOOK_LIST_SQL} WHERE b.id = ?`).get(id) as BookMetaRow | undefined;
  return row ? mapBookRows([row])[0] : null;
}

/** 新建小说;slug 冲突抛 SLUG_TAKEN(与导入器的幂等 upsert 不同,管理侧要求显式新建) */
export function createBook(input: CreateBookInput): BookWithMeta {
  const db = getDb();
  if (!input.slug.trim()) throw new CoreError('SLUG_TAKEN', 'slug is required');
  const existing = db.prepare('SELECT id FROM books WHERE slug = ?').get(input.slug);
  if (existing) throw new CoreError('SLUG_TAKEN', `slug already exists: ${input.slug}`);
  upsertBook({
    id: bookIdFromSlug(input.slug),
    slug: input.slug,
    title: input.title,
    description: input.description ?? null,
    coverPath: input.coverPath ?? null,
    status: input.status,
    authorName: input.authorName,
    categoryName: input.categoryName,
    tags: input.tags ?? [],
  });
  return getAnyBookById(bookIdFromSlug(input.slug))!;
}

/** 按 id 编辑小说;仅提供的字段生效;tags 提供时全量重建;隐藏/恢复走 status */
export function updateBook(id: string, patch: UpdateBookPatch): BookWithMeta {
  const db = getDb();
  const row = db.prepare('SELECT * FROM books WHERE id = ?').get(id) as BookRow | undefined;
  if (!row) throw new CoreError('BOOK_NOT_FOUND', `book not found: ${id}`);

  const authorId = patch.authorName !== undefined ? upsertAuthor(patch.authorName) : row.author_id;
  const categoryId =
    patch.categoryName !== undefined ? upsertCategory(patch.categoryName).id : row.category_id;
  let status = row.status;
  if (patch.status !== undefined) {
    if (!isBookStatus(patch.status)) throw new CoreError('INVALID_STATUS', String(patch.status));
    status = patch.status;
  }

  db.prepare(
    `UPDATE books SET title = ?, description = ?, cover_path = ?, status = ?, author_id = ?, category_id = ?, updated_at = ?
     WHERE id = ?`
  ).run(
    patch.title ?? row.title,
    patch.description !== undefined ? patch.description : row.description,
    patch.coverPath !== undefined ? patch.coverPath : row.cover_path,
    status,
    authorId,
    categoryId,
    nowIso(),
    id
  );
  if (patch.tags !== undefined) setBookTags(id, patch.tags);
  return getAnyBookById(id)!;
}

/** 删除小说及其全部章节、标签关联;返回是否删除了东西 */
export function deleteBook(id: string): boolean {
  const db = getDb();
  const tx = db.transaction((): boolean => {
    const row = db.prepare('SELECT id FROM books WHERE id = ?').get(id);
    if (!row) return false;
    db.prepare('DELETE FROM chapters WHERE book_id = ?').run(id);
    db.prepare('DELETE FROM book_tags WHERE book_id = ?').run(id);
    db.prepare('DELETE FROM books WHERE id = ?').run(id);
    return true;
  });
  return tx();
}

/**
 * 管理列表:不做隐藏过滤,可按精确状态筛选。
 * 与公开 listBooks 的区别即「后台看得到下架书」。
 */
export function listAllBooks(opts: ListAllBooksOptions = {}): BookWithMeta[] {
  const db = getDb();
  const where: string[] = [];
  const params: unknown[] = [];
  if (opts.status) {
    if (!isBookStatus(opts.status)) throw new CoreError('INVALID_STATUS', String(opts.status));
    where.push('b.status = ?');
    params.push(opts.status);
  }
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

// ---------- 管理侧:章节 ----------

/** 全状态章节列表(含草稿/定时/隐藏),按章号升序 */
export function listChapters(bookId: string): Chapter[] {
  const db = getDb();
  const rows = db
    .prepare('SELECT * FROM chapters WHERE book_id = ? ORDER BY number ASC')
    .all(bookId) as ChapterRow[];
  return rows.map(toChapter);
}

/** 单章(任意状态);不存在返回 null */
export function getChapterByNumber(bookId: string, number: number): Chapter | null {
  const db = getDb();
  const row = db
    .prepare('SELECT * FROM chapters WHERE book_id = ? AND number = ?')
    .get(bookId, number) as ChapterRow | undefined;
  return row ? toChapter(row) : null;
}

/** 新建章节;number 缺省自动接排在最大章号之后;冲突抛 CHAPTER_NUMBER_CONFLICT */
export function createChapter(input: CreateChapterInput): Chapter {
  const db = getDb();
  if (!db.prepare('SELECT id FROM books WHERE id = ?').get(input.bookId)) {
    throw new CoreError('BOOK_NOT_FOUND', `book not found: ${input.bookId}`);
  }
  let number = input.number;
  if (number === undefined) {
    const row = db
      .prepare('SELECT COALESCE(MAX(number), 0) + 1 AS next FROM chapters WHERE book_id = ?')
      .get(input.bookId) as { next: number };
    number = row.next;
  } else if (db.prepare('SELECT id FROM chapters WHERE book_id = ? AND number = ?').get(input.bookId, number)) {
    throw new CoreError('CHAPTER_NUMBER_CONFLICT', `${input.bookId} chapter ${number} exists`);
  }

  const status: ChapterStatus = isChapterStatus(input.status) ? input.status : 'draft';
  importChapter({
    bookId: input.bookId,
    number,
    title: input.title,
    contentMd: input.contentMd,
    slug: input.slug ?? null,
    status,
    scheduledAt: input.scheduledAt ?? null,
  });
  return getChapterByNumber(input.bookId, number)!;
}

/**
 * 编辑章节。状态转换语义:
 * - → published:首次发布记 publishedAt,重复编辑不改变首次发布时间(与导入一致)
 * - → draft:取消定时(scheduledAt 清空),publishedAt 历史保留
 * - → hidden(下线):publishedAt 保留,scheduledAt 仅在显式提供时生效
 * - scheduled 状态保留/更新 scheduledAt
 */
export function updateChapter(bookId: string, number: number, patch: UpdateChapterPatch): Chapter {
  const db = getDb();
  const existing = db
    .prepare('SELECT * FROM chapters WHERE book_id = ? AND number = ?')
    .get(bookId, number) as ChapterRow | undefined;
  if (!existing) throw new CoreError('CHAPTER_NOT_FOUND', `${bookId} chapter ${number}`);

  let status = existing.status;
  if (patch.status !== undefined) {
    if (!isChapterStatus(patch.status)) throw new CoreError('INVALID_STATUS', String(patch.status));
    status = patch.status;
  }
  const scheduledAt =
    patch.scheduledAt !== undefined ? patch.scheduledAt : status === 'scheduled' ? existing.scheduled_at : null;
  const publishedAt = existing.published_at ?? (status === 'published' ? nowIso() : null);

  db.prepare(
    `UPDATE chapters
     SET title = ?, slug = ?, content_md = ?, status = ?, scheduled_at = ?, published_at = ?, updated_at = ?
     WHERE id = ?`
  ).run(
    patch.title ?? existing.title,
    patch.slug !== undefined ? patch.slug : existing.slug,
    patch.contentMd ?? existing.content_md,
    status,
    scheduledAt,
    publishedAt,
    nowIso(),
    existing.id
  );
  return getChapterByNumber(bookId, number)!;
}

/** 删除单章;返回是否删除了东西 */
export function deleteChapter(bookId: string, number: number): boolean {
  const db = getDb();
  const res = db.prepare('DELETE FROM chapters WHERE book_id = ? AND number = ?').run(bookId, number);
  return res.changes > 0;
}

// ---------- V3:审核工作流 ----------

function getChapterRow(bookId: string, number: number): ChapterRow {
  const db = getDb();
  const row = db
    .prepare('SELECT * FROM chapters WHERE book_id = ? AND number = ?')
    .get(bookId, number) as ChapterRow | undefined;
  if (!row) throw new CoreError('CHAPTER_NOT_FOUND', `${bookId} chapter ${number}`);
  return row;
}

function touchBook(bookId: string, at: string): void {
  getDb()
    .prepare('UPDATE books SET updated_at = ? WHERE id = ?')
    .run(at, bookId);
}

/** 送审:draft → pending_review;清空旧驳回备注与遗留定时 */
export function submitChapterForReview(bookId: string, number: number): Chapter {
  const db = getDb();
  const row = getChapterRow(bookId, number);
  if (row.status !== 'draft') {
    throw new CoreError('INVALID_REVIEW_TRANSITION', `only draft chapters can be submitted (current: ${row.status})`);
  }
  const at = nowIso();
  db.prepare("UPDATE chapters SET status = 'pending_review', scheduled_at = NULL, review_note = NULL, updated_at = ? WHERE id = ?").run(
    at,
    row.id
  );
  touchBook(bookId, at);
  return getChapterByNumber(bookId, number)!;
}

/**
 * 批准:pending_review → published(立即,首次发布时间记为当前)或 scheduled(必须给 scheduledAt)。
 * 驳回备注清空。
 */
export function approveChapter(bookId: string, number: number, decision: ApproveChapterInput): Chapter {
  const db = getDb();
  const row = getChapterRow(bookId, number);
  if (row.status !== 'pending_review') {
    throw new CoreError('INVALID_REVIEW_TRANSITION', `only pending_review chapters can be approved (current: ${row.status})`);
  }
  const at = nowIso();
  if (decision.mode === 'scheduled') {
    if (!decision.scheduledAt) {
      throw new CoreError('INVALID_REVIEW_TRANSITION', 'scheduled approval requires scheduledAt');
    }
    db.prepare("UPDATE chapters SET status = 'scheduled', scheduled_at = ?, review_note = NULL, updated_at = ? WHERE id = ?").run(
      decision.scheduledAt,
      at,
      row.id
    );
  } else {
    db.prepare("UPDATE chapters SET status = 'published', published_at = COALESCE(published_at, ?), review_note = NULL, updated_at = ? WHERE id = ?").run(
      at,
      at,
      row.id
    );
  }
  touchBook(bookId, at);
  return getChapterByNumber(bookId, number)!;
}

/** 驳回:pending_review → draft;备注写入 review_note(可空),发布历史保留 */
export function rejectChapter(bookId: string, number: number, note?: string | null): Chapter {
  const db = getDb();
  const row = getChapterRow(bookId, number);
  if (row.status !== 'pending_review') {
    throw new CoreError('INVALID_REVIEW_TRANSITION', `only pending_review chapters can be rejected (current: ${row.status})`);
  }
  const at = nowIso();
  db.prepare("UPDATE chapters SET status = 'draft', scheduled_at = NULL, review_note = ?, updated_at = ? WHERE id = ?").run(
    note?.trim() ? note.trim() : null,
    at,
    row.id
  );
  touchBook(bookId, at);
  return getChapterByNumber(bookId, number)!;
}

/** 全库待审核队列:按提交时间先后(更新时间升序),附书籍摘要 */
export function listPendingReview(limit = 100, offset = 0): ReviewQueueItem[] {
  const db = getDb();
  const rows = db
    .prepare(
      `SELECT ch.*, b.slug AS book_slug, b.title AS book_title
       FROM chapters ch JOIN books b ON b.id = ch.book_id
       WHERE ch.status = 'pending_review'
       ORDER BY ch.updated_at ASC, ch.book_id ASC, ch.number ASC
       LIMIT ? OFFSET ?`
    )
    .all(limit, offset) as (ChapterRow & { book_slug: string; book_title: string })[];
  return rows.map((r) => ({
    bookId: r.book_id,
    bookSlug: r.book_slug,
    bookTitle: r.book_title,
    chapter: toChapter(r),
  }));
}

/**
 * 整体重排:orderedNumbers 必须是该书现有章号的一个排列。
 * 两阶段更新(先加偏移再落位)绕开 UNIQUE(book_id, number) 的中途冲突。
 */
export function reorderChapters(bookId: string, orderedNumbers: number[]): Chapter[] {
  const db = getDb();
  if (!db.prepare('SELECT id FROM books WHERE id = ?').get(bookId)) {
    throw new CoreError('BOOK_NOT_FOUND', `book not found: ${bookId}`);
  }
  const current = listChapters(bookId).map((c) => c.number).sort((a, b) => a - b);
  const target = [...orderedNumbers].sort((a, b) => a - b);
  if (
    current.length !== target.length ||
    current.some((n, i) => n !== target[i])
  ) {
    throw new CoreError('INVALID_CHAPTER_ORDER', 'orderedNumbers must be a permutation of existing chapter numbers');
  }
  if (orderedNumbers.length === 0) return [];

  const offset = Math.max(...current) + orderedNumbers.length + 1;
  const tx = db.transaction(() => {
    const bump = db.prepare('UPDATE chapters SET number = number + ? WHERE book_id = ? AND number = ?');
    for (const n of orderedNumbers) bump.run(offset, bookId, n);
    const place = db.prepare('UPDATE chapters SET number = ? WHERE book_id = ? AND number = ?');
    orderedNumbers.forEach((newNumber, idx) => place.run(newNumber, bookId, current[idx] + offset));
  });
  tx();
  return listChapters(bookId);
}

// ---------- 管理侧:作者 ----------

interface AuthorRow {
  id: number;
  name: string;
  bio: string | null;
  avatar_path: string | null;
  book_count?: number;
}

function toAuthorWithCount(r: AuthorRow): AuthorWithCount {
  return {
    id: r.id,
    name: r.name,
    bio: r.bio,
    avatarPath: r.avatar_path,
    bookCount: r.book_count ?? 0,
  };
}

const AUTHOR_SELECT = `
SELECT a.id, a.name, a.bio, a.avatar_path,
       (SELECT COUNT(*) FROM books b WHERE b.author_id = a.id) AS book_count
FROM authors a`;

/** 管理列表:全部作者附作品数,按作品数降序 */
export function listAuthors(): AuthorWithCount[] {
  const db = getDb();
  return (db.prepare(`${AUTHOR_SELECT} ORDER BY book_count DESC, a.name`).all() as AuthorRow[]).map(toAuthorWithCount);
}

export function getAuthor(id: number): AuthorWithCount | null {
  const db = getDb();
  const row = db.prepare(`${AUTHOR_SELECT} WHERE a.id = ?`).get(id) as AuthorRow | undefined;
  return row ? toAuthorWithCount(row) : null;
}

/** 编辑作者(名/简介/头像);改名撞车抛 AUTHOR_NAME_TAKEN */
export function updateAuthor(id: number, patch: UpdateAuthorPatch): AuthorWithCount {
  const db = getDb();
  const row = db.prepare('SELECT * FROM authors WHERE id = ?').get(id) as AuthorRow | undefined;
  if (!row) throw new CoreError('AUTHOR_NOT_FOUND', `author not found: ${id}`);
  if (patch.name !== undefined && patch.name !== row.name) {
    const clash = db.prepare('SELECT id FROM authors WHERE name = ?').get(patch.name);
    if (clash) throw new CoreError('AUTHOR_NAME_TAKEN', `author name already exists: ${patch.name}`);
  }
  db.prepare('UPDATE authors SET name = ?, bio = ?, avatar_path = ? WHERE id = ?').run(
    patch.name ?? row.name,
    patch.bio !== undefined ? patch.bio : row.bio,
    patch.avatarPath !== undefined ? patch.avatarPath : row.avatar_path,
    id
  );
  return getAuthor(id)!;
}

/** 删除作者;仍有作品时抛 AUTHOR_IN_USE(先把书转移或删除) */
export function deleteAuthor(id: number): boolean {
  const db = getDb();
  if (!db.prepare('SELECT id FROM authors WHERE id = ?').get(id)) {
    throw new CoreError('AUTHOR_NOT_FOUND', `author not found: ${id}`);
  }
  const used = db.prepare('SELECT COUNT(*) AS n FROM books WHERE author_id = ?').get(id) as { n: number };
  if (used.n > 0) throw new CoreError('AUTHOR_IN_USE', `author ${id} still has ${used.n} book(s)`);
  db.prepare('DELETE FROM authors WHERE id = ?').run(id);
  return true;
}

// ---------- 管理侧:分类 ----------

export function getCategory(id: number): Category | null {
  const db = getDb();
  const row = db.prepare('SELECT * FROM categories WHERE id = ?').get(id) as Category | undefined;
  return row ?? null;
}

/** 新建分类;name/slug 任一冲突抛 CATEGORY_NAME_TAKEN */
export function createCategory(name: string): Category {
  const db = getDb();
  if (!name.trim()) throw new CoreError('CATEGORY_NAME_TAKEN', 'category name is required');
  const slug = slugifyName(name);
  const clash = db
    .prepare('SELECT id FROM categories WHERE name = ? OR slug = ?')
    .get(name, slug);
  if (clash) throw new CoreError('CATEGORY_NAME_TAKEN', `category already exists: ${name}`);
  const res = db.prepare('INSERT INTO categories (slug, name) VALUES (?, ?)').run(slug, name);
  return { id: Number(res.lastInsertRowid), slug, name };
}

/** 重命名分类;slug 不变(URL 稳定性),新名撞车抛 CATEGORY_NAME_TAKEN */
export function updateCategory(id: number, patch: UpdateCategoryPatch): Category {
  const db = getDb();
  const row = getCategory(id);
  if (!row) throw new CoreError('CATEGORY_NOT_FOUND', `category not found: ${id}`);
  if (patch.name === undefined || patch.name === row.name) return row;
  const clash = db.prepare('SELECT id FROM categories WHERE name = ?').get(patch.name);
  if (clash) throw new CoreError('CATEGORY_NAME_TAKEN', `category name already exists: ${patch.name}`);
  db.prepare('UPDATE categories SET name = ? WHERE id = ?').run(patch.name, id);
  return { ...row, name: patch.name };
}

/** 删除分类;仍被书籍引用时抛 CATEGORY_IN_USE */
export function deleteCategory(id: number): boolean {
  const db = getDb();
  if (!getCategory(id)) throw new CoreError('CATEGORY_NOT_FOUND', `category not found: ${id}`);
  const used = db.prepare('SELECT COUNT(*) AS n FROM books WHERE category_id = ?').get(id) as { n: number };
  if (used.n > 0) throw new CoreError('CATEGORY_IN_USE', `category ${id} still has ${used.n} book(s)`);
  db.prepare('DELETE FROM categories WHERE id = ?').run(id);
  return true;
}

// ---------- 管理侧:标签 ----------

export function getTag(id: number): Tag | null {
  const db = getDb();
  const row = db.prepare('SELECT * FROM tags WHERE id = ?').get(id) as Tag | undefined;
  return row ?? null;
}

/** 新建标签;name/slug 任一冲突抛 TAG_NAME_TAKEN */
export function createTag(name: string): Tag {
  const db = getDb();
  if (!name.trim()) throw new CoreError('TAG_NAME_TAKEN', 'tag name is required');
  const slug = slugifyName(name);
  const clash = db.prepare('SELECT id FROM tags WHERE name = ? OR slug = ?').get(name, slug);
  if (clash) throw new CoreError('TAG_NAME_TAKEN', `tag already exists: ${name}`);
  const res = db.prepare('INSERT INTO tags (slug, name) VALUES (?, ?)').run(slug, name);
  return { id: Number(res.lastInsertRowid), slug, name };
}

/** 重命名标签;slug 不变,新名撞车抛 TAG_NAME_TAKEN */
export function updateTag(id: number, patch: UpdateTagPatch): Tag {
  const db = getDb();
  const row = getTag(id);
  if (!row) throw new CoreError('TAG_NOT_FOUND', `tag not found: ${id}`);
  if (patch.name === undefined || patch.name === row.name) return row;
  const clash = db.prepare('SELECT id FROM tags WHERE name = ?').get(patch.name);
  if (clash) throw new CoreError('TAG_NAME_TAKEN', `tag name already exists: ${patch.name}`);
  db.prepare('UPDATE tags SET name = ? WHERE id = ?').run(patch.name, id);
  return { ...row, name: patch.name };
}

/** 删除标签及其全部书籍关联;返回是否删除了东西 */
export function deleteTag(id: number): boolean {
  const db = getDb();
  if (!getTag(id)) throw new CoreError('TAG_NOT_FOUND', `tag not found: ${id}`);
  const tx = db.transaction(() => {
    db.prepare('DELETE FROM book_tags WHERE tag_id = ?').run(id);
    db.prepare('DELETE FROM tags WHERE id = ?').run(id);
  });
  tx();
  return true;
}

// ---------- V3:自动发布配置与发布周期 ----------

/** 本地时区 YYYY-MM-DD 键(V5 AI 连载日守卫复用) */
export function localDateKey(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

/** 读取某书的自动发布配置;书不存在抛 BOOK_NOT_FOUND */
export function getAutopilotConfig(bookId: string): AutopilotConfig {
  const db = getDb();
  const row = db.prepare('SELECT * FROM books WHERE id = ?').get(bookId) as BookRow | undefined;
  if (!row) throw new CoreError('BOOK_NOT_FOUND', `book not found: ${bookId}`);
  return {
    enabled: row.autopilot_enabled === 1,
    hour: row.autopilot_hour,
    count: row.autopilot_count,
    lastRunDate: row.autopilot_last_date,
  };
}

/** 配置自动发布;hour 0-23、count 1-50,非法值抛 INVALID_AUTOPILOT */
export function configureAutopilot(bookId: string, patch: ConfigureAutopilotPatch): AutopilotConfig {
  const db = getDb();
  if (!db.prepare('SELECT id FROM books WHERE id = ?').get(bookId)) {
    throw new CoreError('BOOK_NOT_FOUND', `book not found: ${bookId}`);
  }
  const current = getAutopilotConfig(bookId);
  const hour = patch.hour ?? current.hour;
  const count = patch.count ?? current.count;
  if (!Number.isInteger(hour) || hour < 0 || hour > 23) {
    throw new CoreError('INVALID_AUTOPILOT', `hour must be an integer 0-23: ${hour}`);
  }
  if (!Number.isInteger(count) || count < 1 || count > 50) {
    throw new CoreError('INVALID_AUTOPILOT', `count must be an integer 1-50: ${count}`);
  }
  const enabled = patch.enabled ?? current.enabled;
  db.prepare('UPDATE books SET autopilot_enabled = ?, autopilot_hour = ?, autopilot_count = ? WHERE id = ?').run(
    enabled ? 1 : 0,
    hour,
    count,
    bookId
  );
  return getAutopilotConfig(bookId);
}

/**
 * 到期定时发布:所有 status=scheduled 且 scheduled_at<=now 的章节转 published
 * (publishedAt 缺失时记 now);联动刷新所属书籍 updated_at。事务内完成,返回发布数。
 */
export function publishDueChapters(now = new Date()): number {
  const db = getDb();
  const at = now.toISOString();
  const tx = db.transaction(() => {
    const res = db
      .prepare(
        `UPDATE chapters
         SET status = 'published', published_at = COALESCE(published_at, ?), updated_at = ?
         WHERE status = 'scheduled' AND scheduled_at IS NOT NULL AND scheduled_at <= ?`
      )
      .run(at, at, at);
    if (res.changes > 0) {
      db.prepare(
        `UPDATE books SET updated_at = ?
         WHERE id IN (SELECT DISTINCT book_id FROM chapters WHERE status = 'published' AND updated_at = ?)`
      ).run(at, at);
    }
    return res.changes;
  });
  return tx();
}

/**
 * 每日自动发布:对启用 autopilot 的书,当本地时刻已到配置小时且今天尚未触发时,
 * 从最旧的 draft 章节起发布 count 章,并记 lastRunDate(本地 YYYY-MM-DD)。
 */
export function runAutopilot(now = new Date()): { books: number; published: number } {
  const db = getDb();
  const at = now.toISOString();
  const today = localDateKey(now);
  const hour = now.getHours();
  const books = db
    .prepare('SELECT id, autopilot_hour, autopilot_count, autopilot_last_date FROM books WHERE autopilot_enabled = 1')
    .all() as Pick<BookRow, 'id' | 'autopilot_hour' | 'autopilot_count' | 'autopilot_last_date'>[];

  let firedBooks = 0;
  let publishedTotal = 0;
  for (const b of books) {
    if (hour < b.autopilot_hour || b.autopilot_last_date === today) continue;
    const tx = db.transaction(() => {
      const drafts = db
        .prepare("SELECT id FROM chapters WHERE book_id = ? AND status = 'draft' ORDER BY number ASC LIMIT ?")
        .all(b.id, b.autopilot_count) as { id: string }[];
      for (const ch of drafts) {
        db.prepare("UPDATE chapters SET status = 'published', published_at = COALESCE(published_at, ?), review_note = NULL, updated_at = ? WHERE id = ?").run(
          at,
          at,
          ch.id
        );
      }
      db.prepare('UPDATE books SET autopilot_last_date = ?, updated_at = ? WHERE id = ?').run(today, at, b.id);
      return drafts.length;
    });
    const n = tx();
    if (n > 0) {
      firedBooks += 1;
      publishedTotal += n;
    }
  }
  return { books: firedBooks, published: publishedTotal };
}

/** 发布周期:先扫到期定时章节,再跑每日自动发布 */
export function runPublishCycle(now = new Date()): PublishCycleResult {
  const duePublished = publishDueChapters(now);
  const autopilot = runAutopilot(now);
  return { duePublished, autopilotBooks: autopilot.books, autopilotPublished: autopilot.published };
}
