'use client';

import { useEffect, useState, useCallback } from 'react';

const MIN = 14;
const MAX = 24;
const KEY = 'novel:fontSize';
const KEY_MOBILE = 'novel:fontSizeMobile';

/** 判断是否为移动端设备 */
function isMobileDevice(): boolean {
  if (typeof window === 'undefined') return false;
  return window.innerWidth <= 640 || 'ontouchstart' in window;
}

/** 阅读页字号调节:持久化到 localStorage,通过 CSS 变量作用于正文
 *  移动端和PC端分别保存字号偏好
 */
export default function ReaderControls({
  bookSlug,
  chapterNumber,
}: {
  bookSlug: string;
  chapterNumber: number;
}) {
  const isMobile = isMobileDevice();
  const defaultSize = isMobile ? 16 : 18;
  const [size, setSize] = useState(defaultSize);

  useEffect(() => {
    try {
      const storageKey = isMobileDevice() ? KEY_MOBILE : KEY;
      const v = Number(localStorage.getItem(storageKey));
      if (v >= MIN && v <= MAX) {
        setSize(v);
      }
    } catch {
      /* ignore */
    }
  }, []);

  useEffect(() => {
    const storageKey = isMobileDevice() ? KEY_MOBILE : KEY;
    document.documentElement.style.setProperty('--reader-size', `${size}px`);
    if (isMobileDevice()) {
      document.documentElement.style.setProperty('--reader-size-mobile', `${size}px`);
    }
  }, [size]);

  const apply = useCallback(
    (next: number) => {
      const clamped = Math.max(MIN, Math.min(MAX, next));
      setSize(clamped);
      const storageKey = isMobileDevice() ? KEY_MOBILE : KEY;
      try {
        localStorage.setItem(storageKey, String(clamped));
      } catch {
        /* ignore */
      }
    },
    [],
  );

  return (
    <div className="mb-4 flex items-center justify-between gap-2 text-sm sm:justify-center sm:gap-3">
      {/* 移动端：左右分列排版更友好 */}
      <div className="flex items-center gap-2 sm:gap-3">
        <button
          onClick={() => apply(size - 1)}
          disabled={size <= MIN}
          aria-label="减小字号"
          className="flex h-10 w-10 items-center justify-center rounded-full border border-neutral-300 text-sm font-medium text-neutral-600 transition hover:bg-neutral-100 active:scale-95 disabled:opacity-40 dark:border-neutral-700 dark:text-neutral-300 dark:hover:bg-neutral-800 sm:h-8 sm:w-8"
        >
          A−
        </button>
        <span className="w-14 text-center text-xs text-neutral-400 dark:text-neutral-500">{size}px</span>
        <button
          onClick={() => apply(size + 1)}
          disabled={size >= MAX}
          aria-label="增大字号"
          className="flex h-10 w-10 items-center justify-center rounded-full border border-neutral-300 text-sm font-medium text-neutral-600 transition hover:bg-neutral-100 active:scale-95 disabled:opacity-40 dark:border-neutral-700 dark:text-neutral-300 dark:hover:bg-neutral-800 sm:h-8 sm:w-8"
        >
          A+
        </button>
      </div>

      <span className="text-xs text-neutral-400 dark:text-neutral-500">第{chapterNumber}章</span>
    </div>
  );
}
