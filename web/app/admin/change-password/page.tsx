'use client';

// 首登强制改密页(V8.1):使用初始密码登录后必须设置复杂密码才能进入后台
// 复杂度规则与核心层一致:≥10 位,含大小写字母、数字、特殊字符,且不含用户名
// 独立骨架:居中卡片,不经 AdminShell

import { Check, Eye, EyeOff, KeyRound, X } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { type FormEvent, useEffect, useMemo, useState } from 'react';
import { api, getToken } from '@/lib/admin-client';
import { Button, Input, Notice, Spinner } from '@/components/admin/ui';

interface SessionInfo {
  username: string;
  mustChangePassword: boolean;
}

const RULES: { label: string; test: (v: string, username: string) => boolean }[] = [
  { label: '长度至少 10 位', test: (v) => v.length >= 10 },
  { label: '包含小写字母', test: (v) => /[a-z]/.test(v) },
  { label: '包含大写字母', test: (v) => /[A-Z]/.test(v) },
  { label: '包含数字', test: (v) => /\d/.test(v) },
  { label: '包含特殊字符(如 !@#$%)', test: (v) => /[^A-Za-z0-9]/.test(v) },
  { label: '不包含账号名', test: (v, u) => u === '' || !v.toLowerCase().includes(u.toLowerCase()) },
];

export default function AdminChangePasswordPage() {
  const router = useRouter();
  const [username, setUsername] = useState('');
  const [mustChange, setMustChange] = useState(true);
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [show, setShow] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  // 会话守卫:无令牌回登录页;已登录则展示账号与待改密状态
  useEffect(() => {
    if (!getToken()) {
      router.replace('/admin/login');
      return;
    }
    api<SessionInfo>('/api/admin/auth/session')
      .then((s) => {
        setUsername(s.username);
        setMustChange(s.mustChangePassword);
      })
      .catch(() => router.replace('/admin/login'));
  }, [router]);

  const ruleResults = useMemo(() => RULES.map((r) => ({ ...r, pass: r.test(newPassword, username) })), [newPassword, username]);
  const allRulesPass = ruleResults.every((r) => r.pass);

  async function onSubmit(e: FormEvent): Promise<void> {
    e.preventDefault();
    if (loading) return;
    if (!allRulesPass) {
      setError('新密码不满足复杂度要求');
      return;
    }
    if (newPassword !== confirmPassword) {
      setError('两次输入的新密码不一致');
      return;
    }
    setLoading(true);
    setError(null);
    try {
      await api('/api/admin/auth/change-password', {
        method: 'POST',
        body: JSON.stringify({ currentPassword, newPassword }),
      });
      router.replace('/admin');
    } catch (err) {
      setError(err instanceof Error ? err.message : '修改失败,请重试');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-[#eef4fb] p-4" style={{ fontFamily: "'PingFang SC','Hiragino Sans GB','Microsoft YaHei',ui-sans-serif,system-ui,sans-serif" }}>
      <div className="w-full max-w-[440px] rounded-2xl bg-white p-8 shadow-sm">
        <div className="mb-6 flex flex-col items-center text-center">
          <span className="flex h-12 w-12 items-center justify-center rounded-xl text-white" style={{ background: 'linear-gradient(135deg,#2d7fff,#1f5eea)' }}>
            <KeyRound size={24} aria-hidden />
          </span>
          <h1 className="mt-4 text-xl font-semibold text-[#0f172a]">{mustChange ? '首次登录,请修改初始密码' : '修改密码'}</h1>
          <p className="mt-1 text-sm text-[#64748b]">
            {username ? `账号:${username}` : ''}
            {mustChange ? ' · 修改完成前无法访问后台功能' : ''}
          </p>
        </div>

        {error ? <Notice tone="error">{error}</Notice> : null}

        <form onSubmit={(e) => void onSubmit(e)} noValidate>
          <label htmlFor="cur-password" className="mb-1.5 block text-sm font-medium text-[#334155]">
            当前密码
          </label>
          <Input
            id="cur-password"
            type={show ? 'text' : 'password'}
            value={currentPassword}
            onChange={(e) => setCurrentPassword(e.target.value)}
            autoComplete="current-password"
            required
          />

          <label htmlFor="new-password" className="mb-1.5 mt-4 block text-sm font-medium text-[#334155]">
            新密码
          </label>
          <div className="relative">
            <Input
              id="new-password"
              type={show ? 'text' : 'password'}
              value={newPassword}
              onChange={(e) => setNewPassword(e.target.value)}
              autoComplete="new-password"
              aria-describedby="pwd-rules"
              className="pr-10"
              required
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

          <ul id="pwd-rules" className="mt-2 grid grid-cols-1 gap-1 text-xs sm:grid-cols-2">
            {ruleResults.map((r) => (
              <li key={r.label} className={`flex items-center gap-1 ${r.pass ? 'text-[#16a34a]' : 'text-[#94a3b8]'}`}>
                {r.pass ? <Check size={13} aria-hidden /> : <X size={13} aria-hidden />}
                {r.label}
              </li>
            ))}
          </ul>

          <label htmlFor="confirm-password" className="mb-1.5 mt-4 block text-sm font-medium text-[#334155]">
            确认新密码
          </label>
          <Input
            id="confirm-password"
            type={show ? 'text' : 'password'}
            value={confirmPassword}
            onChange={(e) => setConfirmPassword(e.target.value)}
            autoComplete="new-password"
            aria-invalid={confirmPassword !== '' && confirmPassword !== newPassword}
            required
          />

          <Button
            variant="primary"
            size="lg"
            type="submit"
            disabled={!currentPassword || !newPassword || !confirmPassword || loading}
            className="mt-5 w-full"
          >
            {loading ? (
              <>
                <Spinner size={16} /> 提交中…
              </>
            ) : (
              '确认修改并进入后台'
            )}
          </Button>
        </form>
      </div>
    </div>
  );
}
