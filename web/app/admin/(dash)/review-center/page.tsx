'use client';

// AI 评审中心(V9 规格书 §23-§31):二级 Tab——评审任务 / 评审记录 / 评审规则 / Prompt 版本 / 质量数据。
// 全链路可追溯:小说哪个版本、规则与 Prompt 哪一版、哪个模型、第几次优化、原始响应。

import { FileSearch, Pencil, Plus, RefreshCw, Send, Trash2 } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
import { api } from '@/lib/admin-client';
import { formatChinaTime } from '@/lib/format';
import {
  Badge,
  Button,
  ConfirmDialog,
  EmptyState,
  Field,
  Input,
  Modal,
  Notice,
  Select,
  Spinner,
  Tabs,
  Textarea,
} from '@/components/admin/ui';

// ---------- 类型 ----------

interface TaskItem {
  id: string;
  type: string;
  status: string;
  refType: string | null;
  refId: string | null;
  input: Record<string, unknown> | null;
  prompt: string | null;
  providerName: string | null;
  modelName: string | null;
  output: Record<string, unknown> | null;
  error: string | null;
  attempt: number;
  durationMs: number | null;
  createdAt: string;
}
interface DimensionScore {
  name: string;
  score: number;
  maxScore: number;
  reason: string;
}
interface RecordItem {
  id: string;
  storyId: string;
  storyVersionId: string;
  ruleId: string;
  ruleVersion: string;
  promptId: string | null;
  promptVersion: string | null;
  modelId: string | null;
  modelName: string | null;
  score: number;
  level: string;
  qualified: boolean;
  dimensionScores: DimensionScore[];
  strengths: string[];
  weaknesses: string[];
  suggestions: string[];
  summary: string | null;
  reviewRound: number;
  optimizationRound: number;
  durationMs: number | null;
  rawResponse: string | null;
  createdAt: string;
}
interface DimensionSpec {
  name: string;
  weight: number;
  definition: string;
  standards: Array<{ min: number; max: number; description: string }>;
  bonus: string;
  penalty: string;
  notes: string;
}
interface RuleVersionItem {
  id: string;
  ruleId: string;
  version: string;
  dimensions: DimensionSpec[];
  qualityThreshold: number;
  maxAutoOptimizeRounds: number;
  promptId: string | null;
  status: string;
  createdAt: string | null;
  publishedAt: string | null;
}
interface RuleWithVersions {
  rule: { id: string; name: string; description: string | null; currentVersionId: string | null };
  versions: RuleVersionItem[];
}
interface PromptItem {
  id: string;
  name: string;
  version: string;
  content: string;
  ruleVersionId: string | null;
  modelHint: string | null;
  changeNote: string | null;
  createdAt: string;
}
interface Stats {
  totalRecords: number;
  qualifiedRecords: number;
  passRate: number;
  avgScore: number | null;
  avgOptimizeRound: number | null;
  totalStories: number;
  passedStories: number;
  poolStories: number;
}

const TASK_TYPE_BADGE: Record<string, { tone: 'info' | 'running' | 'success' | 'warning' | 'danger'; label: string }> = {
  CREATE_NOVEL: { tone: 'running', label: '整篇创作' },
  AI_SUGGEST: { tone: 'info', label: '字段建议' },
  AI_GENERATE: { tone: 'info', label: '字段生成' },
  AI_OPTIMIZE: { tone: 'info', label: '字段优化' },
  AI_OPTIMIZE_STORY: { tone: 'warning', label: '手动优化' },
  AI_REVIEW: { tone: 'running', label: '重新评审' },
  AI_REVIEW_RETRY: { tone: 'running', label: '重试评审' },
};
const TASK_STATUS_TONE: Record<string, 'success' | 'warning' | 'danger' | 'info' | 'running'> = {
  SUCCESS: 'success',
  PENDING: 'info',
  RUNNING: 'running',
  FAILED: 'danger',
  CANCELLED: 'warning',
};
const RULE_STATUS_TONE: Record<string, 'success' | 'warning' | 'danger' | 'info'> = {
  published: 'success',
  draft: 'info',
  testing: 'warning',
  disabled: 'danger',
};

/** 维度编辑器的四档固定分带 */
const STD_BANDS: Array<{ min: number; max: number; label: string }> = [
  { min: 90, max: 100, label: '90-100 分档' },
  { min: 70, max: 89, label: '70-89 分档' },
  { min: 60, max: 69, label: '60-69 分档' },
  { min: 0, max: 59, label: '0-59 分档' },
];

interface EditorDim {
  name: string;
  weight: number;
  definition: string;
  bonus: string;
  penalty: string;
  notes: string;
  std: string[];
}

