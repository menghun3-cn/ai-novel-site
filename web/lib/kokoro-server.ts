/**
 * Kokoro TTS 本地中文引擎(kokoro-js-zh)——服务端专用。
 *
 * 技术栈(2026-06 验证可用):
 * - kokoro-js-zh(原版 kokoro-js 的中文 fork):VOICES 含 8 个中文语音(zf_/zm_),
 *   用 espeak-ng 的 zh-CN 做中文 G2P(原版 kokoro-js 只有英文语音,不可用);
 * - 模型:onnx-community/Kokoro-82M-v1.0-ONNX(基础模型,语音 embedding 在其 voices/ 目录);
 * - Node 端两个硬性文件要求(kokoro-js-zh 源码写死,无法配置):
 *   1) espeak-ng.wasm 必须位于 kokoro-js-zh/dist/(npm 包漏发,需从 espeak-ng 依赖复制);
 *   2) 语音文件必须位于 kokoro-js-zh/voices/{voice}.bin(Node 端不走远程)。
 *   二者由 ensureRuntimeAssets() 在首次加载前自动补齐(从 espeak-ng 包复制 / 从 HF 下载)。
 *
 * 与 Edge TTS(在线)互为回退:
 * - 镜像构建时 `--build-arg ENABLE_LOCAL_TTS=1` 才安装 kokoro-js-zh/onnxruntime-node
 *   (见 Dockerfile deps 阶段);未安装时本模块的动态 import 运行时解析失败,
 *   kokoroAvailable() 返回 false,路由自动回退 Edge,镜像体积与功能均不受影响。
 * - 模型权重不进镜像:优先用 `KOKORO_MODEL_DIR`(docker 卷挂载,如 /app/models/kokoro)
 *   加载本地 ONNX;未挂载时退到在线下载(缓存到 KOKORO_CACHE_DIR,默认容器 data 卷)。
 *
 * ⚠ 本文件含 node:fs 等 Node API,只允许服务端(API 路由)引用;
 *   客户端组件请从 kokoro.ts 只导入 KOKORO_VOICES / KOKORO_DEFAULT_VOICE。
 *
 * ⚠ 包路径探测禁止用 createRequire/require.resolve:Next.js 生产构建(webpack)
 *   会把 `createRequire(import.meta.url)` 编译成永远抛 MODULE_NOT_FOUND 的 stub
 *   (见 .next/server 产物中模块 17331),导致 kokoroInstalled() 恒为 false——
 *   本地 tsx 直跑正常、线上 Next 打包必挂。必须用 fs 从 cwd 向上探测 node_modules。
 */
import fs from 'node:fs';
import path from 'node:path';
import { KOKORO_VOICES } from './kokoro';

/** HuggingFace 上的 ONNX 量化模型(在线兜底时下载,语音 embedding 在其 voices/ 目录) */
const HF_MODEL_ID = 'onnx-community/Kokoro-82M-v1.0-ONNX';
/** q8 量化:体积 ~80MB,CPU 推理快,音质接近 fp32 */
const KOKORO_DTYPE = 'q8';

/**
 * 模型远端:默认走 hf-mirror(国内可直连);海外环境用
 * `KOKORO_HF_ENDPOINT=https://huggingface.co` 覆盖。
 * transformers.js 3.8 的 env.remoteHost 不读 HF_ENDPOINT 环境变量,必须代码内设置。
 */
const HF_ENDPOINT = (process.env.KOKORO_HF_ENDPOINT ?? 'https://hf-mirror.com').trim().replace(/\/+$/, '');

/** 依赖包名(kokoro-js-zh 是支持中文的 fork) */
const KOKORO_PKG = 'kokoro-js-zh';
/**
 * 包名引用必须用「变量 + webpackIgnore」而非字面量:
 * ENABLE_LOCAL_TTS=0 时这些包不在 node_modules,若 webpack 在构建期解析字面量
 * import 会直接 ModuleNotFoundError,连默认镜像都构建失败。
 * webpackIgnore 注释让 webpack 原样保留为运行时动态 import(编译产物中确为
 * `await import(F)` 形式,可正常工作)。
 */
const TRANSFORMERS_PKG = '@huggingface/transformers';

/** 中文语音文件名列表(与 kokoro.ts 白名单一致,需落到 kokoro-js-zh/voices/) */
const ZH_VOICE_FILES = KOKORO_VOICES.map((v) => `${v.voiceURI}.bin`);

/**
 * 从 cwd 向上逐级探测 node_modules/<pkg> 目录(返回含 package.json 的包根)。
 * 不用 require.resolve:webpack 生产构建会把 createRequire 编译成永远抛
 * MODULE_NOT_FOUND 的 stub(见文件头 ⚠),线上探测会恒失败。
 */
function findNodeModulesDir(pkgName: string): string | null {
  let dir = process.cwd();
  for (;;) {
    const candidate = path.join(dir, 'node_modules', pkgName);
    if (fs.existsSync(path.join(candidate, 'package.json'))) return candidate;
    const parent = path.dirname(dir);
    if (parent === dir) return null;
    dir = parent;
  }
}

