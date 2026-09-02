'use client';

// 管理后台 UI 基础组件:严格遵循 LSG 企业级后台精确规格(尺寸/色值/状态/动效)

import { ChevronDown, X } from 'lucide-react';
import {
  useEffect,
  useRef,
  useState,
  type ButtonHTMLAttributes,
  type InputHTMLAttributes,
  type ReactNode,
  type SelectHTMLAttributes,
  type TextareaHTMLAttributes,
} from 'react';

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
  pending_review: { tone: 'warning', label: '待审核' },
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

// ---------- Toast(自动消失的轻提示) ----------

/**
 * 固定右上角的轻提示:默认 3.2s 自动消失,可手动关闭。
 * 用法:父组件持有一个消息 state,渲染 <Toast> 并 key=消息值(新消息会重新挂载、重置计时)。
 */
export function Toast({
  tone,
  children,
  onClose,
  duration = 3200,
}: {
  tone: 'error' | 'success';
  children: ReactNode;
  onClose: () => void;
  duration?: number;
}) {
  useEffect(() => {
    const t = window.setTimeout(onClose, duration);
    return () => window.clearTimeout(t);
  }, [onClose, duration]);
  const cls =
    tone === 'error'
      ? 'border-[#fecaca] bg-[#fef2f2] text-[#b91c1c]'
      : 'border-[#a7f3d0] bg-[#ecfdf5] text-[#047857]';
  return (
    <div
      role={tone === 'error' ? 'alert' : 'status'}
      className={`pointer-events-auto fixed right-4 top-4 z-[120] flex max-w-sm items-start gap-2 rounded-lg border px-4 py-2.5 text-sm shadow-lg ${cls}`}
      style={{ animation: 'toastIn .25s cubic-bezier(0.25,0.1,0.25,1)' }}
    >
      <span className="min-w-0 flex-1 break-words">{children}</span>
      <button
        aria-label="关闭提示"
        onClick={onClose}
        className="mt-0.5 shrink-0 rounded p-0.5 opacity-60 transition hover:bg-black/5 hover:opacity-100"
      >
        <X size={14} />
      </button>
      <style>{`@keyframes toastIn{from{opacity:0;transform:translateY(-8px) scale(.96)}to{opacity:1;transform:translateY(0) scale(1)}}@media(prefers-reduced-motion:reduce){*{animation:none!important}}`}</style>
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

// ---------- 分段标签(Tabs) ----------

export interface TabItem<K extends string> {
  key: K;
  label: string;
}

/** 轻量分段控件(V9 创作中心/评审中心一级·二级导航用) */
export function Tabs<K extends string>({
  tabs,
  value,
  onChange,
}: {
  tabs: Array<TabItem<K>>;
  value: K;
  onChange: (key: K) => void;
}) {
  return (
    <div className="inline-flex items-center gap-1 rounded-lg bg-[#f1f5f9] p-1" role="tablist">
      {tabs.map((t) => (
        <button
          key={t.key}
          type="button"
          role="tab"
          aria-selected={value === t.key}
          onClick={() => onChange(t.key)}
          className={`h-8 rounded-md px-4 text-sm font-medium transition-all duration-150 ${
            value === t.key ? 'bg-white text-[#1677ff] shadow-sm' : 'text-[#64748b] hover:text-[#0f172a]'
          }`}
        >
          {t.label}
        </button>
      ))}
    </div>
  );
}

// ---------- 右侧抽屉(Drawer) ----------

/**
 * 右侧滑出抽屉:用于"列表 → 详情"的次级工作面板(如创作中心作品详情)。
 * 宽度 4/5 屏(上限 720px),Esc/点遮罩/关闭按钮三种关闭方式。
 */
export function Drawer({
  open,
  title,
  onClose,
  children,
  footer,
  headerExtra,
}: {
  open: boolean;
  title: string;
  onClose: () => void;
  children: ReactNode;
  footer?: ReactNode;
  /** 头部右侧的附加内容(状态徽章、主 CTA 等) */
  headerExtra?: ReactNode;
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
      className="fixed inset-0 z-[100] flex justify-end bg-black/50 motion-reduce:backdrop-blur-none"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className="flex h-full w-full max-w-[720px] flex-col bg-[#f8fafc] shadow-2xl"
        style={{ animation: 'drawerIn .22s cubic-bezier(0.25,0.1,0.25,1)' }}
      >
        <div className="flex h-16 shrink-0 items-center justify-between gap-3 border-b border-[#e2e8f0] bg-white px-5">
          <h2 className="min-w-0 truncate text-base font-semibold text-[#0f172a]">{title}</h2>
          <div className="flex shrink-0 items-center gap-3">
            {headerExtra}
            <button
              aria-label="关闭"
              onClick={onClose}
              className="flex h-8 w-8 items-center justify-center rounded-lg text-[#94a3b8] transition-colors duration-150 hover:bg-[#f1f5f9] hover:text-[#334155]"
            >
              <X size={18} />
            </button>
          </div>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">{children}</div>
        {footer ? (
          <div className="flex shrink-0 items-center justify-end gap-3 border-t border-[#e2e8f0] bg-white px-5 py-3">{footer}</div>
        ) : null}
        <style>{`@keyframes drawerIn{from{opacity:0;transform:translateX(24px)}to{opacity:1;transform:translateX(0)}}@media(prefers-reduced-motion:reduce){*{animation:none!important}}`}</style>
      </div>
    </div>
  );
}

// ---------- 下拉操作菜单(DropdownMenu) ----------

export interface DropdownItem {
  label: string;
  icon?: ReactNode;
  danger?: boolean;
  disabled?: boolean;
  onSelect: () => void;
}

/**
 * 轻量下拉菜单:按钮 + 弹出项(点击外部/Esc 关闭)。
 * 用于收敛次级操作(定时/删除等),避免按钮平铺。
 */
export function DropdownMenu({ trigger, items, align = 'right' }: { trigger: ReactNode; items: DropdownItem[]; align?: 'left' | 'right' }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent): void => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('mousedown', onDown);
    window.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      window.removeEventListener('keydown', onKey);
    };
  }, [open]);

  return (
    <div className="relative" ref={ref}>
      <span
        className="inline-flex"
        onClick={() => {
          setOpen((p) => !p);
        }}
      >
        {trigger}
      </span>
      {open ? (
        <div
          role="menu"
          className={`absolute z-[110] mt-1 min-w-[180px] overflow-hidden rounded-lg border border-[#e2e8f0] bg-white py-1 shadow-lg ${
            align === 'right' ? 'right-0' : 'left-0'
          }`}
        >
          {items.map((it) => (
            <button
              key={it.label}
              role="menuitem"
              disabled={it.disabled}
              onClick={() => {
                if (it.disabled) return;
                setOpen(false);
                it.onSelect();
              }}
              className={`flex w-full items-center gap-2 px-3 py-2 text-left text-sm transition-colors duration-100 disabled:cursor-not-allowed disabled:opacity-45 ${
                it.danger ? 'text-[#b91c1c] hover:bg-[#fef2f2]' : 'text-[#334155] hover:bg-[#f8fafc]'
              }`}
            >
              {it.icon}
              {it.label}
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}

// ---------- 筛选 chips ----------

/** 单行筛选 chip 组(作品表格状态/批次筛选用) */
export function FilterChips<K extends string>({
  options,
  value,
  onChange,
}: {
  options: Array<{ key: K; label: string; count?: number }>;
  value: K;
  onChange: (key: K) => void;
}) {
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      {options.map((o) => {
        const active = value === o.key;
        return (
          <button
            key={o.key}
            type="button"
            aria-pressed={active}
            onClick={() => onChange(o.key)}
            className={`inline-flex h-8 items-center gap-1.5 rounded-full border px-3 text-xs font-medium transition-colors duration-150 ${
              active
                ? 'border-[#1677ff] bg-[#1677ff] text-white'
                : 'border-[#e2e8f0] bg-white text-[#475569] hover:border-[#cbd5e1] hover:text-[#0f172a]'
            }`}
          >
            {o.label}
            {o.count !== undefined ? (
              <span className={active ? 'text-white/75' : 'text-[#94a3b8]'}>{o.count}</span>
            ) : null}
          </button>
        );
      })}
    </div>
  );
}

/** 排序方向切换按钮(asc/desc 循环) */
export function SortToggle({ dir, onToggle }: { dir: 'asc' | 'desc'; onToggle: () => void }) {
  return (
    <button
      type="button"
      aria-label={dir === 'desc' ? '当前降序,点击切换升序' : '当前升序,点击切换降序'}
      onClick={onToggle}
      className="text-[#94a3b8] transition-colors duration-150 hover:text-[#1677ff]"
    >
      <ChevronDown size={13} className={dir === 'asc' ? 'rotate-180' : ''} />
    </button>
  );
}
