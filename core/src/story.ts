// V4 Story Core 服务层:世界观/人物/人物关系/故事线/章节大纲/伏笔(每书隔离)
// 与 Content Core(service.ts)解耦:这里只管"设定事实",章节仍走 service.ts

import type Database from 'better-sqlite3';
import { getDb } from './db';
import {
  CoreError,
  isArcStatus,
  isCharacterRole,
  type StoryArc,
  type StoryCharacter,
  type StoryForeshadowing,
  type StoryOutline,
  type StoryRelationship,
  type StoryWorld,
  type UpsertArcInput,
  type UpsertCharacterInput,
} from './domain';

function nowIso(): string {
  return new Date().toISOString();
}

function assertBook(db: Database.Database, bookId: string): void {
  if (!db.prepare('SELECT id FROM books WHERE id = ?').get(bookId)) {
    throw new CoreError('BOOK_NOT_FOUND', `book not found: ${bookId}`);
  }
}

// ---------- 世界观 ----------

export function getWorld(bookId: string): StoryWorld {
  const db = getDb();
  const row = db.prepare('SELECT * FROM story_worlds WHERE book_id = ?').get(bookId) as
    | { setting: string; rules: string; created_at: string; updated_at: string }
    | undefined;
  if (!row) return { bookId, setting: '', rules: '', createdAt: null, updatedAt: null };
  return { bookId, setting: row.setting, rules: row.rules, createdAt: row.created_at, updatedAt: row.updated_at };
}

export function upsertWorld(bookId: string, patch: { setting?: string; rules?: string }): StoryWorld {
  const db = getDb();
  assertBook(db, bookId);
  const current = getWorld(bookId);
  const setting = patch.setting ?? current.setting;
  const rules = patch.rules ?? current.rules;
  const at = nowIso();
  db.prepare(
    `INSERT INTO story_worlds (id, book_id, setting, rules, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?)
     ON CONFLICT (book_id) DO UPDATE SET setting = excluded.setting, rules = excluded.rules, updated_at = excluded.updated_at`
  ).run(`world_${bookId}`, bookId, setting, rules, at, at);
  return getWorld(bookId);
}

// ---------- 人物 ----------

interface CharacterRow {
  id: number;
  book_id: string;
  name: string;
  role: string;
  persona: string;
  appearance: string;
  background: string;
  state: string;
  created_at: string;
  updated_at: string;
}

