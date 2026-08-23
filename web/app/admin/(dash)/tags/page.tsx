'use client';

// 标签管理:新建、重命名、删除(删除会同时清理书籍关联)

import { Pencil, Plus, Tags as TagsIcon, Trash2 } from 'lucide-react';
import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { api } from '@/lib/admin-client';
import { Button, ConfirmDialog, EmptyState, Field, Input, Modal, Notice, Spinner } from '@/components/admin/ui';

interface TagRow {
  id: number;
  slug: string;
  name: string;
}

export default function AdminTagsPage() {
  const [rows, setRows] = useState<TagRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [newName, setNewName] = useState('');
  const [busy, setBusy] = useState(false);

  const [renameTarget, setRenameTarget] = useState<TagRow | null>(null);
  const [renameValue, setRenameValue] = useState('');
  const [renameError, setRenameError] = useState<string | null>(null);
  const [renaming, setRenaming] = useState(false);

  const [deleteTarget, setDeleteTarget] = useState<TagRow | null>(null);
  const [deleting, setDeleting] = useState(false);

  const load = useCallback(async () => {
    try {
      setError(null);
      const res = await api<{ tags: TagRow[] }>('/api/admin/tags');
      setRows(res.tags);
    } catch (err) {
      setError(err instanceof Error ? err.message : '加载失败');
      setRows([]);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function create(e: FormEvent): Promise<void> {
    e.preventDefault();
    if (!newName.trim() || busy) return;
    setBusy(true);
    setError(null);
    try {
      await api('/api/admin/tags', { method: 'POST', body: JSON.stringify({ name: newName.trim() }) });
      setNotice(`标签「${newName.trim()}」已创建`);
      setNewName('');
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : '创建失败');
    } finally {
      setBusy(false);
    }
  }

  async function rename(e: FormEvent): Promise<void> {
    e.preventDefault();
    if (!renameTarget || !renameValue.trim() || renaming) return;
    setRenaming(true);
    setRenameError(null);
    try {
      await api(`/api/admin/tags/${renameTarget.id}`, { method: 'PATCH', body: JSON.stringify({ name: renameValue.trim() }) });
      setNotice('标签已重命名(slug 保持不变)');
      setRenameTarget(null);
      await load();
    } catch (err) {
      setRenameError(err instanceof Error ? err.message : '重命名失败');
    } finally {
      setRenaming(false);
    }
  }

  async function doDelete(): Promise<void> {
    if (!deleteTarget) return;
    setDeleting(true);
    try {
      await api(`/api/admin/tags/${deleteTarget.id}`, { method: 'DELETE' });
      setNotice(`标签「${deleteTarget.name}」已删除并清理关联`);
      setDeleteTarget(null);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : '删除失败');
    } finally {
      setDeleting(false);
    }
  }

  return (
    <div>
      {error ? <Notice tone="error">{error}</Notice> : null}
      {notice ? <Notice tone="success">{notice}</Notice> : null}

      <form onSubmit={(e) => void create(e)} className="mb-4 flex flex-wrap items-end gap-2 rounded-xl bg-white p-4 shadow-sm">
        <Field label="新建标签">
          <Input value={newName} onChange={(e) => setNewName(e.target.value)} placeholder="如:AI / 末世 / 星际 / 穿越" className="w-64" />
        </Field>
        <Button variant="primary" type="submit" disabled={!newName.trim() || busy}>
          <Plus size={16} /> 添加
        </Button>
        <p className="ml-auto self-center text-xs text-[#94a3b8]">删除标签会同步移除所有书籍上的该标签</p>
      </form>

      <div className="overflow-hidden rounded-xl bg-white shadow-sm">
        {rows === null ? (
          <div className="flex min-h-[160px] items-center justify-center gap-2 text-sm text-[#64748b]">
            <Spinner size={18} /> 加载中…
          </div>
        ) : rows.length === 0 ? (
          <EmptyState icon={<TagsIcon size={32} />} title="还没有标签" description="在上方输入名称创建第一个标签。" />
        ) : (
          <ul role="list" className="divide-y divide-[#f1f5f9]">
            {rows.map((t) => (
              <li key={t.id} className="group flex h-14 items-center gap-3 px-4 transition-colors duration-200 hover:bg-[#f8fafc]">
                <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-gradient-to-br from-[#8b5cf6] to-[#6d28d9] text-white" aria-hidden>
                  <TagsIcon size={16} />
                </span>
                <div className="min-w-0">
                  <div className="text-sm font-medium text-[#334155]">{t.name}</div>
                  <div className="text-xs text-[#94a3b8]">/{t.slug}</div>
                </div>
                <div className="ml-auto flex items-center gap-1 transition-opacity duration-250 md:opacity-0 md:group-hover:opacity-100 md:focus-within:opacity-100">
                  <button
                    aria-label={`重命名标签 ${t.name}`}
                    onClick={() => {
                      setRenameTarget(t);
                      setRenameValue(t.name);
                      setRenameError(null);
                    }}
                    className="flex h-7 w-7 items-center justify-center rounded-md text-[#64748b] transition-all duration-150 hover:-translate-y-px hover:bg-[#e8f3ff] hover:text-[#1677ff] hover:shadow-sm"
                  >
                    <Pencil size={16} />
                  </button>
                  <button aria-label={`删除标签 ${t.name}`} onClick={() => setDeleteTarget(t)} className="flex h-7 w-7 items-center justify-center rounded-md text-[#64748b] transition-all duration-150 hover:-translate-y-px hover:bg-[#fee2e2] hover:text-[#b91c1c] hover:shadow-sm">
                    <Trash2 size={16} />
                  </button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>

      <Modal
        open={renameTarget !== null}
        title="重命名标签"
        onClose={() => setRenameTarget(null)}
        footer={
          <>
            <Button variant="secondary" onClick={() => setRenameTarget(null)} disabled={renaming}>
              取消
            </Button>
            <Button variant="primary" type="submit" form="rename-tag-form" disabled={renaming}>
              {renaming ? '保存中…' : '保存'}
            </Button>
          </>
        }
      >
        <form id="rename-tag-form" onSubmit={(e) => void rename(e)} noValidate>
          <Field label="新名称*" error={renameError}>
            <Input value={renameValue} onChange={(e) => setRenameValue(e.target.value)} autoFocus />
          </Field>
        </form>
      </Modal>

      <ConfirmDialog open={deleteTarget !== null} title="删除标签" description={`确认删除标签「${deleteTarget?.name ?? ''}」?所有书籍上的这个标签都会被移除。`} loading={deleting} onCancel={() => setDeleteTarget(null)} onConfirm={() => void doDelete()} />
    </div>
  );
}
