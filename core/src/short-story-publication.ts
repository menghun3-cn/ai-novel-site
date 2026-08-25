// V9 阶段二:短篇"发布"= 物化为 Book+Chapter(1 章,completed),复用读者站 reader
// 设计要点:0 新增阅读组件;同一 short_story 可多次发布不同 version(同 version 重复发布 → 409)
// 历史发布链接永久可访问,满足规格书 §3.3 可追溯原则

import { getDb, genId } from './db';
import { CoreError, type ShortStoryPublication } from './domain';
import { createBook, createChapter } from './service';
import { getShortStory, getStoryVersion, listStoryVersions } from './short-story';

/** 物化短篇时使用的默认作者/分类(首次发布时自动 upsert) */
export const SHORT_STORY_DEFAULT_AUTHOR = 'AI 短篇';
export const SHORT_STORY_DEFAULT_CATEGORY = '短篇小说';

/** 同 version 已发布时返回此码,前端可提示"已发布,无需重复" */
export interface PublishShortStoryResult {
  bookId: string;
  bookSlug: string;
  chapterId: string;
  publicationId: string;
}

/** 取故事要发布的版本(优先 is_final=1,否则 current_version_id,否则最新版本) */
function pickPublishVersion(storyId: string): { versionId: string; content: string } {
  const versions = listStoryVersions(storyId);
  if (versions.length === 0) {
    throw new CoreError('SHORT_STORY_NOT_FOUND', `短篇无任何版本,无法发布: ${storyId}`);
  }
  const final = versions.find((v) => v.isFinal);
  const chosen = final ?? versions[versions.length - 1];
  return { versionId: chosen.id, content: chosen.content };
}

/** 构造候选 slug(基于短篇标题 + 短篇 id 后 6 位),失败时数字后缀递增 */
function buildCandidateSlug(storyId: string, title: string): string {
  const base = title
    .trim()
    .replace(/\s+/g, '-')
    .toLowerCase()
    .replace(/[^a-z0-9\-_]/g, '')
    .slice(0, 40);
  const suffix = storyId.replace(/^ss_/, '').slice(-6);
  return `${base || 'short'}-${suffix}`;
}

function findFreeSlug(candidate: string): string {
  const db = getDb();
  const exists = db.prepare('SELECT 1 AS x FROM books WHERE slug = ?').get(candidate) as { x: number } | undefined;
  if (!exists) return candidate;
  for (let i = 2; i < 100; i++) {
    const next = `${candidate}-${i}`;
    const hit = db.prepare('SELECT 1 AS x FROM books WHERE slug = ?').get(next) as { x: number } | undefined;
    if (!hit) return next;
  }
  throw new CoreError('SLUG_TAKEN', `短篇发布物化 slug 空间耗尽: ${candidate}`);
}

/** 从 brief 拼出简短的 description(首屏副标题) */
function buildDescription(brief: Record<string, unknown> | undefined): string | null {
  if (!brief) return null;
  const parts: string[] = [];
  for (const k of ['theme', 'genre', 'synopsis'] as const) {
    const v = brief[k];
    if (typeof v === 'string' && v.trim()) parts.push(v.trim());
  }
  return parts.length > 0 ? parts.join(' / ') : null;
}

/**
 * 将已通过评审的短篇物化为可对外的 Book+Chapter(1 章)。
 * - 仅 `status='passed'` 状态可发布(防止低质量内容进入读者站)
 * - 同 version 重复发布 → 409 `SHORT_STORY_NOT_PUBLISHED`(消息含"已发布")
 * - 物化产物:`books` 一行 + `chapters` 一行(已 published) + `short_story_publications` 一行
 */
