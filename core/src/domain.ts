// Content Core 领域模型:Book / Chapter / Author / Category / Tag 与发布状态机

export const BOOK_STATUSES = ['serializing', 'completed', 'hidden'] as const;
export type BookStatus = (typeof BOOK_STATUSES)[number];

export const CHAPTER_STATUSES = ['draft', 'scheduled', 'published', 'hidden'] as const;
export type ChapterStatus = (typeof CHAPTER_STATUSES)[number];

export function isBookStatus(v: unknown): v is BookStatus {
  return typeof v === 'string' && (BOOK_STATUSES as readonly string[]).includes(v);
}

export function isChapterStatus(v: unknown): v is ChapterStatus {
  return typeof v === 'string' && (CHAPTER_STATUSES as readonly string[]).includes(v);
}

export function isPublishedStatus(status: string): boolean {
  return status === 'published';
}

/** 管理侧错误:code 用于 API 层映射 HTTP 语义 */
export type CoreErrorCode =
  | 'BOOK_NOT_FOUND'
  | 'SLUG_TAKEN'
  | 'CHAPTER_NOT_FOUND'
  | 'CHAPTER_NUMBER_CONFLICT'
  | 'INVALID_CHAPTER_ORDER'
  | 'INVALID_STATUS';

export class CoreError extends Error {
  constructor(
    public readonly code: CoreErrorCode,
    message?: string
  ) {
    super(message ?? code);
    this.name = 'CoreError';
  }
}

export interface Author {
  id: number;
  name: string;
}

export interface Category {
  id: number;
  slug: string;
  name: string;
}

export interface Tag {
  id: number;
  slug: string;
  name: string;
}

export interface Book {
  id: string;
  slug: string;
  title: string;
  description: string | null;
  coverPath: string | null;
  status: BookStatus;
  authorId: number;
  categoryId: number;
  createdAt: string;
  updatedAt: string;
}

export interface Chapter {
  id: string;
  bookId: string;
  number: number;
  title: string;
  slug: string | null;
  contentMd: string;
  status: ChapterStatus;
  scheduledAt: string | null;
  publishedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

/** 带展示元数据的小说(列表/卡片/详情用) */
export interface BookWithMeta extends Book {
  authorName: string;
  categoryName: string;
  tags: string[];
  chapterCount: number;
  publishedCount: number;
  latestChapterNumber: number | null;
  latestChapterTitle: string | null;
  latestPublishedAt: string | null;
}

export interface ChapterView {
  book: BookWithMeta;
  chapter: Chapter;
  prev: Chapter | null;
  next: Chapter | null;
}

export interface UpdateItem {
  bookId: string;
  bookSlug: string;
  bookTitle: string;
  chapter: Chapter;
}

export interface FeedItem {
  bookId: string;
  bookSlug: string;
  bookTitle: string;
  chapterNumber: number;
  chapterTitle: string;
  publishedAt: string;
}

export interface CategoryWithCount {
  slug: string;
  name: string;
  count: number;
}

export interface UpsertBookInput {
  id: string;
  slug: string;
  title: string;
  description?: string | null;
  coverPath?: string | null;
  status?: BookStatus;
  authorName: string;
  categoryName: string;
  tags: string[];
}

export interface ImportChapterInput {
  bookId: string;
  number: number;
  title: string;
  contentMd: string;
  slug?: string | null;
  status?: ChapterStatus;
  scheduledAt?: string | null;
  publishedAt?: string | null;
}

export interface ImportChapterResult {
  added: boolean;
}

export interface ImportReport {
  bookId: string;
  bookSlug: string;
  title: string;
  added: number;
  updated: number;
  total: number;
}

// ---------- 管理侧输入(V2 Content Management) ----------

/** 新建小说;slug 唯一,重复抛 SLUG_TAKEN */
export interface CreateBookInput {
  slug: string;
  title: string;
  description?: string | null;
  coverPath?: string | null;
  status?: BookStatus;
  authorName: string;
  categoryName: string;
  tags?: string[];
}

/** 按 id 编辑小说;仅提供的字段生效,tags 提供时全量重建 */
export interface UpdateBookPatch {
  title?: string;
  description?: string | null;
  coverPath?: string | null;
  status?: BookStatus;
  authorName?: string;
  categoryName?: string;
  tags?: string[];
}

export interface ListAllBooksOptions {
  status?: BookStatus;
  categorySlug?: string;
  q?: string;
  limit?: number;
  offset?: number;
}

/** 新建章节;number 缺省取当前最大章号+1,冲突抛 CHAPTER_NUMBER_CONFLICT */
export interface CreateChapterInput {
  bookId: string;
  number?: number;
  title: string;
  contentMd: string;
  slug?: string | null;
  status?: ChapterStatus;
  scheduledAt?: string | null;
}

/** 编辑章节;status 转换语义见 updateChapter */
export interface UpdateChapterPatch {
  title?: string;
  contentMd?: string;
  slug?: string | null;
  status?: ChapterStatus;
  scheduledAt?: string | null;
}
