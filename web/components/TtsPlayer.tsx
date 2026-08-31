'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { detectIOS, maxChunkLength, splitIntoChunks } from '@/lib/tts';
import { EDGE_DEFAULT_VOICE, EDGE_VOICES } from '@/lib/edge-tts';

const KEY_RATE = 'novel:tts:rate';
const KEY_VOICE = 'novel:tts:voiceURI';
const KEY_ENGINE = 'novel:tts:engine';
const KEY_EDGE_VOICE = 'novel:tts:edgeVoice';
const DEFAULT_RATE = 1;

type Engine = 'native' | 'edge';

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

  // 支持检测 + native 语音列表加载。
  // 移动端 getVoices() 首次常为空且 voiceschanged 可能不触发:轮询 + 回前台兜底 + 手动重试。
  useEffect(() => {
    if (typeof window === 'undefined' || !('speechSynthesis' in window)) {
      setTtsError('当前浏览器不支持系统语音朗读;可改用「AI 情感朗读」');
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
      if (e === 'native' || e === 'edge') setEngine(e);
      const ev = localStorage.getItem(KEY_EDGE_VOICE);
      if (ev && EDGE_VOICES.some((v) => v.voiceURI === ev)) setEdgeVoice(ev);
    } catch {
      /* ignore */
    }
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
        setTtsError('系统语音朗读出错,可切换「AI 情感朗读」');
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

  /** 顺序播放第 i 片:请求合成 MP3 → 播放 → onended 播下一片 */
  const playEdgeChunk = useCallback(
    async (i: number) => {
      if (!edgeActiveRef.current || engine !== 'edge') return;
      const units = edgeQueueRef.current;
      if (i < 0 || i >= units.length) {
        stop();
        return;
      }
      edgeIdxRef.current = i;
      setActivePara(units[i].paraIndex);
      setTtsError(null);
      setEdgeBusy(true);
      try {
        const res = await fetch('/api/tts', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ text: units[i].text, voice: edgeVoice, rate }),
        });
        if (!res.ok) {
          const data = (await res.json().catch(() => null)) as { error?: string } | null;
          throw new Error(data?.error ?? `语音合成失败(${res.status})`);
        }
        if (!edgeActiveRef.current) return; // 等待期间被停止
        const blob = await res.blob();
        const url = URL.createObjectURL(blob);
        const audio = new Audio(url);
        audioRef.current = audio;
        setEdgeBusy(false);
        audio.onended = () => {
          URL.revokeObjectURL(url);
          if (edgeActiveRef.current) void playEdgeChunk(i + 1);
        };
        audio.onerror = () => {
          URL.revokeObjectURL(url);
          if (edgeActiveRef.current) {
            setTtsError('音频播放失败,请重试或切换「系统语音」');
            stop();
          }
        };
        await audio.play();
      } catch (err) {
        setEdgeBusy(false);
        if (edgeActiveRef.current) {
          setTtsError(err instanceof Error ? err.message : 'AI 语音合成失败');
          stop();
        }
      }
    },
    [edgeVoice, rate, stop, engine]
  );

  const startEdge = useCallback(() => {
    const units = buildEdgeUnits();
    if (units.length === 0) {
      setTtsError('未找到可朗读的正文内容');
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
      if (engine === 'edge' && audioRef.current) {
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
            {paused ? '继续' : '朗读'}
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
          aria-label="选择朗读引擎"
          title="AI 情感朗读走免费 Edge 神经语音(情感自然);系统语音用浏览器内置语音"
        >
          <option value="edge">✨ AI 情感朗读</option>
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
          {engine === 'edge' ? (
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
          未获取到系统语音列表:部分移动浏览器需先点一次「朗读」才会返回;如一直为空,可能是浏览器权限/WebView 限制,
          建议改用「✨ AI 情感朗读」(不需要系统语音)。
          <button
            type="button"
            onClick={() => setVoiceRetry((n) => n + 1)}
            className="ml-2 rounded border border-neutral-300 px-1.5 py-0.5 text-neutral-600 hover:bg-neutral-100 dark:border-neutral-700 dark:text-neutral-300 dark:hover:bg-neutral-800"
          >
            重新加载
          </button>
        </p>
      ) : null}

      {engine === 'edge' && edgeBusy ? (
        <p className="mt-2 text-xs text-neutral-400 dark:text-neutral-500">正在合成语音…</p>
      ) : null}

      {isPlaying && (
        <p className="mt-2 text-xs text-neutral-500 dark:text-neutral-400">
          正在朗读第 {activePara + 1}/{paraTotal} 段{engine === 'edge' ? '(AI 情感语音)' : ''}
        </p>
      )}
    </div>
  );
}
