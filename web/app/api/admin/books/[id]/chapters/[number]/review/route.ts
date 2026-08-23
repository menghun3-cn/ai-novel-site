import type { NextRequest } from 'next/server';
import { z } from 'zod';
import { approveChapter, rejectChapter, submitChapterForReview } from '@novel/core';
import { fail, intParam, json, readJson, withAdmin } from '@/lib/admin-api';

export const dynamic = 'force-dynamic';

type Ctx = { params: Promise<{ id: string; number: string }> };

const reviewSchema = z.discriminatedUnion('action', [
  z.object({ action: z.literal('submit') }),
  z.object({
    action: z.literal('approve'),
    mode: z.enum(['now', 'scheduled']),
    scheduledAt: z.string().datetime().optional(),
  }),
  z.object({ action: z.literal('reject'), note: z.string().max(1000).nullish() }),
]);

/** 审核动作入口:submit / approve(now|scheduled) / reject(note?) */
export const POST = withAdmin<Ctx>(async (req: NextRequest, ctx) => {
  const { id, number } = await ctx.params;
  const n = intParam(number, 'number');
  const body = await readJson(req, reviewSchema);
  switch (body.action) {
    case 'submit':
      return json({ chapter: submitChapterForReview(id, n) });
    case 'approve': {
      if (body.mode === 'scheduled') {
        if (!body.scheduledAt) {
          return fail(400, 'INVALID_REVIEW_TRANSITION', 'scheduled approval requires scheduledAt');
        }
        const scheduledAt = new Date(body.scheduledAt);
        if (Number.isNaN(scheduledAt.getTime())) {
          return fail(400, 'INVALID_REVIEW_TRANSITION', `invalid scheduledAt: ${body.scheduledAt}`);
        }
        return json({ chapter: approveChapter(id, n, { mode: 'scheduled', scheduledAt: scheduledAt.toISOString() }) });
      }
      return json({ chapter: approveChapter(id, n, { mode: 'now' }) });
    }
    case 'reject':
      return json({ chapter: rejectChapter(id, n, body.note ?? null) });
  }
});
