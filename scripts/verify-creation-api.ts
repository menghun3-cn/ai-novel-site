/**
 * V9 创作线 API 回归:短篇 CRUD/守卫、创作流水线入队(202)、任务轮询、
 * 未配置 LLM → 任务 FAILED 可见、重试 + 配置 mock 上游 → 全链路 SUCCESS。
 *
 * 运行:npm run test:creation-api
 */
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';

process.env.NOVEL_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'novel-creation-api-'));
process.env.ADMIN_TOKEN = 't';

let failed = 0;
function assertOk(cond: boolean, name: string): void {
  if (cond) {
    console.log(`✓ ${name}`);
  } else {
    console.error(`✗ ${name}`);
    failed++;
  }
}

const DIM_NAMES = ['故事完整性', '情节与冲突', '人物塑造', '逻辑合理性', '情绪感染力', '语言表达', '创意与独特性'];
function reviewJson(score: number): string {
  return JSON.stringify({
    dimensions: DIM_NAMES.map((name) => ({ name, score, reason: '打分理由,依据文本证据充分说明。' })),
    strengths: ['结构完整'],
    weaknesses: ['配角单薄'],
    suggestions: ['增强配角动机'],
    summary: '总评。',
  });
}

// mock OpenAI 兼容上游:按提示词特征返回正文/修订稿/评审 JSON
const NOVEL = Array.from({ length: 80 }, (_, i) => `第${i}段:雨夜重逢的情节推进与情绪层次各不相同。`).join('');
let upstreamFail = false;
const server = http.createServer((req, res) => {
  let raw = '';
  req.on('data', (c) => (raw += c));
  req.on('end', () => {
    if (upstreamFail) {
      res.writeHead(500).end('boom');
      return;
    }
    let content = NOVEL;
    try {
      const prompt = String((JSON.parse(raw) as { messages?: Array<{ content?: string }> }).messages?.at(-1)?.content ?? '');
      if (prompt.includes('评分维度与标准')) content = reviewJson(85);
      else if (prompt.includes('针对评审发现的问题修订')) content = `${NOVEL}\n(修订稿)`;
    } catch {
      /* 保持默认正文 */
    }
    res.setHeader('content-type', 'application/json');
    res.end(JSON.stringify({ choices: [{ message: { content } }] }));
  });
});
await new Promise<void>((res) => server.listen(0, '127.0.0.1', res));
const addr = server.address();
if (!addr || typeof addr === 'string') throw new Error('no port');

const H = { 'content-type': 'application/json', 'x-admin-token': 't' };
function req(path: string, init?: RequestInit): Request {
  return new Request(`http://localhost${path}`, { headers: H, ...init });
}

async function waitForTaskStatus(taskId: string, statuses: string[], timeoutMs = 15000): Promise<string> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const { task } = await (await import('../web/app/api/admin/ai/tasks/[id]/route')).GET(req(`/api/admin/ai/tasks/${taskId}`), { params: Promise.resolve({ id: taskId }) } as never).then((r: Response) => r.json());
    if (statuses.includes(task.status)) return task.status as string;
    if (Date.now() > deadline) return task.status as string;
    await new Promise((r) => setTimeout(r, 100));
  }
}

