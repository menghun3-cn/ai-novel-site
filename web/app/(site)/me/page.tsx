'use client';

// 个人中心:账号信息 + 最近阅读(历史),轻量实现

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';

interface Me {
  id: string;
  username: string;
  email: string;
}

interface HistItem {
  bookId: string;
  slug: string;
  title: string;
  chapterNumber: number;
  percent: number;
  updatedAt: string;
}

export default function MePage() {
  const [me, setMe] = useState<Me | null>(null);
  const [loading, setLoading] = useState(true);
  const [history, setHistory] = useState<HistItem[]>([]);
  const router = useRouter();

  useEffect(() => {
    fetch('/api/auth/me', { cache: 'no-store' })
      .then((r) => r.json())
      .then(async (d: { user: Me | null }) => {
        setMe(d.user);
        if (d.user) {
          const h = await fetch('/api/me/history?limit=20', { cache: 'no-store' }).then((r) => r.json());
          setHistory((h.items ?? []) as HistItem[]);
        }
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  async function logout(): Promise<void> {
    await fetch('/api/auth/logout', { method: 'POST' });
    window.dispatchEvent(new Event('reader:changed'));
    router.push('/');
    router.refresh();
  }

  if (loading) {
    return <div className="mx-auto max-w-3xl px-4 py-12 text-sm text-neutral-500">加载中…</div>;
  }

  if (!me) {
    return (
      <div className="mx-auto max-w-sm px-4 py-16 text-center">
        <p className="text-sm text-neutral-600 dark:text-neutral-300">请先登录后查看个人中心</p>
        <Link
          href="/login"
          className="mt-4 inline-block h-10 rounded-lg bg-sky-600 px-5 text-sm font-medium leading-10 text-white transition hover:bg-sky-500"
        >
          去登录
        </Link>
      </div>
    );
  }

  return (
    <div className="mx-auto w-full max-w-3xl px-4 py-8">
      {/* 账号卡 */}
      <section className="flex flex-wrap items-center gap-x-6 gap-y-2 rounded-xl border border-neutral-200 p-5 dark:border-neutral-800">
        <span className="flex h-12 w-12 items-center justify-center rounded-full bg-sky-100 text-lg font-bold text-sky-700 dark:bg-sky-950 dark:text-sky-300">
          {me.username.slice(0, 1)}
        </span>
        <span className="min-w-0 flex-1">
          <span className="block truncate font-semibold text-neutral-900 dark:text-neutral-100">{me.username}</span>
          <span className="block truncate text-xs text-neutral-500 dark:text-neutral-400">{me.email}</span>
        </span>
        <button
          type="button"
          onClick={() => void logout()}
          className="rounded-full border border-neutral-300 px-4 py-1.5 text-xs text-neutral-600 transition hover:border-red-300 hover:text-red-600 dark:border-neutral-700 dark:text-neutral-300"
        >
          退出登录
        </button>
      </section>

      {/* 阅读历史 */}
      <h2 className="mt-8 text-lg font-bold text-neutral-900 dark:text-neutral-100">最近阅读</h2>
      {history.length === 0 ? (
        <p className="mt-3 text-sm text-neutral-500 dark:text-neutral-400">还没有阅读记录</p>
      ) : (
        <ul className="mt-3 space-y-2.5">
          {history.map((h) => (
            <li key={`${h.bookId}-${h.chapterNumber}`}>
              <Link
                href={`/books/${h.slug}/chapter/${h.chapterNumber}`}
                className="flex items-center justify-between rounded-lg border border-neutral-200 px-4 py-3 text-sm transition hover:border-sky-300 dark:border-neutral-800 dark:hover:border-sky-700"
              >
                <span className="min-w-0 truncate text-neutral-800 dark:text-neutral-200">{h.title}</span>
                <span className="shrink-0 pl-3 text-xs text-neutral-500 dark:text-neutral-400">
                  第{h.chapterNumber}章 · {h.percent}%
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
