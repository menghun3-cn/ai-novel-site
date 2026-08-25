import Link from 'next/link';

export default function Footer() {
  return (
    <footer className="border-t border-neutral-200 py-6 dark:border-neutral-800">
      <div className="mx-auto flex max-w-5xl flex-wrap items-center justify-between gap-2 px-4 text-sm text-neutral-500 dark:text-neutral-400">
        <span>© {new Date().getFullYear()} 云雀小说 · AI小说创作平台</span>
        <div className="flex gap-4">
          <Link href="/books" className="hover:underline">
            全部小说
          </Link>
          <Link href="/categories" className="hover:underline">
            分类
          </Link>
          <Link href="/rss.xml" className="hover:underline">
            RSS
          </Link>
        </div>
      </div>
    </footer>
  );
}
