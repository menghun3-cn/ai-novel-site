import type { NextRequest } from 'next/server';
import { z } from 'zod';
import {
  CoreError,
  enqueueChapterReview,
  listChapterReviews,
  latestChapterReview,
  getDb,
  getBookById,
} from '@novel/core';
import { json, readJson, withAdmin, type AdminRouteContext } from '@/lib/admin-api';

export const dynamic = 'force-dynamic';

/** 单章或批量:chapterId 与 chapterIds 二选一 */
const enqueueSchema = z.union([
  z.object({ chapterId: z.string().min(1) }),
  z.object({ chapterIds: z.array(z.string().min(1)).min(1).max(200) }),
]);

interface ChapterRowLite {
  id: string;
  book_id: string;
  number: number;
  title: string;
  status: string;
}

/**
 * 章节评审管理端:
 *   GET ?chapterId=...          → 列出该章的所有评审记录
 *   POST { chapterId }          → 入队一次 AI_REVIEW_CHAPTER 任务
 *   POST { chapterIds: [...] }  → 批量入队;逐章校验,返回 enqueued/skipped/failed 明细
 *
 * 跳过规则与发布自动入队守卫一致:
 *   - 非 published 章节
 *   - 书籍关闭章节评审(chapter_review_enabled=0)
 *   - 该章已有 PENDING/RUNNING 的评审任务(去重)
 */
export const GET = withAdmin<AdminRouteContext>(async (req: NextRequest) => {
  const sp = new URL(req.url).searchParams;
  const chapterId = sp.get('chapterId');
  if (!chapterId) return json({ error: 'INVALID_INPUT', message: 'chapterId 必填' }, 400);
  const list = listChapterReviews(chapterId);
  const latest = latestChapterReview(chapterId);
  return json({ items: list, latest });
});

function validateAndEnqueueOne(db: ReturnType<typeof getDb>, chapterId: string): { ok: true; taskId: string } | { ok: false; reason: string } {
  const row = db.prepare('SELECT id, book_id, number, title, status FROM chapters WHERE id = ?').get(chapterId) as ChapterRowLite | undefined;
  if (!row) return { ok: false, reason: `章节不存在: ${chapterId}` };
  if (row.status !== 'published') return { ok: false, reason: `第${row.number}章「${row.title}」未发布(status=${row.status})` };
  const book = getBookById(row.book_id);
  if (book && !book.chapterReviewEnabled) return { ok: false, reason: `第${row.number}章所属书籍已禁用章节评审` };
  const dup = db
    .prepare(`SELECT id FROM ai_tasks WHERE type = 'AI_REVIEW_CHAPTER' AND ref_id = ? AND status IN ('PENDING','RUNNING') LIMIT 1`)
    .get(chapterId);
  if (dup) return { ok: false, reason: `第${row.number}章已有待处理评审任务` };
  const task = enqueueChapterReview(chapterId);
  return { ok: true, taskId: task.id };
}

export const POST = withAdmin<AdminRouteContext>(async (req: NextRequest) => {
  const input = await readJson(req, enqueueSchema);
  const db = getDb();

  if ('chapterIds' in input) {
    // 批量:逐章校验入队,单章失败不阻塞其余
    const enqueued: Array<{ chapterId: string; taskId: string }> = [];
    const skipped: Array<{ chapterId: string; reason: string }> = [];
    for (const chapterId of input.chapterIds) {
      try {
        const r = validateAndEnqueueOne(db, chapterId);
        if (r.ok) enqueued.push({ chapterId, taskId: r.taskId });
        else skipped.push({ chapterId, reason: r.reason });
      } catch (err) {
        skipped.push({ chapterId, reason: err instanceof Error ? err.message : '入队失败' });
      }
    }
    return json({ batch: true, enqueuedCount: enqueued.length, skippedCount: skipped.length, enqueued, skipped }, 201);
  }

  // 单章
  const r = validateAndEnqueueOne(db, input.chapterId);
  if (!r.ok) throw new CoreError('INVALID_INPUT', r.reason);
  return json({ task: { id: r.taskId, status: 'PENDING', type: 'AI_REVIEW_CHAPTER' } }, 201);
});
