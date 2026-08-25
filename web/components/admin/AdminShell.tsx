'use client';

// 管理后台应用壳层:LSG 深蓝顶栏 + 可折叠侧栏 + 内容区
// 规格: 侧栏 200/64px · 顶栏/Logo区 56px · 菜单项40px · 内容区 p16 bg #eef4fb
// 响应式: <768px 抽屉化 | 768-1024 默认收起 | ≥1024 默认展开

import { BarChart3, BookOpen, FileCheck, FolderTree, ImageIcon, KeyRound, LayoutDashboard, LogOut, Menu, PanelLeftClose, PanelLeftOpen, Settings, Sparkles, Tags, Users, X } from 'lucide-react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { api, ApiError, clearToken, getToken } from '@/lib/admin-client';
import appPackage from '../../package.json';

const APP_VERSION = `v${appPackage.version}`;

const NAV = [
  { href: '/admin', label: '概览', icon: LayoutDashboard },
  { href: '/admin/books', label: '小说管理', icon: BookOpen },
  { href: '/admin/review', label: '审核队列', icon: FileCheck },
  { href: '/admin/story', label: 'AI 创作中心', icon: Sparkles },
  { href: '/admin/analytics', label: '数据分析', icon: BarChart3 },
  { href: '/admin/authors', label: '作者管理', icon: Users },
  { href: '/admin/categories', label: '分类管理', icon: FolderTree },
  { href: '/admin/tags', label: '标签管理', icon: Tags },
  { href: '/admin/media', label: '媒体库', icon: ImageIcon },
  { href: '/admin/settings', label: '系统设置', icon: Settings },
] as const;

const PAGE_TITLE: Record<string, string> = {
  '/admin': '概览',
  '/admin/books': '小说管理',
  '/admin/review': '审核队列',
  '/admin/story': 'AI 创作中心',
  '/admin/analytics': '数据分析',
  '/admin/authors': '作者管理',
  '/admin/categories': '分类管理',
  '/admin/tags': '标签管理',
  '/admin/media': '媒体库',
  '/admin/settings': '系统设置',
};

function breadcrumb(pathname: string): string {
  if (PAGE_TITLE[pathname]) return PAGE_TITLE[pathname];
  const seg = pathname.split('/').filter(Boolean);
  if (seg[1] === 'books' && seg.length > 2) return `小说管理 / 编辑`;
  return '内容管理后台';
}

