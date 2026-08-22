'use client';

import { useEffect } from 'react';

/**
 * 阅读位置管理:
 * - 如果有保存的滚动位置（同一章节再次访问），恢复到保存位置
 * - 如果没有保存位置（首次访问新章节），停留在顶部
 *
 * 同时在章节切换时自动清理旧章节的滚动位置数据。
 */
export default function ScrollRestore({
  bookSlug,
  chapterNumber,
}: {
  bookSlug: string;
  chapterNumber: number;
}) {
  useEffect(() => {
    try {
      const saved = localStorage.getItem(`novel:scroll:${bookSlug}:${chapterNumber}`);
      if (saved) {
        const percent = Number(saved);
        if (percent > 0 && percent < 100) {
          // 延迟一帧等待 DOM 渲染完成
          requestAnimationFrame(() => {
            const el = document.documentElement;
            const total = el.scrollHeight - el.clientHeight;
            if (total > 0) {
              const target = Math.round((percent / 100) * total);
              window.scrollTo({ top: target, behavior: 'instant' });
            }
          });
        }
      }
      // 如果没有保存位置，默认就是顶部（无需操作）
    } catch {
      /* ignore */
    }
  }, [bookSlug, chapterNumber]);

  return null;
}
