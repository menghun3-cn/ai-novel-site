'use client';

import { useEffect } from 'react';

/** 记录阅读进度:bookSlug → 最近读到的章节号 */
export default function RememberRead({
  bookSlug,
  chapterNumber,
}: {
  bookSlug: string;
  chapterNumber: number;
}) {
  useEffect(() => {
    try {
      localStorage.setItem(`novel:last:${bookSlug}`, String(chapterNumber));
    } catch {
      /* ignore */
    }
  }, [bookSlug, chapterNumber]);

  return null;
}
