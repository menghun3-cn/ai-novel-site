// V9 评审规则版本化服务:规则/版本 CRUD、发布(全局唯一生效)、停用、默认规则播种
// 权重/阈值/最大优化轮数只存于规则版本行,代码零硬编码(规格书 §13/§15/§22)

import { getDb, genId } from './db';
import {
  CoreError,
  isRuleVersionStatus,
  type ReviewDimensionSpec,
  type ReviewRule,
  type ReviewRuleVersion,
  type RuleVersionStatus,
} from './domain';

// ---------- 维度校验 ----------

/**
 * 校验维度配置:至少 1 个维度;名称非空且唯一;权重为正数且总和恰为 100;
 * 分档标准 min<=max。返回规范化后的数组。
 */
export function validateDimensions(input: unknown): ReviewDimensionSpec[] {
  if (!Array.isArray(input) || input.length === 0) {
    throw new CoreError('INVALID_RULE_DIMENSIONS', '评分维度不能为空');
  }
  const specs: ReviewDimensionSpec[] = [];
  const seen = new Set<string>();
  let weightSum = 0;
  for (const raw of input) {
    if (typeof raw !== 'object' || raw === null) {
      throw new CoreError('INVALID_RULE_DIMENSIONS', '维度配置必须是对象');
    }
    const item = raw as Record<string, unknown>;
    const name = typeof item.name === 'string' ? item.name.trim() : '';
    if (!name) throw new CoreError('INVALID_RULE_DIMENSIONS', '维度名称不能为空');
    if (seen.has(name)) throw new CoreError('INVALID_RULE_DIMENSIONS', `维度名称重复: ${name}`);
    seen.add(name);
    const weight = Number(item.weight);
    if (!Number.isFinite(weight) || weight <= 0 || weight > 100) {
      throw new CoreError('INVALID_RULE_DIMENSIONS', `维度 ${name} 的权重必须是 (0,100] 内的数值`);
    }
    weightSum += weight;
    const standards: ReviewDimensionSpec['standards'] = [];
    if (Array.isArray(item.standards)) {
      for (const s of item.standards) {
        if (typeof s !== 'object' || s === null) continue;
        const band = s as Record<string, unknown>;
        const min = Number(band.min);
        const max = Number(band.max);
        const description = typeof band.description === 'string' ? band.description : '';
        if (Number.isFinite(min) && Number.isFinite(max) && min <= max) {
          standards.push({ min, max, description });
        }
      }
    }
    specs.push({
      name,
      weight,
      definition: typeof item.definition === 'string' ? item.definition : '',
      standards,
      bonus: typeof item.bonus === 'string' ? item.bonus : '',
      penalty: typeof item.penalty === 'string' ? item.penalty : '',
      notes: typeof item.notes === 'string' ? item.notes : '',
    });
  }
  if (Math.abs(weightSum - 100) > 1e-9) {
    throw new CoreError('INVALID_RULE_DIMENSIONS', `全部维度权重之和必须等于 100,当前为 ${weightSum}`);
  }
  return specs;
}

// ---------- 行映射 ----------

interface RuleRow {
  id: string;
  name: string;
  description: string | null;
  current_version_id: string | null;
  created_at: string;
  updated_at: string;
}

function toRule(row: RuleRow): ReviewRule {
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    currentVersionId: row.current_version_id,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

interface RuleVersionRow {
  id: string;
  rule_id: string;
  version: string;
  dimensions_json: string;
  quality_threshold: number;
  max_auto_optimize_rounds: number;
  prompt_id: string | null;
  status: string;
  created_at: string | null;
  published_at: string | null;
}

function toRuleVersion(row: RuleVersionRow): ReviewRuleVersion {
  let dims: ReviewDimensionSpec[] = [];
  try {
    const parsed = JSON.parse(row.dimensions_json);
    if (Array.isArray(parsed)) dims = parsed as ReviewDimensionSpec[];
  } catch {
    /* 落库前已校验,防御性兜底 */
  }
  return {
    id: row.id,
    ruleId: row.rule_id,
    version: row.version,
    dimensions: dims,
    qualityThreshold: row.quality_threshold,
    maxAutoOptimizeRounds: row.max_auto_optimize_rounds,
    promptId: row.prompt_id,
    status: (isRuleVersionStatus(row.status) ? row.status : 'draft') as RuleVersionStatus,
    createdAt: row.created_at,
    publishedAt: row.published_at,
  };
}

function clampInt(v: unknown, min: number, max: number, fallback: number): number {
  const n = Number(v);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, Math.round(n)));
}