export default function AdminShell({ children }: { children: ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const [collapsed, setCollapsed] = useState(false);
  const [drawer, setDrawer] = useState(false);
  const [reviewCount, setReviewCount] = useState(0);

  // 待审核角标:拉取队列长度;审核动作后由页面派发 admin:review-changed 全局刷新
  const refreshReviewCount = useCallback(async (): Promise<void> => {
    try {
      const res = await api<{ items: unknown[] }>('/api/admin/review-queue?limit=500');
      setReviewCount(res.items.length);
    } catch {
      /* 静默:角标是辅助信息 */
    }
  }, []);

  useEffect(() => {
    void refreshReviewCount();
    const onRefresh = (): void => {
      void refreshReviewCount();
    };
    window.addEventListener('admin:review-changed', onRefresh);
    return () => window.removeEventListener('admin:review-changed', onRefresh);
  }, [refreshReviewCount, pathname]);

  // 登录态守卫:无令牌或校验失败 → 登录页;首登待改密 → 强制改密页
  useEffect(() => {
    if (!getToken()) {
      router.replace('/admin/login');
      return;
    }
    api('/api/admin/categories').catch((err) => {
      router.replace(err instanceof ApiError && err.code === 'PASSWORD_CHANGE_REQUIRED' ? '/admin/change-password' : '/admin/login');
    });
  }, [router]);

  // 视口默认折叠状态(768-1023px 收起)
  useEffect(() => {
    if (window.innerWidth >= 768 && window.innerWidth < 1024) setCollapsed(true);
    const saved = window.localStorage.getItem('novel:admin-collapsed');
    if (saved !== null && window.innerWidth >= 1024) setCollapsed(saved === '1');
  }, []);

  function toggleCollapsed(): void {
    setCollapsed((v) => {
      window.localStorage.setItem('novel:admin-collapsed', v ? '0' : '1');
      return !v;
    });
  }

  async function logout(): Promise<void> {
    try {
      await api('/api/admin/auth/logout', { method: 'POST' });
    } catch {
      /* 服务端吊销失败也不阻断本地登出 */
    }
    clearToken();
    router.replace('/admin/login');
  }

  const isActive = (href: string): boolean => (href === '/admin' ? pathname === '/admin' : pathname.startsWith(href));

  return (
    <div className="flex h-screen overflow-hidden bg-[#eef4fb]" style={{ fontFamily: "'PingFang SC','Hiragino Sans GB','Microsoft YaHei',ui-sans-serif,system-ui,sans-serif" }}>
      {/* 移动端抽屉遮罩 */}
      {drawer ? (
        <div className="fixed inset-0 z-40 bg-black/50 md:hidden" onClick={() => setDrawer(false)} aria-hidden />
      ) : null}

      {/* 侧栏 */}
      <aside
        className={`fixed inset-y-0 left-0 z-50 flex flex-col border-r border-[#dbe8f6] bg-white transition-[width,transform] duration-250 ease-in-out md:relative md:translate-x-0 ${
          drawer ? 'translate-x-0' : '-translate-x-full'
        } ${collapsed ? 'md:w-16' : 'md:w-50'} w-50`}
        style={{ transitionDuration: '250ms' }}
      >
        <div className={`flex h-14 shrink-0 items-center gap-2.5 border-b border-[#f1f5f9] px-3 ${collapsed ? 'md:justify-center' : ''}`}>
          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg text-white" style={{ background: 'linear-gradient(135deg,#2d7fff,#1f5eea)' }}>
            <BookOpen size={20} aria-hidden />
          </span>
          <span className={`min-w-0 ${collapsed ? 'md:hidden' : ''}`}>
            <span className="block truncate text-[15px] font-semibold leading-tight text-[#1e293b]">AI文学·内容中台</span>
            <span className="block text-[10px] leading-tight text-[#94a3b8]">{APP_VERSION}</span>
          </span>
          <button aria-label="关闭菜单" className="ml-auto flex h-8 w-8 items-center justify-center rounded-lg text-[#94a3b8] hover:bg-[#f1f5f9] md:hidden" onClick={() => setDrawer(false)}>
            <X size={18} />
          </button>
        </div>

        <nav className="flex-1 overflow-y-auto px-2 py-3" aria-label="后台导航">
          {NAV.map((item) => {
            const Icon = item.icon;
            const active = isActive(item.href);
            return (
              <Link
                key={item.href}
                href={item.href}
                onClick={() => setDrawer(false)}
                title={collapsed ? item.label : undefined}
                aria-current={active ? 'page' : undefined}
                className={`relative mb-1 flex h-10 items-center rounded-lg px-3 transition-colors duration-150 ${
                  active ? 'bg-[#e8f3ff]' : 'hover:bg-[#f8fafc]'
                } ${collapsed ? 'md:justify-center md:px-0' : ''}`}
              >
                {active ? <span className="absolute inset-y-1.5 left-0 w-[3px] rounded-full bg-[#1677ff]" aria-hidden /> : null}
                <Icon size={18} className={active ? 'text-[#1677ff]' : 'text-[#64748b]'} aria-hidden />
                <span className={`ml-3 text-sm font-normal ${active ? 'font-medium text-[#1677ff]' : 'text-[#475569]'} ${collapsed ? 'md:hidden' : ''}`}>
                  {item.label}
                </span>
                {item.href === '/admin/review' && reviewCount > 0 ? (
                  <span
                    className={`ml-auto flex h-5 min-w-5 items-center justify-center rounded-full bg-[#dc2626] px-1.5 text-[11px] font-medium leading-none text-white ${collapsed ? 'md:hidden' : ''}`}
                    aria-label={`${reviewCount} 章待审核`}
                  >
                    {reviewCount > 99 ? '99+' : reviewCount}
                  </span>
                ) : null}
              </Link>
            );
          })}
        </nav>

        <button
          onClick={toggleCollapsed}
          aria-label={collapsed ? '展开侧栏' : '收起侧栏'}
          aria-expanded={!collapsed}
          className="mx-auto mb-3 hidden h-8 w-8 items-center justify-center rounded-lg text-[#94a3b8] transition-colors duration-150 hover:bg-[#f1f5f9] hover:text-[#334155] md:flex"
        >
          {collapsed ? <PanelLeftOpen size={16} className="rotate-180 transition-transform duration-250" aria-hidden /> : <PanelLeftClose size={16} style={{ transitionDuration: '250ms' }} aria-hidden />}
        </button>
      </aside>

      {/* 主区 */}
      <div className="flex min-w-0 flex-1 flex-col">
        <header
          className="sticky top-0 z-30 flex h-14 shrink-0 items-center gap-2 px-4 shadow-sm"
          style={{ background: 'linear-gradient(90deg,#073b7a,#1677ff)', boxShadow: '0 1px 2px rgba(0,0,0,0.05)' }}
        >
          <button aria-label="打开菜单" className="-ml-1 flex h-8 w-8 items-center justify-center rounded-lg text-white/80 hover:bg-white/10 md:hidden" onClick={() => setDrawer(true)}>
            <Menu size={18} />
          </button>
          <nav aria-label="面包屑" className="flex items-center gap-2 text-sm">
            <span className="text-white/75">内容管理后台</span>
            <span className="text-white/50" aria-hidden>
              /
            </span>
            <span className="font-medium text-white">{breadcrumb(pathname)}</span>
          </nav>
          <div className="ml-auto flex items-center gap-2">
            <Link
              href="/admin/change-password"
              title="修改密码"
              aria-label="修改密码"
              className="flex h-8 w-8 items-center justify-center rounded-full text-white/90 transition-colors duration-150 hover:bg-white/20"
            >
              <KeyRound size={15} aria-hidden />
            </Link>
            <button
              onClick={() => {
                void logout();
              }}
              className="flex items-center gap-2 rounded-full px-3 py-1.5 text-sm font-medium text-white transition-colors duration-150 hover:bg-white/20"
              style={{ background: 'rgba(255,255,255,0.14)' }}
            >
              <span className="flex h-7 w-7 items-center justify-center rounded-full text-xs text-white" style={{ background: 'linear-gradient(135deg,#2d7fff,#1f5eea)' }} aria-hidden>
                管
              </span>
              运营者
              <LogOut size={14} className="opacity-80" aria-hidden />
            </button>
          </div>
        </header>

        <main className="flex-1 overflow-y-auto p-4">{children}</main>
      </div>
    </div>
  );
}
