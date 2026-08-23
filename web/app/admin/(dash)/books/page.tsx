'use client';

// 小说管理:搜索/状态筛选、新建弹窗、行内操作(编辑·隐藏恢复·删除)
// 表格规格: 白底圆12 th48 行56-64 行hover上浮 操作渐显(md)

import { BookOpen, Pencil, Plus, Search, Trash2 } from 'lucide-react';
import Link from 'next/link';
import { useCallback, useEffect, useMemo, useState, type FormEvent } from 'react';
import { api } from '@/lib/admin-client';
import { Badge, BOOK_STATUS_BADGE, Button, ConfirmDialog, EmptyState, Field, Input, Modal, Notice, Select, Spinner, Textarea } from '@/components/admin/ui';

interface BookRow {
  id: string;
  slug: string;
  title: string;
  authorName: string;
  categoryName: string;
  status: string;
  tags: string[];
  chapterCount: number;
  publishedCount: number;
}

export default function AdminBooksPage() {
  const [rows, setRows] = useState<BookRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [q, setQ] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [busyId, setBusyId] = useState<string | null>(null);

  // 新建弹窗
  const [createOpen, setCreateOpen] = useState(false);
  const [form, setForm] = useState({ slug: '', title: '', authorName: '', categoryName: '', tags: '', description: '', coverPath: '' });
  const [formError, setFormError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);

  // 删除确认
  const [deleteTarget, setDeleteTarget] = useState<BookRow | null>(null);
  const [deleting, setDeleting] = useState(false);

  const load = useCallback(async () => {
    try {
      setError(null);
      const res = await api<{ books: BookRow[] }>('/api/admin/books?limit=500');
      setRows(res.books);
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
    if (statusFilter) list = list.filter((b) => b.status === statusFilter);
    if (q.trim()) {
      const kw = q.trim().toLowerCase();
      list = list.filter((b) => b.title.toLowerCase().includes(kw) || b.authorName.toLowerCase().includes(kw));
    }
    return list;
  }, [rows, q, statusFilter]);

  async function toggleHidden(b: BookRow): Promise<void> {
    setBusyId(b.id);
    setNotice(null);
    try {
      await api(`/api/admin/books/${b.id}`, { method: 'PATCH', body: JSON.stringify({ status: b.status === 'hidden' ? 'serializing' : 'hidden' }) });
      setNotice(b.status === 'hidden' ? `《${b.title}》已恢复公开` : `《${b.title}》已隐藏`);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : '操作失败');
    } finally {
      setBusyId(null);
    }
  }

  async function doDelete(): Promise<void> {
    if (!deleteTarget) return;
    setDeleting(true);
    try {
      await api(`/api/admin/books/${deleteTarget.id}`, { method: 'DELETE' });
      setNotice(`《${deleteTarget.title}》及其全部章节已删除`);
      setDeleteTarget(null);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : '删除失败');
    } finally {
      setDeleting(false);
    }
  }

  async function onCreate(e: FormEvent): Promise<void> {
    e.preventDefault();
    if (!form.slug.trim() || !form.title.trim() || !form.authorName.trim() || !form.categoryName.trim()) {
      setFormError('slug、书名、作者、分类为必填项');
      return;
    }
    setCreating(true);
    setFormError(null);
    try {
      await api('/api/admin/books', {
        method: 'POST',
        body: JSON.stringify({
          slug: form.slug.trim(),
          title: form.title.trim(),
          authorName: form.authorName.trim(),
          categoryName: form.categoryName.trim(),
          description: form.description.trim() || null,
          coverPath: form.coverPath.trim() || null,
          tags:
            form.tags
              .split(/[,，]/)
              .map((t) => t.trim())
              .filter(Boolean),
        }),
      });
      setCreateOpen(false);
      setForm({ slug: '', title: '', authorName: '', categoryName: '', tags: '', description: '', coverPath: '' });
      setNotice('小说已创建');
      await load();
    } catch (err) {
      setFormError(err instanceof Error ? err.message : '创建失败');
    } finally {
      setCreating(false);
    }
  }

  return (
    <div>
      {error ? <Notice tone="error">{error}</Notice> : null}
      {notice ? <Notice tone="success">{notice}</Notice> : null}

      {/* 工具栏 */}
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <div className="relative w-full sm:w-[300px]">
          <Search size={16} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-[#94a3b8]" aria-hidden />
          <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="搜索书名或作者…" aria-label="搜索书籍" className="pl-9" />
        </div>
        <Select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)} aria-label="按状态筛选" className="w-36">
          <option value="">全部状态</option>
          <option value="serializing">连载中</option>
          <option value="completed">已完结</option>
          <option value="hidden">已隐藏</option>
        </Select>
        <div className="ml-auto flex items-center gap-2">
          <Button variant="secondary" size="md" onClick={() => void load()}>
            刷新
          </Button>
          <Button variant="primary" size="md" onClick={() => setCreateOpen(true)}>
            <Plus size={16} /> 新建小说
          </Button>
        </div>
      </div>

      {/* 数据表格 */}
      <div className="overflow-hidden rounded-xl bg-white shadow-sm">
        {rows === null ? (
          <div className="flex min-h-[200px] items-center justify-center gap-2 text-sm text-[#64748b]">
            <Spinner size={18} /> 加载中…
          </div>
        ) : filtered.length === 0 ? (
          <EmptyState
            icon={<BookOpen size={32} />}
            title={rows.length === 0 ? '还没有任何小说' : '没有匹配的小说'}
            description={rows.length === 0 ? '从「新建小说」开始构建你的内容库,或用导入器批量导入。' : '换个关键词或清除筛选条件再试试。'}
            action={
              rows.length === 0 ? (
                <Button variant="primary" onClick={() => setCreateOpen(true)}>
                  <Plus size={16} /> 新建小说
                </Button>
              ) : undefined
            }
          />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[760px] border-collapse text-left">
              <thead>
                <tr className="h-12 bg-[#f8fafc] text-[13px] font-semibold text-[#334155]">
                  <th className="border-b border-[#e2e8f0] px-4 font-semibold">书名</th>
                  <th className="border-b border-[#e2e8f0] px-4 font-semibold">作者 / 分类</th>
                  <th className="border-b border-[#e2e8f0] px-4 font-semibold">状态</th>
                  <th className="border-b border-[#e2e8f0] px-4 font-semibold">章节</th>
                  <th className="border-b border-[#e2e8f0] px-4 text-right font-semibold">操作</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((b) => {
                  const badge = BOOK_STATUS_BADGE[b.status] ?? { tone: 'info' as const, label: b.status };
                  return (
                    <tr key={b.id} className="group h-14 transition-all duration-200 hover:-translate-y-px hover:bg-[#f8fafc] hover:shadow-[0_2px_8px_rgba(0,0,0,0.08)] active:scale-[0.995]">
                      <td className="border-b border-[#f1f5f9] px-4 align-middle">
                        <Link href={`/admin/books/${b.id}`} className="font-medium text-[#1677ff] hover:underline">
                          {b.title}
                        </Link>
                        <div className="mt-0.5 line-clamp-1 max-w-[320px] text-xs text-[#94a3b8]">/{b.slug}</div>
                      </td>
                      <td className="border-b border-[#f1f5f9] px-4 align-middle text-sm text-[#334155]">
                        {b.authorName}
                        <span className="mx-1.5 text-[#cbd5e1]">·</span>
                        {b.categoryName}
                      </td>
                      <td className="border-b border-[#f1f5f9] px-4 align-middle">
                        <Badge tone={badge.tone}>{badge.label}</Badge>
                      </td>
                      <td className="border-b border-[#f1f5f9] px-4 align-middle text-sm text-[#334155]">
                        {b.publishedCount}/{b.chapterCount}
                      </td>
                      <td className="border-b border-[#f1f5f9] px-4 align-middle">
                        <div className="flex items-center justify-end gap-1 transition-opacity duration-250 md:opacity-0 md:group-hover:opacity-100 md:focus-within:opacity-100">
                          <Link
                            href={`/admin/books/${b.id}`}
                            aria-label={`编辑《${b.title}》`}
                            className="flex h-7 w-7 items-center justify-center rounded-md text-[#64748b] transition-all duration-150 hover:-translate-y-px hover:bg-[#e8f3ff] hover:text-[#1677ff] hover:shadow-sm"
                          >
                            <Pencil size={16} />
                          </Link>
                          <Button variant="ghost" size="xs" disabled={busyId === b.id} onClick={() => void toggleHidden(b)}>
                            {b.status === 'hidden' ? '恢复' : '隐藏'}
                          </Button>
                          <button
                            aria-label={`删除《${b.title}》`}
                            onClick={() => setDeleteTarget(b)}
                            className="flex h-7 w-7 items-center justify-center rounded-md text-[#64748b] transition-all duration-150 hover:-translate-y-px hover:bg-[#fee2e2] hover:text-[#b91c1c] hover:shadow-sm"
                          >
                            <Trash2 size={16} />
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

      {/* 新建弹窗 */}
      <Modal
        open={createOpen}
        title="新建小说"
        onClose={() => setCreateOpen(false)}
        footer={
          <>
            <Button variant="secondary" onClick={() => setCreateOpen(false)} disabled={creating}>
              取消
            </Button>
            <Button variant="primary" type="submit" form="create-book-form" disabled={creating}>
              {creating ? '创建中…' : '创建'}
            </Button>
          </>
        }
      >
        <form id="create-book-form" onSubmit={(e) => void onCreate(e)} className="grid grid-cols-1 gap-4 sm:grid-cols-2" noValidate>
          <Field label="Slug(URL 标识)*">
            <Input value={form.slug} onChange={(e) => setForm({ ...form, slug: e.target.value })} placeholder="xing-hai-yu-jin" pattern="[a-z0-9-]*" />
          </Field>
          <Field label="书名*">
            <Input value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} placeholder="星海余烬" />
          </Field>
          <Field label="作者*">
            <Input value={form.authorName} onChange={(e) => setForm({ ...form, authorName: e.target.value })} />
          </Field>
          <Field label="分类*">
            <Input value={form.categoryName} onChange={(e) => setForm({ ...form, categoryName: e.target.value })} placeholder="科幻" />
          </Field>
          <Field label="标签(逗号分隔)">
            <Input value={form.tags} onChange={(e) => setForm({ ...form, tags: e.target.value })} placeholder="AI, 末世, 星际" />
          </Field>
          <Field label="封面路径">
            <Input value={form.coverPath} onChange={(e) => setForm({ ...form, coverPath: e.target.value })} placeholder="/media/cover.png" />
          </Field>
          <div className="sm:col-span-2">
            <Field label="简介">
              <Textarea value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} rows={3} />
            </Field>
          </div>
          {formError ? (
            <p role="alert" className="text-xs text-[#dc2626] sm:col-span-2">
              {formError}
            </p>
          ) : null}
        </form>
      </Modal>

      {/* 删除确认 */}
      <ConfirmDialog
        open={deleteTarget !== null}
        title="删除小说"
        description={`将永久删除《${deleteTarget?.title ?? ''}》及其全部章节与标签关联,且不可恢复。确认继续?`}
        loading={deleting}
        onCancel={() => setDeleteTarget(null)}
        onConfirm={() => void doDelete()}
      />
    </div>
  );
}
