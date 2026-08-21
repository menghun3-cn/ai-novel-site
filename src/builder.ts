/**
 * Novel Builder 核心编排（见方案 §2、§10、§11、§12）。
 *
 * 流程：扫描小说 → 解析章节 → 生成 EPUB → 写 Manifest → 投递 Book Dock。
 */
import { readdir, stat } from 'node:fs/promises';
import { basename, join } from 'node:path';
import type { Logger } from 'pino';
import type {
  BookOrbitAdapter,
  BuildResult,
  Manifest,
  ScannedNovel,
} from './types.js';
import type { AppConfig } from './config.js';
import { readManifest, writeManifest } from './manifest.js';
import { scanNovel } from './parsers/directory.js';
import { generateEpub } from './epub/generator.js';
import { fileExists, sanitizeFileName, sha256File, sleep, uuidV5 } from './util.js';

export interface BuilderContext {
  config: AppConfig;
  logger: Logger;
  adapter: BookOrbitAdapter;
}

export interface BuildOptions {
  /** 强制重新构建，忽略 Manifest 内容哈希。 */
  force?: boolean;
  /** 是否在构建后执行同步。 */
  sync?: boolean;
}

export class NovelBuilder {
  constructor(private readonly ctx: BuilderContext) {}

  get config(): AppConfig {
    return this.ctx.config;
  }

  private get logger(): Logger {
    return this.ctx.logger;
  }

  epubPathFor(metaTitle: string): string {
    return join(this.config.outputDir, `${sanitizeFileName(metaTitle)}.epub`);
  }

  /** 构建一本小说。 */
  async buildBook(novelDir: string, options: BuildOptions = {}): Promise<BuildResult> {
    const start = Date.now();
    const scanned = await scanNovel(novelDir);
    const { meta, chapters, contentHash } = scanned;

    if (chapters.length === 0) {
      throw new Error(`小说 "${scanned.id}" 没有任何章节文件（.md/.txt）。`);
    }

    const epubPath = this.epubPathFor(meta.title);
    const previous = await readManifest(novelDir);
    const identifier = meta.identifier ?? uuidV5(meta.title);

    let changed = true;

    if (!options.force && previous && previous.contentHash === contentHash && (await fileExists(epubPath))) {
      // 内容未变化，跳过重新生成。
      changed = false;
      this.logger.debug({ book: scanned.id, contentHash }, 'content unchanged, skip rebuild');
    } else {
      await generateEpub({
        meta,
        chapters,
        coverPath: scanned.coverPath,
        outPath: epubPath,
        identifier,
        modified: scanned.modified,
      });

      const manifest: Manifest = {
        title: meta.title,
        version: (previous?.version ?? 0) + 1,
        chapterCount: chapters.length,
        lastChapter: String(chapters.length),
        contentHash,
        generatedAt: new Date().toISOString(),
      };
      await writeManifest(novelDir, manifest);
      this.logger.info(
        { book: scanned.id, chapterCount: chapters.length, version: manifest.version },
        'EPUB generated',
      );
    }

    // 同步 Book Dock。
    let synced = false;
    let syncedPath: string | undefined;
    if (options.sync !== false && this.config.sync.enabled) {
      const dockFile = join(this.config.bookdockDir, basename(epubPath));
      let needsSync = changed;
      if (!needsSync) {
        if (await fileExists(dockFile)) {
          needsSync = (await sha256File(epubPath)) !== (await sha256File(dockFile));
        } else {
          needsSync = true;
        }
      }

      if (needsSync) {
        await this.syncWithRetry(epubPath, meta.title);
        synced = true;
        syncedPath = join(this.config.bookdockDir, basename(epubPath));
      } else {
        this.logger.debug({ book: scanned.id }, 'bookdock already up-to-date, skip sync');
      }
    }

    return {
      book: scanned.id,
      title: meta.title,
      chapterCount: chapters.length,
      contentHash,
      changed,
      epubPath,
      synced,
      syncedPath,
      durationMs: Date.now() - start,
    };
  }

  private async syncWithRetry(epubPath: string, title: string): Promise<void> {
    const { retries, retryDelayMs } = this.config.sync;
    let lastErr: unknown;
    for (let attempt = 1; attempt <= retries + 1; attempt++) {
      try {
        await this.ctx.adapter.sync(epubPath, title);
        this.logger.info({ epubPath, attempt }, 'synced to Book Dock');
        return;
      } catch (err) {
        lastErr = err;
        this.logger.warn({ err, attempt, retries }, 'sync failed, will retry');
        if (attempt <= retries) await sleep(retryDelayMs * attempt);
      }
    }
    throw new Error(`同步失败（已重试 ${retries} 次）: ${String(lastErr)}`);
  }

  /** 列出所有小说目录。 */
  async listBooks(): Promise<Array<{ id: string; dir: string }>> {
    const entries = await readdir(this.config.novelsDir, { withFileTypes: true });
    const books: Array<{ id: string; dir: string }> = [];
    for (const e of entries) {
      if (!e.isDirectory()) continue;
      if (e.name.startsWith('.')) continue;
      const dir = join(this.config.novelsDir, e.name);
      try {
        const s = await stat(dir);
        if (s.isDirectory()) books.push({ id: e.name, dir });
      } catch {
        /* ignore */
      }
    }
    books.sort((a, b) => a.id.localeCompare(b.id, 'zh-CN'));
    return books;
  }

  /** 构建全部小说（用于启动追赶、--once）。 */
  async buildAll(options: BuildOptions = {}): Promise<BuildResult[]> {
    const books = await this.listBooks();
    const results: BuildResult[] = [];
    for (const book of books) {
      try {
        results.push(await this.buildBook(book.dir, options));
      } catch (err) {
        this.logger.error({ err, book: book.id }, 'build failed');
        results.push({
          book: book.id,
          title: book.id,
          chapterCount: 0,
          contentHash: '',
          changed: false,
          epubPath: '',
          synced: false,
          durationMs: 0,
        });
      }
    }
    return results;
  }

  /** 根据书籍 id 查找目录。 */
  async resolveBookDir(id: string): Promise<string | null> {
    const books = await this.listBooks();
    const found = books.find((b) => b.id === id || sanitizeFileName(b.id) === id);
    return found?.dir ?? null;
  }

  /** 书籍状态摘要（供 API 展示）。 */
  async bookStatus(novelDir: string, scanned?: ScannedNovel, manifest?: Manifest | null) {
    const s = scanned ?? (await scanNovel(novelDir));
    const m = manifest ?? (await readManifest(novelDir));
    return {
      id: s.id,
      title: s.meta.title,
      author: s.meta.author ?? null,
      language: s.meta.language,
      chapterCount: s.chapters.length,
      contentHash: s.contentHash,
      version: m?.version ?? 0,
      lastBuiltAt: m?.generatedAt ?? null,
      upToDate: m?.contentHash === s.contentHash,
      hasCover: Boolean(s.coverPath),
    };
  }
}