/**
 * 定位 kokoro-js-zh 包根目录(可能 hoist 到根 node_modules 或 web/node_modules)。
 * 该包 exports 未暴露 ./package.json,故从入口文件路径推导(dist/ 的上级)。
 */
function kokoroPkgDir(): string | null {
  return findNodeModulesDir(KOKORO_PKG);
}

/** 语音文件是否就绪(Node 端 kokoro-js-zh 只读包内 voices/ 目录) */
export function kokoroVoicesReady(): boolean {
  const pkgDir = kokoroPkgDir();
  if (!pkgDir) return false;
  const voicesDir = path.join(pkgDir, 'voices');
  if (!fs.existsSync(voicesDir)) return false;
  try {
    return ZH_VOICE_FILES.every((f) => fs.existsSync(path.join(voicesDir, f)));
  } catch {
    return false;
  }
}

/**
 * 补齐 kokoro-js-zh 的两个缺失文件(Node 端硬性要求):
 * 1) espeak-ng.wasm ← 从 espeak-ng 依赖包复制(若缺失);
 * 2) voices/*.bin ← 从 HF 下载 8 个中文语音(若缺失)。
 * 仅当依赖已安装且文件缺失时触发;构建时未随镜像内置也能在容器内首次加载前补齐。
 */
export async function ensureRuntimeAssets(): Promise<void> {
  const pkgDir = kokoroPkgDir();
  if (!pkgDir) return;

  // espeak-ng.wasm:kokoro-js-zh dist 里没有,espeak-ng 依赖包里才有
  const wasmDest = path.join(pkgDir, 'dist', 'espeak-ng.wasm');
  if (!fs.existsSync(wasmDest)) {
    try {
      const espeakDir = findNodeModulesDir('espeak-ng');
      const wasmSrc = espeakDir ? path.join(espeakDir, 'dist', 'espeak-ng.wasm') : '';
      if (espeakDir && wasmSrc && fs.existsSync(wasmSrc)) {
        fs.mkdirSync(path.dirname(wasmDest), { recursive: true });
        fs.copyFileSync(wasmSrc, wasmDest);
      }
    } catch {
      /* 找不到源文件时静默,由 kokoroAvailable 判定不可用 */
    }
  }

  // 语音文件:Node 端只读包内 voices/ 目录,缺失则从 HF 下载
  if (!kokoroVoicesReady()) {
    const voicesDir = path.join(pkgDir, 'voices');
    fs.mkdirSync(voicesDir, { recursive: true });
    await Promise.all(
      ZH_VOICE_FILES.map(async (file) => {
        const dest = path.join(voicesDir, file);
        if (fs.existsSync(dest)) return;
        const url = `${HF_ENDPOINT}/${HF_MODEL_ID}/resolve/main/voices/${file}`;
        const res = await fetch(url);
        if (!res.ok) throw new Error(`语音文件下载失败(${res.status}): ${file}`);
        const buf = Buffer.from(await res.arrayBuffer());
        fs.writeFileSync(dest, buf);
      })
    );
  }
}

/**
 * 本地模型目录:存在且含 ONNX 权重才算就绪。
 * 兼容两种布局:v1.0 权重在目录根部(*.onnx),或 onnx/ 子目录(onnx/model.onnx 等)。
 * 卷挂载目录为空(宿主未放模型)→ 返回 null,路由回退在线下载/Edge。
 */
export function kokoroModelDir(): string | null {
  const dir = (process.env.KOKORO_MODEL_DIR ?? '').trim();
  if (!dir || !fs.existsSync(dir)) return null;
  try {
    const hasOnnx = (d: string): boolean => fs.readdirSync(d).some((f) => f.endsWith('.onnx'));
    if (hasOnnx(dir)) return dir;
    const onnxSub = path.join(dir, 'onnx');
    if (fs.existsSync(onnxSub) && hasOnnx(onnxSub)) return dir;
  } catch {
    /* ignore */
  }
  return null;
}

/** 依赖是否已安装(镜像以 ENABLE_LOCAL_TTS=1 构建时才有) */
export function kokoroInstalled(): boolean {
  return kokoroPkgDir() !== null;
}

/**
 * 引擎可用性:依赖已装 且 (有本地模型 或 允许在线下载到缓存)。
 * 语音文件/espeak-ng.wasm 属「运行时可自动补齐」资产(ensureRuntimeAssets),
 * 不在此判定——否则前端永不展示引擎、永远触发不了补齐,形成死锁。
 */
export function kokoroAvailable(): boolean {
  if (!kokoroInstalled()) return false;
  if (kokoroModelDir()) return true;
  // 未挂载模型:只要缓存目录可写就允许在线下载(容器 data 卷持久化)
  try {
    const cache = kokoroCacheDir();
    fs.mkdirSync(cache, { recursive: true });
    return true;
  } catch {
    return false;
  }
}

