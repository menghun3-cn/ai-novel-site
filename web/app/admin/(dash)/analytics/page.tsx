'use client';

// V8 数据分析:运营总览 + 单书漏斗 + 流失标记
// 指标卡:总 PV/完读/收藏/订阅/读者/活跃 / 章节漏斗表(彩色留存条 + 流失警告)

import { BarChart3, BookOpen, Eye, Heart, TrendingDown, Users, Clock, Layers, Star, BellRing } from 'lucide-react';
import Link from 'next/link';
import { useEffect, useState, useCallback } from 'react';
import { api } from '@/lib/admin-client';
import { Notice, Spinner } from '@/components/admin/ui';

interface Overview {
  totalPv: number;
  totalBookPv: number;
  totalFinish: number;
  totalFavorites: number;
  totalSubscriptions: number;
  totalReaders: number;
  totalBooks: number;
  totalPublishedChapters: number;
  totalDurationMin: number;
  overallFinishRate: number;
  activeReaders7d: number;
  activeSessions7d: number;
}

interface ChapterMetric {
  chapterNumber: number;
  title: string;
  viewCount: number;
  finishCount: number;
  finishRate: number;
  retention: number;
  avgDurationSec: number;
  flagged: boolean;
  flagReason?: 'drop-off' | 'low-finish';
}

interface BookFunnel extends Overview {
  bookId: string;
  bookTitle: string;
  baselinePv: number;
  favorites: number;
  subscriptions: number;
  chapters: ChapterMetric[];
}

interface BookRow {
  id: string;
  title: string;
  slug: string;
}

const GRADIENTS = {
  blue: 'linear-gradient(135deg,#2d7fff 0%,#1f5eea 100%)',
  green: 'linear-gradient(135deg,#34d399 0%,#059669 100%)',
  purple: 'linear-gradient(135deg,#8b5cf6 0%,#6d28d9 100%)',
  orange: 'linear-gradient(135deg,#ffb020 0%,#f08a00 100%)',
  red: 'linear-gradient(135deg,#f87171 0%,#dc2626 100%)',
  teal: 'linear-gradient(135deg,#2dd4bf 0%,#0d9488 100%)',
} as const;

function formatSec(sec: number): string {
  if (sec < 60) return `${sec}s`;
  const min = Math.floor(sec / 60);
  const s = sec % 60;
  return `${min}m${s > 0 ? `${s}s` : ''}`;
}

function formatPv(n: number): string {
  if (n >= 10000) return `${(n / 10000).toFixed(1)}万`;
  if (n >= 1000) return `${(n / 1000).toFixed(1)}k`;
  return String(n);
}

