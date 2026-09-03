#!/usr/bin/env node
/**
 * 构建时补齐 kokoro-js-zh 的 Node 端硬性文件(镜像内预下载,运行时由
 * web/lib/kokoro-server.ts 的 ensureRuntimeAssets() 兜底,二者幂等)。
 *
 * 背景:kokoro-js-zh 源码写死两个文件路径(见 .agents/notes/implemented/feature/
 * 2026-09-03-local-kokoro-tts.md):
 *   1) espeak-ng.wasm 必须位于 <pkg>/dist/espeak-ng.wasm —— npm 包漏发,
 *      需从 espeak-ng 依赖包复制,否则中文 G2P(zh-CN)启动即 Abort;
 *   2) 8 个中文语音 voices/*.bin 必须位于 <pkg>/voices/ —— Node 端不走远程。
 *
 * 用法(在 Dockerfile deps 阶段,WORKDIR=/app 下):
 *   node scripts/fetch-kokoro-voices.mjs [hfEndpoint]
 *   - hfEndpoint 缺省读 env KOKORO_HF_ENDPOINT,再缺省 https://hf-mirror.com
 *   - 下载失败只 WARN 不退出(运行时 ensureRuntimeAssets 会补下)
 *
 * 用独立文件而非 Dockerfile 内联 JS:Dockerfile 行尾续行(`\`)无法承载多行
 * 单引号脚本,内联会在 `const` 处触发 "unknown instruction" parse error。
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PKG_DIR = path.join(ROOT, 'node_modules', 'kokoro-js-zh');
const HF_ENDPOINT = (
  process.argv[2] ?? process.env.KOKORO_HF_ENDPOINT ?? 'https://hf-mirror.com'
).trim().replace(/\/+$/, '');

const MODEL_ID = 'onnx-community/Kokoro-82M-v1.0-ONNX';
/** 与 web/lib/kokoro.ts 白名单一致 */
const VOICES = [
  'zf_xiaoxiao', 'zf_xiaobei', 'zf_xiaoni', 'zf_xiaoyi',
  'zm_yunjian', 'zm_yunxi', 'zm_yunxia', 'zm_yunyang',
];
const TIMEOUT_MS = 60_000;

async function main() {
  if (!fs.existsSync(path.join(PKG_DIR, 'package.json'))) {
    console.error(`[kokoro-voices] 找不到 ${PKG_DIR}(kokoro-js-zh 未安装?),跳过。`);
    process.exit(0);
  }

  // 1) espeak-ng.wasm ← 从 espeak-ng 依赖包复制
  const wasmSrc = path.join(ROOT, 'node_modules', 'espeak-ng', 'dist', 'espeak-ng.wasm');
  const wasmDest = path.join(PKG_DIR, 'dist', 'espeak-ng.wasm');
  if (fs.existsSync(wasmSrc) && !fs.existsSync(wasmDest)) {
    fs.mkdirSync(path.dirname(wasmDest), { recursive: true });
    fs.copyFileSync(wasmSrc, wasmDest);
    console.log('[kokoro-voices] espeak-ng.wasm 已复制到', path.relative(ROOT, wasmDest));
  } else if (fs.existsSync(wasmDest)) {
    console.log('[kokoro-voices] espeak-ng.wasm 已存在,跳过');
  } else {
    console.warn('[kokoro-voices] WARN: 找不到 espeak-ng/dist/espeak-ng.wasm,中文 G2P 可能不可用(运行时 ensureRuntimeAssets 兜底)');
  }

  // 2) 8 个中文语音 voices/*.bin ← HF(默认 hf-mirror)
  const voicesDir = path.join(PKG_DIR, 'voices');
  fs.mkdirSync(voicesDir, { recursive: true });
  const base = `${HF_ENDPOINT}/${MODEL_ID}/resolve/main/voices/`;
  let failed = 0;
  for (const v of VOICES) {
    const dest = path.join(voicesDir, `${v}.bin`);
    if (fs.existsSync(dest) && fs.statSync(dest).size > 0) {
      console.log(`[kokoro-voices] ${v}.bin 已存在,跳过`);
      continue;
    }
    try {
      const r = await fetch(`${base}${v}.bin`, { signal: AbortSignal.timeout(TIMEOUT_MS) });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      fs.writeFileSync(dest, Buffer.from(await r.arrayBuffer()));
      console.log(`[kokoro-voices] ${v}.bin 下载完成 (${fs.statSync(dest).size} B)`);
    } catch (e) {
      failed++;
      console.warn(`[kokoro-voices] WARN: ${v}.bin 下载失败(${e.message}) — 运行时自动补下`);
    }
  }
  if (failed) {
    console.warn(`[kokoro-voices] WARN: ${failed} 个语音文件构建时未下载,首次合成时自动补齐(需容器可访问 HF)`);
  } else {
    console.log(`[kokoro-voices] ${VOICES.length} 个中文语音全部就绪`);
  }
}

main().catch((e) => {
  console.error('[kokoro-voices] 失败:', e);
  process.exit(1);
});
