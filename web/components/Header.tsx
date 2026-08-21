import Link from 'next/link';
import ThemeToggle from './ThemeToggle';

const navLink =
  'rounded-md px-3 py-1.5 text-sm text-neutral-600 transition hover:bg-neutral-100 hover:text-neutral-900 dark:text-neutral-400 dark:hover:bg-neutral-800 dark:hover:text-neutral-100';

export default function Header() {
  return (
    <header className="sticky top-0 z-20 border-b border-neutral-200 bg-white/90 backdrop-blur dark:border-neutral-800 dark:bg-neutral-950/90">
      <div className="mx-auto flex h-14 max-w-5xl items-center gap-3 px-4">
        <Link href="/" className="text-lg font-bold tracking-widest">
          AI文学
        </Link>
        <nav className="flex items-center gap-1">
          <Link href="/" className={navLink}>
            首页
          </Link>
          <Link href="/books" className={navLink}>
            全部小说
          </Link>
          <Link href="/categories" className={navLink}>
            分类
          </Link>
        </nav>
        <form action="/search" method="get" className="ml-auto flex items-center gap-2">
          <input
            name="q"
            placeholder="搜索书名/作者/标签"
            className="h-9 w-48 rounded-full border border-neutral-300 bg-transparent px-4 text-sm outline-none transition focus:border-sky-500 dark:border-neutral-700 md:w-60"
          />
          <button
            type="submit"
            className="h-9 rounded-full bg-sky-600 px-4 text-sm font-medium text-white transition hover:bg-sky-500"
          >
            搜索
          </button>
        </form>
        <ThemeToggle />
      </div>
    </header>
  );
}