export function publishShortStory(storyId: string, opts?: { versionId?: string }): PublishShortStoryResult {
  const story = getShortStory(storyId);
  if (story.status !== 'passed') {
    throw new CoreError('SHORT_STORY_NOT_PUBLISHED', `仅已达标(passed)短篇可发布,当前状态:${story.status}`);
  }

  // 选版本:opts.versionId 优先,否则 pickPublishVersion
  const { versionId, content } = opts?.versionId
    ? (() => {
        const v = getStoryVersion(opts.versionId!);
        if (v.storyId !== storyId) throw new CoreError('INVALID_INPUT', '版本不属于该短篇');
        return { versionId: v.id, content: v.content };
      })()
    : pickPublishVersion(storyId);

  // 幂等:同 version 已发布则拒绝(避免误覆盖已上线路径)
  const dup = getDb()
    .prepare('SELECT id FROM short_story_publications WHERE story_id = ? AND version_id = ?')
    .get(storyId, versionId) as { id: string } | undefined;
  if (dup) {
    throw new CoreError(
      'SHORT_STORY_NOT_PUBLISHED',
      `该短篇此版本已发布(publicationId=${dup.id}),如需重新发布请基于新版本`
    );
  }

  // slug 与 description
  const candidate = buildCandidateSlug(storyId, story.title);
  const slug = findFreeSlug(candidate);
  const description = buildDescription(story.brief as Record<string, unknown>);

  // 1. 创建 Book(completed,不走 import upsert)
  const book = createBook({
    slug,
    title: story.title,
    description,
    status: 'completed',
    authorName: SHORT_STORY_DEFAULT_AUTHOR,
    categoryName: SHORT_STORY_DEFAULT_CATEGORY,
    tags: [],
  });

  // 2. 创建 Chapter(已 published,publishedAt 由 importChapter 自动取 now)
  const chapter = createChapter({
    bookId: book.id,
    number: 1,
    title: story.title,
    contentMd: content,
    status: 'published',
  });

  // 3. 落 short_story_publications(同 story+version 唯一)
  const publicationId = genId('sspub');
  const now = new Date().toISOString();
  getDb()
    .prepare(
      'INSERT INTO short_story_publications (id, story_id, book_id, version_id, published_at) VALUES (?, ?, ?, ?, ?)'
    )
    .run(publicationId, storyId, book.id, versionId, now);

  return { bookId: book.id, bookSlug: book.slug, chapterId: chapter.id, publicationId };
}

// ---------- 查询 ----------

/** 短篇的全部发布记录(可有多条:不同 version 各发一次) */
export function listPublicationsByStory(storyId: string): ShortStoryPublication[] {
  const rows = getDb()
    .prepare('SELECT * FROM short_story_publications WHERE story_id = ? ORDER BY published_at DESC')
    .all(storyId) as Array<{
    id: string;
    story_id: string;
    book_id: string;
    version_id: string;
    published_at: string;
  }>;
  return rows.map((r) => ({
    id: r.id,
    storyId: r.story_id,
    bookId: r.book_id,
    versionId: r.version_id,
    publishedAt: r.published_at,
  }));
}

export function getPublication(id: string): ShortStoryPublication {
  const row = getDb().prepare('SELECT * FROM short_story_publications WHERE id = ?').get(id) as
    | {
        id: string;
        story_id: string;
        book_id: string;
        version_id: string;
        published_at: string;
      }
    | undefined;
  if (!row) throw new CoreError('PUBLICATION_NOT_FOUND', `发布记录不存在:${id}`);
  return {
    id: row.id,
    storyId: row.story_id,
    bookId: row.book_id,
    versionId: row.version_id,
    publishedAt: row.published_at,
  };
}

/** 由短篇 id 查最新发布记录(无则 null) */
export function latestPublicationByStory(storyId: string): ShortStoryPublication | null {
  const row = getDb()
    .prepare('SELECT * FROM short_story_publications WHERE story_id = ? ORDER BY published_at DESC, rowid DESC LIMIT 1')
    .get(storyId) as
    | {
        id: string;
        story_id: string;
        book_id: string;
        version_id: string;
        published_at: string;
      }
    | undefined;
  return row
    ? { id: row.id, storyId: row.story_id, bookId: row.book_id, versionId: row.version_id, publishedAt: row.published_at }
    : null;
}
