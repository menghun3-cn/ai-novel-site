// Content Core 领域模型:Book / Chapter / Author / Category / Tag 与发布状态机

export const BOOK_STATUSES = ['serializing', 'completed'] as const;
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
