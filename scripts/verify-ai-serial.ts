/**
 * V5 AI 自动连载服务层验证:配置校验与虚拟默认、批量入队、流水线执行
 * (送审/自动发布/质检拒绝/上游失败)、日守卫幂等、停用书跳过、minChars 透传。
 *
 * 运行:npm run test:ai-serial
 */
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';

process.env.NOVEL_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'novel-serial-'));

const {
  CoreError,
  createBook,
  getChapterByNumber,
  listChapters,
  getAiSerialization,
  configureAiSerialization,
  enqueueGenerationJobs,
  processGenerationJobs,
  listGenerationJobs,
  runAiSerializationCycle,
  setLlmSettings,
} = await import('@novel/core');

let failed = 0;
function assertOk(cond: boolean, name: string): void {
  if (cond) {
    console.log(`✓ ${name}`);
  } else {
    console.error(`✗ ${name}`);
    failed++;
  }
}
async function assertThrows(code: string, fn: () => unknown | Promise<unknown>, name: string): Promise<void> {
  try {
    await fn();
    assertOk(false, `${name}(未抛错)`);
  } catch (err) {
    assertOk(err instanceof CoreError && err.code === code, name);
  }
}

// ---------- 配置 ----------
const serialA = createBook({ slug: 'serial-a', title: '连载之书A', authorName: '测', categoryName: '科幻', tags: [] });
{
  const b = serialA;
  const def = getAiSerialization(b.id);
  assertOk(!def.enabled && def.hour === 8 && def.count === 1 && !def.autoPublish && def.minChars === 500 && def.lastRunDate === null, '虚拟默认配置');

  const cfg = configureAiSerialization(b.id, { enabled: true, hour: 9, count: 3, autoPublish: false, minChars: 300 });
  assertOk(cfg.enabled && cfg.hour === 9 && cfg.count === 3 && cfg.minChars === 300, '保存连载配置');

  await assertThrows('INVALID_AI_SERIALIZATION', () => configureAiSerialization(b.id, { hour: 24 }), 'hour=24 → INVALID_AI_SERIALIZATION');
  await assertThrows('INVALID_AI_SERIALIZATION', () => configureAiSerialization(b.id, { count: 21 }), 'count=21 → 超上限');
  await assertThrows('INVALID_AI_SERIALIZATION', () => configureAiSerialization(b.id, { minChars: 100 }), 'minChars=100 → 超下限');
  await assertThrows('BOOK_NOT_FOUND', () => getAiSerialization('book_nope'), '书不存在 → BOOK_NOT_FOUND');
}

// ---------- 入队校验 ----------
{
  await assertThrows('BOOK_NOT_FOUND', () => enqueueGenerationJobs('book_nope', 1), '入队书不存在 → BOOK_NOT_FOUND');
}

// ---------- mock 上游(经后台设置存储取源) ----------
const server = http.createServer((req, res) => {
  if (req.method === 'GET' && req.url?.includes('/models')) {
    res.setHeader('content-type', 'application/json');
    res.end(JSON.stringify({ data: [{ id: 'text-embed-mock' }, { id: 'mock-chat' }] }));
    return;
  }
  let raw = '';
  req.on('data', (c) => (raw += c));
  req.on('end', () => {
    void raw;
    const bodyText = Array.from({ length: 40 }, (_, i) => `第${i}段:星河倾泻${i}号航道,舰桥灯光次第熄灭又亮起。`).join('');
    res.setHeader('content-type', 'application/json');
    res.end(JSON.stringify({ choices: [{ message: { content: `# 无题\n\n${bodyText}` } }] }));
  });
});
await new Promise<void>((res) => server.listen(0, '127.0.0.1', res));
const addr = server.address();
if (!addr || typeof addr === 'string') throw new Error('no port');
setLlmSettings({ baseUrl: `http://127.0.0.1:${addr.port}`, apiKey: 'test-key' });

const bookA = createBook({ slug: 'serial-b', title: '连载之书B', authorName: '测', categoryName: '科幻', tags: [] });
const bookB = createBook({ slug: 'serial-c', title: '连载之书C', authorName: '测', categoryName: '科幻', tags: [] });

// ---------- 送审模式(autoPublish=false) ----------
configureAiSerialization(bookA.id, { enabled: true, hour: 0, count: 2, autoPublish: false });
{
  const jobs = enqueueGenerationJobs(bookA.id, 2);
  assertOk(jobs.length === 2 && jobs.every((j) => j.status === 'pending'), '批量入队 2 个 pending');

  const r = await processGenerationJobs(10);
  assertOk(r.processed === 2, '处理 2 个任务');
  const after = listGenerationJobs(bookA.id);
  assertOk(after.every((j) => j.status === 'submitted' && j.chapterNumber !== null && j.model === 'mock-chat'), '全部 submitted 且记录章号与模型');
  assertOk(getChapterByNumber(bookA.id, 1)?.status === 'pending_review' && getChapterByNumber(bookA.id, 2)?.status === 'pending_review', '两章均进入审核队列(人工确认)');
}

