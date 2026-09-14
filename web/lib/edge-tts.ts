/**
 * Edge TTS（AI 情感听书）接入定义：语音白名单 + 上游服务常量（TtsPlayer 与 API 路由共用）。
 *
 * 合成走 OpenAI 兼容的 HTTP API（ai-edge-tts2api 部署在 Cloudflare Workers 上，
 * 把微软 Edge TTS 免费神经语音封装成 /v1/audio/speech）：
 *   POST https://edgetts2api.edgetts.workers.dev/v1/audio/speech
 *   Authorization: Bearer <API_KEY>
 *   请求体 {"model":"tts-1","input":"…","voice":"zh-CN-XiaoxiaoNeural","speed":1.0,"response_format":"mp3"}
 *   返回 audio/mpeg 音频字节。
 * 路由封装在 /api/tts（服务端持有 API Key，绝不下发到浏览器）。
 *
 * 本文件只放前端/路由共用的纯常量；合成逻辑在 web/app/api/tts/route.ts。
 */

export interface EdgeVoice {
  voiceURI: string;
  /** 展示名 */
  name: string;
  /** 性别/风格说明 */
  desc: string;
}

/** 中文神经语音白名单（上游也接受任意微软 Edge TTS 音色名，直接放 voice 字段即可） */
export const EDGE_VOICES: EdgeVoice[] = [
  { voiceURI: 'zh-CN-XiaoxiaoNeural', name: '晓晓(女·温柔)', desc: '自然温柔,情感细腻' },
  { voiceURI: 'zh-CN-XiaoyiNeural', name: '晓伊(女·活泼)', desc: '活泼亲切' },
  { voiceURI: 'zh-CN-XiaohanNeural', name: '晓涵(女·甜美)', desc: '甜美明亮' },
  { voiceURI: 'zh-CN-XiaomengNeural', name: '晓梦(女·柔和)', desc: '柔和舒缓' },
  { voiceURI: 'zh-CN-XiaomoNeural', name: '晓墨(女·知性)', desc: '知性沉稳,适合叙述' },
  { voiceURI: 'zh-CN-XiaoxuanNeural', name: '晓萱(女·温暖)', desc: '温暖有亲和力' },
  { voiceURI: 'zh-CN-XiaoyanNeural', name: '晓颜(女·成熟)', desc: '成熟自然' },
  { voiceURI: 'zh-CN-XiaoyouNeural', name: '晓悠(女·清新)', desc: '清新悦耳' },
  { voiceURI: 'zh-CN-XiaozhenNeural', name: '晓甄(女·抒情)', desc: '抒情真挚' },
  { voiceURI: 'zh-CN-XiaoshuangNeural', name: '晓双(童声)', desc: '儿童音色,适合童话' },
  { voiceURI: 'zh-CN-YunxiNeural', name: '云希(男·阳光)', desc: '阳光少年感' },
  { voiceURI: 'zh-CN-YunyangNeural', name: '云扬(男·新闻)', desc: '专业播报' },
  { voiceURI: 'zh-CN-YunfengNeural', name: '云枫(男·沉稳)', desc: '沉稳大气' },
  { voiceURI: 'zh-CN-YunhaoNeural', name: '云皓(男·磁性)', desc: '低音磁性' },
  { voiceURI: 'zh-CN-YunjianNeural', name: '云健(男·激情)', desc: '有张力' },
  { voiceURI: 'zh-CN-YunxiaNeural', name: '云夏(男·少年)', desc: '少年清朗' },
  { voiceURI: 'zh-CN-YunzeNeural', name: '云泽(男·温和)', desc: '温和自然' },
];

export const EDGE_DEFAULT_VOICE = 'zh-CN-XiaoxiaoNeural';
