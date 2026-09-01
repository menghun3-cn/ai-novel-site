'use client';

import { useRouter } from 'next/navigation';
import { useEffect } from 'react';

/**
 * 预取「下一章」:进入当前章节后,立即在后台拉取下一章的 RSC 载荷,
 * 让「翻下一页」几乎瞬时(尤其配合章节页 ISR,顺带把下一章预热进缓存)。
 * 没有下一章(null)时不预取。
 */
export default function PrefetchNextChapter({ href }: { href: string | null }) {
  const router = useRouter();

  useEffect(() => {
    if (href) {
      try {
        router.prefetch(href);
      } catch {
        /* 预取失败不影响阅读 */
      }
    }
  }, [router, href]);

  return null;
}
