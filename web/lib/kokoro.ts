/**
 * Kokoro TTS 中文语音白名单(客户端/服务端共用,纯常量,无 Node 依赖)。
 * 服务端引擎逻辑在 kokoro-server.ts(TtsPlayer 不可引用,含 node:fs)。
 *
 * 语音 ID 与 kokoro-js-zh 的 VOICES 一致(zf_=女声/zm_=男声),
 * 对应模型 onnx-community/Kokoro-82M-v1.0-ONNX 的 voices/ 目录。
 */

export interface KokoroVoice {
  voiceURI: string;
  name: string;
  desc: string;
}

/** 中文语音白名单(8 个,与 v1.0-ONNX voices/ 目录一一对应) */
export const KOKORO_VOICES: KokoroVoice[] = [
  { voiceURI: 'zf_xiaoxiao', name: '小小(女)', desc: '中文女声' },
  { voiceURI: 'zf_xiaobei', name: '小北(女)', desc: '中文女声' },
  { voiceURI: 'zf_xiaoni', name: '小妮(女)', desc: '中文女声' },
  { voiceURI: 'zf_xiaoyi', name: '小伊(女)', desc: '中文女声' },
  { voiceURI: 'zm_yunjian', name: '云健(男)', desc: '中文男声' },
  { voiceURI: 'zm_yunxi', name: '云希(男)', desc: '中文男声' },
  { voiceURI: 'zm_yunxia', name: '云夏(男)', desc: '中文男声' },
  { voiceURI: 'zm_yunyang', name: '云扬(男)', desc: '中文男声' },
];

export const KOKORO_DEFAULT_VOICE = 'zf_xiaoxiao';
