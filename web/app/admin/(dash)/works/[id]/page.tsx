'use client';

// 作品管理:短篇详情(编辑工作台)
// 标题内联编辑(自动同步线上 Book/Chapter)、正文编辑(追加 user_edited 版本)、
// 版本历史(查看/设为最终版)、发布操作(发布/重新发布/下架)

import { ArrowLeft, Eye, EyeOff, ExternalLink, Pencil, RefreshCw, Save, Star } from 'lucide-react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import { api } from '@/lib/admin-client';
import { mdToHtml } from '@/lib/markdown';
import { Badge, Button, EmptyState, Field, Input, Notice, Spinner, Textarea } from '@/components/admin/ui';

interface StoryDetail {
  story: {
    id: string;
    title: string;
    status: string;
    currentVersionId: string | null;
    lastScore: number | null;
    updatedAt: string;
  };
  versions: Array<{
    id: string;
    version: number;
    content: string;
    charCount: number;
    creationReason: 'generated' | 'ai_optimized' | 'user_edited';
    isFinal: boolean;
    createdAt: string;
  }>;
  latestReviews: Record<string, { score: number; level: string; qualified: boolean; summary: string | null } | null>;
  publication: { id: string; bookId: string; versionId: string; publishedAt: string } | null;
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

const REASON_LABEL: Record<string, { label: string; tone: 'info' | 'running' | 'success' }> = {
  generated: { label: 'AI 生成', tone: 'running' },
  ai_optimized: { label: 'AI 优化', tone: 'running' },
  user_edited: { label: '人工编辑', tone: 'success' },
};

function fmtTime(s: string | null | undefined): string {
  if (!s) return '—';
  return new Date(s).toLocaleString('zh-CN', { year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' });
}

export default function AdminWorkDetailPage() {
  const params = useParams<{ id: string }>();
  const id = params.id;
  const [detail, setDetail] = useState<StoryDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // 编辑态
  const [title, setTitle] = useState('');
  const [content, setContent] = useState('');
  const [previewHtml, setPreviewHtml] = useState<string | null>(null);
  // 当前查看/编辑的是哪个版本(null=最终版)
  const [viewingVersion, setViewingVersion] = useState<number | null>(null);

  const load = useCallback(async () => {
    try {
      setError(null);
      const res = await api<StoryDetail>(`/api/admin/short-stories/${id}`);
      setDetail(res);
      const final = res.versions.find((v) => v.isFinal);
      const target = final ?? res.versions[res.versions.length - 1];
      setTitle(res.story.title);
      setContent(target ? target.content : '');
      setViewingVersion(target ? target.version : null);
      setPreviewHtml(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : '加载失败');
    }
  }, [id]);

  useEffect(() => {
    void load();
  }, [load]);

  const titleDirty = detail !== null && title.trim() !== detail.story.title;
  const contentDirty = useMemo(() => {
    if (!detail) return false;
    const target = detail.versions.find((v) => v.version === viewingVersion);
    return target ? content.trim() !== target.content : false;
  }, [detail, content, viewingVersion]);

  const finalVersion = detail?.versions.find((v) => v.isFinal) ?? null;
  const onlineVersion = useMemo(() => {
    if (!detail?.publication) return null;
    return detail.versions.find((v) => v.id === detail.publication!.versionId) ?? null;
  }, [detail]);
  const published = !!detail?.publication;
  const stale = published && !!finalVersion && onlineVersion !== null && onlineVersion.id !== finalVersion.id;

  const act = async (label: string, fn: () => Promise<unknown>) => {
    setBusy(true);
    setNotice(null);
    setError(null);
    try {
      await fn();
      setNotice(label);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : '操作失败');
    } finally {
      setBusy(false);
    }
  };

  const saveTitle = () =>
    act('标题已保存,线上 Book/Chapter 标题已同步', async () => {
      await api(`/api/admin/short-stories/${id}`, { method: 'PATCH', body: JSON.stringify({ title: title.trim() }) });
    });

  const saveContent = () =>
    act('已保存为新版本(自动置为最终版)。线上内容需点「重新发布」更新', async () => {
      await api(`/api/admin/short-stories/${id}/versions`, { method: 'POST', body: JSON.stringify({ content: content.trim() }) });
      setPreviewHtml(null);
    });

  const setFinal = (v: StoryDetail['versions'][number]) =>
    act(`v${v.version} 已设为最终版。线上内容需点「重新发布」更新`, async () => {
      await api(`/api/admin/short-stories/${id}/versions/${v.id}/set-final`, { method: 'POST', body: '{}' });
    });

  const viewVersion = (v: StoryDetail['versions'][number]) => {
    setViewingVersion(v.version);
    setContent(v.content);
    setPreviewHtml(null);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const togglePreview = async () => {
    if (previewHtml !== null) {
      setPreviewHtml(null);
      return;
    }
    setPreviewHtml(await mdToHtml(content));
  };

  if (!detail) {
    return (
      <div className="py-16 text-center text-sm text-[#64748b]">
        {error ? <span className="text-[#b91c1c]">{error}</span> : '加载中…'}
      </div>
    );
  }

  const badge = STATUS_BADGE[detail.story.status] ?? { label: detail.story.status, tone: 'info' as const };

  return (
    <div className="space-y-4">
      {/* 头部:返回 + 标题内联编辑 + 状态徽标 */}
      <div className="flex flex-wrap items-center gap-3">
        <Link
          href="/admin/works"
          className="flex h-8 w-8 items-center justify-center rounded-lg text-[#475569] transition-colors hover:bg-[#f1f5f9] hover:text-[#0f172a]"
        >
          <ArrowLeft size={16} aria-hidden />
        </Link>
        <div className="flex min-w-0 flex-1 items-center gap-2">
          <input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            className="min-w-0 flex-1 rounded-lg border border-transparent bg-transparent px-2 py-1 text-xl font-semibold text-[#0f172a] transition-colors hover:border-[#e2e8f0] focus:border-[#1677ff] focus:bg-white focus:outline-none"
            aria-label="作品标题"
          />
          <Badge tone={badge.tone}>{badge.label}</Badge>
          {detail.story.lastScore !== null ? (
            <span className="text-xs text-[#64748b]">最新评审 {detail.story.lastScore} 分</span>
          ) : null}
        </div>
        <Button variant="secondary" size="sm" disabled={!titleDirty || busy || title.trim() === ''} onClick={() => void saveTitle()}>
          <Save size={13} aria-hidden />
          保存标题
        </Button>
      </div>

      {error ? <Notice tone="error">{error}</Notice> : null}
      {notice ? <Notice tone="success">{notice}</Notice> : null}

      {/* 线上状态条 */}
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 rounded-xl border border-[#e2e8f0] bg-white px-4 py-3 text-sm">
        {published ? (
          <>
            <span className="text-[#334155]">
              线上:
              {onlineVersion ? (
                <span className="font-medium">v{onlineVersion.version}</span>
              ) : (
                <span className="font-medium">{detail.publication!.versionId.slice(-6)}</span>
              )}
              <span className="ml-1 text-xs text-[#94a3b8]">{fmtTime(detail.publication!.publishedAt)}</span>
            </span>
            {finalVersion ? (
              <span className="text-[#334155]">
                最终版:
                <span className="font-medium">v{finalVersion.version}</span>
              </span>
            ) : null}
            {stale ? <Badge tone="warning">线上落后于最终版,需重新发布</Badge> : null}
          </>
        ) : detail.story.status === 'passed' ? (
          <Badge tone="info">已达标,尚未发布</Badge>
        ) : (
          <Badge tone="info">未发布(仅已达标作品可发布)</Badge>
        )}
        <div className="ml-auto flex items-center gap-1.5">
          {published && (
            <>
              <a
                href={`/short/${id}`}
                target="_blank"
                rel="noreferrer"
                className="inline-flex h-8 items-center gap-1.5 rounded-md px-3 text-xs font-medium text-[#334155] transition-colors hover:bg-[#f8fafc] hover:text-[#0f172a]"
              >
                <ExternalLink size={13} aria-hidden />
                读者页
              </a>
              <button
                className="inline-flex h-8 items-center gap-1.5 rounded-md px-3 text-xs font-medium text-[#334155] transition-colors hover:bg-[#f8fafc] hover:text-[#0f172a]"
                onClick={() => {
                  void navigator.clipboard.writeText(`${location.origin}/short/${id}`).then(
                    () => setNotice('读者链接已复制'),
                    () => setError('复制失败,请手动复制')
                  );
                }}
              >
                复制链接
              </button>
            </>
          )}
          {!published && detail.story.status === 'passed' ? (
            <Button variant="primary" size="sm" disabled={busy} onClick={() => void act('已发布,读者页已生成', async () => { await api(`/api/admin/short-stories/${id}/publish`, { method: 'POST', body: '{}' }); })}>
              发布
            </Button>
          ) : null}
          {published && (
            <Button variant="secondary" size="sm" disabled={busy || !stale} title={stale ? '线上原地更新为最终版,读者链接不变' : '线上已是最新'} onClick={() => void act('已重新发布(线上已更新)', async () => { await api(`/api/admin/short-stories/${id}/republish`, { method: 'POST', body: '{}' }); })}>
              <RefreshCw size={13} className={busy && stale ? 'animate-spin' : ''} aria-hidden />
              重新发布
            </Button>
          )}
          {published && (
            <Button variant="danger" size="sm" disabled={busy} title="读者页立即 404,重新发布可恢复" onClick={() => { if (window.confirm(`确认下架《${detail.story.title}》?读者页将立即 404,重新发布可恢复。`)) void act('已下架,读者页已 404', async () => { await api(`/api/admin/short-stories/${id}/unpublish`, { method: 'POST', body: '{}' }); }); }}>
              <EyeOff size={13} aria-hidden />
              下架
            </Button>
          )}
        </div>
      </div>

      {/* 正文编辑 */}
      <section className="overflow-hidden rounded-xl bg-white shadow-sm">
        <header className="flex h-12 items-center gap-2 border-b border-[#e2e8f0] px-5">
          <h2 className="text-sm font-semibold text-[#0f172a]">正文编辑</h2>
          {viewingVersion !== null ? <Badge tone="info">正在查看 v{viewingVersion}</Badge> : null}
          <span className="text-xs text-[#94a3b8]">
            {content.length > 0 ? `${content.length.toLocaleString()} 字` : '无内容'} · 保存将追加为新版本(自动置最终版)
          </span>
          <div className="ml-auto flex items-center gap-1.5">
            <Button variant="ghost" size="sm" disabled={content.trim() === ''} onClick={() => void togglePreview()}>
              {previewHtml === null ? (
                <>
                  <Eye size={13} aria-hidden />
                  渲染预览
                </>
              ) : (
                <>
                  <EyeOff size={13} aria-hidden />
                  返回编辑
                </>
              )}
            </Button>
            <Button variant="primary" size="sm" disabled={busy || content.trim() === '' || !contentDirty} onClick={() => void saveContent()}>
              {busy ? <Spinner size={13} /> : <Save size={13} aria-hidden />}
              保存为新版本
            </Button>
          </div>
        </header>
        <div className="p-5">
          {previewHtml !== null ? (
            <div
              className="prose prose-sm max-w-none rounded-lg bg-[#f8fafc] p-5"
              dangerouslySetInnerHTML={{ __html: previewHtml }}
            />
          ) : (
            <Textarea
              rows={18}
              value={content}
              onChange={(e) => setContent(e.target.value)}
              placeholder="Markdown 正文…"
              className="font-mono text-[13px] leading-relaxed"
            />
          )}
        </div>
      </section>

      {/* 版本历史 */}
      <section className="overflow-hidden rounded-xl border border-[#e2e8f0] bg-white">
        <header className="flex h-12 items-center gap-2 border-b border-[#e2e8f0] px-5">
          <h2 className="text-sm font-semibold text-[#0f172a]">版本历史</h2>
          <span className="text-xs text-[#94a3b8]">共 {detail.versions.length} 版 · 内容一经写入永不修改,修订一律追加新版本</span>
        </header>
        {detail.versions.length === 0 ? (
          <EmptyState icon={<Pencil size={28} />} title="尚无版本" description="作品生成或手工保存正文后,版本会出现在这里。" />
        ) : (
          <table className="w-full text-sm">
            <thead className="bg-[#f8fafc] text-xs text-[#64748b]">
              <tr>
                <th className="px-4 py-2.5 text-left font-medium">版本</th>
                <th className="px-3 py-2.5 text-left font-medium">来源</th>
                <th className="px-3 py-2.5 text-left font-medium">字数</th>
                <th className="px-3 py-2.5 text-left font-medium">评审</th>
                <th className="px-3 py-2.5 text-left font-medium">时间</th>
                <th className="px-4 py-2.5 text-right font-medium">操作</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[#f1f5f9]">
              {detail.versions
                .slice()
                .reverse()
                .map((v) => {
                  const review = detail.latestReviews[v.id];
                  const isOnline = detail.publication?.versionId === v.id;
                  const isViewing = viewingVersion === v.version;
                  return (
                    <tr key={v.id} className={isViewing ? 'bg-[#f0f7ff]' : 'transition-colors hover:bg-[#f8fafc]'}>
                      <td className="px-4 py-2.5 font-medium text-[#0f172a]">
                        v{v.version}
                        {v.isFinal ? <Badge tone="success">最终版</Badge> : null}
                        {isOnline ? <Badge tone="info">线上</Badge> : null}
                      </td>
                      <td className="px-3 py-2.5">
                        <Badge tone={REASON_LABEL[v.creationReason]?.tone ?? 'info'}>{REASON_LABEL[v.creationReason]?.label ?? v.creationReason}</Badge>
                      </td>
                      <td className="px-3 py-2.5 text-[#334155]">{v.charCount.toLocaleString()}</td>
                      <td className="px-3 py-2.5 text-[#334155]">
                        {review ? (
                          <span title={review.summary ?? undefined}>
                            {review.score} 分 · {review.level}{' '}
                            {review.qualified ? '(达标)' : '(未达标)'}
                          </span>
                        ) : (
                          <span className="text-[#94a3b8]">—</span>
                        )}
                      </td>
                      <td className="px-3 py-2.5 text-[#64748b]">{fmtTime(v.createdAt)}</td>
                      <td className="px-4 py-2.5">
                        <div className="flex items-center justify-end gap-1.5">
                          <Button variant="ghost" size="sm" disabled={isViewing} onClick={() => viewVersion(v)}>
                            查看
                          </Button>
                          {!v.isFinal && (
                            <Button variant="ghost" size="sm" disabled={busy} onClick={() => void setFinal(v)} title="设为最终版(线上需重新发布)">
                              <Star size={13} aria-hidden />
                              设为最终版
                            </Button>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })}
            </tbody>
          </table>
        )}
      </section>
    </div>
  );
}
