// TTS 合成代理,双引擎:
// - edge(默认):Edge TTS(微软在线神经语音)免费代理:浏览器 → 本路由 → bing WebSocket → MP3。
//   神经语音带情感/韵律(晓晓/云希等),替代系统内置机械音;无需 API Key。
//   协议(2026-08 起 bing 要求,与 edge-tts 7.2+ 一致):
//   - URL 必须携带 Sec-MS-GEC / Sec-MS-GEC-Version 参数(仅放 header 会被 403);
//   - Sec-MS-GEC = sha256(5 分钟取整的 Windows 文件时间 tick 十进制串 + TrustedClientToken) 大写;
//   - 请求为带 `Path:` 头的文本帧:先 Path:speech.config,再 Path:ssml;
//   - 音频以二进制分片返回:2 字节大端头长度 + 头 + MP3 数据。
// - kokoro(本地):Kokoro TTS 82M 模型,镜像以 ENABLE_LOCAL_TTS=1 构建时可用,
//   模型走 KOKORO_MODEL_DIR 卷挂载(未挂载自动在线下载到缓存);返回 WAV。
//   依赖/模型不可用时路由返回 503,前端据此回退 Edge。
import crypto from 'node:crypto';
import { buildEdgeSSML, EDGE_VOICES } from '@/lib/edge-tts';
import { KOKORO_VOICES } from '@/lib/kokoro';
import {
  ensureRuntimeAssets,
  kokoroAvailable,
  kokoroModelDir,
  kokoroVoicesReady,
  synthesizeKokoro,
} from '@/lib/kokoro-server';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const TRUSTED_CLIENT_TOKEN = '6A5AA1D4EAFF4E9FB37E23D68491D6F4';
const WSS_URL = 'wss://speech.platform.bing.com/consumer/speech/synthesize/readaloud/edge/v1';
// 需与 Sec-MS-GEC 生成所用的 Chromium 版本匹配
const SEC_MS_GEC_VERSION = '1-143.0.3650.75';
const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/143.0.0.0 Safari/537.36 Edg/143.0.0.0';
const MAX_TEXT = 2000;
// kokoro 本地 CPU 合成:文本越长推理越慢(实测 200 字在低配 2 核机上可达分钟级),
// 超过 CF 免费版回源超时(~100s)即 502/524。前端 TtsPlayer 切片约 52 字/次,
// 300 字上限远高于实际请求,仅拦截手误/恶意长文本。
const KOKORO_MAX_TEXT = 300;
const TIMEOUT_MS = 15_000;
const WIN_EPOCH = 11644473600; // Unix(1970) 与 Windows(1601) 纪元的秒差
// TTS 出口代理(可选):服务器网络无法直连 bing 时(常见于国内网络)通过环境变量配置,如 http://user:pass@host:port
const EDGE_TTS_PROXY = (process.env.EDGE_TTS_PROXY ?? '').trim();

function sha256(s: string): string {
  return crypto.createHash('sha256').update(s).digest('hex');
}

/** Edge TTS 防盗链令牌(Sec-MS-GEC):5 分钟取整的 Windows 文件时间 tick(100ns)十进制串哈希,大写 */
function secMsGec(): string {
  let ticks = Math.floor(Date.now() / 1000) + WIN_EPOCH;
  ticks -= ticks % 300;
  ticks *= 10_000_000;
  return sha256(`${ticks}${TRUSTED_CLIENT_TOKEN}`).toUpperCase();
}

/** JS 风格 GMT 日期串,协议 X-Timestamp 头要求的格式 */
function jsDate(): string {
  const d = new Date();
  const mon = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'][d.getUTCMonth()];
  const dow = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][d.getUTCDay()];
  const p = (n: number): string => String(n).padStart(2, '0');
  return `${dow} ${mon} ${p(d.getUTCDate())} ${d.getUTCFullYear()} ${p(d.getUTCHours())}:${p(d.getUTCMinutes())}:${p(d.getUTCSeconds())} GMT+0000 (Coordinated Universal Time)`;
}

/** 解析音频分片:前 2 字节为元数据头长度,跳过 2+headerLen 后的字节即 MP3 数据 */
function parseAudioChunk(buf: ArrayBuffer): Buffer {
  const view = new DataView(buf);
  const headerLen = view.getUint16(0);
  return Buffer.from(buf.slice(2 + headerLen));
}

