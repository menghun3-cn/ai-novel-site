'use client';

// 管理后台登录页:输入访问令牌(ADMIN_TOKEN),校验通过后进入 /admin
// 独立骨架:居中卡片,不经 AdminShell

import { BookOpen, Eye, EyeOff } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { type FormEvent, useState } from 'react';
import { api, setToken } from '@/lib/admin-client';
import { Button, Input, Notice, Spinner } from '@/components/admin/ui';

export default function AdminLoginPage() {
  const router = useRouter();
  const [token, setTokenValue] = useState('');
  const [show, setShow] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function onSubmit(e: FormEvent): Promise<void> {
    e.preventDefault();
    if (!token.trim() || loading) return;
    setLoading(true);
    setError(null);
    try {
      setToken(token.trim());
      await api('/api/admin/categories');
      router.replace('/admin');
    } catch (err) {
      setError(err instanceof Error ? err.message : '登录失败,请重试');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-[#eef4fb] p-4" style={{ fontFamily: "'PingFang SC','Hiragino Sans GB','Microsoft YaHei',ui-sans-serif,system-ui,sans-serif" }}>
      <div className="w-full max-w-[400px] rounded-2xl bg-white p-8 shadow-sm">
        <div className="mb-6 flex flex-col items-center text-center">
          <span className="flex h-12 w-12 items-center justify-center rounded-xl text-white" style={{ background: 'linear-gradient(135deg,#2d7fff,#1f5eea)' }}>
            <BookOpen size={24} aria-hidden />
          </span>
          <h1 className="mt-4 text-xl font-semibold text-[#0f172a]">内容管理后台</h1>
          <p className="mt-1 text-sm text-[#64748b]">输入服务端 ADMIN_TOKEN 访问令牌以继续</p>
        </div>

        {error ? <Notice tone="error">{error}</Notice> : null}

        <form onSubmit={(e) => void onSubmit(e)} noValidate>
          <label htmlFor="admin-token" className="mb-1.5 block text-sm font-medium text-[#334155]">
            访问令牌
          </label>
          <div className="relative">
            <Input
              id="admin-token"
              type={show ? 'text' : 'password'}
              value={token}
              onChange={(e) => setTokenValue(e.target.value)}
              placeholder="ADMIN_TOKEN"
              autoComplete="current-password"
              autoFocus
              aria-invalid={Boolean(error)}
              aria-describedby={error ? 'login-error' : undefined}
              className="pr-10"
            />
            <button
              type="button"
              onClick={() => setShow((v) => !v)}
              aria-label={show ? '隐藏令牌' : '显示令牌'}
              className="absolute right-1 top-1 flex h-8 w-8 items-center justify-center rounded-md text-[#94a3b8] transition-colors duration-150 hover:bg-[#f1f5f9] hover:text-[#475569]"
            >
              {show ? <EyeOff size={16} /> : <Eye size={16} />}
            </button>
          </div>
          <Button variant="primary" size="lg" type="submit" disabled={!token.trim() || loading} className="mt-5 w-full">
            {loading ? (
              <>
                <Spinner size={16} /> 校验中…
              </>
            ) : (
              '进入后台'
            )}
          </Button>
        </form>

        <p className="mt-6 text-center text-xs leading-relaxed text-[#94a3b8]">令牌由服务端环境变量 ADMIN_TOKEN 配置;仅限运营者使用。</p>
      </div>
    </div>
  );
}
