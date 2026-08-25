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
  | 'INVALID_INPUT'
  | 'USERNAME_TAKEN'
  | 'EMAIL_TAKEN'
  | 'INVALID_CREDENTIALS'
  | 'SESSION_EXPIRED'
  | 'WEAK_PASSWORD'
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
  | 'AI_PROVIDER_FAILED'
  | 'SHORT_STORY_NOT_FOUND'
  | 'SHORT_STORY_VERSION_NOT_FOUND'
  | 'REVIEW_RULE_NOT_FOUND'
  | 'REVIEW_PROMPT_NOT_FOUND'
  | 'REVIEW_RECORD_NOT_FOUND'
  | 'AI_TASK_NOT_FOUND'
  | 'RULE_VERSION_CONFLICT'
  | 'RULE_VERSION_IMMUTABLE'
  | 'INVALID_RULE_DIMENSIONS'
  | 'STRUCTURED_OUTPUT_FAILED';

export class CoreError extends Error {
  constructor(
    public readonly code: CoreErrorCode,
    message?: string
  ) {
    super(message ?? code);
    this.name = 'CoreError';
  }
}

// ---------- V9 AI小说创作与自动评审中心:短篇小说 / 评审规则 / Prompt / 任务 ----------

/** 短篇小说状态:draft 编辑中;generating/reviewing/optimizing 流水线进行中;passed 已达标入库;pool 低质量池;failed 失败 */
export const SHORT_STORY_STATUSES = ['draft', 'generating', 'reviewing', 'optimizing', 'passed', 'pool', 'failed'] as const;
export type ShortStoryStatus = (typeof SHORT_STORY_STATUSES)[number];

export function isShortStoryStatus(v: unknown): v is ShortStoryStatus {
  return typeof v === 'string' && (SHORT_STORY_STATUSES as readonly string[]).includes(v);
}

/** 可删除(手动清理)的状态;流水线产物 passed 与进行中状态不可删 */
export const SHORT_STORY_DELETABLE_STATUSES: readonly ShortStoryStatus[] = ['draft', 'pool', 'failed'];

/**
 * 创作需求三组字段(规格书 §5):全部可选填,存 short_stories.brief_json。
 * 基础信息六项 + 故事结构六项 + 创作参数六项。
 */
export interface StoryBrief {
  // 基础信息
  theme?: string;
  genre?: string;
  direction?: string;
  coreConflict?: string;
  background?: string;
  characters?: string;
  // 故事结构
  synopsis?: string;
  beginning?: string;
  development?: string;
  conflictBeat?: string;
  climax?: string;
  endingPlot?: string;
  // 创作参数
  targetWords?: number;
  narrativePerspective?: string;
  languageStyle?: string;
  emotionalTone?: string;
  pacing?: string;
  endingType?: string;
}

/** 版本产生原因 */
export const VERSION_CREATION_REASONS = ['generated', 'ai_optimized', 'user_edited'] as const;
export type VersionCreationReason = (typeof VERSION_CREATION_REASONS)[number];

export function isVersionCreationReason(v: unknown): v is VersionCreationReason {
  return typeof v === 'string' && (VERSION_CREATION_REASONS as readonly string[]).includes(v);
}

export interface ShortStory {
  id: string;
  title: string;
  status: ShortStoryStatus;
  brief: StoryBrief;
  currentVersionId: string | null;
  sourceUrl: string | null;
  /** 累计评审次数 */
  reviewRound: number;
  /** 累计自动优化次数(流水线内受 max_auto_optimize_rounds 约束) */
  optimizeRound: number;
  /** 手动优化累计次数(不受自动轮数上限约束,独立计数) */
  manualOptimizeRound: number;
  lastScore: number | null;
  createdAt: string;
  updatedAt: string;
}

export interface ShortStoryVersion {
  id: string;
  storyId: string;
  version: number;
  content: string;
  charCount: number;
  creationReason: VersionCreationReason;
  generationPrompt: string | null;
  modelName: string | null;
  isFinal: boolean;
  createdAt: string;
}

// ---------- V9 评审规则与 Prompt 版本化 ----------

export const RULE_VERSION_STATUSES = ['draft', 'testing', 'published', 'disabled'] as const;
export type RuleVersionStatus = (typeof RULE_VERSION_STATUSES)[number];

export function isRuleVersionStatus(v: unknown): v is RuleVersionStatus {
  return typeof v === 'string' && (RULE_VERSION_STATUSES as readonly string[]).includes(v);
}

/** 单档评分标准(如 90-100 档的描述) */
export interface DimensionStandard {
  min: number;
  max: number;
  description: string;
}

/** 评审维度配置:权重为百分比整数,同一规则版本内全部维度 weight 之和必须等于 100 */
export interface ReviewDimensionSpec {
  name: string;
  weight: number;
  definition: string;
  standards: DimensionStandard[];
  bonus: string;
  penalty: string;
  notes: string;
}

