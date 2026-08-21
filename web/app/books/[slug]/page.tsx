import Link from 'next/link';
import { notFound } from 'next/navigation';
import { getBookBySlug, listPublishedChapters } from '@novel/core';
import ContinueReading from '@/components/ContinueReading';
import { chapterLabel } from '@/lib/format';

export const dynamic = 'force-dynamic';

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const book = getBookBySlug(slug);
  return {
    title: book?.title ?? '小说不存在',
    description: book?.description ?? undefined,
  };
}

export default async function BookDetailPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const book = getBookBySlug(slug);
  if (!book) notFound();

  const chapters = listPublishedChapters(book.id);
  const first = chapters[0];
  const latest = chapters[chapters.length - 1];

  return (
    <div className="mx-auto max-w-5xl px-4 py-8">
      <div className="flex flex-col gap-6 md:flex-row">
        {/* 封面 */}
        <div className="w-44 shrink-0 self-center md:self-auto">
          <div className="aspect-[3/4] overflow-hidden rounded-xl border border-neutral-200 bg-neutral-100 dark:border-neutral-800 dark:bg-neutral-900">
            {book.coverPath ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={`/${book.coverPath}`} alt={book.title} className="h-full w-full object-cover" />
            ) : (
              <div className="flex h-full items-center justify-center text-6xl font-bold text-neutral-300 dark:text-neutral-700">
                {book.title.slice(0, 1)}
              </div>
            )}
          </div>
        </div>

        {/* 信息 */}
        <div className="flex-1">
          <h1 className="text-3xl font-bold">{book.title}</h1>
          <p className="mt-2 text-sm text-neutral-500 dark:text-neutral-400">
            {book.authorName} · {book.categoryName} ·{' '}
            {book.status === 'serializing' ? '连载中' : '已完结'} · {chapters.length} 章
          </p>
          {book.tags.length > 0 && (
            <div className="mt-3 flex flex-wrap gap-2">
              {book.tags.map((t) => (
                <span
                  key={t}
                  className="rounded-full bg-neutral-100 px-2.5 py-0.5 text-xs text-neutral-600 dark:bg-neutral-800 dark:text-neutral-300"
                >
                  {t}
                </span>
              ))}
            </div>
          )}
          {book.description && (
            <p className="mt-4 whitespace-pre-line text-sm leading-7 text-neutral-600 dark:text-neutral-300">
              {book.description}
            </p>
          )}
          <div className="mt-6 flex flex-wrap items-center gap-3">
            {first && (
              <Link
                href={`/books/${book.slug}/chapter/${first.number}`}
                className="rounded-full bg-sky-600 px-6 py-2.5 text-sm font-medium text-white transition hover:bg-sky-500"
              >
                开始阅读
              </Link>
            )}
            <ContinueReading bookSlug={book.slug} latestNumber={latest?.number ?? null} />
          </div>
        </div>
      </div>

      {/* 章节列表 */}
      <section className="mt-12">
        <div className="mb-4 flex items-baseline justify-between">
          <h2 className="text-lg font-bold">章节列表</h2>
          {latest && (
            <span className="text-xs text-neutral-400 dark:text-neutral-500">
              最新:{chapterLabel(latest.number, latest.title)}
            </span>
          )}
        </div>
        {chapters.length === 0 ? (
          <p className="text-sm text-neutral-400">暂无已发布章节。</p>
        ) : (
          <ol className="grid grid-cols-1 gap-1 sm:grid-cols-2 md:grid-cols-3">
            {chapters.map((ch) => (
              <li key={ch.id}>
                <Link
                  href={`/books/${book.slug}/chapter/${ch.number}`}
                  className="block truncate rounded-md px-3 py-2 text-sm text-neutral-700 transition hover:bg-neutral-100 hover:text-sky-600 dark:text-neutral-300 dark:hover:bg-neutral-800 dark:hover:text-sky-400"
                >
                  {chapterLabel(ch.number, ch.title)}
                </Link>
              </li>
            ))}
          </ol>
        )}
      </section>
    </div>
  );
}
