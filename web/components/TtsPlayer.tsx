'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

const KEY_RATE = 'novel:tts:rate';
const KEY_VOICE = 'novel:tts:voiceURI';
const DEFAULT_RATE = 1;

interface SpeechVoiceLite {
  voiceURI: string;
  name: string;
  lang: string;
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
 * 通过 selector 找到文章容器(SSR 后挂载),切片为段落顺序朗读。
 * 偏好(语速/voiceURI)持久化在 localStorage。
 */
export default function TtsPlayer({ contentSelector }: { contentSelector: string }) {
  const [supported, setSupported] = useState(false);
  const [voices, setVoices] = useState<SpeechVoiceLite[]>([]);
  const [voiceURI, setVoiceURI] = useState<string>('');
  const [rate, setRate] = useState<number>(DEFAULT_RATE);
  const [isPlaying, setIsPlaying] = useState(false);
  const [paused, setPaused] = useState(false);
  const [activeIndex, setActiveIndex] = useState<number>(-1);
  const utterRef = useRef<SpeechSynthesisUtterance | null>(null);
  const queueRef = useRef<HTMLElement[]>([]);
  const idxRef = useRef<number>(-1);
  const playingRef = useRef(false);

  // 检测浏览器支持 + 加载语音列表
  useEffect(() => {
    if (typeof window === 'undefined' || !('speechSynthesis' in window)) {
      setSupported(false);
      return;
    }
    setSupported(true);
    const refresh = () => {
      const list = window.speechSynthesis.getVoices();
      setVoices(
        list.map((v) => ({ voiceURI: v.voiceURI, name: v.name, lang: v.lang }))
      );
    };
    refresh();
    // 部分浏览器(chrome)在初始化时 voice 列表为空,需 onvoiceschanged
    window.speechSynthesis.onvoiceschanged = refresh;
    return () => {
      window.speechSynthesis.onvoiceschanged = null;
    };
  }, []);

  // 加载偏好
  useEffect(() => {
    try {
      const r = Number(localStorage.getItem(KEY_RATE));
      if (r >= 0.5 && r <= 2) setRate(r);
      const v = localStorage.getItem(KEY_VOICE);
      if (v) setVoiceURI(v);
    } catch {
      /* ignore */
    }
  }, []);

  const stop = useCallback(() => {
    if (typeof window === 'undefined') return;
    window.speechSynthesis.cancel();
    playingRef.current = false;
    setIsPlaying(false);
    setPaused(false);
    setActiveIndex(-1);
    idxRef.current = -1;
    queueRef.current = [];
    utterRef.current = null;
  }, []);

  const speakOne = useCallback(
    (idx: number) => {
      if (!playingRef.current) return;
      const ps = queueRef.current;
      if (idx < 0 || idx >= ps.length) {
        stop();
        return;
      }
      const el = ps[idx];
      const text = (el.textContent ?? '').trim();
      if (!text) {
        // 空段落:直接跳到下一段
        idxRef.current = idx + 1;
        setActiveIndex(idxRef.current);
        speakOne(idxRef.current);
        return;
      }
      const u = new SpeechSynthesisUtterance(text);
      const v = voices.find((x) => x.voiceURI === voiceURI);
      if (v && typeof window !== 'undefined') {
        const native = window.speechSynthesis.getVoices().find((x) => x.voiceURI === v.voiceURI);
        if (native) u.voice = native;
      }
      u.rate = rate;
      u.lang = v?.lang || 'zh-CN';
      u.onend = () => {
        if (!playingRef.current) return;
        idxRef.current = idx + 1;
        setActiveIndex(idxRef.current);
        speakOne(idxRef.current);
      };
      u.onerror = () => {
        stop();
      };
      utterRef.current = u;
      setActiveIndex(idx);
      window.speechSynthesis.speak(u);
    },
    [voices, voiceURI, rate, stop]
  );

  const play = useCallback(() => {
    if (typeof window === 'undefined' || !supported) return;
    if (paused && playingRef.current) {
      window.speechSynthesis.resume();
      setPaused(false);
      setIsPlaying(true);
      return;
    }
    if (isPlaying) return;
    const container = document.querySelector<HTMLElement>(contentSelector);
    queueRef.current = collectParagraphs(container);
    if (queueRef.current.length === 0) return;
    playingRef.current = true;
    setIsPlaying(true);
    setPaused(false);
    idxRef.current = 0;
    speakOne(0);
  }, [supported, contentSelector, speakOne, paused, isPlaying]);

  const pause = useCallback(() => {
    if (!isPlaying) return;
    if (typeof window === 'undefined') return;
    window.speechSynthesis.pause();
    setPaused(true);
    setIsPlaying(false);
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
    const ps = queueRef.current;
    if (activeIndex >= 0 && ps[activeIndex]) {
      const el = ps[activeIndex];
      el.classList.add('tts-current-paragraph');
      el.scrollIntoView({ behavior: 'smooth', block: 'center' });
      return () => {
        el.classList.remove('tts-current-paragraph');
      };
    }
  }, [activeIndex]);

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

        {voiceOptions.length > 0 && (
          <select
            value={voiceURI}
            onChange={(e) => onChangeVoice(e.target.value)}
            className="h-9 rounded-md border border-neutral-300 bg-white px-2 text-xs text-neutral-700 dark:border-neutral-700 dark:bg-neutral-800 dark:text-neutral-200"
            aria-label="选择语音"
          >
            <option value="">系统默认</option>
            {voiceOptions.map((v) => (
              <option key={v.voiceURI} value={v.voiceURI}>
                {v.name} ({v.lang})
              </option>
            ))}
          </select>
        )}
      </div>
      {isPlaying && (
        <p className="mt-2 text-xs text-neutral-500 dark:text-neutral-400">
          正在朗读第 {activeIndex + 1}/{queueRef.current.length} 段
        </p>
      )}
    </div>
  );
}