// ---------- 版本号 ----------

/** 自动递增版本号:vX.Y 取最大者 minor+1;无历史则 v1.0 */
function nextAutoVersion(ruleId: string): string {
  const rows = getDb()
    .prepare('SELECT version FROM review_rule_versions WHERE rule_id = ?')
    .all(ruleId) as { version: string }[];
  let bestMajor = 0;
  let bestMinor = -1;
  for (const r of rows) {
    const m = /^v(\d+)\.(\d+)$/.exec(r.version ?? '');
    if (!m) continue;
    const major = Number(m[1]);
    const minor = Number(m[2]);
    if (major > bestMajor || (major === bestMajor && minor > bestMinor)) {
      bestMajor = major;
      bestMinor = minor;
    }
  }
  if (bestMinor < 0) return 'v1.0';
  return `v${bestMajor}.${bestMinor + 1}`;
}

// ---------- 写入 ----------

export interface RuleVersionInput {
  version?: string;
  dimensions?: unknown;
  qualityThreshold?: unknown;
  maxAutoOptimizeRounds?: unknown;
  promptId?: string | null;
}

interface InsertVersionArgs {
  ruleId: string;
  input: RuleVersionInput;
  status: RuleVersionStatus;
  autoVersionIfMissing: boolean;
}

function insertRuleVersion(args: InsertVersionArgs): ReviewRuleVersion {
  const db = getDb();
  const dims = validateDimensions(args.input.dimensions);
  const threshold = clampInt(args.input.qualityThreshold, 0, 100, 80);
  const rounds = clampInt(args.input.maxAutoOptimizeRounds, 0, 10, 3);
  const provided = typeof args.input.version === 'string' ? args.input.version.trim() : '';
  let version = provided || (args.autoVersionIfMissing ? nextAutoVersion(args.ruleId) : '');
  if (!version) throw new CoreError('INVALID_INPUT', '规则版本号不能为空');
  const dup = db
    .prepare('SELECT id FROM review_rule_versions WHERE rule_id = ? AND version = ?')
    .get(args.ruleId, version);
  if (dup) throw new CoreError('RULE_VERSION_CONFLICT', `该规则下版本号已存在: ${version}`);
  const now = new Date().toISOString();
  const vid = genId('rrulev');
  db.prepare(
    `INSERT INTO review_rule_versions
       (id, rule_id, version, dimensions_json, quality_threshold, max_auto_optimize_rounds, prompt_id, status, created_at, published_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, NULL)`
  ).run(
    vid,
    args.ruleId,
    version,
    JSON.stringify(dims),
    threshold,
    rounds,
    args.input.promptId?.trim() || null,
    args.status,
    now
  );
  return getRuleVersion(vid);
}

export interface CreateReviewRuleInput extends RuleVersionInput {
  name: string;
  description?: string | null;
  /** 创建首个版本后立即发布为生效版本 */
  publish?: boolean;
}

/** 为既有规则追加新版本(缺省 draft;版本号缺省自动 minor+1) */
export function addRuleVersion(ruleId: string, input: RuleVersionInput): ReviewRuleVersion {
  getRule(ruleId); // 存在性守卫
  return insertRuleVersion({ ruleId, input, status: 'draft', autoVersionIfMissing: true });
}

export function createReviewRule(input: CreateReviewRuleInput): { rule: ReviewRule; version: ReviewRuleVersion } {
  const name = input.name?.trim();
  if (!name) throw new CoreError('INVALID_INPUT', '规则名称不能为空');
  const db = getDb();
  const now = new Date().toISOString();
  const rid = genId('rrule');
  const status: RuleVersionStatus = input.publish ? 'published' : 'draft';
  const tx = db.transaction(() => {
    db.prepare(
      'INSERT INTO review_rules (id, name, description, current_version_id, created_at, updated_at) VALUES (?, ?, ?, NULL, ?, ?)'
    ).run(rid, name.slice(0, 200), input.description?.trim() || null, now, now);
    const version = insertRuleVersion({ ruleId: rid, input, status, autoVersionIfMissing: true });
    if (status === 'published') {
      db.prepare('UPDATE review_rule_versions SET published_at = ? WHERE id = ?').run(now, version.id);
      db.prepare('UPDATE review_rules SET current_version_id = ? WHERE id = ?').run(version.id, rid);
    }
    return version;
  });
  const version = tx();
  return { rule: getRule(rid).rule, version };
}

