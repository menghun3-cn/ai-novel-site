import Link from 'next/link';
import ThemeToggle from './ThemeToggle';
import ReaderMenu from './ReaderMenu';

// UI/UX 修复:移动端导航不再被挤压成 "…"。
// - <md:导航独立成第二行(首页/全部小说/分类完整展示),行首 logo+操作区保持一行;
// - ≥md:导航回到第一行,与搜索表单共存;
// - 链接一律 shrink-0 + whitespace-nowrap(禁止收缩与省略),nav 容器 overflow-x-auto 兜底横向滚动。
const navLink =
  'shrink-0 whitespace-nowrap rounded-md px-2 py-1.5 text-sm text-neutral-600 transition hover:bg-neutral-100 hover:text-neutral-900 dark:text-neutral-400 dark:hover:bg-neutral-800 dark:hover:text-neutral-100 md:px-3';

export default function Header() {
  return (
    <header className="sticky top-0 z-20 border-b border-neutral-200 bg-white/90 backdrop-blur dark:border-neutral-800 dark:bg-neutral-950/90">
      <div className="mx-auto max-w-5xl px-4">
        {/* 第一行:品牌 + 搜索/读者/主题(所有断点) */}
        <div className="flex h-14 items-center gap-2 md:gap-3">
          <Link href="/" className="shrink-0">
            <span className="block text-lg font-bold leading-tight tracking-widest">云燕阅读</span>
            <span className="block text-[10px] leading-tight text-neutral-400 dark:text-neutral-500">
              AI小说创作平台
            </span>
          </Link>

          {/* 桌面端导航并入第一行;溢出时横向滚动而非省略号 */}
          <nav className="hidden min-w-0 items-center gap-1 overflow-x-auto md:flex">
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
          {/* 源码仓库:GitHub 图标,新标签页跳转开源地址 */}
          <a
            href="https://github.com/menghun3-cn/ai-novel-site"
            target="_blank"
            rel="noopener noreferrer"
            aria-label="源码仓库(GitHub)"
            title="源码仓库(GitHub)"
            className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full border border-neutral-300 text-neutral-600 transition hover:bg-neutral-100 hover:text-neutral-900 dark:border-neutral-700 dark:text-neutral-300 dark:hover:bg-neutral-800 dark:hover:text-neutral-100"
          >
            <svg
              xmlns="http://www.w3.org/2000/svg"
              width="18"
              height="18"
              viewBox="0 0 24 24"
              fill="currentColor"
              aria-hidden="true"
            >
              <path d="M12 .297c-6.63 0-12 5.373-12 12 0 5.303 3.438 9.8 8.205 11.385.6.113.82-.258.82-.577 0-.285-.01-1.04-.015-2.04-3.338.724-4.042-1.61-4.042-1.61C4.422 18.07 3.633 17.7 3.633 17.7c-1.087-.744.084-.729.084-.729 1.205.084 1.838 1.236 1.838 1.236 1.07 1.835 2.809 1.305 3.495.998.108-.776.417-1.305.76-1.605-2.665-.3-5.466-1.332-5.466-5.93 0-1.31.465-2.38 1.235-3.22-.135-.303-.54-1.523.105-3.176 0 0 1.005-.322 3.3 1.23.96-.267 1.98-.399 3-.405 1.02.006 2.04.138 3 .405 2.28-1.552 3.285-1.23 3.285-1.23.645 1.653.24 2.873.12 3.176.765.84 1.23 1.91 1.23 3.22 0 4.61-2.805 5.625-5.475 5.92.42.36.81 1.096.81 2.22 0 1.606-.015 2.896-.015 3.286 0 .315.21.69.825.57C20.565 22.092 24 17.592 24 12.297c0-6.627-5.373-12-12-12" />
            </svg>
          </a>
        </div>

        {/* 移动端导航独立成第二行:完整展示,不再被挤压省略 */}
        <nav className="flex items-center gap-1 overflow-x-auto pb-1.5 md:hidden">
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
      </div>
    </header>
  );
}
