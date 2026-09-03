// V10 内容工厂:产线(Production Line)服务
// 产线 = 一组题材/类型模板(kinds,含 brief 基线 + 种子池)+ 调度 + 配额 + 质量闸门配置。
// 一次运行(run)按 kinds 的 weight 分配 count 篇「不同题材/类型」的短篇;
// 每篇由 产线基线 ⊕ 题材 brief ⊕ 种子 合成一份差异化创作需求,复用既有短篇创作流水线
// (生成 → 评审 → 自动优化 → 再评审 → 达标自动发布/入池),标题未填时由 LLM 自动生成。

import { getDb, genId } from './db';
import {
  CoreError,
  isProductionRunStatus,
  type ProductionKindSeed,
  type ProductionKindTemplate,
  type ProductionLine,
  type ProductionLineConfig,
  type ProductionRun,
  type ProductionRunItem,
  type ProductionRunStatus,
  type StoryBrief,
} from './domain';
import { createShortStory } from './short-story';
import { enqueueCreationPipeline } from './short-story-pipeline';
import { normalizeBrief } from './short-story';

// ---------- 工具 ----------

function str(v: unknown, max = 200): string {
  return typeof v === 'string' ? v.trim().slice(0, max) : '';
}

function num(v: unknown): number | undefined {
  if (v === undefined || v === null || v === '') return undefined;
  const n = Number(v);
  return Number.isFinite(n) ? n : undefined;
}

function clampInt(v: number, min: number, max: number, label: string): number {
  const n = Math.round(v);
  if (!Number.isFinite(n) || n < min || n > max) {
    throw new CoreError('INVALID_LINE_CONFIG', `${label} 需为 ${min}..${max} 的整数,当前: ${String(v)}`);
  }
  return n;
}

