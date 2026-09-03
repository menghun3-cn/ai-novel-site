'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { detectIOS, maxChunkLength, splitIntoChunks } from '@/lib/tts';
import { EDGE_DEFAULT_VOICE, EDGE_VOICES } from '@/lib/edge-tts';
import { KOKORO_DEFAULT_VOICE, KOKORO_VOICES } from '@/lib/kokoro';

const KEY_RATE = 'novel:tts:rate';
const KEY_VOICE = 'novel:tts:voiceURI';
const KEY_ENGINE = 'novel:tts:engine';
const KEY_EDGE_VOICE = 'novel:tts:edgeVoice';
const KEY_KOKORO_VOICE = 'novel:tts:kokoroVoice';
const DEFAULT_RATE = 1;
/** AI 朗读预取片数:播放到第 i 片时提前合成好 i+1、i+2,避免播完一片再等合成 */
const PREFETCH_COUNT = 2;

type Engine = 'native' | 'edge' | 'kokoro';

interface SpeechVoiceLite {
  voiceURI: string;
  name: string;
  lang: string;
}

/** 一个朗读单元:段落按句切片后的最小播放块,el 用于高亮定位 */
interface SpeakUnit {
  el: HTMLElement;
  text: string;
  paraIndex: number;
}

/**
 * 段落切片:把目标容器内的 <p> 文本顺序取出
 * 跳过空段落(避免空白停顿)
 */
function collectParagraphs(container: HTMLElement | null): HTMLElement[] {
  if (!container) return [];
  const ps = Array.from(container.querySelectorAll<HTMLElement>('p'));
  return ps.filter((p) => (p.textContent ?? '').trim().length > 0);
}

/**
 * 语音朗读:双引擎。
 * - native(系统语音):Web Speech API,零依赖;语音列表加载失败时会给出可操作提示 + 手动重试;
 * - edge(AI 情感朗读):免费 Edge 神经语音(/api/tts 代理合成 MP3),情感/韵律自然,
 *   不依赖系统语音列表,移动端同样可用。
 * 移动端适配:
 * - 首次播放在用户手势内做静音预热解锁(native);
 * - iOS 的 pause/resume 不可靠,改用「取消式暂停」:cancel 并保留进度,恢复时从当前片重说;
 * - 段落按句切成随语速动态定长的小片,规避安卓 Chrome 对单条超长朗读的静音截断。
 * 偏好(语速/voiceURI/引擎)持久化在 localStorage。
 */