function toCharacter(r: CharacterRow): StoryCharacter {
  return {
    id: r.id,
    bookId: r.book_id,
    name: r.name,
    role: r.role as StoryCharacter['role'],
    persona: r.persona,
    appearance: r.appearance,
    background: r.background,
    state: r.state,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
}

export function listCharacters(bookId: string): StoryCharacter[] {
  const db = getDb();
  assertBook(db, bookId);
  const rows = db
    .prepare('SELECT * FROM story_characters WHERE book_id = ? ORDER BY created_at ASC, id ASC')
    .all(bookId) as CharacterRow[];
  return rows.map(toCharacter);
}

export function upsertCharacter(bookId: string, input: UpsertCharacterInput): StoryCharacter {
  const db = getDb();
  assertBook(db, bookId);
  const name = input.name.trim();
  if (!name) throw new CoreError('CHARACTER_NAME_TAKEN', 'character name is required');
  const role = input.role !== undefined ? (isCharacterRole(input.role) ? input.role : null) : 'supporting';
  if (role === null) throw new CoreError('INVALID_STATUS', `invalid character role: ${String(input.role)}`);
  const at = nowIso();
  const existing = db.prepare('SELECT id FROM story_characters WHERE book_id = ? AND name = ?').get(bookId, name) as
    | { id: number }
    | undefined;
  if (existing) {
    db.prepare(
      `UPDATE story_characters
       SET role = COALESCE(?, role), persona = COALESCE(?, persona), appearance = COALESCE(?, appearance),
           background = COALESCE(?, background), state = COALESCE(?, state), updated_at = ?
       WHERE id = ?`
    ).run(input.role ?? null, input.persona ?? null, input.appearance ?? null, input.background ?? null, input.state ?? null, at, existing.id);
    return getCharacter(bookId, existing.id)!;
  }
  const res = db
    .prepare(
      `INSERT INTO story_characters (book_id, name, role, persona, appearance, background, state, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(bookId, name, role, input.persona ?? '', input.appearance ?? '', input.background ?? '', input.state ?? '', at, at);
  return getCharacter(bookId, Number(res.lastInsertRowid))!;
}

export function getCharacter(bookId: string, id: number): StoryCharacter | null {
  const db = getDb();
  const row = db.prepare('SELECT * FROM story_characters WHERE book_id = ? AND id = ?').get(bookId, id) as
    | CharacterRow
    | undefined;
  return row ? toCharacter(row) : null;
}

export function updateCharacter(bookId: string, id: number, patch: Partial<UpsertCharacterInput>): StoryCharacter {
  const db = getDb();
  const row = getCharacter(bookId, id);
  if (!row) throw new CoreError('CHARACTER_NOT_FOUND', `${bookId} character ${id}`);
  const merged = {
    name: patch.name !== undefined ? patch.name.trim() : row.name,
    role: patch.role ?? row.role,
    persona: patch.persona ?? row.persona,
    appearance: patch.appearance ?? row.appearance,
    background: patch.background ?? row.background,
    state: patch.state ?? row.state,
  };
  if (!merged.name) throw new CoreError('CHARACTER_NAME_TAKEN', 'character name is required');
  if (!isCharacterRole(merged.role)) throw new CoreError('INVALID_STATUS', `invalid character role: ${String(merged.role)}`);
  const clash = db.prepare('SELECT id FROM story_characters WHERE book_id = ? AND name = ? AND id != ?').get(bookId, merged.name, id);
  if (clash) throw new CoreError('CHARACTER_NAME_TAKEN', `character name already exists: ${merged.name}`);
  db.prepare(
    'UPDATE story_characters SET name = ?, role = ?, persona = ?, appearance = ?, background = ?, state = ?, updated_at = ? WHERE id = ?'
  ).run(merged.name, merged.role, merged.persona, merged.appearance, merged.background, merged.state, nowIso(), id);
  return getCharacter(bookId, id)!;
}

export function deleteCharacter(bookId: string, id: number): boolean {
  const db = getDb();
  const res = db.prepare('DELETE FROM story_characters WHERE book_id = ? AND id = ?').run(bookId, id);
  return res.changes > 0;
}

// ---------- 人物关系 ----------

interface RelationshipRow {
  id: number;
  book_id: string;
  from_name: string;
  to_name: string;
  kind: string;
  note: string;
  created_at: string;
}

function toRelationship(r: RelationshipRow): StoryRelationship {
  return {
    id: r.id,
    bookId: r.book_id,
    fromName: r.from_name,
    toName: r.to_name,
    kind: r.kind,
    note: r.note,
    createdAt: r.created_at,
  };
}

function getRelationshipRow(db: Database.Database, bookId: string, id: number): StoryRelationship | null {
  const row = db.prepare('SELECT * FROM story_relationships WHERE book_id = ? AND id = ?').get(bookId, id) as
    | RelationshipRow
    | undefined;
  return row ? toRelationship(row) : null;
}

export function listRelationships(bookId: string): StoryRelationship[] {
  const db = getDb();
  assertBook(db, bookId);
  const rows = db
    .prepare('SELECT * FROM story_relationships WHERE book_id = ? ORDER BY created_at ASC, id ASC')
    .all(bookId) as RelationshipRow[];
  return rows.map(toRelationship);
}

export function addRelationship(
  bookId: string,
  input: { fromName: string; toName: string; kind: string; note?: string }
): StoryRelationship {
  const db = getDb();
  assertBook(db, bookId);
  const fromName = input.fromName.trim();
  const toName = input.toName.trim();
  const kind = input.kind.trim();
  if (!fromName || !toName || !kind) {
    throw new CoreError('RELATIONSHIP_NOT_FOUND', 'fromName/toName/kind are required');
  }
  const res = db
    .prepare('INSERT INTO story_relationships (book_id, from_name, to_name, kind, note, created_at) VALUES (?, ?, ?, ?, ?, ?)')
    .run(bookId, fromName, toName, kind, input.note ?? '', nowIso());
  return getRelationshipRow(db, bookId, Number(res.lastInsertRowid))!;
}

export function deleteRelationship(bookId: string, id: number): boolean {
  const db = getDb();
  const res = db.prepare('DELETE FROM story_relationships WHERE book_id = ? AND id = ?').run(bookId, id);
  return res.changes > 0;
}

// ---------- 故事线 ----------

interface ArcRow {
  id: number;
  book_id: string;
  title: string;
  summary: string;
  start_chapter: number | null;
  end_chapter: number | null;
  status: string;
  created_at: string;
  updated_at: string;
}

function toArc(r: ArcRow): StoryArc {
  return {
    id: r.id,
    bookId: r.book_id,
    title: r.title,
    summary: r.summary,
    startChapter: r.start_chapter,
    endChapter: r.end_chapter,
    status: r.status as StoryArc['status'],
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
}

export function listArcs(bookId: string): StoryArc[] {
  const db = getDb();
  assertBook(db, bookId);
  const rows = db
    .prepare('SELECT * FROM story_arcs WHERE book_id = ? ORDER BY COALESCE(start_chapter, 999999) ASC, id ASC')
    .all(bookId) as ArcRow[];
  return rows.map(toArc);
}

export function createArc(bookId: string, input: UpsertArcInput): StoryArc {
  const db = getDb();
  assertBook(db, bookId);
  const title = input.title.trim();
  if (!title) throw new CoreError('ARC_NOT_FOUND', 'arc title is required');
  const status = input.status !== undefined ? (isArcStatus(input.status) ? input.status : null) : 'planned';
  if (status === null) throw new CoreError('INVALID_STATUS', `invalid arc status: ${String(input.status)}`);
  const at = nowIso();
  const res = db
    .prepare(
      `INSERT INTO story_arcs (book_id, title, summary, start_chapter, end_chapter, status, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(bookId, title, input.summary ?? '', input.startChapter ?? null, input.endChapter ?? null, status, at, at);
  return getArc(bookId, Number(res.lastInsertRowid))!;
}

export function updateArc(bookId: string, id: number, patch: Partial<UpsertArcInput>): StoryArc {
  const db = getDb();
  const existing = getArc(bookId, id);
  if (!existing) throw new CoreError('ARC_NOT_FOUND', `${bookId} arc ${id}`);
  const merged = {
    title: patch.title !== undefined ? patch.title.trim() : existing.title,
    summary: patch.summary ?? existing.summary,
    startChapter: patch.startChapter !== undefined ? patch.startChapter : existing.startChapter,
    endChapter: patch.endChapter !== undefined ? patch.endChapter : existing.endChapter,
    status: patch.status ?? existing.status,
  };
  if (!merged.title) throw new CoreError('ARC_NOT_FOUND', 'arc title is required');
  if (!isArcStatus(merged.status)) throw new CoreError('INVALID_STATUS', `invalid arc status: ${String(merged.status)}`);
  db.prepare(
    'UPDATE story_arcs SET title = ?, summary = ?, start_chapter = ?, end_chapter = ?, status = ?, updated_at = ? WHERE id = ?'
  ).run(merged.title, merged.summary, merged.startChapter, merged.endChapter, merged.status, nowIso(), id);
  return getArc(bookId, id)!;
}

export function getArc(bookId: string, id: number): StoryArc | null {
  const db = getDb();
  const row = db.prepare('SELECT * FROM story_arcs WHERE book_id = ? AND id = ?').get(bookId, id) as
    | ArcRow
    | undefined;
  return row ? toArc(row) : null;
}

export function deleteArc(bookId: string, id: number): boolean {
  const db = getDb();
  const res = db.prepare('DELETE FROM story_arcs WHERE book_id = ? AND id = ?').run(bookId, id);
  return res.changes > 0;
}

// ---------- 章节大纲 ----------

interface OutlineRow {
  id: number;
  book_id: string;
  number: number;
  title: string;
  beats: string;
  updated_at: string;
}

function toOutline(r: OutlineRow): StoryOutline {
  return { id: r.id, bookId: r.book_id, number: r.number, title: r.title, beats: r.beats, updatedAt: r.updated_at };
}

export function listOutlines(bookId: string): StoryOutline[] {
  const db = getDb();
  assertBook(db, bookId);
  const rows = db.prepare('SELECT * FROM story_outlines WHERE book_id = ? ORDER BY number ASC').all(bookId) as OutlineRow[];
  return rows.map(toOutline);
}

export function setOutline(bookId: string, input: { number: number; title?: string; beats?: string }): StoryOutline {
  const db = getDb();
  assertBook(db, bookId);
  if (!Number.isInteger(input.number) || input.number <= 0) {
    throw new CoreError('OUTLINE_NOT_FOUND', `outline number must be a positive integer: ${String(input.number)}`);
  }
  const at = nowIso();
  db.prepare(
    `INSERT INTO story_outlines (book_id, number, title, beats, updated_at)
     VALUES (?, ?, ?, ?, ?)
     ON CONFLICT (book_id, number) DO UPDATE SET title = excluded.title, beats = excluded.beats, updated_at = excluded.updated_at`
  ).run(bookId, input.number, input.title ?? '', input.beats ?? '', at);
  return db.prepare('SELECT * FROM story_outlines WHERE book_id = ? AND number = ?').get(bookId, input.number) as unknown as StoryOutline;
}

export function deleteOutline(bookId: string, number: number): boolean {
  const db = getDb();
  const res = db.prepare('DELETE FROM story_outlines WHERE book_id = ? AND number = ?').run(bookId, number);
  return res.changes > 0;
}

// ---------- 伏笔 ----------

interface ForeshadowingRow {
  id: number;
  book_id: string;
  label: string;
  detail: string;
  planted_chapter: number | null;
  resolved_chapter: number | null;
  created_at: string;
}

function toForeshadowing(r: ForeshadowingRow): StoryForeshadowing {
  return {
    id: r.id,
    bookId: r.book_id,
    label: r.label,
    detail: r.detail,
    plantedChapter: r.planted_chapter,
    resolvedChapter: r.resolved_chapter,
    createdAt: r.created_at,
  };
}

export function listForeshadowing(bookId: string, opts?: { openOnly?: boolean }): StoryForeshadowing[] {
  const db = getDb();
  assertBook(db, bookId);
  const where = opts?.openOnly ? 'AND resolved_chapter IS NULL' : '';
  const rows = db
    .prepare(`SELECT * FROM story_foreshadowing WHERE book_id = ? ${where} ORDER BY created_at ASC, id ASC`)
    .all(bookId) as ForeshadowingRow[];
  return rows.map(toForeshadowing);
}

export function plantForeshadowing(
  bookId: string,
  input: { label: string; detail?: string; plantedChapter?: number | null }
): StoryForeshadowing {
  const db = getDb();
  assertBook(db, bookId);
  const label = input.label.trim();
  if (!label) throw new CoreError('FORESHADOWING_NOT_FOUND', 'foreshadowing label is required');
  const res = db
    .prepare(
      'INSERT INTO story_foreshadowing (book_id, label, detail, planted_chapter, resolved_chapter, created_at) VALUES (?, ?, ?, ?, NULL, ?)'
    )
    .run(bookId, label, input.detail ?? '', input.plantedChapter ?? null, nowIso());
  const row = db.prepare('SELECT * FROM story_foreshadowing WHERE id = ?').get(Number(res.lastInsertRowid)) as ForeshadowingRow;
  return toForeshadowing(row);
}

/** 回收伏笔:写入回收章号;重复回收幂等(保留首次回收章号) */
export function resolveForeshadowing(bookId: string, id: number, resolvedChapter: number): StoryForeshadowing {
  const db = getDb();
  db.prepare('UPDATE story_foreshadowing SET resolved_chapter = COALESCE(resolved_chapter, ?) WHERE book_id = ? AND id = ?').run(
    resolvedChapter,
    bookId,
    id
  );
  const row = db.prepare('SELECT * FROM story_foreshadowing WHERE book_id = ? AND id = ?').get(bookId, id) as
    | ForeshadowingRow
    | undefined;
  if (!row) throw new CoreError('FORESHADOWING_NOT_FOUND', `${bookId} foreshadowing ${id}`);
  return toForeshadowing(row);
}

export function deleteForeshadowing(bookId: string, id: number): boolean {
  const db = getDb();
  const res = db.prepare('DELETE FROM story_foreshadowing WHERE book_id = ? AND id = ?').run(bookId, id);
  return res.changes > 0;
}
