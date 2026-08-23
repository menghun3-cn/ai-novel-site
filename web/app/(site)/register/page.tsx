'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState, type FormEvent } from 'react';

export default function ReaderRegisterPage() {
  const [form, setForm] = useState({ username: '', email: '', password: '' });
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const router = useRouter();

  async function submit(e: FormEvent): Promise<void> {
    e.preventDefault();
    if (submitting) return;
    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch('/api/auth/register', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(form),
      });
      if (!res.ok) {
        const d = (await res.json().catch(() => ({}))) as { error?: string; message?: string };
        setError(
          d.error === 'USERNAME_TAKEN'
            ? '用户名已被占用'
            : d.error === 'EMAIL_TAKEN'
              ? '该邮箱已注册过'
              : d.message ?? `注册失败(${res.status})`
        );
        return;
      }
      window.dispatchEvent(new Event('reader:changed'));
      router.push('/shelf');
      router.refresh();
    } catch {
      setError('网络异常,请稍后重试');
    } finally {
      setSubmitting(false);
    }
  }

  const inputCls =
    'mt-1.5 h-11 w-full rounded-lg border border-neutral-300 bg-transparent px-3 text-sm outline-none transition focus:border-sky-500 dark:border-neutral-700';
  const labelCls = 'block text-sm font-medium text-neutral-700 dark:text-neutral-300';

  return (
    <div className="mx-auto w-full max-w-sm px-4 py-12">
      <h1 className="text-2xl font-bold text-neutral-900 dark:text-neutral-100">注册</h1>
      <p className="mt-1 text-sm text-neutral-500 dark:text-neutral-400">创建账号,收藏小说、同步阅读进度</p>

      <form onSubmit={(e) => void submit(e)} className="mt-6 space-y-4" noValidate>
        <div>
          <label htmlFor="username" className={labelCls}>
            用户名
          </label>
          <input
            id="username"
            autoComplete="username"
            value={form.username}
            onChange={(e) => setForm({ ...form, username: e.target.value })}
            required
            minLength={2}
            maxLength={24}
            placeholder="2-24 位,支持中文"
            className={inputCls}
          />
        </div>
        <div>
          <label htmlFor="email" className={labelCls}>
            邮箱
          </label>
          <input
            id="email"
            type="email"
            autoComplete="email"
            value={form.email}
            onChange={(e) => setForm({ ...form, email: e.target.value })}
            required
            className={inputCls}
          />
        </div>
        <div>
          <label htmlFor="password" className={labelCls}>
            密码
          </label>
          <input
            id="password"
            type="password"
            autoComplete="new-password"
            value={form.password}
            onChange={(e) => setForm({ ...form, password: e.target.value })}
            required
            minLength={8}
            placeholder="至少 8 位"
            className={inputCls}
          />
        </div>

        {error ? (
          <p role="alert" className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700 dark:bg-red-950/40 dark:text-red-300">
            {error}
          </p>
        ) : null}

        <button
          type="submit"
          disabled={submitting || !form.username || !form.email || !form.password}
          className="h-11 w-full rounded-lg bg-sky-600 text-sm font-medium text-white transition hover:bg-sky-500 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {submitting ? '注册中…' : '创建账号'}
        </button>
      </form>

      <p className="mt-5 text-center text-sm text-neutral-500 dark:text-neutral-400">
        已有账号?{' '}
        <Link href="/login" className="font-medium text-sky-600 hover:underline dark:text-sky-400">
          直接登录
        </Link>
      </p>
    </div>
  );
}
