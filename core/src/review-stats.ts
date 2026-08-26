// V9.5 阶段二补丁:评审中心统计补全 — 7 日评审趋势(章节/弧级)+ 章节维度均分 + 弧评汇总
// 全部轻量聚合:日期分桶走 SQL GROUP BY;维度均分在 JS 侧对最近记录做 JSON 解析

import { getDb } from './db';

export interface ReviewTrendPoint {
  /** YYYY-MM-DD(东八区自然日) */
  date: string;
  chapterCount: number;
  arcCount: number;
  chapterAvgScore: number | null;
}

export interface ReviewDimensionAvg {
  name: string;
  avg: number;
  count: number;
}

export interface ReviewTrendStats {
  days: ReviewTrendPoint[];
  chapterDimensionAverages: ReviewDimensionAvg[];
  arcSummary: { total: number; qualified: number; avgScore: number | null };
}

/** 东八区 YYYY-MM-DD(review_records.created_at 为 UTC ISO 串) */
function chinaDate(isoUtc: string): string {
  return new Date(isoUtc).toLocaleDateString('zh-CN', { timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit' }).replace(/\//g, '-');
}

export function getReviewTrendStats(days = 7): ReviewTrendStats {
  const db = getDb();
  const since = new Date(Date.now() - (days - 1) * 24 * 3600 * 1000);
  since.setUTCHours(0, 0, 0, 0);

  // 1) 每日章节评审量与均分
  const chapterRows = db
    .prepare(
      `SELECT created_at, score FROM review_records
       WHERE ref_type = 'chapter' AND created_at >= ?`
    )
    .all(since.toISOString()) as Array<{ created_at: string; score: number }>;

  // 2) 每日弧评量
  const arcRows = db
    .prepare(`SELECT created_at FROM arc_review_records WHERE created_at >= ?`)
    .all(since.toISOString()) as Array<{ created_at: string }>;

  // 预生成连续 days 个自然日桶(东八区)
  const buckets = new Map<string, { chapterScores: number[]; arcCount: number }>();
  for (let i = days - 1; i >= 0; i--) {
    const d = new Date(Date.now() - i * 24 * 3600 * 1000);
    const key = chinaDate(d.toISOString());
    buckets.set(key, { chapterScores: [], arcCount: 0 });
  }
  for (const r of chapterRows) {
    const key = chinaDate(r.created_at);
    const b = buckets.get(key);
    if (b) b.chapterScores.push(r.score);
  }
  for (const r of arcRows) {
    const b = buckets.get(chinaDate(r.created_at));
    if (b) b.arcCount += 1;
  }

  const trend: ReviewTrendPoint[] = [...buckets.entries()].map(([date, b]) => ({
    date,
    chapterCount: b.chapterScores.length,
    arcCount: b.arcCount,
    chapterAvgScore:
      b.chapterScores.length === 0
        ? null
        : Math.round(b.chapterScores.reduce((s, v) => s + v, 0) / b.chapterScores.length),
  }));

  // 3) 章节维度均分(最近 500 条章节评审)
  const recent = db
    .prepare(
      `SELECT dimension_scores_json FROM review_records
       WHERE ref_type = 'chapter' ORDER BY created_at DESC, rowid DESC LIMIT 500`
    )
    .all() as Array<{ dimension_scores_json: string }>;
  const dimAgg = new Map<string, { sum: number; count: number }>();
  for (const row of recent) {
    let dims: Array<{ name: string; score: number }> = [];
    try {
      dims = JSON.parse(row.dimension_scores_json) as Array<{ name: string; score: number }>;
    } catch {
      continue;
    }
    for (const d of dims) {
      if (typeof d.name !== 'string' || typeof d.score !== 'number') continue;
      const cur = dimAgg.get(d.name) ?? { sum: 0, count: 0 };
      cur.sum += d.score;
      cur.count += 1;
      dimAgg.set(d.name, cur);
    }
  }
  const chapterDimensionAverages: ReviewDimensionAvg[] = [...dimAgg.entries()]
    .map(([name, agg]) => ({ name, avg: Math.round((agg.sum / agg.count) * 10) / 10, count: agg.count }))
    .sort((a, b) => a.avg - b.avg); // 薄弱的排前面

  // 4) 弧评汇总(全量)
  const arc = db
    .prepare(
      `SELECT COUNT(*) AS total,
              COALESCE(SUM(qualified), 0) AS qualified,
              COALESCE(AVG(score), NULL) AS avg_score
       FROM arc_review_records`
    )
    .get() as { total: number; qualified: number; avg_score: number | null };

  return {
    days: trend,
    chapterDimensionAverages,
    arcSummary: {
      total: arc.total,
      qualified: arc.qualified,
      avgScore: arc.avg_score === null ? null : Math.round(arc.avg_score),
    },
  };
}