export interface UpdateRuleVersionPatch {
  dimensions?: unknown;
  qualityThreshold?: unknown;
  maxAutoOptimizeRounds?: unknown;
  promptId?: string | null;
  /** 仅允许 draft↔testing 互转;进入生产态必须走 publish */
  status?: RuleVersionStatus;
}

/** 编辑未上线版本(draft/testing);published/disabled 一律拒绝——修改请另起新版本(§43) */
export function updateRuleVersion(versionId: string, patch: UpdateRuleVersionPatch): ReviewRuleVersion {
  const current = getRuleVersion(versionId);
  if (current.status === 'published' || current.status === 'disabled') {
    throw new CoreError('RULE_VERSION_IMMUTABLE', `${current.status} 状态的规则版本不可修改,请新建版本`);
  }
  const db = getDb();
  const dims =
    patch.dimensions !== undefined ? validateDimensions(patch.dimensions) : current.dimensions;
  const threshold =
    patch.qualityThreshold !== undefined ? clampInt(patch.qualityThreshold, 0, 100, current.qualityThreshold) : current.qualityThreshold;
  const rounds =
    patch.maxAutoOptimizeRounds !== undefined
      ? clampInt(patch.maxAutoOptimizeRounds, 0, 10, current.maxAutoOptimizeRounds)
      : current.maxAutoOptimizeRounds;
  const promptId =
    patch.promptId !== undefined ? (typeof patch.promptId === 'string' ? patch.promptId.trim() || null : null) : current.promptId;
  let status: RuleVersionStatus = current.status;
  if (patch.status !== undefined && patch.status !== current.status) {
    const allowed =
      (current.status === 'draft' && patch.status === 'testing') ||
      (current.status === 'testing' && patch.status === 'draft');
    if (!allowed) throw new CoreError('INVALID_INPUT', `不允许的状态转换: ${current.status} → ${patch.status}`);
    status = patch.status;
  }
  db.prepare(
    `UPDATE review_rule_versions SET dimensions_json = ?, quality_threshold = ?, max_auto_optimize_rounds = ?, prompt_id = ?, status = ?
     WHERE id = ?`
  ).run(JSON.stringify(dims), threshold, rounds, promptId, status, versionId);
  return getRuleVersion(versionId);
}

/** 发布为全局唯一生效版本:其余已发布版本(含其他规则)一律先停用 */
export function publishRuleVersion(versionId: string): ReviewRuleVersion {
  const target = getRuleVersion(versionId);
  if (target.status === 'published') return target;
  const db = getDb();
  const now = new Date().toISOString();
  const tx = db.transaction(() => {
    db.prepare("UPDATE review_rule_versions SET status = 'disabled' WHERE status = 'published' AND id != ?").run(versionId);
    db.prepare("UPDATE review_rule_versions SET status = 'published', published_at = ? WHERE id = ?").run(now, versionId);
    db.prepare('UPDATE review_rules SET current_version_id = ?, updated_at = ? WHERE id = ?').run(
      versionId,
      now,
      target.ruleId
    );
    // 其他规则若曾指向被停用的生效版本,清空其指针
    db.prepare(
      `UPDATE review_rules SET current_version_id = NULL
       WHERE current_version_id IS NOT NULL
         AND current_version_id NOT IN (SELECT id FROM review_rule_versions WHERE status = 'published')`
    ).run();
  });
  tx();
  return getRuleVersion(versionId);
}

export function disableRuleVersion(versionId: string): ReviewRuleVersion {
  const target = getRuleVersion(versionId);
  if (target.status === 'disabled') return target;
  const db = getDb();
  const tx = db.transaction(() => {
    db.prepare("UPDATE review_rule_versions SET status = 'disabled' WHERE id = ?").run(versionId);
    if (target.status === 'published') {
      db.prepare(
        `UPDATE review_rules SET current_version_id = NULL
         WHERE current_version_id = ?
           AND NOT EXISTS (SELECT 1 FROM review_rule_versions WHERE id = ? AND status = 'published')`
      ).run(versionId, versionId);
    }
  });
  tx();
  return getRuleVersion(versionId);
}

