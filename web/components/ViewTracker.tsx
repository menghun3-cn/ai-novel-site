'use client';

// V7 热度信号上报:挂载即记 PV;滚动 ≥95% 记一次完读。匿名可报,与登录进度无关。

import { useEffect, useRef } from 'react';

interface Props {
  bookSlug: string;
  chapterNumber: number;
}

export default function ViewTracker({ bookSlug, chapterNumber }: Props) {
  const finishedRef = useRef(false);

  useEffect(() => {
    const base = `/api/books/${bookSlug}/chapters/${chapterNumber}`;

    fetch(`${base}/view`, { method: 'POST', keepalive: true }).catch(() => {});

    function onScroll(): void {
      if (finishedRef.current) return;
      const doc = document.documentElement;
      const total = doc.scrollHeight - window.innerHeight;
      const percent = total <= 0 ? 100 : (window.scrollY / total) * 100;
      if (percent >= 95) {
        finishedRef.current = true;
        fetch(`${base}/finish`, { method: 'POST', keepalive: true }).catch(() => {});
        window.removeEventListener('scroll', onScroll);
      }
    }

    window.addEventListener('scroll', onScroll, { passive: true });
    return () => {
      window.removeEventListener('scroll', onScroll);
    };
  }, [bookSlug, chapterNumber]);

  return null;
}
