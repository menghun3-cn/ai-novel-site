import Link from 'next/link';
import { ChevronRight } from 'lucide-react';

/** 首页板块标题:主色竖条 + 标题 + 语义副题 + 可选「更多」出口 */
export default function SectionHeader({
  title,
  hint,
  moreHref,
  moreText = '查看更多',
}: {
  title: string;
  /** 一句话说明该板块的浏览价值,辅助扫描 */
  hint?: string;
  moreHref?: string;
  moreText?: string;
}) {
  return (
    <div className="mb-4 flex items-end justify-between gap-4">
      <div className="flex items-center gap-2.5">
        <span aria-hidden="true" className="h-5 w-1 shrink-0 rounded-full bg-sky-600 dark:bg-sky-500" />
        <h2 className="text-lg font-bold leading-6">{title}</h2>
        {hint && <p className="hidden truncate text-xs text-neutral-400 sm:block dark:text-neutral-500">{hint}</p>}
      </div>
      {moreHref && (
        <Link
          href={moreHref}
          className="group flex shrink-0 items-center text-sm text-neutral-500 transition hover:text-sky-600 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-sky-500 dark:text-neutral-400 dark:hover:text-sky-400"
        >
          {moreText}
          <ChevronRight aria-hidden="true" size={16} className="transition group-hover:translate-x-0.5" />
        </Link>
      )}
    </div>
  );
}
