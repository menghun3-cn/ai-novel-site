// Importer CLI:novels/<书名>/ (book.yaml + chapters/*.md) → Content Core
// 用法: npm run import:novel -- <小说目录>

import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import { parse as parseYaml } from 'yaml';
import { z } from 'zod';
import {
  bookIdFromSlug,
  countChapters,
  getDbPath,
  importChapter,
  upsertBook,
  type ImportReport,
} from '@novel/core';

const BookYaml = z.object({
  title: z.string().min(1, 'title 不能为空'),
  slug: z.string().min(1, 'slug 不能为空').regex(/^[a-z0-9-]+$/i, 'slug 只能包含字母/数字/连字符'),
  author: z.string().min(1, 'author 不能为空'),
  category: z.string().min(1, 'category 不能为空'),
  description: z.string().optional().default(''),
  status: z.enum(['serializing', 'completed']).optional().default('serializing'),
  tags: z.array(z.string()).optional().default([]),
  cover: z.string().optional(),
  chapterStatus: z.enum(['draft', 'scheduled', 'published', 'hidden']).optional().default('published'),
});

type BookYaml = z.infer<typeof BookYaml>;

const importerDir = path.dirname(fileURLToPath(import.meta.url)); // importer/src
const repoRoot = path.resolve(importerDir, '..', '..');

function chapterNumberFromName(name: string): number | null {
  const m = name.match(/^(\d+)/);
  return m ? parseInt(m[1], 10) : null;
}

function compareChapterFiles(a: string, b: string): number {
  const an = chapterNumberFromName(a);
  const bn = chapterNumberFromName(b);
  if (an !== null && bn !== null) return an - bn;
  if (an !== null) return -1;
  if (bn !== null) return 1;
  return a.localeCompare(b);
}

/** 解析章节文件:首个 H1 作为标题并从正文剥离;否则标题为「第 N 章」 */
function parseChapterFile(filePath: string, number: number): { title: string; contentMd: string } {
  const raw = fs.readFileSync(filePath, 'utf-8').replace(/^\uFEFF/, '');
  const m = raw.match(/^#\s+(.+?)\s*$/m);
  if (m && m.index === 0) {
    const title = m[1].trim();
    const contentMd = raw.slice(m[0].length).replace(/^\n+/, '');
    return { title, contentMd };
  }
  return { title: `第 ${number} 章`, contentMd: raw.trim() };
}

function importCover(dir: string, meta: BookYaml): string | null {
  if (!meta.cover) return null;
  const src = path.join(dir, meta.cover);
  if (!fs.existsSync(src)) {
    console.warn(`  ⚠️  封面文件不存在,跳过: ${meta.cover}`);
    return null;
  }
  const ext = path.extname(src) || '.jpg';
  const destRel = `covers/${meta.slug}${ext}`;
  const dest = path.join(repoRoot, 'web', 'public', destRel);
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.copyFileSync(src, dest);
  return destRel;
}

function importBookDir(dir: string, meta: BookYaml): ImportReport {
  const bookId = bookIdFromSlug(meta.slug);
  const coverPath = importCover(dir, meta);

  upsertBook({
    id: bookId,
    slug: meta.slug,
    title: meta.title,
    description: meta.description,
    coverPath,
    status: meta.status,
    authorName: meta.author,
    categoryName: meta.category,
    tags: meta.tags,
  });

  const chaptersDir = path.join(dir, 'chapters');
  if (!fs.existsSync(chaptersDir)) {
    console.error(`  ❌ 未找到章节目录: ${chaptersDir}`);
    process.exit(1);
  }

  const files = fs
    .readdirSync(chaptersDir)
    .filter((f) => /\.(md|markdown|txt)$/i.test(f))
    .sort(compareChapterFiles);

  let added = 0;
  let updated = 0;
  files.forEach((file, index) => {
    const number = chapterNumberFromName(file) ?? index + 1;
    const { title, contentMd } = parseChapterFile(path.join(chaptersDir, file), number);
    const result = importChapter({
      bookId,
      number,
      title,
      contentMd,
      slug: null,
      status: meta.chapterStatus,
    });
    if (result.added) added++;
    else updated++;
    console.log(`  · ${file} → 第${number}章 ${title}`);
  });

  return {
    bookId,
    bookSlug: meta.slug,
    title: meta.title,
    added,
    updated,
    total: countChapters(bookId),
  };
}

function main(): void {
  const args = process.argv.slice(2);
  const dirArg = args[0];
  if (!dirArg) {
    console.error('用法: npm run import:novel -- <novels/小说目录>');
    process.exit(1);
  }
  const dir = path.resolve(process.cwd(), dirArg);
  const yamlPath = path.join(dir, 'book.yaml');
  if (!fs.existsSync(yamlPath)) {
    console.error(`未找到 ${yamlPath}`);
    process.exit(1);
  }

  let meta: BookYaml;
  try {
    meta = BookYaml.parse(parseYaml(fs.readFileSync(yamlPath, 'utf-8')));
  } catch (e) {
    console.error('book.yaml 解析失败:', (e as Error).message);
    process.exit(1);
  }

  console.log(`📚 导入: ${meta.title} (${meta.slug})`);
  const report = importBookDir(dir, meta);
  console.log(`✅ ${report.title}: 新增 ${report.added} 章 / 更新 ${report.updated} 章 / 共 ${report.total} 章`);
  console.log(`   数据库: ${getDbPath()}`);
}

main();
