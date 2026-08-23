'use client';

// 概览仪表盘:LSG 渐变指标卡 + 快捷入口
// 指标:书籍总数 / 连载中 / 已发布章节 / 草稿章节 / 作者数 / 媒体数

import { BookOpen, ImageIcon, PenLine, Sparkles, Tags, Users } from 'lucide-react';
import Link from 'next/link';
import { useEffect, useState } from 'react';
import { api } from '@/lib/admin-client';
import { Notice, Spinner } from '@/components/admin/ui';

interface BookRow {
  id: string;
  status: string;
  chapterCount: number;
  publishedCount: number;
}
interface MediaRow {
  name: string;
}

const GRADIENTS = {
  blue: 'linear-gradient(135deg,#2d7fff 0%,#1f5eea 100%)',
  green: 'linear-gradient(135deg,#34d399 0%,#059669 100%)',
  purple: 'linear-gradient(135deg,#8b5cf6 0%,#6d28d9 100%)',
  orange: 'linear-gradient(135deg,#ffb020 0%,#f08a00 100%)',
} as const;

export default function AdminDashboardPage() {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [stats, setStats] = useState({ books: 0, serializing: 0, hidden: 0, chaptersPublished: 0, chaptersDraft: 0, authors: 0, tags: 0, media: 0 });

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const [booksRes, authorsRes, tagsRes, mediaRes] = await Promise.all([
          api<{ books: BookRow[] }>('/api/admin/books?limit=500'),
          api<{ authors: unknown[] }>('/api/admin/authors'),
          api<{ tags: unknown[] }>('/api/admin/tags'),
          api<{ media: MediaRow[] }>('/api/admin/media'),
        ]);
        if (!alive) return;
        const books = booksRes.books;
        setStats({
          books: books.length,
          serializing: books.filter((b) => b.status === 'serializing').length,
          hidden: books.filter((b) => b.status === 'hidden').length,
          chaptersPublished: books.reduce((s, b) => s + b.publishedCount, 0),
          chaptersDraft: books.reduce((s, b) => s + Math.max(0, b.chapterCount - b.publishedCount), 0),
          authors: authorsRes.authors.length,
          tags: tagsRes.tags.length,
          media: mediaRes.media.length,
        });
      } catch (err) {
        if (alive) setError(err instanceof Error ? err.message : '加载失败');
      } finally {
        if (alive) setLoading(false);
      }
    })();
    return () => {
      alive = false;
    };
  }, []);

  const cards = [
    { label: '小说总数', value: stats.books, icon: BookOpen, bg: GRADIENTS.blue },
    { label: '已发布章节', value: stats.chaptersPublished, icon: Sparkles, bg: GRADIENTS.green },
    { label: '待发章节(草稿+定时)', value: stats.chaptersDraft, icon: PenLine, bg: GRADIENTS.purple },
    { label: '媒体资源', value: stats.media, icon: ImageIcon, bg: GRADIENTS.orange },
  ];

  return (
    <div>
      {/* 页面头部统计概览 */}
      <div className="mb-5 rounded-xl bg-white p-5 shadow-sm transition-shadow duration-200 hover:shadow-md">
        <div className="flex items-center gap-4">
          <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl text-white" style={{ background: GRADIENTS.blue }}>
            <BookOpen size={24} aria-hidden />
          </span>
          <div>
            <h1 className="text-xl font-semibold text-[#0f172a]">内容概览</h1>
            <p className="mt-1 text-sm text-[#64748b]">
              连载中 <b className="font-semibold text-[#1677ff]">{stats.serializing}</b> · 已隐藏{' '}
              <b className="font-semibold text-[#1677ff]">{stats.hidden}</b> · 作者{' '}
              <b className="font-semibold text-[#1677ff]">{stats.authors}</b> · 标签{' '}
              <b className="font-semibold text-[#1677ff]">{stats.tags}</b>
            </p>
          </div>
        </div>
      </div>

      {error ? <Notice tone="error">{error}</Notice> : null}
      {loading ? (
        <div className="flex min-h-[200px] items-center justify-center gap-2 text-sm text-[#64748b]">
          <Spinner size={18} /> 加载中…
        </div>
      ) : (
        <>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
            {cards.map((c) => {
              const Icon = c.icon;
              return (
                <div
                  key={c.label}
                  className="group relative overflow-hidden rounded-xl p-5 text-white transition-all duration-200 hover:-translate-y-0.5"
                  style={{ background: c.bg, boxShadow: '0 10px 24px rgba(2,32,71,0.22)' }}
                >
                  <div className="flex items-start justify-between">
                    <span className="select-none text-2xl font-bold leading-none transition-transform duration-200 group-hover:-translate-x-1 group-hover:scale-105">
                      {c.value.toLocaleString('zh-CN')}
                    </span>
                    <Icon size={24} className="opacity-90 transition-transform duration-200 group-hover:-translate-y-1 group-hover:scale-125" aria-hidden />
                  </div>
                  <div className="mt-3 text-[13px] text-white/85 transition-transform duration-200 origin-left group-hover:translate-x-1.5 group-hover:scale-105">{c.label}</div>
                </div>
              );
            })}
          </div>

          <div className="mt-5 grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
            {[
              { href: '/admin/books', label: '管理小说与章节', desc: '新建、编辑、隐藏、删除' },
              { href: '/admin/authors', label: '维护作者档案', desc: '笔名、简介、头像、作品数' },
              { href: '/admin/tags', label: '整理分类标签', desc: '分类与标签重命名、清理' },
              { href: '/admin/media', label: '上传媒体资源', desc: '封面、头像、插图素材库' },
            ].map((q) => (
              <Link
                key={q.href}
                href={q.href}
                className="rounded-xl border border-[#dbe8f6] bg-white p-4 shadow-sm transition-all duration-300 hover:-translate-y-0.5 hover:shadow-md"
              >
                <div className="text-sm font-semibold text-[#334155]">{q.label}</div>
                <div className="mt-1 text-xs text-[#94a3b8]">{q.desc}</div>
              </Link>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