export interface ReviewRule {
  id: string;
  name: string;
  description: string | null;
  currentVersionId: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface ReviewRuleVersion {
  id: string;
  ruleId: string;
  version: string;
  dimensions: ReviewDimensionSpec[];
  qualityThreshold: number;
  maxAutoOptimizeRounds: number;
  promptId: string | null;
  status: RuleVersionStatus;
  createdAt: string | null;
  publishedAt: string | null;
}

export interface ReviewPrompt {
  id: string;
  name: string;
  version: string;
  content: string;
  ruleVersionId: string | null;
  modelHint: string | null;
  changeNote: string | null;
  createdAt: string;
}

// ---------- V9 结构化评审结果与记录 ----------

/** 单维度评分:score 为 0-100 原始分,maxScore 为该维度权重(加权后展示分) */
export interface DimensionScore {
  name: string;
  score: number;
  maxScore: number;
  reason: string;
}

/** AI 评审结构化输出(规格书 §16/§37) */
export interface StructuredReviewResult {
  score: number;
  level: 'S' | 'A' | 'B' | 'C' | 'D';
  qualified: boolean;
  dimensions: DimensionScore[];
  strengths: string[];
  weaknesses: string[];
  suggestions: string[];
  summary: string;
}

/** 质量等级分档(默认,可被规则版本覆盖预留) */
export const QUALITY_LEVELS: ReadonlyArray<{ level: 'S' | 'A' | 'B' | 'C' | 'D'; min: number }> = [
  { level: 'S', min: 90 },
  { level: 'A', min: 80 },
  { level: 'B', min: 70 },
  { level: 'C', min: 60 },
  { level: 'D', min: 0 },
];

export function levelForScore(score: number): 'S' | 'A' | 'B' | 'C' | 'D' {
  return (QUALITY_LEVELS.find((l) => score >= l.min)?.level ?? 'D');
}

export interface ReviewRecord {
  id: string;
  storyId: string;
  storyVersionId: string;
  sourceUrl: string | null;

  ruleId: string;
  ruleVersion: string;

  promptId: string | null;
  promptVersion: string | null;

  modelId: string | null;
  modelName: string | null;
  modelVersion: string | null;

  score: number;
  level: 'S' | 'A' | 'B' | 'C' | 'D';
  qualified: boolean;

  dimensionScores: DimensionScore[];

  strengths: string[];
  weaknesses: string[];
  suggestions: string[];
  summary: string | null;

  reviewRound: number;
  optimizationRound: number;

  durationMs: number | null;
  rawResponse: string | null;
  structuredResult: StructuredReviewResult;

