// V4 生成上下文组装器:把 Story Core 事实 + Content Core 近况拼成
// AI Writer 可用的 GenerationContext,并渲染为确定性提示词文本。
// 只读组装,不写任何表。

import { getDb } from './db';
import { getWorld, listArcs, listCharacters, listForeshadowing, listOutlines, listRelationships } from './story';
import {
  CoreError,
  type StoryArc,
  type StoryCharacter,
  type StoryForeshadowing,
  type StoryOutline,
  type StoryRelationship,
  type StoryWorld,
} from './domain';

export interface ContextChapterExcerpt {
  number: number;
  title: string;
  /** 正文尾部摘录(截断至 excerptChars,默认 600) */
  excerpt: string;
}

export interface GenerationContext {
  bookId: string;
  bookTitle: string;
  world: StoryWorld;
  characters: StoryCharacter[];
  relationships: StoryRelationship[];
  /** planned/active 故事线(已完成 done 不进上下文) */
  arcs: StoryArc[];
  /** 未回收伏笔 */
  openForeshadowing: StoryForeshadowing[];
  recentChapters: ContextChapterExcerpt[];
  /** 目标章号(默认 = 现有最大章号+1) */
  nextChapterNumber: number;
  outline: StoryOutline | null;
}

export interface GenerationContextOptions {
  /** 指定目标章号;缺省取 max(number)+1 */
  chapterNumber?: number;
  /** 携带最近章节数,默认 3;0 表示不带 */
  recentCount?: number;
  /** 单章摘录字符上限,默认 600 */
  excerptChars?: number;
}

function tail(text: string, maxChars: number): string {
  const clean = text.trim();
  return clean.length <= maxChars ? clean : `…${clean.slice(-maxChars)}`;
}

export function getGenerationContext(bookId: string, opts: GenerationContextOptions = {}): GenerationContext {
  const db = getDb();
  const book = db.prepare('SELECT id, title FROM books WHERE id = ?').get(bookId) as
    | { id: string; title: string }
    | undefined;
  if (!book) throw new CoreError('BOOK_NOT_FOUND', `book not found: ${bookId}`);

  const recentCount = opts.recentCount ?? 3;
  const excerptChars = opts.excerptChars ?? 600;

  const maxRow = db.prepare('SELECT MAX(number) AS m FROM chapters WHERE book_id = ?').get(bookId) as
    | { m: number | null }
    | undefined;
  const nextChapterNumber = opts.chapterNumber ?? (maxRow?.m ?? 0) + 1;

  // 目标章已有正稿时拒绝(生成只面向"下一章"或大纲位)
  if (opts.chapterNumber !== undefined) {
    const exists = db.prepare('SELECT id FROM chapters WHERE book_id = ? AND number = ?').get(bookId, opts.chapterNumber);
    if (exists) throw new CoreError('CHAPTER_NUMBER_CONFLICT', `chapter ${opts.chapterNumber} already exists`);
  }

  const recentRows = (
    db
      .prepare('SELECT number, title, content_md FROM chapters WHERE book_id = ? ORDER BY number DESC LIMIT ?')
      .all(bookId, recentCount) as Array<{ number: number; title: string; content_md: string }>
  ).reverse();
  const recentChapters = recentRows.map((r) => ({ number: r.number, title: r.title, excerpt: tail(r.content_md, excerptChars) }));

  const outline =
    (db.prepare('SELECT * FROM story_outlines WHERE book_id = ? AND number = ?').get(bookId, nextChapterNumber) as
      | StoryOutline
      | undefined) ?? null;

  return {
    bookId,
    bookTitle: book.title,
    world: getWorld(bookId),
    characters: listCharacters(bookId),
    relationships: listRelationships(bookId),
    arcs: listArcs(bookId).filter((a) => a.status !== 'done'),
    openForeshadowing: listForeshadowing(bookId, { openOnly: true }),
    recentChapters,
    nextChapterNumber,
    outline,
  };
}

/**
 * 把 GenerationContext 渲染为给 LLM 的确定性提示词文本。
 * 分节固定顺序,空节跳过——同一上下文永远渲染出同一文本(测试可断言)。
 */
export function renderGenerationPrompt(ctx: GenerationContext): string {
  const parts: string[] = [];
  parts.push(`# 任务\n为小说《${ctx.bookTitle}》撰写第 ${ctx.nextChapterNumber} 章正文(Markdown)。只输出正文,不要输出解释。`);

  if (ctx.world.setting || ctx.world.rules) {
    parts.push(
      `# 世界观与写作规则\n[设定]\n${ctx.world.setting || '(未填写)'}\n[规则]\n${ctx.world.rules || '(未填写)'}`
    );
  }
  if (ctx.characters.length > 0) {
    const lines = ctx.characters.map(
      (c) =>
        `- ${c.name}(${c.role})${c.persona ? ` 性格:${c.persona}` : ''}${c.state ? ` 当前状态:${c.state}` : ''}${
          c.background ? ` 背景:${c.background}` : ''
        }`
    );
    parts.push(`# 人物\n${lines.join('\n')}`);
  }
  if (ctx.relationships.length > 0) {
    parts.push(`# 人物关系\n${ctx.relationships.map((r) => `- ${r.fromName} → ${r.toName}:${r.kind}${r.note ? `(${r.note})` : ''}`).join('\n')}`);
  }
  if (ctx.arcs.length > 0) {
    parts.push(
      `# 故事线\n${ctx.arcs
        .map((a) => `- ${a.title}[${a.status}] ${a.summary}${a.startChapter !== null ? `(第${a.startChapter}章起)` : ''}`)
        .join('\n')}`
    );
  }
  if (ctx.openForeshadowing.length > 0) {
    parts.push(
      `# 未回收伏笔(可择机回收,勿强行全收)\n${ctx.openForeshadowing
        .map((f) => `- ${f.label}${f.plantedChapter !== null ? `(埋于第${f.plantedChapter}章)` : ''}:${f.detail}`)
        .join('\n')}`
    );
  }
  if (ctx.recentChapters.length > 0) {
    parts.push(
      `# 最近章节(保持连贯)\n${ctx.recentChapters.map((c) => `## 第${c.number}章 ${c.title}\n${c.excerpt}`).join('\n\n')}`
    );
  }
  parts.push(
    ctx.outline
      ? `# 第 ${ctx.nextChapterNumber} 章大纲(必须覆盖全部要点)\n标题:${ctx.outline.title || '(自拟)'}\n${ctx.outline.beats}`
      : `# 第 ${ctx.nextChapterNumber} 章大纲\n(无既定大纲,依据上文自然推进)`
  );
  return parts.join('\n\n');
}
