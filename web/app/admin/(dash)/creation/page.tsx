'use client';

// AI 创作中心(V9 规格书 §4-§9):一级 Tab 短篇/长篇(默认短篇);
// 短篇 = 创作表单(字段级 AI建议/生成/优化)+ 整篇创作流水线进度视图 + 评审结果与版本时间线。
// 长篇 Tab 第一阶段为占位,链接既有「长篇工作台」(/admin/story)。

import {
  BookOpen,
  CalendarClock,
  CheckCircle2,
  ChevronLeft,
  Edit,
  Eye,
  ExternalLink,
  ListChecks,
  Pencil,
  Plus,
  RefreshCw,
  Send,
  Sparkles,
  Trash2,
  XCircle,
} from 'lucide-react';
import Link from 'next/link';
import { useCallback, useEffect, useRef, useState } from 'react';
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
  Spinner,
  Tabs,
  Textarea,
} from '@/components/admin/ui';

// ---------- 类型 ----------

interface StoryBrief {
  [key: string]: string | number | undefined;
}
interface ShortStory {
  id: string;
  title: string;
  status: string; // draft|scheduled|generating|reviewing|optimizing|passed|pool|failed
  brief: StoryBrief;
  currentVersionId: string | null;
  sourceUrl: string | null;
  scheduledAt: string | null;
  reviewRound: number;
  optimizeRound: number;
  manualOptimizeRound: number;
  lastScore: number | null;
  createdAt: string;
  updatedAt: string;
}
interface StoryVersion {
  id: string;
  storyId: string;
  version: number;
  content: string;
  charCount: number;
  creationReason: string;
  isFinal: boolean;
  createdAt: string;
}
interface DimensionScore {
  name: string;
  score: number;
  maxScore: number;
  reason: string;
}
interface ReviewRecordLite {
  id: string;
  storyVersionId: string;
  ruleVersion: string;
  promptVersion: string | null;
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
  createdAt: string;
}
interface AiTaskLite {
  id: string;
  type: string;
  status: string;
  error: string | null;
  createdAt: string;
}
interface StoryDetail {
  story: ShortStory;
  versions: StoryVersion[];
  latestReviews: Record<string, ReviewRecordLite>;
  tasks: AiTaskLite[];
  publication: { id: string; bookId: string; versionId: string; publishedAt: string } | null;
}
interface StoryListItem extends ShortStory {
  versionCount: number;
  publicationId: string | null;
  publishedBookId: string | null;
  publishedAt: string | null;
}
interface BatchSchedule {
  id: string;
  scheduledAt: string;
  count: number;
  brief: StoryBrief;
  status: 'pending' | 'executing' | 'done' | 'failed' | 'cancelled';
  storyIds: string[];
  error: string | null;
  executedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

type AssistAction = 'suggest' | 'generate' | 'optimize';

interface AssistModalState {
  fieldKey: string;
  label: string;
  action: AssistAction;
  phase: 'loading' | 'done' | 'failed';
  taskId: string | null;
  options: string[];
  result: string;
  editBuffer: string;
  editing: boolean;
  error: string | null;
}

// ---------- 字段定义(键与 core SHORT_STORY_FIELD_LABELS 对齐) ----------

const GROUPS: Array<{ title: string; fields: Array<{ key: string; label: string; type: 'text' | 'area' | 'number' }> }> = [
  {
    title: '基础信息',
    fields: [
      { key: 'theme', label: '小说主题', type: 'text' },
      { key: 'genre', label: '小说类型', type: 'text' },
      { key: 'direction', label: '故事方向', type: 'text' },
      { key: 'coreConflict', label: '核心冲突', type: 'area' },
      { key: 'background', label: '故事背景', type: 'area' },
      { key: 'characters', label: '人物设定', type: 'area' },
    ],
  },
  {
    title: '故事结构',
    fields: [
      { key: 'synopsis', label: '故事梗概', type: 'area' },
      { key: 'beginning', label: '开端', type: 'area' },
      { key: 'development', label: '发展', type: 'area' },
      { key: 'conflictBeat', label: '冲突', type: 'area' },
      { key: 'climax', label: '高潮', type: 'area' },
      { key: 'endingPlot', label: '结局', type: 'area' },
    ],
  },
  {
    title: '创作参数',
    fields: [
      { key: 'targetWords', label: '目标字数(≤6000)', type: 'number' },
      { key: 'narrativePerspective', label: '叙事视角', type: 'text' },
      { key: 'languageStyle', label: '语言风格', type: 'text' },
      { key: 'emotionalTone', label: '情绪基调', type: 'text' },
      { key: 'pacing', label: '故事节奏', type: 'text' },
      { key: 'endingType', label: '结局类型', type: 'text' },
    ],
  },
];

const STORY_STATUS_BADGE: Record<string, { tone: 'success' | 'warning' | 'danger' | 'info' | 'running'; label: string }> = {
  draft: { tone: 'info', label: '草稿' },
  scheduled: { tone: 'warning', label: '定时中' },
  generating: { tone: 'running', label: '生成中' },
  reviewing: { tone: 'running', label: '评审中' },
  optimizing: { tone: 'running', label: '优化中' },
  passed: { tone: 'success', label: '已达标' },
  pool: { tone: 'warning', label: '低质量池' },
  failed: { tone: 'danger', label: '失败' },
};

const ACTIVE_STATUSES = ['generating', 'reviewing', 'optimizing'];
const POLL_INTERVAL_MS = 3000;
const POLL_MAX_MS = 10 * 60 * 1000;

const BATCH_STATUS_BADGE: Record<string, { tone: 'success' | 'warning' | 'danger' | 'info'; label: string }> = {
  pending: { tone: 'info', label: '待触发' },
  executing: { tone: 'warning', label: '执行中' },
  done: { tone: 'success', label: '已完成' },
  failed: { tone: 'danger', label: '失败' },
  cancelled: { tone: 'info', label: '已取消' },
};

/**
 * 用户编辑版本弹窗:在 Vn 基础上修订正文,提交后由后端 appendVersion('user_edited') 产生 Vn+1。
 * 历史版本永不修改(规格书 §43)。
 */
function VersionEditModal({
  open,
  version,
  onSave,
  onClose,
}: {
  open: boolean;
  version: StoryVersion | null;
  onSave: (content: string) => void;
  onClose: () => void;
}): React.ReactElement {
  const [buf, setBuf] = useState('');
  useEffect(() => {
    if (open && version) setBuf(version.content);
  }, [open, version]);
  return (
    <Modal
      open={open}
      title={version ? `编辑 V${version.version} → V${version.version + 1}` : ''}
      onClose={onClose}
      footer={
        <div className="flex justify-end gap-2">
          <Button variant="ghost" size="sm" onClick={onClose}>
            取消
          </Button>
          <Button variant="primary" size="sm" onClick={() => onSave(buf)} disabled={!buf.trim()}>
            <Edit size={14} /> 保存为 V{version ? version.version + 1 : ''}
          </Button>
        </div>
      }
    >
      {version ? (
        <div className="space-y-2">
          <p className="text-xs text-[#94a3b8]">
            当前正文 {version.charCount} 字。修订后追加新版本,旧版本保留作为留痕(用户编辑 + 再评审可走手动流程)。
          </p>
          <textarea
            value={buf}
            onChange={(e) => setBuf(e.target.value)}
            className="h-[55vh] w-full resize-none rounded-md border border-[#e2e8f0] bg-white p-3 font-mono text-sm leading-relaxed focus:border-[#1677ff] focus:outline-none"
          />
        </div>
      ) : null}
    </Modal>
  );
}

export default function AdminCreationPage() {
  const [tab, setTab] = useState<'short' | 'long'>('short');
  const [stories, setStories] = useState<StoryListItem[] | null>(null);
  const [detail, setDetail] = useState<StoryDetail | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  // 新建表单
  const [title, setTitle] = useState('');
  const [brief, setBrief] = useState<StoryBrief>({});
  const [sourceUrl, setSourceUrl] = useState('');
  const [creating, setCreating] = useState(false);
  /** 编辑现有作品时为 true(已存在 selectedId/detail);点击"AI开始创作"只更新元数据,不重新启动流水线 */
  const [editingExisting, setEditingExisting] = useState(false);
  // V9.5 阶段二补丁:定时创作相关状态
  const [scheduleOpen, setScheduleOpen] = useState(false);
  const [scheduleDraft, setScheduleDraft] = useState<string>(''); // datetime-local
  // V9.6 批量定时创作:计划列表 + 新建弹窗(时间/数量/共享需求)
  const [batchSchedules, setBatchSchedules] = useState<BatchSchedule[] | null>(null);
  const [batchOpen, setBatchOpen] = useState(false);
  const [batchTimeDraft, setBatchTimeDraft] = useState<string>(''); // datetime-local
  const [batchCountDraft, setBatchCountDraft] = useState<string>('3');
  const [batchThemeDraft, setBatchThemeDraft] = useState('');
  const [batchSynopsisDraft, setBatchSynopsisDraft] = useState('');
  const [batchSubmitting, setBatchSubmitting] = useState(false);
  // 编辑版本
  const [editingVersion, setEditingVersion] = useState<StoryVersion | null>(null);
  // 发布/补发进行中
  const [publishing, setPublishing] = useState(false);

  // 字段辅助弹层
  const [assist, setAssist] = useState<AssistModalState | null>(null);
  const assistTimer = useRef<ReturnType<typeof setInterval> | null>(null);
  // 查看正文
  const [viewVersion, setViewVersion] = useState<StoryVersion | null>(null);
  // 删除确认
  const [deleteTarget, setDeleteTarget] = useState<ShortStory | null>(null);
  const [deleting, setDeleting] = useState(false);

  const pollStartRef = useRef<number>(0);
  /** 详情请求序号:点击"返回编辑需求"/新建/删除时递增,使 in-flight 轮询响应失效,避免视图被旧响应拉回详情页 */
  const detailReqIdRef = useRef(0);

  const loadList = useCallback(async (): Promise<void> => {
    try {
      const res = await api<{ stories: StoryListItem[] }>('/api/admin/short-stories?limit=500');
      setStories(res.stories);
    } catch (err) {
      setError(err instanceof Error ? err.message : '加载失败');
    }
  }, []);

  const loadBatchSchedules = useCallback(async (): Promise<void> => {
    try {
      const res = await api<{ schedules: BatchSchedule[] }>('/api/admin/short-story-batch-schedules?limit=200');
      setBatchSchedules(res.schedules);
    } catch (err) {
      setError(err instanceof Error ? err.message : '批量定时列表加载失败');
    }
  }, []);

  const loadDetail = useCallback(async (id: string, silent = false): Promise<void> => {
    const reqId = ++detailReqIdRef.current;
    try {
      const res = await api<StoryDetail>(`/api/admin/short-stories/${id}`);
      if (reqId !== detailReqIdRef.current) return; // 过期响应:期间用户已离开详情视图,丢弃
      setDetail(res);
      return;
    } catch (err) {
      if (reqId !== detailReqIdRef.current) return;
      if (!silent) setError(err instanceof Error ? err.message : '加载失败');
    }
  }, []);

  useEffect(() => {
    void loadList();
    void loadBatchSchedules();
  }, [loadList, loadBatchSchedules]);

  // 流水进行中轮询详情(3s,上限 10 分钟)
  useEffect(() => {
    if (!detail || !ACTIVE_STATUSES.includes(detail.story.status)) return;
    if (pollStartRef.current === 0) pollStartRef.current = Date.now();
    const timer = setInterval(() => {
      if (Date.now() - pollStartRef.current > POLL_MAX_MS) {
        clearInterval(timer);
        setError('流水线执行超过 10 分钟仍未完成,请稍后在任务列表查看');
        return;
      }
      void loadDetail(detail.story.id, true).then(() => {
        if (detail && !ACTIVE_STATUSES.includes(detail.story.status)) void loadList();
      });
    }, POLL_INTERVAL_MS);
    return () => {
      clearInterval(timer);
      pollStartRef.current = 0;
    };
  }, [detail, loadDetail, loadList]);

  const openNewDraft = (): void => {
    detailReqIdRef.current++; // 使 in-flight 详情请求失效
    setSelectedId(null);
    setDetail(null);
    setTitle('');
    setBrief({});
    setSourceUrl('');
    setEditingExisting(false);
    setError(null);
    setNotice(null);
  };

  const openStory = async (id: string): Promise<void> => {
    setSelectedId(id);
    pollStartRef.current = Date.now();
    await loadDetail(id);
  };

  /** 返回编辑需求(从详情页回到编辑表单)并以现有 story 预填字段 */
  const openEditorFromDetail = (d: StoryDetail): void => {
    detailReqIdRef.current++; // 使 in-flight 轮询响应失效,避免视图被旧响应拉回详情页
    setTitle(d.story.title === '未命名短篇' ? '' : d.story.title);
    setBrief(d.story.brief);
    setSourceUrl(d.story.sourceUrl ?? '');
    setEditingExisting(true);
    // 切回编辑器视图:主区判断是 !detail ? renderEditor() : renderResult()
    // selectedId 仍保留(让"保存"走 PATCH),"AI开始创作"按钮在终态下仅保存元数据
    setDetail(null);
    setError(null);
    setNotice(null);
  };

  const persistBrief = async (mode: 'save' | 'create'): Promise<string | null> => {
    const payload = { title: title.trim() || undefined, brief, sourceUrl: sourceUrl.trim() || null };
    let storyId: string;
    // selectedId 在 openEditorFromDetail 后仍保留(editingExisting=true),以此区分新建/更新
    if (editingExisting && selectedId) {
      storyId = selectedId;
      await api(`/api/admin/short-stories/${storyId}`, { method: 'PATCH', body: JSON.stringify(payload) });
    } else {
      const res = await api<{ story: ShortStory }>('/api/admin/short-stories', {
        method: 'POST',
        body: JSON.stringify(payload),
      });
      storyId = res.story.id;
    }
    if (mode === 'create') {
      await api<{ task: AiTaskLite }>(`/api/admin/short-stories/${storyId}/create`, { method: 'POST' });
    }
    return storyId;
  };

  const onSaveDraft = async (): Promise<void> => {
    setCreating(true);
    setError(null);
    try {
      const id = await persistBrief('save');
      setNotice(editingExisting ? '元数据已保存' : '草稿已保存');
      if (id) await openStory(id);
      await loadList();
    } catch (err) {
      setError(err instanceof Error ? err.message : '保存失败');
    } finally {
      setCreating(false);
    }
  };

  const onStartCreate = async (): Promise<void> => {
    setCreating(true);
    setError(null);
    try {
      if (editingExisting) {
        // 已存在作品:仅保存元数据(用户应改 brief 后走"重新开始创作",或点"⏰ 定时")
        const id = await persistBrief('save');
        setNotice('元数据已保存;已发布/已通过/流水线中作品请用"⏰ 定时"或新建');
        if (id) await openStory(id);
      } else {
        const id = await persistBrief('create');
        setNotice('创作流水线已启动');
        if (id) await openStory(id);
      }
      await loadList();
    } catch (err) {
      setError(err instanceof Error ? err.message : '启动失败');
    } finally {
      setCreating(false);
    }
  };

  // ---------- 定时创作 ----------

  const openScheduleModal = (): void => {
    if (!detail) return;
    // 默认:10 分钟后(确保在下一 tick 不会立刻触发);用户可改
    const t = detail.story.scheduledAt
      ? new Date(detail.story.scheduledAt)
      : new Date(Date.now() + 10 * 60_000);
    // datetime-local 需要本地时区 YYYY-MM-DDTHH:mm 格式
    const pad = (n: number): string => String(n).padStart(2, '0');
    const localISO = `${t.getFullYear()}-${pad(t.getMonth() + 1)}-${pad(t.getDate())}T${pad(t.getHours())}:${pad(t.getMinutes())}`;
    setScheduleDraft(localISO);
    setScheduleOpen(true);
  };

  const submitSchedule = async (): Promise<void> => {
    if (!detail || !scheduleDraft) return;
    const utc = new Date(scheduleDraft).toISOString();
    if (!Number.isFinite(Date.parse(scheduleDraft))) {
      setError('定时时间格式无效');
      return;
    }
    setCreating(true);
    setError(null);
    try {
      await api(`/api/admin/short-stories/${detail.story.id}/schedule`, {
        method: 'POST',
        body: JSON.stringify({ scheduledAt: utc }),
      });
      setNotice('已设定定时创作,到点由调度器自动启动流水线');
      setScheduleOpen(false);
      await openStory(detail.story.id);
      await loadList();
    } catch (err) {
      setError(err instanceof Error ? err.message : '设定定时失败');
    } finally {
      setCreating(false);
    }
  };

  const cancelSchedule = async (): Promise<void> => {
    if (!detail) return;
    setCreating(true);
    try {
      await api(`/api/admin/short-stories/${detail.story.id}/schedule`, { method: 'DELETE' });
      setNotice('已取消定时');
      await openStory(detail.story.id);
      await loadList();
    } catch (err) {
      setError(err instanceof Error ? err.message : '取消定时失败');
    } finally {
      setCreating(false);
    }
  };

  // ---------- 批量定时创作(V9.6) ----------

  const openBatchScheduleModal = (): void => {
    // 默认:10 分钟后(确保在下一 tick 不会立刻触发);用户可改
    const t = new Date(Date.now() + 10 * 60_000);
    const pad = (n: number): string => String(n).padStart(2, '0');
    const localISO = `${t.getFullYear()}-${pad(t.getMonth() + 1)}-${pad(t.getDate())}T${pad(t.getHours())}:${pad(t.getMinutes())}`;
    setBatchTimeDraft(localISO);
    setBatchCountDraft('3');
    setBatchThemeDraft('');
    setBatchSynopsisDraft('');
    setBatchOpen(true);
  };

  const submitBatchSchedule = async (): Promise<void> => {
    if (!batchTimeDraft) return;
    const utc = new Date(batchTimeDraft).toISOString();
    if (!Number.isFinite(Date.parse(batchTimeDraft))) {
      setError('定时时间格式无效');
      return;
    }
    const count = Number(batchCountDraft);
    if (!Number.isInteger(count) || count < 1 || count > 50) {
      setError('生成数量需为 1..50 的整数');
      return;
    }
    setBatchSubmitting(true);
    setError(null);
    try {
      const brief: StoryBrief = {};
      if (batchThemeDraft.trim()) brief.theme = batchThemeDraft.trim();
      if (batchSynopsisDraft.trim()) brief.synopsis = batchSynopsisDraft.trim();
      await api('/api/admin/short-story-batch-schedules', {
        method: 'POST',
        body: JSON.stringify({ scheduledAt: utc, count, brief }),
      });
      setNotice(`已设定批量定时:${count} 篇,到点后逐篇生成并通过评审自动发布`);
      setBatchOpen(false);
      await loadBatchSchedules();
      await loadList();
    } catch (err) {
      setError(err instanceof Error ? err.message : '设定批量定时失败');
    } finally {
      setBatchSubmitting(false);
    }
  };

  const cancelBatch = async (id: string): Promise<void> => {
    setError(null);
    try {
      await api(`/api/admin/short-story-batch-schedules/${id}/cancel`, { method: 'POST' });
      setNotice('已取消批量定时计划');
      await loadBatchSchedules();
    } catch (err) {
      setError(err instanceof Error ? err.message : '取消批量定时失败');
    }
  };

  const deleteBatch = async (id: string): Promise<void> => {
    setError(null);
    try {
      await api(`/api/admin/short-story-batch-schedules/${id}`, { method: 'DELETE' });
      setNotice('已删除批量定时记录');
      await loadBatchSchedules();
    } catch (err) {
      setError(err instanceof Error ? err.message : '删除批量定时失败');
    }
  };

  // ---------- 用户编辑版本 ----------

  const onEditVersionSave = async (content: string): Promise<void> => {
    if (!editingVersion) return;
    setCreating(true);
    try {
      await api(`/api/admin/short-stories/${editingVersion.storyId}/versions`, {
        method: 'POST',
        body: JSON.stringify({ content }),
      });
      setNotice('已追加用户编辑版本 V' + (editingVersion.version + 1));
      setEditingVersion(null);
      await openStory(editingVersion.storyId);
      await loadList();
    } catch (err) {
      setError(err instanceof Error ? err.message : '保存版本失败');
    } finally {
      setCreating(false);
    }
  };

  // ---------- 发布/补发 ----------

  const onPublish = async (async = false): Promise<void> => {
    if (!detail) return;
    setPublishing(true);
    try {
      if (async) {
        await api(`/api/admin/short-stories/${detail.story.id}/publish?async=1`, { method: 'POST' });
        setNotice('发布任务已入队,稍后在任务列表查看');
      } else {
        const res = await api<{ publicationId: string; bookId: string; bookSlug: string }>(
          `/api/admin/short-stories/${detail.story.id}/publish`,
          { method: 'POST' }
        );
        setNotice(`已发布,读者页 /short/${detail.story.id}`);
        void res; // 留作后续扩展(跳转到该书工作台等)
      }
      await openStory(detail.story.id);
      await loadList();
    } catch (err) {
      setError(err instanceof Error ? err.message : '发布失败');
    } finally {
      setPublishing(false);
    }
  };

  // ---------- 字段辅助 ----------

  const closeAssist = (): void => {
    if (assistTimer.current) {
      clearInterval(assistTimer.current);
      assistTimer.current = null;
    }
    setAssist(null);
  };

  const runAssist = useCallback(
    async (fieldKey: string, label: string, action: AssistAction): Promise<void> => {
      const currentValue = String(brief[fieldKey] ?? '');
      if (action === 'optimize' && !currentValue.trim()) {
        setError(`「${label}」还没有内容,无法 AI 优化`);
        return;
      }
      closeAssist();
      setAssist({
        fieldKey,
        label,
        action,
        phase: 'loading',
        taskId: null,
        options: [],
        result: '',
        editBuffer: '',
        editing: false,
        error: null,
      });
      setError(null);
      try {
        const res = await api<{ task: AiTaskLite }>('/api/admin/ai/assist', {
          method: 'POST',
          body: JSON.stringify({ action, field: fieldKey, value: currentValue || undefined, context: brief }),
        });
        const taskId = res.task.id;
        setAssist((prev) => (prev ? { ...prev, taskId } : prev));
        const startedAt = Date.now();
        const timer = setInterval(async () => {
          try {
            const t = await api<{ task: AiTaskLite & { output: { options?: string[]; result?: string } | null } }>(
              `/api/admin/ai/tasks/${taskId}`
            );
            if (t.task.status === 'SUCCESS') {
              if (assistTimer.current) clearInterval(assistTimer.current);
              setAssist((prev) =>
                prev
                  ? {
                      ...prev,
                      phase: 'done',
                      options: t.task.output?.options ?? [],
                      result: t.task.output?.result ?? '',
                    }
                  : prev
              );
            } else if (t.task.status === 'FAILED' || t.task.status === 'CANCELLED') {
              if (assistTimer.current) clearInterval(assistTimer.current);
              setAssist((prev) => (prev ? { ...prev, phase: 'failed', error: t.task.error ?? '任务失败' } : prev));
            } else if (Date.now() - startedAt > 120000) {
              if (assistTimer.current) clearInterval(assistTimer.current);
              setAssist((prev) =>
                prev ? { ...prev, phase: 'failed', error: '等待超时(2 分钟),请在任务列表重试' } : prev
              );
            }
          } catch {
            /* 单次轮询失败忽略,下一轮继续 */
          }
        }, 1500);
        assistTimer.current = timer;
      } catch (err) {
        setAssist(null);
        setError(err instanceof Error ? err.message : '请求失败');
      }
    },
    [brief]
  );

  const applyAssistToField = (value: string): void => {
    if (!assist) return;
    setBrief((prev) => ({ ...prev, [assist.fieldKey]: value }));
    closeAssist();
  };

  const onDeleteConfirm = async (): Promise<void> => {
    if (!deleteTarget) return;
    setDeleting(true);
    try {
      await api(`/api/admin/short-stories/${deleteTarget.id}`, { method: 'DELETE' });
      setNotice('已删除');
      setDeleteTarget(null);
      if (selectedId === deleteTarget.id) {
        detailReqIdRef.current++; // 删除后使 in-flight 详情请求失效
        setSelectedId(null);
        setDetail(null);
      }
      await loadList();
    } catch (err) {
      setError(err instanceof Error ? err.message : '删除失败');
    } finally {
      setDeleting(false);
    }
  };

  const triggerManual = async (id: string, kind: 'review' | 'optimize'): Promise<void> => {
    setError(null);
    try {
      await api(`/api/admin/short-stories/${id}/${kind}`, { method: 'POST' });
      setNotice(kind === 'review' ? '重新评审已入队' : '手动优化已入队');
      await openStory(id);
    } catch (err) {
      setError(err instanceof Error ? err.message : '操作失败');
    }
  };

  // ---------- 渲染子块 ----------

  const currentReview: ReviewRecordLite | null = detail
    ? (detail.story.currentVersionId ? detail.latestReviews[detail.story.currentVersionId] ?? null : null)
    : null;

  const renderSteps = (): React.ReactNode => {
    if (!detail) return null;
    const s = detail.story.status;
    const steps: Array<{ label: string; active: boolean; done: boolean; failed?: boolean }> = [
      { label: '准备中', active: s === 'draft', done: s !== 'draft', failed: s === 'failed' },
      { label: '生成正文', active: s === 'generating', done: ['reviewing', 'optimizing', 'passed', 'pool'].includes(s), failed: false },
      { label: 'AI 评审', active: s === 'reviewing' && detail.story.optimizeRound === 0, done: s === 'passed', failed: false },
      { label: '自动优化', active: s === 'optimizing', done: false, failed: false },
      { label: '再次评审', active: s === 'reviewing' && detail.story.optimizeRound > 0, done: false, failed: false },
      { label: '完成', active: ['passed', 'pool', 'failed'].includes(s), done: s === 'passed', failed: s === 'failed' },
    ];
    return (
      <div className="flex flex-wrap items-center gap-2">
        {steps.map((st, i) => (
          <span key={st.label} className="flex items-center gap-2">
            {i > 0 ? <span className="h-px w-6 bg-[#e2e8f0]" /> : null}
            <span
              className={`inline-flex h-7 items-center rounded-full px-3 text-xs font-medium transition-colors duration-150 ${
                st.failed
                  ? 'bg-[#fee2e2] text-[#b91c1c]'
                  : st.active
                    ? 'bg-[#dbeafe] text-[#0f4ca8]'
                    : st.done
                      ? 'bg-[#d1fae5] text-[#047857]'
                      : 'bg-[#f1f5f9] text-[#94a3b8]'
              }`}
            >
              {st.label}
            </span>
          </span>
        ))}
      </div>
    );
  };

  const renderDimensionPanel = (rec: ReviewRecordLite | null): React.ReactNode => {
    if (!rec) {
      return detail && ACTIVE_STATUSES.includes(detail.story.status) ? (
        <div className="space-y-2">
          {['故事完整性', '情节与冲突', '人物塑造', '逻辑合理性', '情绪感染力', '语言表达', '创意与独特性'].map((n) => (
            <div key={n} className="flex items-center justify-between rounded-lg bg-[#f8fafc] px-4 py-2 text-sm">
              <span className="text-[#334155]">{n}</span>
              <span className="flex items-center gap-2 text-xs text-[#1677ff]">
                <Spinner size={12} /> 分析中
              </span>
            </div>
          ))}
        </div>
      ) : (
        <p className="px-1 py-6 text-center text-sm text-[#94a3b8]">暂无评审结果</p>
      );
    }
    return (
      <div className="space-y-2">
        {rec.dimensionScores.map((d) => {
          const pct = d.maxScore > 0 ? Math.round((d.score / d.maxScore) * 100) : 0;
          return (
            <div key={d.name}>
              <div className="mb-1 flex items-center justify-between text-sm">
                <span className="text-[#334155]">{d.name}</span>
                <span className="font-medium text-[#0f172a]">
                  {Math.round((d.score * d.maxScore) / 100)} / {d.maxScore}
                </span>
              </div>
              <div className="h-1.5 w-full overflow-hidden rounded-full bg-[#f1f5f9]">
                <div
                  className={`h-full rounded-full transition-all duration-300 ${pct >= 80 ? 'bg-[#10b981]' : pct >= 60 ? 'bg-[#f59e0b]' : 'bg-[#dc2626]'}`}
                  style={{ width: `${pct}%` }}
                />
              </div>
              {d.reason ? <p className="mt-1 text-xs leading-relaxed text-[#94a3b8]">{d.reason}</p> : null}
            </div>
          );
        })}
      </div>
    );
  };

  const renderEditor = (): React.ReactNode => (
    <div className="rounded-xl bg-white p-5 shadow-sm">
      <div className="mb-4 flex items-center justify-between border-b border-[#f1f5f9] pb-3">
        <h2 className="text-base font-semibold text-[#0f172a]">创作需求</h2>
        <div className="flex items-center gap-2">
          <Button variant="secondary" size="sm" onClick={onSaveDraft} disabled={creating}>
            保存草稿
          </Button>
          <Button variant="primary" size="sm" onClick={onStartCreate} disabled={creating}>
            {creating ? <Spinner size={14} /> : <Sparkles size={14} />}
            ✨ AI 开始创作
          </Button>
        </div>
      </div>
      <div className="mb-4 grid grid-cols-1 gap-4 md:grid-cols-2">
        <Field label="作品标题">
          <Input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="未命名短篇" />
        </Field>
        <Field label="小说源地址(可选)">
          <Input value={sourceUrl} onChange={(e) => setSourceUrl(e.target.value)} placeholder="https://…" />
        </Field>
      </div>
      {GROUPS.map((g) => (
        <fieldset key={g.title} className="mb-5 border-0">
          <legend className="mb-3 text-sm font-semibold text-[#0f172a]">{g.title}</legend>
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
            {g.fields.map((f) => (
              <div key={f.key} className={f.type === 'text' || f.type === 'number' ? '' : 'md:col-span-2'}>
                <Field label={f.label}>
                  <div className="flex items-start gap-2">
                    {f.type === 'area' ? (
                      <Textarea
                        value={String(brief[f.key] ?? '')}
                        onChange={(e) => setBrief((prev) => ({ ...prev, [f.key]: e.target.value }))}
                        placeholder={`填写${f.label},或使用右侧 AI 辅助`}
                        className="min-h-[72px]"
                      />
                    ) : (
                      <Input
                        type={f.type === 'number' ? 'number' : 'text'}
                        value={String(brief[f.key] ?? '')}
                        onChange={(e) =>
                          setBrief((prev) => ({
                            ...prev,
                            [f.key]: f.type === 'number' ? Number(e.target.value) || '' : e.target.value,
                          }))
                        }
                        placeholder={f.label}
                      />
                    )}
                    <div className="flex shrink-0 gap-1 pt-0.5">
                      {(f.type === 'text' || f.type === 'number') && (
                        <Button
                          variant="ghost"
                          size="xs"
                          title="✨ AI建议"
                          onClick={() => void runAssist(f.key, f.label, 'suggest')}
                        >
                          <Sparkles size={13} /> 建议
                        </Button>
                      )}
                      <Button
                        variant="ghost"
                        size="xs"
                        title="✨ AI生成"
                        onClick={() => void runAssist(f.key, f.label, 'generate')}
                      >
                        <Sparkles size={13} /> 生成
                      </Button>
                      <Button
                        variant="ghost"
                        size="xs"
                        title="✨ AI优化"
                        disabled={!String(brief[f.key] ?? '').trim()}
                        onClick={() => void runAssist(f.key, f.label, 'optimize')}
                      >
                        <Sparkles size={13} /> 优化
                      </Button>
                    </div>
                  </div>
                </Field>
              </div>
            ))}
          </div>
        </fieldset>
      ))}
    </div>
  );

  const renderResult = (): React.ReactNode => {
    if (!detail) return null;
    const s = detail.story;
    const rec = currentReview;
    return (
      <div className="space-y-5">
        {/* 进度/状态卡 */}
        <div className="rounded-xl bg-white p-5 shadow-sm">
          <div className="flex items-center justify-between">
            <h2 className="text-base font-semibold text-[#0f172a]">创作流水线</h2>
            <Badge tone={STORY_STATUS_BADGE[s.status]?.tone ?? 'info'}>{STORY_STATUS_BADGE[s.status]?.label ?? s.status}</Badge>
          </div>
          <div className="mt-4">{renderSteps()}</div>
          {s.status === 'pool' ? (
            <Notice tone="error">已达最大自动优化次数仍未达标,本篇进入低质量内容池;可手动优化或删除。</Notice>
          ) : null}
          {s.status === 'failed' ? (
            <Notice tone="error">
              流水线失败:{detail.tasks.find((t) => t.error)?.error ?? '未知原因'}。可在任务列表重试,或修改需求后重新开始创作。
            </Notice>
          ) : null}
          {ACTIVE_STATUSES.includes(s.status) ? (
            <p className="mt-3 flex items-center gap-2 text-xs text-[#1677ff]">
              <Spinner size={12} /> 系统正在处理,页面每 3 秒自动刷新…
            </p>
          ) : null}
          <div className="mt-4 flex flex-wrap items-center gap-2">
            <Button variant="secondary" size="xs" onClick={() => void triggerManual(s.id, 'review')} disabled={ACTIVE_STATUSES.includes(s.status)}>
              <RefreshCw size={13} /> 手动重新评审
            </Button>
            <Button variant="secondary" size="xs" onClick={() => void triggerManual(s.id, 'optimize')} disabled={ACTIVE_STATUSES.includes(s.status) || !s.currentVersionId}>
              <Sparkles size={13} /> 手动优化
            </Button>
            {/* 定时创作:仅静止状态可设;通过后只能取消已有定时(通常无需) */}
            <Button
              variant="secondary"
              size="xs"
              onClick={openScheduleModal}
              disabled={ACTIVE_STATUSES.includes(s.status)}
              title={ACTIVE_STATUSES.includes(s.status) ? '流水线进行中,不可设定定时' : '设定未来某个时刻自动启动创作'}
            >
              <CalendarClock size={13} /> {s.status === 'scheduled' ? '调整定时' : '⏰ 定时创作'}
            </Button>
            {s.status === 'scheduled' ? (
              <Button variant="ghost" size="xs" onClick={() => void cancelSchedule()} disabled={creating}>
                取消定时
              </Button>
            ) : null}
            {/* 发布:passed 后自动入队过 PUBLISH_SHORT_STORY;若任务失败/历史遗留可手动补发 */}
            {s.status === 'passed' ? (
              <Button variant="primary" size="xs" onClick={() => void onPublish(false)} disabled={publishing}>
                <Send size={13} /> 立即发布
              </Button>
            ) : null}
            {s.status === 'passed' ? (
              <Button variant="ghost" size="xs" onClick={() => void onPublish(true)} disabled={publishing}>
                入队发布任务
              </Button>
            ) : null}
            <Button
              variant="danger"
              size="xs"
              onClick={() => setDeleteTarget(s)}
              disabled={['generating', 'reviewing', 'optimizing', 'passed', 'scheduled'].includes(s.status)}
            >
              <Trash2 size={13} /> 删除
            </Button>
          </div>
        </div>

        {/* 评分卡 */}
        <div className="grid grid-cols-1 gap-5 lg:grid-cols-5">
          <div className="rounded-xl bg-white p-5 shadow-sm lg:col-span-2">
            <h3 className="mb-4 text-base font-semibold text-[#0f172a]">AI 评审结果</h3>
            {rec ? (
              <>
                <div className="mb-2 flex items-end gap-3">
                  <span className="text-5xl font-bold leading-none text-[#1677ff]">{rec.score}</span>
                  <span className="pb-1 text-sm text-[#94a3b8]">/ 100</span>
                  <Badge tone={rec.level === 'S' || rec.level === 'A' ? 'success' : rec.level === 'B' ? 'info' : 'warning'}>
                    {rec.level} 级
                  </Badge>
                </div>
                <p className={`mb-4 text-sm ${rec.qualified ? 'text-[#047857]' : 'text-[#b45309]'}`}>
                  {rec.qualified ? '✓ 达到高质量标准' : `未达高质量标准(阈值见评审规则)`}
                </p>
                <p className="mb-4 rounded-lg bg-[#f8fafc] p-3 text-xs leading-relaxed text-[#64748b]">{rec.summary}</p>
                <p className="text-xs text-[#94a3b8]">
                  第 {rec.reviewRound} 次评审 · 已自动优化 {s.optimizeRound} 次 · 手动优化 {s.manualOptimizeRound} 次 · 规则 {rec.ruleVersion}
                </p>
              </>
            ) : (
              renderDimensionPanel(null)
            )}
          </div>
          <div className="rounded-xl bg-white p-5 shadow-sm lg:col-span-3">
            <h3 className="mb-4 text-base font-semibold text-[#0f172a]">维度评分</h3>
            {renderDimensionPanel(rec)}
            {rec && (rec.strengths.length > 0 || rec.weaknesses.length > 0 || rec.suggestions.length > 0) ? (
              <div className="mt-5 space-y-3 border-t border-[#f1f5f9] pt-4 text-sm">
                {rec.strengths.length > 0 ? (
                  <div>
                    <p className="mb-1 text-xs font-semibold text-[#047857]">优点</p>
                    <ul className="list-inside list-disc space-y-0.5 text-xs text-[#334155]">
                      {rec.strengths.map((x, i) => (
                        <li key={i}>{x}</li>
                      ))}
                    </ul>
                  </div>
                ) : null}
                {rec.weaknesses.length > 0 ? (
                  <div>
                    <p className="mb-1 text-xs font-semibold text-[#b91c1c]">问题</p>
                    <ul className="list-inside list-disc space-y-0.5 text-xs text-[#334155]">
                      {rec.weaknesses.map((x, i) => (
                        <li key={i}>{x}</li>
                      ))}
                    </ul>
                  </div>
                ) : null}
                {rec.suggestions.length > 0 ? (
                  <div>
                    <p className="mb-1 text-xs font-semibold text-[#0f4ca8]">优化建议</p>
                    <ul className="list-inside list-disc space-y-0.5 text-xs text-[#334155]">
                      {rec.suggestions.map((x, i) => (
                        <li key={i}>{x}</li>
                      ))}
                    </ul>
                  </div>
                ) : null}
              </div>
            ) : null}
          </div>
        </div>

        {/* 版本时间线 */}
        <div className="rounded-xl bg-white p-5 shadow-sm">
          <h3 className="mb-4 text-base font-semibold text-[#0f172a]">版本时间线({detail.versions.length})</h3>
          {detail.versions.length === 0 ? (
            <EmptyState icon={<Pencil size={24} />} title="尚无版本" description="启动 AI 创作后将在此展示 V1..Vn 与各版评分" />
          ) : (
            <div className="space-y-2">
              {detail.versions.map((v) => {
                const rv = detail.latestReviews[v.id];
                return (
                  <div key={v.id} className="group flex items-center gap-3 rounded-lg border border-[#f1f5f9] px-4 py-3 transition-all duration-150 hover:-translate-y-px hover:shadow-sm">
                    <span className="w-12 shrink-0 text-sm font-semibold text-[#1677ff]">V{v.version}</span>
                    <span className="w-20 shrink-0 text-xs text-[#64748b]">
                      {{ generated: 'AI 生成', ai_optimized: 'AI 优化', user_edited: '用户编辑' }[v.creationReason] ?? v.creationReason}
                    </span>
                    {rv ? (
                      <span className="flex items-center gap-2 text-xs">
                        <span className={`font-medium ${rv.qualified ? 'text-[#047857]' : 'text-[#b45309]'}`}>{rv.score} 分</span>
                        <Badge tone={rv.level === 'S' || rv.level === 'A' ? 'success' : rv.level === 'B' ? 'info' : 'warning'}>{rv.level}</Badge>
                      </span>
                    ) : (
                      <span className="text-xs text-[#94a3b8]">未评审</span>
                    )}
                    <span className="ml-auto text-xs text-[#94a3b8]">{v.charCount} 字 · {formatChinaTime(v.createdAt)}</span>
                    <span className="flex gap-1 opacity-0 transition-opacity duration-150 group-hover:opacity-100 group-focus-within:opacity-100">
                      <Button variant="ghost" size="xs" onClick={() => setViewVersion(v)}>
                        <Eye size={13} /> 查看
                      </Button>
                      <Button
                        variant="ghost"
                        size="xs"
                        onClick={() => setEditingVersion(v)}
                        title="基于此版正文生成新版本(原版保留)"
                      >
                        <Edit size={13} /> 编辑
                      </Button>
                    </span>
                    {v.isFinal ? <Badge tone="success">最终版</Badge> : null}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>
    );
  };

  const renderShortTab = (): React.ReactNode => (
    <div className="grid grid-cols-1 gap-5 lg:grid-cols-4">
      {/* 作品列表 */}
      <div className="lg:col-span-1">
        <div className="rounded-xl bg-white p-4 shadow-sm">
          <div className="mb-3 flex items-center justify-between">
            <h2 className="text-sm font-semibold text-[#0f172a]">作品({stories?.length ?? 0})</h2>
            <Button variant="primary" size="xs" onClick={openNewDraft}>
              <Plus size={13} /> 新建
            </Button>
          </div>
          {stories === null ? (
            <p className="py-8 text-center text-sm text-[#94a3b8]">
              <Spinner />
            </p>
          ) : stories.length === 0 ? (
            <p className="py-8 text-center text-xs text-[#94a3b8]">暂无作品</p>
          ) : (
            <div className="max-h-[70vh] space-y-1.5 overflow-y-auto pr-1">
              {stories.map((sItem) => (
                <button
                  key={sItem.id}
                  onClick={() => void openStory(sItem.id)}
                  className={`w-full rounded-lg px-3 py-2.5 text-left transition-colors duration-150 ${
                    selectedId === sItem.id ? 'bg-[#e8f3ff]' : 'hover:bg-[#f8fafc]'
                  }`}
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="truncate text-sm font-medium text-[#0f172a]">{sItem.title}</span>
                    <Badge tone={STORY_STATUS_BADGE[sItem.status]?.tone ?? 'info'}>
                      {STORY_STATUS_BADGE[sItem.status]?.label ?? sItem.status}
                    </Badge>
                  </div>
                  <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-[#94a3b8]">
                    {sItem.lastScore !== null ? <span className="font-medium text-[#1677ff]">{sItem.lastScore} 分</span> : null}
                    <span>{sItem.versionCount} 版</span>
                    {sItem.scheduledAt ? (
                      <span className="inline-flex items-center gap-0.5 text-[#b45309]">
                        <CalendarClock size={11} /> 定时 {formatChinaTime(sItem.scheduledAt)}
                      </span>
                    ) : null}
                    {sItem.publicationId ? (
                      <span className="inline-flex items-center gap-0.5 text-[#047857]">
                        <CheckCircle2 size={11} /> 已发布
                      </span>
                    ) : null}
                    <span>{formatChinaTime(sItem.updatedAt)}</span>
                  </div>
                </button>
              ))}
            </div>
          )}
        </div>

        {/* 批量定时创作(V9.6):到点一次性创建 count 篇短篇,标题自动生成,通过评审自动发布 */}
        <div className="mt-4 rounded-xl bg-white p-4 shadow-sm">
          <div className="mb-3 flex items-center justify-between">
            <h2 className="flex items-center gap-1.5 text-sm font-semibold text-[#0f172a]">
              <CalendarClock size={14} /> 批量定时
            </h2>
            <Button variant="primary" size="xs" onClick={openBatchScheduleModal}>
              <Plus size={13} /> 新建
            </Button>
          </div>
          {batchSchedules === null ? (
            <p className="py-6 text-center text-sm text-[#94a3b8]">
              <Spinner />
            </p>
          ) : batchSchedules.length === 0 ? (
            <p className="py-4 text-center text-xs text-[#94a3b8]">暂无批量定时计划</p>
          ) : (
            <div className="max-h-[40vh] space-y-2 overflow-y-auto pr-1">
              {batchSchedules.map((b) => (
                <div key={b.id} className="rounded-lg border border-[#f1f5f9] px-3 py-2.5">
                  <div className="flex items-center justify-between gap-2">
                    <span className="flex items-center gap-1.5 text-xs font-medium text-[#0f172a]">
                      <CalendarClock size={12} className="text-[#b45309]" />
                      {formatChinaTime(b.scheduledAt)}
                    </span>
                    <Badge tone={BATCH_STATUS_BADGE[b.status]?.tone ?? 'info'}>
                      {BATCH_STATUS_BADGE[b.status]?.label ?? b.status}
                    </Badge>
                  </div>
                  <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-[#94a3b8]">
                    <span>{b.count} 篇</span>
                    {b.storyIds.length > 0 ? <span>已建 {b.storyIds.length} 篇</span> : null}
                    {b.status === 'done' ? (
                      <span className="inline-flex items-center gap-0.5 text-[#047857]">
                        <CheckCircle2 size={11} /> 已执行
                      </span>
                    ) : null}
                  </div>
                  {b.status === 'failed' && b.error ? (
                    <p className="mt-1 break-all text-xs text-[#b91c1c]">{b.error}</p>
                  ) : null}
                  <div className="mt-1.5 flex justify-end gap-1">
                    {b.status === 'pending' ? (
                      <Button variant="ghost" size="xs" onClick={() => void cancelBatch(b.id)}>
                        取消
                      </Button>
                    ) : null}
                    {b.status !== 'executing' ? (
                      <Button variant="ghost" size="xs" onClick={() => void deleteBatch(b.id)}>
                        <Trash2 size={12} /> 删除
                      </Button>
                    ) : null}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
      {/* 主区 */}
      <div className="lg:col-span-3">
        {!detail ? (
          renderEditor()
        ) : (
          <div className="space-y-5">
            <div className="flex flex-wrap items-center gap-2">
              <Button variant="secondary" size="sm" onClick={() => openEditorFromDetail(detail)}>
                <ChevronLeft size={14} /> 返回编辑需求
              </Button>
              {detail.story.status === 'scheduled' ? (
                <Badge tone="warning">
                  <CalendarClock size={12} className="mr-1" />
                  定时 {formatChinaTime(detail.story.scheduledAt)}
                </Badge>
              ) : null}
              {detail.publication ? (
                <Badge tone="success">
                  <CheckCircle2 size={12} className="mr-1" />已发布 {formatChinaTime(detail.publication.publishedAt)}
                </Badge>
              ) : detail.story.status === 'passed' ? (
                <Badge tone="info">已通过,待发布</Badge>
              ) : null}
            </div>
            {renderResult()}
          </div>
        )}
      </div>
    </div>
  );

  return (
    <div>
      {error ? <Notice tone="error">{error}</Notice> : null}
      {notice ? <Notice tone="success">{notice}</Notice> : null}

      {/* 页头卡 */}
      <div className="mb-5 rounded-xl bg-white p-5 shadow-sm">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <span className="flex h-11 w-11 items-center justify-center rounded-xl bg-gradient-to-br from-[#8b5cf6] to-[#6d28d9] text-white">
              <Sparkles size={20} />
            </span>
            <div>
              <h1 className="text-lg font-bold text-[#0f172a]">AI 创作中心</h1>
              <p className="text-xs text-[#94a3b8]">AI 负责·建议 / 生成 / 优化 / 评审;系统负责记录、版本化与验证</p>
            </div>
          </div>
          <Tabs
            tabs={[
              { key: 'short', label: '短篇小说' },
              { key: 'long', label: '长篇小说' },
            ]}
            value={tab}
            onChange={setTab}
          />
        </div>
      </div>

      {tab === 'short' ? (
        renderShortTab()
      ) : (
        <div className="rounded-xl bg-white p-5 shadow-sm">
          <EmptyState
            icon={<BookOpen size={24} />}
            title="长篇小说工作台"
            description="长篇小说的 Story Core 设定(世界观/人物/关系/大纲/伏笔)与章节级 AI 生成在专用工作台进行;长篇自动评审将在后续阶段接入本中心。"
            action={
              <Link href="/admin/story">
                <Button variant="primary" size="sm">
                  前往长篇工作台
                </Button>
              </Link>
            }
          />
        </div>
      )}

      {/* 字段辅助弹层 */}
      <Modal
        open={assist !== null}
        title={
          assist
            ? `✨ AI${{ suggest: '建议', generate: '生成', optimize: '优化' }[assist.action]} · ${assist.label}`
            : ''
        }
        onClose={closeAssist}
        footer={
          assist?.phase === 'done' ? (
            assist.editing ? (
              <>
                <Button variant="secondary" onClick={() => setAssist((p) => (p ? { ...p, editing: false } : p))}>
                  返回
                </Button>
                <Button variant="primary" onClick={() => applyAssistToField(assist.editBuffer)}>
                  采用并填入
                </Button>
              </>
            ) : (
              <>
                {assist.action === 'suggest' ? (
                  <Button variant="secondary" onClick={() => void runAssist(assist.fieldKey, assist.label, 'suggest')}>
                    <RefreshCw size={13} /> 换一批
                  </Button>
                ) : null}
                <Button variant="secondary" onClick={() => setAssist((p) => (p ? { ...p, editing: true, editBuffer: p.result } : p))}>
                  <Pencil size={13} /> 编辑
                </Button>
                <Button variant="primary" onClick={() => applyAssistToField(assist.result)}>
                  采用
                </Button>
              </>
            )
          ) : null
        }
      >
        {assist?.phase === 'loading' ? (
          <p className="flex items-center justify-center gap-2 py-10 text-sm text-[#64748b]">
            <Spinner size={16} /> 生成中…请稍候
          </p>
        ) : null}
        {assist?.phase === 'failed' ? (
          <div>
            <p className="flex items-center gap-2 py-4 text-sm text-[#b91c1c]">
              <XCircle size={16} /> {assist.error}
            </p>
            <Button variant="secondary" size="sm" onClick={() => void runAssist(assist.fieldKey, assist.label, assist.action)}>
              重试
            </Button>
          </div>
        ) : null}
        {assist?.phase === 'done' && !assist.editing ? (
          assist.action === 'suggest' ? (
            <div className="space-y-2">
              {assist.options.length === 0 ? <p className="text-sm text-[#94a3b8]">没有候选方案</p> : null}
              {assist.options.map((opt, i) => (
                <button
                  key={i}
                  onClick={() => applyAssistToField(opt)}
                  className="block w-full rounded-lg border border-[#e2e8f0] px-4 py-3 text-left text-sm text-[#334155] transition-all duration-150 hover:border-[#1677ff] hover:bg-[#f8fafc]"
                >
                  {i + 1}. {opt}
                </button>
              ))}
              <p className="pt-1 text-xs text-[#94a3b8]">点击任一方案直接采用;或「换一批」重新生成。</p>
            </div>
          ) : (
            <pre className="max-h-[50vh] overflow-y-auto whitespace-pre-wrap rounded-lg bg-[#f8fafc] p-4 text-sm leading-relaxed text-[#334155]">
              {assist.result}
            </pre>
          )
        ) : null}
        {assist?.phase === 'done' && assist.editing ? (
          <Textarea
            className="min-h-[200px]"
            value={assist.editBuffer}
            onChange={(e) => setAssist((p) => (p ? { ...p, editBuffer: e.target.value } : p))}
          />
        ) : null}
      </Modal>

      {/* 正文查看 */}
      <Modal open={viewVersion !== null} title={viewVersion ? `正文 · V${viewVersion.version}` : ''} onClose={() => setViewVersion(null)}>
        {viewVersion ? (
          <pre className="max-h-[60vh] overflow-y-auto whitespace-pre-wrap rounded-lg bg-[#f8fafc] p-4 text-sm leading-loose text-[#334155]">
            {viewVersion.content}
          </pre>
        ) : null}
      </Modal>

      {/* 删除确认 */}
      <ConfirmDialog
        open={deleteTarget !== null}
        title="删除短篇小说"
        description={`确定删除《${deleteTarget?.title ?? ''}》?仅草稿/定时/低质量池/失败状态可删,历史版本将一并移除。`}
        loading={deleting}
        onConfirm={() => void onDeleteConfirm()}
        onCancel={() => setDeleteTarget(null)}
      />

      {/* 定时创作(V9.5 阶段二补丁) */}
      <Modal
        open={scheduleOpen}
        title="设定定时创作"
        onClose={() => setScheduleOpen(false)}
        footer={
          <div className="flex justify-end gap-2">
            <Button variant="ghost" size="sm" onClick={() => setScheduleOpen(false)}>
              取消
            </Button>
            <Button variant="primary" size="sm" onClick={() => void submitSchedule()} disabled={creating || !scheduleDraft}>
              <CalendarClock size={14} /> 设定
            </Button>
          </div>
        }
      >
        <div className="space-y-3">
          <p className="text-sm text-[#64748b]">
            到指定时间由调度器自动启动创作流水线。精度到分钟;时间按服务器本地时区解释。
          </p>
          <Field label="触发时间">
            <input
              type="datetime-local"
              step={60}
              className="h-9 w-full rounded-md border border-[#e2e8f0] px-3 text-sm"
              value={scheduleDraft}
              onChange={(e) => setScheduleDraft(e.target.value)}
            />
          </Field>
          <p className="text-xs text-[#94a3b8]">
            提示:已发布/已通过/流水线中作品请改用"新建"或重置需求后重新启动。
          </p>
        </div>
      </Modal>

      {/* 批量定时创作(V9.6) */}
      <Modal
        open={batchOpen}
        title="设定批量定时创作"
        onClose={() => setBatchOpen(false)}
        footer={
          <div className="flex justify-end gap-2">
            <Button variant="ghost" size="sm" onClick={() => setBatchOpen(false)}>
              取消
            </Button>
            <Button
              variant="primary"
              size="sm"
              onClick={() => void submitBatchSchedule()}
              disabled={batchSubmitting || !batchTimeDraft}
            >
              <CalendarClock size={14} /> 设定
            </Button>
          </div>
        }
      >
        <div className="space-y-3">
          <p className="text-sm text-[#64748b]">
            到点由调度器一次性创建 {batchCountDraft || 'N'} 篇短篇并逐篇启动创作流水线;标题未填时自动生成,通过评审后自动发布。
          </p>
          <Field label="触发时间">
            <input
              type="datetime-local"
              step={60}
              className="h-9 w-full rounded-md border border-[#e2e8f0] px-3 text-sm"
              value={batchTimeDraft}
              onChange={(e) => setBatchTimeDraft(e.target.value)}
            />
          </Field>
          <Field label="生成数量(1..50)">
            <input
              type="number"
              min={1}
              max={50}
              className="h-9 w-full rounded-md border border-[#e2e8f0] px-3 text-sm"
              value={batchCountDraft}
              onChange={(e) => setBatchCountDraft(e.target.value)}
            />
          </Field>
          <Field label="创作主题(可选)">
            <Input
              value={batchThemeDraft}
              onChange={(e) => setBatchThemeDraft(e.target.value)}
              placeholder="每篇共用;留空则自由创作"
            />
          </Field>
          <Field label="故事梗概(可选)">
            <Textarea
              className="min-h-[72px]"
              value={batchSynopsisDraft}
              onChange={(e) => setBatchSynopsisDraft(e.target.value)}
              placeholder="每篇共用;留空则自由创作"
            />
          </Field>
        </div>
      </Modal>

      {/* 用户编辑版本(V9.5 阶段二补丁) */}
      <VersionEditModal
        open={editingVersion !== null}
        version={editingVersion}
        onSave={(content) => void onEditVersionSave(content)}
        onClose={() => setEditingVersion(null)}
      />

      {/* 已发布作品:查看读者页快捷入口 */}
      {detail && detail.publication ? (
        <Link
          href={`/short/${detail.story.id}`}
          target="_blank"
          className="mt-3 inline-flex items-center gap-1 text-sm text-[#1677ff] hover:underline"
        >
          <ExternalLink size={13} /> 打开读者页 /short/{detail.story.id}
        </Link>
      ) : null}

      {/* 底部说明 */}
      <p className="mt-6 flex items-center gap-2 text-xs text-[#94a3b8]">
        <ListChecks size={14} /> 自动流程:生成 → AI 评审 → 未达标自动优化(受规则版本轮数约束)→ 再评审;所有版本与评审记录永久留痕。
        {detail ? (
          <span className="ml-2 inline-flex items-center gap-1 text-[#047857]">
            <CheckCircle2 size={12} /> 当前规则链路可在「AI 评审中心」追溯
          </span>
        ) : null}
      </p>
    </div>
  );
}
