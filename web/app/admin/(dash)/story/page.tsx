'use client';

// AI 创作中心:选书 → Story Core 事实管理(世界观/人物/关系/故事线/大纲/伏笔) + AI 章节生成工作台
// 结构蓝图见 PR16 描述;所有卡片复用 ui.tsx 原语与既有 LSG token

import { Bot, CalendarClock, Flame, ListChecks, Pencil, Plus, Sparkles, Trash2, Users } from 'lucide-react';
import { useCallback, useEffect, useState, type FormEvent } from 'react';
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
  Textarea,
} from '@/components/admin/ui';

interface StoryWorld {
  bookId: string;
  setting: string;
  rules: string;
}
interface StoryCharacter {
  id: number;
  name: string;
  role: string;
  persona: string;
  appearance: string;
  background: string;
  state: string;
}
interface StoryRelationship {
  id: number;
  fromName: string;
  toName: string;
  kind: string;
  note: string;
}
interface StoryArc {
  id: number;
  title: string;
  summary: string;
  startChapter: number | null;
  endChapter: number | null;
  status: string;
}
interface StoryOutline {
  id: number;
  number: number;
  title: string;
  beats: string;
}
interface StoryForeshadowing {
  id: number;
  label: string;
  detail: string;
  plantedChapter: number | null;
  resolvedChapter: number | null;
}
interface StoryBundle {
  world: StoryWorld;
  characters: StoryCharacter[];
  relationships: StoryRelationship[];
  arcs: StoryArc[];
  outlines: StoryOutline[];
  foreshadowing: StoryForeshadowing[];
}
interface BookOption {
  id: string;
  title: string;
  chapterCount: number;
}

const ROLE_BADGE: Record<string, { tone: 'success' | 'danger' | 'info' | 'warning'; label: string }> = {
  protagonist: { tone: 'success', label: '主角' },
  antagonist: { tone: 'danger', label: '反派' },
  supporting: { tone: 'info', label: '配角' },
  minor: { tone: 'warning', label: '龙套' },
};
const ARC_STATUS_BADGE: Record<string, { tone: 'info' | 'running' | 'success'; label: string }> = {
  planned: { tone: 'info', label: '规划中' },
  active: { tone: 'running', label: '进行中' },
  done: { tone: 'success', label: '完结' },
};

