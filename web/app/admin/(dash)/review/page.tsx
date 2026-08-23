'use client';

// 审核队列:全库 pending_review 章节,FIFO 排列
// 操作:批准-立即 / 批准-定时(弹窗) / 驳回(弹窗备注);动作后派发 admin:review-changed 刷新侧栏角标

import { Check, FileCheck, CalendarClock, X } from 'lucide-react';
import Link from 'next/link';
import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { api } from '@/lib/admin-client';
import { Button, EmptyState, Field, Input, Modal, Notice, Spinner, Textarea } from '@/components/admin/ui';

interface QueueItem {
  bookId: string;
  bookSlug: string;
  bookTitle: string;
  chapter: {
    id: string;
    number: number;
    title: string;
    updatedAt: string;
  };
}

function fmt(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleString('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' });
}

export default function AdminReviewPage() {
  const [items, setItems] = useState<QueueItem[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busyKey, setBusyKey] = useState<string | null>(null);

  // 定时批准弹窗
  const [scheduleTarget, setScheduleTarget] = useState<QueueItem | null>(null);
  const [scheduleAt, setScheduleAt] = useState('');
  const [scheduling, setScheduling] = useState(false);

  // 驳回弹窗
  const [rejectTarget, setRejectTarget] = useState<QueueItem | null>(null);
  const [rejectNote, setRejectNote] = useState('');
  const [rejecting, setRejecting] = useState(false);

  const load = useCallback(async () => {
    try {
      setError(null);
      const res = await api<{ items: QueueItem[] }>('/api/admin/review-queue?limit=500');
      setItems(res.items);
    } catch (err) {
      setError(err instanceof Error ? err.message : '加载失败');
      setItems([]);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  function notify(msg: string): void {
    setNotice(msg);
    window.dispatchEvent(new Event('admin:review-changed'));
  }

  async function act(item: QueueItem, payload: Record<string, unknown>, okMsg: string): Promise<void> {
    const key = `${item.bookId}#${item.chapter.number}`;
    setBusyKey(key);
    setError(null);
    try {
      await api(`/api/admin/books/${item.bookId}/chapters/${item.chapter.number}/review`, {
        method: 'POST',
        body: JSON.stringify(payload),
      });
      notify(okMsg);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : '操作失败');
    } finally {
      setBusyKey(null);
    }
  }

  async function doSchedule(e: FormEvent): Promise<void> {
    e.preventDefault();
    if (!scheduleTarget || !scheduleAt || scheduling) return;
    setScheduling(true);
    try {
      await api(`/api/admin/books/${scheduleTarget.bookId}/chapters/${scheduleTarget.chapter.number}/review`, {
        method: 'POST',
        body: JSON.stringify({ action: 'approve', mode: 'scheduled', scheduledAt: new Date(scheduleAt).toISOString() }),
      });
      notify(`第 ${scheduleTarget.chapter.number} 章已定时发布`);
      setScheduleTarget(null);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : '定时失败');
    } finally {
      setScheduling(false);
    }
  }

  async function doReject(e: FormEvent): Promise<void> {
    e.preventDefault();
    if (!rejectTarget || rejecting) return;
    setRejecting(true);
    try {
      await api(`/api/admin/books/${rejectTarget.bookId}/chapters/${rejectTarget.chapter.number}/review`, {
        method: 'POST',
        body: JSON.stringify({ action: 'reject', note: rejectNote.trim() || null }),
      });
      notify(`第 ${rejectTarget.chapter.number} 章已驳回`);
      setRejectTarget(null);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : '驳回失败');
    } finally {
      setRejecting(false);
    }
  }

  return (
    <div>
      {error ? <Notice tone="error">{error}</Notice> : null}
      {notice ? <Notice tone="success">{notice}</Notice> : null}

      {/* 页面头部概览 */}
      <div className="mb-5 rounded-xl bg-white p-5 shadow-sm transition-shadow duration-200 hover:shadow-md">
        <div className="flex items-center gap-4">
          <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl text-white" style={{ background: 'linear-gradient(135deg,#8b5cf6,#6d28d9)' }}>
            <FileCheck size={24} aria-hidden />
          </span>
          <div>
            <h1 className="text-xl font-semibold text-[#0f172a]">审核队列</h1>
            <p className="mt-1 text-sm text-[#64748b]">
              待审核 <b className="font-semibold text-[#1677ff]">{items?.length ?? '…'}</b> 章 · 按提交先后排列
            </p>
          </div>
        </div>
      </div>

      {/* 队列表格 */}
      <div className="overflow-hidden rounded-xl bg-white shadow-sm">
        {items === null ? (
          <div className="flex min-h-[200px] items-center justify-center gap-2 text-sm text-[#64748b]">
            <Spinner size={18} /> 加载中…
          </div>
        ) : items.length === 0 ? (
          <EmptyState
            icon={<FileCheck size={32} />}
            title="队列已清空"
            description="没有待审核的章节。在书籍详情页对草稿章节点「送审」,它们会出现在这里。"
          />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[760px] border-collapse text-left">
              <thead>
                <tr className="h-12 bg-[#f8fafc] text-[13px] font-semibold text-[#334155]">
                  <th className="border-b border-[#e2e8f0] px-4 font-semibold">书籍 / 章节</th>
                  <th className="border-b border-[#e2e8f0] px-4 font-semibold">提交时间</th>
                  <th className="border-b border-[#e2e8f0] px-4 font-semibold">状态</th>
                  <th className="border-b border-[#e2e8f0] px-4 text-right font-semibold">操作</th>
                </tr>
              </thead>
              <tbody>
                {items.map((it) => {
                  const key = `${it.bookId}#${it.chapter.number}`;
                  return (
                    <tr key={key} className="group h-14 transition-all duration-200 hover:bg-[#f8fafc]">
                      <td className="border-b border-[#f1f5f9] px-4 align-middle">
                        <Link href={`/admin/books/${it.bookId}`} className="text-sm font-medium text-[#1677ff] hover:underline">
                          {it.bookTitle}
                        </Link>
                        <span className="mx-1.5 text-[#cbd5e1]">·</span>
                        <span className="text-sm text-[#334155]">{it.chapter.title}</span>
                      </td>
                      <td className="border-b border-[#f1f5f9] px-4 align-middle text-xs text-[#64748b]">{fmt(it.chapter.updatedAt)}</td>
                      <td className="border-b border-[#f1f5f9] px-4 align-middle">
                        <span className="inline-flex h-5 items-center rounded-full bg-[#dbeafe] px-2.5 text-[11px] font-medium leading-none text-[#0f4ca8]">待审核</span>
                      </td>
                      <td className="border-b border-[#f1f5f9] px-4 align-middle">
                        <div className="flex items-center justify-end gap-2 transition-opacity duration-250 md:opacity-0 md:group-hover:opacity-100 md:focus-within:opacity-100">
                          <Button
                            variant="primary"
                            size="xs"
                            disabled={busyKey === key}
                            onClick={() => void act(it, { action: 'approve', mode: 'now' }, `第 ${it.chapter.number} 章已发布`)}
                          >
                            <Check size={13} /> 批准·立即发布
                          </Button>
                          <Button
                            variant="secondary"
                            size="xs"
                            disabled={busyKey === key}
                            onClick={() => {
                              setScheduleTarget(it);
                              const d = new Date(Date.now() + 3600_000);
                              d.setMinutes(0, 0, 0);
                              setScheduleAt(new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 16));
                            }}
                          >
                            <CalendarClock size={13} /> 定时
                          </Button>
                          <button
                            aria-label={`驳回第${it.chapter.number}章`}
                            onClick={() => {
                              setRejectTarget(it);
                              setRejectNote('');
                            }}
                            disabled={busyKey === key}
                            className="flex h-7 w-7 items-center justify-center rounded-md text-[#64748b] transition-all duration-150 hover:-translate-y-px hover:bg-[#fee2e2] hover:text-[#b91c1c] hover:shadow-sm disabled:pointer-events-none disabled:opacity-30"
                          >
                            <X size={15} />
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

      {/* 定时批准弹窗 */}
      <Modal
        open={scheduleTarget !== null}
        title={`定时发布 — 第 ${scheduleTarget?.chapter.number ?? ''} 章`}
        onClose={() => setScheduleTarget(null)}
        footer={
          <>
            <Button variant="secondary" onClick={() => setScheduleTarget(null)} disabled={scheduling}>
              取消
            </Button>
            <Button variant="primary" type="submit" form="schedule-form" disabled={scheduling}>
              {scheduling ? '处理中…' : '确认定时'}
            </Button>
          </>
        }
      >
        <form id="schedule-form" onSubmit={(e) => void doSchedule(e)} noValidate>
          <Field label="发布时间*" error={scheduleTarget && !scheduleAt ? '选择将来自动发布的时刻' : null}>
            <Input type="datetime-local" value={scheduleAt} onChange={(e) => setScheduleAt(e.target.value)} autoFocus />
          </Field>
          <p className="mt-3 text-xs leading-relaxed text-[#94a3b8]">到时由调度器自动发布;也可在「发布」手动触发周期。</p>
        </form>
      </Modal>

      {/* 驳回弹窗 */}
      <Modal
        open={rejectTarget !== null}
        title={`驳回 — 第 ${rejectTarget?.chapter.number ?? ''} 章`}
        onClose={() => setRejectTarget(null)}
        footer={
          <>
            <Button variant="secondary" onClick={() => setRejectTarget(null)} disabled={rejecting}>
              取消
            </Button>
            <Button variant="danger" type="submit" form="reject-form" disabled={rejecting}>
              {rejecting ? '处理中…' : '确认驳回'}
            </Button>
          </>
        }
      >
        <form id="reject-form" onSubmit={(e) => void doReject(e)} noValidate>
          <Field label="驳回原因(作者可见)">
            <Textarea rows={3} value={rejectNote} onChange={(e) => setRejectNote(e.target.value)} placeholder="如:节奏拖沓,请压缩到三千字以内" />
          </Field>
        </form>
      </Modal>
    </div>
  );
}