/** 服务器本地日期键(YYYY-MM-DD),用于每日产线同日去重 */
function localDateKey(d: Date): string {
  const pad = (n: number): string => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

// ---------- 配置归一化 ----------

function normalizeKind(raw: unknown, index: number): ProductionKindTemplate {
  if (typeof raw !== 'object' || raw === null) {
    throw new CoreError('INVALID_LINE_CONFIG', `第 ${index + 1} 个题材配置必须是对象`);
  }
  const k = raw as Record<string, unknown>;
  const genre = str(k.genre, 40);
  if (!genre) throw new CoreError('INVALID_LINE_CONFIG', `第 ${index + 1} 个题材缺少有效的 genre`);
  const weight = num(k.weight) === undefined ? 1 : clampInt(num(k.weight) as number, 1, 1000, `题材「${genre}」的权重`);
  const brief = k.brief !== undefined ? normalizeBrief(k.brief) : {};
  const seeds: ProductionKindSeed[] = [];
  if (Array.isArray(k.seeds)) {
    for (const s of k.seeds) {
      if (typeof s !== 'object' || s === null) continue;
      const sd = s as Record<string, unknown>;
      seeds.push({
        title: str(sd.title, 200) || undefined,
        theme: str(sd.theme, 8000) || undefined,
        synopsis: str(sd.synopsis, 8000) || undefined,
        coreConflict: str(sd.coreConflict, 8000) || undefined,
        background: str(sd.background, 8000) || undefined,
        characters: str(sd.characters, 8000) || undefined,
        direction: str(sd.direction, 8000) || undefined,
      });
    }
  }
  const kind: ProductionKindTemplate = { genre, weight, brief };
  if (seeds.length > 0) kind.seeds = seeds;
  return kind;
}

// ---------- V10.5 持续模式:内置随机题材池 ----------
// 未配置 kinds 的持续产线默认启用内置池(默认即随机);manual/daily 仍要求显式题材。

const DEFAULT_KIND_SEEDS = (themes: Array<[string, string]>): ProductionKindSeed[] =>
  themes.map(([theme, synopsis]) => ({ theme, synopsis }));

/** 内置随机题材池:8-12 个常用题材 × 每个 2-3 个差异化种子主题 */
export const DEFAULT_KINDS: ProductionKindTemplate[] = [
  {
    genre: '都市言情',
    weight: 2,
    seeds: DEFAULT_KIND_SEEDS([
      ['雨夜重逢', '多年未见的恋人在一场暴雨中重逢,旧情与新的秘密交织。'],
      ['十年后的快递', '一封迟到了十年的快递,揭开被时间掩埋的告白。'],
      ['咖啡店的旧照片', '常客在咖啡店发现一张泛黄照片,牵出一段未完成的约定。'],
    ]),
  },
  {
    genre: '悬疑推理',
    weight: 1,
    seeds: DEFAULT_KIND_SEEDS([
      ['午夜谜案', '深夜图书馆的报警声,让管理员卷入一场精心设计的谜局。'],
      ['消失的目击者', '唯一的目击者在作证前夜失踪,侦探发现所有人都说谎。'],
      ['密室的第三个人', '上锁的房间里只有两具尸体,现场却出现了第三个人的痕迹。'],
    ]),
  },
  {
    genre: '科幻',
    weight: 1,
    seeds: DEFAULT_KIND_SEEDS([
      ['月球背面的信号', '月球背面探测器传回一段无法破译的信号,指向地球的过去。'],
      ['记忆删除公司', '记忆删除公司的客户发现,被删除的记忆正在以另一种方式回来。'],
      ['最后一个地球日', '末日倒计时启动,每个人都要回答:最后一天你想成为谁。'],
    ]),
  },
  {
    genre: '奇幻',
    weight: 1,
    seeds: DEFAULT_KIND_SEEDS([
      ['会说话的猫', '一只会说人话的猫带来预言,也带来一个关于代价的交易。'],
      ['时间尽头的钟楼', '钟楼管理员发现,敲响十三下可以回到过去,却要付出寿命。'],
      ['影子书店', '深夜书店里,每本书都记录着读者未曾活过的人生。'],
    ]),
  },
  {
    genre: '古风仙侠',
    weight: 1,
    seeds: DEFAULT_KIND_SEEDS([
      ['剑穗上的秘密', '名剑客的剑穗里藏着一张地图,指向被尘封的师门真相。'],
      ['长安雨夜', '长安城连绵三日的雨里,一位说书人讲着别人不敢讲的故事。'],
      ['灵犀灯', '元宵夜的灵犀灯能照见有缘人,却照不亮执念之人的归途。'],
    ]),
  },
  {
    genre: '现实题材',
    weight: 1,
    seeds: DEFAULT_KIND_SEEDS([
      ['老城区的理发店', '老街拆迁前,理发店老板最后一次为老主顾们理发。'],
      ['春运的绿皮车', '绿皮车车厢里,一群陌生人用一夜换一段彼此的人生。'],
      ['父亲的信箱', '儿子整理遗物时发现,父亲给素未谋面的笔友写了二十年信。'],
    ]),
  },
  {
    genre: '青春校园',
    weight: 1,
    seeds: DEFAULT_KIND_SEEDS([
      ['转学第一天', '转学生第一天就撞破了社团的秘密,也撞进了某个人的青春。'],
      ['天台上的合唱', '高三最后一个夏天,天台上的合唱团决定办一场告别演出。'],
      ['图书馆的借书卡', '借书卡上只有两个名字,隔了十年的两个名字。'],
    ]),
  },
  {
    genre: '冒险',
    weight: 1,
    seeds: DEFAULT_KIND_SEEDS([
      ['沙漠中的绿洲', '探险队在沙暴后发现绿洲,却找不到来时的方向。'],
      ['深海沉船', '深海打捞队发现的沉船,船上的时钟永远停在同一天。'],
      ['极地科考站', '极夜中的科考站,无线电收到一段来自地下冰层的呼救。'],
    ]),
  },
  {
    genre: '恐怖惊悚',
    weight: 1,
    seeds: DEFAULT_KIND_SEEDS([
      ['空房间的脚步声', '新房主每天深夜都听见楼上传来的脚步声,可楼上没人住。'],
      ['镜中的自己', '镜子里的"自己"开始提前做出动作,而且越来越超前。'],
      ['末班车', '雨夜末班车上,乘客发现司机每站都数一遍人数,而人数从不变。'],
    ]),
  },
  {
    genre: '职场',
    weight: 1,
    seeds: DEFAULT_KIND_SEEDS([
      ['深夜的办公室', '加班到深夜的实习生,撞见老板的秘密项目,也撞见自己的机会。'],
      ['被删除的邮件', '一封群发邮件被撤回,却在每个人的草稿箱里留下了副本。'],
      ['会议室的风暴', '年度评审会上,新人用一份数据报告掀翻整个部门的潜规则。'],
    ]),
  },
];

/** 校验并归一化产线配置:题材非空、每题材权重合法、调度 count 合法、配额合法 */
export function normalizeLineConfig(input: unknown): ProductionLineConfig {
  const cfg = (typeof input === 'object' && input !== null ? input : {}) as Record<string, unknown>;
  const scheduleRaw = (typeof cfg.schedule === 'object' && cfg.schedule !== null ? cfg.schedule : {}) as Record<string, unknown>;
  const mode = scheduleRaw.mode === 'daily' ? 'daily' : scheduleRaw.mode === 'continuous' ? 'continuous' : 'manual';
  // 持续模式由背压驱动,不接受时间间隔参数(人为冷却会制造生产间隙)
  if (mode === 'continuous' && scheduleRaw.intervalSeconds !== undefined) {
    throw new CoreError('INVALID_LINE_CONFIG', '持续模式不设时间间隔(由背压驱动),请移除 intervalSeconds');
  }
  const kindsRaw = Array.isArray(cfg.kinds) ? cfg.kinds : [];
  let kinds: ProductionKindTemplate[];
  if (kindsRaw.length === 0) {
    if (mode === 'continuous') {
      kinds = DEFAULT_KINDS.map((k) => ({ ...k, seeds: k.seeds ? k.seeds.map((s) => ({ ...s })) : undefined }));
    } else {
      throw new CoreError('INVALID_LINE_CONFIG', '产线至少要配置一种题材/类型');
    }
  } else {
    kinds = kindsRaw.map(normalizeKind);
    const dup = new Set<string>();
    for (const k of kinds) {
      if (dup.has(k.genre)) throw new CoreError('INVALID_LINE_CONFIG', `题材重复: ${k.genre}`);
      dup.add(k.genre);
    }
  }

  let hour: number | undefined;
  if (mode === 'daily') hour = clampInt(num(scheduleRaw.hour) ?? 8, 0, 23, '每日触发小时');
  // 持续模式每轮篇数上限 10(背压阈值 = count*2,防止队列堆积)
  const countMax = mode === 'continuous' ? 10 : 50;
  const count = clampInt(num(scheduleRaw.count) ?? 1, 1, countMax, '每次触发篇数');

  const quotaRaw = (typeof cfg.quota === 'object' && cfg.quota !== null ? cfg.quota : {}) as Record<string, unknown>;
  const quota: ProductionLineConfig['quota'] = {};
  const maxPerRun = num(quotaRaw.maxPerRun);
  if (maxPerRun !== undefined) quota.maxPerRun = clampInt(maxPerRun, 1, 50, '单次上限');
  const dailyLimit = num(quotaRaw.dailyLimit);
  if (dailyLimit !== undefined) quota.dailyLimit = clampInt(dailyLimit, 1, 10000, '每日上限');
  const dailyBudgetUsd = num(quotaRaw.dailyBudgetUsd);
  if (dailyBudgetUsd !== undefined && Number.isFinite(dailyBudgetUsd) && dailyBudgetUsd >= 0) {
    quota.dailyBudgetUsd = Math.round(dailyBudgetUsd * 100) / 100;
  }
  quota.skipOnBudgetOverrun = quotaRaw.skipOnBudgetOverrun === true;

  const gateRaw = (typeof cfg.qualityGate === 'object' && cfg.qualityGate !== null ? cfg.qualityGate : {}) as Record<string, unknown>;
  const qualityGate: ProductionLineConfig['qualityGate'] = {};
  const minScore = num(gateRaw.minScore);
  if (minScore !== undefined) qualityGate.minScore = clampInt(minScore, 0, 100, '达标分数线');
  const reworkMaxRounds = num(gateRaw.reworkMaxRounds);
  if (reworkMaxRounds !== undefined) qualityGate.reworkMaxRounds = clampInt(reworkMaxRounds, 0, 20, '最大优化轮数');
  qualityGate.publishOnPass = gateRaw.publishOnPass !== false;

  const config: ProductionLineConfig = {
    kinds,
    schedule: { mode, ...(hour !== undefined ? { hour } : {}), count },
  };
  if (cfg.brief !== undefined) config.brief = normalizeBrief(cfg.brief);
  const targetWords = num(cfg.targetWords);
  if (targetWords !== undefined) config.targetWords = clampInt(targetWords, 100, 200000, '目标字数');
  const model = str(cfg.model, 100);
  if (model) config.model = model;
  const ruleId = str(cfg.ruleId, 60);
  if (ruleId) config.ruleId = ruleId;
  const promptId = str(cfg.promptId, 60);
  if (promptId) config.promptId = promptId;
  if (Object.keys(quota).length > 0) config.quota = quota;
  if (Object.keys(qualityGate).length > 0) config.qualityGate = qualityGate;
  return config;
}

// ---------- 行映射 ----------

interface LineRow {
  id: string;
  name: string;
  description: string | null;
  enabled: number;
  config_json: string;
  last_run_at: string | null;
  last_run_date: string | null;
  consecutive_failures: number;
  max_consecutive_failures: number;
  tripped_reason: string | null;
  tripped_at: string | null;
  created_at: string;
  updated_at: string;
}

function toLine(row: LineRow): ProductionLine {
  let config: ProductionLineConfig;
  try {
    config = JSON.parse(row.config_json) as ProductionLineConfig;
  } catch {
    config = { kinds: [], schedule: { mode: 'manual', count: 1 } };
  }
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    enabled: row.enabled === 1,
    config,
    lastRunAt: row.last_run_at,
    lastRunDate: row.last_run_date,
    consecutiveFailures: row.consecutive_failures,
    maxConsecutiveFailures: row.max_consecutive_failures,
    trippedReason: row.tripped_reason,
    trippedAt: row.tripped_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

// ---------- 查询 ----------

export function getProductionLine(id: string): ProductionLine {
  const row = getDb().prepare('SELECT * FROM production_lines WHERE id = ?').get(id) as LineRow | undefined;
  if (!row) throw new CoreError('PRODUCTION_LINE_NOT_FOUND', `产线不存在: ${id}`);
  return toLine(row);
}

export function tryGetProductionLine(id: string): ProductionLine | null {
  const row = getDb().prepare('SELECT * FROM production_lines WHERE id = ?').get(id) as LineRow | undefined;
  return row ? toLine(row) : null;
}

export function listProductionLines(): ProductionLine[] {
  const rows = getDb()
    .prepare('SELECT * FROM production_lines ORDER BY created_at DESC, rowid DESC')
    .all() as LineRow[];
  return rows.map(toLine);
}

function setLineLastRun(id: string, now: Date): void {
  getDb()
    .prepare('UPDATE production_lines SET last_run_at = ?, last_run_date = ?, updated_at = ? WHERE id = ?')
    .run(now.toISOString(), localDateKey(now), now.toISOString(), id);
}

// ---------- 写入 ----------

export interface CreateProductionLineInput {
  name: string;
  description?: string | null;
  enabled?: boolean;
  config: unknown;
  /** 熔断阈值:连续失败达到该值自动停线(1..20,缺省 3) */
  maxConsecutiveFailures?: number;
}

export function createProductionLine(input: CreateProductionLineInput): ProductionLine {
  const name = str(input.name, 100);
  if (!name) throw new CoreError('INVALID_LINE_CONFIG', '产线名称不能为空');
  const config = normalizeLineConfig(input.config);
  const maxConsecutiveFailures =
    input.maxConsecutiveFailures === undefined
      ? 3
      : clampInt(input.maxConsecutiveFailures, 1, 20, '熔断阈值');
  const db = getDb();
  const now = new Date().toISOString();
  const id = genId('pl');
  db.prepare(
    'INSERT INTO production_lines (id, name, description, enabled, config_json, max_consecutive_failures, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)'
  ).run(id, name, input.description ? str(input.description, 500) : null, input.enabled === false ? 0 : 1, JSON.stringify(config), maxConsecutiveFailures, now, now);
  return getProductionLine(id);
}

export interface UpdateProductionLinePatch {
  name?: string;
  description?: string | null;
  enabled?: boolean;
  config?: unknown;
  /** 熔断阈值(1..20);更新时同时清零连续失败计数 */
  maxConsecutiveFailures?: number;
}

export function updateProductionLine(id: string, patch: UpdateProductionLinePatch): ProductionLine {
  const current = getProductionLine(id);
  const nextName = patch.name !== undefined ? str(patch.name, 100) || current.name : current.name;
  const nextDescription =
    patch.description !== undefined
      ? patch.description
        ? str(patch.description, 500)
        : null
      : current.description;
  const nextEnabled = patch.enabled !== undefined ? patch.enabled : current.enabled;
  const nextConfig = patch.config !== undefined ? normalizeLineConfig(patch.config) : current.config;
  const nextMax =
    patch.maxConsecutiveFailures === undefined
      ? current.maxConsecutiveFailures
      : clampInt(patch.maxConsecutiveFailures, 1, 20, '熔断阈值');
  // 阈值被显式修改时清零连续失败(避免旧计数直接触发新阈值熔断)
  const resetFailures = patch.maxConsecutiveFailures !== undefined ? 1 : 0;
  getDb()
    .prepare(
      `UPDATE production_lines SET name = ?, description = ?, enabled = ?, config_json = ?,
         max_consecutive_failures = ?, consecutive_failures = CASE WHEN ? = 1 THEN 0 ELSE consecutive_failures END,
         updated_at = ? WHERE id = ?`
    )
    .run(nextName, nextDescription, nextEnabled ? 1 : 0, JSON.stringify(nextConfig), nextMax, resetFailures, new Date().toISOString(), id);
  return getProductionLine(id);
}

export function setProductionLineEnabled(id: string, enabled: boolean): ProductionLine {
  getProductionLine(id);
  getDb()
    .prepare('UPDATE production_lines SET enabled = ?, updated_at = ? WHERE id = ?')
    .run(enabled ? 1 : 0, new Date().toISOString(), id);
  return getProductionLine(id);
}

export function deleteProductionLine(id: string): void {
  getProductionLine(id);
  // 级联:production_runs + production_run_items 由外键 ON DELETE CASCADE 清理
  getDb().prepare('DELETE FROM production_lines WHERE id = ?').run(id);
}

// ---------- 混合题材分配 ----------

function kindSeedCount(kind: ProductionKindTemplate): number {
  return kind.seeds?.length ?? 0;
}

/** 为第 n 篇(该题材内序号)挑选种子下标:round-robin 保证同题材不同味 */
function pickSeedIndex(kind: ProductionKindTemplate, n: number): number | null {
  const len = kindSeedCount(kind);
  if (len === 0) return null;
  return n % len;
}

/**
 * 按 weight 分配 count 篇到各题材,保证多样性:
 * - count >= 题材数时,每个题材至少 1 篇;
 * - 其余按权重比例分配,余数轮转给权重最高者/依次补齐。
 */
export function assignRunKinds(config: ProductionLineConfig, count: number): ProductionRunItem[] {
  const kinds = config.kinds;
  const items: ProductionRunItem[] = [];
  if (kinds.length === 0) return items;
  if (kinds.length === 1) {
    const k = kinds[0];
    for (let i = 0; i < count; i++) items.push({ storyId: null, genre: k.genre, seedIndex: pickSeedIndex(k, i) });
    return items;
  }
  const weights = kinds.map((k) => Math.max(1, k.weight));
  const totalWeight = weights.reduce((s, w) => s + w, 0);
  const alloc = kinds.map((_, i) => Math.floor((count * weights[i]) / totalWeight));
  let remaining = count - alloc.reduce((s, n) => s + n, 0);
  // 题材数不超篇数时,保证每题材至少 1 篇
  if (count >= kinds.length) {
    for (let i = 0; i < kinds.length; i++) {
      if (alloc[i] < 1) {
        alloc[i] = 1;
        remaining--;
      }
    }
  }
  // 按权重降序,轮转补齐余数
  const order = kinds.map((_, i) => i).sort((a, b) => weights[b] - weights[a] || a - b);
  let guard = 0;
  while (remaining > 0 && guard < 100000) {
    for (const i of order) {
      if (remaining <= 0) break;
      alloc[i]++;
      remaining--;
    }
    guard++;
  }
  kinds.forEach((k, idx) => {
    for (let n = 0; n < alloc[idx]; n++) items.push({ storyId: null, genre: k.genre, seedIndex: pickSeedIndex(k, n) });
  });
  return items;
}

function findKind(config: ProductionLineConfig, genre: string): ProductionKindTemplate | undefined {
  return config.kinds.find((k) => k.genre === genre);
}

/** 由 产线基线 ⊕ 题材 brief ⊕ 种子 合成单篇创作需求(genre 强制写入) */
export function deriveBriefForItem(config: ProductionLineConfig, item: ProductionRunItem): StoryBrief {
  const kind = findKind(config, item.genre);
  const seed: ProductionKindSeed | undefined =
    kind?.seeds && item.seedIndex !== null ? kind.seeds[item.seedIndex] : undefined;
  const base: StoryBrief = { ...(config.brief ?? {}), ...(kind?.brief ?? {}), genre: item.genre };
  if (seed) {
    if (seed.theme) base.theme = seed.theme;
    if (seed.synopsis) base.synopsis = seed.synopsis;
    if (seed.coreConflict) base.coreConflict = seed.coreConflict;
    if (seed.background) base.background = seed.background;
    if (seed.characters) base.characters = seed.characters;
    if (seed.direction) base.direction = seed.direction;
  }
  if (config.targetWords) base.targetWords = config.targetWords;
  return normalizeBrief(base);
}

function seedTitle(config: ProductionLineConfig, item: ProductionRunItem): string | undefined {
  const kind = findKind(config, item.genre);
  if (kind?.seeds && item.seedIndex !== null) return kind.seeds[item.seedIndex]?.title;
  return undefined;
}

// ---------- 运行执行 ----------

function countTodayForLine(lineId: string, now: Date): number {
  const today = localDateKey(now);
  const row = getDb()
    .prepare(
      `SELECT COUNT(*) AS n FROM production_run_items ri
       JOIN production_runs r ON r.id = ri.run_id
       WHERE r.line_id = ? AND r.run_date = ? AND r.status != 'cancelled'`
    )
    .get(lineId, today) as { n: number };
  return row.n;
}

export interface CreateProductionRunInput {
  trigger?: 'manual' | 'daily' | 'continuous';
  count?: number;
}

// ---------- 持续模式:每轮随机化 + 背压 + 熔断 ----------

/** Fisher–Yates shuffle(原地,返回新数组) */
function shuffleKinds(kinds: ProductionKindTemplate[]): ProductionKindTemplate[] {
  const arr = kinds.map((k) => ({ ...k, seeds: k.seeds ? [...k.seeds] : undefined }));
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

/**
 * 持续模式每轮触发前的随机化:题材顺序 shuffle + 权重轻微抖动(±20%,下限 1),
 * 避免每轮产出同一批题材(默认随机,指定题材时仍然打乱顺序以多样排布)。
 */
function randomizeKindsForContinuous(kinds: ProductionKindTemplate[]): ProductionKindTemplate[] {
  return shuffleKinds(kinds).map((k) => {
    const jitter = 0.8 + Math.random() * 0.4;
    return { ...k, weight: Math.max(1, Math.round(k.weight * jitter)) };
  });
}

/** 产线"在飞"短篇数:draft(已创建入队待执行)/generating/reviewing/optimizing/scheduled 的短篇 + executing 运行 */
export function countInFlightForLine(lineId: string): number {
  const db = getDb();
  const stories = db
    .prepare(
      `SELECT COUNT(*) AS n FROM short_stories s
       JOIN production_run_items ri ON ri.story_id = s.id
       JOIN production_runs r ON r.id = ri.run_id
       WHERE r.line_id = ? AND s.status IN ('draft','generating','reviewing','optimizing','scheduled')`
    )
    .get(lineId) as { n: number };
  const executing = db
    .prepare(`SELECT COUNT(*) AS n FROM production_runs WHERE line_id = ? AND status = 'executing'`)
    .get(lineId) as { n: number };
  return stories.n + executing.n;
}

/** 背压阈值 = max(2, count*2):默认 count=3 → 6 */
export function backpressureThreshold(config: ProductionLineConfig): number {
  const count = config.schedule.count ?? 1;
  return Math.max(2, count * 2);
}

/** 连续失败 +1;达到阈值自动停线熔断(enable=0 + 记录原因/时间) */
function bumpConsecutiveFailures(lineId: string, reason: string): void {
  const line = getProductionLine(lineId);
  const next = line.consecutiveFailures + 1;
  const now = new Date().toISOString();
  if (next >= line.maxConsecutiveFailures) {
    getDb()
      .prepare(
        `UPDATE production_lines SET enabled = 0, consecutive_failures = ?, tripped_reason = ?, tripped_at = ?, updated_at = ? WHERE id = ?`
      )
      .run(next, `连续 ${next} 轮失败(阈值 ${line.maxConsecutiveFailures}):${reason}`.slice(0, 1000), now, now, lineId);
  } else {
    getDb()
      .prepare('UPDATE production_lines SET consecutive_failures = ?, updated_at = ? WHERE id = ?')
      .run(next, now, lineId);
  }
}

/** 成功一轮清零连续失败(保留 tripped 痕迹,待人工恢复) */
function resetConsecutiveFailures(lineId: string): void {
  getDb()
    .prepare('UPDATE production_lines SET consecutive_failures = 0, updated_at = ? WHERE id = ?')
    .run(new Date().toISOString(), lineId);
}

/** 单次运行:确认配额 → 分配题材 → 逐篇建短篇并入队创作流水线 → 落运行记录 */
export function runProductionLine(
  lineId: string,
  input?: CreateProductionRunInput,
  opts?: { now?: Date }
): { run: ProductionRun; createdStoryIds: string[] } {
  const line = getProductionLine(lineId);
  if (!line.enabled) throw new CoreError('INVALID_LINE_CONFIG', '产线当前已停用,无法创建运行');
  const now = opts?.now ?? new Date();
  const today = localDateKey(now);
  // 每日产线同日去重:今天已运行过则拒绝(除非显式手动触发一次);持续模式不受此限
  if (line.config.schedule.mode === 'daily' && input?.trigger !== 'manual' && line.lastRunDate === today) {
    throw new CoreError('LINE_QUOTA_EXCEEDED', '该每日产线今天已运行过(同日去重)');
  }
  const maxPerRun = line.config.quota?.maxPerRun ?? 50;
  const count = clampInt(num(input?.count) ?? line.config.schedule.count, 1, Math.min(50, maxPerRun), '本次运行篇数');
  // 每日软配额
  const dailyLimit = line.config.quota?.dailyLimit;
  if (dailyLimit !== undefined && countTodayForLine(lineId, now) + count > dailyLimit) {
    throw new CoreError('LINE_QUOTA_EXCEEDED', `当日已创建 ${countTodayForLine(lineId, now)} 篇,超出每日上限 ${dailyLimit}`);
  }
  // 持续模式每轮随机化(题材 shuffle + 权重抖动)
  const runKinds =
    line.config.schedule.mode === 'continuous' ? randomizeKindsForContinuous(line.config.kinds) : line.config.kinds;
  const runConfig: ProductionLineConfig = { ...line.config, kinds: runKinds };
  const db = getDb();
  const nowIso = now.toISOString();
  const runId = genId('pdr');
  const items = assignRunKinds(runConfig, count);
  db.prepare(
    "INSERT INTO production_runs (id, line_id, trigger, run_date, count, status, items_json, created_at, executed_at) VALUES (?, ?, ?, ?, ?, 'executing', ?, ?, ?)"
  ).run(runId, lineId, input?.trigger ?? 'manual', today, count, JSON.stringify(items), nowIso, nowIso);
  const created: string[] = [];
  const runItemRows: Array<{ id: string; story_id: string; genre: string; seed_index: number | null }> = [];
  try {
    const itemsWithStory = items.map((it) => {
      const brief = deriveBriefForItem(runConfig, it);
      const title = seedTitle(runConfig, it);
      const story = createShortStory({ title, brief });
      enqueueCreationPipeline(story.id);
      created.push(story.id);
      runItemRows.push({ id: genId('pdri'), story_id: story.id, genre: it.genre, seed_index: it.seedIndex });
      return { ...it, storyId: story.id };
    });
    const insert = db.prepare(
      'INSERT INTO production_run_items (id, run_id, story_id, genre, seed_index, created_at) VALUES (?, ?, ?, ?, ?, ?)'
    );
    const tx = db.transaction(() => {
      for (const r of runItemRows) insert.run(r.id, runId, r.story_id, r.genre, r.seed_index, nowIso);
    });
    tx();
    db.prepare(
      "UPDATE production_runs SET items_json = ?, status = 'done', finished_at = ?, error = NULL WHERE id = ?"
    ).run(JSON.stringify(itemsWithStory), nowIso, runId);
    setLineLastRun(lineId, now);
    return { run: getProductionRun(runId), createdStoryIds: created };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    db.prepare("UPDATE production_runs SET status = 'failed', error = ?, finished_at = ? WHERE id = ?").run(
      message.slice(0, 4000),
      nowIso,
      runId
    );
    throw err;
  }
}

// ---------- 运行查询 ----------

interface RunRow {
  id: string;
  line_id: string;
  trigger: string;
  run_date: string;
  count: number;
  status: string;
  items_json: string;
  error: string | null;
  created_at: string;
  finished_at: string | null;
  executed_at: string | null;
}

function toRun(row: RunRow): ProductionRun {
  let items: ProductionRunItem[] = [];
  try {
    items = JSON.parse(row.items_json) as ProductionRunItem[];
  } catch {
    items = [];
  }
  return {
    id: row.id,
    lineId: row.line_id,
    trigger: (row.trigger === 'daily' ? 'daily' : row.trigger === 'continuous' ? 'continuous' : 'manual') as
      | 'manual'
      | 'daily'
      | 'continuous',
    runDate: row.run_date,
    count: row.count,
    status: (isProductionRunStatus(row.status) ? row.status : 'pending') as ProductionRunStatus,
    items,
    error: row.error,
    createdAt: row.created_at,
    finishedAt: row.finished_at,
    executedAt: row.executed_at,
  };
}

export function getProductionRun(id: string): ProductionRun {
  const row = getDb().prepare('SELECT * FROM production_runs WHERE id = ?').get(id) as RunRow | undefined;
  if (!row) throw new CoreError('PRODUCTION_RUN_NOT_FOUND', `产线运行不存在: ${id}`);
  return toRun(row);
}

export interface ListProductionRunsOptions {
  lineId?: string;
  limit?: number;
}

export function listProductionRuns(opts?: ListProductionRunsOptions): ProductionRun[] {
  const where: string[] = [];
  const params: unknown[] = [];
  if (opts?.lineId) {
    where.push('line_id = ?');
    params.push(opts.lineId);
  }
  const limit = Math.min(Math.max(opts?.limit ?? 100, 1), 500);
  const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';
  const rows = getDb()
    .prepare(`SELECT * FROM production_runs ${whereSql} ORDER BY created_at DESC, rowid DESC LIMIT ?`)
    .all(...params, limit) as RunRow[];
  return rows.map(toRun);
}

// ---------- 每日调度 ----------

/**
 * 调度器扫描:返回本次应触发的每日产线 list。
 * 条件:enabled=1、mode='daily'、今天尚未触发(last_run_date != 今天)、且今天本地时刻已到 hour。
 */
export function listDueDailyProductionLines(now = new Date()): ProductionLine[] {
  const today = localDateKey(now);
  const rows = getDb()
    .prepare('SELECT * FROM production_lines WHERE enabled = 1 ORDER BY created_at ASC, rowid ASC')
    .all() as LineRow[];
  return rows
    .map(toLine)
    .filter((line) => {
      if (line.config.schedule.mode !== 'daily') return false;
      if (line.lastRunDate === today) return false;
      const hour = line.config.schedule.hour ?? 8;
      return now.getHours() >= hour;
    });
}

export function fireDueDailyProductionRuns(now = new Date(), opts?: { onRun?: (r: ProductionRun) => void }): string[] {
  const fired: string[] = [];
  for (const line of listDueDailyProductionLines(now)) {
    try {
      const { run } = runProductionLine(line.id, { trigger: 'daily' }, { now });
      fired.push(run.id);
      opts?.onRun?.(run);
    } catch (err) {
      // 单条产线失败不阻断其他产线;错误在 run 上已可见
      const message = err instanceof Error ? err.message : String(err);
      console.error(`[production] 每日产线 ${line.name} 触发失败:`, message);
    }
  }
  return fired;
}

// ---------- V10.5 持续模式:背压驱动的无间隙生产 ----------

/**
 * 调度器扫描:返回本次应触发的持续产线 list。
 * 条件:enabled=1、mode='continuous'、未熔断(consecutive_failures < 阈值)、背压允许(inFlight < 阈值)。
 * 触发粒度 = 调度器 tick(PUBLISH_TICK_SECONDS),不设时间间隔。
 */
export function listDueContinuousProductionLines(): ProductionLine[] {
  const rows = getDb()
    .prepare('SELECT * FROM production_lines WHERE enabled = 1 ORDER BY created_at ASC, rowid ASC')
    .all() as LineRow[];
  return rows
    .map(toLine)
    .filter((line) => {
      if (line.config.schedule.mode !== 'continuous') return false;
      if (line.consecutiveFailures >= line.maxConsecutiveFailures) return false;
      if (countInFlightForLine(line.id) >= backpressureThreshold(line.config)) return false;
      return true;
    });
}

/**
 * 触发所有到点的持续产线:每线一轮 runProductionLine(trigger='continuous')。
 * - 成功一轮 → 清零连续失败;
 * - 失败一轮 → bump 连续失败,达到阈值自动停线熔断(单线失败不阻断其他线)。
 */
export function fireDueContinuousProductionRuns(opts?: { onRun?: (r: ProductionRun) => void }): string[] {
  const fired: string[] = [];
  for (const line of listDueContinuousProductionLines()) {
    try {
      const { run } = runProductionLine(line.id, { trigger: 'continuous' });
      resetConsecutiveFailures(line.id);
      fired.push(run.id);
      opts?.onRun?.(run);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.error(`[production] 持续产线 ${line.name} 触发失败:`, message);
      bumpConsecutiveFailures(line.id, message);
    }
  }
  return fired;
}

/**
 * 人工恢复熔断的持续产线:enabled=1 + 清零连续失败 + 清 tripped 痕迹。
 * 幂等:未熔断的产线调用等同启用。
 */
export function resumeProductionLine(lineId: string): ProductionLine {
  getProductionLine(lineId);
  const now = new Date().toISOString();
  getDb()
    .prepare(
      `UPDATE production_lines SET enabled = 1, consecutive_failures = 0, tripped_reason = NULL, tripped_at = NULL, updated_at = ? WHERE id = ?`
    )
    .run(now, lineId);
  return getProductionLine(lineId);
}

/** 产线当前是否处于熔断状态(连续失败达到阈值且带熔断原因) */
export function isLineTripped(line: ProductionLine): boolean {
  return line.consecutiveFailures >= line.maxConsecutiveFailures && !!line.trippedAt;
}
