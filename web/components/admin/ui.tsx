'use client';

// 管理后台 UI 基础组件:严格遵循 LSG 企业级后台精确规格(尺寸/色值/状态/动效)

import { X } from 'lucide-react';
import { useEffect, type ButtonHTMLAttributes, type InputHTMLAttributes, type ReactNode, type SelectHTMLAttributes, type TextareaHTMLAttributes } from 'react';

// ---------- 按钮 ----------

type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger';

const BTN_BASE =
  'inline-flex items-center justify-center gap-1.5 font-medium transition-all duration-150 select-none disabled:cursor-not-allowed disabled:opacity-60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#1677ff]/40';
const BTN_SIZE: Record<'xs' | 'sm' | 'md' | 'lg', string> = {
  xs: 'h-7 px-2 text-xs rounded-md',
  sm: 'h-8 px-3 text-xs rounded-md',
  md: 'h-10 px-4 text-sm rounded-lg',
  lg: 'h-12 px-6 text-base rounded-lg',
};
const BTN_VARIANT: Record<ButtonVariant, string> = {
  primary:
    'bg-[#1677ff] text-white hover:bg-[#0f4ca8] hover:-translate-y-px hover:shadow-[0_4px_12px_rgba(22,119,255,0.3)] active:bg-[#0a3a82] active:scale-[0.98] disabled:hover:translate-y-0 disabled:hover:shadow-none',
  secondary: 'bg-white text-[#334155] border border-[#e2e8f0] hover:bg-[#f8fafc] hover:border-[#cbd5e1] active:scale-[0.98]',
  ghost: 'text-[#475569] hover:bg-[#f1f5f9] hover:text-[#0f172a]',
  danger: 'bg-[#dc2626] text-white hover:bg-[#b91c1c] hover:-translate-y-px active:scale-[0.98]',
};

export function Button({
  variant = 'secondary',
  size = 'md',
  className = '',
  children,
  ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: ButtonVariant; size?: keyof typeof BTN_SIZE }) {
  return (
    <button className={`${BTN_BASE} ${BTN_VARIANT[variant]} ${BTN_SIZE[size]} ${className}`} {...rest}>
      {children}
    </button>
  );
}

// ---------- 表单控件 ----------

const FIELD_BASE =
  'w-full bg-white border border-[#e2e8f0] rounded-lg text-sm text-[#0f172a] placeholder:text-[#94a3b8] transition-shadow duration-150 focus:border-[#1677ff] focus:shadow-[0_0_0_3px_rgba(22,119,255,0.15),0_0_0_1px_rgba(22,119,255,0.5)] focus:outline-none disabled:bg-[#f1f5f9] disabled:text-[#94a3b8] disabled:cursor-not-allowed';

export function Input({ className = '', ...rest }: InputHTMLAttributes<HTMLInputElement>) {
  return <input className={`h-10 px-3 ${FIELD_BASE} ${className}`} {...rest} />;
}

export function Textarea({ className = '', ...rest }: TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return <textarea className={`min-h-20 max-h-[400px] py-2 px-3 resize-y ${FIELD_BASE} ${className}`} {...rest} />;
}

export function Select({ className = '', ...rest }: SelectHTMLAttributes<HTMLSelectElement>) {
  return <select className={`h-10 px-3 ${FIELD_BASE} ${className}`} {...rest} />;
}

