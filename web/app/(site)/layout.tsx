import type { Metadata } from 'next';
import Header from '@/components/Header';
import Footer from '@/components/Footer';

export const metadata: Metadata = {
  title: {
    default: 'AI文学 - AI 生成小说阅读站',
    template: '%s | AI文学',
  },
  description: 'AI 生成小说的公开阅读平台:科幻、玄幻、都市、历史、悬疑……',
  keywords: ['AI小说', '科幻小说', '网络小说', '在线阅读'],
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