export default function AnalyticsPage() {
  const [overview, setOverview] = useState<Overview | null>(null);
  const [books, setBooks] = useState<BookRow[]>([]);
  const [selectedBookId, setSelectedBookId] = useState<string | null>(null);
  const [funnel, setFunnel] = useState<BookFunnel | null>(null);
  const [loading, setLoading] = useState(true);
  const [funnelLoading, setFunnelLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const [ov, bk] = await Promise.all([
          api<Overview>('/api/admin/analytics/overview'),
          api<{ books: BookRow[] }>('/api/admin/books?limit=200'),
        ]);
        if (!alive) return;
        setOverview(ov);
        setBooks(bk.books);
      } catch (err) {
        if (alive) setError(err instanceof Error ? err.message : '加载失败');
      } finally {
        if (alive) setLoading(false);
      }
    })();
    return () => { alive = false; };
  }, []);

  const loadFunnel = useCallback(async (bookId: string) => {
    setFunnelLoading(true);
    setSelectedBookId(bookId);
    try {
      const f = await api<BookFunnel>(`/api/admin/analytics/books/${bookId}`);
      setFunnel(f);
    } catch (err) {
      setFunnel(null);
    } finally {
      setFunnelLoading(false);
    }
  }, []);

  if (loading) {
    return (
      <div className="flex min-h-[300px] items-center justify-center gap-2 text-sm text-[#64748b]">
        <Spinner size={18} /> 加载数据分析…
      </div>
    );
  }

  if (error || !overview) {
    return <Notice tone="error">{error ?? '无法加载数据'}</Notice>;
  }

  const ovCards = [
    { label: '总 PV(章)', value: formatPv(overview.totalPv), icon: Eye, bg: GRADIENTS.blue, sub: `书级 ${formatPv(overview.totalBookPv)}` },
    { label: '完读次数', value: formatPv(overview.totalFinish), icon: TrendingDown, bg: GRADIENTS.green, sub: `完读率 ${(overview.overallFinishRate * 100).toFixed(1)}%` },
    { label: '总收藏', value: formatPv(overview.totalFavorites), icon: Star, bg: GRADIENTS.purple, sub: `订阅 ${formatPv(overview.totalSubscriptions)}` },
    { label: '注册读者', value: formatPv(overview.totalReaders), icon: Users, bg: GRADIENTS.orange, sub: `7日活跃 ${overview.activeReaders7d}人` },
    { label: '阅读时长', value: `${Math.round(overview.totalDurationMin / 60)}h`, icon: Clock, bg: GRADIENTS.teal, sub: `${overview.totalDurationMin} 分钟` },
    { label: '作品 / 章节', value: `${overview.totalBooks} / ${overview.totalPublishedChapters}`, icon: Layers, bg: GRADIENTS.red, sub: `7日 ${overview.activeSessions7d} 次会话` },
  ];

  return (
    <div>
      {/* 页面标题 */}
      <div className="mb-5 rounded-xl bg-white p-5 shadow-sm">
        <div className="flex items-center gap-4">
          <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl text-white" style={{ background: GRADIENTS.blue }}>
            <BarChart3 size={24} aria-hidden />
          </span>
          <div>
            <h1 className="text-xl font-semibold text-[#0f172a]">数据分析</h1>
            <p className="mt-1 text-sm text-[#64748b]">阅读漏斗 · 章节流失 · 完读率 · 阅读时长</p>
          </div>
        </div>
      </div>

      {/* 总览指标卡 */}
      <div className="mb-6 grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3">
        {ovCards.map((c) => {
          const Icon = c.icon;
          return (
            <div
              key={c.label}
              className="group relative overflow-hidden rounded-xl p-5 text-white transition-all duration-200 hover:-translate-y-0.5"
              style={{ background: c.bg, boxShadow: '0 10px 24px rgba(2,32,71,0.22)' }}
            >
              <div className="flex items-start justify-between">
                <span className="select-none text-2xl font-bold leading-none transition-transform duration-200 group-hover:scale-105">
                  {c.value}
                </span>
                <Icon size={24} className="opacity-90 transition-transform duration-200 group-hover:-translate-y-1 group-hover:scale-125" aria-hidden />
              </div>
              <div className="mt-2 text-[13px] text-white/85">{c.label}</div>
              <div className="mt-0.5 text-[11px] text-white/60">{c.sub}</div>
            </div>
          );
        })}
      </div>

      {/* 单书漏斗选择器 */}
      <div className="mb-4 rounded-xl bg-white p-4 shadow-sm">
        <label className="mb-2 block text-sm font-semibold text-[#334155]">
          <BookOpen size={16} className="mr-1.5 inline-block text-[#1677ff]" aria-hidden />
          单书漏斗分析
        </label>
        <div className="flex flex-wrap gap-2">
          <button
            onClick={() => { setFunnel(null); setSelectedBookId(null); }}
            className={`rounded-lg px-3 py-1.5 text-sm transition-colors duration-150 ${!selectedBookId ? 'bg-[#1677ff] text-white' : 'bg-[#f1f5f9] text-[#475569] hover:bg-[#e2e8f0]'}`}
          >
            总览
          </button>
          {books.slice(0, 20).map((b) => (
            <button
              key={b.id}
              onClick={() => loadFunnel(b.id)}
              className={`rounded-lg px-3 py-1.5 text-sm transition-colors duration-150 ${selectedBookId === b.id ? 'bg-[#1677ff] text-white' : 'bg-[#f1f5f9] text-[#475569] hover:bg-[#e2e8f0]'}`}
            >
              {b.title}
            </button>
          ))}
          {books.length > 20 ? (
            <span className="self-center text-xs text-[#94a3b8]">共 {books.length} 本,显示前 20 本</span>
          ) : null}
        </div>
      </div>

      {/* 漏斗内容 */}
      {funnelLoading ? (
        <div className="flex min-h-[200px] items-center justify-center gap-2 text-sm text-[#64748b]">
          <Spinner size={18} /> 加载漏斗数据…
        </div>
      ) : funnel ? (
        <BookFunnelView funnel={funnel} />
      ) : (
        <div className="rounded-xl border border-[#dbe8f6] bg-white p-8 text-center text-sm text-[#94a3b8]">
          <BarChart3 size={40} className="mx-auto mb-3 text-[#cbd5e1]" aria-hidden />
          选择一本小说查看章节漏斗与流失分析
        </div>
      )}
    </div>
  );
}