export default function AdminStoryPage() {
  const [books, setBooks] = useState<BookOption[] | null>(null);
  const [bookId, setBookId] = useState<string>('');
  const [story, setStory] = useState<StoryBundle | null>(null);
  const [chaptersMax, setChaptersMax] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  // 世界观
  const [worldForm, setWorldForm] = useState({ setting: '', rules: '' });
  const [savingWorld, setSavingWorld] = useState(false);

  // 人物弹窗
  const [charModal, setCharModal] = useState<null | { mode: 'create' } | { mode: 'edit'; c: StoryCharacter }>(null);
  const [charForm, setCharForm] = useState({ name: '', role: 'supporting', persona: '', appearance: '', background: '', state: '' });
  const [deleteTarget, setDeleteTarget] = useState<{ kind: 'character' | 'relationship' | 'arc' | 'outline' | 'foreshadowing'; id: number; label: string } | null>(null);
  const [deleting, setDeleting] = useState(false);

  // 关系内联表单
  const [relForm, setRelForm] = useState({ fromName: '', toName: '', kind: '', note: '' });

  // 故事线弹窗
  const [arcModal, setArcModal] = useState<null | { mode: 'create' } | { mode: 'edit'; a: StoryArc }>(null);
  const [arcForm, setArcForm] = useState({ title: '', summary: '', startChapter: '', endChapter: '', status: 'planned' });

  // 大纲弹窗
  const [outlineModal, setOutlineModal] = useState<null | { mode: 'create' } | { mode: 'edit'; o: StoryOutline }>(null);
  const [outlineForm, setOutlineForm] = useState({ number: '', title: '', beats: '' });

  // 伏笔
  const [plantModal, setPlantModal] = useState(false);
  const [plantForm, setPlantForm] = useState({ label: '', detail: '', plantedChapter: '' });
  const [resolveModal, setResolveModal] = useState<StoryForeshadowing | null>(null);
  const [resolveChapter, setResolveChapter] = useState('');

  // AI 工作台
  const [aiInstructions, setAiInstructions] = useState('');
  const [aiSubmit, setAiSubmit] = useState(true);
  const [aiReview, setAiReview] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [aiResult, setAiResult] = useState<null | { ok: boolean; lines: string[] }>(null);

  // AI 自动连载
  interface SerialConfig {
    enabled: boolean;
    hour: number;
    count: number;
    autoPublish: boolean;
    minChars: number;
  }
  interface SerialJob {
    id: number;
    bookId?: string;
    chapterNumber: number | null;
    status: 'pending' | 'running' | 'published' | 'submitted' | 'held' | 'draft' | 'rejected' | 'failed';
    error: string | null;
    chars: number | null;
    model: string | null;
    updatedAt: string;
  }
  const JOB_BADGE: Record<SerialJob['status'], { tone: 'success' | 'warning' | 'danger' | 'info' | 'running'; label: string }> = {
    published: { tone: 'success', label: '已发布' },
    submitted: { tone: 'info', label: '待审核' },
    rejected: { tone: 'warning', label: '质检拒绝' },
    failed: { tone: 'danger', label: '失败' },
    running: { tone: 'running', label: '执行中' },
    pending: { tone: 'running', label: '排队中' },
    held: { tone: 'warning', label: '复核暂扣' },
    draft: { tone: 'info', label: '草稿' },
  };
  const [serialCfg, setSerialCfg] = useState({ enabled: false, hour: '8', count: '1', autoPublish: false, minChars: '500' });
  const [serialJobs, setSerialJobs] = useState<SerialJob[] | null>(null);
  const [batchCount, setBatchCount] = useState('5');
  const [serialBusy, setSerialBusy] = useState<'save' | 'enqueue' | 'run' | null>(null);

  const notify = (msg: string) => {
    setNotice(msg);
    setError(null);
  };

  const loadBooks = useCallback(async () => {
    try {
      const res = await api<{ books: Array<{ id: string; title: string; chapterCount: number }> }>('/api/admin/books?limit=500');
      setBooks(res.books);
      if (res.books.length > 0) setBookId((prev) => prev || res.books[0].id);
    } catch (err) {
      setError(err instanceof Error ? err.message : '加载书籍失败');
      setBooks([]);
    }
  }, []);

  const loadStory = useCallback(async (id: string) => {
    if (!id) return;
    setLoading(true);
    try {
      setError(null);
      const [bundle, chaptersRes] = await Promise.all([
        api<StoryBundle>(`/api/admin/books/${id}/story`),
        api<{ chapters: Array<{ number: number }> }>(`/api/admin/books/${id}/chapters`),
      ]);
      setStory(bundle);
      setWorldForm({ setting: bundle.world.setting, rules: bundle.world.rules });
      setChaptersMax(chaptersRes.chapters.reduce((m, c) => Math.max(m, c.number), 0));
    } catch (err) {
      setError(err instanceof Error ? err.message : '加载失败');
      setStory(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadBooks();
  }, [loadBooks]);
  useEffect(() => {
    void loadStory(bookId);
  }, [bookId, loadStory]);

  const loadSerial = useCallback(async (id: string) => {
    if (!id) return;
    try {
      const [cfg, jobs] = await Promise.all([
        api<{ config: SerialConfig }>(`/api/admin/books/${id}/ai-serialization`),
        api<{ jobs: SerialJob[] }>(`/api/admin/ai/serial/jobs?bookId=${id}&limit=10`),
      ]);
      setSerialCfg({
        enabled: cfg.config.enabled,
        hour: String(cfg.config.hour),
        count: String(cfg.config.count),
        autoPublish: cfg.config.autoPublish,
        minChars: String(cfg.config.minChars),
      });
      setSerialJobs(jobs.jobs);
    } catch {
      setSerialJobs([]);
    }
  }, []);
  useEffect(() => {
    void loadSerial(bookId);
  }, [bookId, loadSerial]);

  async function saveSerial(): Promise<void> {
    if (serialBusy) return;
    setSerialBusy('save');
    try {
      await api(`/api/admin/books/${bookId}/ai-serialization`, {
        method: 'PUT',
        body: JSON.stringify({ enabled: serialCfg.enabled, hour: Number(serialCfg.hour), count: Number(serialCfg.count), autoPublish: serialCfg.autoPublish, minChars: Number(serialCfg.minChars) }),
      });
      notify(serialCfg.enabled ? `AI 连载已启用:每日 ${serialCfg.hour} 点生成 ${serialCfg.count} 章` : 'AI 连载配置已保存(停用)');
      await loadSerial(bookId);
    } catch (err) {
      setError(err instanceof Error ? err.message : '保存失败');
    } finally {
      setSerialBusy(null);
    }
  }

  async function batchEnqueue(): Promise<void> {
    if (serialBusy) return;
    setSerialBusy('enqueue');
    try {
      const res = await api<{ jobs: unknown[] }>('/api/admin/ai/serial/enqueue', { method: 'POST', body: JSON.stringify({ bookId, count: Math.max(1, Math.min(50, Number(batchCount) || 1)) }) });
      notify(`已入队 ${res.jobs.length} 个生成任务${serialCfg.autoPublish ? ',处理通过后将自动发布' : ',通过质检后进入审核队列'}`);
      await loadSerial(bookId);
    } catch (err) {
      setError(err instanceof Error ? err.message : '入队失败');
    } finally {
      setSerialBusy(null);
    }
  }

  async function processQueue(): Promise<void> {
    if (serialBusy) return;
    setSerialBusy('run');
    try {
      // 后台模式:立即 kick,轮询到本书无 pending/running 为止(上限 10 分钟)
      await api('/api/admin/ai/serial/run', { method: 'POST', body: JSON.stringify({ mode: 'background', limit: 20 }) });
      notify('后台处理已启动…');
      const deadline = Date.now() + 10 * 60 * 1000;
      while (Date.now() < deadline) {
        await new Promise((r) => setTimeout(r, 3000));
        const list = await api<{ jobs: SerialJob[] }>(`/api/admin/ai/serial/jobs?bookId=${bookId}&limit=10`);
        setSerialJobs(list.jobs);
        if (!list.jobs.some((j) => j.status === 'pending' || j.status === 'running')) break;
      }
      window.dispatchEvent(new CustomEvent('admin:review-changed'));
      await loadStory(bookId);
      setNotice('队列处理结束,结果见下方任务列表');
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : '处理失败');
    } finally {
      setSerialBusy(null);
    }
  }

  async function run(promise: Promise<unknown>, okMsg: string): Promise<boolean> {
    try {
      await promise;
      notify(okMsg);
      await loadStory(bookId);
      return true;
    } catch (err) {
      setError(err instanceof Error ? err.message : '操作失败');
      return false;
    }
  }

  async function saveWorld(e: FormEvent): Promise<void> {
    e.preventDefault();
    setSavingWorld(true);
    await run(api(`/api/admin/books/${bookId}/story/world`, { method: 'PUT', body: JSON.stringify(worldForm) }), '世界观已保存');
    setSavingWorld(false);
  }

  async function saveCharacter(e: FormEvent): Promise<void> {
    e.preventDefault();
    const payload = charModal?.mode === 'edit' ? { ...charForm, characterId: charModal.c.id } : charForm;
    if (await run(api(`/api/admin/books/${bookId}/story/characters`, { method: 'POST', body: JSON.stringify(payload) }), '人物已保存')) {
      setCharModal(null);
    }
  }

  async function addRelationship(e: FormEvent): Promise<void> {
    e.preventDefault();
    if (
      await run(
        api(`/api/admin/books/${bookId}/story/relationships`, { method: 'POST', body: JSON.stringify(relForm) }),
        '关系已添加'
      )
    ) {
      setRelForm({ fromName: '', toName: '', kind: '', note: '' });
    }
  }

  async function saveArc(e: FormEvent): Promise<void> {
    e.preventDefault();
    const num = (v: string) => (v === '' ? null : Number(v));
    const payload =
      arcModal?.mode === 'edit'
        ? { arcId: arcModal.a.id, title: arcForm.title, summary: arcForm.summary, startChapter: num(arcForm.startChapter), endChapter: num(arcForm.endChapter), status: arcForm.status }
        : { ...arcForm, startChapter: num(arcForm.startChapter), endChapter: num(arcForm.endChapter) };
    if (await run(api(`/api/admin/books/${bookId}/story/arcs`, { method: arcModal?.mode === 'edit' ? 'PUT' : 'POST', body: JSON.stringify(payload) }), '故事线已保存')) {
      setArcModal(null);
    }
  }

  async function saveOutline(e: FormEvent): Promise<void> {
    e.preventDefault();
    if (
      await run(
        api(`/api/admin/books/${bookId}/story/outlines`, { method: 'PUT', body: JSON.stringify({ number: Number(outlineForm.number), title: outlineForm.title, beats: outlineForm.beats }) }),
        '大纲已保存'
      )
    ) {
      setOutlineModal(null);
    }
  }

  async function plantForeshadowingSubmit(e: FormEvent): Promise<void> {
    e.preventDefault();
    if (
      await run(
        api(`/api/admin/books/${bookId}/story/foreshadowing`, {
          method: 'POST',
          body: JSON.stringify({ label: plantForm.label, detail: plantForm.detail, plantedChapter: plantForm.plantedChapter === '' ? null : Number(plantForm.plantedChapter) }),
        }),
        '伏笔已埋设'
      )
    ) {
      setPlantModal(false);
    }
  }

  async function resolveForeshadowingSubmit(e: FormEvent): Promise<void> {
    e.preventDefault();
    if (!resolveModal) return;
    if (
      await run(
        api(`/api/admin/books/${bookId}/story/foreshadowing`, { method: 'PUT', body: JSON.stringify({ foreshadowingId: resolveModal.id, resolvedChapter: Number(resolveChapter) }) }),
        `「${resolveModal.label}」已在第 ${resolveChapter} 章回收`
      )
    ) {
      setResolveModal(null);
    }
  }

  async function doDelete(): Promise<void> {
    if (!deleteTarget || deleting) return;
    setDeleting(true);
    const paths: Record<typeof deleteTarget.kind, string> = {
      character: `/api/admin/books/${bookId}/story/characters?id=${deleteTarget.id}`,
      relationship: `/api/admin/books/${bookId}/story/relationships?id=${deleteTarget.id}`,
      arc: `/api/admin/books/${bookId}/story/arcs?id=${deleteTarget.id}`,
      outline: `/api/admin/books/${bookId}/story/outlines?number=${deleteTarget.id}`,
      foreshadowing: `/api/admin/books/${bookId}/story/foreshadowing?id=${deleteTarget.id}`,
    };
    await run(api(paths[deleteTarget.kind], { method: 'DELETE' }), `已删除:${deleteTarget.label}`);
    setDeleting(false);
    setDeleteTarget(null);
  }

  async function generate(): Promise<void> {
    if (!bookId || generating) return;
    setGenerating(true);
    setAiResult(null);
    setError(null);
    try {
      // 后台队列模式:入队 → kick 后台执行 → 轮询任务状态。
      // 同步等待整章 LLM 生成会被反代(nginx/宝塔默认 60s)掐成 504。
      const enq = await api<{ jobs: Array<{ id: number }> }>('/api/admin/ai/serial/enqueue', {
        method: 'POST',
        body: JSON.stringify({ bookId, count: 1, instructions: aiInstructions || null, submitForReview: aiSubmit, llmReview: aiReview }),
      });
      const jobId = enq.jobs[0].id;
      await api('/api/admin/ai/serial/run', { method: 'POST', body: JSON.stringify({ mode: 'background', limit: 20 }) });
      notify('已进入后台生成队列,执行中…');

      // 轮询本任务直至终态(上限 10 分钟)
      const deadline = Date.now() + 10 * 60 * 1000;
      let finalJob: SerialJob | null = null;
      while (Date.now() < deadline) {
        await new Promise((r) => setTimeout(r, 3000));
        const list = await api<{ jobs: SerialJob[] }>(`/api/admin/ai/serial/jobs?bookId=${bookId}&limit=10`);
        setSerialJobs(list.jobs);
        const me = list.jobs.find((j) => j.id === jobId) ?? null;
        if (me && !['pending', 'running'].includes(me.status)) {
          finalJob = me;
          break;
        }
      }

      if (!finalJob) {
        setAiResult({ ok: false, lines: ['后台执行超时未返回,请稍后在任务列表查看结果'] });
      } else if (finalJob.status === 'published' || finalJob.status === 'submitted') {
        const parts = [`第 ${finalJob.chapterNumber} 章已落稿(${finalJob.chars ?? '?'} 字)`];
        parts.push(finalJob.status === 'published' ? '已自动发布上线' : '已送入审核队列');
        setAiResult({ ok: true, lines: parts });
        window.dispatchEvent(new Event('admin:review-changed'));
        await loadStory(bookId);
      } else if (finalJob.status === 'held') {
        setAiResult({ ok: false, lines: [`第 ${finalJob.chapterNumber} 章被 LLM 复核暂扣,可在审核队列查看备注`] });
        window.dispatchEvent(new Event('admin:review-changed'));
        await loadStory(bookId);
      } else if (finalJob.status === 'draft') {
        setAiResult({ ok: true, lines: [`第 ${finalJob.chapterNumber} 章已保存为草稿(未送审)`] });
        await loadStory(bookId);
      } else if (finalJob.status === 'rejected') {
        setAiResult({ ok: false, lines: ['质检未通过,未落稿:', finalJob.error ?? ''] });
      } else {
        setAiResult({ ok: false, lines: ['生成失败:', finalJob.error ?? '未知错误'] });
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : '生成失败');
    } finally {
      setGenerating(false);
    }
  }

  return (
    <div>
      {error ? <Notice tone="error">{error}</Notice> : null}
      {notice ? <Notice tone="success">{notice}</Notice> : null}

      {/* 书籍选择条 */}
      <div className="mb-5 flex flex-wrap items-center gap-3 rounded-xl bg-white p-4 shadow-sm">
        <span className="flex h-10 w-10 items-center justify-center rounded-xl text-white" style={{ background: 'linear-gradient(135deg,#8b5cf6,#6d28d9)' }}>
          <Sparkles size={20} aria-hidden />
        </span>
        <h1 className="text-lg font-semibold text-[#0f172a]">AI 创作中心</h1>
        <div className="min-w-[240px]">
          <Select value={bookId} onChange={(e) => setBookId(e.target.value)} aria-label="选择书籍">
            {(books ?? []).map((b) => (
              <option key={b.id} value={b.id}>
                《{b.title}》(共 {b.chapterCount} 章)
              </option>
            ))}
          </Select>
        </div>
        {loading ? <Spinner size={16} /> : null}
      </div>

      {!story ? (
        books && books.length === 0 ? (
          <EmptyState icon={<Sparkles size={32} />} title="还没有书籍" description="先在「小说管理」创建一本书,再回到这里搭建它的世界观。" />
        ) : (
          <div className="flex min-h-[200px] items-center justify-center gap-2 rounded-xl bg-white text-sm text-[#64748b] shadow-sm">
            <Spinner size={18} /> 加载中…
          </div>
        )
      ) : (
        <>
          {/* 世界观卡 */}
          <form onSubmit={(e) => void saveWorld(e)} className="mb-5 rounded-xl bg-white p-5 shadow-sm">
            <div className="mb-4 flex items-center gap-2">
              <Flame size={18} className="text-[#1677ff]" aria-hidden />
              <h2 className="text-base font-semibold text-[#0f172a]">世界观与写作规则</h2>
            </div>
            <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
              <Field label="世界观设定(每次生成都会注入)">
                <Textarea rows={5} value={worldForm.setting} onChange={(e) => setWorldForm({ ...worldForm, setting: e.target.value })} placeholder="大陆格局、力量体系、时代背景…" />
              </Field>
              <Field label="写作规则">
                <Textarea rows={5} value={worldForm.rules} onChange={(e) => setWorldForm({ ...worldForm, rules: e.target.value })} placeholder="如:单章三千字;每章结尾留钩子;禁止现代词汇" />
              </Field>
            </div>
            <div className="mt-4">
              <Button variant="primary" type="submit" disabled={savingWorld}>
                {savingWorld ? '保存中…' : '保存世界观'}
              </Button>
            </div>
          </form>

          {/* 人物卡 */}
          <section className="mb-5 overflow-hidden rounded-xl bg-white shadow-sm">
            <header className="flex h-14 items-center gap-2 border-b border-[#f1f5f9] px-5">
              <Users size={18} className="text-[#1677ff]" aria-hidden />
              <h2 className="text-base font-semibold text-[#0f172a]">人物</h2>
              <span className="text-sm text-[#94a3b8]">{story.characters.length}</span>
              <Button variant="primary" size="sm" className="ml-auto" onClick={() => { setCharForm({ name: '', role: 'supporting', persona: '', appearance: '', background: '', state: '' }); setCharModal({ mode: 'create' }); }}>
                <Plus size={14} /> 添加人物
              </Button>
            </header>
            {story.characters.length === 0 ? (
              <EmptyState icon={<Users size={28} />} title="没有人物" description="添加主角、反派与其当前状态——它们会随上下文进入每一次生成。" />
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full min-w-[720px] border-collapse text-left">
                  <thead>
                    <tr className="h-11 bg-[#f8fafc] text-[13px] font-semibold text-[#334155]">
                      <th className="border-b border-[#e2e8f0] px-4 font-semibold">姓名</th>
                      <th className="border-b border-[#e2e8f0] px-4 font-semibold">定位</th>
                      <th className="border-b border-[#e2e8f0] px-4 font-semibold">性格 / 当前状态</th>
                      <th className="border-b border-[#e2e8f0] px-4 text-right font-semibold">操作</th>
                    </tr>
                  </thead>
                  <tbody>
                    {story.characters.map((c) => (
                      <tr key={c.id} className="group h-12 transition-all duration-200 hover:bg-[#f8fafc]">
                        <td className="border-b border-[#f1f5f9] px-4 text-sm font-medium text-[#334155]">{c.name}</td>
                        <td className="border-b border-[#f1f5f9] px-4">
                          <Badge tone={(ROLE_BADGE[c.role] ?? { tone: 'info' }).tone}>{(ROLE_BADGE[c.role] ?? { label: c.role }).label}</Badge>
                        </td>
                        <td className="border-b border-[#f1f5f9] px-4 text-xs text-[#64748b]">{[c.persona, c.state].filter(Boolean).join(' · ') || '—'}</td>
                        <td className="border-b border-[#f1f5f9] px-4">
                          <div className="flex items-center justify-end gap-1 transition-opacity duration-250 md:opacity-0 md:group-hover:opacity-100 md:focus-within:opacity-100">
                            <button aria-label={`编辑${c.name}`} onClick={() => { setCharForm({ name: c.name, role: c.role, persona: c.persona, appearance: c.appearance, background: c.background, state: c.state }); setCharModal({ mode: 'edit', c }); }} className="flex h-7 w-7 items-center justify-center rounded-md text-[#64748b] transition-all duration-150 hover:-translate-y-px hover:bg-[#e8f3ff] hover:text-[#1677ff] hover:shadow-sm">
                              <Pencil size={15} />
                            </button>
                            <button aria-label={`删除${c.name}`} onClick={() => setDeleteTarget({ kind: 'character', id: c.id, label: `人物「${c.name}」` })} className="flex h-7 w-7 items-center justify-center rounded-md text-[#64748b] transition-all duration-150 hover:-translate-y-px hover:bg-[#fee2e2] hover:text-[#b91c1c] hover:shadow-sm">
                              <Trash2 size={15} />
                            </button>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>

          {/* 关系卡 */}
          <section className="mb-5 rounded-xl bg-white p-5 shadow-sm">
            <h2 className="mb-3 text-base font-semibold text-[#0f172a]">人物关系</h2>
            {story.relationships.length === 0 ? (
              <p className="mb-3 text-xs text-[#94a3b8]">尚无关系记录。</p>
            ) : (
              <ul className="mb-4 space-y-1.5">
                {story.relationships.map((r) => (
                  <li key={r.id} className="group flex items-center gap-2 rounded-md px-2 py-1.5 text-sm transition-colors duration-200 hover:bg-[#f8fafc]">
                    <span className="font-medium text-[#334155]">{r.fromName}</span>
                    <span className="text-[#94a3b8]">→</span>
                    <span className="font-medium text-[#334155]">{r.toName}</span>
                    <Badge tone="info">{r.kind}</Badge>
                    {r.note ? <span className="truncate text-xs text-[#94a3b8]">{r.note}</span> : null}
                    <button aria-label={`删除关系${r.fromName}${r.toName}`} onClick={() => void run(api(`/api/admin/books/${bookId}/story/relationships?id=${r.id}`, { method: 'DELETE' }), '关系已删除')} className="ml-auto flex h-6 w-6 shrink-0 items-center justify-center rounded-md text-[#cbd5e1] transition-all duration-150 hover:bg-[#fee2e2] hover:text-[#b91c1c] md:opacity-0 md:group-hover:opacity-100 md:focus-within:opacity-100">
                      <Trash2 size={13} />
                    </button>
                  </li>
                ))}
              </ul>
            )}
            <form onSubmit={(e) => void addRelationship(e)} className="flex flex-wrap items-end gap-2 border-t border-[#f1f5f9] pt-4">
              <Field label="A">
                <Input value={relForm.fromName} onChange={(e) => setRelForm({ ...relForm, fromName: e.target.value })} className="w-28" />
              </Field>
              <Field label="B">
                <Input value={relForm.toName} onChange={(e) => setRelForm({ ...relForm, toName: e.target.value })} className="w-28" />
              </Field>
              <Field label="关系">
                <Input value={relForm.kind} onChange={(e) => setRelForm({ ...relForm, kind: e.target.value })} placeholder="宿敌/师徒/盟友" className="w-32" />
              </Field>
              <Field label="备注">
                <Input value={relForm.note} onChange={(e) => setRelForm({ ...relForm, note: e.target.value })} className="w-40" />
              </Field>
              <Button variant="secondary" type="submit" size="md" disabled={!relForm.fromName || !relForm.toName || !relForm.kind}>
                添加关系
              </Button>
            </form>
          </section>

          {/* 故事线卡 */}
          <section className="mb-5 overflow-hidden rounded-xl bg-white shadow-sm">
            <header className="flex h-14 items-center gap-2 border-b border-[#f1f5f9] px-5">
              <h2 className="text-base font-semibold text-[#0f172a]">故事线</h2>
              <Button variant="primary" size="sm" className="ml-auto" onClick={() => { setArcForm({ title: '', summary: '', startChapter: String(chaptersMax + 1), endChapter: '', status: 'planned' }); setArcModal({ mode: 'create' }); }}>
                <Plus size={14} /> 新增故事线
              </Button>
            </header>
            {story.arcs.length === 0 ? (
              <EmptyState icon={<Bot size={28} />} title="没有故事线" description="按卷/段落拆分故事线,生成时会作为背景注入。" />
            ) : (
              <ul>
                {story.arcs.map((a) => (
                  <li key={a.id} className="group flex items-center gap-3 border-b border-[#f1f5f9] px-5 py-3 transition-colors duration-200 last:border-b-0 hover:bg-[#f8fafc]">
                    <Badge tone={(ARC_STATUS_BADGE[a.status] ?? { tone: 'info' }).tone}>{(ARC_STATUS_BADGE[a.status] ?? { label: a.status }).label}</Badge>
                    <span className="text-sm font-medium text-[#334155]">{a.title}</span>
                    <span className="truncate text-xs text-[#94a3b8]">
                      {a.startChapter !== null || a.endChapter !== null ? `第 ${a.startChapter ?? '?'}–${a.endChapter ?? '?'} 章 · ` : ''}
                      {a.summary}
                    </span>
                    <span className="ml-auto flex shrink-0 gap-1 transition-opacity duration-250 md:opacity-0 md:group-hover:opacity-100 md:focus-within:opacity-100">
                      <button aria-label={`编辑${a.title}`} onClick={() => { setArcForm({ title: a.title, summary: a.summary, startChapter: a.startChapter?.toString() ?? '', endChapter: a.endChapter?.toString() ?? '', status: a.status }); setArcModal({ mode: 'edit', a }); }} className="flex h-7 w-7 items-center justify-center rounded-md text-[#64748b] transition-all duration-150 hover:-translate-y-px hover:bg-[#e8f3ff] hover:text-[#1677ff] hover:shadow-sm">
                        <Pencil size={15} />
                      </button>
                      <button aria-label={`删除${a.title}`} onClick={() => setDeleteTarget({ kind: 'arc', id: a.id, label: `故事线「${a.title}」` })} className="flex h-7 w-7 items-center justify-center rounded-md text-[#64748b] transition-all duration-150 hover:-translate-y-px hover:bg-[#fee2e2] hover:text-[#b91c1c] hover:shadow-sm">
                        <Trash2 size={15} />
                      </button>
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </section>

          {/* 大纲卡 */}
          <section className="mb-5 overflow-hidden rounded-xl bg-white shadow-sm">
            <header className="flex h-14 items-center gap-2 border-b border-[#f1f5f9] px-5">
              <h2 className="text-base font-semibold text-[#0f172a]">章节大纲</h2>
              <span className="text-xs text-[#94a3b8]">有大纲的章生成时强制覆盖要点</span>
              <Button variant="primary" size="sm" className="ml-auto" onClick={() => { setOutlineForm({ number: String(chaptersMax + 1), title: '', beats: '' }); setOutlineModal({ mode: 'create' }); }}>
                <Plus size={14} /> 写大纲
              </Button>
            </header>
            {story.outlines.length === 0 ? (
              <EmptyState icon={<Pencil size={28} />} title="暂无大纲" description="为接下来的章节写好要点(beat list),AI 依纲而写。" />
            ) : (
              <ul>
                {story.outlines.map((o) => (
                  <li key={o.id} className="group flex items-center gap-3 border-b border-[#f1f5f9] px-5 py-3 transition-colors duration-200 last:border-b-0 hover:bg-[#f8fafc]">
                    <span className="w-16 shrink-0 rounded-full bg-[#eef2ff] px-2 py-0.5 text-center text-xs font-medium text-[#4338ca]">第{o.number}章</span>
                    <span className="shrink-0 text-sm font-medium text-[#334155]">{o.title || '(未命名)'}</span>
                    <span className="line-clamp-1 text-xs text-[#94a3b8]">{o.beats.replace(/^- /gm, '').split('\n').join(' / ')}</span>
                    <span className="ml-auto flex shrink-0 gap-1 transition-opacity duration-250 md:opacity-0 md:group-hover:opacity-100 md:focus-within:opacity-100">
                      <button aria-label={`编辑第${o.number}章大纲`} onClick={() => { setOutlineForm({ number: String(o.number), title: o.title, beats: o.beats }); setOutlineModal({ mode: 'edit', o }); }} className="flex h-7 w-7 items-center justify-center rounded-md text-[#64748b] transition-all duration-150 hover:-translate-y-px hover:bg-[#e8f3ff] hover:text-[#1677ff] hover:shadow-sm">
                        <Pencil size={15} />
                      </button>
                      <button aria-label={`删除第${o.number}章大纲`} onClick={() => setDeleteTarget({ kind: 'outline', id: o.number, label: `第${o.number}章大纲` })} className="flex h-7 w-7 items-center justify-center rounded-md text-[#64748b] transition-all duration-150 hover:-translate-y-px hover:bg-[#fee2e2] hover:text-[#b91c1c] hover:shadow-sm">
                        <Trash2 size={15} />
                      </button>
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </section>

          {/* 伏笔卡 */}
          <section className="mb-5 overflow-hidden rounded-xl bg-white shadow-sm">
            <header className="flex h-14 items-center gap-2 border-b border-[#f1f5f9] px-5">
              <h2 className="text-base font-semibold text-[#0f172a]">伏笔</h2>
              <span className="text-xs text-[#94a3b8]">未回收项会持续出现在生成上下文中</span>
              <Button variant="primary" size="sm" className="ml-auto" onClick={() => { setPlantForm({ label: '', detail: '', plantedChapter: '' }); setPlantModal(true); }}>
                <Plus size={14} /> 埋设伏笔
              </Button>
            </header>
            {story.foreshadowing.length === 0 ? (
              <EmptyState icon={<Sparkles size={28} />} title="暂无伏笔" description="埋下的钩子会被记住,AI 写作时可择机回收。" />
            ) : (
              <ul>
                {story.foreshadowing.map((f) => (
                  <li key={f.id} className="group flex items-center gap-3 border-b border-[#f1f5f9] px-5 py-3 transition-colors duration-200 last:border-b-0 hover:bg-[#f8fafc]">
                    <span className="text-sm font-medium text-[#334155]">{f.label}</span>
                    {f.plantedChapter !== null ? <span className="text-xs text-[#94a3b8]">埋于第{f.plantedChapter}章</span> : null}
                    {f.resolvedChapter !== null ? (
                      <Badge tone="success">已于第{f.resolvedChapter}章回收</Badge>
                    ) : (
                      <Badge tone="warning">未回收</Badge>
                    )}
                    <span className="truncate text-xs text-[#94a3b8]">{f.detail}</span>
                    <span className="ml-auto flex shrink-0 gap-1 transition-opacity duration-250 md:opacity-0 md:group-hover:opacity-100 md:focus-within:opacity-100">
                      {f.resolvedChapter === null ? (
                        <Button variant="secondary" size="xs" onClick={() => { setResolveChapter(String(chaptersMax + 1)); setResolveModal(f); }}>
                          标记回收
                        </Button>
                      ) : null}
                      <button aria-label={`删除伏笔${f.label}`} onClick={() => setDeleteTarget({ kind: 'foreshadowing', id: f.id, label: `伏笔「${f.label}」` })} className="flex h-7 w-7 items-center justify-center rounded-md text-[#64748b] transition-all duration-150 hover:-translate-y-px hover:bg-[#fee2e2] hover:text-[#b91c1c] hover:shadow-sm">
                        <Trash2 size={15} />
                      </button>
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </section>

          {/* AI 工作台卡 */}
          <section className="overflow-hidden rounded-xl bg-white shadow-sm">
            <header className="flex h-14 items-center gap-2 px-5 text-white" style={{ background: 'linear-gradient(135deg,#7c3aed,#4f46e5)' }}>
              <Sparkles size={18} aria-hidden />
              <h2 className="text-base font-semibold">AI 工作台 · 生成章节草稿</h2>
              <span className="ml-auto text-xs opacity-90">目标:第 {chaptersMax + 1} 章</span>
            </header>
            <div className="p-5">
              <Field label="额外指令(可选)">
                <Textarea rows={2} value={aiInstructions} onChange={(e) => setAiInstructions(e.target.value)} placeholder="如:本章以雨夜追逐战开场,结尾让灰烬现身" />
              </Field>
              <div className="mt-4 flex flex-wrap items-center gap-5">
                <label className="flex cursor-pointer items-center gap-2 text-sm text-[#334155]">
                  <input role="switch" type="checkbox" checked={aiSubmit} onChange={(e) => setAiSubmit(e.target.checked)} className="h-4 w-4 accent-[#1677ff]" />
                  质检通过后自动送审
                </label>
                <label className="flex cursor-pointer items-center gap-2 text-sm text-[#334155]" title="LLM 复核 FAIL 时扣在草稿并写明原因">
                  <input role="switch" type="checkbox" checked={aiReview} onChange={(e) => setAiReview(e.target.checked)} className="h-4 w-4 accent-[#1677ff]" />
                  LLM 编辑复核
                </label>
                <Button variant="primary" size="md" className="ml-auto" disabled={!bookId || generating} onClick={() => void generate()}>
                  {generating ? (
                    <>
                      <Spinner size={14} /> 生成中…
                    </>
                  ) : (
                    <>
                      <Sparkles size={14} /> 生成章节草稿
                    </>
                  )}
                </Button>
              </div>
              {aiResult ? (
                aiResult.ok ? (
                  <Notice tone="success">
                    <ul className="list-inside list-disc space-y-0.5">
                      {aiResult.lines.map((l) => (
                        <li key={l}>{l}</li>
                      ))}
                    </ul>
                  </Notice>
                ) : (
                  <Notice tone="error">
                    <ul className="list-inside list-disc space-y-0.5">
                      {aiResult.lines.map((l) => (
                        <li key={l}>{l}</li>
                      ))}
                    </ul>
                  </Notice>
                )
              ) : null}
              <p className="mt-3 text-xs leading-relaxed text-[#94a3b8]">
                生成前自动组装:世界观 · 人物状态 · 关系 · 进行中故事线 · 未回收伏笔 · 最近章节尾部 · 目标章大纲。质检拦截时不会写入任何章节。
              </p>
            </div>
          </section>

          {/* AI 自动连载卡 */}
          <section className="overflow-hidden rounded-xl bg-white shadow-sm">
            <header className="flex h-14 items-center gap-2 px-5 text-white" style={{ background: 'linear-gradient(135deg,#0ea5e9,#2563eb)' }}>
              <CalendarClock size={18} aria-hidden />
              <h2 className="text-base font-semibold">AI 自动连载 · 每日流水线</h2>
              <span className="ml-auto">
                {serialCfg.enabled ? (
                  <Badge tone="success">已启用</Badge>
                ) : (
                  <Badge tone="info">未启用</Badge>
                )}
              </span>
            </header>
            <div className="p-5">
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
                <Field label="状态">
                  <Select value={serialCfg.enabled ? 'on' : 'off'} onChange={(e) => setSerialCfg({ ...serialCfg, enabled: e.target.value === 'on' })}>
                    <option value="off">停用</option>
                    <option value="on">启用</option>
                  </Select>
                </Field>
                <Field label="每日时刻(北京时间 0-23 点)">
                  <Input type="number" min={0} max={23} value={serialCfg.hour} onChange={(e) => setSerialCfg({ ...serialCfg, hour: e.target.value })} />
                </Field>
                <Field label="每日生成章数(1-20)">
                  <Input type="number" min={1} max={20} value={serialCfg.count} onChange={(e) => setSerialCfg({ ...serialCfg, count: e.target.value })} />
                </Field>
                <Field label="发布模式">
                  <Select value={serialCfg.autoPublish ? 'auto' : 'review'} onChange={(e) => setSerialCfg({ ...serialCfg, autoPublish: e.target.value === 'auto' })}>
                    <option value="review">送审核队列(人工确认)</option>
                    <option value="auto">自动发布</option>
                  </Select>
                </Field>
                <Field label="质检字数下限(200-20000)">
                  <Input type="number" min={200} max={20000} value={serialCfg.minChars} onChange={(e) => setSerialCfg({ ...serialCfg, minChars: e.target.value })} />
                </Field>
              </div>
              <div className="mt-4 flex flex-wrap items-center gap-3">
                <Button variant="primary" disabled={!bookId || serialBusy !== null} onClick={() => void saveSerial()}>
                  {serialBusy === 'save' ? (
                    <>
                      <Spinner size={14} /> 保存中…
                    </>
                  ) : (
                    '保存连载配置'
                  )}
                </Button>
                <span className="flex items-center gap-2 text-sm text-[#334155]">
                  批量
                  <Input type="number" min={1} max={50} value={batchCount} onChange={(e) => setBatchCount(e.target.value)} className="w-20" aria-label="批量生成章数" />
                  章
                </span>
                <Button variant="secondary" disabled={!bookId || serialBusy !== null} onClick={() => void batchEnqueue()}>
                  {serialBusy === 'enqueue' ? (
                    <>
                      <Spinner size={14} /> 入队中…
                    </>
                  ) : (
                    <>
                      <Plus size={14} /> 批量生成入队
                    </>
                  )}
                </Button>
                <Button variant="secondary" disabled={serialBusy !== null || !serialJobs?.some((j) => j.status === 'pending')} onClick={() => void processQueue()}>
                  {serialBusy === 'run' ? (
                    <>
                      <Spinner size={14} /> 处理中…
                    </>
                  ) : (
                    <>
                      <ListChecks size={14} /> 立即处理队列
                    </>
                  )}
                </Button>
              </div>
              <p className="mt-3 text-xs leading-relaxed text-[#94a3b8]">
                启用后由常驻调度器(npm run scheduler)每日到点自动执行,「每日时刻」与任务列表时间均按北京时间;「立即处理队列」与调度器同一执行器。发布模式选「自动发布」即视为路线图中的人工确认放行。
              </p>

              <div className="mt-5 overflow-x-auto">
                <table className="w-full min-w-[640px] text-left text-sm">
                  <thead>
                    <tr className="border-b border-[#e2e8f0] bg-[#f8fafc] text-xs uppercase tracking-wide text-[#64748b]">
                      <th className="h-9 px-3 font-medium">状态</th>
                      <th className="h-9 px-3 font-medium">章号</th>
                      <th className="h-9 px-3 font-medium">字数</th>
                      <th className="h-9 px-3 font-medium">模型</th>
                      <th className="h-9 px-3 font-medium">时间</th>
                      <th className="h-9 px-3 font-medium">错误/说明</th>
                    </tr>
                  </thead>
                  <tbody>
                    {(serialJobs ?? []).length === 0 ? (
                      <tr>
                        <td colSpan={6} className="px-3 py-8 text-center text-[#94a3b8]">
                          暂无生成任务 — 保存配置等待每日自动执行,或用上方按钮批量入队
                        </td>
                      </tr>
                    ) : (
                      (serialJobs ?? []).map((j) => (
                        <tr key={j.id} className="border-b border-[#f1f5f9] transition-colors hover:bg-[#f8fafc]">
                          <td className="px-3 py-2.5">
                            <Badge tone={JOB_BADGE[j.status].tone}>{JOB_BADGE[j.status].label}</Badge>
                          </td>
                          <td className="px-3 py-2.5 text-[#334155]">{j.chapterNumber ?? '—'}</td>
                          <td className="px-3 py-2.5 text-[#334155]">{j.chars ?? '—'}</td>
                          <td className="px-3 py-2.5 text-[#64748b]">{j.model ?? '—'}</td>
                          <td className="px-3 py-2.5 whitespace-nowrap text-[#64748b]" title="北京时间">{formatChinaTime(j.updatedAt)}</td>
                          <td className="max-w-[220px] truncate px-3 py-2.5 text-[#b45309]" title={j.error ?? undefined}>
                            {j.error ?? '—'}
                          </td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          </section>
        </>
      )}

      {/* 人物弹窗 */}
      <Modal
        open={charModal !== null}
        title={charModal?.mode === 'edit' ? `编辑人物 · ${charModal.c.name}` : '添加人物'}
        onClose={() => setCharModal(null)}
        footer={
          <>
            <Button variant="secondary" onClick={() => setCharModal(null)}>
              取消
            </Button>
            <Button variant="primary" type="submit" form="char-form">
              保存
            </Button>
          </>
        }
      >
        <form id="char-form" onSubmit={(e) => void saveCharacter(e)} className="grid grid-cols-1 gap-4 sm:grid-cols-2" noValidate>
          <Field label="姓名*">
            <Input value={charForm.name} onChange={(e) => setCharForm({ ...charForm, name: e.target.value })} />
          </Field>
          <Field label="定位">
            <Select value={charForm.role} onChange={(e) => setCharForm({ ...charForm, role: e.target.value })}>
              <option value="protagonist">主角</option>
              <option value="antagonist">反派</option>
              <option value="supporting">配角</option>
              <option value="minor">龙套</option>
            </Select>
          </Field>
          <Field label="性格 / 说话方式">
            <Input value={charForm.persona} onChange={(e) => setCharForm({ ...charForm, persona: e.target.value })} />
          </Field>
          <Field label="当前状态(随剧情更新)">
            <Input value={charForm.state} onChange={(e) => setCharForm({ ...charForm, state: e.target.value })} placeholder="重伤初愈 / 潜伏中" />
          </Field>
          <div className="sm:col-span-2">
            <Field label="外貌">
              <Input value={charForm.appearance} onChange={(e) => setCharForm({ ...charForm, appearance: e.target.value })} />
            </Field>
          </div>
          <div className="sm:col-span-2">
            <Field label="背景故事">
              <Textarea rows={3} value={charForm.background} onChange={(e) => setCharForm({ ...charForm, background: e.target.value })} />
            </Field>
          </div>
        </form>
      </Modal>

      {/* 故事线弹窗 */}
      <Modal
        open={arcModal !== null}
        title={arcModal?.mode === 'edit' ? `编辑故事线 · ${arcModal.a.title}` : '新增故事线'}
        onClose={() => setArcModal(null)}
        footer={
          <>
            <Button variant="secondary" onClick={() => setArcModal(null)}>
              取消
            </Button>
            <Button variant="primary" type="submit" form="arc-form">
              保存
            </Button>
          </>
        }
      >
        <form id="arc-form" onSubmit={(e) => void saveArc(e)} className="grid grid-cols-1 gap-4 sm:grid-cols-2" noValidate>
          <div className="sm:col-span-2">
            <Field label="标题*">
              <Input value={arcForm.title} onChange={(e) => setArcForm({ ...arcForm, title: e.target.value })} />
            </Field>
          </div>
          <Field label="起始章">
            <Input type="number" min={1} value={arcForm.startChapter} onChange={(e) => setArcForm({ ...arcForm, startChapter: e.target.value })} />
          </Field>
          <Field label="结束章">
            <Input type="number" min={1} value={arcForm.endChapter} onChange={(e) => setArcForm({ ...arcForm, endChapter: e.target.value })} />
          </Field>
          <Field label="状态">
            <Select value={arcForm.status} onChange={(e) => setArcForm({ ...arcForm, status: e.target.value })}>
              <option value="planned">规划中</option>
              <option value="active">进行中</option>
              <option value="done">完结</option>
            </Select>
          </Field>
          <div className="sm:col-span-2">
            <Field label="概要">
              <Textarea rows={3} value={arcForm.summary} onChange={(e) => setArcForm({ ...arcForm, summary: e.target.value })} />
            </Field>
          </div>
        </form>
      </Modal>

      {/* 大纲弹窗 */}
      <Modal
        open={outlineModal !== null}
        title={outlineModal?.mode === 'edit' ? `编辑第 ${outlineModal.o.number} 章大纲` : '写章节大纲'}
        onClose={() => setOutlineModal(null)}
        footer={
          <>
            <Button variant="secondary" onClick={() => setOutlineModal(null)}>
              取消
            </Button>
            <Button variant="primary" type="submit" form="outline-form">
              保存
            </Button>
          </>
        }
      >
        <form id="outline-form" onSubmit={(e) => void saveOutline(e)} className="grid grid-cols-1 gap-4" noValidate>
          <div className="grid grid-cols-3 gap-4">
            <Field label="章号*">
              <Input type="number" min={1} value={outlineForm.number} onChange={(e) => setOutlineForm({ ...outlineForm, number: e.target.value })} />
            </Field>
            <div className="col-span-2">
              <Field label="章节标题">
                <Input value={outlineForm.title} onChange={(e) => setOutlineForm({ ...outlineForm, title: e.target.value })} />
              </Field>
            </div>
          </div>
          <Field label="要点(每行一个 beat)">
            <Textarea rows={5} value={outlineForm.beats} onChange={(e) => setOutlineForm({ ...outlineForm, beats: e.target.value })} placeholder={'- 进入灰烬集市\n- 发现火种线索\n- 结尾遭遇伏击'} />
          </Field>
        </form>
      </Modal>

      {/* 埋设伏笔弹窗 */}
      <Modal
        open={plantModal}
        title="埋设伏笔"
        onClose={() => setPlantModal(false)}
        footer={
          <>
            <Button variant="secondary" onClick={() => setPlantModal(false)}>
              取消
            </Button>
            <Button variant="primary" type="submit" form="plant-form">
              埋设
            </Button>
          </>
        }
      >
        <form id="plant-form" onSubmit={(e) => void plantForeshadowingSubmit(e)} className="grid grid-cols-1 gap-4" noValidate>
          <Field label="名称*">
            <Input value={plantForm.label} onChange={(e) => setPlantForm({ ...plantForm, label: e.target.value })} placeholder="神秘玉佩" />
          </Field>
          <Field label="细节">
            <Textarea rows={2} value={plantForm.detail} onChange={(e) => setPlantForm({ ...plantForm, detail: e.target.value })} placeholder="来历、暗示、计划回收方式" />
          </Field>
          <Field label="埋设章节号(可选)">
            <Input type="number" min={1} value={plantForm.plantedChapter} onChange={(e) => setPlantForm({ ...plantForm, plantedChapter: e.target.value })} />
          </Field>
        </form>
      </Modal>

      {/* 回收伏笔弹窗 */}
      <Modal
        open={resolveModal !== null}
        title={`回收伏笔 · ${resolveModal?.label ?? ''}`}
        onClose={() => setResolveModal(null)}
        footer={
          <>
            <Button variant="secondary" onClick={() => setResolveModal(null)}>
              取消
            </Button>
            <Button variant="primary" type="submit" form="resolve-form">
              确认回收
            </Button>
          </>
        }
      >
        <form id="resolve-form" onSubmit={(e) => void resolveForeshadowingSubmit(e)} noValidate>
          <Field label="在第几章回收*">
            <Input type="number" min={1} value={resolveChapter} onChange={(e) => setResolveChapter(e.target.value)} />
          </Field>
          <p className="mt-2 text-xs text-[#94a3b8]">重复标记幂等,保留首次回收章号。</p>
        </form>
      </Modal>

      <ConfirmDialog
        open={deleteTarget !== null}
        title="确认删除"
        description={`确认删除${deleteTarget?.label ?? ''}?该操作不可恢复。`}
        loading={deleting}
        onCancel={() => setDeleteTarget(null)}
        onConfirm={() => void doDelete()}
      />
    </div>
  );
}
