'use client';

// AI 创作中心 → 内容工厂(V10 批量生产线 + P0-P2 运营指挥中心):
// 一级 Tab:总览 / 产线 / 队列 / 质量闸门 / 异常分诊 / 成本
//   · 产线(Line)是一等实体:一整套「题材/类型模板 + 调度 + 配额 + 质量闸门」,
//     一次运行按权重分配一批「不同题材/类型」的短篇,逐篇走既有创作流水线。
//   · 总览是"舵":产线健康 + 漏斗 + 产线泳道 + 告警 + 最近运行。
//   · 队列/闸门/异常/成本 是工厂的监控与处置视图,统一从 production/* API 拉取。

import {
  AlertTriangle,
  CheckCircle2,
  Copy,
  ExternalLink,
  Factory,
  Play,
  Plus,
  RefreshCw,
  Trash2,
} from 'lucide-react';
import Link from 'next/link';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { api } from '@/lib/admin-client';
import { formatDateTime, formatRelativeTime } from '@/lib/format';
import {
  Badge,
  Button,
  ConfirmDialog,
  DropdownMenu,
  EmptyState,
  Field,
  Input,
  Modal,
  Notice,
  Select,
  Tabs,
  Textarea,
  Toast,
} from '@/components/admin/ui';

// ---------- 类型 ----------

interface StoryBrief {
  [key: string]: string | number | undefined;
}
interface ProductionKind {
  genre: string;
  weight: number;
  brief?: StoryBrief;
  seeds?: Array<{ title?: string; theme?: string; synopsis?: string; coreConflict?: string; background?: string; characters?: string; direction?: string }>;
}
interface LineConfig {
  brief?: StoryBrief;
  kinds: ProductionKind[];
  targetWords?: number;
  model?: string;
  ruleId?: string;
  promptId?: string;
  schedule: { mode: 'manual' | 'daily'; hour?: number; count: number };
  quota?: { maxPerRun?: number; dailyLimit?: number; dailyBudgetUsd?: number; skipOnBudgetOverrun?: boolean };
  qualityGate?: { minScore?: number; reworkMaxRounds?: number; publishOnPass?: boolean };
}
interface ProductionLine {
  id: string;
  name: string;
  description: string | null;
  enabled: boolean;
  config: LineConfig;
  lastRunAt: string | null;
  lastRunDate: string | null;
  createdAt: string;
  updatedAt: string;
}
interface LineWithMeta extends ProductionLine {
  total: number;
  todayCreated: number;
  passed: number;
  pool: number;
  failed: number;
  published: number;
  passRate: number | null;
  lastRunTitle: string | null;
  lastRunStatus: string | null;
}
interface ProductionRun {
  id: string;
  lineId: string;
  trigger: 'manual' | 'daily';
  runDate: string;
  count: number;
  status: string;
  items: Array<{ storyId: string | null; genre: string; seedIndex: number | null }>;
  error: string | null;
  createdAt: string;
  finishedAt: string | null;
  executedAt: string | null;
}
interface OverviewResp {
  overview: {
    kpis: Record<string, number | null>;
    funnel: Array<{ key: string; label: string; count: number; rate: number | null }>;
    lanes: Array<{ line: ProductionLine; total: number; inProgress: number; passed: number; pool: number; failed: number; published: number; todayCreated: number; passRate: number | null }>;
    alerts: Array<{ kind: string; severity: 'warning' | 'danger' | 'info'; lineId?: string; lineName?: string; title: string; detail: string; count: number }>;
    recentRuns: ProductionRun[];
    rule: { active: boolean; threshold: number | null; maxOptimizeRounds: number | null };
    today: string;
  };
}
interface QueueResp {
  queue: {
    byType: Array<{ type: string; pending: number; running: number; success7d: number; failed7d: number; failedCount: number }>;
    running: Array<{ id: string; type: string; refId: string | null; model: string | null; startedAt: string | null; durationMs: number | null }>;
    pausedLines: number;
    totalPending: number;
    totalRunning: number;
    lastProcessedAt: string | null;
  };
}
interface GateResp {
  gate: {
    pool: Array<{ storyId: string; title: string; status: string; genre: string | null; lineId: string; lineName: string; lastScore: number | null; optimizeRound: number; weaknesses: string[]; createdAt: string }>;
    lines: Array<{ lineId: string; lineName: string; reviews: number; avgScore: number | null; avgOptimizeRound: number | null; passRate: number | null; threshold: number | null; qualifies: boolean }>;
  };
}
interface ExceptionsResp {
  exceptions: Array<{
    kind: string;
    severity: 'warning' | 'danger' | 'info';
    id: string;
    lineId?: string;
    lineName?: string;
    title: string;
    detail: string;
    action?: { type: string; targetId: string };
    createdAt: string | null;
  }>;
}
interface CostResp {
  cost: {
    byDay: Array<{ date: string; tokens: number; estUsd: number; stories: number; published: number }>;
    byLine: Array<{ lineId: string; lineName: string; tokens: number; estUsd: number; tasks: number; published: number }>;
    totalTokens: number;
    totalEstUsd: number;
    unitCostPerPublished: number | null;
  };
}

type TabKey = 'overview' | 'lines' | 'queue' | 'gate' | 'exceptions' | 'cost' | 'works';

const TASK_TYPE_LABEL: Record<string, string> = {
  CREATE_NOVEL: '创作流水线',
  AI_REVIEW: 'AI 评审',
  AI_OPTIMIZE_STORY: 'AI 优化',
  AI_REVIEW_CHAPTER: '章节评审',
  AI_OPTIMIZE_CHAPTER: '章节优化',
  PUBLISH_SHORT_STORY: '发布',
  AI_REVIEW_ARC: '弧级评审',
  AI_SUGGEST: 'AI 建议',
  AI_GENERATE: 'AI 生成',
  AI_OPTIMIZE: 'AI 优化',
};

function fmtNum(n: number | null | undefined): string {
  if (n === null || n === undefined) return '—';
  return n.toLocaleString();
}
function fmtUsd(n: number | null | undefined): string {
  if (n === null || n === undefined) return '—';
  return `$${n.toFixed(2)}`;
}
function fmtPct(n: number | null | undefined): string {
  if (n === null || n === undefined) return '—';
  return `${n}%`;
}

const SEVERITY_TONE = { danger: 'danger', warning: 'warning', info: 'info' } as const;

// ---------- KPI 卡片 ----------

function Kpi({ label, value, hint, tone = 'default' }: { label: string; value: string; hint?: string; tone?: 'default' | 'good' | 'warn' | 'bad' }) {
  const toneCls =
    tone === 'good' ? 'text-[#047857]' : tone === 'warn' ? 'text-[#b45309]' : tone === 'bad' ? 'text-[#b91c1c]' : 'text-[#0f172a]';
  return (
    <div className="rounded-xl border border-[#e2e8f0] bg-white p-4">
      <p className="text-xs text-[#64748b]">{label}</p>
      <p className={`mt-1 text-2xl font-semibold tabular-nums ${toneCls}`}>{value}</p>
      {hint ? <p className="mt-1 text-xs text-[#94a3b8]">{hint}</p> : null}
    </div>
  );
}

// ---------- 总览 ----------

