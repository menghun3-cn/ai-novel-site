import { z } from 'zod';
import { getAiSerialization, configureAiSerialization } from '@novel/core';
import { json, readJson, withAdmin } from '@/lib/admin-api';

export const dynamic = 'force-dynamic';

type Ctx = { params: Promise<{ id: string }> };

const putSchema = z.object({
  enabled: z.boolean().optional(),
  hour: z.number().int().min(0).max(23).optional(),
  count: z.number().int().min(1).max(20).optional(),
  autoPublish: z.boolean().optional(),
  minChars: z.number().int().min(200).max(20000).optional(),
});

/** 查询某书 AI 连载配置(未配置返回虚拟默认值) */
export const GET = withAdmin<Ctx>(async (_req, ctx) => {
  const { id } = await ctx.params;
  return json({ config: getAiSerialization(id) });
});

/** 更新 AI 连载配置(部分字段生效;校验失败 → 400 INVALID_AI_SERIALIZATION) */
export const PUT = withAdmin<Ctx>(async (req, ctx) => {
  const { id } = await ctx.params;
  const patch = await readJson(req, putSchema);
  return json({ config: configureAiSerialization(id, patch) });
});
