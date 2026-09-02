'use client';

// 作品管理:短篇生成后的统一管理台(列表)
// 搜索/状态筛选、线上版本 vs 最新版本(落后高亮)、下架/重新发布、行内操作进详情

import { BookOpen, ExternalLink, EyeOff, RefreshCw, Search } from 'lucide-react';
import Link from 'next/link';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { api } from '@/lib/admin-client';
import { Badge, Button, EmptyState, Input, Select, Spinner } from '@/components/admin/ui';

interface WorkRow {
  id: string;
  title: string;
  status: string;
  versionCount: number;
  publicationId: string | null;
  publishedBookId: string | null;
  publishedAt: string | null;
  onlineVersionNumber: number | null;
  latestCharCount: number | null;
  onlineBookStatus: 'serializing' | 'completed' | 'hidden' | null;
  updatedAt: string;
}

const STATUS_BADGE: Record<string, { label: string; tone: 'success' | 'warning' | 'danger' | 'info' | 'running' }> = {
  draft: { label: '草稿', tone: 'info' },
  scheduled: { label: '已排期', tone: 'info' },
  creating: { label: '创作中', tone: 'running' },
  reviewing: { label: '评审中', tone: 'running' },
  optimizing: { label: '优化中', tone: 'running' },
  passed: { label: '已达标', tone: 'success' },
  pool: { label: '低质池', tone: 'warning' },
  failed: { label: '失败', tone: 'danger' },
};

const REASON_LABEL: Record<string, string> = {
  generated: 'AI 生成',
  ai_optimized: 'AI 优化',
  user_edited: '人工编辑',
};

function fmtTime(s: string | null): string {
  if (!s) return '—';
  return new Date(s).toLocaleString('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' });
}

