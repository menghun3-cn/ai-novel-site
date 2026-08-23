import Link from 'next/link';
import { notFound } from 'next/navigation';
import { getChapterView } from '@novel/core';
import { mdToHtml } from '@/lib/markdown';
import { chapterLabel } from '@/lib/format';
import ReaderControls from '@/components/ReaderControls';
import ReadingProgress from '@/components/ReadingProgress';
import RememberRead from '@/components/RememberRead';
import ScrollRestore from '@/components/ScrollRestore';
import SwipeNavigation from '@/components/SwipeNavigation';
import ProgressReporter from '@/components/ProgressReporter';

export const dynamic = 'force-dynamic';

export async function generateMetadata({ params }: { params: Promise<{ slug: string; number: string }> }) {
  const { slug, number } = await params;
  const view = getChapterView(slug, Number(number));
  return {
    title: view ? `${chapterLabel(view.chapter.number, view.chapter.title)} - ${view.book.title}` : '章节不存在',
    description: view?.book.description ?? undefined,
  };
}

export default async function ChapterPage({
  params,
}: {
  params: Promise<{ slug: string; number: string }>;
}) {
  const { slug, number: numberStr } = await params;
  const n = Number(numberStr);
  const view = getChapterView(slug, n);
  if (!view) notFound();

  const { book, chapter, prev, next } = view;
  const html = await mdToHtml(chapter.contentMd);
  const chapterLink = (chNumber: number) => `/books/${book.slug}/chapter/${chNumber}`;

  return (
    <div className="chapter-enter mx-auto max-w-3xl px-4 py-6 sm:px-6 sm:py-8">
      {/* 阅读位置恢复/跳转到顶部 */}
      <ScrollRestore bookSlug={book.slug} chapterNumber={chapter.number} />

      {/* 移动端滑动手势 */}
      <SwipeNavigation
        bookSlug={book.slug}
        prevChapter={prev?.number ?? null}
        nextChapter={next?.number ?? null}
      />

      <ReadingProgress />

      {/* 标题区 - 移动端自适应 */}
      <div className="mb-4 text-center sm:mb-6">
        <Link
          href={`/books/${book.slug}`}
          className="text-xs text-neutral-500 hover:underline dark:text-neutral-400 sm:text-sm"
        >
          {book.title}
        </Link>
        <h1 className="mt-2 text-xl font-bold sm:text-2xl">{chapterLabel(chapter.number, chapter.title)}</h1>
      </div>

      <ReaderControls bookSlug={book.slug} chapterNumber={chapter.number} />

      {/* 正文 - 移动端自适应 */}
      <article className="article" dangerouslySetInnerHTML={{ __html: html }} />

      {/* 底部导航 - 移动端更大的触控目标 */}
      <nav className="mt-8 flex items-center justify-between border-t border-neutral-200 pt-4 text-sm dark:border-neutral-800 sm:mt-12 sm:pt-5">
        {prev ? (
          <Link
            href={chapterLink(prev.number)}
            className="flex items-center gap-1 rounded-lg px-3 py-2 text-neutral-600 transition hover:bg-neutral-100 hover:text-sky-600 active:scale-95 dark:text-neutral-300 dark:hover:bg-neutral-800 dark:hover:text-sky-400"
          >
            <span className="text-lg">←</span>
            <span className="hidden sm:inline">上一章</span>
            <span className="sm:hidden">上</span>
          </Link>
        ) : (
          <span className="px-3 py-2 text-neutral-300 dark:text-neutral-600">← 上一章</span>
        )}
        <Link
          href={`/books/${book.slug}`}
          className="rounded-lg px-4 py-2 font-medium text-neutral-600 transition hover:bg-neutral-100 hover:text-sky-600 active:scale-95 dark:text-neutral-300 dark:hover:bg-neutral-800 dark:hover:text-sky-400"
        >
          目录
        </Link>
        {next ? (
          <Link
            href={chapterLink(next.number)}
            className="flex items-center gap-1 rounded-lg px-3 py-2 text-neutral-600 transition hover:bg-neutral-100 hover:text-sky-600 active:scale-95 dark:text-neutral-300 dark:hover:bg-neutral-800 dark:hover:text-sky-400"
          >
            <span className="sm:hidden">下</span>
            <span className="hidden sm:inline">下一章</span>
            <span className="text-lg">→</span>
          </Link>
        ) : (
          <span className="px-3 py-2 text-neutral-300 dark:text-neutral-600">下一章 →</span>
        )}
      </nav>

      <RememberRead bookSlug={book.slug} chapterNumber={chapter.number} />
      <ProgressReporter bookSlug={book.slug} chapterNumber={chapter.number} />
    </div>
  );
}
