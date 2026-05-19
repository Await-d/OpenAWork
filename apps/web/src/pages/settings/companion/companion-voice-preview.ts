import { useEffect, useMemo, useRef, useState } from 'react';
import type { CompanionVoiceOutputMode, CompanionVoiceVariant } from '@openAwork/shared';

/**
 * 浏览器/系统的 speechSynthesis 是否可用。
 *
 * Tauri webview、SSR 阶段、部分嵌入式环境下没有这个对象。把检测收敛到一处，
 * 避免每个调用点重复写 typeof 判断。
 */
export const SUPPORTS_TTS =
  typeof globalThis !== 'undefined' &&
  typeof (globalThis as typeof globalThis & { speechSynthesis?: unknown }).speechSynthesis !==
    'undefined';

/**
 * 试听用的固定示例文本。导出让 section 与未来「试聊」组件共用。
 */
export const VOICE_PREVIEW_SAMPLE = '当前任务完成度 80%，先休息一下吧。';

export const OUTPUT_MODE_OPTIONS: Array<{ label: string; value: CompanionVoiceOutputMode }> = [
  { label: '关闭播报', value: 'off' },
  { label: '正常播报', value: 'buddy_only' },
  { label: '仅重点提醒', value: 'important_only' },
];

export const VOICE_VARIANT_OPTIONS: Array<{
  label: string;
  value: CompanionVoiceVariant;
  hint: string;
}> = [
  { label: '系统默认', value: 'system', hint: '使用浏览器/系统提供的默认中文声音。' },
  { label: '明亮', value: 'bright', hint: '偏向更清亮的女声，适合提示与短句。' },
  { label: '沉静', value: 'calm', hint: '偏向更克制的男声，适合长内容朗读。' },
];

/**
 * 选择最适合 variant 的本地 SpeechSynthesisVoice。
 *
 * 浏览器 voices 列表在不同环境差异很大，这里只做尽力匹配：
 *   - 先按 variant 偏好挑名称里带关键词或 lang 是 zh 的女/男声
 *   - 找不到时按 lang === 'zh-CN' 优先
 *   - 仍找不到就让浏览器自己选（返回 undefined）
 */
export function pickVoiceForVariant(
  voices: SpeechSynthesisVoice[],
  variant: CompanionVoiceVariant,
): SpeechSynthesisVoice | undefined {
  if (voices.length === 0) {
    return undefined;
  }

  const zhVoices = voices.filter((voice) => voice.lang.toLowerCase().startsWith('zh'));
  const pool = zhVoices.length > 0 ? zhVoices : voices;

  if (variant === 'bright') {
    const bright = pool.find((voice) => /female|xiaoxiao|yaoyao|tianxin/i.test(voice.name));
    if (bright) return bright;
  }
  if (variant === 'calm') {
    const calm = pool.find((voice) => /male|kangkang|yunxi|yunyang/i.test(voice.name));
    if (calm) return calm;
  }
  return pool[0];
}

/**
 * Buddy 试听播放控制 hook。
 *
 * 把 voiceschanged 监听、cancel 清理、isPlaying 状态封装成一个返回
 * `{ isPlaying, play }` 的 hook。section 组件只需关心 UI 渲染。
 *
 * `play(rate, variant)`：当前正在播报则停止；否则用最匹配的 voice 朗读
 * `VOICE_PREVIEW_SAMPLE`，按指定 rate。
 */
export function useBuddyVoicePreview(): {
  isPlaying: boolean;
  play: (rate: number, variant: CompanionVoiceVariant) => void;
} {
  const [voicesVersion, setVoicesVersion] = useState(0);
  const [isPlaying, setIsPlaying] = useState(false);
  const utteranceRef = useRef<SpeechSynthesisUtterance | null>(null);

  // voices 是异步加载的（Chrome / Edge 首次返回空数组）。监听 voiceschanged
  // 后强制重新读取；卸载时清掉播报，避免离开页面后还在念。
  useEffect(() => {
    if (!SUPPORTS_TTS) return undefined;
    const handler = () => setVoicesVersion((value) => value + 1);
    globalThis.speechSynthesis.addEventListener('voiceschanged', handler);
    return () => {
      globalThis.speechSynthesis.removeEventListener('voiceschanged', handler);
      if (utteranceRef.current) {
        globalThis.speechSynthesis.cancel();
        utteranceRef.current = null;
      }
    };
  }, []);

  const voices = useMemo<SpeechSynthesisVoice[]>(() => {
    if (!SUPPORTS_TTS) return [];
    void voicesVersion;
    return globalThis.speechSynthesis.getVoices();
  }, [voicesVersion]);

  const play = (rate: number, variant: CompanionVoiceVariant) => {
    if (!SUPPORTS_TTS) return;
    const synth = globalThis.speechSynthesis;
    if (isPlaying) {
      synth.cancel();
      utteranceRef.current = null;
      setIsPlaying(false);
      return;
    }
    const utterance = new SpeechSynthesisUtterance(VOICE_PREVIEW_SAMPLE);
    utterance.rate = rate;
    const voice = pickVoiceForVariant(voices, variant);
    if (voice) utterance.voice = voice;
    utterance.onend = () => {
      utteranceRef.current = null;
      setIsPlaying(false);
    };
    utterance.onerror = () => {
      utteranceRef.current = null;
      setIsPlaying(false);
    };
    utteranceRef.current = utterance;
    setIsPlaying(true);
    synth.speak(utterance);
  };

  return { isPlaying, play };
}