export default function AdminWorksPage() {
  const [rows, setRows] = useState<WorkRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [q, setQ] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [busyId, setBusyId] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setError(null);
      const res = await api<{ stories: WorkRow[] }>('/api/admin/short-stories?limit=500');
      setRows(res.stories);
    } catch (err) {
      setError(err instanceof Error ? err.message : '加载失败');
      setRows([]);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const filtered = useMemo(() => {
    let list = rows ?? [];
    if (statusFilter) list = list.filter((s) => s.status === statusFilter);
    if (q.trim()) {
      const kw = q.trim().toLowerCase();
      list = list.filter((s) => s.title.toLowerCase().includes(kw) || s.id.toLowerCase().includes(kw));
    }
    return list;
  }, [rows, q, statusFilter]);

  const act = async (id: string, method: string, label: string) => {
    setBusyId(id);
    setNotice(null);
    try {
      await api(`/api/admin/short-stories/${id}/${method === 'POST' ? 'republish' : 'unpublish'}`, { method, body: '{}' });
      setNotice(label);
      await load();
    } catch (err) {
      setNotice(null);
      setError(err instanceof Error ? err.message : '操作失败');
    } finally {
      setBusyId(null);
    }
  };

  if (!rows) return <div className="py-16 text-center text-sm text-[#64748b]">加载中…</div>;

  return (
    <div className="space-y-4">
      {error ? <div className="rounded-lg border border-[#fecaca] bg-[#fef2f2] px-4 py-2.5 text-sm text-[#b91c1c]">{error}</div> : null}
      {notice ? <div className="rounded-lg border border-[#a7f3d0] bg-[#ecfdf5] px-4 py-2.5 text-sm text-[#047857]">{notice}</div> : null}

      <div className="flex flex-wrap items-center gap-2">
        <div className="relative">
          <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-[#94a3b8]" aria-hidden />
          <Input placeholder="搜索标题 / 编号…" value={q} onChange={(e) => setQ(e.target.value)} className="w-64 pl-9" />
        </div>
        <Select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)} className="w-36">
          <option value="">全部状态</option>
          {Object.entries(STATUS_BADGE).map(([k, v]) => (
            <option key={k} value={k}>
              {v.label}
            </option>
          ))}
        </Select>
        <span className="text-xs text-[#64748b]">共 {filtered.length} 篇</span>
        <Link href="/admin/creation" className="ml-auto text-sm text-[#1677ff] hover:underline">
          去创作中心生成 →
        </Link>
      </div>

      {filtered.length === 0 ? (
        <div className="overflow-hidden rounded-xl border border-[#e2e8f0] bg-white">
          <EmptyState
            icon={<BookOpen size={28} />}
            title="暂无作品"
            description="在创作中心发起短篇生成后,作品会出现在这里,可编辑、发布、下架。"
          />
        </div>
      ) : (
        <div className="overflow-hidden rounded-xl border border-[#e2e8f0] bg-white">
          <table className="w-full text-sm">
            <thead className="bg-[#f8fafc] text-xs text-[#64748b]">
              <tr>
                <th className="px-4 py-3 text-left font-medium">作品</th>
                <th className="px-3 py-3 text-left font-medium">状态</th>
                <th className="px-3 py-3 text-left font-medium">版本</th>
                <th className="px-3 py-3 text-left font-medium">字数</th>
                <th className="px-3 py-3 text-left font-medium">发布时间</th>
                <th className="px-4 py-3 text-right font-medium">操作</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[#f1f5f9]">
              {filtered.map((s) => {
                const published = !!s.publicationId;
                const offline = s.onlineBookStatus === 'hidden';
                const stale = published && !offline && s.onlineVersionNumber !== null && s.onlineVersionNumber < s.versionCount;
                const badge = STATUS_BADGE[s.status] ?? { label: s.status, tone: 'info' as const };
                const busy = busyId === s.id;
                return (
                  <tr key={s.id} className="transition-colors hover:bg-[#f8fafc]">
                    <td className="px-4 py-3">
                      <Link href={`/admin/works/${s.id}`} className="font-medium text-[#0f172a] hover:text-[#1677ff] hover:underline">
                        {s.title}
                      </Link>
                      <div className="mt-0.5 flex items-center gap-1.5 text-[11px] text-[#94a3b8]">
                        <span>{s.id}</span>
                        {stale ? <Badge tone="warning">线上落后</Badge> : null}
                        {offline ? <Badge tone="danger">已下架</Badge> : null}
                      </div>
                    </td>
                    <td className="px-3 py-3">
                      <Badge tone={badge.tone}>{badge.label}</Badge>
                    </td>
                    <td className="px-3 py-3 text-[#334155]">
                      {s.versionCount > 0 ? `v${s.versionCount}` : '—'}
                      {published && s.onlineVersionNumber !== null ? (
                        <span className="ml-1 text-[11px] text-[#94a3b8]">线上 v{s.onlineVersionNumber}</span>
                      ) : null}
                    </td>
                    <td className="px-3 py-3 text-[#334155]">{s.latestCharCount !== null ? `${s.latestCharCount.toLocaleString()} 字` : '—'}</td>
                    <td className="px-3 py-3 text-[#64748b]">{fmtTime(s.publishedAt)}</td>
                    <td className="px-4 py-3">
                      <div className="flex items-center justify-end gap-1.5">
                        <Link href={`/admin/works/${s.id}`}>
                          <Button size="sm" variant="secondary" disabled={busy}>
                            编辑
                          </Button>
                        </Link>
                        {published && !offline ? (
                          <Button size="sm" variant="secondary" disabled={busy} onClick={() => void act(s.id, 'POST', '已重新发布(线上已更新)')}>
                            <RefreshCw size={13} className={busy ? 'animate-spin' : ''} aria-hidden />
                            重发
                          </Button>
                        ) : null}
                        {published && !offline ? (
                          <Button
                            size="sm"
                            variant="ghost"
                            disabled={busy}
                            title="下架:读者页立即 404,重新发布可恢复"
                            onClick={() => {
                              if (window.confirm(`确认下架《${s.title}》?读者页将立即 404,重新发布可恢复。`)) void act(s.id, 'DELETE' as string, '已下架,读者页已 404');
                            }}
                          >
                            <EyeOff size={13} aria-hidden />
                          </Button>
                        ) : null}
                        {published && !offline ? (
                          <a
                            href={`/short/${s.id}`}
                            target="_blank"
                            rel="noreferrer"
                            title="打开读者页"
                            className="flex h-8 w-8 items-center justify-center rounded-md text-[#475569] transition-colors hover:bg-[#f1f5f9] hover:text-[#0f172a]"
                          >
                            <ExternalLink size={14} aria-hidden />
                          </a>
                        ) : null}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
