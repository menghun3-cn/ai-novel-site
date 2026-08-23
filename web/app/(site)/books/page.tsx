import Link from 'next/link';
import { listBooks, listCategories } from '@novel/core';
import BookCard from '@/components/BookCard';

export const dynamic = 'force-dynamic';

export const metadata = { title: '全部小说' };

function chip(active: boolean): string {
  return `rounded-full px-3.5 py-1.5 text-sm transition ${
    active
      ? 'bg-sky-600 text-white'
      : 'border border-neutral-300 text-neutral-600 hover:border-sky-500 hover:text-sky-600 dark:border-neutral-700 dark:text-neutral-300 dark:hover:border-sky-400 dark:hover:text-sky-400'
  }`;
}

export default async function BooksPage({
  searchParams,
}: {
  searchParams: Promise<{ category?: string }>;
}) {
  const { category } = await searchParams;
  const books = listBooks({ categorySlug: category });
  const cats = listCategories();

  return (
    <div className="mx-auto max-w-5xl px-4 py-8">
      <h1 className="text-2xl font-bold">全部小说</h1>

      <div className="mt-4 flex flex-wrap items-center gap-2">
        <Link href="/books" className={chip(!category)}>
          全部
        </Link>
        {cats.map((c) => (
          <Link
            key={c.slug}
            href={`/books?category=${encodeURIComponent(c.slug)}`}
            className={chip(category === c.slug)}
          >
            {c.name}
            <span className="ml-1 text-xs opacity-70">{c.count}</span>
          </Link>
        ))}
      </div>

      {books.length === 0 ? (
        <p className="mt-10 text-sm text-neutral-400">该分类下还没有小说。</p>
      ) : (
        <div className="mt-6 grid grid-cols-2 gap-4 sm:grid-cols-3 md:grid-cols-5">
          {books.map((b) => (
            <BookCard key={b.id} book={b} />
          ))}
        </div>
      )}
    </div>
  );
}
