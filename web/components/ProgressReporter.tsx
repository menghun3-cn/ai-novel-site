'use client';

// 章节页滚动进度上报:仅登录读者生效;首次滚动即时上报,此后变化≥5%或每8秒节流;
// 离开页面时用 keepalive 兜底最后一次。

import { useEffect, useRef } from 'react';

interface Props {
  bookSlug: string;
  chapterNumber: number;
}

export default function ProgressReporter({ bookSlug, chapterNumber }: Props) {
  // 用 ref 保存最新值,监听器只挂一次
  const percentRef = useRef(0);
  const lastSentRef = useRef(-100);
  const lastTimeRef = useRef(0);
  const loggedInRef = useRef<boolean | null>(null);

  useEffect(() => {
    let alive = true;

    fetch('/api/auth/me', { cache: 'no-store' })
      .then((r) => r.json())
      .then((d: { user: unknown }) => {
        if (alive) loggedInRef.current = Boolean(d.user);
      })
      .catch(() => {});

    function compute(): number {
      const doc = document.documentElement;
      const total = doc.scrollHeight - window.innerHeight;
      if (total <= 0) return 100;
      return Math.max(0, Math.min(100, Math.round((window.scrollY / total) * 100)));
    }

    async function send(): Promise<void> {
      if (loggedInRef.current !== true) return;
      const percent = percentRef.current;
      if (percent === lastSentRef.current) return;
      lastSentRef.current = percent;
      lastTimeRef.current = Date.now();
      try {
        await fetch(`/api/books/${bookSlug}/chapters/${chapterNumber}/progress`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ percent }),
          keepalive: true,
        });
      } catch {}
    }

    function onScroll(): void {
      const p = compute();
      if (p > percentRef.current) percentRef.current = p; // 只前进不回退
      const now = Date.now();
      const delta = Math.abs(percentRef.current - lastSentRef.current);
      if ((delta >= 5 && now - lastTimeRef.current > 1500) || now - lastTimeRef.current > 8000) {
        void send();
      }
    }

    function onLeave(): void {
      void send();
    }

    window.addEventListener('scroll', onScroll, { passive: true });
    document.addEventListener('visibilitychange', onLeave);
    window.addEventListener('pagehide', onLeave);

    return () => {
      alive = false;
      onLeave();
      window.removeEventListener('scroll', onScroll);
      document.removeEventListener('visibilitychange', onLeave);
      window.removeEventListener('pagehide', onLeave);
    };
  }, [bookSlug, chapterNumber]);

  return null;
}
