import type { NextRequest } from 'next/server';
import { getShortStory, getBookById, latestPublicationByStory, getStoryVersion, CoreError } from '@novel/core';

export const dynamic = 'force-dynamic';

type Ctx = { params: Promise<{ id: string }> };

/**
 * 公开短篇详情:按短篇 id 取最新发布版本(passed 后(/admin/creation)publish 才会物化)。
 * 未公开短篇 → 404 PUBLICATION_NOT_FOUND(不要暴露后台状态泄漏)。
 */
export async function GET(_req: NextRequest, ctx: Ctx) {
  const { id } = await ctx.params;
  try {
    const story = getShortStory(id);
    const pub = latestPublicationByStory(id);
    if (!pub) {
      return Response.json(
        { error: 'PUBLICATION_NOT_FOUND', message: '该短篇尚未公开发布' },
        { status: 404 }
      );
    }
    const book = getBookById(pub.bookId);
    if (!book || book.status === 'hidden') {
      return Response.json(
        { error: 'PUBLICATION_NOT_FOUND', message: '该发布内容已下线' },
        { status: 404 }
      );
    }
    const version = getStoryVersion(pub.versionId);
    return Response.json({
      storyId: story.id,
      publicationId: pub.id,
      versionId: pub.versionId,
      publishedAt: pub.publishedAt,
      book: {
        id: book.id,
        slug: book.slug,
        title: book.title,
        description: book.description,
        authorName: book.authorName,
        categoryName: book.categoryName,
        kind: book.kind,
      },
      content: version.content,
      charCount: version.content.length,
    });
  } catch (err) {
    if (err instanceof CoreError) {
      if (err.code === 'SHORT_STORY_NOT_FOUND') {
        return Response.json({ error: err.code, message: '短篇不存在' }, { status: 404 });
      }
      return Response.json({ error: err.code, message: err.message }, { status: 500 });
    }
    return Response.json({ error: 'INTERNAL_ERROR' }, { status: 500 });
  }
}
