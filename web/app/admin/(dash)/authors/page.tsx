'use client';

// 作者管理:列表(作品数)、新建/编辑弹窗、删除守卫(AUTHOR_IN_USE 409 就近提示)

import { Pencil, Plus, Trash2, Users } from 'lucide-react';
import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { api } from '@/lib/admin-client';
import { Button, ConfirmDialog, EmptyState, Field, Input, Modal, Notice, Spinner, Textarea } from '@/components/admin/ui';

interface AuthorRow {
  id: number;
  name: string;
  bio: string | null;
  avatarPath: string | null;
  bookCount: number;
}

export default function AdminAuthorsPage() {
  const [rows, setRows] = useState<AuthorRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const [modal, setModal] = useState<null | { mode: 'create' } | { mode: 'edit'; author: AuthorRow }>(null);
  const [form, setForm] = useState({ name: '', bio: '', avatarPath: '' });
  const [formError, setFormError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const [deleteTarget, setDeleteTarget] = useState<AuthorRow | null>(null);
  const [deleting, setDeleting] = useState(false);

  const load = useCallback(async () => {
    try {
      setError(null);
      const res = await api<{ authors: AuthorRow[] }>('/api/admin/authors');
      setRows(res.authors);
    } catch (err) {
      setError(err instanceof Error ? err.message : '加载失败');
      setRows([]);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  function openCreate(): void {
    setForm({ name: '', bio: '', avatarPath: '' });
    setFormError(null);
    setModal({ mode: 'create' });
  }

  function openEdit(a: AuthorRow): void {
    setForm({ name: a.name, bio: a.bio ?? '', avatarPath: a.avatarPath ?? '' });
    setFormError(null);
    setModal({ mode: 'edit', author: a });
  }

  async function save(e: FormEvent): Promise<void> {
    e.preventDefault();
    if (!form.name.trim() || saving) return;
    setSaving(true);
    setFormError(null);
    try {
      if (modal?.mode === 'edit') {
        await api(`/api/admin/authors/${modal.author.id}`, {
          method: 'PATCH',
          body: JSON.stringify({ name: form.name.trim(), bio: form.bio || null, avatarPath: form.avatarPath || null }),
        });
        setNotice(`作者「${form.name.trim()}」已更新`);
      } else {
        await api('/api/admin/authors', {
          method: 'POST',
          body: JSON.stringify({ name: form.name.trim(), bio: form.bio || null, avatarPath: form.avatarPath || null }),
        });
        setNotice(`作者「${form.name.trim()}」已创建`);
      }
      setModal(null);
      await load();
    } catch (err) {
      setFormError(err instanceof Error ? err.message : '保存失败');
    } finally {
      setSaving(false);
    }
  }

  async function doDelete(): Promise<void> {
    if (!deleteTarget) return;
    setDeleting(true);
    try {
      await api(`/api/admin/authors/${deleteTarget.id}`, { method: 'DELETE' });
      setNotice(`作者「${deleteTarget.name}」已删除`);
      setDeleteTarget(null);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : '删除失败:请先转移或删除其作品');
    } finally {
      setDeleting(false);
    }
  }

  return (
    <div>
      {error ? <Notice tone="error">{error}</Notice> : null}
      {notice ? <Notice tone="success">{notice}</Notice> : null}

      <div className="mb-4 flex items-center gap-2">
        <Button variant="primary" size="md" onClick={openCreate}>
          <Plus size={16} /> 新建作者
        </Button>
      </div>

      <div className="overflow-hidden rounded-xl bg-white shadow-sm">
        {rows === null ? (
          <div className="flex min-h-[200px] items-center justify-center gap-2 text-sm text-[#64748b]">
            <Spinner size={18} /> 加载中…
          </div>
        ) : rows.length === 0 ? (
          <EmptyState icon={<Users size={32} />} title="还没有作者" description="创建作者档案后即可在小说中引用。" action={<Button variant="primary" onClick={openCreate}><Plus size={16} /> 新建作者</Button>} />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[680px] border-collapse text-left">
              <thead>
                <tr className="h-12 bg-[#f8fafc] text-[13px] font-semibold text-[#334155]">
                  <th className="border-b border-[#e2e8f0] px-4 font-semibold">作者</th>
                  <th className="border-b border-[#e2e8f0] px-4 font-semibold">简介</th>
                  <th className="border-b border-[#e2e8f0] px-4 font-semibold">作品数</th>
                  <th className="border-b border-[#e2e8f0] px-4 text-right font-semibold">操作</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((a) => (
                  <tr key={a.id} className="group h-14 transition-all duration-200 hover:bg-[#f8fafc]">
                    <td className="border-b border-[#f1f5f9] px-4 align-middle">
                      <div className="flex items-center gap-3">
                        <span className="flex h-9 w-9 shrink-0 items-center justify-center overflow-hidden rounded-full bg-gradient-to-br from-[#2d7fff] to-[#1f5eea] text-xs font-medium text-white" aria-hidden>
                          {a.avatarPath ? (
                            // eslint-disable-next-line @next/next/no-img-element
                            <img src={a.avatarPath} alt="" className="h-full w-full object-cover" />
                          ) : (
                            a.name.slice(0, 1)
                          )}
                        </span>
                        <span className="text-sm font-medium text-[#334155]">{a.name}</span>
                      </div>
                    </td>
                    <td className="max-w-[360px] border-b border-[#f1f5f9] px-4 align-middle">
                      <p className="line-clamp-2 text-xs leading-relaxed text-[#64748b]">{a.bio || '—'}</p>
                    </td>
                    <td className="border-b border-[#f1f5f9] px-4 align-middle text-sm text-[#334155]">{a.bookCount}</td>
                    <td className="border-b border-[#f1f5f9] px-4 align-middle">
                      <div className="flex items-center justify-end gap-1 transition-opacity duration-250 md:opacity-0 md:group-hover:opacity-100 md:focus-within:opacity-100">
                        <button aria-label={`编辑作者 ${a.name}`} onClick={() => openEdit(a)} className="flex h-7 w-7 items-center justify-center rounded-md text-[#64748b] transition-all duration-150 hover:-translate-y-px hover:bg-[#e8f3ff] hover:text-[#1677ff] hover:shadow-sm">
                          <Pencil size={16} />
                        </button>
                        <button aria-label={`删除作者 ${a.name}`} onClick={() => setDeleteTarget(a)} disabled={a.bookCount > 0} title={a.bookCount > 0 ? `仍有 ${a.bookCount} 部作品,需先转移或删除` : undefined} className="flex h-7 w-7 items-center justify-center rounded-md text-[#64748b] transition-all duration-150 hover:-translate-y-px hover:bg-[#fee2e2] hover:text-[#b91c1c] hover:shadow-sm disabled:pointer-events-none disabled:opacity-30">
                          <Trash2 size={16} />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <Modal
        open={modal !== null}
        title={modal?.mode === 'edit' ? '编辑作者' : '新建作者'}
        onClose={() => setModal(null)}
        footer={
          <>
            <Button variant="secondary" onClick={() => setModal(null)} disabled={saving}>
              取消
            </Button>
            <Button variant="primary" type="submit" form="author-form" disabled={saving}>
              {saving ? '保存中…' : '保存'}
            </Button>
          </>
        }
      >
        <form id="author-form" onSubmit={(e) => void save(e)} className="grid grid-cols-1 gap-4" noValidate>
          <Field label="笔名*">
            <Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
          </Field>
          <Field label="头像路径">
            <Input value={form.avatarPath} onChange={(e) => setForm({ ...form, avatarPath: e.target.value })} placeholder="/media/avatar.png(可在媒体库上传后复制)" />
          </Field>
          <Field label="简介">
            <Textarea rows={3} value={form.bio} onChange={(e) => setForm({ ...form, bio: e.target.value })} />
          </Field>
          {formError ? (
            <p role="alert" className="text-xs text-[#dc2626]">
              {formError}
            </p>
          ) : null}
        </form>
      </Modal>

      <ConfirmDialog
        open={deleteTarget !== null}
        title="删除作者"
        description={`确认删除作者「${deleteTarget?.name ?? ''}」?仅当其名下没有作品时可删除。`}
        loading={deleting}
        onCancel={() => setDeleteTarget(null)}
        onConfirm={() => void doDelete()}
      />
    </div>
  );
}
