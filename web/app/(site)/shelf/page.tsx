'use client';

// 我的书架:收藏∪订阅,含 阅读至第N章·进度%·有更新;支持 全部/收藏/订阅 筛选

import Link from 'next/link';
import { useEffect, useMemo, useState } from 'react';

interface Entry {
  bookId: string;
  slug: string;
  title: string;
  authorName: string;
  publishedCount: number;
  latestChapter: number | null;
  favorited: boolean;
  subscribed: boolean;
  progressChapter: number | null;
  progressPercent: number;
  hasUpdate: boolean;
}

type Tab = 'all' | 'fav' | 'sub';

export default function ShelfPage() {
  const [entries, setEntries] = useState<Entry[] | null>(null);
  const [authed, setAuthed] = useState<boolean | null>(null);
  const [tab, setTab] = useState<Tab>('all');

  useEffect(() => {
    fetch('/api/auth/me', { cache: 'no-store' })
      .then((r) => r.json())
      .then((d: { user: unknown }) => {
        setAuthed(Boolean(d.user));
        if (d.user) {
          return fetch('/api/me/shelf', { cache: 'no-store' })
            .then((r) => r.json())
            .then((s: { entries: Entry[] }) => setEntries(s.entries));
        }
      })
      .catch(() => setEntries([]));
  }, []);

  const shown = useMemo(() => {
    if (!entries) return [];
    if (tab === 'fav') return entries.filter((e) => e.favorited);
    if (tab === 'sub') return entries.filter((e) => e.subscribed);
    return entries;
  }, [entries, tab]);

  const tabs: Array<[Tab, string]> = [
    ['all', `全部${entries ? ` ${entries.length}` : ''}`],
    ['fav', '收藏'],
    ['sub', '订阅'],
  ];

  return (
    <div className="mx-auto w-full max-w-3xl px-4 py-8">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-neutral-900 dark:text-neutral-100">我的书架</h1>
        {authed && (
          <nav className="flex gap-1 rounded-full bg-neutral-100 p-1 text-sm dark:bg-neutral-800">
            {tabs.map(([id, label]) => (
              <button
                key={id}
                type="button"
                onClick={() => setTab(id)}
                className={`rounded-full px-3.5 py-1 transition ${
                  tab === id
                    ? 'bg-white font-medium text-neutral-900 shadow-sm dark:bg-neutral-950 dark:text-neutral-100'
                    : 'text-neutral-500 hover:text-neutral-800 dark:hover:text-neutral-200'
                }`}
              >
                {label}
              </button>
            ))}
          </nav>
        )}
      </div>

      {!authed ? (
        <div className="mt-6 rounded-xl border border-neutral-200 p-8 text-center dark:border-neutral-800">
          <p className="text-sm text-neutral-600 dark:text-neutral-300">登录后即可收藏小说、同步阅读进度</p>
          <Link
            href="/login"
            className="mt-4 inline-block h-10 rounded-lg bg-sky-600 px-5 text-sm font-medium leading-10 text-white transition hover:bg-sky-500"
          >
            去登录
          </Link>
        </div>
      ) : entries === null ? (
        <p className="mt-6 text-sm text-neutral-500">加载中…</p>
      ) : shown.length === 0 ? (
        <div className="mt-6 rounded-xl border border-dashed border-neutral-300 p-10 text-center dark:border-neutral-700">
          <p className="text-sm text-neutral-500 dark:text-neutral-400">
            书架还是空的——去{' '}
            <Link href="/books" className="text-sky-600 hover:underline dark:text-sky-400">
              全部小说
            </Link>{' '}
            收藏一本吧
          </p>
        </div>
      ) : (
        <ul className="mt-5 space-y-3">
          {shown.map((e) => {
            // 继续阅读:未读完回到进度章;读完(≥95%)则下一章;追平最新则重读最新章
            const target =
              e.progressChapter === null
                ? 1
                : Math.min(e.progressChapter + (e.progressPercent >= 95 ? 1 : 0), e.latestChapter ?? e.progressChapter);
            return (
              <li
                key={e.bookId}
                className="flex items-center gap-4 rounded-xl border border-neutral-200 p-4 transition hover:border-sky-300 dark:border-neutral-800 dark:hover:border-sky-700"
              >
                <Link href={`/books/${e.slug}`} className="min-w-0 flex-1">
                  <span className="flex flex-wrap items-center gap-2">
                    <span className="truncate font-medium text-neutral-900 dark:text-neutral-100">{e.title}</span>
                    {e.hasUpdate && (
                      <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-[11px] font-medium text-emerald-700 dark:bg-emerald-950/60 dark:text-emerald-300">
                        有更新 · 最新第{e.latestChapter}章
                      </span>
                    )}
                  </span>
                  <span className="mt-1 block text-xs text-neutral-500 dark:text-neutral-400">
                    {e.authorName}
                    {' · '}
                    {e.progressChapter === null
                      ? `未开始 · 共${e.publishedCount}章`
                      : `阅读至第${e.progressChapter}章 · 进度${e.progressPercent}%`}
                  </span>
                </Link>
                <Link
                  href={`/books/${e.slug}/chapter/${target}`}
                  className="shrink-0 rounded-full bg-sky-600 px-4 py-2 text-xs font-medium text-white transition hover:bg-sky-500"
                >
                  {e.progressChapter === null ? '开始阅读' : '继续阅读'}
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
