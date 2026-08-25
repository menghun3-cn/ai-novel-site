import type { NextRequest } from 'next/server';
import { z } from 'zod';
import { createShortStory, listShortStories } from '@novel/core';
import { json, readJson, withAdmin, type AdminRouteContext } from '@/lib/admin-api';

export const dynamic = 'force-dynamic';

const createSchema = z.object({
  title: z.string().max(200).optional(),
  brief: z.record(z.unknown()).optional(),
  sourceUrl: z.string().max(1000).nullish(),
});

/** 短篇小说列表(?status=&q=&limit=) */
export const GET = withAdmin<AdminRouteContext>(async (req: NextRequest) => {
  const sp = new URL(req.url).searchParams;
  return json({
    stories: listShortStories({
      status: sp.get('status') ?? undefined,
      q: sp.get('q') ?? undefined,
      limit: Number(sp.get('limit') ?? '500') || 500,
    }),
  });
});

/** 创建短篇草稿(brief 可空;创作流水线由 /create 单独启动) */
export const POST = withAdmin<AdminRouteContext>(async (req: NextRequest) => {
  const body = await readJson(req, createSchema);
  return json({ story: createShortStory(body) }, 201);
});
