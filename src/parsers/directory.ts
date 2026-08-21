/**
 * 目录解析器（见方案 §7）：扫描一本小说的目录，产出统一结构。
 */
import { readdir, readFile, stat } from 'node:fs/promises';
import { basename, extname, isAbsolute, join } from 'node:path';
import { parse as parseYaml } from 'yaml';
import { z } from 'zod';
import type { BookMeta, Chapter, RawChapter, ScannedNovel } from '../types.js';
import { naturalCompare, sha256, toModifiedIso } from '../util.js';
import { parseMarkdownChapter } from './markdown.js';
import { parseTxtChapters } from './txt.js';

const BookYamlSchema = z
  .object({
    title: z.string(),
    author: z.string().optional(),
    language: z.string().default('zh-CN'),
    description: z.string().optional(),
    publisher: z.string().optional(),
    year: z.union([z.number(), z.string()]).optional(),
    tags: z.array(z.string()).optional(),
    series: z.object({ name: z.string(), index: z.number().optional() }).optional(),
    cover: z.string().optional(),
    identifier: z.string().optional(),
    status: z.string().optional(),
    source: z.string().optional(),
    rights: z.string().optional(),
  })
  .passthrough();

const COVER_NAMES = ['cover.jpg', 'cover.jpeg', 'cover.png', 'cover.webp', 'cover.gif', 'cover.svg'];
const CHAPTER_EXTS = new Set(['.md', '.markdown', '.txt']);

export function isChapterFile(name: string): boolean {
  return CHAPTER_EXTS.has(extname(name).toLowerCase());
}

/** 读取 book.yaml；缺失或非法时回退到目录名。 */
export async function loadBookMeta(novelDir: string, id: string): Promise<BookMeta> {
  const yamlPath = join(novelDir, 'book.yaml');
  try {
    const text = await readFile(yamlPath, 'utf8');
    const data = (parseYaml(text) ?? {}) as Record<string, unknown>;
    const parsed = BookYamlSchema.parse(data);
    return { ...parsed, year: parsed.year != null ? String(parsed.year) : undefined };
  } catch {
    return { title: id, language: 'zh-CN' };
  }
}

async function findCover(novelDir: string, meta: BookMeta): Promise<string | undefined> {
  const candidates: string[] = [];
  if (meta.cover) {
    candidates.push(isAbsolute(meta.cover) ? meta.cover : join(novelDir, meta.cover));
  }
  for (const name of COVER_NAMES) candidates.push(join(novelDir, name));

  for (const p of candidates) {
    try {
      const s = await stat(p);
      if (s.isFile()) return p;
    } catch {
      /* 忽略不存在的候选。 */
    }
  }
  return undefined;
}

function fallbackTitleFromStem(stem: string): string {
  if (/^\d+$/.test(stem)) return `第${String(Number(stem))}章`;
  return stem;
}

/** 收集并解析章节文件，统一分配 id/order。 */
async function collectChapters(novelDir: string): Promise<{ chapters: Chapter[]; latestMtime: Date }> {
  let baseDir = novelDir;
  let files: string[] = [];

  const chaptersDir = join(novelDir, 'chapters');
  try {
    const s = await stat(chaptersDir);
    if (s.isDirectory()) {
      baseDir = chaptersDir;
      files = (await readdir(chaptersDir)).filter(isChapterFile);
    }
  } catch {
    /* 无 chapters/ 目录，使用小说根目录。 */
  }

  if (files.length === 0 && baseDir === novelDir) {
    files = (await readdir(novelDir)).filter(isChapterFile);
  }

  files.sort(naturalCompare);

  const raws: RawChapter[] = [];
  let latestMtime = new Date(0);

  for (const file of files) {
    const full = join(baseDir, file);
    const content = await readFile(full, 'utf8');
    const s = await stat(full);
    if (s.mtime > latestMtime) latestMtime = s.mtime;

    const stem = basename(file, extname(file));
    const fallbackTitle = fallbackTitleFromStem(stem);

    if (extname(file).toLowerCase() === '.txt') {
      raws.push(...parseTxtChapters(content, file, fallbackTitle));
    } else {
      raws.push(parseMarkdownChapter(content, file, fallbackTitle));
    }
  }

  const chapters: Chapter[] = raws.map((r, i) => ({
    id: String(i + 1).padStart(3, '0'),
    order: i + 1,
    title: r.title,
    content: r.content,
    sourceFile: r.sourceFile,
  }));

  return { chapters, latestMtime };
}

function computeContentHash(meta: BookMeta, chapters: Chapter[]): string {
  const parts: string[] = [meta.title ?? '', meta.author ?? '', meta.language ?? 'zh-CN'];
  for (const c of chapters) {
    parts.push(String(c.order), c.title, c.content);
  }
  return sha256(parts.join('\n'));
}

/** 扫描一本小说目录，返回统一结果。 */
export async function scanNovel(novelDir: string): Promise<ScannedNovel> {
  const id = basename(novelDir);
  const meta = await loadBookMeta(novelDir, id);
  const coverPath = await findCover(novelDir, meta);
  const { chapters, latestMtime } = await collectChapters(novelDir);
  const contentHash = computeContentHash(meta, chapters);

  return {
    id,
    dir: novelDir,
    meta,
    coverPath,
    chapters,
    contentHash,
    modified: toModifiedIso(latestMtime),
  };
}