function BookFunnelView({ funnel }: { funnel: BookFunnel }) {
  const maxRetention = Math.max(...funnel.chapters.map((c) => c.retention), 1);

  return (
    <div className="rounded-xl bg-white shadow-sm">
      {/* 书级摘要 */}
      <div className="border-b border-[#f1f5f9] p-4">
        <div className="flex flex-wrap items-center gap-4">
          <Link href={`/admin/books/${funnel.bookId}`} className="text-lg font-semibold text-[#1677ff] hover:underline">
            {funnel.bookTitle}
          </Link>
          <span className="inline-flex items-center gap-1 rounded-full bg-[#f1f5f9] px-2.5 py-1 text-xs text-[#64748b]">
            <Eye size={12} /> {formatPv(funnel.totalPv)} PV
          </span>
          <span className="inline-flex items-center gap-1 rounded-full bg-[#f1f5f9] px-2.5 py-1 text-xs text-[#64748b]">
            <TrendingDown size={12} /> 完读率 {funnel.overallFinishRate}%
          </span>
          <span className="inline-flex items-center gap-1 rounded-full bg-[#f1f5f9] px-2.5 py-1 text-xs text-[#64748b]">
            <Star size={12} /> 收藏 {funnel.favorites}
          </span>
          <span className="inline-flex items-center gap-1 rounded-full bg-[#f1f5f9] px-2.5 py-1 text-xs text-[#64748b]">
            <BellRing size={12} /> 订阅 {funnel.subscriptions}
          </span>
          <span className="inline-flex items-center gap-1 rounded-full bg-[#fef2f2] px-2.5 py-1 text-xs font-medium text-[#dc2626]">
            第一章基线 {formatPv(funnel.baselinePv)} PV
          </span>
        </div>
      </div>

      {/* 章节表格 */}
      {funnel.chapters.length === 0 ? (
        <div className="p-8 text-center text-sm text-[#94a3b8]">暂无已发布章节</div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-[#f1f5f9] bg-[#f8fafc]">
                <th className="px-4 py-2.5 text-left font-medium text-[#64748b]">#</th>
                <th className="px-4 py-2.5 text-left font-medium text-[#64748b]">章节</th>
                <th className="px-4 py-2.5 text-right font-medium text-[#64748b]">PV</th>
                <th className="px-4 py-2.5 text-right font-medium text-[#64748b]">完读</th>
                <th className="px-4 py-2.5 text-right font-medium text-[#64748b]">完读率</th>
                <th className="px-4 py-2.5 text-right font-medium text-[#64748b]">留存率</th>
                <th className="px-4 py-2.5 text-right font-medium text-[#64748b]">均时长</th>
                <th className="px-4 py-2.5 text-center font-medium text-[#64748b]">状态</th>
              </tr>
            </thead>
            <tbody>
              {funnel.chapters.map((ch, i) => {
                const prevRet = i > 0 ? funnel.chapters[i - 1].retention : 100;
                const drop = prevRet - ch.retention;
                const barWidth = Math.max(2, Math.round((ch.retention / maxRetention) * 100));
                const barColor =
                  ch.flagged && ch.flagReason === 'drop-off' ? '#f87171' :
                  ch.flagged && ch.flagReason === 'low-finish' ? '#fbbf24' :
                  'linear-gradient(90deg,#2d7fff,#1f5eea)';

                return (
                  <tr key={ch.chapterNumber} className={`border-b border-[#f1f5f9] transition-colors ${ch.flagged ? 'bg-[#fffbeb]' : 'hover:bg-[#f8fafc]'}`}>
                    <td className="px-4 py-2.5 font-mono text-xs text-[#94a3b8]">{ch.chapterNumber}</td>
                    <td className="max-w-[160px] truncate px-4 py-2.5 font-medium text-[#1e293b]" title={ch.title}>
                      {ch.title}
                    </td>
                    <td className="px-4 py-2.5 text-right tabular-nums text-[#475569]">{ch.viewCount > 0 ? ch.viewCount.toLocaleString('zh-CN') : '-'}</td>
                    <td className="px-4 py-2.5 text-right tabular-nums text-[#475569]">{ch.finishCount > 0 ? ch.finishCount.toLocaleString('zh-CN') : '-'}</td>
                    <td className="px-4 py-2.5 text-right tabular-nums">
                      <span className={`font-medium ${ch.finishRate >= 60 ? 'text-[#059669]' : ch.finishRate < 30 ? 'text-[#dc2626]' : 'text-[#f08a00]'}`}>
                        {ch.finishRate}%
                      </span>
                    </td>
                    <td className="px-4 py-2.5 text-right">
                      <div className="flex items-center justify-end gap-2">
                        {i > 0 && drop > 0 ? (
                          <span className="text-[11px] font-medium text-[#dc2626]" title="较前章流失">-{Math.round(drop)}%</span>
                        ) : i > 0 ? (
                          <span className="text-[11px] text-[#94a3b8]">{drop < 0 ? `+${Math.round(-drop)}%` : '—'}</span>
                        ) : null}
                        <span className="tabular-nums font-medium text-[#1e293b]">{ch.retention}%</span>
                      </div>
                      {/* 留存进度条 */}
                      <div className="mt-0.5 h-1 w-full overflow-hidden rounded-full bg-[#e2e8f0]">
                        <div className="h-1 rounded-full transition-all duration-300" style={{ width: `${barWidth}%`, background: barColor }} />
                      </div>
                    </td>
                    <td className="px-4 py-2.5 text-right tabular-nums text-[#64748b]">
                      {ch.avgDurationSec > 0 ? formatSec(ch.avgDurationSec) : '—'}
                    </td>
                    <td className="px-4 py-2.5 text-center">
                      {ch.flagged ? (
                        <span
                          className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium ${
                            ch.flagReason === 'drop-off'
                              ? 'bg-[#fef2f2] text-[#dc2626]'
                              : 'bg-[#fffbeb] text-[#d97706]'
                          }`}
                          title={ch.flagReason === 'drop-off' ? '读者流失(留存率较前章骤降≥30%)' : '完读率过低(<30%)'}
                        >
                          <TrendingDown size={10} />
                          {ch.flagReason === 'drop-off' ? '流失' : '低完读'}
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-1 rounded-full bg-[#f0fdf4] px-2 py-0.5 text-[11px] font-medium text-[#16a34a]">
                          正常
                        </span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {/* 图例 */}
      <div className="flex flex-wrap gap-4 border-t border-[#f1f5f9] p-4 text-xs text-[#64748b]">
        <span className="flex items-center gap-1.5">
          <span className="block h-3 w-3 rounded-sm" style={{ background: 'linear-gradient(90deg,#2d7fff,#1f5eea)' }} /> 留存率正常
        </span>
        <span className="flex items-center gap-1.5">
          <span className="block h-3 w-3 rounded-sm bg-[#fbbf24]" /> 完读率 &lt;30%
        </span>
        <span className="flex items-center gap-1.5">
          <span className="block h-3 w-3 rounded-sm bg-[#f87171]" /> 流失(留存较前章骤降 ≥30%)
        </span>
      </div>
    </div>
  );
}
