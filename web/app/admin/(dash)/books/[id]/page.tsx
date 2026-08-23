'use client';

// 小说编辑:元数据表单 + 章节管理(新建/编辑/发布语义/上下移重排/删除)

import { ArrowDown, ArrowUp, ChevronLeft, Pencil, Plus, Trash2 } from 'lucide-react';
import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { api } from '@/lib/admin-client';
import { Badge, BOOK_STATUS_BADGE, Button, CHAPTER_STATUS_BADGE, ConfirmDialog, EmptyState, Field, Input, Modal, Notice, Select, Spinner, Textarea } from '@/components/admin/ui';

interface BookDetail {
  id: string;
  slug: string;
  title: string;
  description: string | null;
  coverPath: string | null;
  status: string;
  authorName: string;
  categoryName: string;
  tags: string[];
}
interface ChapterRow {
  id: string;
  number: number;
  title: string;
  status: string;
  scheduledAt: string | null;
  publishedAt: string | null;
  contentMd: string;
}

function fmt(iso: string | null): string {
  if (!iso) return '—';
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleString('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' });
}

export default function AdminBookDetailPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [book, setBook] = useState<BookDetail | null>(null);
  const [chapters, setChapters] = useState<ChapterRow[]>([]);

  // 元数据表单
  const [meta, setMeta] = useState({ title: '', authorName: '', categoryName: '', tags: '', description: '', coverPath: '' });
  const [savingMeta, setSavingMeta] = useState(false);

  // 章节弹窗(新建/编辑共用)
  const [chapterModal, setChapterModal] = useState<null | { mode: 'create' } | { mode: 'edit'; chapter: ChapterRow }>(null);
  const [chapterForm, setChapterForm] = useState({ title: '', contentMd: '', status: 'draft', scheduledAt: '' });
  const [chapterError, setChapterError] = useState<string | null>(null);
  const [savingChapter, setSavingChapter] = useState(false);

  const [deleteTarget, setDeleteTarget] = useState<ChapterRow | null>(null);
  const [deleting, setDeleting] = useState(false);

  const load = useCallback(async () => {
    try {
      setError(null);
      const [b, c] = await Promise.all([api<{ book: BookDetail }>(`/api/admin/books/${id}`), api<{ chapters: ChapterRow[] }>(`/api/admin/books/${id}/chapters`)]);
      setBook(b.book);
      setChapters(c.chapters);
      setMeta({
        title: b.book.title,
        authorName: b.book.authorName,
        categoryName: b.book.categoryName,
        tags: b.book.tags.join(', '),
        description: b.book.description ?? '',
        coverPath: b.book.coverPath ?? '',
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : '加载失败');
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => {
    void load();
  }, [load]);

  async function saveMeta(e: FormEvent): Promise<void> {
    e.preventDefault();
    if (!book || savingMeta) return;
    setSavingMeta(true);
    setNotice(null);
    try {
      await api(`/api/admin/books/${book.id}`, {
        method: 'PATCH',
        body: JSON.stringify({
          title: meta.title,
          authorName: meta.authorName,
          categoryName: meta.categoryName,
          description: meta.description || null,
          coverPath: meta.coverPath || null,
          tags: meta.tags
            .split(/[,，]/)
            .map((t) => t.trim())
            .filter(Boolean),
        }),
      });
      setNotice('元数据已保存');
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : '保存失败');
    } finally {
      setSavingMeta(false);
    }
  }

  function openCreate(): void {
    setChapterForm({ title: `第${chapters.length + 1}章 `, contentMd: '', status: 'draft', scheduledAt: '' });
    setChapterError(null);
    setChapterModal({ mode: 'create' });
  }

  function openEdit(ch: ChapterRow): void {
    setChapterForm({ title: ch.title, contentMd: ch.contentMd, status: ch.status, scheduledAt: ch.scheduledAt ? ch.scheduledAt.slice(0, 16) : '' });
    setChapterError(null);
    setChapterModal({ mode: 'edit', chapter: ch });
  }

  async function saveChapter(e: FormEvent): Promise<void> {
    e.preventDefault();
    if (!chapterModal || savingChapter) return;
    setSavingChapter(true);
    setChapterError(null);
    try {
      const payloadStatus = chapterForm.status as 'draft' | 'scheduled' | 'published' | 'hidden';
      const body = JSON.stringify({
        title: chapterForm.title.trim(),
        contentMd: chapterForm.contentMd,
        status: payloadStatus,
        ...(payloadStatus === 'scheduled'
          ? { scheduledAt: chapterForm.scheduledAt ? new Date(chapterForm.scheduledAt).toISOString() : null }
          : {}),
      });
      if (chapterModal.mode === 'create') {
        await api(`/api/admin/books/${id}/chapters`, { method: 'POST', body });
        setNotice(`《${chapterForm.title.trim()}》已创建`);
      } else {
        await api(`/api/admin/books/${id}/chapters/${chapterModal.chapter.number}`, { method: 'PATCH', body });
        setNotice(`第 ${chapterModal.chapter.number} 章已保存`);
      }
      setChapterModal(null);
      await load();
    } catch (err) {
      setChapterError(err instanceof Error ? err.message : '保存失败');
    } finally {
      setSavingChapter(false);
    }
  }

  async function reorder(index: number, dir: -1 | 1): Promise<void> {
    const target = index + dir;
    if (target < 0 || target >= chapters.length) return;
    const order = chapters.map((c) => c.number);
    [order[index], order[target]] = [order[target]!, order[index]!];
    setNotice(null);
    try {
      await api(`/api/admin/books/${id}/chapters/order`, { method: 'PUT', body: JSON.stringify({ order }) });
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : '重排失败');
    }
  }

  async function doDelete(): Promise<void> {
    if (!deleteTarget) return;
    setDeleting(true);
    try {
      await api(`/api/admin/books/${id}/chapters/${deleteTarget.number}`, { method: 'DELETE' });
      setNotice(`第 ${deleteTarget.number} 章已删除`);
      setDeleteTarget(null);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : '删除失败');
    } finally {
      setDeleting(false);
    }
  }

  if (loading) {
    return (
      <div className="flex min-h-[200px] items-center justify-center gap-2 text-sm text-[#64748b]">
        <Spinner size={18} /> 加载中…
      </div>
    );
  }

  return (
    <div>
      <Link href="/admin/books" className="mb-3 inline-flex items-center gap-1 text-sm text-[#1677ff] hover:underline">
        <ChevronLeft size={14} /> 返回小说列表
      </Link>

      {error ? <Notice tone="error">{error}</Notice> : null}
      {notice ? <Notice tone="success">{notice}</Notice> : null}
      {!book ? (
        <EmptyState icon={<Pencil size={32} />} title="找不到这本小说" description="它可能已被删除。" action={<Button variant="primary" onClick={() => router.push('/admin/books')}>返回列表</Button>} />
      ) : (
        <>
          {/* 元数据 */}
          <form onSubmit={(e) => void saveMeta(e)} className="rounded-xl bg-white p-5 shadow-sm">
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3">
              <Field label="书名">
                <Input value={meta.title} onChange={(e) => setMeta({ ...meta, title: e.target.value })} />
              </Field>
              <Field label="作者">
                <Input value={meta.authorName} onChange={(e) => setMeta({ ...meta, authorName: e.target.value })} />
              </Field>
              <Field label="分类">
                <Input value={meta.categoryName} onChange={(e) => setMeta({ ...meta, categoryName: e.target.value })} />
              </Field>
              <Field label="标签(逗号分隔)">
                <Input value={meta.tags} onChange={(e) => setMeta({ ...meta, tags: e.target.value })} />
              </Field>
              <Field label="封面路径">
                <Input value={meta.coverPath} onChange={(e) => setMeta({ ...meta, coverPath: e.target.value })} placeholder="/media/cover.png" />
              </Field>
              <div className="sm:col-span-2 xl:col-span-1">
                <Field label="简介">
                  <Textarea rows={2} value={meta.description} onChange={(e) => setMeta({ ...meta, description: e.target.value })} />
                </Field>
              </div>
            </div>
            <div className="mt-4 flex items-center gap-2">
              <Button variant="primary" type="submit" disabled={savingMeta}>
                {savingMeta ? '保存中…' : '保存修改'}
              </Button>
              <Badge tone={(BOOK_STATUS_BADGE[book.status] ?? { tone: 'info' }).tone}>{(BOOK_STATUS_BADGE[book.status] ?? { label: book.status }).label}</Badge>
              <span className="text-xs text-[#94a3b8]">slug /{book.slug} 不可修改(URL 稳定性)</span>
            </div>
          </form>

          {/* 章节 */}
          <div className="mt-5 mb-4 flex flex-wrap items-center gap-2">
            <h2 className="text-base font-semibold text-[#0f172a]">章节管理</h2>
            <span className="text-sm text-[#94a3b8]">
              {chapters.filter((c) => c.status === 'published').length}/{chapters.length} 已发布
            </span>
            <Button variant="primary" size="sm" className="ml-auto" onClick={openCreate}>
              <Plus size={14} /> 新建章节
            </Button>
          </div>

          <div className="overflow-hidden rounded-xl bg-white shadow-sm">
            {chapters.length === 0 ? (
              <EmptyState
                icon={<Plus size={32} />}
                title="还没有章节"
                description="从「新建章节」写入第一章正文(Markdown),或用导入器批量灌入。"
                action={
                  <Button variant="primary" onClick={openCreate}>
                    <Plus size={16} /> 新建章节
                  </Button>
                }
              />
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full min-w-[720px] border-collapse text-left">
                  <thead>
                    <tr className="h-12 bg-[#f8fafc] text-[13px] font-semibold text-[#334155]">
                      <th className="border-b border-[#e2e8f0] px-4 font-semibold">序</th>
                      <th className="border-b border-[#e2e8f0] px-4 font-semibold">标题</th>
                      <th className="border-b border-[#e2e8f0] px-4 font-semibold">状态</th>
                      <th className="border-b border-[#e2e8f0] px-4 font-semibold">定时 / 发布</th>
                      <th className="border-b border-[#e2e8f0] px-4 text-right font-semibold">操作</th>
                    </tr>
                  </thead>
                  <tbody>
                    {chapters.map((c, i) => {
                      const badge = CHAPTER_STATUS_BADGE[c.status] ?? { tone: 'info' as const, label: c.status };
                      return (
                        <tr key={c.id} className="group h-13 transition-all duration-200 hover:bg-[#f8fafc]">
                          <td className="border-b border-[#f1f5f9] px-4 text-sm text-[#94a3b8]">{c.number}</td>
                          <td className="border-b border-[#f1f5f9] px-4 align-middle text-sm font-medium text-[#334155]">{c.title}</td>
                          <td className="border-b border-[#f1f5f9] px-4 align-middle">
                            <Badge tone={badge.tone}>{badge.label}</Badge>
                          </td>
                          <td className="border-b border-[#f1f5f9] px-4 align-middle text-xs text-[#64748b]">
                            {c.status === 'scheduled' ? `定时 ${fmt(c.scheduledAt)}` : `发布 ${fmt(c.publishedAt)}`}
                          </td>
                          <td className="border-b border-[#f1f5f9] px-4 align-middle">
                            <div className="flex items-center justify-end gap-1 transition-opacity duration-250 md:opacity-0 md:group-hover:opacity-100 md:focus-within:opacity-100">
                              <button aria-label={`上移第${c.number}章`} disabled={i === 0} onClick={() => void reorder(i, -1)} className="flex h-7 w-7 items-center justify-center rounded-md text-[#64748b] transition-all duration-150 hover:-translate-y-px hover:bg-[#f1f5f9] hover:text-[#334155] disabled:pointer-events-none disabled:opacity-30">
                                <ArrowUp size={15} />
                              </button>
                              <button aria-label={`下移第${c.number}章`} disabled={i === chapters.length - 1} onClick={() => void reorder(i, 1)} className="flex h-7 w-7 items-center justify-center rounded-md text-[#64748b] transition-all duration-150 hover:-translate-y-px hover:bg-[#f1f5f9] hover:text-[#334155] disabled:pointer-events-none disabled:opacity-30">
                                <ArrowDown size={15} />
                              </button>
                              <button aria-label={`编辑第${c.number}章`} onClick={() => openEdit(c)} className="flex h-7 w-7 items-center justify-center rounded-md text-[#64748b] transition-all duration-150 hover:-translate-y-px hover:bg-[#e8f3ff] hover:text-[#1677ff] hover:shadow-sm">
                                <Pencil size={15} />
                              </button>
                              <button aria-label={`删除第${c.number}章`} onClick={() => setDeleteTarget(c)} className="flex h-7 w-7 items-center justify-center rounded-md text-[#64748b] transition-all duration-150 hover:-translate-y-px hover:bg-[#fee2e2] hover:text-[#b91c1c] hover:shadow-sm">
                                <Trash2 size={15} />
                              </button>
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
        </>
      )}

      {/* 章节弹窗 */}
      <Modal
        open={chapterModal !== null}
        title={chapterModal?.mode === 'edit' ? `编辑第 ${chapterModal.chapter.number} 章` : '新建章节'}
        onClose={() => setChapterModal(null)}
        footer={
          <>
            <Button variant="secondary" onClick={() => setChapterModal(null)} disabled={savingChapter}>
              取消
            </Button>
            <Button variant="primary" type="submit" form="chapter-form" disabled={savingChapter}>
              {savingChapter ? '保存中…' : '保存'}
            </Button>
          </>
        }
      >
        <form id="chapter-form" onSubmit={(e) => void saveChapter(e)} className="grid grid-cols-1 gap-4" noValidate>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <Field label="章节标题*">
              <Input value={chapterForm.title} onChange={(e) => setChapterForm({ ...chapterForm, title: e.target.value })} />
            </Field>
            <Field label="状态">
              <Select value={chapterForm.status} onChange={(e) => setChapterForm({ ...chapterForm, status: e.target.value })}>
                <option value="draft">草稿</option>
                <option value="scheduled">定时发布</option>
                <option value="published">立即发布</option>
                <option value="hidden">下线</option>
              </Select>
            </Field>
          </div>
          {chapterForm.status === 'scheduled' ? (
            <Field label="定时发布时间*" error={chapterForm.status === 'scheduled' && !chapterForm.scheduledAt ? '选择将来自动发布的时刻' : null}>
              <Input type="datetime-local" value={chapterForm.scheduledAt} onChange={(e) => setChapterForm({ ...chapterForm, scheduledAt: e.target.value })} />
            </Field>
          ) : null}
          <Field label="正文(Markdown)*">
            <Textarea rows={12} value={chapterForm.contentMd} onChange={(e) => setChapterForm({ ...chapterForm, contentMd: e.target.value })} className="font-mono text-[13px] leading-relaxed" />
          </Field>
          <p className="text-xs leading-relaxed text-[#94a3b8]">状态语义:首次发布记录发布时间且后续编辑不改写;退回草稿会取消定时;下线保留发布历史。</p>
          {chapterError ? (
            <p role="alert" className="text-xs text-[#dc2626]">
              {chapterError}
            </p>
          ) : null}
        </form>
      </Modal>

      <ConfirmDialog
        open={deleteTarget !== null}
        title="删除章节"
        description={`确认删除第 ${deleteTarget?.number ?? ''} 章《${deleteTarget?.title ?? ''}》?该操作不可恢复。`}
        loading={deleting}
        onCancel={() => setDeleteTarget(null)}
        onConfirm={() => void doDelete()}
      />
    </div>
  );
}
