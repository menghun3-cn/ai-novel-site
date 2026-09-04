import Link from 'next/link';
import { listCategories } from '@novel/core';

export const revalidate = 60;

export const metadata = { title: '分类' };

const GROUPS = [
  { key: 'long', title: '长篇小说', countKey: 'longCount' as const, href: (slug: string) => `/categories/${encodeURIComponent(slug)}?kind=long` },
  { key: 'short', title: '短篇小说', countKey: 'shortCount' as const, href: (slug: string) => `/categories/${encodeURIComponent(slug)}?kind=short` },
];

export default function CategoriesPage() {
  const cats = listCategories();

  return (
    <div className="mx-auto max-w-5xl px-4 py-8">
      <h1 className="text-2xl font-bold">分类</h1>
      {cats.length === 0 ? (
        <p className="mt-6 text-sm text-neutral-400">还没有任何分类。</p>
      ) : (
        <div className="mt-6 space-y-10">
          {GROUPS.map((g) => {
            const items = cats.filter((c) => c[g.countKey] > 0);
            return (
              <section key={g.key}>
                <h2 className="text-lg font-semibold text-neutral-700 dark:text-neutral-200">{g.title}</h2>
                {items.length === 0 ? (
                  <p className="mt-3 text-sm text-neutral-400">暂无{g.title}。</p>
                ) : (
                  <div className="mt-3 grid grid-cols-2 gap-4 sm:grid-cols-3 md:grid-cols-4">
                    {items.map((c) => (
                      <Link
                        key={c.slug}
                        href={g.href(c.slug)}
                        className="rounded-xl border border-neutral-200 p-5 transition hover:-translate-y-0.5 hover:border-sky-500 hover:shadow-md dark:border-neutral-800 dark:hover:border-sky-400"
                      >
                        <p className="font-semibold">{c.name}</p>
                        <p className="mt-1 text-xs text-neutral-400 dark:text-neutral-500">{c[g.countKey]} 本</p>
                      </Link>
                    ))}
                  </div>
                )}
              </section>
            );
          })}
        </div>
      )}
    </div>
  );
}
