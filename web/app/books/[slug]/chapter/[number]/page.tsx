import Link from 'next/link';
import { notFound } from 'next/navigation';
import { getChapterView } from '@novel/core';
import { mdToHtml } from '@/lib/markdown';
import { chapterLabel } from '@/lib/format';
import ReaderControls from '@/components/ReaderControls';
import ReadingProgress from '@/components/ReadingProgress';
import RememberRead from '@/components/RememberRead';

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
    <div className="mx-auto max-w-3xl px-4 py-8">
      <ReadingProgress />

      {/* 标题区 */}
      <div className="mb-6 text-center">
        <Link href={`/books/${book.slug}`} className="text-sm text-neutral-500 hover:underline dark:text-neutral-400">
          {book.title}
        </Link>
        <h1 className="mt-2 text-2xl font-bold">{chapterLabel(chapter.number, chapter.title)}</h1>
      </div>

      <ReaderControls bookSlug={book.slug} chapterNumber={chapter.number} />

      {/* 正文 */}
      <article className="article" dangerouslySetInnerHTML={{ __html: html }} />

      {/* 底部导航 */}
      <nav className="mt-12 flex items-center justify-between border-t border-neutral-200 pt-5 text-sm dark:border-neutral-800">
        {prev ? (
          <Link href={chapterLink(prev.number)} className="text-neutral-600 transition hover:text-sky-600 dark:text-neutral-300 dark:hover:text-sky-400">
            ← 上一章
          </Link>
        ) : (
          <span className="text-neutral-300 dark:text-neutral-600">← 上一章</span>
        )}
        <Link href={`/books/${book.slug}`} className="font-medium text-neutral-600 transition hover:text-sky-600 dark:text-neutral-300 dark:hover:text-sky-400">
          目录
        </Link>
        {next ? (
          <Link href={chapterLink(next.number)} className="text-neutral-600 transition hover:text-sky-600 dark:text-neutral-300 dark:hover:text-sky-400">
            下一章 →
          </Link>
        ) : (
          <span className="text-neutral-300 dark:text-neutral-600">下一章 →</span>
        )}
      </nav>

      <RememberRead bookSlug={book.slug} chapterNumber={chapter.number} />
    </div>
  );
}
