import type { NextRequest } from 'next/server';
import { z } from 'zod';
import {
  deleteShortStory,
  getShortStory,
  latestPublicationByStory,
  latestReviewForVersion,
  listAiTasks,
  listStoryVersions,
  updateShortStory,
} from '@novel/core';
import { json, readJson, withAdmin } from '@/lib/admin-api';
import { revalidateShortStory } from '@/lib/revalidate';

export const dynamic = 'force-dynamic';
type Ctx = { params: Promise<{ id: string }> };

const patchSchema = z.object({
  title: z.string().max(200).optional(),
  brief: z.record(z.unknown()).optional(),
  sourceUrl: z.string().max(1000).nullish(),
});

/**
 * 短篇详情聚合:主档 + 全部版本 + 各版本最新评审 + 该作品的 AI 任务(近 20 条)。
 * 前端进度视图轮询此端点。
 */
export const GET = withAdmin<Ctx>(async (_req, ctx) => {
  const { id } = await ctx.params;
  const story = getShortStory(id);
  const versions = listStoryVersions(id);
  const reviews: Record<string, ReturnType<typeof latestReviewForVersion>> = {};
  for (const v of versions) {
    const rec = latestReviewForVersion(v.id);
    if (rec) reviews[v.id] = rec;
  }
  const publication = latestPublicationByStory(id);
  return json({
    story,
    versions,
    latestReviews: reviews,
    tasks: listAiTasks({ refType: 'short_story', refId: id, limit: 20 }),
    publication: publication
      ? { id: publication.id, bookId: publication.bookId, versionId: publication.versionId, publishedAt: publication.publishedAt }
      : null,
  });
});

/** 编辑主档(标题/brief/sourceUrl);不动任何版本 */
export const PATCH = withAdmin<Ctx>(async (req: NextRequest, ctx) => {
  const { id } = await ctx.params;
  const patch = await readJson(req, patchSchema);
  const story = updateShortStory(id, patch);
  // 编辑主档(标题等)会影响短篇页的展示
  revalidateShortStory(id);
  return json({ story });
});

/** 仅 draft/pool/failed/scheduled 可删 */
export const DELETE = withAdmin<Ctx>(async (_req, ctx) => {
  const { id } = await ctx.params;
  deleteShortStory(id);
  // 删除后短篇页应转为 404
  revalidateShortStory(id);
  return json({ deleted: true });
});
