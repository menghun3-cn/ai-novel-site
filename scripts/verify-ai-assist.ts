/**
 * V9 字段级 AI 辅助验证:suggest 多候选(JSON 校验+自纠重试)、generate 整段生成、
 * optimize 保意图改进、非法字段/缺值守卫。
 *
 * 运行:npm run test:ai-assist
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

process.env.NOVEL_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'novel-ai-assist-'));

const {
  CoreError,
  createAiTask,
  executeAssistTask,
  createFakeProvider,
  startAiTask,
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

async function main(): Promise<void> {
  // suggest:多候选
  {
    const task = createAiTask({
      type: 'AI_SUGGEST',
      refType: 'field_assist',
      input: { action: 'suggest', field: 'theme', count: 4, context: { genre: '爱情' } },
    });
    const p = createFakeProvider(() =>
      JSON.stringify({ options: ['十年后的雨夜重逢', '没有寄出的婚礼邀请函', 'AI时代的最后一封情书', '一场迟到了十年的告白'] })
    );
    const output = await executeAssistTask(task, { provider: p as never });
    const options = (output as { options?: string[] }).options ?? [];
    assertOk(options.length === 4 && options[0].includes('雨夜'), 'suggest 返回 4 条候选');
    assertOk(p.calls[0].includes('小说主题') && p.calls[0].includes('爱情'), '提示词含字段标签与上下文');
  }

  // suggest:候选不足时自纠重试
  {
    let n = 0;
    const p = createFakeProvider(() => {
      n++;
      return n === 1 ? '{"options": ["只有一条"]}' : '{"options": ["第一条", "第二条", "第三条"]}'; 
    });
    const output = await executeAssistTask(createAiTask({ type: 'AI_SUGGEST', input: { action: 'suggest', field: 'title' } }), {
      provider: p as never,
    });
    assertOk(n === 2 && ((output as { options?: string[] }).options?.length ?? 0) === 3, '候选不足触发重试自纠');
  }

  // generate:整段内容
  {
    const p = createFakeProvider(() => '十年后的雨夜,她在老车站的屋檐下认出了那把黑伞。');
    const output = await executeAssistTask(
      createAiTask({ type: 'AI_GENERATE', input: { action: 'generate', field: 'synopsis', context: { theme: '雨夜重逢' } } }),
      { provider: p as never }
    );
    assertOk(((output as { result?: string }).result ?? '').includes('黑伞'), 'generate 返回整段内容');
  }

  // generate:编辑弹窗专用 title(标题)/content(正文)生成分支
  {
    const pTitle = createFakeProvider(() => '雨夜重逢');
    const titleOut = await executeAssistTask(
      createAiTask({ type: 'AI_GENERATE', input: { action: 'generate', field: 'title', context: { theme: '雨夜重逢' } } }),
      { provider: pTitle as never }
    );
    assertOk(((titleOut as { result?: string }).result ?? '') === '雨夜重逢', 'generate title 返回标题');
    assertOk(pTitle.calls[0].includes('标题') && pTitle.calls[0].includes('25 字'), '标题生成提示词含「标题」标签与 ≤25 字要求');

    const pContent = createFakeProvider(() => '这是 AI 生成的完整短篇正文内容。'.repeat(30));
    const contentOut = await executeAssistTask(
      createAiTask({
        type: 'AI_GENERATE',
        input: { action: 'generate', field: 'content', context: { theme: '雨夜重逢', title: '雨夜重逢' } },
      }),
      { provider: pContent as never }
    );
    assertOk(((contentOut as { result?: string }).result ?? '').includes('完整短篇正文'), 'generate content 返回正文');
    assertOk(pContent.calls[0].includes('正文') && pContent.calls[0].includes('开端'), '正文生成提示词含「正文」标签与完整结构要求');
  }

  // optimize:保意图改进
  {
    const p = createFakeProvider(() => '优化后的梗概:保留了原意,但冲突更聚焦。');
    const output = await executeAssistTask(
      createAiTask({ type: 'AI_OPTIMIZE', input: { action: 'optimize', field: 'synopsis', value: '原始梗概内容' } }),
      { provider: p as never }
    );
    assertOk(((output as { result?: string }).result ?? '').includes('保留'), 'optimize 返回改进结果');
    assertOk(p.calls[0].includes('原始梗概内容'), '优化提示词包含当前值');
  }

  // 守卫:未知字段 / 缺当前值
  {
    await assertThrows(
      'INVALID_INPUT',
      () =>
        executeAssistTask(createAiTask({ type: 'AI_SUGGEST', input: { action: 'suggest', field: 'not_a_field' } }), {
          provider: createFakeProvider(() => '{}') as never,
        }),
      '未知字段 → INVALID_INPUT'
    );
    await assertThrows(
      'INVALID_INPUT',
      () =>
        executeAssistTask(createAiTask({ type: 'AI_OPTIMIZE', input: { action: 'optimize', field: 'theme' } }), {
          provider: createFakeProvider(() => 'x') as never,
        }),
      'optimize 缺当前值 → INVALID_INPUT'
    );
  }

  // 任务状态机配合:start 后执行成功 → complete 由 processAiTasks 负责;此处仅验证 start 记录模型
  {
    const task = createAiTask({ type: 'AI_GENERATE', input: { action: 'generate', field: 'characters' } });
    const started = startAiTask(task.id, { modelName: 'fake' });
    assertOk(started.status === 'RUNNING' && started.attempt === 1, '任务领取后 RUNNING 且 attempt+1');
  }
}

await main();
console.log(failed === 0 ? '\n全部通过 ✓' : `\n${failed} 项失败 ✗`);
process.exit(failed === 0 ? 0 : 1);
