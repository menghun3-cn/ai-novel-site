import type { NextRequest } from 'next/server';
import { getShortStory, setFinalVersion } from '@novel/core';
import { json, withAdmin } from '@/lib/admin-api';
import { revalidateShortStory } from '@/lib/revalidate';

export const dynamic = 'force-dynamic';

type Ctx = { params: Promise<{ id: string; versionId: string }> };

/**
 * 设定指定版本为最终版(回退到历史版本):清除其余 is_final 后标记目标版本,
 * 并同步 current_version_id。配合 /republish 可把线上内容回退到任意历史版本。
 * 注意:set-final 只改主档,不改线上快照——线上是否更新由 republish 决定。
 */
export const POST = withAdmin<Ctx>(async (_req: NextRequest, ctx) => {
  const { id, versionId } = await ctx.params;
  getShortStory(id); // 存在性守卫
  const version = setFinalVersion(id, versionId);
  revalidateShortStory(id);
  return json({ version });
});
