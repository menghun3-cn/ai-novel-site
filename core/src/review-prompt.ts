// V9 评审 Prompt 版本服务:版本不可覆盖,修改即新版本(规格书 §25/§43)

import { getDb, genId } from './db';
import { CoreError, type ReviewPrompt } from './domain';
import { getRuleVersion } from './review-rule';

interface PromptRow {
  id: string;
  name: string;
  version: string;
  content: string;
  rule_version_id: string | null;
  model_hint: string | null;
  change_note: string | null;
  created_at: string;
}

function toPrompt(row: PromptRow): ReviewPrompt {
  return {
    id: row.id,
    name: row.name,
    version: row.version,
    content: row.content,
    ruleVersionId: row.rule_version_id,
    modelHint: row.model_hint,
    changeNote: row.change_note,
    createdAt: row.created_at,
  };
}

export function getReviewPrompt(id: string): ReviewPrompt {
  const row = getDb().prepare('SELECT * FROM review_prompts WHERE id = ?').get(id) as PromptRow | undefined;
  if (!row) throw new CoreError('REVIEW_PROMPT_NOT_FOUND', `评审 Prompt 不存在: ${id}`);
  return toPrompt(row);
}

/** 全量列表;可按 name 过滤;同 name 按创建时间倒序(最新在前,rowid 兜底同毫秒插入) */
export function listReviewPrompts(name?: string): ReviewPrompt[] {
  const rows = (
    name?.trim()
      ? getDb()
          .prepare('SELECT * FROM review_prompts WHERE name = ? ORDER BY name ASC, created_at DESC, rowid DESC')
          .all(name.trim())
      : getDb().prepare('SELECT * FROM review_prompts ORDER BY name ASC, created_at DESC, rowid DESC').all()
  ) as PromptRow[];
  return rows.map(toPrompt);
}

/** 按 name 分组:每组取最新版本在前 */
export function groupReviewPromptsByName(): Array<{ name: string; versions: ReviewPrompt[] }> {
  const all = listReviewPrompts();
  const map = new Map<string, ReviewPrompt[]>();
  for (const p of all) {
    const list = map.get(p.name) ?? [];
    list.push(p);
    map.set(p.name, list);
  }
  return [...map.entries()].map(([name, versions]) => ({ name, versions }));
}

export interface CreateReviewPromptInput {
  name: string;
  content: string;
  /** 显式指定版本号(如 v2.0);缺省自动 minor+1 */
  version?: string;
  ruleVersionId?: string | null;
  modelHint?: string | null;
  changeNote?: string | null;
}

/**
 * 新建 Prompt 版本:同名即迭代。已有内容永不 UPDATE——调整措辞请新建版本。
 * 自动版本号:vX.Y 取该名称最大者 minor+1。
 */
export function createReviewPromptVersion(input: CreateReviewPromptInput): ReviewPrompt {
  const name = input.name?.trim();
  const content = input.content?.trim();
  if (!name) throw new CoreError('INVALID_INPUT', 'Prompt 名称不能为空');
  if (!content) throw new CoreError('INVALID_INPUT', 'Prompt 内容不能为空');
  const db = getDb();
  let version = input.version?.trim() ?? '';
  if (!version) {
    const rows = db.prepare('SELECT version FROM review_prompts WHERE name = ?').all(name) as { version: string }[];
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
    version = bestMinor < 0 ? 'v1.0' : `v${bestMajor}.${bestMinor + 1}`;
  }
  const dup = db.prepare('SELECT id FROM review_prompts WHERE name = ? AND version = ?').get(name, version);
  if (dup) throw new CoreError('RULE_VERSION_CONFLICT', `Prompt 版本号已存在: ${name} ${version}`);
  // 关联规则版本存在性守卫(允许为空)
  if (input.ruleVersionId?.trim()) {
    getRuleVersion(input.ruleVersionId.trim()); // 不存在时抛 REVIEW_RULE_NOT_FOUND
  }
  const id = genId('rprompt');
  db.prepare(
    'INSERT INTO review_prompts (id, name, version, content, rule_version_id, model_hint, change_note, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)'
  ).run(
    id,
    name.slice(0, 200),
    version,
    content,
    input.ruleVersionId?.trim() || null,
    input.modelHint?.trim() || null,
    input.changeNote?.trim() || null,
    new Date().toISOString()
  );
  return getReviewPrompt(id);
}