function OverviewTab({ data }: { data: OverviewResp['overview'] }) {
  const k = data.kpis;
  const funnelMax = Math.max(1, ...data.funnel.map((f) => f.count));
  return (
    <div className="space-y-5">
      {/* KPI 行 */}
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <Kpi label="今日产出" value={fmtNum(k.todayCreated)} hint={`今日成本 ${fmtUsd(k.costTodayUsd)}`} />
        <Kpi label="累计达标" value={fmtNum(k.passed)} hint={`通过率 ${fmtPct(k.passRate)}`} tone={k.passRate !== null && k.passRate >= 60 ? 'good' : 'warn'} />
        <Kpi label="在制数" value={fmtNum(k.inProgress)} hint="生成/评审/优化中" />
        <Kpi label="低质池" value={fmtNum(k.pool)} hint={`失败 ${fmtNum(k.failed)}`} tone={(k.pool ?? 0) > 0 ? 'warn' : 'default'} />
      </div>
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <Kpi label="已发布" value={fmtNum(k.published)} hint="物化到读者站" tone="good" />
        <Kpi label="累计注入" value={fmtNum(k.total)} hint="产线创建总篇数" />
        <Kpi label="累计成本" value={fmtUsd(k.costTotalUsd)} hint="按 token 估算" />
        <Kpi label="单篇发布成本" value={fmtUsd(k.unitCostPerPublished)} hint="成本 / 已发布" />
      </div>

      {/* 告警 */}
      {data.alerts.length > 0 ? (
        <div className="space-y-2">
          <h3 className="text-sm font-semibold text-[#0f172a]">告警</h3>
          <div className="space-y-1.5">
            {data.alerts.map((a, i) => (
              <div key={i} className="flex items-start gap-2 rounded-lg border border-[#e2e8f0] bg-white px-3 py-2">
                <AlertTriangle size={16} className={`mt-0.5 shrink-0 ${a.severity === 'danger' ? 'text-[#b91c1c]' : a.severity === 'warning' ? 'text-[#b45309]' : 'text-[#64748b]'}`} />
                <div className="min-w-0">
                  <p className="text-sm font-medium text-[#0f172a]">{a.title}</p>
                  <p className="text-xs text-[#64748b]">{a.detail}</p>
                </div>
                {a.lineId ? <span className="ml-auto shrink-0 text-xs text-[#94a3b8]">{a.lineName}</span> : null}
              </div>
            ))}
          </div>
        </div>
      ) : null}
      {!data.rule.active ? (
        <Notice tone="error">未发布评审规则,产线无法进入自动评审闭环 —— 请到「评审中心」发布规则版本。</Notice>
      ) : null}

      {/* 漏斗 */}
      <div className="rounded-xl border border-[#e2e8f0] bg-white p-4">
        <h3 className="mb-3 text-sm font-semibold text-[#0f172a]">产出漏斗</h3>
        <div className="space-y-2">
          {data.funnel.map((f) => (
            <div key={f.key} className="flex items-center gap-3">
              <span className="w-16 shrink-0 text-xs text-[#64748b]">{f.label}</span>
              <div className="h-4 flex-1 overflow-hidden rounded bg-[#f1f5f9]">
                <div className="h-full rounded bg-gradient-to-r from-[#1677ff] to-[#0f4ca8]" style={{ width: `${(f.count / funnelMax) * 100}%` }} />
              </div>
              <span className="w-24 shrink-0 text-right text-xs tabular-nums text-[#334155]">{fmtNum(f.count)} · {fmtPct(f.rate)}</span>
            </div>
          ))}
        </div>
      </div>

      {/* 产线泳道 */}
      <div className="overflow-hidden rounded-xl border border-[#e2e8f0] bg-white">
        <div className="border-b border-[#e2e8f0] px-4 py-3">
          <h3 className="text-sm font-semibold text-[#0f172a]">产线健康</h3>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-[#f8fafc] text-xs text-[#64748b]">
              <tr>
                <th className="px-4 py-2 text-left font-medium">产线</th>
                <th className="px-3 py-2 text-right font-medium">今日</th>
                <th className="px-3 py-2 text-right font-medium">累计</th>
                <th className="px-3 py-2 text-right font-medium">在制</th>
                <th className="px-3 py-2 text-right font-medium">达标</th>
                <th className="px-3 py-2 text-right font-medium">发布</th>
                <th className="px-3 py-2 text-right font-medium">池</th>
                <th className="px-3 py-2 text-right font-medium">失败</th>
                <th className="px-3 py-2 text-right font-medium">通过率</th>
              </tr>
            </thead>
            <tbody>
              {data.lanes.length === 0 ? (
                <tr><td colSpan={9} className="px-4 py-8 text-center text-sm text-[#94a3b8]">暂无产线,请先到「产线」页创建。</td></tr>
              ) : data.lanes.map((l) => (
                <tr key={l.line.id} className="border-t border-[#f1f5f9]">
                  <td className="px-4 py-2.5">
                    <div className="flex items-center gap-2">
                      <span className="font-medium text-[#0f172a]">{l.line.name}</span>
                      {!l.line.enabled ? <Badge tone="info">停用</Badge> : null}
                    </div>
                    <p className="text-xs text-[#94a3b8]">{l.line.config.kinds.map((k) => k.genre).join(' / ')}</p>
                  </td>
                  <td className="px-3 py-2.5 text-right tabular-nums">{l.todayCreated}</td>
                  <td className="px-3 py-2.5 text-right tabular-nums">{l.total}</td>
                  <td className="px-3 py-2.5 text-right tabular-nums text-[#0f4ca8]">{l.inProgress}</td>
                  <td className="px-3 py-2.5 text-right tabular-nums text-[#047857]">{l.passed}</td>
                  <td className="px-3 py-2.5 text-right tabular-nums">{l.published}</td>
                  <td className="px-3 py-2.5 text-right tabular-nums text-[#b45309]">{l.pool}</td>
                  <td className="px-3 py-2.5 text-right tabular-nums text-[#b91c1c]">{l.failed}</td>
                  <td className="px-3 py-2.5 text-right tabular-nums">{fmtPct(l.passRate)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* 最近运行 */}
      <RecentRuns runs={data.recentRuns} />
    </div>
  );
}

function RecentRuns({ runs }: { runs: ProductionRun[] }) {
  return (
    <div className="overflow-hidden rounded-xl border border-[#e2e8f0] bg-white">
      <div className="border-b border-[#e2e8f0] px-4 py-3"><h3 className="text-sm font-semibold text-[#0f172a]">最近运行</h3></div>
      {runs.length === 0 ? <div className="px-4 py-6 text-center text-sm text-[#94a3b8]">暂无运行记录。</div> : (
        <ul className="divide-y divide-[#f1f5f9]">
          {runs.map((r) => (
            <li key={r.id} className="flex items-center gap-3 px-4 py-2.5">
              <RunStatus status={r.status} />
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm text-[#0f172a]">{r.trigger === 'daily' ? '每日触发' : '手动触发'} · {r.count} 篇</p>
                <p className="text-xs text-[#94a3b8]">{r.runDate} · {formatDateTime(r.createdAt)}</p>
              </div>
              <span className="text-xs text-[#64748b]">{r.items.filter((i) => i.genre).map((i) => i.genre).join(' / ') || '—'}</span>
              {r.error ? <span className="max-w-[180px] truncate text-xs text-[#b91c1c]" title={r.error}>{r.error}</span> : null}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function RunStatus({ status }: { status: string }) {
  const map: Record<string, { tone: 'success' | 'info' | 'warning' | 'running' | 'danger'; label: string }> = {
    pending: { tone: 'info', label: '待触发' },
    executing: { tone: 'running', label: '执行中' },
    done: { tone: 'success', label: '已完成' },
    failed: { tone: 'danger', label: '失败' },
    cancelled: { tone: 'info', label: '已取消' },
  };
  const m = map[status] ?? { tone: 'info' as const, label: status };
  return <Badge tone={m.tone}>{m.label}</Badge>;
}

// ---------- 产线管理 ----------

interface LineEditorDraft {
  id: string | null;
  name: string;
  description: string;
  enabled: boolean;
  mode: 'manual' | 'daily';
  hour: string;
  count: string;
  maxPerRun: string;
  dailyLimit: string;
  dailyBudgetUsd: string;
  skipOnBudgetOverrun: boolean;
  minScore: string;
  reworkMaxRounds: string;
  publishOnPass: boolean;
  targetWords: string;
  sharedBrief: { theme: string; synopsis: string; coreConflict: string; background: string; characters: string; languageStyle: string; emotionalTone: string; pacing: string };
  kinds: Array<{ genre: string; weight: string; synopsis: string; seeds: string }>;
}

function toDraft(line: LineWithMeta | null): LineEditorDraft {
  const cfg = line?.config;
  const b = cfg?.brief ?? {};
  const sharedBrief = {
    theme: String(b.theme ?? ''),
    synopsis: String(b.synopsis ?? ''),
    coreConflict: String(b.coreConflict ?? ''),
    background: String(b.background ?? ''),
    characters: String(b.characters ?? ''),
    languageStyle: String(b.languageStyle ?? ''),
    emotionalTone: String(b.emotionalTone ?? ''),
    pacing: String(b.pacing ?? ''),
  };
  const kinds = cfg?.kinds?.map((k) => ({
    genre: k.genre,
    weight: String(k.weight ?? 1),
    synopsis: String(k.brief?.synopsis ?? ''),
    seeds: (k.seeds ?? []).map((s) => s.theme ?? s.title ?? '').filter(Boolean).join('\n'),
  })) ?? [{ genre: '', weight: '1', synopsis: '', seeds: '' }];
  return {
    id: line?.id ?? null,
    name: line?.name ?? '',
    description: line?.description ?? '',
    enabled: line?.enabled ?? true,
    mode: cfg?.schedule?.mode ?? 'manual',
    hour: String(cfg?.schedule?.hour ?? 8),
    count: String(cfg?.schedule?.count ?? 3),
    maxPerRun: String(cfg?.quota?.maxPerRun ?? ''),
    dailyLimit: String(cfg?.quota?.dailyLimit ?? ''),
    dailyBudgetUsd: String(cfg?.quota?.dailyBudgetUsd ?? ''),
    skipOnBudgetOverrun: cfg?.quota?.skipOnBudgetOverrun ?? false,
    minScore: String(cfg?.qualityGate?.minScore ?? ''),
    reworkMaxRounds: String(cfg?.qualityGate?.reworkMaxRounds ?? ''),
    publishOnPass: cfg?.qualityGate?.publishOnPass ?? true,
    targetWords: String(cfg?.targetWords ?? ''),
    sharedBrief,
    kinds,
  };
}

function buildConfig(d: LineEditorDraft): LineConfig {
  const brief: StoryBrief = {};
  const sb = d.sharedBrief;
  for (const [k, v] of Object.entries(sb)) if (v.trim()) brief[k] = v.trim();
  const kinds: ProductionKind[] = d.kinds
    .filter((k) => k.genre.trim())
    .map((k) => ({
      genre: k.genre.trim(),
      weight: Math.max(1, Number(k.weight) || 1),
      ...(k.synopsis.trim() ? { brief: { synopsis: k.synopsis.trim() } } : {}),
      ...(k.seeds.trim()
        ? { seeds: k.seeds.split('\n').filter(Boolean).map((t) => ({ theme: t.trim() })) }
        : {}),
    }));
  const config: LineConfig = {
    kinds,
    schedule: {
      mode: d.mode,
      ...(d.mode === 'daily' ? { hour: Number(d.hour) || 8 } : {}),
      count: Math.max(1, Math.min(50, Number(d.count) || 1)),
    },
  };
  if (Object.keys(brief).length) config.brief = brief;
  const targetWords = Number(d.targetWords);
  if (targetWords) config.targetWords = targetWords;
  if (d.maxPerRun.trim()) config.quota = { ...(config.quota ?? {}), maxPerRun: Number(d.maxPerRun) };
  if (d.dailyLimit.trim()) config.quota = { ...(config.quota ?? {}), dailyLimit: Number(d.dailyLimit) };
  if (d.dailyBudgetUsd.trim()) config.quota = { ...(config.quota ?? {}), dailyBudgetUsd: Number(d.dailyBudgetUsd) };
  if (d.skipOnBudgetOverrun) config.quota = { ...(config.quota ?? {}), skipOnBudgetOverrun: true };
  if (d.minScore.trim()) config.qualityGate = { ...(config.qualityGate ?? {}), minScore: Number(d.minScore) };
  if (d.reworkMaxRounds.trim()) config.qualityGate = { ...(config.qualityGate ?? {}), reworkMaxRounds: Number(d.reworkMaxRounds) };
  if (d.publishOnPass !== true) config.qualityGate = { ...(config.qualityGate ?? {}), publishOnPass: false };
  return config;
}

function LineEditorModal({ open, line, onClose, onSaved }: { open: boolean; line: LineWithMeta | null; onClose: () => void; onSaved: () => void }) {
  const [draft, setDraft] = useState<LineEditorDraft>(() => toDraft(line));
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState('');
  useEffect(() => {
    if (open) {
      setDraft(toDraft(line));
      setErr('');
    }
  }, [open, line]);

  const save = async (): Promise<void> => {
    if (!draft.name.trim()) { setErr('请填写产线名称'); return; }
    const cleaned = draft.kinds.filter((k) => k.genre.trim());
    if (cleaned.length === 0) { setErr('至少配置一种题材/类型'); return; }
    setSaving(true);
    setErr('');
    try {
      if (draft.id) {
        await api(`/api/admin/production-lines/${draft.id}`, {
          method: 'PUT',
          body: JSON.stringify({ name: draft.name.trim(), description: draft.description || null, enabled: draft.enabled, config: buildConfig(draft) }),
        });
      } else {
        await api('/api/admin/production-lines', {
          method: 'POST',
          body: JSON.stringify({ name: draft.name.trim(), description: draft.description || null, enabled: draft.enabled, config: buildConfig(draft) }),
        });
      }
      onSaved();
      onClose();
    } catch (e) {
      setErr(e instanceof Error ? e.message : '保存失败');
    } finally {
      setSaving(false);
    }
  };

  const setKind = (i: number, patch: Partial<LineEditorDraft['kinds'][number]>): void => {
    setDraft((d) => ({ ...d, kinds: d.kinds.map((k, idx) => (idx === i ? { ...k, ...patch } : k)) }));
  };

  return (
    <Modal
      open={open}
      title={draft.id ? '编辑产线' : '新建产线'}
      onClose={onClose}
      footer={
        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={onClose}>取消</Button>
          <Button variant="primary" onClick={() => void save()} disabled={saving}>{saving ? '保存中…' : '保存'}</Button>
        </div>
      }
    >
      {err ? <div className="mb-3"><Notice tone="error">{err}</Notice></div> : null}
      <div className="space-y-3">
        <div className="grid grid-cols-2 gap-3">
          <Field label="产线名称"><Input value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} placeholder="如:短视频文案线" /></Field>
          <Field label="启用"><Select value={draft.enabled ? '1' : '0'} onChange={(e) => setDraft({ ...draft, enabled: e.target.value === '1' })}><option value="1">启用</option><option value="0">停用</option></Select></Field>
        </div>
        <Field label="描述"><Textarea value={draft.description} onChange={(e) => setDraft({ ...draft, description: e.target.value })} placeholder="产线用途说明(可选)" /></Field>

        <div className="rounded-lg bg-[#f8fafc] p-3">
          <p className="mb-2 text-sm font-semibold text-[#0f172a]">调度</p>
          <div className="grid grid-cols-3 gap-3">
            <Field label="触发模式">
              <Select value={draft.mode} onChange={(e) => setDraft({ ...draft, mode: e.target.value as 'manual' | 'daily' })}>
                <option value="manual">手动</option><option value="daily">每日</option>
              </Select>
            </Field>
            {draft.mode === 'daily' ? (
              <Field label="每日时刻"><Input type="time" value={draft.hour.padStart(2, '0')} onChange={(e) => setDraft({ ...draft, hour: e.target.value })} /></Field>
            ) : null}
            <Field label="每批篇数 (1..50)"><Input type="number" min={1} max={50} value={draft.count} onChange={(e) => setDraft({ ...draft, count: e.target.value })} /></Field>
          </div>
        </div>

        <div className="rounded-lg bg-[#f8fafc] p-3">
          <p className="mb-2 text-sm font-semibold text-[#0f172a]">配额</p>
          <div className="grid grid-cols-3 gap-3">
            <Field label="单次上限"><Input type="number" value={draft.maxPerRun} onChange={(e) => setDraft({ ...draft, maxPerRun: e.target.value })} placeholder="可选" /></Field>
            <Field label="每日上限"><Input type="number" value={draft.dailyLimit} onChange={(e) => setDraft({ ...draft, dailyLimit: e.target.value })} placeholder="可选" /></Field>
            <Field label="每日预算($)"><Input type="number" value={draft.dailyBudgetUsd} onChange={(e) => setDraft({ ...draft, dailyBudgetUsd: e.target.value })} placeholder="可选" /></Field>
          </div>
          <label className="mt-2 flex cursor-pointer items-center gap-2 text-sm text-[#334155]">
            <input type="checkbox" checked={draft.skipOnBudgetOverrun} onChange={(e) => setDraft({ ...draft, skipOnBudgetOverrun: e.target.checked })} className="h-4 w-4 rounded border-[#e2e8f0]" />
            超预算自动跳过当次运行
          </label>
        </div>

        <div className="rounded-lg bg-[#f8fafc] p-3">
          <p className="mb-2 text-sm font-semibold text-[#0f172a]">质量闸门</p>
          <div className="grid grid-cols-3 gap-3">
            <Field label="达标分数线"><Input type="number" value={draft.minScore} onChange={(e) => setDraft({ ...draft, minScore: e.target.value })} placeholder="缺省 80" /></Field>
            <Field label="最大优化轮数"><Input type="number" value={draft.reworkMaxRounds} onChange={(e) => setDraft({ ...draft, reworkMaxRounds: e.target.value })} placeholder="缺省规则值" /></Field>
          </div>
          <label className="mt-2 flex cursor-pointer items-center gap-2 text-sm text-[#334155]">
            <input type="checkbox" checked={draft.publishOnPass} onChange={(e) => setDraft({ ...draft, publishOnPass: e.target.checked })} className="h-4 w-4 rounded border-[#e2e8f0]" />
            达标后自动发布到读者站
          </label>
        </div>

        <div className="rounded-lg bg-[#f8fafc] p-3">
          <p className="mb-2 text-sm font-semibold text-[#0f172a]">创作基线(共享,可选)</p>
          <div className="grid grid-cols-2 gap-3">
            <Field label="主题基调"><Textarea className="min-h-[40px]" value={draft.sharedBrief.theme} onChange={(e) => setDraft({ ...draft, sharedBrief: { ...draft.sharedBrief, theme: e.target.value } })} placeholder="留空=自由发挥" /></Field>
            <Field label="语言风格"><Input value={draft.sharedBrief.languageStyle} onChange={(e) => setDraft({ ...draft, sharedBrief: { ...draft.sharedBrief, languageStyle: e.target.value } })} placeholder="如:都市白描" /></Field>
            <Field label="情绪基调"><Input value={draft.sharedBrief.emotionalTone} onChange={(e) => setDraft({ ...draft, sharedBrief: { ...draft.sharedBrief, emotionalTone: e.target.value } })} /></Field>
            <Field label="节奏"><Input value={draft.sharedBrief.pacing} onChange={(e) => setDraft({ ...draft, sharedBrief: { ...draft.sharedBrief, pacing: e.target.value } })} /></Field>
          </div>
        </div>

        <div className="rounded-lg bg-[#f8fafc] p-3">
          <div className="mb-2 flex items-center justify-between">
            <p className="text-sm font-semibold text-[#0f172a]">题材 / 类型清单(支持批量生成不同题材)</p>
            <Button variant="ghost" size="xs" onClick={() => setDraft({ ...draft, kinds: [...draft.kinds, { genre: '', weight: '1', synopsis: '', seeds: '' }] })}><Plus size={13} /> 添加题材</Button>
          </div>
          <div className="space-y-3">
            {draft.kinds.map((k, i) => (
              <div key={i} className="rounded-lg border border-[#e2e8f0] bg-white p-3">
                <div className="flex items-start gap-2">
                  <div className="grid flex-1 grid-cols-3 gap-2">
                    <Field label="题材"><Input value={k.genre} onChange={(e) => setKind(i, { genre: e.target.value })} placeholder="如:都市言情" /></Field>
                    <Field label="权重"><Input type="number" min={1} value={k.weight} onChange={(e) => setKind(i, { weight: e.target.value })} /></Field>
                    <Field label="题材梗概"><Input value={k.synopsis} onChange={(e) => setKind(i, { synopsis: e.target.value })} placeholder="可选" /></Field>
                  </div>
                  <Button variant="ghost" size="xs" className="mt-1 shrink-0" onClick={() => setDraft({ ...draft, kinds: draft.kinds.filter((_, idx) => idx !== i) })}><Trash2 size={13} /></Button>
                </div>
                <Field label="种子池(每行一个主题,同题材也保证不同味)">
                  <Textarea className="min-h-[48px]" value={k.seeds} onChange={(e) => setKind(i, { seeds: e.target.value })} placeholder={'雨夜重逢\nAI 时代的最后一封情书\n十年后的快递'} />
                </Field>
              </div>
            ))}
          </div>
        </div>
      </div>
    </Modal>
  );
}

function LinesTab({ lines, onChanged, onRun, onToggle, onDelete }: {
  lines: LineWithMeta[];
  onChanged: () => void;
  onRun: (id: string) => void;
  onToggle: (id: string, enabled: boolean) => void;
  onDelete: (id: string) => void;
}) {
  const [editorLine, setEditorLine] = useState<LineWithMeta | null>(null);
  const [editorOpen, setEditorOpen] = useState(false);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <p className="text-sm text-[#64748b]">产线是一套「题材模板 + 调度 + 配额 + 质量闸门」,每次运行按权重批量生成一批不同题材/类型的短篇。</p>
        <Button variant="primary" onClick={() => { setEditorLine(null); setEditorOpen(true); }}><Plus size={14} /> 新建产线</Button>
      </div>
      {lines.length === 0 ? (
        <EmptyState icon={<Factory size={24} />} title="还没有内容产线" description="创建一条产线,即可按设定批量生成不同题材/类型的短篇小说。" />
      ) : (
        <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
          {lines.map((line) => (
            <div key={line.id} className="rounded-xl border border-[#e2e8f0] bg-white p-4">
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <h3 className="truncate text-base font-semibold text-[#0f172a]">{line.name}</h3>
                    {!line.enabled ? <Badge tone="info">停用</Badge> : null}
                  </div>
                  <p className="mt-1 text-xs text-[#64748b]">{line.description || '未填写描述'}</p>
                </div>
                <DropdownMenu
                  align="right"
                  trigger={<Button variant="ghost" size="xs" title="更多操作">•••</Button>}
                  items={[
                    { label: '编辑', onSelect: () => { setEditorLine(line); setEditorOpen(true); } },
                    { label: line.enabled ? '停用' : '启用', onSelect: () => onToggle(line.id, !line.enabled) },
                    { label: '删除', danger: true, onSelect: () => onDelete(line.id) },
                  ]}
                />
              </div>
              <div className="mt-2 flex flex-wrap gap-1.5">
                {line.config.kinds.map((k) => (
                  <span key={k.genre} className="rounded-full bg-[#f1f5f9] px-2.5 py-1 text-xs text-[#334155]">{k.genre}{line.config.kinds.length > 1 ? ` ${Math.round((k.weight / line.config.kinds.reduce((s, x) => s + x.weight, 0)) * 100)}%` : ''}</span>
                ))}
              </div>
              <div className="mt-4 grid grid-cols-4 gap-2 text-center">
                <Stat label="今日" value={line.todayCreated} />
                <Stat label="达标" value={line.passed} />
                <Stat label="发布" value={line.published} />
                <Stat label="通过率" value={line.passRate === null ? '—' : `${line.passRate}%`} />
              </div>
              <div className="mt-3 flex items-center justify-between border-t border-[#f1f5f9] pt-3">
                <span className="text-xs text-[#94a3b8]">{line.lastRunAt ? `上次 ${formatRelativeTime(line.lastRunAt)}` : `调度:${line.config.schedule.mode === 'daily' ? `每日 ${String(line.config.schedule.hour ?? 8).padStart(2, '0')}:00` : '手动'}`}</span>
                <Button variant="primary" size="sm" disabled={!line.enabled} onClick={() => onRun(line.id)}><Play size={13} /> 运行</Button>
              </div>
            </div>
          ))}
        </div>
      )}
      {editorOpen ? <LineEditorModal open={editorOpen} line={editorLine} onClose={() => setEditorOpen(false)} onSaved={onChanged} /> : null}
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string | number }) {
  return <div><p className="text-xs text-[#94a3b8]">{label}</p><p className="text-sm font-semibold tabular-nums text-[#0f172a]">{value}</p></div>;
}

// ---------- 队列 ----------

function QueueTab({ data }: { data: QueueResp['queue'] }) {
  const typeOrder = Object.keys(TASK_TYPE_LABEL);
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-3 gap-3">
        <Kpi label="排队中" value={fmtNum(data.totalPending)} />
        <Kpi label="执行中" value={fmtNum(data.totalRunning)} tone={data.totalRunning > 0 ? 'good' : 'default'} />
        <Kpi label="停用产线" value={fmtNum(data.pausedLines)} />
      </div>
      <div className="overflow-hidden rounded-xl border border-[#e2e8f0] bg-white">
        <div className="border-b border-[#e2e8f0] px-4 py-3"><h3 className="text-sm font-semibold text-[#0f172a]">按类型队列</h3></div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-[#f8fafc] text-xs text-[#64748b]">
              <tr><th className="px-4 py-2 text-left font-medium">类型</th><th className="px-3 py-2 text-right font-medium">排队</th><th className="px-3 py-2 text-right font-medium">运行</th><th className="px-3 py-2 text-right font-medium">近 7 日成功</th><th className="px-3 py-2 text-right font-medium">近 7 日失败</th></tr>
            </thead>
            <tbody>
              {typeOrder.map((t) => {
                const row = data.byType.find((r) => r.type === t);
                if (!row) return null;
                return (
                  <tr key={t} className="border-t border-[#f1f5f9]">
                    <td className="px-4 py-2.5 font-medium text-[#0f172a]">{TASK_TYPE_LABEL[t] ?? t}</td>
                    <td className="px-3 py-2.5 text-right tabular-nums">{row.pending}</td>
                    <td className="px-3 py-2.5 text-right tabular-nums">{row.running}</td>
                    <td className="px-3 py-2.5 text-right tabular-nums text-[#047857]">{row.success7d}</td>
                    <td className={`px-3 py-2.5 text-right tabular-nums ${row.failed7d > 0 ? 'text-[#b91c1c]' : ''}`}>{row.failed7d}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
      <div className="overflow-hidden rounded-xl border border-[#e2e8f0] bg-white">
        <div className="border-b border-[#e2e8f0] px-4 py-3"><h3 className="text-sm font-semibold text-[#0f172a]">执行中任务</h3></div>
        {data.running.length === 0 ? <div className="px-4 py-6 text-center text-sm text-[#94a3b8]">当前无执行中任务。</div> : (
          <ul className="divide-y divide-[#f1f5f9]">
            {data.running.map((r) => (
              <li key={r.id} className="flex items-center gap-3 px-4 py-2.5">
                <Badge tone="running">{TASK_TYPE_LABEL[r.type] ?? r.type}</Badge>
                <span className="flex-1 truncate text-xs text-[#64748b]">refId: {r.refId ?? '—'}</span>
                <span className="text-xs text-[#94a3b8]">{r.model ?? '—'} · {r.startedAt ? `${Math.round((Date.now() - new Date(r.startedAt).getTime()) / 1000)}s` : '—'}</span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

// ---------- 质量闸门 ----------

function GateTab({ data }: { data: GateResp['gate'] }) {
  return (
    <div className="space-y-4">
      <div className="overflow-hidden rounded-xl border border-[#e2e8f0] bg-white">
        <div className="border-b border-[#e2e8f0] px-4 py-3"><h3 className="text-sm font-semibold text-[#0f172a]">各产线达标情况</h3></div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-[#f8fafc] text-xs text-[#64748b]">
              <tr><th className="px-4 py-2 text-left font-medium">产线</th><th className="px-3 py-2 text-right font-medium">评审数</th><th className="px-3 py-2 text-right font-medium">均分</th><th className="px-3 py-2 text-right font-medium">平均优化</th><th className="px-3 py-2 text-right font-medium">通过率</th><th className="px-3 py-2 text-right font-medium">阈值</th><th className="px-3 py-2 text-right font-medium">达标</th></tr>
            </thead>
            <tbody>
              {data.lines.length === 0 ? <tr><td colSpan={7} className="px-4 py-6 text-center text-sm text-[#94a3b8]">暂无产线。</td></tr> : data.lines.map((l) => (
                <tr key={l.lineId} className="border-t border-[#f1f5f9]">
                  <td className="px-4 py-2.5 font-medium text-[#0f172a]">{l.lineName}</td>
                  <td className="px-3 py-2.5 text-right tabular-nums">{l.reviews}</td>
                  <td className="px-3 py-2.5 text-right tabular-nums">{l.avgScore === null ? '—' : l.avgScore}</td>
                  <td className="px-3 py-2.5 text-right tabular-nums">{l.avgOptimizeRound === null ? '—' : l.avgOptimizeRound}</td>
                  <td className="px-3 py-2.5 text-right tabular-nums">{fmtPct(l.passRate)}</td>
                  <td className="px-3 py-2.5 text-right tabular-nums">{l.threshold ?? '—'}</td>
                  <td className="px-3 py-2.5 text-right">{l.qualifies ? <Badge tone="success">达标</Badge> : <Badge tone="warning">未达标</Badge>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <div className="overflow-hidden rounded-xl border border-[#e2e8f0] bg-white">
        <div className="border-b border-[#e2e8f0] px-4 py-3"><h3 className="text-sm font-semibold text-[#0f172a]">低质量内容池({data.pool.length})</h3></div>
        {data.pool.length === 0 ? <div className="px-4 py-8 text-center text-sm text-[#94a3b8]">低质量池为空。</div> : (
          <ul className="divide-y divide-[#f1f5f9]">
            {data.pool.map((p) => (
              <li key={p.storyId} className="px-4 py-3">
                <div className="flex items-center gap-2">
                  <Badge tone="info">{p.genre ?? '—'}</Badge>
                  <span className="font-medium text-[#0f172a]">{p.title}</span>
                  <span className="ml-auto text-xs text-[#64748b]">{p.lineName}</span>
                </div>
                <p className="mt-1 text-xs text-[#94a3b8]">最近评分 {p.lastScore ?? '—'} · 优化 {p.optimizeRound} 轮</p>
                {p.weaknesses.length > 0 ? (
                  <div className="mt-1.5 flex flex-wrap gap-1.5">
                    {p.weaknesses.slice(0, 4).map((w, i) => <span key={i} className="rounded bg-[#fef3c7] px-2 py-0.5 text-xs text-[#b45309]">{w}</span>)}
                  </div>
                ) : null}
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

// ---------- 异常分诊 ----------

function ExceptionsTab({ items, onAction }: { items: ExceptionsResp['exceptions']; onAction: (item: ExceptionsResp['exceptions'][number]) => void }) {
  if (items.length === 0) return <EmptyState icon={<CheckCircle2 size={24} />} title="没有待处置异常" description="工厂运转正常,没有需要人工干预的事项。" />;
  return (
    <div className="space-y-2">
      {items.map((e) => (
        <div key={`${e.kind}-${e.id}`} className="flex items-start gap-3 rounded-xl border border-[#e2e8f0] bg-white px-4 py-3">
          <Badge tone={SEVERITY_TONE[e.severity]}>{exceptionKindLabel(e.kind)}</Badge>
          <div className="min-w-0 flex-1">
            <p className="text-sm font-medium text-[#0f172a]">{e.title}{e.lineName ? <span className="ml-2 text-xs text-[#94a3b8]">{e.lineName}</span> : null}</p>
            <p className="mt-0.5 text-xs text-[#64748b]">{e.detail}</p>
          </div>
          {e.action && e.action.type !== 'none' ? (
            <Button variant="secondary" size="sm" onClick={() => onAction(e)}>{actionLabel(e.action.type)}</Button>
          ) : null}
        </div>
      ))}
    </div>
  );
}

function exceptionKindLabel(kind: string): string {
  const map: Record<string, string> = { failed_task: '失败任务', failed_story: '失败创作', pool_story: '低质池', quota: '配额', budget: '预算', offline_rule: '规则离线', disabled_line: '停用产线' };
  return map[kind] ?? kind;
}
function actionLabel(type: string): string {
  const map: Record<string, string> = { retry_task: '重试任务', retry_story: '重新生成', optimize_story: '手动优化', delete_story: '删除', enable_line: '启用产线', publish: '发布', none: '' };
  return map[type] ?? type;
}

// ---------- 成本 ----------

function CostTab({ data }: { data: CostResp['cost'] }) {
  const maxDay = Math.max(1, ...data.byDay.map((d) => d.estUsd));
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-3 gap-3">
        <Kpi label="总成本" value={fmtUsd(data.totalEstUsd)} hint="按 token 估算" />
        <Kpi label="单篇发布成本" value={fmtUsd(data.unitCostPerPublished)} />
        <Kpi label="累计已发布" value={fmtNum(data.byLine.reduce((s, l) => s + l.published, 0))} />
      </div>
      <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
        <div className="overflow-hidden rounded-xl border border-[#e2e8f0] bg-white">
          <div className="border-b border-[#e2e8f0] px-4 py-3"><h3 className="text-sm font-semibold text-[#0f172a]">按日成本</h3></div>
          <div className="space-y-1.5 p-4">
            {data.byDay.length === 0 ? <p className="text-sm text-[#94a3b8]">暂无成本数据。</p> : data.byDay.map((d) => (
              <div key={d.date} className="flex items-center gap-3">
                <span className="w-20 shrink-0 text-xs text-[#64748b]">{d.date}</span>
                <div className="h-3 flex-1 overflow-hidden rounded bg-[#f1f5f9]"><div className="h-full rounded bg-gradient-to-r from-[#1677ff] to-[#0f4ca8]" style={{ width: `${(d.estUsd / maxDay) * 100}%` }} /></div>
                <span className="w-24 shrink-0 text-right text-xs tabular-nums text-[#334155]">{fmtUsd(d.estUsd)} · {d.tokens} tok</span>
              </div>
            ))}
          </div>
        </div>
        <div className="overflow-hidden rounded-xl border border-[#e2e8f0] bg-white">
          <div className="border-b border-[#e2e8f0] px-4 py-3"><h3 className="text-sm font-semibold text-[#0f172a]">按产线成本</h3></div>
          <table className="w-full text-sm">
            <thead className="bg-[#f8fafc] text-xs text-[#64748b]"><tr><th className="px-4 py-2 text-left font-medium">产线</th><th className="px-3 py-2 text-right font-medium">任务</th><th className="px-3 py-2 text-right font-medium">tokens</th><th className="px-3 py-2 text-right font-medium">成本</th><th className="px-3 py-2 text-right font-medium">发布</th></tr></thead>
            <tbody>
              {data.byLine.length === 0 ? <tr><td colSpan={5} className="px-4 py-6 text-center text-sm text-[#94a3b8]">暂无产线成本数据。</td></tr> : data.byLine.map((l) => (
                <tr key={l.lineId} className="border-t border-[#f1f5f9]">
                  <td className="px-4 py-2.5 font-medium text-[#0f172a]">{l.lineName}</td>
                  <td className="px-3 py-2.5 text-right tabular-nums">{l.tasks}</td>
                  <td className="px-3 py-2.5 text-right tabular-nums">{fmtNum(l.tokens)}</td>
                  <td className="px-3 py-2.5 text-right tabular-nums">{fmtUsd(l.estUsd)}</td>
                  <td className="px-3 py-2.5 text-right tabular-nums text-[#047857]">{l.published}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

// ---------- 作品(发布闭环) ----------

interface WorkItem {
  id: string;
  title: string;
  status: string;
  versionCount: number;
  publicationId: string | null;
  publishedBookId: string | null;
  publishedAt: string | null;
  onlineVersionNumber: number | null;
}

const STORY_STATUS_LABEL: Record<string, { label: string; tone: 'info' | 'running' | 'success' | 'danger' | 'warning' }> = {
  draft: { label: '草稿', tone: 'info' },
  scheduled: { label: '已排期', tone: 'info' },
  creating: { label: '创作中', tone: 'running' },
  reviewing: { label: '评审中', tone: 'running' },
  optimizing: { label: '优化中', tone: 'running' },
  passed: { label: '已达标', tone: 'success' },
  failed: { label: '失败', tone: 'danger' },
};

/**
 * 作品 Tab:已发布短篇的线上状态与发布闭环操作。
 * - 展示「线上版本 vs 最新版本」:线上落后时高亮并提示重新发布
 * - 重新发布:线上 Book+Chapter 原地更新为最新应发版本(读者链接不变)
 * - 复制读者链接:完成 产出→分享 的最后一公里
 */
function WorksTab({ onChanged, notify }: { onChanged: () => void; notify: (tone: 'success' | 'error', msg: string) => void }) {
  const [works, setWorks] = useState<WorkItem[] | null>(null);
  const [q, setQ] = useState('');
  const [busyId, setBusyId] = useState<string | null>(null);

  const loadWorks = useCallback(async () => {
    try {
      const r = await api<{ stories: WorkItem[] }>('/api/admin/short-stories?status=passed&limit=500');
      setWorks(r.stories);
    } catch (err) {
      notify('error', err instanceof Error ? err.message : '作品加载失败');
    }
  }, [notify]);

  useEffect(() => {
    void loadWorks();
  }, [loadWorks]);

  const republish = async (s: WorkItem) => {
    setBusyId(s.id);
    try {
      await api(`/api/admin/short-stories/${s.id}/republish`, { method: 'POST', body: JSON.stringify({}) });
      notify('success', `《${s.title}》已重新发布,读者下次访问即见新内容。`);
      void loadWorks();
      onChanged();
    } catch (err) {
      notify('error', err instanceof Error ? err.message : '重新发布失败');
    } finally {
      setBusyId(null);
    }
  };

  const copyReaderLink = async (s: WorkItem) => {
    const url = `${window.location.origin}/short/${s.id}`;
    try {
      await navigator.clipboard.writeText(url);
      notify('success', '读者链接已复制。');
    } catch {
      window.prompt('复制以下读者链接:', url);
    }
  };

  const openReader = (s: WorkItem) => {
    window.open(`/short/${s.id}`, '_blank', 'noopener');
  };

  const filtered = (works ?? []).filter(
    (s) => !q.trim() || s.title.toLowerCase().includes(q.trim().toLowerCase()) || s.id.includes(q.trim())
  );

  if (!works) return <div className="py-16 text-center text-sm text-[#64748b]">加载中…</div>;

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2">
        <Input placeholder="搜索标题 / 编号…" value={q} onChange={(e) => setQ(e.target.value)} className="max-w-xs" />
        <span className="text-xs text-[#64748b]">共 {filtered.length} 篇已达标作品(仅展示已发布/可发布)</span>
      </div>
      {filtered.length === 0 ? (
        <EmptyState icon={<Factory size={28} />} title="暂无已达标作品" description="产线运行并通过质量闸门后,作品会出现在这里,可一键发布给读者。" />
      ) : (
        <div className="overflow-hidden rounded-xl border border-[#e2e8f0] bg-white">
          <table className="w-full text-sm">
            <thead className="bg-[#f8fafc] text-xs text-[#64748b]">
              <tr>
                <th className="px-4 py-2 text-left font-medium">作品</th>
                <th className="px-3 py-2 text-left font-medium">线上版本</th>
                <th className="px-3 py-2 text-left font-medium">发布时间</th>
                <th className="px-4 py-2 text-right font-medium">操作</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((s) => {
                const published = !!s.publicationId;
                const stale = published && s.onlineVersionNumber !== null && s.onlineVersionNumber < s.versionCount;
                const badge = STORY_STATUS_LABEL[s.status] ?? { label: s.status, tone: 'info' as const };
                return (
                  <tr key={s.id} className="border-t border-[#f1f5f9] hover:bg-[#f8fafc]">
                    <td className="px-4 py-2.5">
                      <Link
                        href={`/admin/works/${s.id}`}
                        title="进入作品管理:编辑标题/正文、版本历史、发布"
                        className="font-medium text-[#0f172a] hover:text-[#1677ff] hover:underline"
                      >
                        {s.title || '(未命名)'}
                      </Link>
                      <div className="text-xs text-[#94a3b8]">{s.id}</div>
                    </td>
                    <td className="px-3 py-2.5">
                      {!published ? (
                        <Badge tone="warning">未发布</Badge>
                      ) : stale ? (
                        <span className="inline-flex items-center gap-1.5">
                          <Badge tone="warning">线上 v{s.onlineVersionNumber} / 最新 v{s.versionCount}</Badge>
                          <span className="text-xs text-[#b45309]">落后</span>
                        </span>
                      ) : (
                        <Badge tone="success">线上 v{s.onlineVersionNumber} · 最新</Badge>
                      )}
                      <span className="ml-2">
                        <Badge tone={badge.tone}>{badge.label}</Badge>
                      </span>
                    </td>
                    <td className="px-3 py-2.5 text-xs text-[#64748b]">{s.publishedAt ? formatRelativeTime(s.publishedAt) : '—'}</td>
                    <td className="px-4 py-2.5">
                      <div className="flex items-center justify-end gap-1.5">
                        <Button variant="ghost" size="xs" onClick={() => void copyReaderLink(s)} title="复制读者链接">
                          <Copy size={13} /> 链接
                        </Button>
                        <Button variant="ghost" size="xs" onClick={() => openReader(s)} title="打开读者页">
                          <ExternalLink size={13} /> 查看
                        </Button>
                        {stale ? (
                          <Button variant="primary" size="xs" disabled={busyId === s.id} onClick={() => void republish(s)}>
                            {busyId === s.id ? '发布中…' : '重新发布'}
                          </Button>
                        ) : published ? null : (
                          <Button variant="primary" size="xs" disabled={busyId === s.id} onClick={() => void republish(s)}>
                            {busyId === s.id ? '发布中…' : '发布'}
                          </Button>
                        )}
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

// ---------- 主页面 ----------

export default function CreationPage() {
  const [tab, setTab] = useState<TabKey>('overview');
  const [overview, setOverview] = useState<OverviewResp['overview'] | null>(null);
  const [lines, setLines] = useState<LineWithMeta[] | null>(null);
  const [queue, setQueue] = useState<QueueResp['queue'] | null>(null);
  const [gate, setGate] = useState<GateResp['gate'] | null>(null);
  const [exceptions, setExceptions] = useState<ExceptionsResp['exceptions'] | null>(null);
  const [cost, setCost] = useState<CostResp['cost'] | null>(null);
  const [loading, setLoading] = useState(false);
  const [toast, setToast] = useState<{ tone: 'error' | 'success'; msg: string } | null>(null);
  const [confirm, setConfirm] = useState<{ type: string; targetId: string; label: string } | null>(null);
  const [runLineId, setRunLineId] = useState<string | null>(null);

  // 已成功加载过就不再进 loading 态:轮询刷新只更新数据,不卸载当前 Tab 内容(否则每 5s 闪烁一次)
  const loadedRef = useRef(false);
  const load = useCallback(async () => {
    if (!loadedRef.current) setLoading(true);
    try {
      const [o, l, q, g, e, c] = await Promise.all([
        api<OverviewResp>('/api/admin/production/overview'),
        api<{ lines: LineWithMeta[] }>('/api/admin/production-lines'),
        api<QueueResp>('/api/admin/production/queue'),
        api<GateResp>('/api/admin/production/gate'),
        api<ExceptionsResp>('/api/admin/production/exceptions'),
        api<CostResp>('/api/admin/production/cost'),
      ]);
      setOverview(o.overview);
      setLines(l.lines);
      setQueue(q.queue);
      setGate(g.gate);
      setExceptions(e.exceptions);
      setCost(c.cost);
      loadedRef.current = true;
    } catch (err) {
      setToast({ tone: 'error', msg: err instanceof Error ? err.message : '加载失败' });
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  // 3 秒轮询(非总览以外的轻量)
  useEffect(() => {
    const id = window.setInterval(() => void load(), 5000);
    return () => window.clearInterval(id);
  }, [load]);

  const doRun = async (id: string): Promise<void> => {
    setRunLineId(id);
    try {
      await api(`/api/admin/production-lines/${id}/run`, { method: 'POST', body: JSON.stringify({ trigger: 'manual' }) });
      setToast({ tone: 'success', msg: '已入队运行,产线按题材批量生成中。' });
      void load();
    } catch (err) {
      setToast({ tone: 'error', msg: err instanceof Error ? err.message : '运行失败' });
    } finally {
      setRunLineId(null);
    }
  };

  const doToggle = async (id: string, enabled: boolean): Promise<void> => {
    try {
      await api(`/api/admin/production-lines/${id}/toggle`, { method: 'POST', body: JSON.stringify({ enabled }) });
      setToast({ tone: 'success', msg: enabled ? '已启用产线' : '已停用产线' });
      void load();
    } catch (err) {
      setToast({ tone: 'error', msg: err instanceof Error ? err.message : '操作失败' });
    }
  };

  const doExceptionAction = async (item: ExceptionsResp['exceptions'][number]): Promise<void> => {
    const a = item.action;
    if (!a) return;
    if (a.type === 'retry_task') {
      await api(`/api/admin/ai/tasks/${a.targetId}/retry`, { method: 'POST' });
    } else if (a.type === 'retry_story') {
      await api(`/api/admin/short-stories/${a.targetId}/create`, { method: 'POST' });
    } else if (a.type === 'optimize_story') {
      await api(`/api/admin/short-stories/${a.targetId}/optimize`, { method: 'POST' });
    } else if (a.type === 'delete_story') {
      await api(`/api/admin/short-stories/${a.targetId}`, { method: 'DELETE' });
    } else if (a.type === 'enable_line') {
      await api(`/api/admin/production-lines/${a.targetId}/toggle`, { method: 'POST', body: JSON.stringify({ enabled: true }) });
    }
    setToast({ tone: 'success', msg: '操作已执行。' });
    void load();
  };

  // 删除产线
  const doDeleteLine = async (id: string): Promise<void> => {
    try {
      await api(`/api/admin/production-lines/${id}`, { method: 'DELETE' });
      setToast({ tone: 'success', msg: '产线已删除' });
      void load();
    } catch (err) {
      setToast({ tone: 'error', msg: err instanceof Error ? err.message : '删除失败' });
    }
  };

  const toastKey = useMemo(() => (toast ? `${toast.tone}-${toast.msg}` : ''), [toast]);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-lg font-semibold text-[#0f172a]">内容工厂</h1>
          <p className="text-xs text-[#64748b]">产线式批量生成不同题材/类型的短篇小说,并做质量、成本、异常的可观测运营。</p>
        </div>
        <Tabs
          tabs={[
            { key: 'overview', label: '总览' },
            { key: 'lines', label: '产线' },
            { key: 'queue', label: '队列' },
            { key: 'gate', label: '质量闸门' },
            { key: 'exceptions', label: '异常分诊' },
            { key: 'cost', label: '成本' },
            { key: 'works', label: '作品' },
          ]}
          value={tab}
          onChange={setTab}
        />
      </div>

      {loading && !overview ? <div className="py-16 text-center text-sm text-[#64748b]">加载中…</div> : null}
      {!loading && tab === 'overview' && overview ? <OverviewTab data={overview} /> : null}
      {!loading && tab === 'lines' && lines ? <LinesTab lines={lines} onChanged={() => void load()} onRun={(id) => void doRun(id)} onToggle={(id, e) => void doToggle(id, e)} onDelete={(id) => setConfirm({ type: 'line', targetId: id, label: '删除产线' })} /> : null}
      {!loading && tab === 'queue' && queue ? <QueueTab data={queue} /> : null}
      {!loading && tab === 'gate' && gate ? <GateTab data={gate} /> : null}
      {!loading && tab === 'exceptions' && exceptions ? <ExceptionsTab items={exceptions} onAction={(i) => void doExceptionAction(i)} /> : null}
      {!loading && tab === 'cost' && cost ? <CostTab data={cost} /> : null}
      {!loading && tab === 'works' ? <WorksTab onChanged={() => void load()} notify={(tone, msg) => setToast({ tone, msg })} /> : null}

      {/* 运行确认 */}
      {runLineId ? (
        <Modal open title="运行产线" onClose={() => setRunLineId(null)} footer={<div className="flex justify-end gap-2"><Button variant="ghost" onClick={() => setRunLineId(null)}>关闭</Button></div>}>
          <p className="flex items-center gap-2 py-4 text-sm text-[#64748b]"><RefreshCw size={15} className="animate-spin" /> 已在入队运行,产线按题材清单批量生成短篇…</p>
        </Modal>
      ) : null}

      {/* 删除确认 */}
      {confirm ? (
        <ConfirmDialog
          open
          title={confirm.label}
          description="删除产线将级联清理其运行记录。已创建的短篇与评审记录保留(不丢失)。"
          loading={false}
          onCancel={() => setConfirm(null)}
          onConfirm={() => { void doDeleteLine(confirm.targetId); setConfirm(null); }}
        />
      ) : null}

      {toast ? <Toast key={toastKey} tone={toast.tone} onClose={() => setToast(null)}>{toast.msg}</Toast> : null}
    </div>
  );
}
