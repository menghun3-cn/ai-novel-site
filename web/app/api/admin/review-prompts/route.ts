import type { NextRequest } from 'next/server';
import { z } from 'zod';
import { createReviewPromptVersion, groupReviewPromptsByName, listReviewPrompts } from '@novel/core';
import { json, readJson, withAdmin, type AdminRouteContext } from '@/lib/admin-api';

export const dynamic = 'force-dynamic';

const createSchema = z.object({
  name: z.string().min(1).max(200),
  content: z.string().min(1),
  version: z.string().max(20).optional(),
  ruleVersionId: z.string().nullish(),
  modelHint: z.string().max(200).nullish(),
  changeNote: z.string().max(1000).nullish(),
});

/** Prompt 版本列表(?name= 过滤;?grouped=1 时按名称分组) */
export const GET = withAdmin<AdminRouteContext>(async (req: NextRequest) => {
  const sp = new URL(req.url).searchParams;
  if (sp.get('grouped') === '1') {
    return json({ groups: groupReviewPromptsByName() });
  }
  return json({ prompts: listReviewPrompts(sp.get('name') ?? undefined) });
});

/** 新建 Prompt 版本(同名迭代;历史版本不可覆盖) */
export const POST = withAdmin<AdminRouteContext>(async (req: NextRequest) => {
  const body = await readJson(req, createSchema);
  return json({ prompt: createReviewPromptVersion(body) }, 201);
});
