import type { NextRequest } from 'next/server';
import { z } from 'zod';
import { getLlmSettings, setLlmSettings } from '@novel/core';
import { json, readJson, withAdmin, type AdminRouteContext } from '@/lib/admin-api';

export const dynamic = 'force-dynamic';

const putSchema = z.object({
  baseUrl: z.string().trim().url().max(500).nullish(),
  apiKey: z.string().trim().max(300).nullish(),
  model: z.string().trim().max(120).nullish(),
});

/** 查询 LLM 配置;API Key 只回掩码与是否已配置 */
export const GET = withAdmin<AdminRouteContext>(async () => {
  return json({ llm: getLlmSettings() });
});

/**
 * 部分保存 LLM 配置:undefined = 不变;null/空串 = 清除。
 * 明文 Key 只进库,响应永远只含掩码。
 */
export const PUT = withAdmin<AdminRouteContext>(async (req: NextRequest) => {
  const body = await readJson(req, putSchema);
  return json({
    llm: setLlmSettings({
      baseUrl: body.baseUrl ?? undefined,
      apiKey: body.apiKey ?? undefined,
      model: body.model ?? undefined,
    }),
  });
});
