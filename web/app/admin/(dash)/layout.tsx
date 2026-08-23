import type { Metadata } from 'next';
import AdminShell from '@/components/admin/AdminShell';

export const metadata: Metadata = {
  title: {
    default: '内容管理后台',
    template: '%s | 内容管理后台',
  },
};

/** 后台壳层:所有 /admin 子页(除登录页)共用侧栏 + 深蓝顶栏 */
export default function AdminDashLayout({ children }: { children: React.ReactNode }) {
  return <AdminShell>{children}</AdminShell>;
}
