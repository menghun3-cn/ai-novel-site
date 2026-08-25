import Link from 'next/link';
import ThemeToggle from './ThemeToggle';
import ReaderMenu from './ReaderMenu';

const navLink =
  'rounded-md px-2 py-1.5 text-sm text-neutral-600 transition hover:bg-neutral-100 hover:text-neutral-900 dark:text-neutral-400 dark:hover:bg-neutral-800 dark:hover:text-neutral-100 md:px-3';

export default function Header() {
  return (
    <header className="sticky top-0 z-20 border-b border-neutral-200 bg-white/90 backdrop-blur dark:border-neutral-800 dark:bg-neutral-950/90">
      <div className="mx-auto flex h-14 max-w-5xl items-center gap-2 px-4 md:gap-3">
        <Link href="/" className="shrink-0">
          <span className="block text-lg font-bold leading-tight tracking-widest">云燕阅读</span>
          <span className="block text-[10px] leading-tight text-neutral-400 dark:text-neutral-500">
            AI小说创作平台
          </span>
        </Link>
        <nav className="flex min-w-0 items-center gap-1">
          {/* 移动端隐藏「首页」:logo 即首页入口,为窄屏腾出空间 */}
          <Link href="/" className={`${navLink} hidden md:inline-block`}>
            首页
          </Link>
          <Link href="/books" className={`${navLink} truncate`}>
            全部小说
          </Link>
          <Link href="/categories" className={`${navLink} truncate`}>
            分类
          </Link>
        </nav>

        {/* 移动端:搜索收成图标入口,完整搜索表单在 /search 页 */}
        <Link
          href="/search"
          aria-label="搜索"
          className="ml-auto flex h-9 w-9 shrink-0 items-center justify-center rounded-full border border-neutral-300 text-neutral-600 transition hover:bg-neutral-100 dark:border-neutral-700 dark:text-neutral-300 dark:hover:bg-neutral-800 md:hidden"
        >
          <svg
            xmlns="http://www.w3.org/2000/svg"
            width="18"
            height="18"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
          >
            <circle cx="11" cy="11" r="8" />
            <path d="m21 21-4.3-4.3" />
          </svg>
        </Link>

        {/* 桌面端:内联搜索表单 */}
        <form action="/search" method="get" className="ml-auto hidden items-center gap-2 md:flex">
          <input
            name="q"
            placeholder="搜索书名/作者/标签"
            className="h-9 w-48 rounded-full border border-neutral-300 bg-transparent px-4 text-sm outline-none transition focus:border-sky-500 dark:border-neutral-700 lg:w-60"
          />
          <button
            type="submit"
            className="h-9 shrink-0 rounded-full bg-sky-600 px-4 text-sm font-medium text-white transition hover:bg-sky-500"
          >
            搜索
          </button>
        </form>
        {/* 读者入口:登录/注册 或 书架/用户名/退出(客户端探测会话) */}
        <ReaderMenu />
        <ThemeToggle />
      </div>
    </header>
  );
}
