import type { NextRequest } from 'next/server';
import { z } from 'zod';
import { enqueuePublishShortStory, publishShortStory, getShortStory } from '@novel/core';
import { json, readJson, withAdmin } from '@/lib/admin-api';

export const dynamic = 'force-dynamic';

type Ctx = { params: Promise<{ id: string }> };

const bodySchema = z.object({}).optional();

/**
 * 手动发布/补发短篇。
 *   - 默认行为:story.status==='passed' → 立即同步执行 publishShortStory 并返回结果;
 *   - async=true:转异步,入队 PUBLISH_SHORT_STORY 任务(失败可由任务系统重试)。
 *   - 不允许对 passed 之外的草稿/流水线中状态发布(保护版本完整性)。
 */
export const POST = withAdmin<Ctx>(async (req: NextRequest, ctx) => {
  const { id } = await ctx.params;
  const sp = new URL(req.url).searchParams;
  const async = sp.get('async') === '1';
  await readJson(req, bodySchema).catch(() => ({})); // 允许空 body
  getShortStory(id); // 存在性守卫
  if (async) {
    const task = enqueuePublishShortStory(id);
    return json({ queued: true, taskId: task.id }, 202);
  }
  const pub = publishShortStory(id);
  return json({ publicationId: pub.publicationId, bookId: pub.bookId, bookSlug: pub.bookSlug });
});