// ---------- 查询 ----------

export interface ReviewRuleWithVersions {
  rule: ReviewRule;
  versions: ReviewRuleVersion[];
}

export function getRule(ruleId: string): ReviewRuleWithVersions {
  const row = getDb().prepare('SELECT * FROM review_rules WHERE id = ?').get(ruleId) as RuleRow | undefined;
  if (!row) throw new CoreError('REVIEW_RULE_NOT_FOUND', `评审规则不存在: ${ruleId}`);
  const versions = (
    getDb().prepare('SELECT * FROM review_rule_versions WHERE rule_id = ? ORDER BY created_at ASC, version ASC').all(
      ruleId
    ) as RuleVersionRow[]
  ).map(toRuleVersion);
  return { rule: toRule(row), versions };
}

export function listReviewRules(): ReviewRuleWithVersions[] {
  const rows = getDb().prepare('SELECT * FROM review_rules ORDER BY created_at DESC').all() as RuleRow[];
  return rows.map((row) => {
    const versions = (
      getDb()
        .prepare('SELECT * FROM review_rule_versions WHERE rule_id = ? ORDER BY created_at ASC, version ASC')
        .all(row.id) as RuleVersionRow[]
    ).map(toRuleVersion);
    return { rule: toRule(row), versions };
  });
}

export function getRuleVersion(versionId: string): ReviewRuleVersion {
  const row = getDb().prepare('SELECT * FROM review_rule_versions WHERE id = ?').get(versionId) as
    | RuleVersionRow
    | undefined;
  if (!row) throw new CoreError('REVIEW_RULE_NOT_FOUND', `评审规则版本不存在: ${versionId}`);
  return toRuleVersion(row);
}

/** 当前全局唯一生效版本(published);无则返回 null(调用方决定报错或播种) */
export function getActiveRuleVersion(): ReviewRuleVersion | null {
  ensureDefaultReviewRule();
  const row = getDb()
    .prepare("SELECT * FROM review_rule_versions WHERE status = 'published' ORDER BY published_at DESC LIMIT 1")
    .get() as RuleVersionRow | undefined;
  return row ? toRuleVersion(row) : null;
}

// ---------- 默认规则播种 ----------

let seeded = false;

/** 默认规则 v1.0 的七维度(规格书 §13 权重 / §14 评分标准文案) */
function defaultDimensions(): ReviewDimensionSpec[] {
  const std = (excellent: string, good: string, fair: string, poor: string) => [
    { min: 90, max: 100, description: excellent },
    { min: 70, max: 89, description: good },
    { min: 60, max: 69, description: fair },
    { min: 0, max: 59, description: poor },
  ];
  return [
    {
      name: '故事完整性',
      weight: 20,
      definition: '开端、冲突、发展、高潮、结局五要素是否齐备并相互支撑,前后是否呼应。',
      standards: std(
        '故事结构完整:开端明确、冲突成立、发展自然、高潮有效、结局完整,前后具有呼应。',
        '故事基本完整,但部分结构存在不足。',
        '故事存在明显缺失。',
        '故事结构严重不完整。'
      ),
      bonus: '首尾呼应或伏笔回收完整可加分。',
      penalty: '缺少结局或有头无尾直接重扣。',
      notes: '先核对五要素是否存在,再评估衔接质量。',
    },
    {
      name: '情节与冲突',
      weight: 20,
      definition: '核心冲突是否成立、张力是否逐层递进、转折与悬念是否有效。',
      standards: std(
        '冲突成立且有层次,张力持续升级,转折出人意料又在情理之中。',
        '冲突基本成立,但推进略平或张力不足。',
        '冲突模糊或张力涣散,情节推动乏力。',
        '几乎没有有效冲突,情节无法成立。'
      ),
      bonus: '关键转折兼具意外性与必然性可加分。',
      penalty: '依赖巧合强行推动情节应扣分。',
      notes: '',
    },
    {
      name: '人物塑造',
      weight: 15,
      definition: '人物动机是否清晰、性格是否一致、配角是否有功能价值。',
      standards: std(
        '主要人物立体鲜活,动机充分,配角各司其职。',
        '主角清晰但配角偏工具化。',
        '人物面目模糊,动机牵强。',
        '人物完全沦为符号,无塑造可言。'
      ),
      bonus: '人物弧光(心态/关系发生变化)完整可加分。',
      penalty: '人物行为与其既定性格矛盾应扣分。',
      notes: '',
    },
    {
      name: '逻辑合理性',
      weight: 15,
      definition: '因果链条是否闭合、设定是否自洽、人物行为是否符合动机。',
      standards: std(
        '因果闭环,设定自洽,无逻辑硬伤。',
        '整体合理,存在个别可忽略的瑕疵。',
        '存在明显逻辑断裂或设定冲突。',
        '逻辑混乱,多处自相矛盾。'
      ),
      bonus: '',
      penalty: '关键情节依赖逻辑硬伤时应重扣。',
      notes: '',
    },
    {
      name: '情绪感染力',
      weight: 10,
      definition: '代入感、情绪节奏与高潮处的情绪释放是否有效。',
      standards: std(
        '代入感强,情绪起伏有设计,高潮具有明显释放感。',
        '有感染力但节奏较平。',
        '情绪平淡,难以共情。',
        '全程无情绪波动。'
      ),
      bonus: '结尾留有余味可加分。',
      penalty: '',
      notes: '',
    },
    {
      name: '语言表达',
      weight: 10,
      definition: '文字流畅度、用词准确性、句式变化与画面感。',
      standards: std(
        '文笔流畅凝练,画面感强,句式富有变化。',
        '表达清楚通顺,个别语句平淡。',
        '表达啰嗦或有明显病句。',
        '语言混乱,难以卒读。'
      ),
      bonus: '',
      penalty: '出现 AI 腔或模板化套话应扣分。',
      notes: '',
    },
    {
      name: '创意与独特性',
      weight: 10,
      definition: '题材立意的新颖度与桥段处理的独特性。',
      standards: std(
        '立意新颖,处理方式独特,令人印象深刻。',
        '题材常见但有个人化处理。',
        '高度套路化,缺乏记忆点。',
        '完全陈词滥调。'
      ),
      bonus: '',
      penalty: '',
      notes: '',
    },
  ];
}