  createdAt: string;
}

// ---------- V9 统一 AI 任务(规格书 §35) ----------

export const AI_TASK_TYPES = [
  'CREATE_NOVEL',
  'AI_SUGGEST',
  'AI_GENERATE',
  'AI_OPTIMIZE',
  'AI_OPTIMIZE_STORY',
  'AI_REVIEW',
  'AI_REVIEW_RETRY',
] as const;
export type AiTaskType = (typeof AI_TASK_TYPES)[number];

export function isAiTaskType(v: unknown): v is AiTaskType {
  return typeof v === 'string' && (AI_TASK_TYPES as readonly string[]).includes(v);
}

export const AI_TASK_STATUSES = ['PENDING', 'RUNNING', 'SUCCESS', 'FAILED', 'CANCELLED'] as const;
export type AiTaskStatus = (typeof AI_TASK_STATUSES)[number];

export function isAiTaskStatus(v: unknown): v is AiTaskStatus {
  return typeof v === 'string' && (AI_TASK_STATUSES as readonly string[]).includes(v);
}

export interface AiTask {
  id: string;
  type: AiTaskType;
  status: AiTaskStatus;
  refType: string | null;
  refId: string | null;
  input: Record<string, unknown> | null;
  prompt: string | null;
  providerName: string | null;
  modelName: string | null;
  output: Record<string, unknown> | null;
  error: string | null;
  attempt: number;
  startedAt: string | null;
  finishedAt: string | null;
  durationMs: number | null;
  tokensPrompt: number | null;
  tokensCompletion: number | null;
  createdAt: string;
}

/** 字段辅助动作(AI_SUGGEST/AI_GENERATE/AI_OPTIMIZE 三类任务的 input.action) */
export const AI_ASSIST_ACTIONS = ['suggest', 'generate', 'optimize'] as const;
export type AiAssistAction = (typeof AI_ASSIST_ACTIONS)[number];

/** 短篇创作字段标签:评审/辅助提示词与前端 UI 共用,键与 StoryBrief 对齐 */
export const SHORT_STORY_FIELD_LABELS: Readonly<Record<string, string>> = {
  title: '标题',
  theme: '小说主题',
  genre: '小说类型',
  direction: '故事方向',
  coreConflict: '核心冲突',
  background: '故事背景',
  characters: '人物设定',
  synopsis: '故事梗概',
  beginning: '开端',
  development: '发展',
  conflictBeat: '冲突(情节节拍)',
  climax: '高潮',
  endingPlot: '结局',
  targetWords: '目标字数',
  narrativePerspective: '叙事视角',
  languageStyle: '语言风格',
  emotionalTone: '情绪基调',
  pacing: '故事节奏',
  endingType: '结局类型',
};

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

// ---------- V6 Reader Platform:读者 ----------

export interface ReaderUser {
  id: string;
  username: string;
  email: string;
  createdAt: string;
}

export interface RegisterReaderInput {
  username: string;
  email: string;
  password: string;
}

/** 登录标识:用户名或邮箱均可 */
export interface LoginReaderInput {
  login: string;
  password: string;
}

export interface ReaderSession {
  token: string;
  expiresAt: string;
  user: ReaderUser;
}

/** 书架条目:收藏/订阅的书 + 进度 + 更新提示 */
export interface ShelfEntry {
  bookId: string;
  slug: string;
  title: string;
  authorName: string;
  /** 已发布章节数(= 最新章号,按 number 计) */
  publishedCount: number;
  latestChapter: number | null;
  favorited: boolean;
  subscribed: boolean;
  progressChapter: number | null;
  progressPercent: number;
  /** 最新已发布章节 > 阅读进度 → 有更新 */
  hasUpdate: boolean;
}

/** 阅读历史条目 */
export interface HistoryEntry {
  bookId: string;
  slug: string;
  title: string;
  chapterNumber: number;
  percent: number;
  updatedAt: string;
}

/** V7 书籍热度统计 */
export interface BookStats {
  /** 章页打开总次数(书级) */
  viewCount: number;
  favoriteCount: number;
  /** 整体完读率 0-1(全部已发布章 finish/view 聚合) */
  finishRate: number;
  publishedCount: number;
}

/** Discovery 板块条目 */
export interface DiscoveryItem {
  bookId: string;
  slug: string;
  title: string;
  authorName: string;
  description: string | null;
  coverPath: string | null;
  categoryName: string;
  status: BookStatus | 'serializing';
  publishedCount: number;
  /** 规则打分,展示可不用 */
  score: number;
  /** 推荐理由短语(如分类名),可空 */
  reason?: string;
  /** 书级累计 PV(展示人气用) */
  viewCount?: number;
  /** 收藏数(展示人气用) */
  favoriteCount?: number;
  /** 最新已发布章节号(最新更新板块展示用) */
  latestChapterNumber?: number | null;
  /** 最新发布时间 ISO 字符串(最新更新板块展示用) */
  lastPublishedAt?: string | null;
}

/** Discovery 板块 */
export interface DiscoverySection {
  key: 'today' | 'hot' | 'recent' | 'new' | 'completed' | 'foryou';
  title: string;
  items: DiscoveryItem[];
}

// ---------- V8 数据分析 ----------

/** 平台运营总览 */
export interface AnalyticsOverview {
  /** 章节级 PV 总和(含重读) */
  totalPv: number;
  /** 书级 PV 总和(首页/详情点击) */
  totalBookPv: number;
  totalFinish: number;
  totalFavorites: number;
  totalSubscriptions: number;
  totalReaders: number;
  totalBooks: number;
  totalPublishedChapters: number;
  /** 总阅读时长(分钟) */
  totalDurationMin: number;
  /** 整体完读率 0-1 */
  overallFinishRate: number;
  /** 最近 7 天有进度的读者数 */
  activeReaders7d: number;
  /** 最近 7 天阅读会话数 */
  activeSessions7d: number;
}

/** 单章指标 */
export interface ChapterMetric {
  chapterNumber: number;
  title: string;
  viewCount: number;
  finishCount: number;
  /** 本章完读率 0-100 */
  finishRate: number;
  /** 相对第一章 PV 的留存率 0-100 */
  retention: number;
  /** 平均阅读时长(秒) */
  avgDurationSec: number;
  /** 是否需要关注(流失或完读率低) */
  flagged: boolean;
  /** 标记原因:drop-off(流失) | low-finish(完读率低) */
  flagReason?: 'drop-off' | 'low-finish';
}

/** 单书漏斗分析 */
export interface BookFunnel {
  bookId: string;
  bookTitle: string;
  totalPv: number;
  totalFinish: number;
  /** 整体完读率 0-100 */
  overallFinishRate: number;
  favorites: number;
  subscriptions: number;
  /** 第一章 PV(留存基线) */
  baselinePv: number;
  /** 每章指标(按章号排序) */
  chapters: ChapterMetric[];
}

// ---------- V8.1 Admin 账号:默认账号初始化 + 首登强制改密 ----------

export interface AdminAccount {
  username: string;
  /** true = 仍在使用初始密码,登录后必须先改密才能访问业务 API */
  mustChangePassword: boolean;
}

export interface LoginAdminInput {
  username: string;
  password: string;
}

export interface ChangeAdminPasswordInput {
  /** 当前有效会话令牌 */
  token: string;
  currentPassword: string;
  newPassword: string;
}

export interface AdminSession extends AdminAccount {
  token: string;
  expiresAt: string;
}
