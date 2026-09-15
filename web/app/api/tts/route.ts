// TTS 合成代理,单引擎:
// - edge(默认/唯一在线引擎):AI 情感听书 —— 微软 Edge TTS 经 ai-edge-tts2api
//   (Cloudflare Workers 上 OpenAI 兼容格式的封装)HTTP 代理合成 MP3:
//   浏览器 → 本路由 → 上游 POST /v1/audio/speech → audio/mpeg。
//   - 不再自连 bing WebSocket / 维护 Sec-MS-GEC 令牌;上游自动处理长文分块并发合成;
//   - 鉴权:请求头 Authorization: Bearer <EDGE_TTS_API_KEY>(密钥只存在服务端,不下发浏览器);
//   - 端点/密钥可用环境变量 EDGE_TTS_API_URL / EDGE_TTS_API_KEY 覆盖,默认线上部署地址与密钥。
//   - 默认端点为本项目自定义域名(edgetts2api.menghun3.cc,中国大陆可直连);
//     自托管 ai-edge-tts2api 时改用您自己的 Worker/CNAME 地址,或上游默认
//     https://edgetts2api.edgetts.workers.dev(注意 *.workers.dev 在部分受限网络不可达)。
// 历史:kokoro 本地引擎(V10.7 引入)已随 V10.8 移除,路由恢复单一 edge 引擎。
import { EDGE_VOICES } from '@/lib/edge-tts';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

// 上游(ai-edge-tts2api)配置:env 可覆盖,默认线上部署地址与 API Key
// (README:https://github.com/…/ai-edge-tts2api,部署方可随时 wrangler secret put API_KEY 更换)
const EDGE_TTS_API_URL =
  (process.env.EDGE_TTS_API_URL ?? '').trim() || 'https://edgetts2api.menghun3.cc/v1/audio/speech';
const EDGE_TTS_API_KEY =
  (process.env.EDGE_TTS_API_KEY ?? '').trim() || 'sk-BsnC0RfyuGMamQpD3HJjd9IwcoVOXFzWUrvL78AK';
// OpenAI 兼容模型名;请求体同时带 voice(微软音色名,优先级高于 model 映射,与 README 对照表一致)
const EDGE_MODEL = 'tts-1';
const MAX_TEXT = 2000;
// 上游单次合成超时(前端切片 ~52 字/次,上游无需分块,秒级返回;30s 足够覆盖网络抖动)
const EDGE_TIMEOUT_MS = 30_000;

/** 调用上游 OpenAI 兼容 TTS API 合成整段文本,返回 MP3 Buffer */
async function synthesizeEdge(text: string, voice: string, speed: number): Promise<Buffer> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), EDGE_TIMEOUT_MS);
  try {
    const res = await fetch(EDGE_TTS_API_URL, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${EDGE_TTS_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: EDGE_MODEL,
        input: text,
        voice,
        speed,
        response_format: 'mp3',
      }),
      signal: ctrl.signal,
    });
    if (!res.ok) {
      // 上游错误尽量透出具体信息(非 JSON 时用状态码兜底)
      let detail = '';
      try {
        const data = (await res.json()) as { error?: { message?: string } | string };
        detail = typeof data.error === 'string' ? data.error : (data.error?.message ?? '');
      } catch {
        /* 非 JSON(CF 兜底页),用状态码 */
      }
      if (res.status === 401) throw new Error('语音服务鉴权失败(401),请检查 EDGE_TTS_API_KEY');
      throw new Error(detail || `语音合成服务返回 ${res.status}`);
    }
    return Buffer.from(await res.arrayBuffer());
  } catch (err) {
    if (err instanceof Error && err.name === 'AbortError') throw new Error('语音合成超时,请稍后重试');
    if (err instanceof TypeError) throw new Error('无法连接语音合成服务(网络或防火墙限制)');
    throw err;
  } finally {
    clearTimeout(timer);
  }
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

  const voice = typeof body.voice === 'string' ? body.voice : EDGE_VOICES[0].voiceURI;
  if (!EDGE_VOICES.some((v) => v.voiceURI === voice)) {
    return Response.json({ error: `未知语音: ${voice}` }, { status: 400 });
  }
  // 语速 0.5..2(前端已钳制)直接映射上游 speed(支持 0.25~2.0)
  const speed = typeof body.rate === 'number' && Number.isFinite(body.rate) ? body.rate : 1;
  try {
    const audio = await synthesizeEdge(text, voice, speed);
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

/** 引擎状态查询(诊断/兼容;V10.8 起仅 edge + 浏览器 native,无本地引擎) */
export async function GET(): Promise<Response> {
  return Response.json({
    engines: ['edge', 'native'],
  });
}