const DEFAULT_PROMPT_CONTENT = `你是资深的短篇小说评审专家。请依据给定的评分维度与评分标准,对小说进行严格评审。

评审要求:
1. 逐维度按 0-100 打分,严格对照各维度的评分标准分档。
2. score 为加权前的百分制原始分;系统将按维度权重折算总分。
3. 必须给出每个维度的打分理由(引用文本证据)。
4. strengths/weaknesses/suggestions 各给出 1-5 条,具体可执行,禁止空话。
5. 只输出一个 JSON 对象,不要输出任何其他文字或代码块标记。

输出 JSON 格式:
{
  "dimensions": [{"name": "维度名", "score": 0-100整数, "reason": "打分理由"}],
  "strengths": ["优点"],
  "weaknesses": ["问题"],
  "suggestions": ["优化建议"],
  "summary": "一段不超过150字的总体评价"
}`;

/**
 * 播种默认评审规则「短篇小说评审标准」v1.0 + 关联 Prompt「短篇评审」v1.0 并直接发布。
 * 库中无任何规则时执行;幂等(进程内一次);并发插入依赖 UNIQUE 兜底。
 */
export function ensureDefaultReviewRule(): void {
  if (seeded) return;
  const db = getDb();
  const n = (db.prepare('SELECT COUNT(*) AS n FROM review_rules').get() as { n: number }).n;
  seeded = true; // 先置位防递归:createReviewRule → insertRuleVersion → validate 不回查本函数,但保险起见先行
  if (n === 0) {
    try {
      const prompt = genId('rprompt');
      db.prepare(
        'INSERT INTO review_prompts (id, name, version, content, rule_version_id, model_hint, change_note, created_at) VALUES (?, ?, ?, ?, NULL, NULL, ?, ?)'
      ).run(prompt, '短篇评审', 'v1.0', DEFAULT_PROMPT_CONTENT, '初始版本:随默认规则 v1.0 播种', new Date().toISOString());
      createReviewRule({
        name: '短篇小说评审标准',
        description: '默认七维度评审规则:完整性/情节冲突/人物/逻辑/情绪/语言/创意(规格书 v1.0)',
        dimensions: defaultDimensions(),
        qualityThreshold: 80,
        maxAutoOptimizeRounds: 3,
        promptId: prompt,
        publish: true,
      });
    } catch {
      /* 并发播种撞 UNIQUE:另一进程已完成,忽略 */
    }
  }
}