async function main(): Promise<void> {
  const storiesRoute = await import('../web/app/api/admin/short-stories/route');
  const idRoute = await import('../web/app/api/admin/short-stories/[id]/route');
  const createRoute = await import('../web/app/api/admin/short-stories/[id]/create/route');
  const retryRoute = await import('../web/app/api/admin/ai/tasks/[id]/retry/route');

  // 未带令牌 → 401
  {
    const res = await storiesRoute.GET(new Request('http://localhost/api/admin/short-stories'), undefined as never);
    assertOk(res.status === 401, '无令牌访问列表 → 401');
  }

  // 创建/列表/编辑/删除守卫
  const created = await storiesRoute.POST(req('/api/admin/short-stories', {
    method: 'POST',
    body: JSON.stringify({ title: '雨夜重逢', brief: { theme: '爱情', targetWords: 3000 }, sourceUrl: null }),
  }), undefined as never);
  assertOk(created.status === 201, 'POST 短篇 → 201');
  const { story } = (await created.json()) as { story: { id: string; brief: Record<string, unknown> } };
  assertOk(story.brief['theme'] === '爱情', 'brief 白名单归一化生效');

  const listed = await (await storiesRoute.GET(req('/api/admin/short-stories?q=雨夜'), undefined as never)).json();
  assertOk((listed.stories as Array<{ id: string }>).some((x) => x.id === story.id), '列表可按标题模糊命中');

  const patched = await idRoute.PATCH(req(`/api/admin/short-stories/${story.id}`, {
    method: 'PATCH',
    body: JSON.stringify({ title: '雨夜重逢(改)' }),
  }), { params: Promise.resolve({ id: story.id }) } as never);
  assertOk(patched.status === 200, 'PATCH 主档 → 200');
  const delRes = await idRoute.DELETE(req(`/api/admin/short-stories/${story.id}`, { method: 'DELETE' }), { params: Promise.resolve({ id: story.id }) } as never);
  assertOk(delRes.status === 200, 'draft 状态可删');

  // 流水线入队:未配置 LLM → 任务 FAILED 且错误可见
  {
    const s2 = (await (await storiesRoute.POST(req('/api/admin/short-stories', {
      method: 'POST',
      body: JSON.stringify({ title: '闭环作品' }),
    }), undefined as never)).json()) as { story: { id: string } };

    delete process.env.AI_BASE_URL;
    delete process.env.AI_API_KEY;
    const enqueued = await createRoute.POST(req(`/api/admin/short-stories/${s2.story.id}/create`, { method: 'POST' }), { params: Promise.resolve({ id: s2.story.id }) } as never);
    assertOk(enqueued.status === 202, '入队创作流水线 → 202');
    const { task } = (await enqueued.json()) as { task: { id: string } };
    const status = await waitForTaskStatus(task.id, ['SUCCESS', 'FAILED']);
    assertOk(status === 'FAILED', '未配置 LLM 时任务失败可见');
    const detail = (await (await idRoute.GET(req(`/api/admin/short-stories/${s2.story.id}`), { params: Promise.resolve({ id: s2.story.id }) } as never)).json()) as { story: { status: string } };
    assertOk(detail.story.status === 'failed', '小说状态 failed(不静默)');

    // 配置 mock 上游后重试 → 全链路通过(AI_MODEL 显式指定,跳过 /models 发现)
    process.env.AI_BASE_URL = `http://127.0.0.1:${(addr as { port: number }).port}`;
    process.env.AI_API_KEY = 'k';
    process.env.AI_MODEL = 'mock-model';
    await retryRoute.POST(req(`/api/admin/ai/tasks/${task.id}/retry`, { method: 'POST' }), { params: Promise.resolve({ id: task.id }) } as never);
    const finalStatus = await waitForTaskStatus(task.id, ['SUCCESS', 'FAILED'], 30000);
    assertOk(finalStatus === 'SUCCESS', '重试后流水线全链路 SUCCESS');
    const after = (await (await idRoute.GET(req(`/api/admin/short-stories/${s2.story.id}`), { params: Promise.resolve({ id: s2.story.id }) } as never)).json()) as {
      story: { status: string; lastScore: number | null; reviewRound: number };
      versions: unknown[];
      latestReviews: Record<string, { score: number }>;
    };
    assertOk(after.story.status === 'passed' && after.story.lastScore === 85, '小说达标 passed(85 分)');
    assertOk((after.versions.length ?? 0) >= 1 && Object.keys(after.latestReviews).length >= 1, '详情聚合含版本与评审');
  }

  // 字段辅助端点:202 + 轮询取候选(mock 上游会收到 suggest 提示词→返回正文而非 JSON→重试后仍非 JSON→FAILED)
  // 这里只验证接线与错误可见性;suggest 的成功路径已在 test:ai-assist 覆盖
  {
    const assistRoute = await import('../web/app/api/admin/ai/assist/route');
    const res = await assistRoute.POST(req('/api/admin/ai/assist', {
      method: 'POST',
      body: JSON.stringify({ action: 'suggest', field: 'theme', count: 4 }),
    }), undefined as never);
    assertOk(res.status === 202, '字段辅助入队 → 202');
    const badBody = await assistRoute.POST(req('/api/admin/ai/assist', {
      method: 'POST',
      body: JSON.stringify({ action: 'hack', field: 'theme' }),
    }), undefined as never);
    assertOk(badBody.status === 400, '非法 action → 400');
  }

  void upstreamFail;
}

await main();
server.close();
console.log(failed === 0 ? '\n全部通过 ✓' : `\n${failed} 项失败 ✗`);
process.exit(failed === 0 ? 0 : 1);
