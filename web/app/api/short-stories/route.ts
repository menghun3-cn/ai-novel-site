import type { NextRequest } from 'next/server';
import { getDb } from '@novel/core';
import { CoreError } from '@novel/core';

export const dynamic = 'force-dynamic';

interface ShortStoryPublicItem {
  storyId: string;
  publicationId: string;
  bookId: string;
  slug: string;
  title: string;
  description: string | null;
  authorName: string;
  categoryName: string;
  publishedAt: string;
  charCount: number;
}

/**
 * 公开短篇列表(已发布)。按发布时间倒序,默认 limit 50。
 * 与长篇共用发现位:前端 BookCard 通过 kind 字段区分。
 */
export async function GET(req: NextRequest) {
  const sp = new URL(req.url).searchParams;
  const limit = Math.min(Math.max(Number(sp.get('limit') ?? '50') || 50, 1), 200);
  try {
    const rows = getDb()
      .prepare(
        `SELECT ssp.id AS publication_id, ssp.story_id, ssp.published_at, ssp.version_id,
                b.id AS book_id, b.slug, b.title, b.description, b.kind,
                a.name AS author_name, c.name AS category_name,
                (SELECT content FROM short_story_versions v WHERE v.id = ssp.version_id) AS content
         FROM short_story_publications ssp
         JOIN books b ON b.id = ssp.book_id
         JOIN authors a ON a.id = b.author_id
         JOIN categories c ON c.id = b.category_id
         ORDER BY ssp.published_at DESC, ssp.rowid DESC
         LIMIT ?`
      )
      .all(limit) as Array<{
        publication_id: string;
        story_id: string;
        published_at: string;
        version_id: string;
        book_id: string;
        slug: string;
        title: string;
        description: string | null;
        kind: 'short' | 'long';
        author_name: string;
        category_name: string;
        content: string;
      }>;
    const items: ShortStoryPublicItem[] = rows.map((r) => ({
      storyId: r.story_id,
      publicationId: r.publication_id,
      bookId: r.book_id,
      slug: r.slug,
      title: r.title,
      description: r.description,
      authorName: r.author_name,
      categoryName: r.category_name,
      publishedAt: r.published_at,
      charCount: r.content.length,
    }));
    return Response.json({ items });
  } catch (err) {
    if (err instanceof CoreError) {
      return Response.json({ error: err.code, message: err.message }, { status: 500 });
    }
    return Response.json({ error: 'INTERNAL_ERROR' }, { status: 500 });
  }
}
