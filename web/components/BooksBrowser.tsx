'use client';

import { useEffect, useMemo, useState } from 'react';
import type { BookWithMeta, CategoryWithCount } from '@novel/core';
import BookCard from '@/components/BookCard';

const KIND_TABS = [
  { key: undefined as string | undefined, label: '全部' },
  { key: 'long', label: '长篇小说' },
  { key: 'short', label: '短篇小说' },
] as const;

function chip(active: boolean): string {
  return `rounded-full px-3.5 py-1.5 text-sm transition ${
    active
      ? 'bg-sky-600 text-white'
      : 'border border-neutral-300 text-neutral-600 hover:border-sky-500 hover:text-sky-600 dark:border-neutral-700 dark:text-neutral-300 dark:hover:border-sky-400 dark:hover:text-sky-400'
  }`;
}

/**
 * 全部小说浏览:筛选全部在客户端完成,切换 kind/分类零服务端往返。
 * 页面为 ISR 静态渲染,首次请求后切换无 SQL、无重新渲染(消除约百本书时的卡顿)。
 * 用 useEffect 读 URL 参数做初始筛选,避免 useSearchParams 令整段边界退化为纯客户端渲染。
 */
export default function BooksBrowser({ books, cats }: { books: BookWithMeta[]; cats: CategoryWithCount[] }) {
  const [category, setCategory] = useState<string | undefined>(undefined);
  const [kind, setKind] = useState<string | undefined>(undefined);

  useEffect(() => {
    const p = new URLSearchParams(window.location.search);
    const k = p.get('kind');
    if (k === 'long' || k === 'short') setKind(k);
    if (p.get('category')) setCategory(p.get('category')!);
  }, []);

  const catById = useMemo(() => new Map(cats.map((c) => [c.id, c])), [cats]);
  const filtered = useMemo(
    () =>
      books.filter(
        (b) => (!kind || b.kind === kind) && (!category || catById.get(b.categoryId)?.slug === category)
      ),
    [books, kind, category, catById]
  );

  const chipCount = (c: CategoryWithCount) => (kind ? (kind === 'long' ? c.longCount : c.shortCount) : c.count);
  const total = useMemo(() => {
    if (category) {
      const c = cats.find((x) => x.slug === category);
      return c ? chipCount(c) : 0;
    }
    return cats.reduce((s, c) => s + chipCount(c), 0);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cats, kind, category]);

  return (
    <div className="mx-auto max-w-5xl px-4 py-8">
      <h1 className="text-2xl font-bold">全部小说</h1>

      <div className="mt-4 flex flex-wrap items-center gap-2">
        {KIND_TABS.map((t) => (
          <button
            key={t.key ?? 'all'}
            type="button"
            onClick={() => setKind(t.key)}
            className={chip(kind === t.key)}
          >
            {t.label}
          </button>
        ))}
      </div>

      <div className="mt-4 flex flex-wrap items-center gap-2">
        <button type="button" onClick={() => setCategory(undefined)} className={chip(!category)}>
          全部
          <span className="ml-1 text-xs opacity-70">{total}</span>
        </button>
        {cats.map((c) => (
          <button
            key={c.slug}
            type="button"
            onClick={() => setCategory(category === c.slug ? undefined : c.slug)}
            className={chip(category === c.slug)}
          >
            {c.name}
            <span className="ml-1 text-xs opacity-70">{chipCount(c)}</span>
          </button>
        ))}
      </div>

      <p className="mt-4 text-sm text-neutral-500 dark:text-neutral-400">共 {total} 本</p>

      {filtered.length === 0 ? (
        <p className="mt-10 text-sm text-neutral-400">该分类下还没有小说。</p>
      ) : (
        <div className="mt-6 grid grid-cols-2 gap-4 sm:grid-cols-3 md:grid-cols-5">
          {filtered.map((b) => (
            <BookCard key={b.id} book={b} />
          ))}
        </div>
      )}
    </div>
  );
}