export default function TtsPlayer({ contentSelector }: { contentSelector: string }) {
  const [supported, setSupported] = useState(false);
  const [voices, setVoices] = useState<SpeechVoiceLite[]>([]);
  const [voiceURI, setVoiceURI] = useState<string>('');
  const [rate, setRate] = useState<number>(DEFAULT_RATE);
  const [isPlaying, setIsPlaying] = useState(false);
  const [paused, setPaused] = useState(false);
  const [activePara, setActivePara] = useState<number>(-1);
  const [paraTotal, setParaTotal] = useState<number>(0);
  // 引擎 + AI 语音选择(默认 AI 情感朗读,规避系统语音缺失)
  const [engine, setEngine] = useState<Engine>('edge');
  const [edgeVoice, setEdgeVoice] = useState<string>(EDGE_DEFAULT_VOICE);
  const [kokoroVoice, setKokoroVoice] = useState<string>(KOKORO_DEFAULT_VOICE);
  // 本地 Kokoro 引擎可用性(由 /api/tts 探测,挂载模型后自动出现)
  const [kokoroOk, setKokoroOk] = useState(false);
  // 错误/加载提示(native 语音列表为空 / edge 合成失败均可见)
  const [ttsError, setTtsError] = useState<string | null>(null);
  const [edgeBusy, setEdgeBusy] = useState(false);
  /** 手动重试语音列表的触发计数 */
  const [voiceRetry, setVoiceRetry] = useState(0);

  const unitsRef = useRef<SpeakUnit[]>([]);
  const parasRef = useRef<HTMLElement[]>([]);
  // 当前朗读单元下标(iOS 取消式暂停后由此恢复)
  const idxRef = useRef<number>(-1);
  const playingRef = useRef(false);
  const warmedRef = useRef(false);
  const iosRef = useRef(false);
  const savedVoiceRef = useRef('');
  // edge 队列:当前播放音频 + 队列游标
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const edgeQueueRef = useRef<SpeakUnit[]>([]);
  const edgeIdxRef = useRef(-1);
  const edgeActiveRef = useRef(false);
  /** 预取缓冲:下标 → 已合成好的 MP3(url + audio),供后续段落无缝接力 */
  const edgeBuffersRef = useRef<Map<number, { url: string; audio: HTMLAudioElement }>>(new Map());

  // 支持检测 + native 语音列表加载。
  // 移动端 getVoices() 首次常为空且 voiceschanged 可能不触发:轮询 + 回前台兜底 + 手动重试。
  useEffect(() => {
    if (typeof window === 'undefined' || !('speechSynthesis' in window)) {
      setTtsError('当前浏览器不支持系统语音听书;可改用「AI 情感听书」');
      return;
    }
    setSupported(true);
    setTtsError(null);
    iosRef.current = detectIOS();
    const synth = window.speechSynthesis;
    const refresh = (): boolean => {
      const list = synth.getVoices();
      if (list.length === 0) return false;
      setVoices(list.map((v) => ({ voiceURI: v.voiceURI, name: v.name, lang: v.lang })));
      return true;
    };
    refresh();
    const onVoicesChanged = () => refresh();
    synth.addEventListener('voiceschanged', onVoicesChanged);
    let tries = 0;
    const timer = window.setInterval(() => {
      tries += 1;
      if (refresh() || tries >= 25) window.clearInterval(timer);
    }, 400);
    const onVisible = () => {
      if (document.visibilityState === 'visible') refresh();
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      synth.removeEventListener('voiceschanged', onVoicesChanged);
      window.clearInterval(timer);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [voiceRetry]);

  // 加载偏好(voice 偏好先存 ref,等语音列表就绪后再校验生效)
  useEffect(() => {
    try {
      const r = Number(localStorage.getItem(KEY_RATE));
      if (r >= 0.5 && r <= 2) setRate(r);
      savedVoiceRef.current = localStorage.getItem(KEY_VOICE) ?? '';
      const e = localStorage.getItem(KEY_ENGINE);
      if (e === 'native' || e === 'edge' || e === 'kokoro') setEngine(e);
      const ev = localStorage.getItem(KEY_EDGE_VOICE);
      if (ev && EDGE_VOICES.some((v) => v.voiceURI === ev)) setEdgeVoice(ev);
      const kv = localStorage.getItem(KEY_KOKORO_VOICE);
      if (kv && KOKORO_VOICES.some((v) => v.voiceURI === kv)) setKokoroVoice(kv);
    } catch {
      /* ignore */
    }
  }, []);

  // 探测本地 Kokoro 引擎可用性:镜像启用 ENABLE_LOCAL_TTS 且模型已挂载才出现该选项
  useEffect(() => {
    let alive = true;
    fetch('/api/tts', { method: 'GET' })
      .then((res) => (res.ok ? res.json() : null))
      .then((data: { kokoro?: { available?: boolean } } | null) => {
        if (alive) setKokoroOk(Boolean(data?.kokoro?.available));
      })
      .catch(() => {
        /* 探测失败视为不可用,edge 兜底 */
      });
    return () => {
      alive = false;
    };
  }, []);

  // 语音列表就绪后解析生效语音:已选且存在 → 保留;否则用保存的偏好;再否则自动选第一个中文语音
  // (移动端「系统默认」语音可能读不了中文,自动选中可避免默认引擎无声/乱读)
  useEffect(() => {
    if (voices.length === 0) return;
    setVoiceURI((prev) => {
      if (prev && voices.some((v) => v.voiceURI === prev)) return prev;
      const saved = savedVoiceRef.current;
      if (saved && voices.some((v) => v.voiceURI === saved)) return saved;
      const zh = voices.find((v) => /^zh/i.test(v.lang));
      return zh ? zh.voiceURI : '';
    });
  }, [voices]);

  const stop = useCallback(() => {
    if (typeof window !== 'undefined' && 'speechSynthesis' in window) {
      window.speechSynthesis.cancel();
    }
    // edge 队列清理
    edgeActiveRef.current = false;
    if (audioRef.current) {
      try {
        audioRef.current.pause();
        audioRef.current.src = '';
      } catch {
        /* ignore */
      }
      audioRef.current = null;
    }
    edgeQueueRef.current = [];
    edgeIdxRef.current = -1;
    // 释放预取缓冲的 objectURL 与 audio
    for (const b of edgeBuffersRef.current.values()) {
      try {
        b.audio.pause();
        b.audio.src = '';
      } catch {
        /* ignore */
      }
      URL.revokeObjectURL(b.url);
    }
    edgeBuffersRef.current = new Map();
    playingRef.current = false;
    setIsPlaying(false);
    setPaused(false);
    setActivePara(-1);
    setEdgeBusy(false);
    unitsRef.current = [];
    parasRef.current = [];
  }, []);

  // ---------- native 引擎 ----------

  const speakUnit = useCallback(
    (i: number) => {
      if (!playingRef.current || engine !== 'native') return;
      const units = unitsRef.current;
      if (i < 0 || i >= units.length) {
        stop();
        return;
      }
      const unit = units[i];
      idxRef.current = i;
      setActivePara(unit.paraIndex);
      const u = new SpeechSynthesisUtterance(unit.text);
      const native = window.speechSynthesis.getVoices().find((v) => v.voiceURI === voiceURI);
      if (native) {
        u.voice = native;
        u.lang = native.lang;
      } else {
        u.lang = 'zh-CN';
      }
      u.rate = rate;
      u.onend = () => {
        if (!playingRef.current) return;
        speakUnit(i + 1);
      };
      u.onerror = (ev) => {
        // canceled/interrupted 是主动 cancel() 的正常伴生事件;其余错误才中断播放
        if (!playingRef.current || ev.error === 'canceled' || ev.error === 'interrupted') return;
        console.warn('[TTS] 朗读出错:', ev.error);
        setTtsError('系统语音听书出错,可切换「AI 情感听书」');
        stop();
      };
      window.speechSynthesis.speak(u);
    },
    [voices, voiceURI, rate, stop, engine]
  );

  const startNative = useCallback(() => {
    if (typeof window === 'undefined' || !supported) return;
    const synth = window.speechSynthesis;
    if (!warmedRef.current) {
      // 首次播放前的手势内解锁:静音 utterance 预热 + resume()/cancel() 清掉卡住的暂停态
      warmedRef.current = true;
      try {
        const warm = new SpeechSynthesisUtterance('');
        warm.volume = 0;
        synth.resume();
        synth.speak(warm);
        synth.cancel();
      } catch {
        /* ignore */
      }
      // iOS 在第一次 speak 之后才填充语音列表,趁手势内再取一次
      const list = synth.getVoices();
      if (list.length > 0) {
        setVoices(list.map((v) => ({ voiceURI: v.voiceURI, name: v.name, lang: v.lang })));
      }
    } else {
      synth.cancel();
    }
    const container = document.querySelector<HTMLElement>(contentSelector);
    const paras = collectParagraphs(container);
    if (paras.length === 0) return;
    const maxLen = maxChunkLength(rate);
    const units: SpeakUnit[] = [];
    paras.forEach((el, pi) => {
      for (const chunk of splitIntoChunks((el.textContent ?? '').trim(), maxLen)) {
        units.push({ el, text: chunk, paraIndex: pi });
      }
    });
    if (units.length === 0) return;
    unitsRef.current = units;
    parasRef.current = paras;
    setParaTotal(paras.length);
    playingRef.current = true;
    setIsPlaying(true);
    setPaused(false);
    speakUnit(0);
  }, [supported, rate, contentSelector, speakUnit]);

  // ---------- edge 引擎(AI 情感朗读) ----------

  /** 把容器段落切成朗读单元(与 native 共用) */
  const buildEdgeUnits = useCallback((): SpeakUnit[] => {
    const container = document.querySelector<HTMLElement>(contentSelector);
    const paras = collectParagraphs(container);
    if (paras.length === 0) return [];
    const maxLen = maxChunkLength(rate);
    const units: SpeakUnit[] = [];
    paras.forEach((el, pi) => {
      for (const chunk of splitIntoChunks((el.textContent ?? '').trim(), maxLen)) {
        units.push({ el, text: chunk, paraIndex: pi });
      }
    });
    parasRef.current = paras;
    return units;
  }, [contentSelector, rate]);

  /** 合成单个朗读单元为 MP3/WAV(objectURL + audio 元素);瞬时失败(5xx/网络中断)自动重试 2 次 */
  const fetchEdgeAudio = useCallback(
    async (unit: SpeakUnit): Promise<{ url: string; audio: HTMLAudioElement }> => {
      const isKokoro = engine === 'kokoro';
      const body = JSON.stringify({
        text: unit.text,
        voice: isKokoro ? kokoroVoice : edgeVoice,
        rate,
        engine: isKokoro ? 'kokoro' : 'edge',
      });
      let lastErr: unknown;
      for (let attempt = 0; attempt <= 2; attempt++) {
        if (attempt > 0) await new Promise((r) => setTimeout(r, 600 * attempt));
        try {
          // 20s 超时:服务端合成 15s 上限 + 缓冲。移动端中间层挂死不返回时快速失败进重试
          const ctrl = new AbortController();
          const t = setTimeout(() => ctrl.abort(), 20_000);
          let res: Response;
          try {
            res = await fetch('/api/tts', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body,
              signal: ctrl.signal,
            });
          } finally {
            clearTimeout(t);
          }
          if (!res.ok) {
            const data = (await res.json().catch(() => null)) as { error?: string } | null;
            lastErr = new Error(data?.error ?? `语音合成失败(${res.status})`);
            // 4xx 为请求本身有问题,重试无意义;503 为本地引擎未就绪(edge 不受影响)
            if (res.status < 500) throw lastErr;
            continue; // 5xx:服务端合成波动,重试
          }
          const blob = await res.blob();
          const url = URL.createObjectURL(blob);
          const audio = new Audio(url);
          return { url, audio };
        } catch (err) {
          if (err instanceof Error && err.message.includes('语音合成失败(4')) throw err;
          lastErr = err; // TypeError(fail to fetch)/5xx/断网:重试
        }
      }
      let msg =
        lastErr instanceof DOMException && lastErr.name === 'AbortError'
          ? '语音合成请求超时,请重试或切换「系统语音」'
          : lastErr instanceof TypeError
            ? '网络连接中断,无法访问语音服务,请检查网络后重试'
            : lastErr instanceof Error
              ? lastErr.message
              : 'AI 语音合成失败';
      // 服务器无法连通 Edge TTS(未配置 EDGE_TTS_PROXY 或出口受限)时的可操作提示
      if (msg.includes('Edge TTS 服务')) msg = `${msg};可先改用「系统语音」,或稍后重试`;
      throw new Error(msg);
    },
    [edgeVoice, kokoroVoice, rate, engine]
  );

  /**
   * 预取工作者:始终在播放线程之外提前合成「当前 + 1、当前 + 2」两片(默认 2 片),
   * 让后续段落播放时无需等待网络合成,实现丝滑接力。
   * 连续失败 2 次即放弃预取(由播放线程兜底报错),避免坏网络下空转。
   */
  const prefetchEdge = useCallback(
    async (from: number, uptoExclusive: number) => {
      let fails = 0;
      for (let i = from; i < uptoExclusive; i++) {
        if (!edgeActiveRef.current || edgeBuffersRef.current.has(i)) continue;
        const unit = edgeQueueRef.current[i];
        if (!unit) break;
        try {
          const buf = await fetchEdgeAudio(unit);
          if (!edgeActiveRef.current) {
            buf.audio.pause();
            URL.revokeObjectURL(buf.url);
            return;
          }
          edgeBuffersRef.current.set(i, buf);
          fails = 0;
        } catch {
          fails += 1;
          if (fails >= 2) return; // 连续失败:交给播放线程重试/报错
        }
      }
    },
    [fetchEdgeAudio]
  );

  /** 顺序播放第 i 片:优先用预取缓冲(零等待),否则现场合成 → 播放 → onended 播下一片 */
  const playEdgeChunk = useCallback(
    async (i: number) => {
      if (!edgeActiveRef.current || engine === 'native') return;
      const units = edgeQueueRef.current;
      if (i < 0 || i >= units.length) {
        stop();
        return;
      }
      edgeIdxRef.current = i;
      setActivePara(units[i].paraIndex);
      setTtsError(null);
      // 预取窗口:当前 + PREFETCH_COUNT 片
      void prefetchEdge(i + 1, i + 1 + PREFETCH_COUNT);
      let buf = edgeBuffersRef.current.get(i);
      if (!buf) {
        // 无缓冲(首片或预取落后):现场合成,期间显示"正在合成"
        setEdgeBusy(true);
        try {
          buf = await fetchEdgeAudio(units[i]);
        } catch (err) {
          setEdgeBusy(false);
          if (edgeActiveRef.current) {
            setTtsError(err instanceof Error ? err.message : 'AI 语音合成失败');
            stop();
          }
          return;
        }
        if (!edgeActiveRef.current) {
          buf.audio.pause();
          URL.revokeObjectURL(buf.url);
          return;
        }
        edgeBuffersRef.current.set(i, buf);
        setEdgeBusy(false);
      }
      const audio = buf.audio;
      audioRef.current = audio;
      audio.onended = () => {
        URL.revokeObjectURL(buf!.url);
        edgeBuffersRef.current.delete(i);
        if (edgeActiveRef.current) void playEdgeChunk(i + 1);
      };
      audio.onerror = () => {
        URL.revokeObjectURL(buf!.url);
        edgeBuffersRef.current.delete(i);
        if (edgeActiveRef.current) {
          setTtsError('音频播放失败,请重试或切换「系统语音」');
          stop();
        }
      };
      try {
        await audio.play();
      } catch (err) {
        URL.revokeObjectURL(buf!.url);
        edgeBuffersRef.current.delete(i);
        if (edgeActiveRef.current) {
          // 移动端常见:非手势内 play() 被拒(AbortError/NotAllowedError)
          const msg =
            err instanceof DOMException && (err.name === 'NotAllowedError' || err.name === 'AbortError')
              ? '浏览器拦截了自动播放:请点「继续」重试,或改用「系统语音」'
              : '音频播放失败,请重试或切换「系统语音」';
          setTtsError(msg);
          stop();
        }
      }
    },
    [edgeVoice, rate, stop, engine, fetchEdgeAudio, prefetchEdge]
  );

  const startEdge = useCallback(() => {
    const units = buildEdgeUnits();
    if (units.length === 0) {
      setTtsError('未找到可听书的正文内容');
      return;
    }
    edgeQueueRef.current = units;
    edgeIdxRef.current = 0;
    setParaTotal(units.reduce((max, u) => Math.max(max, u.paraIndex), -1) + 1);
    edgeActiveRef.current = true;
    setIsPlaying(true);
    setPaused(false);
    void playEdgeChunk(0);
  }, [buildEdgeUnits, playEdgeChunk]);

  // ---------- 统一入口 ----------

  const play = useCallback(() => {
    setTtsError(null);
    // 暂停恢复
    if (paused) {
      if (engine === 'native' && unitsRef.current.length > 0) {
        if (iosRef.current) {
          playingRef.current = true;
          setIsPlaying(true);
          setPaused(false);
          speakUnit(idxRef.current);
        } else {
          window.speechSynthesis.resume();
          setIsPlaying(true);
          setPaused(false);
        }
        return;
      }
      if (engine !== 'native' && audioRef.current) {
        void audioRef.current.play();
        setIsPlaying(true);
        setPaused(false);
        return;
      }
    }
    if (isPlaying) return;
    if (engine === 'native') startNative();
    else startEdge();
  }, [paused, engine, isPlaying, speakUnit, startNative, startEdge]);

  const pause = useCallback(() => {
    if (!isPlaying) return;
    setPaused(true);
    setIsPlaying(false);
    if (engine === 'native') {
      const synth = window.speechSynthesis;
      if (iosRef.current) {
        // iOS 原生 pause 后 resume 会无声:取消并保留进度,恢复时从当前单元重说
        playingRef.current = false;
        synth.cancel();
      } else {
        synth.pause();
      }
      return;
    }
    if (audioRef.current) audioRef.current.pause();
  }, [isPlaying, engine]);

  // 页面卸载 / 组件卸载时关闭朗读
  useEffect(() => {
    return () => {
      if (typeof window !== 'undefined' && 'speechSynthesis' in window) {
        window.speechSynthesis.cancel();
      }
      if (audioRef.current) {
        try {
          audioRef.current.pause();
          audioRef.current.src = '';
        } catch {
          /* ignore */
        }
      }
    };
  }, []);

  const onChangeRate = useCallback((next: number) => {
    const clamped = Math.max(0.5, Math.min(2, next));
    setRate(clamped);
    try {
      localStorage.setItem(KEY_RATE, String(clamped));
    } catch {
      /* ignore */
    }
  }, []);

  const onChangeVoice = useCallback((uri: string) => {
    setVoiceURI(uri);
    try {
      localStorage.setItem(KEY_VOICE, uri);
    } catch {
      /* ignore */
    }
  }, []);

  const onChangeEdgeVoice = useCallback((uri: string) => {
    setEdgeVoice(uri);
    try {
      localStorage.setItem(KEY_EDGE_VOICE, uri);
    } catch {
      /* ignore */
    }
  }, []);

  const onChangeKokoroVoice = useCallback((uri: string) => {
    setKokoroVoice(uri);
    try {
      localStorage.setItem(KEY_KOKORO_VOICE, uri);
    } catch {
      /* ignore */
    }
  }, []);

  const onChangeEngine = useCallback((next: Engine) => {
    if (next === engine) return;
    stop();
    setEngine(next);
    try {
      localStorage.setItem(KEY_ENGINE, next);
    } catch {
      /* ignore */
    }
  }, [engine, stop]);

  // 高亮当前朗读段:加 class + 滚动跟随;切换时清掉上一段的 class
  useEffect(() => {
    const el = parasRef.current[activePara];
    if (activePara >= 0 && el) {
      el.classList.add('tts-current-paragraph');
      el.scrollIntoView({ behavior: 'smooth', block: 'center' });
      return () => {
        el.classList.remove('tts-current-paragraph');
      };
    }
  }, [activePara]);

  const chineseVoices = useMemo(
    () => voices.filter((v) => v.lang.toLowerCase().startsWith('zh')),
    [voices]
  );
  const voiceOptions = chineseVoices.length > 0 ? chineseVoices : voices;

  return (
    <div className="mb-4 rounded-lg border border-neutral-200 bg-white p-3 text-sm shadow-sm dark:border-neutral-800 dark:bg-neutral-900">
      <div className="flex flex-wrap items-center gap-2">
        {!isPlaying ? (
          <button
            onClick={play}
            aria-label="播放"
            className="flex h-9 items-center gap-1.5 rounded-full bg-sky-600 px-4 text-xs font-medium text-white transition hover:bg-sky-500 active:scale-95"
          >
            <span aria-hidden>▶</span>
            {paused ? '继续' : '听书'}
          </button>
        ) : (
          <button
            onClick={pause}
            aria-label="暂停"
            className="flex h-9 items-center gap-1.5 rounded-full bg-amber-500 px-4 text-xs font-medium text-white transition hover:bg-amber-400 active:scale-95"
          >
            <span aria-hidden>⏸</span>
            暂停
          </button>
        )}
        <button
          onClick={stop}
          aria-label="停止"
          disabled={!isPlaying && !paused}
          className="flex h-9 items-center gap-1.5 rounded-full border border-neutral-300 px-4 text-xs font-medium text-neutral-600 transition hover:bg-neutral-100 active:scale-95 disabled:opacity-40 dark:border-neutral-700 dark:text-neutral-300 dark:hover:bg-neutral-800"
        >
          <span aria-hidden>■</span>
          停止
        </button>

        {/* 引擎选择 */}
        <select
          value={engine}
          onChange={(e) => onChangeEngine(e.target.value as Engine)}
          className="h-9 max-w-[190px] rounded-md border border-neutral-300 bg-white px-2 text-xs text-neutral-700 dark:border-neutral-700 dark:bg-neutral-800 dark:text-neutral-200"
          aria-label="选择听书引擎"
          title="AI 情感听书走免费 Edge 神经语音(情感自然);本地语音走 Kokoro 模型(离线可用,需镜像启用 ENABLE_LOCAL_TTS 并挂载模型);系统语音用浏览器内置语音"
        >
          <option value="edge">✨ AI 情感听书</option>
          {kokoroOk ? <option value="kokoro">🎧 本地语音</option> : null}
          <option value="native">系统语音</option>
        </select>

        {engine === 'edge' ? (
          <select
            value={edgeVoice}
            onChange={(e) => onChangeEdgeVoice(e.target.value)}
            className="h-9 max-w-[190px] rounded-md border border-neutral-300 bg-white px-2 text-xs text-neutral-700 dark:border-neutral-700 dark:bg-neutral-800 dark:text-neutral-200"
            aria-label="选择 AI 语音"
          >
            {EDGE_VOICES.map((v) => (
              <option key={v.voiceURI} value={v.voiceURI}>
                {v.name} · {v.desc}
              </option>
            ))}
          </select>
        ) : engine === 'kokoro' ? (
          <select
            value={kokoroVoice}
            onChange={(e) => onChangeKokoroVoice(e.target.value)}
            className="h-9 max-w-[190px] rounded-md border border-neutral-300 bg-white px-2 text-xs text-neutral-700 dark:border-neutral-700 dark:bg-neutral-800 dark:text-neutral-200"
            aria-label="选择本地语音"
          >
            {KOKORO_VOICES.map((v) => (
              <option key={v.voiceURI} value={v.voiceURI}>
                {v.name} · {v.desc}
              </option>
            ))}
          </select>
        ) : (
          <select
            value={voiceURI}
            onChange={(e) => onChangeVoice(e.target.value)}
            className="h-9 max-w-[190px] rounded-md border border-neutral-300 bg-white px-2 text-xs text-neutral-700 dark:border-neutral-700 dark:bg-neutral-800 dark:text-neutral-200"
            aria-label="选择语音"
          >
            <option value="">系统默认{voices.length === 0 ? '(语音加载中…)' : ''}</option>
            {voiceOptions.map((v) => (
              <option key={v.voiceURI} value={v.voiceURI}>
                {v.name} ({v.lang})
              </option>
            ))}
          </select>
        )}

        <div className="flex flex-1 items-center gap-2 min-w-[160px] sm:flex-none">
          <label className="text-xs text-neutral-500 dark:text-neutral-400">语速</label>
          <input
            type="range"
            min={0.5}
            max={2}
            step={0.1}
            value={rate}
            onChange={(e) => onChangeRate(Number(e.target.value))}
            className="h-1 flex-1 accent-sky-600"
          />
          <span className="w-10 text-right text-xs tabular-nums text-neutral-500 dark:text-neutral-400">
            {rate.toFixed(1)}×
          </span>
        </div>
      </div>

      {/* 错误 / 加载提示:两类问题都可见、可操作 */}
      {ttsError ? (
        <p className="mt-2 text-xs text-[#b91c1c] dark:text-red-400">
          ⚠ {ttsError}
          {engine !== 'native' ? (
            <button
              type="button"
              onClick={play}
              className="ml-2 rounded border border-neutral-300 px-1.5 py-0.5 text-neutral-600 hover:bg-neutral-100 dark:border-neutral-700 dark:text-neutral-300 dark:hover:bg-neutral-800"
            >
              重试
            </button>
          ) : null}
        </p>
      ) : null}

      {engine === 'native' && voices.length === 0 && supported ? (
        <p className="mt-2 text-xs text-neutral-400 dark:text-neutral-500">
          未获取到系统语音列表:部分移动浏览器需先点一次「听书」才会返回;如一直为空,可能是浏览器权限/WebView 限制,
          建议改用「✨ AI 情感听书」(不需要系统语音)。
          <button
            type="button"
            onClick={() => setVoiceRetry((n) => n + 1)}
            className="ml-2 rounded border border-neutral-300 px-1.5 py-0.5 text-neutral-600 hover:bg-neutral-100 dark:border-neutral-700 dark:text-neutral-300 dark:hover:bg-neutral-800"
          >
            重新加载
          </button>
        </p>
      ) : null}

      {engine !== 'native' && edgeBusy ? (
        <p className="mt-2 text-xs text-neutral-400 dark:text-neutral-500">正在合成语音…</p>
      ) : null}

      {isPlaying && (
        <p className="mt-2 text-xs text-neutral-500 dark:text-neutral-400">
          正在听书第 {activePara + 1}/{paraTotal} 段
          {engine === 'edge' ? '(AI 情感语音)' : engine === 'kokoro' ? '(本地语音)' : ''}
        </p>
      )}
    </div>
  );
}
