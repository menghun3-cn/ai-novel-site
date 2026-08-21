'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';

/** 详情页「继续阅读」:读取 localStorage 上次读到哪一章 */
export default function ContinueReading({
  bookSlug,
  latestNumber,
}: {
  bookSlug: string;
  latestNumber: number | null;
}) {
  const [last, setLast] = useState<number | null>(null);

  useEffect(() => {
    try {
      const v = localStorage.getItem(`novel:last:${bookSlug}`);
      if (v) setLast(Number(v));
    } catch {
      /* ignore */
    }
  }, [bookSlug]);

  if (last === null || latestNumber === null || last >= latestNumber) return null;

  return (
    <Link
      href={`/books/${bookSlug}/chapter/${last}`}
      className="rounded-full border border-sky-600 px-6 py-2.5 text-sm font-medium text-sky-600 transition hover:bg-sky-50 dark:text-sky-400 dark:hover:bg-neutral-800"
    >
      继续阅读 第{last}章
    </Link>
  );
}
