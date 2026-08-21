/**
 * 核心领域类型定义。
 */

/** 章节解析器统一输出（见方案 §7）。 */
export interface Chapter {
  /** 章节 id，如 "001"。 */
  id: string;
  /** 章节顺序，从 1 开始。 */
  order: number;
  /** 章节标题。 */
  title: string;
  /** 已转换为 XHTML 的章节正文片段（不含 <body> 包裹）。 */
  content: string;
  /** 源文件相对名，如 "001.md"。 */
  sourceFile: string;
}

/** 解析器中间产物（尚未分配 id/order）。 */
export interface RawChapter {
  title: string;
  content: string;
  sourceFile: string;
}

/** book.yaml 元数据（见方案 §5）。 */
export interface BookMeta {
  title: string;
  author?: string;
  language: string;
  description?: string;
  publisher?: string;
  year?: string | number;
  tags?: string[];
  series?: { name: string; index?: number };
  cover?: string;
  identifier?: string;
  status?: string;
  source?: string;
  rights?: string;
  [key: string]: unknown;
}

/** 一本书的完整扫描结果。 */
export interface ScannedNovel {
  /** 目录名，作为书籍 id。 */
  id: string;
  /** 小说目录绝对路径。 */
  dir: string;
  meta: BookMeta;
  /** 封面文件绝对路径（可为空）。 */
  coverPath?: string;
  chapters: Chapter[];
  /** 内容哈希（SHA-256）。 */
  contentHash: string;
  /** 源文件最近修改时间，用于 dcterms:modified。 */
  modified: string;
}

/** .manifest.json 内容（见方案 §11）。 */
export interface Manifest {
  title: string;
  version: number;
  chapterCount: number;
  lastChapter: string;
  contentHash: string;
  generatedAt: string;
}

/** 一次构建的结果。 */
export interface BuildResult {
  book: string;
  title: string;
  chapterCount: number;
  contentHash: string;
  /** 内容是否变化并触发了重新生成。 */
  changed: boolean;
  epubPath: string;
  synced: boolean;
  syncedPath?: string;
  durationMs: number;
}

/** BookOrbit 同步适配器统一抽象（见方案 §12）。 */
export interface BookOrbitAdapter {
  readonly kind: string;
  sync(epubPath: string, bookTitle: string): Promise<SyncResult>;
}

export interface SyncResult {
  dest: string;
  syncedAt: string;
}