/** 表单字段:可见 label + 就近错误 */
export function Field({ label, error, children }: { label: string; error?: string | null; children: ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1.5 block text-sm font-medium text-[#334155]">{label}</span>
      {children}
      {error ? <span className="mt-1 block text-xs text-[#dc2626]">{error}</span> : null}
    </label>
  );
}

// ---------- 徽章 ----------

type BadgeTone = 'success' | 'warning' | 'danger' | 'info' | 'running';
const BADGE_TONE: Record<BadgeTone, string> = {
  success: 'bg-[#d1fae5] text-[#047857]',
  warning: 'bg-[#fef3c7] text-[#b45309]',
  danger: 'bg-[#fee2e2] text-[#b91c1c]',
  info: 'bg-[#f1f5f9] text-[#334155]',
  running: 'bg-[#dbeafe] text-[#0f4ca8]',
};

export function Badge({ tone, children }: { tone: BadgeTone; children: ReactNode }) {
  return (
    <span className={`inline-flex h-5 items-center rounded-full px-2.5 text-[11px] font-medium leading-none ${BADGE_TONE[tone]}`}>
      {children}
    </span>
  );
}

export const BOOK_STATUS_BADGE: Record<string, { tone: BadgeTone; label: string }> = {
  serializing: { tone: 'running', label: '连载中' },
  completed: { tone: 'success', label: '已完结' },
  hidden: { tone: 'danger', label: '已隐藏' },
};
export const CHAPTER_STATUS_BADGE: Record<string, { tone: BadgeTone; label: string }> = {
  draft: { tone: 'info', label: '草稿' },
  scheduled: { tone: 'warning', label: '定时' },
  published: { tone: 'success', label: '已发布' },
  hidden: { tone: 'danger', label: '已下线' },
};

// ---------- 弹窗 ----------

export function Modal({
  open,
  title,
  onClose,
  children,
  footer,
}: {
  open: boolean;
  title: string;
  onClose: () => void;
  children: ReactNode;
  footer?: ReactNode;
}) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  if (!open) return null;
  return (
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center bg-black/50 p-4 backdrop-blur-[2px] motion-reduce:backdrop-blur-none"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className="flex max-h-[85vh] w-full max-w-lg flex-col overflow-hidden rounded-2xl bg-white shadow-xl"
        style={{ animation: 'modalIn .2s cubic-bezier(0.25,0.1,0.25,1)' }}
      >
        <div className="flex h-16 shrink-0 items-center justify-between border-b border-[#e2e8f0] px-6">
          <h2 className="text-lg font-semibold text-[#0f172a]">{title}</h2>
          <button
            aria-label="关闭"
            onClick={onClose}
            className="flex h-8 w-8 items-center justify-center rounded-lg text-[#94a3b8] transition-colors duration-150 hover:bg-[#f1f5f9] hover:text-[#334155]"
          >
            <X size={18} />
          </button>
        </div>
        <div className="overflow-y-auto px-6 py-5">{children}</div>
        {footer ? <div className="flex shrink-0 items-center justify-end gap-3 border-t border-[#e2e8f0] px-6 py-4">{footer}</div> : null}
      </div>
      <style>{`@keyframes modalIn{from{opacity:0;transform:translateY(10px) scale(.95)}to{opacity:1;transform:translateY(0) scale(1)}}@media(prefers-reduced-motion:reduce){*{animation:none!important}}`}</style>
    </div>
  );
}

/** 危险操作确认对话框(420px) */
export function ConfirmDialog({
  open,
  title,
  description,
  confirmText = '确认删除',
  loading = false,
  onConfirm,
  onCancel,
}: {
  open: boolean;
  title: string;
  description: string;
  confirmText?: string;
  loading?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  return (
    <Modal
      open={open}
      title={title}
      onClose={onCancel}
      footer={
        <>
          <Button variant="secondary" onClick={onCancel} disabled={loading}>
            取消
          </Button>
          <Button variant="danger" onClick={onConfirm} disabled={loading}>
            {loading ? '处理中…' : confirmText}
          </Button>
        </>
      }
    >
      <p className="text-sm leading-relaxed text-[#64748b]">{description}</p>
    </Modal>
  );
}

// ---------- 空状态 ----------

export function EmptyState({ icon, title, description, action }: { icon: ReactNode; title: string; description: string; action?: ReactNode }) {
  return (
    <div className="flex min-h-[200px] flex-col items-center justify-center px-6 py-10 text-center">
      <div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-gradient-to-br from-[#f1f5f9] to-[#e2e8f0] text-[#94a3b8]">{icon}</div>
      <h3 className="mt-3 text-base font-medium text-[#0f172a]">{title}</h3>
      <p className="mt-1 max-w-sm text-sm text-[#64748b]">{description}</p>
      {action ? <div className="mt-4">{action}</div> : null}
    </div>
  );
}

// ---------- 页面级反馈条 ----------

export function Notice({ tone, children }: { tone: 'error' | 'success'; children: ReactNode }) {
  const cls =
    tone === 'error'
      ? 'border-[#fecaca] bg-[#fef2f2] text-[#b91c1c]'
      : 'border-[#a7f3d0] bg-[#ecfdf5] text-[#047857]';
  return (
    <div role={tone === 'error' ? 'alert' : 'status'} className={`mb-4 rounded-lg border px-4 py-2.5 text-sm ${cls}`}>
      {children}
    </div>
  );
}

export function Spinner({ size = 16 }: { size?: number }): ReactNode {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" className="animate-spin" aria-hidden>
      <circle cx="12" cy="12" r="10" stroke="currentColor" strokeOpacity="0.25" strokeWidth="3" />
      <path d="M22 12a10 10 0 0 0-10-10" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
    </svg>
  );
}
