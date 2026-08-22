'use client';

import { useEffect, useRef } from 'react';

/**
 * 记录阅读进度:
 * 1. bookSlug → 最近读到的章节号
 * 2. 章节内的滚动位置（百分比）
 *
 * 滚动位置会防抖保存（每2秒），并在页面离开时立即保存。
 */
export default function RememberRead({
  bookSlug,
  chapterNumber,
}: {
  bookSlug: string;
  chapterNumber: number;
}) {
  const saveTimer = useRef<ReturnType<typeof setInterval> | null>(null);

  // 记录章节号
  useEffect(() => {
    try {
      localStorage.setItem(`novel:last:${bookSlug}`, String(chapterNumber));
    } catch {
      /* ignore */
    }
  }, [bookSlug, chapterNumber]);

  // 记录滚动位置（防抖）
  useEffect(() => {
    const saveScrollPosition = () => {
      try {
        const el = document.documentElement;
        const total = el.scrollHeight - el.clientHeight;
        const percent = total > 0 ? Math.round((el.scrollTop / total) * 100) : 0;
        localStorage.setItem(`novel:scroll:${bookSlug}:${chapterNumber}`, String(percent));
      } catch {
        /* ignore */
      }
    };

    // 每2秒保存一次
    saveTimer.current = setInterval(saveScrollPosition, 2000);

    // 页面离开时立即保存
    const handleBeforeUnload = () => saveScrollPosition();
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'hidden') saveScrollPosition();
    });
    window.addEventListener('beforeunload', handleBeforeUnload);

    return () => {
      if (saveTimer.current) clearInterval(saveTimer.current);
      document.removeEventListener('visibilitychange', handleBeforeUnload);
      window.removeEventListener('beforeunload', handleBeforeUnload);
      // 卸载时也保存一次
      saveScrollPosition();
    };
  }, [bookSlug, chapterNumber]);

  return null;
}
