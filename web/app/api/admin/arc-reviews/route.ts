import type { NextRequest } from 'next/server';
import { z } from 'zod';
import {
  CoreError,
  enqueueArcReview,
  listArcReviewRecords,
  shouldTriggerAutoArcReview,
  getBookById,
  getBookBySlug,
} from '@novel/core';
import { json, readJson, withAdmin, type AdminRouteContext } from '@/lib/admin-api';

export const dynamic = 'force-dynamic';

const enqueueSchema = z.object({
  bookId: z.string().min(1),
  arcLabel: z.string().min(1).max(200),
  fromChapter: z.number().int().positive(),
  toChapter: z.number().int().positive(),
});

/**
 * 弧级评审管理端:
 *   GET ?bookId=...        → 列出该书所有弧评记录 + 半自动阈值判定
 *   POST { bookId, arcLabel, fromChapter, toChapter } → 入队一次 AI_REVIEW_ARC
 */
export const GET = withAdmin<AdminRouteContext>(async (req: NextRequest) => {
  const sp = new URL(req.url).searchParams;
  const bookId = sp.get('bookId');
  if (!bookId) return json({ error: 'INVALID_INPUT', message: 'bookId 必填' }, 400);
  const items = listArcReviewRecords(bookId);
  const suggestion = shouldTriggerAutoArcReview(bookId);
  return json({ items, suggestion });
});

export const POST = withAdmin<AdminRouteContext>(async (req: NextRequest) => {
  const input = await readJson(req, enqueueSchema);
  if (input.fromChapter > input.toChapter) {
    throw new CoreError('CHAPTER_NOT_FOUND_IN_ARC', 'fromChapter 必须 ≤ toChapter');
  }
  const book = getBookById(input.bookId);
  if (!book) throw new CoreError('ARC_NOT_FOUND', `书不存在: ${input.bookId}`);
  if (!book.arcReviewEnabled) {
    throw new CoreError('ARC_NOT_FOUND', '该书已禁用弧级评审(arc_review_enabled=0)');
  }
  const task = enqueueArcReview(input);
  return json(
    {
      task: { id: task.id, status: task.status, type: task.type, refId: task.refId, createdAt: task.createdAt },
      arcLabel: input.arcLabel,
      range: { from: input.fromChapter, to: input.toChapter },
    },
    201
  );
});

void getBookBySlug;
