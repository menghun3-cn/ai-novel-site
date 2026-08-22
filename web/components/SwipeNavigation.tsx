'use client';

import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';

/**
 * 移动端左右滑动切换章节手势。
 * 需要在包裹 div 上加 className="touch-pan-y"。
 */
export default function SwipeNavigation({
  bookSlug,
  prevChapter,
  nextChapter,
}: {
  bookSlug: string;
  prevChapter: number | null;
  nextChapter: number | null;
}) {
  const router = useRouter();
  const startX = useRef(0);
  const startY = useRef(0);
  const [swiping, setSwiping] = useState(false);

  useEffect(() => {
    const SWIPE_THRESHOLD = 80;

    const onTouchStart = (e: TouchEvent) => {
      startX.current = e.touches[0].clientX;
      startY.current = e.touches[0].clientY;
      setSwiping(false);
    };

    const onTouchMove = (e: TouchEvent) => {
      const dx = e.touches[0].clientX - startX.current;
      const dy = e.touches[0].clientY - startY.current;
      // 只在水平滑动时标记
      if (Math.abs(dx) > Math.abs(dy) && Math.abs(dx) > 20) {
        setSwiping(true);
      }
    };

    const onTouchEnd = (e: TouchEvent) => {
      const dx = e.changedTouches[0].clientX - startX.current;
      const dy = e.changedTouches[0].clientY - startY.current;

      // 只处理水平滑动（水平位移 > 垂直位移）
      if (Math.abs(dx) > Math.abs(dy) && Math.abs(dx) > SWIPE_THRESHOLD) {
        if (dx < 0 && nextChapter) {
          // 左滑 → 下一章
          router.push(`/books/${bookSlug}/chapter/${nextChapter}`);
        } else if (dx > 0 && prevChapter) {
          // 右滑 → 上一章
          router.push(`/books/${bookSlug}/chapter/${prevChapter}`);
        }
      }
      setSwiping(false);
    };

    document.addEventListener('touchstart', onTouchStart, { passive: true });
    document.addEventListener('touchmove', onTouchMove, { passive: true });
    document.addEventListener('touchend', onTouchEnd, { passive: true });

    return () => {
      document.removeEventListener('touchstart', onTouchStart);
      document.removeEventListener('touchmove', onTouchMove);
      document.removeEventListener('touchend', onTouchEnd);
    };
  }, [bookSlug, prevChapter, nextChapter, router]);

  return null;
}
