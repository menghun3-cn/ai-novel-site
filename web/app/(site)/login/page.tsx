'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState, type FormEvent } from 'react';

export default function ReaderLoginPage() {
  const [login, setLogin] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const router = useRouter();

  async function submit(e: FormEvent): Promise<void> {
    e.preventDefault();
    if (submitting) return;
    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ login, password }),
      });
      if (!res.ok) {
        const d = (await res.json().catch(() => ({}))) as { error?: string; message?: string };
        setError(d.error === 'INVALID_CREDENTIALS' ? '用户名或密码不正确' : d.message ?? `登录失败(${res.status})`);
        return;
      }
      window.dispatchEvent(new Event('reader:changed'));
      router.push('/');
      router.refresh();
    } catch {
      setError('网络异常,请稍后重试');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="mx-auto w-full max-w-sm px-4 py-12">
      <h1 className="text-2xl font-bold text-neutral-900 dark:text-neutral-100">登录</h1>
      <p className="mt-1 text-sm text-neutral-500 dark:text-neutral-400">使用用户名或邮箱登录你的书架</p>

      <form onSubmit={(e) => void submit(e)} className="mt-6 space-y-4" noValidate>
        <div>
          <label htmlFor="login" className="block text-sm font-medium text-neutral-700 dark:text-neutral-300">
            用户名 / 邮箱
          </label>
          <input
            id="login"
            name="login"
            autoComplete="username"
            value={login}
            onChange={(e) => setLogin(e.target.value)}
            required
            className="mt-1.5 h-11 w-full rounded-lg border border-neutral-300 bg-transparent px-3 text-sm outline-none transition focus:border-sky-500 dark:border-neutral-700"
          />
        </div>
        <div>
          <label htmlFor="password" className="block text-sm font-medium text-neutral-700 dark:text-neutral-300">
            密码
          </label>
          <span className="relative mt-1.5 block">
            <input
              id="password"
              name="password"
              type={showPassword ? 'text' : 'password'}
              autoComplete="current-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              className="h-11 w-full rounded-lg border border-neutral-300 bg-transparent px-3 pr-16 text-sm outline-none transition focus:border-sky-500 dark:border-neutral-700"
            />
            <button
              type="button"
              onClick={() => setShowPassword((v) => !v)}
              className="absolute right-2 top-1/2 -translate-y-1/2 rounded px-2 py-1 text-xs text-neutral-500 transition hover:text-neutral-800 dark:hover:text-neutral-200"
            >
              {showPassword ? '隐藏' : '显示'}
            </button>
          </span>
        </div>

        {error ? (
          <p role="alert" className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700 dark:bg-red-950/40 dark:text-red-300">
            {error}
          </p>
        ) : null}

        <button
          type="submit"
          disabled={submitting || !login || !password}
          className="h-11 w-full rounded-lg bg-sky-600 text-sm font-medium text-white transition hover:bg-sky-500 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {submitting ? '登录中…' : '登录'}
        </button>
      </form>

      <p className="mt-5 text-center text-sm text-neutral-500 dark:text-neutral-400">
        还没有账号?{' '}
        <Link href="/register" className="font-medium text-sky-600 hover:underline dark:text-sky-400">
          立即注册
        </Link>
      </p>
    </div>
  );
}
