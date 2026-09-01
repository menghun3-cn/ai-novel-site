import type { NextRequest } from 'next/server';
import { z } from 'zod';
import {
  CoreError,
  appendVersion,
  getShortStory,
} from '@novel/core';
import { json, readJson, withAdmin } from '@/lib/admin-api';
import { revalidateShortStory } from '@/lib/revalidate';

export const dynamic = 'force-dynamic';

type Ctx = { params: Promise<{ id: string }> };

const bodySchema = z.object({
  content: z.string().min(1, '版本正文不能为空'),
});

/**
 * 追加用户编辑版本(creationReason='user_edited')。
 * 旧版本永不修改——所有用户修订一律产生新版本行,可追溯。
 * 与 AI 修订(ai_optimized)的区别:不触发评审/优化任务,仅追加版本,评审记录跟随(按需可手动触发)。
 */
export const POST = withAdmin<Ctx>(async (req: NextRequest, ctx) => {
  const { id } = await ctx.params;
  const story = getShortStory(id); // 存在性守卫
  if (story.status === 'failed') {
    throw new CoreError('INVALID_INPUT', '失败状态不可直接追加版本,请先修改 brief 重跑流水线');
  }
  const { content } = await readJson(req, bodySchema);
  const version = appendVersion(id, {
    content,
    creationReason: 'user_edited',
    modelName: 'user-edit',
  });
  // 追加用户编辑版本:刷新短篇页(若当前发布版本即将随之更新)
  revalidateShortStory(id);
  return json({ version }, 201);
});
