// Content Core 领域模型:Book / Chapter / Author / Category / Tag 与发布状态机

export const BOOK_STATUSES = ['serializing', 'completed', 'hidden'] as const;
export type BookStatus = (typeof BOOK_STATUSES)[number];

// V3 发布工作流:draft --送审--> pending_review --批准--> scheduled/published,驳回回 draft
export const CHAPTER_STATUSES = ['draft', 'pending_review', 'scheduled', 'published', 'hidden'] as const;
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
  | 'INVALID_STATUS'
  | 'INVALID_REVIEW_TRANSITION'
  | 'INVALID_AUTOPILOT'
  | 'INVALID_AI_SERIALIZATION'
  | 'AUTHOR_NOT_FOUND'
  | 'AUTHOR_NAME_TAKEN'
  | 'AUTHOR_IN_USE'
  | 'CATEGORY_NOT_FOUND'
  | 'CATEGORY_NAME_TAKEN'
  | 'CATEGORY_IN_USE'
  | 'TAG_NOT_FOUND'
  | 'TAG_NAME_TAKEN'
  | 'CHARACTER_NOT_FOUND'
  | 'CHARACTER_NAME_TAKEN'
  | 'RELATIONSHIP_NOT_FOUND'
  | 'ARC_NOT_FOUND'
  | 'OUTLINE_NOT_FOUND'
  | 'FORESHADOWING_NOT_FOUND'
  | 'AI_NOT_CONFIGURED'
  | 'AI_PROVIDER_FAILED';

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
  bio?: string | null;
  avatarPath?: string | null;
}

/** 管理侧作者视图:附作品数 */
export interface AuthorWithCount extends Author {
  bookCount: number;
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
  /** 最近一次驳回备注;送审/批准时清空 */
  reviewNote?: string | null;
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
  /** 待审核章节数(V3 审核工作流) */
  pendingReviewCount: number;
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

/** 编辑作者;仅提供的字段生效;slug 化的实体名可改,slug 不可改 */
export interface UpdateAuthorPatch {
  name?: string;
  bio?: string | null;
  avatarPath?: string | null;
}

/** 重命名分类/标签;slug 保持不变(URL 稳定性) */
export interface UpdateCategoryPatch {
  name?: string;
}

export interface UpdateTagPatch {
  name?: string;
}

// ---------- V3 发布核心:审核工作流 / 自动发布 ----------

/** 审核批准:立即发布,或转入定时(必须提供 scheduledAt) */
export type ApproveChapterInput = { mode: 'now' } | { mode: 'scheduled'; scheduledAt: string };

/** 审核队列条目:章节 + 所属书籍摘要 */
export interface ReviewQueueItem {
  bookId: string;
  bookSlug: string;
  bookTitle: string;
  chapter: Chapter;
}

/**
 * 每书每日自动发布配置。调度器在本地时刻到达 hour 后的首次扫描中,
 * 从该书最旧的 draft 章节起自动发布 count 章;lastRunDate 记录本地
 * YYYY-MM-DD,保证每天至多触发一次。
 */
export interface AutopilotConfig {
  enabled: boolean;
  /** 本地小时 0-23 */
  hour: number;
  /** 每次发布的章数 1-50 */
  count: number;
  lastRunDate: string | null;
}

export interface ConfigureAutopilotPatch {
  enabled?: boolean;
  hour?: number;
  count?: number;
}

/** 单次发布周期结果 */
export interface PublishCycleResult {
  /** 到期定时章节转发布数 */
  duePublished: number;
  /** 触发自动发布的书籍数 */
  autopilotBooks: number;
  /** 自动发布章节数 */
  autopilotPublished: number;
}

// ---------- V4 Story Core:世界观 / 人物 / 关系 / 故事线 / 章节大纲 / 伏笔 ----------

export type CharacterRole = 'protagonist' | 'antagonist' | 'supporting' | 'minor';

export function isCharacterRole(v: unknown): v is CharacterRole {
  return typeof v === 'string' && ['protagonist', 'antagonist', 'supporting', 'minor'].includes(v);
}

export type ArcStatus = 'planned' | 'active' | 'done';

export function isArcStatus(v: unknown): v is ArcStatus {
  return typeof v === 'string' && ['planned', 'active', 'done'].includes(v);
}

/** 每书一份的世界观与写作规则(虚拟默认值:未创建时为空串) */
export interface StoryWorld {
  bookId: string;
  setting: string;
  rules: string;
  createdAt: string | null;
  updatedAt: string | null;
}

export interface StoryCharacter {
  id: number;
  bookId: string;
  name: string;
  role: CharacterRole;
  persona: string;
  appearance: string;
  background: string;
  state: string;
  createdAt: string;
  updatedAt: string;
}

export interface UpsertCharacterInput {
  name: string;
  role?: CharacterRole;
  persona?: string;
  appearance?: string;
  background?: string;
  state?: string;
}

export interface StoryRelationship {
  id: number;
  bookId: string;
  fromName: string;
  toName: string;
  kind: string;
  note: string;
  createdAt: string;
}

export interface StoryArc {
  id: number;
  bookId: string;
  title: string;
  summary: string;
  startChapter: number | null;
  endChapter: number | null;
  status: ArcStatus;
  createdAt: string;
  updatedAt: string;
}

export interface UpsertArcInput {
  title: string;
  summary?: string;
  startChapter?: number | null;
  endChapter?: number | null;
  status?: ArcStatus;
}

export interface StoryOutline {
  id: number;
  bookId: string;
  number: number;
  title: string;
  beats: string;
  updatedAt: string;
}

export interface StoryForeshadowing {
  id: number;
  bookId: string;
  label: string;
  detail: string;
  plantedChapter: number | null;
  resolvedChapter: number | null;
  createdAt: string;
}

// ---------- V5 AI 自动连载 ----------

export type GenerationJobStatus = 'pending' | 'running' | 'published' | 'submitted' | 'held' | 'draft' | 'rejected' | 'failed';

export function isGenerationJobStatus(v: unknown): v is GenerationJobStatus {
  return (
    typeof v === 'string' &&
    ['pending', 'running', 'published', 'submitted', 'held', 'draft', 'rejected', 'failed'].includes(v)
  );
}

/** 每书 AI 连载配置;未创建时读出虚拟默认值(停用/8点/1章/送审模式) */
export interface AiSerializationConfig {
  bookId: string;
  enabled: boolean;
  hour: number;
  count: number;
  autoPublish: boolean;
  minChars: number;
  lastRunDate: string | null;
}

export interface ConfigureAiSerializationPatch {
  enabled?: boolean;
  hour?: number;
  count?: number;
  autoPublish?: boolean;
  minChars?: number;
}

export interface GenerationJob {
  id: number;
  bookId: string;
  chapterNumber: number | null;
  status: GenerationJobStatus;
  attempt: number;
  error: string | null;
  chars: number | null;
  model: string | null;
  /** 每任务生成选项(NULL = 沿用书的连载配置) */
  instructions?: string | null;
  minChars?: number | null;
  submitForReview?: boolean | null;
  llmReview?: boolean | null;
  createdAt: string;
  updatedAt: string;
}