// ---------- 自动发布模式(autoPublish=true) ----------
configureAiSerialization(bookA.id, { autoPublish: true, minChars: 20000 });
{
  // minChars=20000 → 必然 TOO_SHORT → rejected,不落稿
  enqueueGenerationJobs(bookA.id, 1);
  await processGenerationJobs(10);
  const rej = listGenerationJobs(bookA.id)[0];
  assertOk(rej.status === 'rejected' && rej.error?.includes('TOO_SHORT') && rej.chapterNumber === null, `minChars 透传:质检拒绝且零写入(${rej.error?.slice(0, 30)})`);

  configureAiSerialization(bookA.id, { minChars: 200 });
  enqueueGenerationJobs(bookA.id, 1);
  await processGenerationJobs(10);
  const pub = listGenerationJobs(bookA.id)[0];
  assertOk(pub.status === 'published' && pub.chapterNumber === 3, `autoPublish 直发(被拒不占号→第3章,实得 ${pub.status}#${pub.chapterNumber})`);
  assertOk(getChapterByNumber(bookA.id, 3)?.status === 'published', '章节状态为 published');
}

// ---------- 上游失败:任务标 failed 且不影响后续 ----------
{
  setLlmSettings({ baseUrl: 'http://127.0.0.1:9', apiKey: 'k' });
  enqueueGenerationJobs(bookB.id, 1);
  await processGenerationJobs(10);
  const f = listGenerationJobs(bookB.id)[0];
  assertOk(f.status === 'failed' && f.error?.startsWith('AI_PROVIDER_FAILED') && f.attempt === 1, '上游不可达 → failed 并记录错误');
  setLlmSettings({ baseUrl: `http://127.0.0.1:${addr.port}`, apiKey: 'test-key' });
  enqueueGenerationJobs(bookB.id, 1);
  await processGenerationJobs(10);
  assertOk(listGenerationJobs(bookB.id)[0].status === 'submitted', '恢复后下一任务正常');
}

// ---------- 日守卫幂等 + 时刻门槛 + 停用跳过 ----------
{
  // 隔离:第一本书(serialA)在配置块里启用过,先停用,保证本块只有 bookA/bookB 参与周期
  configureAiSerialization(serialA.id, { enabled: false });
  configureAiSerialization(bookA.id, { enabled: true, hour: 0, count: 2 });
  const before = listChapters(bookA.id).length;
  const c1 = await runAiSerializationCycle();
  assertOk(c1.booksTriggered === 1 && c1.enqueued === 2 && c1.processed === 2, `周期触发入队并处理(${c1.booksTriggered}/${c1.enqueued}/${c1.processed})`);
  const afterFirst = listChapters(bookA.id).length;
  assertOk(afterFirst - before === 2, '周期产出 2 章');

  const c2 = await runAiSerializationCycle();
  assertOk(c2.booksTriggered === 0 && c2.enqueued === 0 && c2.processed === 0, '同日重复周期零触发(日守卫)');

  // bookB 启用但 hour=23:今天 08 点未到时刻 → 不触发
  configureAiSerialization(bookB.id, { enabled: true, hour: 23, count: 1 });
  const today8 = new Date(new Date().getFullYear(), new Date().getMonth(), new Date().getDate(), 8);
  const c3 = await runAiSerializationCycle(today8);
  assertOk(c3.booksTriggered === 0, '未到每日时刻 → 不触发(hour=23 > 08)');

  // 次日 08 点:bookA(hour=0)合法再触发;bookB 仍被 hour=23 挡住
  const tomorrow8 = new Date(today8.getTime() + 86_400_000);
  const c4 = await runAiSerializationCycle(tomorrow8);
  assertOk(c4.booksTriggered === 1 && c4.enqueued === 2, `次日仅 bookA 触发(${c4.booksTriggered}/${c4.enqueued})`);

  // bookB 放开时刻:后日两本书都触发;bookB 走默认送审模式
  configureAiSerialization(bookB.id, { hour: 0 });
  const dayAfter = new Date(tomorrow8.getTime() + 86_400_000);
  const c5 = await runAiSerializationCycle(dayAfter);
  assertOk(c5.booksTriggered === 2 && getChapterByNumber(bookB.id, 2)?.status === 'pending_review', `后日两书都触发;bookB 产出待审第2章(${c5.booksTriggered})`);

  // 停用书跳过
  configureAiSerialization(bookA.id, { enabled: false });
  const d4 = new Date(dayAfter.getTime() + 86_400_000);
  const jobsABefore = listGenerationJobs(bookA.id).length;
  const c6 = await runAiSerializationCycle(d4);
  assertOk(c6.booksTriggered === 1 && c6.enqueued === 1, '停用的 bookA 不再触发,仅 bookB');
  assertOk(listGenerationJobs(bookA.id).length === jobsABefore, '停用的 bookA 零新任务');
}

// ---------- 收尾 ----------
server.close();
server.closeAllConnections();
console.log(failed === 0 ? '\nAI 自动连载全部验证通过' : `\n${failed} 项失败`);
process.exit(failed === 0 ? 0 : 1);
