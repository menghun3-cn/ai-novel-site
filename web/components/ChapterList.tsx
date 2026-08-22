'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { chapterLabel } from '@/lib/format';

interface ChapterItem {
  id: string;
  number: number;
  title: string;
  publishedAt: string | null;
}

/**
 * 章节目录组件。
 * 支持正序/倒序切换，持久化到 localStorage。
 * 已读章节显示绿色对勾标记。
 */
export default function ChapterList({
  bookSlug,
  chapters,
}: {
  bookSlug: string;
  chapters: ChapterItem[];
}) {
  const [reversed, setReversed] = useState(false);
  const [readChapters, setReadChapters] = useState<Set<number>>(new Set());

  // 初始化排序偏好
  useEffect(() => {
    try {
      const v = localStorage.getItem(`novel:toc-order:${bookSlug}`);
      setReversed(v === 'desc');
    } catch {
      /* ignore */
    }
  }, [bookSlug]);

  // 加载已读章节
  useEffect(() => {
    try {
      const read = new Set<number>();
      // 读取上次阅读的章节号
      const last = localStorage.getItem(`novel:last:${bookSlug}`);
      if (last) {
        const lastNum = Number(last);
        // 标记 lastNum 及之前的所有章节为已读
        for (const ch of chapters) {
          if (ch.number <= lastNum) {
            read.add(ch.number);
          }
        }
      }
      setReadChapters(read);
    } catch {
      /* ignore */
    }
  }, [bookSlug, chapters]);

  const toggleOrder = () => {
    const next = !reversed;
    setReversed(next);
    try {
      localStorage.setItem(`novel:toc-order:${bookSlug}`, next ? 'desc' : 'asc');
    } catch {
      /* ignore */
    }
  };

  const displayChapters = reversed ? [...chapters].reverse() : chapters;

  return (
    <section className="mt-10 sm:mt-12">
      <div className="mb-4 flex items-center justify-between">
        <h2 className="text-lg font-bold">章节列表</h2>
        <div className="flex items-center gap-3">
          {chapters.length > 0 && (
            <span className="text-xs text-neutral-400 dark:text-neutral-500">
              共{chapters.length}章
            </span>
          )}
          <button
            onClick={toggleOrder}
            className="flex items-center gap-1 rounded-lg border border-neutral-200 px-3 py-1.5 text-xs text-neutral-600 transition hover:bg-neutral-100 active:scale-95 dark:border-neutral-700 dark:text-neutral-300 dark:hover:bg-neutral-800"
            aria-label={reversed ? '切换为正序' : '切换为倒序'}
          >
            <span className={`transition-transform ${reversed ? 'rotate-180' : ''}`}>↕</span>
            {reversed ? '倒序' : '正序'}
          </button>
        </div>
      </div>

      {displayChapters.length === 0 ? (
        <p className="text-sm text-neutral-400">暂无已发布章节。</p>
      ) : (
        <ol className="grid grid-cols-1 gap-1 sm:grid-cols-2 md:grid-cols-3">
          {displayChapters.map((ch) => (
            <li key={ch.id} className="relative">
              <Link
                href={`/books/${bookSlug}/chapter/${ch.number}`}
                className={`block truncate rounded-md px-3 py-2 pr-7 text-sm transition active:scale-[0.98] dark:text-neutral-300 dark:hover:bg-neutral-800 dark:hover:text-sky-400 ${
                  readChapters.has(ch.number)
                    ? 'text-neutral-400 hover:bg-green-50 hover:text-green-600 dark:text-neutral-500 dark:hover:bg-green-950 dark:hover:text-green-400'
                    : 'text-neutral-700 hover:bg-neutral-100 hover:text-sky-600'
                }`}
              >
                {chapterLabel(ch.number, ch.title)}
              </Link>
              {readChapters.has(ch.number) && (
                <span className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 text-xs text-green-500 dark:text-green-400">
                  ✓
                </span>
              )}
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}
