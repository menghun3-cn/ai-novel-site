import Link from 'next/link';
import { cookies } from 'next/headers';
import { getSessionReader, getDiscoveryFeed, getReadingHistory, type DiscoverySection, type DiscoveryItem } from '@novel/core';
import DiscoveryCard from '@/components/DiscoveryCard';
import SectionHeader from '@/components/SectionHeader';
import HotRanking from '@/components/HotRanking';
import RecentUpdates from '@/components/RecentUpdates';
import { READER_COOKIE } from '@/lib/reader-auth';

export const dynamic = 'force-dynamic';

async function currentUserId(): Promise<string | null> {
  try {
    const token = (await cookies()).get(READER_COOKIE)?.value;
    if (!token) return null;
    return getSessionReader(token).id;
  } catch {
    return null;
  }
}

/** 封面卡网格(新书/完结/猜你喜欢):封面是选书主锚点,保持卡片形态 */
const CARD_GRID = {
  new: 'grid grid-cols-2 gap-4 sm:grid-cols-4',
  completed: 'grid grid-cols-2 gap-4 sm:grid-cols-4',
  foryou: 'grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-6',
} as const;

/** 继续阅读条目(登录读者) */
function ContinueReadingSection({ userId }: { userId: string }) {
  const items = getReadingHistory(userId, 6);
  if (items.length === 0) return null;
  return (
    <section>
      <SectionHeader title="继续阅读" moreHref="/me" moreText="阅读历史" />
      <ul className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        {items.map((h) => (
          <li key={h.bookId}>
            <Link
              href={`/books/${h.slug}/chapter/${h.chapterNumber}`}
              className="flex items-center justify-between rounded-xl border border-neutral-200 px-4 py-3 transition hover:border-sky-300 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-sky-500 dark:border-neutral-800 dark:hover:border-sky-700"
            >
              <span className="min-w-0 truncate font-medium">{h.title}</span>
              <span className="shrink-0 pl-3 text-xs tabular-nums text-neutral-500 dark:text-neutral-400">
                第{h.chapterNumber}章 · {h.percent}%
              </span>
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}

/** 今日推荐主视觉位 */
function TodayHero({ item }: { item: DiscoveryItem }) {
  return (
    <section className="overflow-hidden rounded-2xl border border-neutral-200 bg-gradient-to-br from-sky-50 to-white dark:border-neutral-800 dark:from-neutral-900 dark:to-neutral-950">
      <div className="flex flex-col gap-6 p-6 md:flex-row md:items-center">
        <Link
          href={`/books/${item.slug}`}
          className="block w-36 shrink-0 self-center focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-sky-500 sm:w-44 md:self-auto"
        >
          <div className="aspect-[3/4] overflow-hidden rounded-lg bg-neutral-200 dark:bg-neutral-800">
            {item.coverPath ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={`/${item.coverPath}`} alt={item.title} className="h-full w-full object-cover" />
            ) : (
              <div className="flex h-full items-center justify-center text-5xl font-bold text-neutral-400 dark:text-neutral-600">
                {item.title.slice(0, 1)}
              </div>
            )}
          </div>
        </Link>
        <div className="flex-1 text-center md:text-left">
          <p className="text-xs font-medium tracking-widest text-sky-600 dark:text-sky-400">今日推荐</p>
          <h1 className="mt-1 text-2xl font-bold">{item.title}</h1>
          <p className="mt-1 flex flex-wrap items-center justify-center gap-x-2 gap-y-1 text-sm text-neutral-500 md:justify-start dark:text-neutral-400">
            <span>{item.authorName}</span>
            <span
              className={`rounded-full px-2 py-0.5 text-xs ${
                item.status === 'serializing'
                  ? 'bg-sky-50 text-sky-700 dark:bg-sky-900/60 dark:text-sky-300'
                  : 'bg-neutral-100 text-neutral-500 dark:bg-neutral-800 dark:text-neutral-400'
              }`}
            >
              {item.status === 'serializing' ? '连载中' : '完结'}
            </span>
            <span>
              {item.categoryName} · {item.publishedCount} 章
            </span>
          </p>
          {item.description && (
            <p className="mx-auto mt-2 max-w-prose text-sm leading-6 text-neutral-600 line-clamp-3 md:mx-0 dark:text-neutral-300">
              {item.description}
            </p>
          )}
          <div className="mt-5 flex items-center justify-center gap-3 md:justify-start">
            <Link
              href={`/books/${item.slug}/chapter/1`}
              className="inline-block rounded-full bg-sky-600 px-6 py-2.5 text-sm font-medium text-white transition hover:bg-sky-500 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-sky-500"
            >
              开始阅读
            </Link>
            <Link
              href={`/books/${item.slug}`}
              className="inline-block rounded-full border border-neutral-300 px-5 py-2.5 text-sm text-neutral-600 transition hover:border-sky-400 hover:text-sky-600 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-sky-500 dark:border-neutral-700 dark:text-neutral-300 dark:hover:border-sky-500 dark:hover:text-sky-400"
            >
              查看详情
            </Link>
          </div>
        </div>
      </div>
    </section>
  );
}

export default async function HomePage() {
  const userId = await currentUserId();
  const { sections } = getDiscoveryFeed(userId ?? undefined);

  const hero = sections.find((s) => s.key === 'today')?.items[0];
  const byKey = Object.fromEntries(sections.map((s) => [s.key, s]));
  const rest = ['hot', 'recent', 'new', 'completed', 'foryou']
    .map((key) => byKey[key])
    .filter((s): s is DiscoverySection => !!s && s.items.length > 0 && (userId ? true : s.key !== 'foryou'));

  const history = userId ? getReadingHistory(userId, 6) : [];
  const hasContent = Boolean(hero) || rest.length > 0;

  const HINTS: Partial<Record<DiscoverySection['key'], string>> = {
    hot: '按阅读量与收藏热度排序',
    recent: '最新章节动态,方便追更',
    new: '近期上架的新作品',
    completed: '已完结,可以一口气读完',
    foryou: '根据你的书架和阅读口味推荐',
  };
  const MORE_HREF: Partial<Record<DiscoverySection['key'], string>> = {
    hot: '/books',
    recent: '/books',
    new: '/books',
    completed: '/books',
  };

  return (
    <div className="mx-auto max-w-5xl space-y-10 px-4 py-8">
      {hero && <TodayHero item={hero} />}
      {userId && history.length > 0 && <ContinueReadingSection userId={userId} />}

      {rest.map((s) => (
        <section key={s.key}>
          <SectionHeader title={s.title} hint={HINTS[s.key]} moreHref={MORE_HREF[s.key]} />
          {s.key === 'hot' && <HotRanking items={s.items} />}
          {s.key === 'recent' && <RecentUpdates items={s.items} />}
          {(s.key === 'new' || s.key === 'completed' || s.key === 'foryou') && (
            <div className={CARD_GRID[s.key]}>
              {s.items.map((item) => (
                <DiscoveryCard key={`${s.key}-${item.bookId}`} item={item} />
              ))}
            </div>
          )}
        </section>
      ))}

      {/* 兜底:完全无内容时引导去书库 */}
      {!hasContent && (
        <p className="py-16 text-center text-sm text-neutral-400">
          还没有可推荐的内容——先去{' '}
          <Link href="/books" className="text-sky-600 hover:underline dark:text-sky-400">
            小说库
          </Link>{' '}
          看看吧。
        </p>
      )}
    </div>
  );
}
