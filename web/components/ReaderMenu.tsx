'use client';

// Header 右侧读者入口:未登录显示 登录/注册;已登录显示 书架 + 用户名 + 退出

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';

interface Me {
  id: string;
  username: string;
}

export default function ReaderMenu() {
  const [me, setMe] = useState<Me | null>(null);
  const [loading, setLoading] = useState(true);
  const router = useRouter();

  useEffect(() => {
    let alive = true;
    const load = (): void => {
      fetch('/api/auth/me', { cache: 'no-store' })
        .then((r) => r.json())
        .then((d: { user: Me | null }) => {
          if (alive) setMe(d.user);
        })
        .catch(() => {})
        .finally(() => {
          if (alive) setLoading(false);
        });
    };
    load();
    // 登录/注册/登出后由页面派发,免整页刷新即可更新菜单
    window.addEventListener('reader:changed', load);
    return () => {
      alive = false;
      window.removeEventListener('reader:changed', load);
    };
  }, []);

  async function logout(): Promise<void> {
    await fetch('/api/auth/logout', { method: 'POST' });
    setMe(null);
    window.dispatchEvent(new Event('reader:changed'));
    router.refresh();
  }

  if (loading) {
    return <span className="h-9 w-16 shrink-0 animate-pulse rounded-full bg-neutral-100 dark:bg-neutral-800" aria-hidden />;
  }

  if (!me) {
    return (
      <span className="flex shrink-0 items-center gap-1">
        <Link
          href="/login"
          className={menuLink}
        >
          登录
        </Link>
        <Link
          href="/register"
          className="h-9 shrink-0 rounded-full bg-sky-600 px-3.5 text-sm font-medium leading-9 text-white transition hover:bg-sky-500"
        >
          注册
        </Link>
      </span>
    );
  }

  return (
    <span className="flex shrink-0 items-center gap-1">
      <Link href="/shelf" className={menuLink}>
        书架
      </Link>
      <Link href="/me" className={`${menuLink} hidden sm:inline-block`} title="个人中心">
        {me.username}
      </Link>
      <button type="button" onClick={() => void logout()} className={`${menuLink} cursor-pointer`}>
        退出
      </button>
    </span>
  );
}

const menuLink =
  'rounded-md px-2 py-1.5 text-sm text-neutral-600 transition hover:bg-neutral-100 hover:text-neutral-900 dark:text-neutral-400 dark:hover:bg-neutral-800 dark:hover:text-neutral-100 md:px-2.5';
