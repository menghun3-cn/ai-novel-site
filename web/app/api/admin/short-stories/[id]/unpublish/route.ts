import type { NextRequest } from 'next/server';
import { revalidatePath } from 'next/cache';
import { unpublishShortStory } from '@novel/core';
import { json, withAdmin } from '@/lib/admin-api';
import { revalidateShortStory } from '@/lib/revalidate';

export const dynamic = 'force-dynamic';

type Ctx = { params: Promise<{ id: string }> };

/**
 * 下架已发布短篇:线上 Book 置 hidden,读者页 /short/[id] 立即 404。
 * 幂等;不删数据,重新 publish/republish 会恢复可见。
 * 首页/最新页的书单缓存一并失效(hidden 书不再出现在列表)。
 */
export const POST = withAdmin<Ctx>(async (req: NextRequest, ctx) => {
  const { id } = await ctx.params;
  await req.json().catch(() => ({})); // 允许空 body
  const result = unpublishShortStory(id);
  revalidateShortStory(id);
  revalidatePath('/', 'page');
  revalidatePath('/latest', 'page');
  return json(result);
});
