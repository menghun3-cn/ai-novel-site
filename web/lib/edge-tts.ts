/**
 * Edge TTS(微软在线神经语音)免费接入:无需 API Key,走公共 WebSocket 端点合成 MP3。
 * 神经语音自带情感/韵律(非系统内置的机械音),路由封装在 /api/tts。
 * 本文件:语音白名单 + SSML 构建等纯函数(TtsPlayer 与 API 路由共用)。
 */

export interface EdgeVoice {
  voiceURI: string;
  /** 展示名 */
  name: string;
  /** 性别/风格说明 */
  desc: string;
}

/** 免费可用的中文神经语音白名单(路由侧校验只认这些) */
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

/** XML 转义(SSML 文本注入) */
export function escapeXml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

/** 语速 0.5..2 → SSML 百分比("+0%"/"+20%"/"-30%") */
export function edgeRatePercent(rate: number): string {
  const pct = Math.round((Math.max(0.5, Math.min(2, rate)) - 1) * 100);
  return `${pct >= 0 ? '+' : ''}${pct}%`;
}

/** 构建 Edge TTS SSML(神经语音 + 语速) */
export function buildEdgeSSML(text: string, voiceURI: string, rate: number): string {
  return (
    `<speak version='1.0' xmlns='http://www.w3.org/2001/10/synthesis' xml:lang='zh-CN'>` +
    `<voice name='${escapeXml(voiceURI)}'>` +
    `<prosody pitch='+0Hz' rate='${edgeRatePercent(rate)}' volume='+0%'>` +
    `${escapeXml(text)}` +
    `</prosody></voice></speak>`
  );
}
