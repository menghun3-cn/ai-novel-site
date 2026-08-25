/**
 * V9 结构化输出层验证:干净 JSON、围栏包裹、坏输出重试自纠、重试耗尽抛错。
 *
 * 运行:npm run test:structured-output
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

process.env.NOVEL_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'novel-structured-output-'));

const { CoreError, createFakeProvider, completeStructured } = await import('@novel/core');

let failed = 0;

function assertOk(cond: boolean, name: string): void {
  if (cond) {
    console.log(`✓ ${name}`);
  } else {
    console.error(`✗ ${name}`);
    failed++;
  }
}

interface Demo {
  answer: number;
  note: string;
}

function parseDemo(obj: Record<string, unknown>, _raw: string): Demo {
  const answer = Number(obj.answer);
  if (!Number.isFinite(answer)) throw new Error('answer 不是数字');
  return { answer, note: typeof obj.note === 'string' ? obj.note : '' };
}

async function main(): Promise<void> {
  // 干净 JSON
  {
    const p = createFakeProvider(() => '{"answer": 42, "note": "ok"}');
    const r = await completeStructured(p as never, { prompt: 'q', schemaDescription: '{}' }, parseDemo);
    assertOk(r.data.answer === 42 && r.attempts === 1, '干净 JSON 一次成功');
    assertOk(p.calls[0].includes('只输出一个符合上述格式的 JSON 对象'), '提示词注入了输出格式约束');
  }

  // 围栏 + 前后杂文
  {
    const p = createFakeProvider(
      () => '好的,以下是结果:\n```json\n{"answer": 7, "note": "fenced"}\n```\n以上。'
    );
    const r = await completeStructured(p as never, { prompt: 'q', schemaDescription: '{}' }, parseDemo);
    assertOk(r.data.answer === 7 && r.data.note === 'fenced', '剥围栏并跳过前后杂文');
  }

  // 坏输出一次后自纠
  {
    let n = 0;
    const p = createFakeProvider(() => {
      n++;
      return n === 1 ? '抱歉我无法以 JSON 输出' : '{"answer": 1, "note": "fixed"}';
    });
    const r = await completeStructured(p as never, { prompt: 'q', schemaDescription: '{}' }, parseDemo);
    assertOk(r.attempts === 2 && r.data.note === 'fixed', '坏输出后带反馈重试成功');
    assertOk(p.calls[1].includes('上一次输出解析失败'), '重试请求包含上次的错误反馈');
  }

  // 校验失败也触发重试(字段缺失)
  {
    let n = 0;
    const p = createFakeProvider(() => {
      n++;
      return n === 1 ? '{"note": "no answer"}' : '{"answer": 3, "note": "ok"}';
    });
    const r = await completeStructured(p as never, { prompt: 'q', schemaDescription: '{}' }, parseDemo);
    assertOk(r.attempts === 2 && r.data.answer === 3, '校验不通过同样触发自纠重试');
  }

  // 重试耗尽
  {
    const p = createFakeProvider(() => '始终不是 JSON');
    try {
      await completeStructured(p as never, { prompt: 'q', schemaDescription: '{}' }, parseDemo);
      assertOk(false, '重试耗尽应抛错(未抛)');
    } catch (err) {
      const ok =
        err instanceof CoreError &&
        err.code === 'STRUCTURED_OUTPUT_FAILED' &&
        p.calls.length === 3;
      assertOk(ok, `重试耗尽抛 STRUCTURED_OUTPUT_FAILED(共调用 ${p.calls.length} 次)`);
    }
  }
}

await main();
console.log(failed === 0 ? '\n全部通过 ✓' : `\n${failed} 项失败 ✗`);
process.exit(failed === 0 ? 0 : 1);
