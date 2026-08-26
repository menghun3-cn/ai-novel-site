/**
 * E2E 冒烟数据播种:在独立 NOVEL_DATA_DIR 中准备
 *   - 长篇书(e2e-long-book)+ 已发布第 1 章
 *   - 该章两条历史评审记录(供差异对比弹窗)
 *   - 一篇 passed 短篇并物化上线(读者站 /short/<id>)
 *
 * 由 playwright.config.ts 在启动 webServer 前调用(幂等:按 slug/标题判重)。
 */

export interface SeedResult {
  longBookSlug: string;
  shortStoryId: string;
}

interface DimScore {
  name: string;
  score: number;
  maxScore: number;
  reason: string;
}

const DIM_NAMES = ['故事完整性', '情节与冲突', '人物塑造', '逻辑合理性', '情绪感染力', '语言表达', '创意与独特性'];

function dimsJson(score: number): string {
  const dims: DimScore[] = DIM_NAMES.map((name) => ({
    name,
    score,
    maxScore: 100,
    reason: '基于章节文本证据的具体评分理由,不少于三十字。(e2e 种子数据)',
  }));
  return JSON.stringify(dims);
}

function recordJson(score: number): string {
  return JSON.stringify({
    dimensions: DIM_NAMES.map((name) => ({ name, score, reason: '基于章节文本证据的具体评分理由,不少于三十字。' })),
    strengths: ['衔接自然'],
    weaknesses: ['节奏稍缓'],
    suggestions: ['加强张力'],
    summary: '总评。',
  });
}

export async function seedE2eData(): Promise<SeedResult> {
  const core = await import('@novel/core');
  const {
    upsertAuthor,
    upsertCategory,
    createBook,
    createChapter,
    getBookBySlug,
    getDb,
    ensureDefaultReviewRule,
    getActiveRuleVersion,
    createShortStory,
    appendVersion,
    setFinalVersion,
    transitionStory,
    publishShortStory,
  } = core;

  // ---------- 长篇书 + 章节 ----------
  upsertAuthor('E2E 作者');
  upsertCategory('E2E 分类');
  let book = getBookBySlug('e2e-long-book');
  if (!book) {
    book = createBook({
      slug: 'e2e-long-book',
      title: 'E2E 长篇测试书',
      authorName: 'E2E 作者',
      categoryName: 'E2E 分类',
      tags: ['e2e'],
    });
  }
  const db = getDb();
  const chapterRow = db.prepare('SELECT id FROM chapters WHERE book_id = ? AND number = 1').get(book.id) as { id: string } | undefined;
  let chapterId: string;
  if (!chapterRow) {
    const ch = createChapter({
      bookId: book.id,
      number: 1,
      title: '第一章 冒烟',
      contentMd: '这是 E2E 冒烟章节的正文,用于驱动评审中心与 TTS 阅读页的关键路径。'.repeat(20),
      status: 'published',
    });
    chapterId = ch.id;
  } else {
    chapterId = chapterRow.id;
  }

  // ---------- 两条历史评审记录(对比弹窗用;分数不同以展示差值) ----------
  ensureDefaultReviewRule();
  const rule = getActiveRuleVersion();
  const existing = db.prepare('SELECT COUNT(*) AS n FROM review_records WHERE chapter_id = ? AND ref_type = ?').get(chapterId, 'chapter') as { n: number };
  if (existing.n === 0 && rule) {
    const insert = db.prepare(
      `INSERT INTO review_records (id, story_id, story_version_id, source_url, rule_id, rule_version,
        prompt_id, prompt_version, model_id, model_name, model_version, score, level, qualified,
        dimension_scores_json, strengths_json, weaknesses_json, suggestions_json, summary,
        review_round, optimization_round, duration_ms, raw_response, structured_result_json,
        created_at, chapter_id, ref_type)
       VALUES (?, NULL, NULL, NULL, ?, ?, NULL, NULL, NULL, ?, NULL, ?, ?, ?,
        ?, ?, ?, ?, ?, 1, 0, 1200, NULL, ?, ?, ?, 'chapter')`
    );
    const mk = (): string => `rrec_e2e_${Math.random().toString(36).slice(2, 12)}`;
    const t0 = Date.now() - 3600_000;
    // 参数序:id, rule_id, rule_version, model_name, score, level, qualified, dims, strengths, weaknesses, suggestions, summary, structured, created_at, chapter_id
    insert.run(mk(), rule.ruleId, rule.version, 'mock-model', 62, 'C', 0, dimsJson(62),
      JSON.stringify(['衔接自然']), JSON.stringify(['节奏稍缓']), JSON.stringify(['加强张力']), '首评:及格边缘。',
      recordJson(62), new Date(t0).toISOString(), chapterId);
    insert.run(mk(), rule.ruleId, rule.version, 'mock-model', 78, 'B', 0, dimsJson(78),
      JSON.stringify(['冲突前置更好']), JSON.stringify(['结尾略平']), JSON.stringify(['收束加一个钩子']), '重评:明显改善。',
      recordJson(78), new Date(t0 + 1800_000).toISOString(), chapterId);
  }

  // ---------- 短篇物化上线 ----------
  const existingStory = (core.listShortStories() as Array<{ id: string; title: string }>).find((s) => s.title === 'E2E 短篇测试');
  let storyId: string;
  if (existingStory) {
    storyId = existingStory.id;
  } else {
    const story = createShortStory({
      title: 'E2E 短篇测试',
      brief: { theme: '冒烟测试', genre: '都市', synopsis: '用于读者站阅读页与 TTS 组件的端到端验证' },
    });
    const v = appendVersion(story.id, {
      content: '夜色落下时,城市像一块烧红的铁。\n\n他站在天桥上,数着来往的车灯,第七辆之后,他看见了那把蓝色的伞。\n\n伞下的人抬起头,十年时间在这一刻折叠成一次对视。\n\n「你来了。」她说。\n\n「我来了。」他说。',
      creationReason: 'generated',
    });
    setFinalVersion(story.id, v.id);
    transitionStory(story.id, 'passed');
    publishShortStory(story.id);
    storyId = story.id;
  }

  return { longBookSlug: 'e2e-long-book', shortStoryId: storyId };
}
