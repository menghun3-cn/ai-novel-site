import Link from 'next/link';
import { searchBooks } from '@novel/core';
import { chapterLabel } from '@/lib/format';

export const dynamic = 'force-dynamic';

export const metadata = { title: '搜索' };

export default async function SearchPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string }>;
}) {
  const { q = '' } = await searchParams;
  const query = q.trim();
  const results = query ? searchBooks(query) : [];

  return (
    <div className="mx-auto max-w-5xl px-4 py-8">
      <h1 className="text-2xl font-bold">搜索</h1>
      <form action="/search" method="get" className="mt-4 flex max-w-xl gap-2">
        <input
          name="q"
          defaultValue={query}
          placeholder="输入书名/作者/标签"
          className="h-10 flex-1 rounded-full border border-neutral-300 bg-transparent px-4 text-sm outline-none transition focus:border-sky-500 dark:border-neutral-700"
        />
        <button
          type="submit"
          className="h-10 rounded-full bg-sky-600 px-6 text-sm font-medium text-white transition hover:bg-sky-500"
        >
          搜索
        </button>
      </form>

      {query && (
        <p className="mt-6 text-sm text-neutral-500 dark:text-neutral-400">
          「{query}」共找到 {results.length} 本小说
        </p>
      )}

      {query && results.length === 0 && (
        <p className="mt-8 text-sm text-neutral-400">没有找到相关小说,试试书名、作者或标签。</p>
      )}

      {results.length > 0 && (
        <ul className="mt-4 divide-y divide-neutral-100 rounded-xl border border-neutral-200 dark:divide-neutral-800 dark:border-neutral-800">
          {results.map((b) => (
            <li key={b.id} className="flex items-center gap-4 px-4 py-3">
              <div className="h-14 w-10 shrink-0 overflow-hidden rounded bg-neutral-100 dark:bg-neutral-900">
                {b.coverPath ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={`/${b.coverPath}`} alt={b.title} loading="lazy" decoding="async" className="h-full w-full object-cover" />
                ) : null}
              </div>
              <div className="min-w-0 flex-1">
                <Link href={`/books/${b.slug}`} className="font-medium hover:text-sky-600 dark:hover:text-sky-400">
                  {b.title}
                </Link>
                <p className="mt-0.5 truncate text-xs text-neutral-500 dark:text-neutral-400">
                  {b.authorName} · {b.categoryName}
                  {b.tags.length > 0 ? ` · ${b.tags.join('、')}` : ''}
                </p>
              </div>
              <div className="shrink-0 text-right text-xs text-neutral-400 dark:text-neutral-500">
                <p>{b.publishedCount} 章</p>
                {b.latestChapterNumber && b.latestChapterTitle && (
                  <Link
                    href={`/books/${b.slug}/chapter/${b.latestChapterNumber}`}
                    className="mt-0.5 block hover:text-sky-600 dark:hover:text-sky-400"
                  >
                    {chapterLabel(b.latestChapterNumber, b.latestChapterTitle)}
                  </Link>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