/** 调用 Edge TTS 合成整段文本,返回 MP3 Buffer */
async function synthesize(text: string, voice: string, rate: number): Promise<Buffer> {
  const gec = secMsGec();
  const muid = crypto.randomBytes(16).toString('hex').toUpperCase();
  const url =
    `${WSS_URL}?TrustedClientToken=${TRUSTED_CLIENT_TOKEN}` +
    `&ConnectionId=${crypto.randomUUID().replace(/-/g, '')}` +
    `&Sec-MS-GEC=${gec}&Sec-MS-GEC-Version=${SEC_MS_GEC_VERSION}`;
  // Node 22 全局 WebSocket(undici)支持 headers/proxy 选项;TS 的 DOM 声明只接受 protocols 参数,此处做类型收窄
  const wsInit = {
    headers: {
      'Accept-Encoding': 'gzip, deflate, br, zstd',
      'Accept-Language': 'en-US,en;q=0.9',
      Pragma: 'no-cache',
      'Cache-Control': 'no-cache',
      Origin: 'chrome-extension://jdiccldimpdaibmpdkjnbmckianbfold',
      'User-Agent': UA,
      'Sec-MS-GEC': gec,
      'Sec-MS-GEC-Version': SEC_MS_GEC_VERSION,
      Cookie: `muid=${muid};`,
    },
    ...(EDGE_TTS_PROXY ? { proxy: EDGE_TTS_PROXY } : {}),
  } as unknown as string[];
  const ws = new WebSocket(url, wsInit);
  ws.binaryType = 'arraybuffer';

  return new Promise<Buffer>((resolve, reject) => {
    const chunks: Buffer[] = [];
    let settled = false;
    const fail = (msg: string): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      try {
        ws.close();
      } catch {
        /* ignore */
      }
      reject(new Error(msg));
    };
    const done = (): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      try {
        ws.close();
      } catch {
        /* ignore */
      }
      const audio = Buffer.concat(chunks);
      if (audio.length === 0) reject(new Error('未收到语音数据'));
      else resolve(audio);
    };
    const timer = setTimeout(() => fail('语音合成超时,请稍后重试'), TIMEOUT_MS);

    ws.onopen = () => {
      // 请求帧:带 Path 头的文本帧(旧版 JSON 长度前缀帧已被 bing 弃用)
      const config = JSON.stringify({
        context: {
          synthesis: {
            audio: {
              metadataoptions: { sentenceBoundaryEnabled: 'false', wordBoundaryEnabled: 'false' },
              outputFormat: 'audio-24khz-48kbitrate-mono-mp3',
            },
          },
        },
      });
      ws.send(
        `X-Timestamp:${jsDate()}\r\n` +
          'Content-Type:application/json; charset=utf-8\r\n' +
          'Path:speech.config\r\n\r\n' +
          config +
          '\r\n'
      );
      ws.send(
        `X-RequestId:${crypto.randomUUID()}\r\n` +
          'Content-Type:application/ssml+xml\r\n' +
          `X-Timestamp:${jsDate()}Z\r\n` + // 协议要求的 Z 后缀(微软历史遗留)
          'Path:ssml\r\n\r\n' +
          buildEdgeSSML(text, voice, rate)
      );
    };

    ws.onmessage = (ev) => {
      const data = ev.data;
      if (typeof data === 'string') {
        // 文本帧:Path:turn.start / Path:response / Path:audio.metadata / Path:turn.end
        if (/Path:turn\.end/.test(data)) {
          done();
          return;
        }
        if (/Path:turn\.start/.test(data) && /"Error"/i.test(data)) {
          fail('Edge TTS 服务返回错误,请稍后重试');
        }
        return;
      }
      if (data instanceof ArrayBuffer) {
        const buf = Buffer.from(data);
        if (buf.length < 2) return;
        chunks.push(parseAudioChunk(data));
        return;
      }
      // Blob 兜底
      void (data as Blob).arrayBuffer().then((b) => {
        const buf = Buffer.from(b);
        if (buf.length >= 2) chunks.push(parseAudioChunk(b));
      });
    };

    ws.onerror = () => fail('无法连接 Edge TTS 服务(网络或防火墙限制)');
    ws.onclose = () => {
      clearTimeout(timer);
      if (!settled) done();
    };
  });
}

