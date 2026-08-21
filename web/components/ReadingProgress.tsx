'use client';

import { useEffect, useState } from 'react';

/** 阅读进度条:跟随滚动百分比 */
export default function ReadingProgress() {
  const [percent, setPercent] = useState(0);

  useEffect(() => {
    const onScroll = () => {
      const el = document.documentElement;
      const total = el.scrollHeight - el.clientHeight;
      setPercent(total > 0 ? Math.round((el.scrollTop / total) * 100) : 0);
    };
    onScroll();
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, []);

  return (
    <div className="sticky top-14 z-10 h-1 w-full bg-transparent">
      <div className="h-full bg-sky-500 transition-[width] duration-150" style={{ width: `${percent}%` }} />
    </div>
  );
}
