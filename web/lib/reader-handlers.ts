// V6 读者个性化公开端点的共享实现;各路由文件保持 Next 15 签名的薄壳。
// 鉴权走会话 Cookie,未登录一律 401 {error:'UNAUTHENTICATED'}。

import { NextResponse, type NextRequest } from 'next/server';
import { z } from 'zod';
import {
  getBookBySlug,
  toggleFavorite,
  toggleSubscription,
  isFavorited,
  isSubscribed,
  reportProgress,
  getReaderShelf,
  getReadingHistory,
} from '@novel/core';
import { handleError } from '@/lib/admin-api';
import { currentReader } from '@/lib/reader-auth';

export const dynamic = 'force-dynamic';

function requireReader(req: NextRequest) {
  return currentReader(req);
}

function resolveBookId(slug: string): string | null {
  return getBookBySlug(slug)?.id ?? null;
}

function unauthorized(): NextResponse {
  return NextResponse.json({ error: 'UNAUTHENTICATED' }, { status: 401 });
}

function notFound(): NextResponse {
  return NextResponse.json({ error: 'BOOK_NOT_FOUND' }, { status: 404 });
}

/** 切换收藏 */
export async function favoriteToggle(req: NextRequest, slug: string) {
  try {
    const user = requireReader(req);
    if (!user) return unauthorized();
    const bookId = resolveBookId(slug);
    if (!bookId) return notFound();
    return NextResponse.json({ favorited: toggleFavorite(user.id, bookId) });
  } catch (err) {
    return handleError(err);
  }
}

/** 收藏状态 */
export async function favoriteState(req: NextRequest, slug: string) {
  try {
    const user = requireReader(req);
    if (!user) return unauthorized();
    const bookId = resolveBookId(slug);
    if (!bookId) return notFound();
    return NextResponse.json({ favorited: isFavorited(user.id, bookId) });
  } catch (err) {
    return handleError(err);
  }
}

/** 切换订阅 */
export async function subscribeToggle(req: NextRequest, slug: string) {
  try {
    const user = requireReader(req);
    if (!user) return unauthorized();
    const bookId = resolveBookId(slug);
    if (!bookId) return notFound();
    return NextResponse.json({ subscribed: toggleSubscription(user.id, bookId) });
  } catch (err) {
    return handleError(err);
  }
}

/** 订阅状态 */
export async function subscribeState(req: NextRequest, slug: string) {
  try {
    const user = requireReader(req);
    if (!user) return unauthorized();
    const bookId = resolveBookId(slug);
    if (!bookId) return notFound();
    return NextResponse.json({ subscribed: isSubscribed(user.id, bookId) });
  } catch (err) {
    return handleError(err);
  }
}

const progressSchema = z.object({ percent: z.number().min(0).max(100).optional() });

/** 上报阅读进度(章号必须已发布;订阅已看章号只增不减) */
export async function progressReport(req: NextRequest, slug: string, chapterNumber: number) {
  try {
    const user = requireReader(req);
    if (!user) return unauthorized();
    let raw: unknown;
    try {
      raw = await req.json();
    } catch {
      raw = {};
    }
    const parsed = progressSchema.safeParse(raw ?? {});
    if (!parsed.success) return NextResponse.json({ error: 'VALIDATION_FAILED' }, { status: 400 });
    const bookId = resolveBookId(slug);
    if (!bookId) return notFound();
    reportProgress(user.id, bookId, chapterNumber, parsed.data.percent ?? 0);
    return NextResponse.json({ ok: true });
  } catch (err) {
    return handleError(err);
  }
}

/** 我的书架 */
export function shelfList(req: NextRequest) {
  try {
    const user = requireReader(req);
    if (!user) return unauthorized();
    return NextResponse.json({ entries: getReaderShelf(user.id) });
  } catch (err) {
    return handleError(err);
  }
}

/** 阅读历史 */
export function historyList(req: NextRequest) {
  try {
    const user = requireReader(req);
    if (!user) return unauthorized();
    const limit = Number(new URL(req.url).searchParams.get('limit') ?? '20');
    return NextResponse.json({ items: getReadingHistory(user.id, Number.isFinite(limit) ? limit : 20) });
  } catch (err) {
    return handleError(err);
  }
}
