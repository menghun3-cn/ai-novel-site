'use client';

// 我的书架(占位):V6-PR34 将替换为 收藏/订阅/进度 的完整实现

import Link from 'next/link';
import { useEffect, useState } from 'react';

interface Me {
  id: string;
  username: string;
}

export default function ShelfPage() {
  const [me, setMe] = useState<Me | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch('/api/auth/me', { cache: 'no-store' })
      .then((r) => r.json())
      .then((d: { user: Me | null }) => setMe(d.user))
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  return (
    <div className="mx-auto w-full max-w-3xl px-4 py-12">
      <h1 className="text-2xl font-bold text-neutral-900 dark:text-neutral-100">我的书架</h1>
      {loading ? (
        <p className="mt-6 text-sm text-neutral-500">加载中…</p>
      ) : !me ? (
        <div className="mt-6 rounded-xl border border-neutral-200 p-8 text-center dark:border-neutral-800">
          <p className="text-sm text-neutral-600 dark:text-neutral-300">登录后即可收藏小说、同步阅读进度</p>
          <Link
            href="/login"
            className="mt-4 inline-block h-10 rounded-lg bg-sky-600 px-5 text-sm font-medium leading-10 text-white transition hover:bg-sky-500"
          >
            去登录
          </Link>
        </div>
      ) : (
        <p className="mt-6 text-sm text-neutral-500 dark:text-neutral-400">
          {me.username}，书架内容即将上线——先去{' '}
          <Link href="/books" className="text-sky-600 hover:underline dark:text-sky-400">
            全部小说
          </Link>{' '}
          挑一本开始阅读吧。
        </p>
      )}
    </div>
  );
}