/** 在线模型缓存目录(默认容器 data 卷下,重启不丢) */
export function kokoroCacheDir(): string {
  const env = (process.env.KOKORO_CACHE_DIR ?? '').trim();
  if (env) return env;
  const dataDir = (process.env.NOVEL_DATA_DIR ?? '').trim();
  return dataDir ? path.join(dataDir, '.kokoro-cache') : path.join(process.cwd(), '.kokoro-cache');
}

/** 合成超时(本地 CPU 合成 200 字内一般 3~10s;上限 60s 兜底) */
const KOKORO_TIMEOUT_MS = 60_000;

/**
 * 合成互斥队列:onnxruntime CPU 推理是内存大户(82M 模型 + 中间张量),
 * 多个合成并发会把内存峰值叠加——低配 1.8G 主机直接触发 OOM/换页风暴,
 * 单请求合成被拖到几分钟(CF 回源超时 → 502/524)。
 * 用 promise 链把合成串行化:同一时刻只跑一个推理,后续请求排队。
 * 队列不因单次失败而断(错误只在调用方可见)。
 */
let synthesisQueue: Promise<unknown> = Promise.resolve();

/** 合成整段文本,返回 WAV Buffer(Content-Type: audio/wav) */
export function synthesizeKokoro(text: string, voice: string): Promise<Buffer> {
  const run = synthesisQueue.then(() => doSynthesize(text, voice));
  synthesisQueue = run.catch(() => undefined);
  return run;
}

async function doSynthesize(text: string, voice: string): Promise<Buffer> {
  const tts = await getTTS();
  const audio = (await Promise.race([
    tts.generate(text, { voice }),
    new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error('本地语音合成超时,请稍后重试')), KOKORO_TIMEOUT_MS)
    ),
  ])) as { audio: Float32Array; sampling_rate: number };
  if (!audio || !(audio.audio instanceof Float32Array) || audio.audio.length === 0) {
    throw new Error('本地语音合成未返回音频数据');
  }
  return float32ToWav(audio.audio, audio.sampling_rate || 24000);
}

interface KokoroTTS {
  generate: (text: string, opts: { voice: string }) => Promise<unknown>;
}

let ttsPromise: Promise<KokoroTTS> | null = null;

/** 懒加载 + 单例:首次调用补齐资产并初始化模型,失败清空以便重试 */
async function getTTS(): Promise<KokoroTTS> {
  if (!ttsPromise) {
    ttsPromise = (async () => {
      // 1) 补齐 espeak-ng.wasm + 中文语音文件(Node 端硬性要求)
      await ensureRuntimeAssets();
      // 2) 设 transformers.js 的下载远端(需在任何 from_pretrained 之前)
      const xf = (await import(/* webpackIgnore: true */ TRANSFORMERS_PKG)) as {
        env?: { remoteHost?: string };
      };
      if (xf.env) xf.env.remoteHost = HF_ENDPOINT;
      // 3) 加载 kokoro-js-zh(中文 fork)
      const mod = (await import(/* webpackIgnore: true */ KOKORO_PKG)) as {
        KokoroTTS: {
          from_pretrained: (modelId: string, opts: { dtype: string; device: string }) => Promise<KokoroTTS>;
        };
      };
      // 4) 有本地模型目录优先本地;否则在线下载到缓存
      const modelId = kokoroModelDir() ?? HF_MODEL_ID;
      return mod.KokoroTTS.from_pretrained(modelId, { dtype: KOKORO_DTYPE, device: 'cpu' });
    })().catch((err) => {
      ttsPromise = null;
      throw err;
    });
  }
  return ttsPromise;
}

/** Float32 PCM → 16bit 单声道 WAV Buffer(无第三方依赖) */
function float32ToWav(samples: Float32Array, sampleRate: number): Buffer {
  const numChannels = 1;
  const bitsPerSample = 16;
  const blockAlign = (numChannels * bitsPerSample) / 8;
  const byteRate = sampleRate * blockAlign;
  const dataSize = samples.length * blockAlign;
  const buf = Buffer.alloc(44 + dataSize);
  buf.write('RIFF', 0);
  buf.writeUInt32LE(36 + dataSize, 4);
  buf.write('WAVE', 8);
  buf.write('fmt ', 12);
  buf.writeUInt32LE(16, 16); // fmt 块大小
  buf.writeUInt16LE(1, 20); // PCM
  buf.writeUInt16LE(numChannels, 22);
  buf.writeUInt32LE(sampleRate, 24);
  buf.writeUInt32LE(byteRate, 28);
  buf.writeUInt16LE(blockAlign, 32);
  buf.writeUInt16LE(bitsPerSample, 34);
  buf.write('data', 36);
  buf.writeUInt32LE(dataSize, 40);
  for (let i = 0; i < samples.length; i++) {
    const s = Math.max(-1, Math.min(1, samples[i]));
    buf.writeInt16LE(s < 0 ? s * 0x8000 : s * 0x7fff, 44 + i * 2);
  }
  return buf;
}

/** 仅用于校验语音是否在白名单(路由层导入,保持单一数据源) */
export { KOKORO_VOICES };
