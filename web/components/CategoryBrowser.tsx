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

/** 分类详情浏览:kind 筛选在客户端完成,页面保持 ISR 静态渲染 */
export default function CategoryBrowser({ cat, books }: { cat: CategoryWithCount; books: BookWithMeta[] }) {
  const [kind, setKind] = useState<string | undefined>(undefined);

  useEffect(() => {
    const p = new URLSearchParams(window.location.search);
    const k = p.get('kind');
    if (k === 'long' || k === 'short') setKind(k);
  }, []);

  const filtered = useMemo(() => books.filter((b) => !kind || b.kind === kind), [books, kind]);
  const count = kind ? (kind === 'long' ? cat.longCount : cat.shortCount) : cat.count;

  return (
    <div className="mx-auto max-w-5xl px-4 py-8">
      <h1 className="text-2xl font-bold">{cat.name}小说</h1>
      <p className="mt-1 text-sm text-neutral-500 dark:text-neutral-400">{count} 本</p>

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
