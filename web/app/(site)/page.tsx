import Link from 'next/link';
import { featuredBook, latestUpdates, listBooks } from '@novel/core';
import BookCard from '@/components/BookCard';
import { chapterLabel, formatDateTime } from '@/lib/format';

export const dynamic = 'force-dynamic';

export default function HomePage() {
  const featured = featuredBook();
  const updates = latestUpdates(10);
  const books = listBooks({ limit: 8 });

  return (
    <div className="mx-auto max-w-5xl px-4 py-8">
      {/* 今日推荐 */}
      {featured && (
        <section className="mb-10 overflow-hidden rounded-2xl border border-neutral-200 bg-gradient-to-br from-sky-50 to-white dark:border-neutral-800 dark:from-neutral-900 dark:to-neutral-950">
          <div className="flex flex-col gap-6 p-6 md:flex-row md:items-center">
            <Link href={`/books/${featured.slug}`} className="block w-40 shrink-0 self-center md:self-auto">
              <div className="aspect-[3/4] overflow-hidden rounded-lg bg-neutral-200 dark:bg-neutral-800">
                {featured.coverPath ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={`/${featured.coverPath}`} alt={featured.title} className="h-full w-full object-cover" />
                ) : (
                  <div className="flex h-full items-center justify-center text-5xl font-bold text-neutral-400 dark:text-neutral-600">
                    {featured.title.slice(0, 1)}
                  </div>
                )}
              </div>
            </Link>
            <div className="flex-1 text-center md:text-left">
              <p className="text-xs font-medium tracking-widest text-sky-600 dark:text-sky-400">今日推荐</p>
              <h1 className="mt-1 text-2xl font-bold">{featured.title}</h1>
              <p className="mt-1 text-sm text-neutral-500 dark:text-neutral-400">{featured.authorName}</p>
              {featured.latestChapterNumber && featured.latestChapterTitle && (
                <Link
                  href={`/books/${featured.slug}/chapter/${featured.latestChapterNumber}`}
                  className="mt-3 block text-sm text-neutral-600 hover:text-sky-600 dark:text-neutral-300 dark:hover:text-sky-400"
                >
                  最新章节:{chapterLabel(featured.latestChapterNumber, featured.latestChapterTitle)}
                </Link>
              )}
              <div className="mt-5">
                <Link
                  href={`/books/${featured.slug}/chapter/${featured.latestChapterNumber ?? 1}`}
                  className="inline-block rounded-full bg-sky-600 px-6 py-2.5 text-sm font-medium text-white transition hover:bg-sky-500"
                >
                  开始阅读
                </Link>
              </div>
            </div>
          </div>
        </section>
      )}

      {/* 最新更新 */}
      <section className="mb-10">
        <h2 className="mb-4 text-lg font-bold">最新更新</h2>
        {updates.length === 0 ? (
          <p className="text-sm text-neutral-400">还没有已发布章节。</p>
        ) : (
          <ul className="divide-y divide-neutral-100 rounded-xl border border-neutral-200 dark:divide-neutral-800 dark:border-neutral-800">
            {updates.map((u) => (
              <li key={u.chapter.id} className="flex items-center gap-3 px-4 py-3">
                <Link
                  href={`/books/${u.bookSlug}`}
                  className="w-40 truncate font-medium hover:text-sky-600 dark:hover:text-sky-400"
                >
                  {u.bookTitle}
                </Link>
                <Link
                  href={`/books/${u.bookSlug}/chapter/${u.chapter.number}`}
                  className="flex-1 truncate text-sm text-neutral-600 hover:text-sky-600 dark:text-neutral-300 dark:hover:text-sky-400"
                >
                  {chapterLabel(u.chapter.number, u.chapter.title)}
                </Link>
                <span className="shrink-0 text-xs text-neutral-400 dark:text-neutral-500">
                  {formatDateTime(u.chapter.publishedAt)}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>

      {/* 小说库 */}
      <section>
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-lg font-bold">小说库</h2>
          <Link href="/books" className="text-sm text-sky-600 hover:underline dark:text-sky-400">
            查看全部 →
          </Link>
        </div>
        {books.length === 0 ? (
          <p className="text-sm text-neutral-400">还没有导入任何小说。</p>
        ) : (
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 md:grid-cols-4">
            {books.map((b) => (
              <BookCard key={b.id} book={b} />
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
