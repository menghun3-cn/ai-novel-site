/**
 * 本地 Kokoro TTS(中文)引擎验证——本机 Node 或容器内均可运行:
 *   npm run test:tts-local
 *
 * 覆盖:
 * - 依赖探测:kokoro-js-zh 未安装(=0 镜像)时 kokoroAvailable()=false,edge 兜底路径成立;
 * - 资产补齐:espeak-ng.wasm + 8 个中文语音 voices/*.bin(ensureRuntimeAssets 自动下载);
 * - 模型探测:KOKORO_MODEL_DIR 挂载且含 .onnx → 就绪;
 * - 真实合成:中文文本合成一段 WAV,校验 RIFF 头与采样数(无第三方依赖)。
 *
 * 本机未装依赖时运行: npm install --no-save kokoro-js-zh onnxruntime-node
 * 模型自动下载到 KOKORO_CACHE_DIR(默认 <NOVEL_DATA_DIR>/.kokoro-cache),
 * 或先放入 KOKORO_MODEL_DIR(如 models/kokoro)跳过下载。
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  ensureRuntimeAssets,
  kokoroAvailable,
  kokoroInstalled,
  kokoroModelDir,
  kokoroVoicesReady,
  synthesizeKokoro,
} from '../web/lib/kokoro-server';
import { KOKORO_DEFAULT_VOICE, KOKORO_VOICES } from '../web/lib/kokoro';

async function main(): Promise<void> {
  const installed = kokoroInstalled();
  const modelDir = kokoroModelDir();
  console.log(`[tts-local] kokoro-js-zh 已安装 : ${installed}`);
  console.log(`[tts-local] 本地模型目录    : ${modelDir ?? '(未挂载,走在线下载)'}`);

  assert.ok(KOKORO_VOICES.length >= 8, `中文语音白名单应 ≥8 个,实际 ${KOKORO_VOICES.length}`);
  assert.ok(KOKORO_VOICES.some((v) => v.voiceURI === KOKORO_DEFAULT_VOICE), '默认语音应在白名单');
  assert.ok(KOKORO_VOICES.every((v) => /^z[fm]_/.test(v.voiceURI)), '白名单应全为中文语音(zf_/zm_)');
  console.log(`[tts-local] 语音白名单 ${KOKORO_VOICES.length} 个(纯中文),默认 ${KOKORO_DEFAULT_VOICE}`);

  if (!installed) {
    console.log('[tts-local] 未安装 kokoro-js-zh(ENABLE_LOCAL_TTS=0 镜像)→ 跳过合成,edge 兜底路径 OK');
    return;
  }

  // 补齐 espeak-ng.wasm + 中文语音文件
  await ensureRuntimeAssets();
  const voicesReady = kokoroVoicesReady();
  console.log(`[tts-local] 语音文件就绪   : ${voicesReady} (espeak-ng.wasm + voices/*.bin)`);
  if (!voicesReady) {
    console.log('[tts-local] 语音文件补齐失败(网络?),请检查 KOKORO_HF_ENDPOINT 或手动放置');
    process.exitCode = 1;
    return;
  }

  const available = kokoroAvailable();
  console.log(`[tts-local] kokoro 可用     : ${available}`);
  if (!available) {
    console.log('[tts-local] 依赖已装但模型不可用(缓存目录不可写?)→ 检查 KOKORO_CACHE_DIR');
    process.exitCode = 1;
    return;
  }

  const text = '这是本地语音引擎的中文合成验证。希望它读起来自然流畅。';
  const t0 = Date.now();
  const wav = await synthesizeKokoro(text, KOKORO_DEFAULT_VOICE);
  const ms = Date.now() - t0;

  assert.ok(wav.length > 44, `WAV 应大于 44 字节头,实际 ${wav.length}`);
  assert.equal(wav.toString('ascii', 0, 4), 'RIFF', 'WAV 必须以 RIFF 开头');
  assert.equal(wav.toString('ascii', 8, 12), 'WAVE', 'WAV 必须含 WAVE 标记');
  const sampleRate = wav.readUInt32LE(24);
  const dataSize = wav.readUInt32LE(40);
  const seconds = dataSize / 2 / sampleRate;
  assert.ok(sampleRate > 0 && dataSize > 0, 'WAV 采样率与数据长度应非零');
  assert.ok(seconds > 0.5, `合成时长应 > 0.5s,实际 ${seconds.toFixed(2)}s`);

  const out = path.join(os.tmpdir(), `tts-kokoro-${Date.now()}.wav`);
  fs.writeFileSync(out, wav);
  console.log(`[tts-local] 合成成功:${seconds.toFixed(2)}s / ${(wav.length / 1024).toFixed(1)}KB,耗时 ${ms}ms`);
  console.log(`[tts-local] 输出样例:${out}`);
}

main().catch((err) => {
  console.error('[tts-local] ✗ 验证失败:', err instanceof Error ? err.message : err);
  process.exit(1);
});
