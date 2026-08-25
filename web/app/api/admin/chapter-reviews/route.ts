import type { NextRequest } from 'next/server';
import { z } from 'zod';
import {
  CoreError,
  enqueueChapterReview,
  listChapterReviews,
  latestChapterReview,
  getChapterByNumber,
  getBookById,
} from '@novel/core';
import { json, readJson, withAdmin, type AdminRouteContext } from '@/lib/admin-api';

export const dynamic = 'force-dynamic';

const enqueueSchema = z.object({ chapterId: z.string().min(1) });

/**
 * 章节评审管理端:
 *   GET ?chapterId=...   → 列出该章的所有评审记录
 *   POST { chapterId }   → 入队一次 AI_REVIEW_CHAPTER 任务(立即或被调度器拾取)
 */
export const GET = withAdmin<AdminRouteContext>(async (req: NextRequest) => {
  const sp = new URL(req.url).searchParams;
  const chapterId = sp.get('chapterId');
  if (!chapterId) return json({ error: 'INVALID_INPUT', message: 'chapterId 必填' }, 400);
  const list = listChapterReviews(chapterId);
  const latest = latestChapterReview(chapterId);
  return json({ items: list, latest });
});

export const POST = withAdmin<AdminRouteContext>(async (req: NextRequest) => {
  const input = await readJson(req, enqueueSchema);
  // 验证 chapter 存在并 published
  const db = (await import('@novel/core')).getDb;
  const row = db()
    .prepare('SELECT id, book_id, number, status FROM chapters WHERE id = ?')
    .get(input.chapterId) as { id: string; book_id: string; number: number; status: string } | undefined;
  if (!row) throw new CoreError('CHAPTER_NOT_FOUND_IN_ARC', `章节不存在: ${input.chapterId}`);
  if (row.status !== 'published') {
    throw new CoreError('CHAPTER_NOT_FOUND_IN_ARC', `仅已发布章节可入队评审,当前 status=${row.status}`);
  }
  const book = getBookById(row.book_id);
  if (book && !book.chapterReviewEnabled) {
    throw new CoreError('CHAPTER_NOT_FOUND_IN_ARC', '该书已禁用章节评审(chapter_review_enabled=0)');
  }
  const task = enqueueChapterReview(input.chapterId);
  // 顺手取一下章节信息供前端展示
  const ch = getChapterByNumber(row.book_id, row.number);
  return json(
    {
      task: { id: task.id, status: task.status, type: task.type, refId: task.refId, createdAt: task.createdAt },
      chapter: ch ? { id: ch.id, number: ch.number, title: ch.title, status: ch.status } : null,
    },
    201
  );
});
