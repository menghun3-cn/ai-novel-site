'use client';

// 媒体库:multipart 上传、网格预览、复制 URL、删除
// 上传约束由服务端把关:扩展名白名单/5MiB/重名 409,这里做就近错误提示

import { Check, Copy, ImageIcon, Trash2, Upload } from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { api } from '@/lib/admin-client';
import { Button, ConfirmDialog, EmptyState, Notice, Spinner } from '@/components/admin/ui';

interface MediaRow {
  name: string;
  size: number;
  url: string;
  uploadedAt: string;
}

function humanSize(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1024 / 1024).toFixed(2)} MB`;
}

export default function AdminMediaPage() {
  const [rows, setRows] = useState<MediaRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [copied, setCopied] = useState<string | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<MediaRow | null>(null);
  const [deleting, setDeleting] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const load = useCallback(async () => {
    try {
      setError(null);
      const res = await api<{ media: MediaRow[] }>('/api/admin/media');
      setRows(res.media);
    } catch (err) {
      setError(err instanceof Error ? err.message : '加载失败');
      setRows([]);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function upload(file: File): Promise<void> {
    setUploading(true);
    setError(null);
    setNotice(null);
    try {
      const form = new FormData();
      form.append('file', file);
      await api('/api/admin/media', { method: 'POST', body: form });
      setNotice(`「${file.name}」已上传`);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : '上传失败');
    } finally {
      setUploading(false);
      if (fileRef.current) fileRef.current.value = '';
    }
  }

  async function doDelete(): Promise<void> {
    if (!deleteTarget) return;
    setDeleting(true);
    try {
      await api(`/api/admin/media/${encodeURIComponent(deleteTarget.name)}`, { method: 'DELETE' });
      setNotice(`「${deleteTarget.name}」已删除(引用它的字段需自行更新)`);
      setDeleteTarget(null);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : '删除失败');
    } finally {
      setDeleting(false);
    }
  }

  async function copyUrl(m: MediaRow): Promise<void> {
    try {
      await navigator.clipboard.writeText(m.url);
      setCopied(m.name);
      window.setTimeout(() => setCopied(null), 1500);
    } catch {
      setError('复制失败:请手动选择地址复制');
    }
  }

  return (
    <div>
      {error ? <Notice tone="error">{error}</Notice> : null}
      {notice ? <Notice tone="success">{notice}</Notice> : null}

      {/* 上传 */}
      <div className="mb-4 rounded-xl bg-white p-4 shadow-sm">
        <input
          ref={fileRef}
          id="media-file"
          type="file"
          accept=".png,.jpg,.jpeg,.webp,.gif,.svg"
          className="sr-only"
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) void upload(f);
          }}
        />
        <label htmlFor="media-file">
          <span className="inline-flex h-10 cursor-pointer items-center gap-2 rounded-lg bg-[#1677ff] px-4 text-sm font-medium text-white transition-all duration-150 hover:-translate-y-px hover:bg-[#0f4ca8] hover:shadow-[0_4px_12px_rgba(22,119,255,0.3)] active:scale-[0.98]" role="button" aria-disabled={uploading}>
            {uploading ? <Spinner size={16} /> : <Upload size={16} aria-hidden />}
            {uploading ? '上传中…' : '上传图片'}
          </span>
        </label>
        <p className="mt-2 text-xs text-[#94a3b8]">支持 png/jpg/jpeg/webp/gif/svg,单文件不超过 5MB;重名会返回 409。</p>
      </div>

      {/* 网格 */}
      {rows === null ? (
        <div className="flex min-h-[200px] items-center justify-center gap-2 rounded-xl bg-white text-sm text-[#64748b] shadow-sm">
          <Spinner size={18} /> 加载中…
        </div>
      ) : rows.length === 0 ? (
        <div className="rounded-xl bg-white shadow-sm">
          <EmptyState icon={<ImageIcon size={32} />} title="媒体库为空" description="上传封面、头像或插图后,把 /media/… 地址填到小说封面与作者头像。" />
        </div>
      ) : (
        <ul role="list" className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          {rows.map((m) => (
            <li key={m.name} className="group overflow-hidden rounded-xl bg-white shadow-sm transition-all duration-300 hover:-translate-y-0.5 hover:shadow-md">
              <div className="flex h-36 items-center justify-center overflow-hidden bg-[#f8fafc]">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={m.url} alt={m.name} loading="lazy" className="max-h-full max-w-full object-contain" />
              </div>
              <div className="border-t border-[#f1f5f9] p-3">
                <div className="truncate text-xs font-medium text-[#334155]" title={m.name}>
                  {m.name}
                </div>
                <div className="mt-0.5 flex items-center justify-between text-[11px] text-[#94a3b8]">
                  <span>{humanSize(m.size)}</span>
                  <div className="flex items-center gap-1 transition-opacity duration-250 md:opacity-0 md:group-hover:opacity-100 md:focus-within:opacity-100">
                    <button aria-label={`复制 ${m.name} 地址`} onClick={() => void copyUrl(m)} className="flex h-7 w-7 items-center justify-center rounded-md text-[#64748b] transition-all duration-150 hover:-translate-y-px hover:bg-[#e8f3ff] hover:text-[#1677ff] hover:shadow-sm">
                      {copied === m.name ? <Check size={14} className="text-[#047857]" /> : <Copy size={14} />}
                    </button>
                    <button aria-label={`删除 ${m.name}`} onClick={() => setDeleteTarget(m)} className="flex h-7 w-7 items-center justify-center rounded-md text-[#64748b] transition-all duration-150 hover:-translate-y-px hover:bg-[#fee2e2] hover:text-[#b91c1c] hover:shadow-sm">
                      <Trash2 size={14} />
                    </button>
                  </div>
                </div>
              </div>
            </li>
          ))}
        </ul>
      )}

      <ConfirmDialog open={deleteTarget !== null} title="删除媒体" description={`确认删除「${deleteTarget?.name ?? ''}」?已把它用作封面/头像的字段不会自动更新。`} loading={deleting} onCancel={() => setDeleteTarget(null)} onConfirm={() => void doDelete()} />
    </div>
  );
}
