'use client';

// 详情页 收藏/订阅 按钮组:未登录点击跳登录;已登录切换并回显状态

import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';

interface Props {
  slug: string;
}

export default function BookActions({ slug }: Props) {
  const [favorited, setFavorited] = useState<boolean | null>(null);
  const [subscribed, setSubscribed] = useState<boolean | null>(null);
  const [busy, setBusy] = useState(false);
  const router = useRouter();

  useEffect(() => {
    let alive = true;
    fetch('/api/auth/me', { cache: 'no-store' })
      .then((r) => r.json())
      .then((d: { user: unknown }) => {
        if (!alive) return;
        if (!d.user) {
          setFavorited(false);
          setSubscribed(false);
          return;
        }
        return Promise.all([
          fetch(`/api/books/${slug}/favorite`, { cache: 'no-store' }).then((r) => r.json()),
          fetch(`/api/books/${slug}/subscribe`, { cache: 'no-store' }).then((r) => r.json()),
        ]).then(([f, s]: [{ favorited?: boolean }, { subscribed?: boolean }]) => {
          if (!alive) return;
          setFavorited(Boolean(f.favorited));
          setSubscribed(Boolean(s.subscribed));
        });
      })
      .catch(() => {})
      .finally(() => {
        if (alive) {
          setFavorited((v) => v ?? false);
          setSubscribed((v) => v ?? false);
        }
      });
    return () => {
      alive = false;
    };
  }, [slug]);

  async function toggle(kind: 'favorite' | 'subscribe'): Promise<void> {
    if (busy) return;
    // 未登录 → 引导去登录
    const me = await fetch('/api/auth/me', { cache: 'no-store' }).then((r) => r.json());
    if (!me.user) {
      router.push('/login');
      return;
    }
    setBusy(true);
    try {
      const res = await fetch(`/api/books/${slug}/${kind}`, { method: 'POST' });
      if (res.ok) {
        const d = (await res.json()) as { favorited?: boolean; subscribed?: boolean };
        if (kind === 'favorite') setFavorited(Boolean(d.favorited));
        else setSubscribed(Boolean(d.subscribed));
      }
    } finally {
      setBusy(false);
    }
  }

  const base =
    'rounded-full border px-4 py-2 text-sm font-medium transition active:scale-95 disabled:opacity-50';

  return (
    <span className="flex items-center gap-2">
      <button
        type="button"
        onClick={() => void toggle('favorite')}
        disabled={favorited === null || busy}
        className={`${base} ${
          favorited
            ? 'border-rose-300 bg-rose-50 text-rose-600 dark:border-rose-800 dark:bg-rose-950/40 dark:text-rose-300'
            : 'border-neutral-300 text-neutral-600 hover:border-rose-300 hover:text-rose-600 dark:border-neutral-700 dark:text-neutral-300'
        }`}
      >
        {favorited ? '♥ 已收藏' : '♡ 收藏'}
      </button>
      <button
        type="button"
        onClick={() => void toggle('subscribe')}
        disabled={subscribed === null || busy}
        className={`${base} ${
          subscribed
            ? 'border-sky-300 bg-sky-50 text-sky-600 dark:border-sky-800 dark:bg-sky-950/40 dark:text-sky-300'
            : 'border-neutral-300 text-neutral-600 hover:border-sky-300 hover:text-sky-600 dark:border-neutral-700 dark:text-neutral-300'
        }`}
      >
        {subscribed ? '✓ 已订阅' : '+ 订阅'}
      </button>
    </span>
  );
}
