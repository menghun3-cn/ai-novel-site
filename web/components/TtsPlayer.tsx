'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { detectIOS, maxChunkLength, splitIntoChunks } from '@/lib/tts';

const KEY_RATE = 'novel:tts:rate';
const KEY_VOICE = 'novel:tts:voiceURI';
const DEFAULT_RATE = 1;

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
 * 语音朗读:Web Speech API;零依赖,支持现代浏览器。
 * 移动端适配:
 * - 首次播放在用户手势内做静音预热解锁,并先 resume()+cancel() 清掉卡住的内部暂停态,
 *   否则 iOS Safari/WKWebView(含微信内置浏览器)点击后无声;
 * - iOS 的 pause/resume 不可靠(恢复后无声),改用「取消式暂停」:cancel 并保留进度,恢复时从当前片重说;
 * - 段落按句切成随语速动态定长的小片,规避安卓 Chrome 对单条超长朗读的静音截断;
 * - 语音列表在挂载、voiceschanged、轮询、回前台、首次朗读手势内多次尝试获取(iOS 首次朗读后才返回列表),
 *   下拉框常显,不再因列表为空而隐藏。
 * 偏好(语速/voiceURI)持久化在 localStorage。
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

  const unitsRef = useRef<SpeakUnit[]>([]);
  const parasRef = useRef<HTMLElement[]>([]);
  // 当前朗读单元下标(iOS 取消式暂停后由此恢复)
  const idxRef = useRef<number>(-1);
  const playingRef = useRef(false);
  const warmedRef = useRef(false);
  const iosRef = useRef(false);
  const savedVoiceRef = useRef('');

  // 支持检测 + 语音列表加载。
  // 移动端 getVoices() 首次常为空且 voiceschanged 可能不触发:轮询 + 回前台兜底。
  useEffect(() => {
    if (typeof window === 'undefined' || !('speechSynthesis' in window)) {
      return;
    }
    setSupported(true);
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
  }, []);

  // 加载偏好(voice 偏好先存 ref,等语音列表就绪后再校验生效)
  useEffect(() => {
    try {
      const r = Number(localStorage.getItem(KEY_RATE));
      if (r >= 0.5 && r <= 2) setRate(r);
      savedVoiceRef.current = localStorage.getItem(KEY_VOICE) ?? '';
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
    if (typeof window === 'undefined') return;
    window.speechSynthesis.cancel();
    playingRef.current = false;
    setIsPlaying(false);
    setPaused(false);
    setActivePara(-1);
    idxRef.current = -1;
    unitsRef.current = [];
    parasRef.current = [];
  }, []);

  const speakUnit = useCallback(
    (i: number) => {
      if (!playingRef.current) return;
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
        stop();
      };
      window.speechSynthesis.speak(u);
    },
    [voices, voiceURI, rate, stop]
  );

  const play = useCallback(() => {
    if (typeof window === 'undefined' || !supported) return;
    const synth = window.speechSynthesis;

    // 暂停恢复:iOS 走取消式暂停,需从当前单元重新 speak;其余平台原生 resume
    if (paused && unitsRef.current.length > 0) {
      if (iosRef.current) {
        playingRef.current = true;
        setIsPlaying(true);
        setPaused(false);
        speakUnit(idxRef.current);
      } else {
        synth.resume();
        setIsPlaying(true);
        setPaused(false);
      }
      return;
    }
    if (isPlaying) return;

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
  }, [supported, paused, isPlaying, rate, contentSelector, speakUnit]);

  const pause = useCallback(() => {
    if (!isPlaying || typeof window === 'undefined') return;
    const synth = window.speechSynthesis;
    setPaused(true);
    setIsPlaying(false);
    if (iosRef.current) {
      // iOS 原生 pause 后 resume 会无声:取消并保留进度,恢复时从当前单元重说
      playingRef.current = false;
      synth.cancel();
    } else {
      synth.pause();
    }
  }, [isPlaying]);

  // 页面卸载 / 组件卸载时关闭朗读
  useEffect(() => {
    return () => {
      if (typeof window === 'undefined') return;
      window.speechSynthesis.cancel();
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

  if (!supported) {
    return (
      <div className="mb-4 rounded-md border border-neutral-200 bg-neutral-50 px-3 py-2 text-xs text-neutral-500 dark:border-neutral-800 dark:bg-neutral-900 dark:text-neutral-400">
        当前浏览器不支持语音朗读
      </div>
    );
  }

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
            朗读
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

        {/* 移动端语音列表常延迟返回(iOS 首次朗读后才填充),下拉框常显避免控件忽隐忽现 */}
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
      </div>
      {voices.length === 0 && (
        <p className="mt-2 text-xs text-neutral-400 dark:text-neutral-500">
          未获取到系统语音列表:部分移动浏览器需先点一次「朗读」才会返回,稍后下拉框会自动填充。
        </p>
      )}
      {isPlaying && (
        <p className="mt-2 text-xs text-neutral-500 dark:text-neutral-400">
          正在朗读第 {activePara + 1}/{paraTotal} 段
        </p>
      )}
    </div>
  );
}
