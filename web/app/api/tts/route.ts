// Edge TTS(微软在线神经语音)免费代理:浏览器 → 本路由 → bing WebSocket → MP3。
// 神经语音带情感/韵律(晓晓/云希等),替代系统内置机械音;无需 API Key。
// 协议与 edge-tts 兼容:2 字节大端长度前缀 + 负载;先 speech.config,再 SSML,音频以二进制分片返回。
import crypto from 'node:crypto';
import { buildEdgeSSML, EDGE_VOICES } from '@/lib/edge-tts';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const TRUSTED_CLIENT_TOKEN = '6A5AA1D4EAFF4E9FB37E23D68491D6F4';
const WSS_URL = 'wss://speech.platform.bing.com/consumer/speech/synthesize/readaloud/edge/v1';
const UA = 'edge-tts/6.1.9';
const MAX_TEXT = 2000;
const TIMEOUT_MS = 15_000;

function sha256(s: string): string {
  return crypto.createHash('sha256').update(s).digest('hex');
}

/** Edge TTS 防盗链令牌(Sec-MS-GEC):时间按 5 分钟粒度取整后哈希 */
function secMsGec(): string {
  const ticks = 621355968000000000;
  const now = Math.min(Date.now(), new Date(9999, 11, 31, 23, 59, 59, 999).getTime());
  const ticksNow = now * 10000 + ticks;
  const rounded = Math.round(ticksNow / 3000000000) * 3000000000;
  const tokenDate = new Date((rounded - ticks) / 10000);
  const msGec = tokenDate.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
  return sha256(msGec + TRUSTED_CLIENT_TOKEN);
}

/** 2 字节大端长度前缀 + 负载(Edge TTS 协议消息格式) */
function frame(payload: string | Uint8Array): Uint8Array {
  const data = typeof payload === 'string' ? Buffer.from(payload, 'utf8') : Buffer.from(payload);
  const out = Buffer.alloc(2 + data.length);
  out.writeUInt16BE(data.length, 0);
  data.copy(out, 2);
  return out;
}

/** 解析音频分片:前 2 字节为元数据头长度,跳过 2+headerLen 后的字节即 MP3 数据 */
function parseAudioChunk(buf: ArrayBuffer): Buffer {
  const view = new DataView(buf);
  const headerLen = view.getUint16(0);
  return Buffer.from(buf.slice(2 + headerLen));
}

/** 调用 Edge TTS 合成整段文本,返回 MP3 Buffer */
async function synthesize(text: string, voice: string, rate: number): Promise<Buffer> {
  const connectionId = crypto.randomUUID();
  // Node 22 全局 WebSocket(undici)支持 headers 选项;TS 的 DOM 声明只接受 protocols 参数,此处做类型收窄
  const wsInit = {
    headers: {
      'Accept-Encoding': 'gzip, deflate, br',
      Origin: 'chrome-extension://jdiccldimpdaibmpdkjnbmckianbfold',
      'Sec-MS-GEC': secMsGec(),
      'Sec-MS-GEC-Version': '1-130.0.2849.68',
      'User-Agent': UA,
      'X-Timestamp': new Date().toISOString(),
    },
  } as unknown as string[];
  const ws = new WebSocket(
    `${WSS_URL}?TrustedClientToken=${TRUSTED_CLIENT_TOKEN}&ConnectionId=${connectionId}`,
    wsInit
  );
  ws.binaryType = 'arraybuffer';

  return new Promise<Buffer>((resolve, reject) => {
    const chunks: Buffer[] = [];
    let settled = false;
    const fail = (msg: string): void => {
      if (settled) return;
      settled = true;
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
      ws.send(frame(config));
      ws.send(frame(buildEdgeSSML(text, voice, rate)));
    };

    ws.onmessage = (ev) => {
      const data = ev.data;
      if (typeof data === 'string') {
        // 文本消息:turn.start / response / turn.end 等元数据;出错时文本里含 error 字段
        try {
          const msg = JSON.parse(data) as { type?: string; message?: string };
          if (msg.type === 'error' || (msg.type === 'turn.start' && /error/i.test(msg.message ?? ''))) {
            fail(msg.message || 'Edge TTS 服务返回错误');
          }
        } catch {
          /* 忽略非 JSON 文本 */
        }
        return;
      }
      if (data instanceof ArrayBuffer) {
        chunks.push(parseAudioChunk(data));
        return;
      }
      // Blob 兜底
      void (data as Blob).arrayBuffer().then((buf) => chunks.push(parseAudioChunk(buf)));
    };

    ws.onerror = () => fail('无法连接 Edge TTS 服务(网络或防火墙限制)');
    ws.onclose = () => {
      clearTimeout(timer);
      if (!settled) done();
    };
  });
}

export async function POST(req: Request): Promise<Response> {
  let body: { text?: unknown; voice?: unknown; rate?: unknown };
  try {
    body = (await req.json()) as { text?: unknown; voice?: unknown; rate?: unknown };
  } catch {
    return Response.json({ error: '请求体不是合法 JSON' }, { status: 400 });
  }
  const text = typeof body.text === 'string' ? body.text.trim() : '';
  if (!text) return Response.json({ error: '缺少朗读文本 text' }, { status: 400 });
  if (text.length > MAX_TEXT) {
    return Response.json({ error: `单次合成文本过长(≤${MAX_TEXT} 字)` }, { status: 400 });
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
        'Cache-Control': 'public, max-age=3600',
      },
    });
  } catch (err) {
    return Response.json({ error: err instanceof Error ? err.message : '语音合成失败' }, { status: 502 });
  }
}
