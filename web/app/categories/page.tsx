import Link from 'next/link';
import { listCategories } from '@novel/core';

export const dynamic = 'force-dynamic';

export const metadata = { title: '分类' };

export default function CategoriesPage() {
  const cats = listCategories();

  return (
    <div className="mx-auto max-w-5xl px-4 py-8">
      <h1 className="text-2xl font-bold">分类</h1>
      {cats.length === 0 ? (
        <p className="mt-6 text-sm text-neutral-400">还没有任何分类。</p>
      ) : (
        <div className="mt-6 grid grid-cols-2 gap-4 sm:grid-cols-3 md:grid-cols-4">
          {cats.map((c) => (
            <Link
              key={c.slug}
              href={`/categories/${encodeURIComponent(c.slug)}`}
              className="rounded-xl border border-neutral-200 p-5 transition hover:-translate-y-0.5 hover:border-sky-500 hover:shadow-md dark:border-neutral-800 dark:hover:border-sky-400"
            >
              <p className="font-semibold">{c.name}</p>
              <p className="mt-1 text-xs text-neutral-400 dark:text-neutral-500">{c.count} 本小说</p>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