export async function POST(req: Request): Promise<Response> {
  let body: { text?: unknown; voice?: unknown; rate?: unknown; engine?: unknown };
  try {
    body = (await req.json()) as { text?: unknown; voice?: unknown; rate?: unknown; engine?: unknown };
  } catch {
    return Response.json({ error: '请求体不是合法 JSON' }, { status: 400 });
  }
  const text = typeof body.text === 'string' ? body.text.trim() : '';
  if (!text) return Response.json({ error: '缺少听书文本 text' }, { status: 400 });
  if (text.length > MAX_TEXT) {
    return Response.json({ error: `单次合成文本过长(≤${MAX_TEXT} 字)` }, { status: 400 });
  }
  const engine = body.engine === 'kokoro' ? 'kokoro' : 'edge';

  // kokoro 本地引擎:依赖/模型不可用 → 503(前端据 engine 回退 edge)
  if (engine === 'kokoro') {
    if (text.length > KOKORO_MAX_TEXT) {
      return Response.json({ error: `本地合成文本过长(≤${KOKORO_MAX_TEXT} 字)` }, { status: 400 });
    }
    if (!kokoroAvailable()) {
      return Response.json(
        {
          error:
            '本地语音引擎不可用:镜像未启用 ENABLE_LOCAL_TTS,或模型未挂载(KOKORO_MODEL_DIR 无 .onnx 文件)',
        },
        { status: 503 }
      );
    }
    const voice = typeof body.voice === 'string' ? body.voice : KOKORO_VOICES[0].voiceURI;
    if (!KOKORO_VOICES.some((v) => v.voiceURI === voice)) {
      return Response.json({ error: `未知语音: ${voice}` }, { status: 400 });
    }
    try {
      const audio = await synthesizeKokoro(text, voice);
      return new Response(new Uint8Array(audio), {
        headers: {
          'Content-Type': 'audio/wav',
          'Cache-Control': 'no-store',
          'Content-Length': String(audio.length),
        },
      });
    } catch (err) {
      return Response.json({ error: err instanceof Error ? err.message : '本地语音合成失败' }, { status: 502 });
    }
  }

  const voice = typeof body.voice === 'string' ? body.voice : EDGE_VOICES[0].voiceURI;
  if (!EDGE_VOICES.some((v) => v.voiceURI === voice)) {
    return Response.json({ error: `未知语音: ${voice}` }, { status: 400 });
  }
  const rate = typeof body.rate === 'number' && Number.isFinite(body.rate) ? body.rate : 1;
  try {
    const audio = await synthesize(text, voice, rate);
    return new Response(new Uint8Array(audio), {
      headers: {
        'Content-Type': 'audio/mpeg',
        // POST 动态合成:必须 no-store。
        // 曾标 public,max-age=3600 —— 移动端网络路径上的中间层(运营商代理/CDN 节点)
        // 见到"可缓存"的长时 POST 会拦截/改写,是手机端 502/fail-to-fetch(PC 正常)的诱因之一。
        'Cache-Control': 'no-store',
        'Content-Length': String(audio.length),
      },
    });
  } catch (err) {
    return Response.json({ error: err instanceof Error ? err.message : '语音合成失败' }, { status: 502 });
  }
}

/** 引擎状态查询:TtsPlayer 挂载时探测本地引擎可用性,决定是否展示 kokoro 选项 */
export async function GET(): Promise<Response> {
  let voicesReady = kokoroVoicesReady();
  if (kokoroAvailable() && !voicesReady) {
    // 语音文件缺失时先尝试补齐(espeak-ng.wasm + 8 个中文语音),再上报可用性
    try {
      await ensureRuntimeAssets();
      voicesReady = kokoroVoicesReady();
    } catch {
      /* 补齐失败视为不可用,edge 兜底 */
    }
  }
  return Response.json({
    // kokoro 优先:本地引擎是默认推荐(移动端网络中间层不会拦截本地合成)
    engines: [...(kokoroAvailable() && voicesReady ? (['kokoro'] as const) : []), 'edge', 'native'],
    kokoro: {
      available: kokoroAvailable() && voicesReady,
      modelDir: kokoroModelDir(),
      voices: KOKORO_VOICES,
    },
  });
}
