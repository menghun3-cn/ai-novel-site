import type { Metadata } from 'next';
import Header from '@/components/Header';
import Footer from '@/components/Footer';

export const metadata: Metadata = {
  title: {
    default: '云燕阅读 - AI小说创作平台',
    template: '%s | 云燕阅读',
  },
  description: '云燕阅读 · AI小说创作平台:科幻、玄幻、都市、历史、悬疑……',
  keywords: ['云燕阅读', 'AI小说', '科幻小说', '网络小说', '在线阅读'],
};

/** 公开阅读站壳层:页头 + 内容 + 页脚(管理后台 /admin 使用独立壳层,不经此布局) */
export default function SiteLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      <Header />
      <main className="flex-1">{children}</main>
      <Footer />
    </>
  );
}
