'use client';

// 管理后台登录页:账号密码登录(V8.1),校验通过后进入 /admin
// 初始账号 admin/Admin@123456;首登(mustChangePassword=true)跳转强制改密页
// 独立骨架:居中卡片,不经 AdminShell

import { BookOpen, Eye, EyeOff, Info } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { type FormEvent, useState } from 'react';
import { api, setToken } from '@/lib/admin-client';
import { Button, Input, Notice, Spinner } from '@/components/admin/ui';

interface LoginResult {
  token: string;
  expiresAt: string;
  username: string;
  mustChangePassword: boolean;
}

export default function AdminLoginPage() {
  const router = useRouter();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [show, setShow] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function onSubmit(e: FormEvent): Promise<void> {
    e.preventDefault();
    if (!username.trim() || !password || loading) return;
    setLoading(true);
    setError(null);
    try {
      const result = await api<LoginResult>('/api/admin/auth/login', {
        method: 'POST',
        body: JSON.stringify({ username: username.trim(), password }),
      });
      setToken(result.token);
      router.replace(result.mustChangePassword ? '/admin/change-password' : '/admin');
    } catch (err) {
      setPassword('');
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
          <p className="mt-1 text-sm text-[#64748b]">输入管理员账号密码以继续</p>
        </div>

        {error ? <Notice tone="error">{error}</Notice> : null}

        <form onSubmit={(e) => void onSubmit(e)} noValidate>
          <label htmlFor="admin-username" className="mb-1.5 block text-sm font-medium text-[#334155]">
            账号
          </label>
          <Input
            id="admin-username"
            type="text"
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            placeholder="admin"
            autoComplete="username"
            autoFocus
          />

          <label htmlFor="admin-password" className="mb-1.5 mt-4 block text-sm font-medium text-[#334155]">
            密码
          </label>
          <div className="relative">
            <Input
              id="admin-password"
              type={show ? 'text' : 'password'}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="请输入密码"
              autoComplete="current-password"
              aria-invalid={Boolean(error)}
              aria-describedby={error ? 'login-error' : undefined}
              className="pr-10"
            />
            <button
              type="button"
              onClick={() => setShow((v) => !v)}
              aria-label={show ? '隐藏密码' : '显示密码'}
              className="absolute right-1 top-1 flex h-8 w-8 items-center justify-center rounded-md text-[#94a3b8] transition-colors duration-150 hover:bg-[#f1f5f9] hover:text-[#475569]"
            >
              {show ? <EyeOff size={16} /> : <Eye size={16} />}
            </button>
          </div>

          <Button variant="primary" size="lg" type="submit" disabled={!username.trim() || !password || loading} className="mt-5 w-full">
            {loading ? (
              <>
                <Spinner size={16} /> 校验中…
              </>
            ) : (
              '进入后台'
            )}
          </Button>
        </form>

        <p className="mt-5 flex items-start gap-1.5 rounded-lg bg-[#f0f7ff] px-3 py-2.5 text-xs leading-relaxed text-[#4b6b93]" role="note">
          <Info size={14} className="mt-0.5 shrink-0" aria-hidden />
          <span>首次部署的初始账号为 admin / Admin@123456,首次登录后必须修改为复杂密码(≥10 位,含大小写字母、数字和特殊字符)。</span>
        </p>
      </div>
    </div>
  );
}