function dimsToEditor(dimensions: DimensionSpec[]): EditorDim[] {
  return dimensions.map((d) => ({
    name: d.name,
    weight: d.weight,
    definition: d.definition ?? '',
    bonus: d.bonus ?? '',
    penalty: d.penalty ?? '',
    notes: d.notes ?? '',
    std: STD_BANDS.map((band) => d.standards.find((s) => s.min === band.min && s.max === band.max)?.description ?? ''),
  }));
}

export default function AdminReviewCenterPage() {
  const [tab, setTab] = useState<'tasks' | 'records' | 'rules' | 'prompts' | 'stats'>('tasks');
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [storyTitles, setStoryTitles] = useState<Record<string, string>>({});

  // tasks
  const [tasks, setTasks] = useState<TaskItem[] | null>(null);
  const [taskDetail, setTaskDetail] = useState<TaskItem | null>(null);
  const [retryingId, setRetryingId] = useState<string | null>(null);

  // records
  const [records, setRecords] = useState<RecordItem[] | null>(null);
  const [recordDetail, setRecordDetail] = useState<RecordItem | null>(null);

  // rules
  const [rules, setRules] = useState<RuleWithVersions[] | null>(null);
  const [ruleEditor, setRuleEditor] = useState<{
    ruleId: string | null;
    ruleName: string;
    ruleDescription: string;
    versionId: string | null;
    baseVersionLabel: string;
    qualityThreshold: number;
    maxAutoOptimizeRounds: number;
    dims: EditorDim[];
  } | null>(null);
  const [savingRule, setSavingRule] = useState(false);
  const [disableTarget, setDisableTarget] = useState<{ vid: string; label: string } | null>(null);

  // prompts
  const [promptGroups, setPromptGroups] = useState<Array<{ name: string; versions: PromptItem[] }> | null>(null);
  const [promptEditor, setPromptEditor] = useState<{
    name: string;
    content: string;
    changeNote: string;
    ruleVersionId: string;
  } | null>(null);
  const [savingPrompt, setSavingPrompt] = useState(false);

  const loadAll = useCallback(async (): Promise<void> => {
    setError(null);
    try {
      const [stories, tasksRes, recordsRes, rulesRes, promptsRes] = await Promise.all([
        api<{ stories: Array<{ id: string; title: string }> }>('/api/admin/short-stories?limit=500'),
        api<{ tasks: TaskItem[] }>('/api/admin/ai/tasks?limit=200'),
        api<{ records: RecordItem[] }>('/api/admin/review-records?limit=200'),
        api<{ rules: RuleWithVersions[] }>('/api/admin/review-rules'),
        api<{ groups: Array<{ name: string; versions: PromptItem[] }> }>('/api/admin/review-prompts?grouped=1'),
      ]);
      setStoryTitles(Object.fromEntries(stories.stories.map((s) => [s.id, s.title])));
      setTasks(tasksRes.tasks);
      setRecords(recordsRes.records);
      setRules(rulesRes.rules);
      setPromptGroups(promptsRes.groups);
    } catch (err) {
      setError(err instanceof Error ? err.message : '加载失败');
    }
  }, []);

  useEffect(() => {
    void loadAll();
  }, [loadAll]);

  const retryTask = async (id: string): Promise<void> => {
    setRetryingId(id);
    try {
      await api(`/api/admin/ai/tasks/${id}/retry`, { method: 'POST' });
      setNotice('任务已重新入队');
      setTimeout(() => void loadAll(), 1500);
    } catch (err) {
      setError(err instanceof Error ? err.message : '重试失败');
    } finally {
      setRetryingId(null);
    }
  };

  // ---------- 规则编辑 ----------

  const openNewVersionFrom = (rw: RuleWithVersions, source?: RuleVersionItem): void => {
    const base = source ?? rw.versions[rw.versions.length - 1];
    setRuleEditor({
      ruleId: rw.rule.id,
      ruleName: rw.rule.name,
      ruleDescription: rw.rule.description ?? '',
      versionId: null,
      baseVersionLabel: base?.version ?? '(新)',
      qualityThreshold: base?.qualityThreshold ?? 80,
      maxAutoOptimizeRounds: base?.maxAutoOptimizeRounds ?? 3,
      dims: dimsToEditor(base?.dimensions ?? []),
    });
  };

  const openEditDraft = (rw: RuleWithVersions, v: RuleVersionItem): void => {
    if (v.status !== 'draft' && v.status !== 'testing') return;
    setRuleEditor({
      ruleId: rw.rule.id,
      ruleName: rw.rule.name,
      ruleDescription: rw.rule.description ?? '',
      versionId: v.id,
      baseVersionLabel: v.version,
      qualityThreshold: v.qualityThreshold,
      maxAutoOptimizeRounds: v.maxAutoOptimizeRounds,
      dims: dimsToEditor(v.dimensions),
    });
  };

  const saveRuleEditor = async (): Promise<void> => {
    if (!ruleEditor) return;
    setSavingRule(true);
    setError(null);
    try {
      const dimensions = ruleEditor.dims.map((d) => ({
        name: d.name.trim(),
        weight: Number(d.weight),
        definition: d.definition,
        bonus: d.bonus,
        penalty: d.penalty,
        notes: d.notes,
        standards: STD_BANDS.map((b, bi) => ({ min: b.min, max: b.max, description: d.std[bi] ?? '' })).filter(
          (x) => x.description.trim() !== ''
        ),
      }));
      if (ruleEditor.versionId) {
        await api(`/api/admin/review-rule-versions/${ruleEditor.versionId}`, {
          method: 'PUT',
          body: JSON.stringify({ dimensions, qualityThreshold: ruleEditor.qualityThreshold, maxAutoOptimizeRounds: ruleEditor.maxAutoOptimizeRounds }),
        });
        setNotice('草稿已保存');
      } else if (ruleEditor.ruleId) {
        await api(`/api/admin/review-rules/${ruleEditor.ruleId}/versions`, {
          method: 'POST',
          body: JSON.stringify({ dimensions, qualityThreshold: ruleEditor.qualityThreshold, maxAutoOptimizeRounds: ruleEditor.maxAutoOptimizeRounds }),
        });
        setNotice('新版本已创建(draft)');
      } else {
        await api('/api/admin/review-rules', {
          method: 'POST',
          body: JSON.stringify({
            name: ruleEditor.ruleName,
            description: ruleEditor.ruleDescription || null,
            dimensions,
            qualityThreshold: ruleEditor.qualityThreshold,
            maxAutoOptimizeRounds: ruleEditor.maxAutoOptimizeRounds,
          }),
        });
        setNotice('规则已创建(draft)');
      }
      setRuleEditor(null);
      await loadAll();
    } catch (err) {
      setError(err instanceof Error ? err.message : '保存失败');
    } finally {
      setSavingRule(false);
    }
  };

  const publishVersion = async (vid: string): Promise<void> => {
    try {
      await api(`/api/admin/review-rule-versions/${vid}/publish`, { method: 'POST' });
      setNotice('已发布为当前生效版本');
      await loadAll();
    } catch (err) {
      setError(err instanceof Error ? err.message : '发布失败');
    }
  };

  const disableVersion = async (): Promise<void> => {
    if (!disableTarget) return;
    try {
      await api(`/api/admin/review-rule-versions/${disableTarget.vid}/disable`, { method: 'POST' });
      setNotice('已停用');
      setDisableTarget(null);
      await loadAll();
    } catch (err) {
      setError(err instanceof Error ? err.message : '停用失败');
    }
  };

  // ---------- Prompt 新版本 ----------

  const savePromptVersion = async (): Promise<void> => {
    if (!promptEditor) return;
    setSavingPrompt(true);
    setError(null);
    try {
      await api('/api/admin/review-prompts', {
        method: 'POST',
        body: JSON.stringify({
          name: promptEditor.name.trim(),
          content: promptEditor.content,
          changeNote: promptEditor.changeNote || null,
          ruleVersionId: promptEditor.ruleVersionId || null,
        }),
      });
      setNotice('Prompt 新版本已创建');
      setPromptEditor(null);
      await loadAll();
    } catch (err) {
      setError(err instanceof Error ? err.message : '保存失败');
    } finally {
      setSavingPrompt(false);
    }
  };

  // ---------- 渲染 ----------

  const renderTasks = (): React.ReactNode =>
    tasks === null ? (
      <p className="py-10 text-center"><Spinner /></p>
    ) : tasks.length === 0 ? (
      <EmptyState icon={<FileSearch size={24} />} title="暂无 AI 任务" description="在「AI 创作中心」启动创作后,这里展示全部任务历史" />
    ) : (
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="bg-[#f8fafc] text-left text-xs text-[#64748b]">
              <th className="px-4 py-3 font-medium">类型</th>
              <th className="px-4 py-3 font-medium">目标</th>
              <th className="px-4 py-3 font-medium">状态</th>
              <th className="px-4 py-3 font-medium">评分</th>
              <th className="px-4 py-3 font-medium">模型 / 尝试</th>
              <th className="px-4 py-3 font-medium">耗时</th>
              <th className="px-4 py-3 font-medium">创建时间</th>
              <th className="px-4 py-3 font-medium">操作</th>
            </tr>
          </thead>
          <tbody>
            {tasks.map((t) => {
              const outScore = typeof t.output?.score === 'number' ? t.output.score : null;
              return (
                <tr key={t.id} className="group border-b border-[#f1f5f9] transition-all duration-150 hover:bg-[#f8fafc]/60">
                  <td className="px-4 py-3">
                    <Badge tone={TASK_TYPE_BADGE[t.type]?.tone ?? 'info'}>{TASK_TYPE_BADGE[t.type]?.label ?? t.type}</Badge>
                  </td>
                  <td className="max-w-[180px] truncate px-4 py-3 text-[#334155]">{t.refId ? storyTitles[t.refId] ?? t.refId : '—'}</td>
                  <td className="px-4 py-3">
                    <Badge tone={TASK_STATUS_TONE[t.status] ?? 'info'}>{t.status}</Badge>
                  </td>
                  <td className="px-4 py-3 font-medium text-[#1677ff]">{outScore !== null ? `${outScore} 分` : '—'}</td>
                  <td className="px-4 py-3 text-xs text-[#64748b]">
                    {t.modelName ?? '—'}
                    {t.attempt > 1 ? ` · 第${t.attempt}次` : ''}
                  </td>
                  <td className="px-4 py-3 text-xs text-[#64748b]">{t.durationMs !== null ? `${(t.durationMs / 1000).toFixed(1)}s` : '—'}</td>
                  <td className="px-4 py-3 text-xs text-[#94a3b8]">{formatChinaTime(t.createdAt)}</td>
                  <td className="px-4 py-3">
                    <span className="flex gap-1 opacity-0 transition-opacity duration-150 group-hover:opacity-100 group-focus-within:opacity-100">
                      <Button variant="ghost" size="xs" onClick={() => setTaskDetail(t)}>
                        详情
                      </Button>
                      {t.status === 'FAILED' ? (
                        <Button variant="ghost" size="xs" disabled={retryingId === t.id} onClick={() => void retryTask(t.id)}>
                          <RefreshCw size={12} /> 重试
                        </Button>
                      ) : null}
                    </span>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    );

  const renderRecords = (): React.ReactNode =>
    records === null ? (
      <p className="py-10 text-center"><Spinner /></p>
    ) : records.length === 0 ? (
      <EmptyState icon={<FileSearch size={24} />} title="暂无评审记录" description="自动评审完成后,每一次评审的完整链路都会留痕于此" />
    ) : (
      <div className="space-y-2">
        {records.map((r) => (
          <div key={r.id} className="group flex flex-wrap items-center gap-3 rounded-xl border border-[#f1f5f9] px-4 py-3 transition-all duration-150 hover:-translate-y-px hover:shadow-sm">
            <span className={`text-lg font-bold ${r.qualified ? 'text-[#047857]' : 'text-[#b45309]'}`}>{r.score}</span>
            <Badge tone={r.level === 'S' || r.level === 'A' ? 'success' : r.level === 'B' ? 'info' : 'warning'}>{r.level}</Badge>
            <span className="min-w-0 flex-1 truncate text-sm text-[#0f172a]">{storyTitles[r.storyId] ?? r.storyId}</span>
            <span className="text-xs text-[#94a3b8]">
              规则 {r.ruleVersion} · Prompt {r.promptVersion ?? '—'} · {r.modelName ?? '—'}
            </span>
            <span className="text-xs text-[#94a3b8]">
              第{r.reviewRound}评 · 已优{r.optimizationRound} · {formatChinaTime(r.createdAt)}
            </span>
            <span className="flex opacity-0 transition-opacity duration-150 group-hover:opacity-100 group-focus-within:opacity-100">
              <Button variant="ghost" size="xs" onClick={() => setRecordDetail(r)}>
                查看全链路
              </Button>
            </span>
          </div>
        ))}
      </div>
    );

  const renderRules = (): React.ReactNode =>
    rules === null ? (
      <p className="py-10 text-center"><Spinner /></p>
    ) : (
      <div className="space-y-5">
        <div className="flex justify-end">
          <Button variant="primary" size="sm" onClick={() => setRuleEditor({ ruleId: null, ruleName: '', ruleDescription: '', versionId: null, baseVersionLabel: '(新)', qualityThreshold: 80, maxAutoOptimizeRounds: 3, dims: [{ name: '', weight: 100, definition: '', bonus: '', penalty: '', notes: '', std: ['', '', '', ''] }] })}>
            <Plus size={14} /> 新建规则
          </Button>
        </div>
        {rules.map((rw) => (
          <div key={rw.rule.id} className="rounded-xl border border-[#f1f5f9] p-4">
            <div className="mb-3 flex items-center justify-between">
              <div>
                <h3 className="text-sm font-semibold text-[#0f172a]">{rw.rule.name}</h3>
                {rw.rule.description ? <p className="text-xs text-[#94a3b8]">{rw.rule.description}</p> : null}
              </div>
              <Button variant="secondary" size="xs" onClick={() => openNewVersionFrom(rw)}>
                <Plus size={12} /> 基于最新版新建版本
              </Button>
            </div>
            <div className="space-y-2">
              {rw.versions.map((v) => (
                <div key={v.id} className="flex flex-wrap items-center gap-3 rounded-lg bg-[#f8fafc] px-3 py-2.5 text-sm">
                  <span className="font-medium text-[#1677ff]">{v.version}</span>
                  <Badge tone={RULE_STATUS_TONE[v.status] ?? 'info'}>{{ published: '生效中', draft: '草稿', testing: '测试中', disabled: '已停用' }[v.status] ?? v.status}</Badge>
                  <span className="text-xs text-[#64748b]">阈值 {v.qualityThreshold} · 最多优化 {v.maxAutoOptimizeRounds} 轮 · {v.dimensions.length} 个维度</span>
                  <span className="ml-auto text-xs text-[#94a3b8]">{v.publishedAt ? `发布于 ${formatChinaTime(v.publishedAt)}` : ''}</span>
                  <span className="flex gap-1">
                    {v.status === 'draft' || v.status === 'testing' ? (
                      <Button variant="ghost" size="xs" onClick={() => openEditDraft(rw, v)}>
                        <Pencil size={12} /> 编辑
                      </Button>
                    ) : null}
                    {v.status !== 'published' && v.status !== 'disabled' ? (
                      <Button variant="ghost" size="xs" onClick={() => void publishVersion(v.id)}>
                        <Send size={12} /> 发布
                      </Button>
                    ) : null}
                    {v.status === 'published' || v.status === 'draft' || v.status === 'testing' ? (
                      <Button variant="ghost" size="xs" onClick={() => setDisableTarget({ vid: v.id, label: `${rw.rule.name} ${v.version}` })}>
                        <Trash2 size={12} /> 停用
                      </Button>
                    ) : null}
                  </span>
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>
    );

  const renderPrompts = (): React.ReactNode =>
    promptGroups === null ? (
      <p className="py-10 text-center"><Spinner /></p>
    ) : (
      <div className="space-y-5">
        <div className="flex justify-end">
          <Button variant="primary" size="sm" onClick={() => setPromptEditor({ name: '', content: '', changeNote: '', ruleVersionId: '' })}>
            <Plus size={14} /> 新建 Prompt 版本
          </Button>
        </div>
        {promptGroups.map((g) => (
          <div key={g.name} className="rounded-xl border border-[#f1f5f9] p-4">
            <h3 className="mb-3 text-sm font-semibold text-[#0f172a]">{g.name}</h3>
            <div className="space-y-2">
              {g.versions.map((p) => (
                <details key={p.id} className="rounded-lg bg-[#f8fafc] px-3 py-2.5">
                  <summary className="cursor-pointer list-none text-sm">
                    <span className="font-medium text-[#1677ff]">{p.version}</span>
                    <span className="ml-3 text-xs text-[#94a3b8]">
                      {formatChinaTime(p.createdAt)}
                      {p.changeNote ? ` · ${p.changeNote}` : ''}
                    </span>
                  </summary>
                  <pre className="mt-2 max-h-[300px] overflow-y-auto whitespace-pre-wrap rounded-md bg-white p-3 text-xs leading-relaxed text-[#334155]">{p.content}</pre>
                </details>
              ))}
            </div>
          </div>
        ))}
      </div>
    );

  return (
    <div>
      {error ? <Notice tone="error">{error}</Notice> : null}
      {notice ? <Notice tone="success">{notice}</Notice> : null}

      <div className="mb-5 rounded-xl bg-white p-5 shadow-sm">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <span className="flex h-11 w-11 items-center justify-center rounded-xl bg-gradient-to-br from-[#0ea5e9] to-[#2563eb] text-white">
              <FileSearch size={20} />
            </span>
            <div>
              <h1 className="text-lg font-bold text-[#0f172a]">AI 评审中心</h1>
              <p className="text-xs text-[#94a3b8]">评审任务 · 全链路记录 · 规则版本化 · Prompt 版本化 · 质量数据</p>
            </div>
          </div>
          <Tabs
            tabs={[
              { key: 'tasks', label: '评审任务' },
              { key: 'records', label: '评审记录' },
              { key: 'rules', label: '评审规则' },
              { key: 'prompts', label: 'Prompt 版本' },
              { key: 'stats', label: '质量数据' },
            ]}
            value={tab}
            onChange={setTab}
          />
        </div>
      </div>

      <div className="rounded-xl bg-white p-5 shadow-sm">
        {tab === 'tasks' ? renderTasks() : null}
        {tab === 'records' ? renderRecords() : null}
        {tab === 'rules' ? renderRules() : null}
        {tab === 'prompts' ? renderPrompts() : null}
        {tab === 'stats' ? null : null}
      </div>

      {/* 任务详情 */}
      <Modal open={taskDetail !== null} title="任务详情" onClose={() => setTaskDetail(null)}>
        {taskDetail ? (
          <div className="space-y-3 text-sm">
            <div className="grid grid-cols-2 gap-2 text-xs text-[#64748b]">
              <span>ID:{taskDetail.id}</span>
              <span>类型:{TASK_TYPE_BADGE[taskDetail.type]?.label ?? taskDetail.type}</span>
              <span>状态:{taskDetail.status}</span>
              <span>尝试次数:{taskDetail.attempt}</span>
              <span>模型:{taskDetail.modelName ?? '—'}</span>
              <span>耗时:{taskDetail.durationMs !== null ? `${(taskDetail.durationMs / 1000).toFixed(1)}s` : '—'}</span>
            </div>
            {taskDetail.error ? <pre className="max-h-[160px] overflow-auto whitespace-pre-wrap rounded-lg bg-[#fef2f2] p-3 text-xs text-[#b91c1c]">{taskDetail.error}</pre> : null}
            {taskDetail.output ? <pre className="max-h-[200px] overflow-auto whitespace-pre-wrap rounded-lg bg-[#f8fafc] p-3 text-xs text-[#334155]">{JSON.stringify(taskDetail.output, null, 2)}</pre> : null}
            {taskDetail.prompt ? (
              <details>
                <summary className="cursor-pointer text-xs text-[#1677ff]">查看完整 Prompt</summary>
                <pre className="mt-2 max-h-[240px] overflow-auto whitespace-pre-wrap rounded-lg bg-[#f8fafc] p-3 text-xs text-[#64748b]">{taskDetail.prompt}</pre>
              </details>
            ) : null}
          </div>
        ) : null}
      </Modal>

      {/* 记录全链路 */}
      <Modal open={recordDetail !== null} title="评审记录 · 全链路追溯" onClose={() => setRecordDetail(null)} footer={
        recordDetail && recordDetail.rawResponse ? (
          <details className="w-full">
            <summary className="cursor-pointer text-xs text-[#1677ff]">查看模型原始响应</summary>
            <pre className="mt-2 max-h-[200px] overflow-auto whitespace-pre-wrap rounded-lg bg-[#f8fafc] p-3 text-xs text-[#64748b]">{recordDetail.rawResponse.slice(0, 4000)}</pre>
          </details>
        ) : null
      }>
        {recordDetail ? (
          <div className="space-y-4 text-sm">
            <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-xs text-[#64748b]">
              <span>小说:{storyTitles[recordDetail.storyId] ?? recordDetail.storyId}</span>
              <span>评审时间:{formatChinaTime(recordDetail.createdAt)}</span>
              <span>规则版本:{recordDetail.ruleVersion}</span>
              <span>Prompt 版本:{recordDetail.promptVersion ?? '—'}</span>
              <span>模型:{recordDetail.modelName ?? '—'}</span>
              <span>第 {recordDetail.reviewRound} 次评审 · 第 {recordDetail.optimizationRound} 次优化后</span>
            </div>
            <div>
              <p className="mb-1 text-xs font-semibold text-[#334155]">维度明细</p>
              <div className="space-y-1">
                {recordDetail.dimensionScores.map((d) => (
                  <div key={d.name} className="rounded-md bg-[#f8fafc] px-3 py-1.5 text-xs">
                    <span className="mr-2 font-medium text-[#0f172a]">{d.name}</span>
                    <span className="text-[#1677ff]">{Math.round((d.score * d.maxScore) / 100)}/{d.maxScore}(原始 {d.score})</span>
                    {d.reason ? <p className="mt-0.5 text-[#94a3b8]">{d.reason}</p> : null}
                  </div>
                ))}
              </div>
            </div>
            {recordDetail.summary ? <p className="rounded-lg bg-[#f8fafc] p-3 text-xs leading-relaxed text-[#64748b]">{recordDetail.summary}</p> : null}
          </div>
        ) : null}
      </Modal>

      {/* 规则编辑器 */}
      <Modal
        open={ruleEditor !== null}
        title={ruleEditor ? (ruleEditor.ruleId ? (ruleEditor.versionId ? `编辑版本 ${ruleEditor.baseVersionLabel}` : `基于 ${ruleEditor.baseVersionLabel} 新建版本`) : '新建评审规则') : ''}
        onClose={() => setRuleEditor(null)}
        footer={
          <>
            <Button variant="secondary" onClick={() => setRuleEditor(null)} disabled={savingRule}>
              取消
            </Button>
            <Button variant="primary" onClick={() => void saveRuleEditor()} disabled={savingRule}>
              {savingRule ? <Spinner size={13} /> : null} 保存
            </Button>
          </>
        }
      >
        {ruleEditor ? (
          <div className="max-h-[60vh] space-y-4 overflow-y-auto pr-1">
            {!ruleEditor.ruleId ? (
              <div className="grid grid-cols-1 gap-3">
                <Field label="规则名称">
                  <Input value={ruleEditor.ruleName} onChange={(e) => setRuleEditor({ ...ruleEditor, ruleName: e.target.value })} placeholder="如:悬疑短篇评审标准" />
                </Field>
                <Field label="描述">
                  <Input value={ruleEditor.ruleDescription} onChange={(e) => setRuleEditor({ ...ruleEditor, ruleDescription: e.target.value })} />
                </Field>
              </div>
            ) : null}
            <div className="grid grid-cols-2 gap-3">
              <Field label="质量阈值(总分≥)">
                <Input
                  type="number"
                  min={0}
                  max={100}
                  value={ruleEditor.qualityThreshold}
                  onChange={(e) => setRuleEditor({ ...ruleEditor, qualityThreshold: Number(e.target.value) || 0 })}
                />
              </Field>
              <Field label="最大自动优化轮数">
                <Input
                  type="number"
                  min={0}
                  max={10}
                  value={ruleEditor.maxAutoOptimizeRounds}
                  onChange={(e) => setRuleEditor({ ...ruleEditor, maxAutoOptimizeRounds: Number(e.target.value) || 0 })}
                />
              </Field>
            </div>
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <p className="text-sm font-medium text-[#334155]">
                  评分维度(权重合计必须为 100,当前 {ruleEditor.dims.reduce((acc, d) => acc + (Number(d.weight) || 0), 0)})
                </p>
                <Button
                  variant="ghost"
                  size="xs"
                  onClick={() => setRuleEditor({ ...ruleEditor, dims: [...ruleEditor.dims, { name: '', weight: 10, definition: '', bonus: '', penalty: '', notes: '', std: ['', '', '', ''] }] })}
                >
                  <Plus size={12} /> 加维度
                </Button>
              </div>
              {ruleEditor.dims.map((d, i) => (
                <div key={i} className="rounded-lg border border-[#e2e8f0] p-3">
                  <div className="flex items-center gap-2">
                    <Input className="h-8 flex-1" value={d.name} placeholder={`维度 ${i + 1} 名称`} onChange={(e) => setRuleEditor({ ...ruleEditor, dims: ruleEditor.dims.map((x, xi) => (xi === i ? { ...x, name: e.target.value } : x)) })} />
                    <Input
                      className="h-8 w-24"
                      type="number"
                      min={1}
                      max={100}
                      value={d.weight}
                      onChange={(e) => setRuleEditor({ ...ruleEditor, dims: ruleEditor.dims.map((x, xi) => (xi === i ? { ...x, weight: Number(e.target.value) } : x)) })}
                      placeholder="权重%"
                    />
                    <Button variant="ghost" size="xs" onClick={() => setRuleEditor({ ...ruleEditor, dims: ruleEditor.dims.filter((_, xi) => xi !== i) })}>
                      <Trash2 size={12} />
                    </Button>
                  </div>
                  <Textarea className="mt-2 min-h-[48px]" value={d.definition} placeholder="维度定义" onChange={(e) => setRuleEditor({ ...ruleEditor, dims: ruleEditor.dims.map((x, xi) => (xi === i ? { ...x, definition: e.target.value } : x)) })} />
                  <div className="mt-2 grid grid-cols-1 gap-1.5 md:grid-cols-2">
                    {STD_BANDS.map((b, bi) => (
                      <Input
                        key={bi}
                        className="h-8 text-xs"
                        value={d.std[bi]}
                        placeholder={`${b.label}:评分标准描述`}
                        onChange={(e) =>
                          setRuleEditor({ ...ruleEditor, dims: ruleEditor.dims.map((x, xi) => (xi === i ? { ...x, std: x.std.map((sv, si) => (si === bi ? e.target.value : sv)) } : x)) })
                        }
                      />
                    ))}
                  </div>
                  <div className="mt-1.5 grid grid-cols-1 gap-1.5 md:grid-cols-3">
                    <Input className="h-8 text-xs" value={d.bonus} placeholder="加分条件" onChange={(e) => setRuleEditor({ ...ruleEditor, dims: ruleEditor.dims.map((x, xi) => (xi === i ? { ...x, bonus: e.target.value } : x)) })} />
                    <Input className="h-8 text-xs" value={d.penalty} placeholder="扣分条件" onChange={(e) => setRuleEditor({ ...ruleEditor, dims: ruleEditor.dims.map((x, xi) => (xi === i ? { ...x, penalty: e.target.value } : x)) })} />
                    <Input className="h-8 text-xs" value={d.notes} placeholder="评审说明" onChange={(e) => setRuleEditor({ ...ruleEditor, dims: ruleEditor.dims.map((x, xi) => (xi === i ? { ...x, notes: e.target.value } : x)) })} />
                  </div>
                </div>
              ))}
            </div>
          </div>
        ) : null}
      </Modal>

      {/* Prompt 新版本 */}
      <Modal
        open={promptEditor !== null}
        title="新建 Prompt 版本(同名即迭代)"
        onClose={() => setPromptEditor(null)}
        footer={
          <>
            <Button variant="secondary" onClick={() => setPromptEditor(null)} disabled={savingPrompt}>
              取消
            </Button>
            <Button variant="primary" onClick={() => void savePromptVersion()} disabled={savingPrompt}>
              {savingPrompt ? <Spinner size={13} /> : null} 创建版本
            </Button>
          </>
        }
      >
        {promptEditor ? (
          <div className="space-y-3">
            <Field label="名称(已有名称将自动递增小版本)">
              <Input
                value={promptEditor.name}
                onChange={(e) => setPromptEditor({ ...promptEditor, name: e.target.value })}
                placeholder={promptGroups && promptGroups.length > 0 ? `如:${promptGroups[0].name}` : '如:短篇评审'}
                list="prompt-names"
              />
            </Field>
            <datalist id="prompt-names">
              {(promptGroups ?? []).map((g) => (
                <option key={g.name} value={g.name} />
              ))}
            </datalist>
            <Field label="内容">
              <Textarea className="min-h-[220px] font-mono text-xs" value={promptEditor.content} onChange={(e) => setPromptEditor({ ...promptEditor, content: e.target.value })} placeholder="评审指令模板…" />
            </Field>
            <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
              <Field label="修改说明">
                <Input value={promptEditor.changeNote} onChange={(e) => setPromptEditor({ ...promptEditor, changeNote: e.target.value })} placeholder="为什么改这一版" />
              </Field>
              <Field label="关联规则版本(可选)">
                <Select value={promptEditor.ruleVersionId} onChange={(e) => setPromptEditor({ ...promptEditor, ruleVersionId: e.target.value })}>
                  <option value="">不关联</option>
                  {(rules ?? []).flatMap((rw) =>
                    rw.versions.map((v) => (
                      <option key={v.id} value={v.id}>
                        {rw.rule.name} {v.version}({v.status})
                      </option>
                    ))
                  )}
                </Select>
              </Field>
            </div>
          </div>
        ) : null}
      </Modal>

      {/* 停用确认 */}
      <ConfirmDialog
        open={disableTarget !== null}
        title="停用规则版本"
        description={`确定停用 ${disableTarget?.label ?? ''}?若它是当前唯一生效版本,自动评审将不可用,直到发布新版本。`}
        confirmText="确认停用"
        loading={false}
        onConfirm={() => void disableVersion()}
        onCancel={() => setDisableTarget(null)}
      />

      {/* 质量数据 */}
      {tab === 'stats' ? <QualityStats /> : null}
    </div>
  );
}

// ---------- 质量数据子组件 ----------

function QualityStats(): React.ReactElement {
  const [stats, setStats] = useState<Stats | null>(null);
  useEffect(() => {
    api<{ stats: Stats }>('/api/admin/review/stats')
      .then((res) => setStats(res.stats))
      .catch(() => setStats(null));
  }, []);
  const cards: Array<{ label: string; value: string; hint?: string }> = stats
    ? [
        { label: '累计评审', value: String(stats.totalRecords), hint: `${stats.totalStories} 篇作品` },
        { label: '达标率', value: `${stats.passRate}%` },
        { label: '平均分', value: stats.avgScore !== null ? String(stats.avgScore) : '—' },
        { label: '平均优化次数', value: stats.avgOptimizeRound !== null ? String(stats.avgOptimizeRound) : '—' },
        { label: '已达标作品', value: String(stats.passedStories) },
        { label: '低质量池', value: String(stats.poolStories), hint: '三轮优化仍未达标的篇目' },
      ]
    : [];
  return (
    <div className="mt-5 grid grid-cols-2 gap-4 md:grid-cols-3 lg:grid-cols-6">
      {stats === null ? (
        <p className="col-span-full py-8 text-center text-sm text-[#94a3b8]">统计加载中…</p>
      ) : (
        cards.map((c) => (
          <div key={c.label} className="rounded-xl border border-[#f1f5f9] p-4">
            <p className="text-xs text-[#94a3b8]">{c.label}</p>
            <p className="mt-1 text-2xl font-bold text-[#0f172a]">{c.value}</p>
            {c.hint ? <p className="mt-1 text-[11px] text-[#cbd5e1]">{c.hint}</p> : null}
          </div>
        ))
      )}
    </div>
  );
}
