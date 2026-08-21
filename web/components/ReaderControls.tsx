'use client';

import { useEffect, useState } from 'react';

const MIN = 14;
const MAX = 24;
const KEY = 'novel:fontSize';

/** 阅读页字号调节:持久化到 localStorage,通过 CSS 变量作用于正文 */
export default function ReaderControls({
  bookSlug,
  chapterNumber,
}: {
  bookSlug: string;
  chapterNumber: number;
}) {
  const [size, setSize] = useState(18);

  useEffect(() => {
    try {
      const v = Number(localStorage.getItem(KEY));
      if (v >= MIN && v <= MAX) setSize(v);
    } catch {
      /* ignore */
    }
  }, []);

  useEffect(() => {
    document.documentElement.style.setProperty('--reader-size', `${size}px`);
  }, [size]);

  const apply = (next: number) => {
    setSize(next);
    try {
      localStorage.setItem(KEY, String(next));
    } catch {
      /* ignore */
    }
  };

  return (
    <div className="mb-6 flex items-center justify-center gap-3 text-sm">
      <button
        onClick={() => apply(Math.max(MIN, size - 1))}
        disabled={size <= MIN}
        aria-label="减小字号"
        className="h-8 w-8 rounded-full border border-neutral-300 text-neutral-600 transition hover:bg-neutral-100 disabled:opacity-40 dark:border-neutral-700 dark:text-neutral-300 dark:hover:bg-neutral-800"
      >
        A−
      </button>
      <span className="w-14 text-center text-xs text-neutral-400 dark:text-neutral-500">{size}px</span>
      <button
        onClick={() => apply(Math.min(MAX, size + 1))}
        disabled={size >= MAX}
        aria-label="增大字号"
        className="h-8 w-8 rounded-full border border-neutral-300 text-neutral-600 transition hover:bg-neutral-100 disabled:opacity-40 dark:border-neutral-700 dark:text-neutral-300 dark:hover:bg-neutral-800"
      >
        A+
      </button>
      <span className="ml-2 text-xs text-neutral-400 dark:text-neutral-500">第{chapterNumber}章</span>
    </div>
  );
}
