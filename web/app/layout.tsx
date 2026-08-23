import type { Viewport } from 'next';
import './globals.css';

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  themeColor: [
    { media: '(prefers-color-scheme: light)', color: '#ffffff' },
    { media: '(prefers-color-scheme: dark)', color: '#0a0a0a' },
  ],
};

// 首屏前应用主题,避免深色模式闪白
const themeInit = `(function(){try{var t=localStorage.getItem('novel:theme');var dark=t==='dark'||(!t&&window.matchMedia('(prefers-color-scheme: dark)').matches);if(dark)document.documentElement.classList.add('dark');}catch(e){}})();`;

/** 根布局只承载 html/body;阅读站与后台各自用路由组布局组织壳层 */
export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="zh-CN" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeInit }} />
      </head>
      <body className="flex min-h-screen flex-col bg-white text-neutral-900 antialiased dark:bg-neutral-950 dark:text-neutral-100">
        {children}
      </body>
    </html>
  );
}
