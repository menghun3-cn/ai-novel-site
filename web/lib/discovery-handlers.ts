// V7 Discovery 端点共享实现;路由文件保持 Next 15 签名薄壳。
// view/finish 为匿名可记的轻量写端点(防滥用靠客户端节流+部署侧限流,见 Agent Note)。

import { NextResponse, type NextRequest } from 'next/server';
import { getBookBySlug, trackChapterView, trackChapterFinish, getBookStats, getDiscoveryFeed } from '@novel/core';
import { handleError } from '@/lib/admin-api';
import { currentReader } from '@/lib/reader-auth';

function resolveBookId(slug: string): string | null {
  return getBookBySlug(slug)?.id ?? null;
}

function notFound(): NextResponse {
  return NextResponse.json({ error: 'BOOK_NOT_FOUND' }, { status: 404 });
}

/** 记录章节 PV:POST /api/books/[slug]/chapters/[n]/view */
export async function viewReport(req: NextRequest, slug: string, chapterNumber: number) {
  try {
    const bookId = resolveBookId(slug);
    if (!bookId) return notFound();
    trackChapterView(bookId, chapterNumber);
    return NextResponse.json({ ok: true });
  } catch (err) {
    return handleError(err);
  }
}

/** 记录章节完读:POST /api/books/[slug]/chapters/[n]/finish */
export async function finishReport(req: NextRequest, slug: string, chapterNumber: number) {
  try {
    const bookId = resolveBookId(slug);
    if (!bookId) return notFound();
    trackChapterFinish(bookId, chapterNumber);
    return NextResponse.json({ ok: true });
  } catch (err) {
    return handleError(err);
  }
}

/** 书籍热度统计:GET /api/books/[slug]/stats */
export function statsGet(_req: NextRequest, slug: string) {
  try {
    const bookId = resolveBookId(slug);
    if (!bookId) return notFound();
    return NextResponse.json(getBookStats(bookId));
  } catch (err) {
    return handleError(err);
  }
}

/** Discovery 板块:GET /api/discovery(登录时附 猜你喜欢) */
export function discoveryGet(req: NextRequest) {
  try {
    const user = currentReader(req);
    return NextResponse.json(getDiscoveryFeed(user?.id));
  } catch (err) {
    return handleError(err);
  }
}
