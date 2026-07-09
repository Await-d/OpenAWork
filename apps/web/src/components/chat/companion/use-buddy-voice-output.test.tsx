// @vitest-environment jsdom
/**
 * 回归测试：`useBuddyVoiceOutput` 在 voice 未启用 / 没有真正播报过时，
 * 不应该重复调用 `speechSynthesis.cancel()`。
 *
 * 历史 bug：流式对话期间 `liveOutput` 引用每个 chunk 都会变化，effect 重跑
 * 时无差别地调用 `cancel()`，触发 Chromium 内部 AudioContext 的
 * "AudioContext was not allowed to start. It must be resumed (or created)
 * after a user gesture on the page." 警告，几分钟就能攒出几千条。
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, renderHook } from '@testing-library/react';
import type { CompanionUtteranceSeed } from './companion-display-model.js';
import { useBuddyVoiceOutput } from './use-buddy-voice-output.js';

interface FakeSpeechSynthesis {
  cancel: ReturnType<typeof vi.fn>;
  speak: ReturnType<typeof vi.fn>;
}

interface FakeUtterance {
  text: string;
  rate: number;
  pitch: number;
  volume: number;
  voice: SpeechSynthesisVoice | null;
  onstart: ((event: Event) => void) | null;
  onend: ((event: Event) => void) | null;
  onerror: ((event: Event) => void) | null;
}

let createdUtterances: FakeUtterance[] = [];

class FakeSpeechSynthesisUtterance implements FakeUtterance {
  text: string;
  rate = 1;
  pitch = 1;
  volume = 1;
  voice: SpeechSynthesisVoice | null = null;
  onstart: ((event: Event) => void) | null = null;
  onend: ((event: Event) => void) | null = null;
  onerror: ((event: Event) => void) | null = null;

  constructor(text: string) {
    this.text = text;
    createdUtterances.push(this);
  }
}

function installFakeSpeechSynthesis(): FakeSpeechSynthesis {
  const fake: FakeSpeechSynthesis = {
    cancel: vi.fn(),
    speak: vi.fn(),
  };
  vi.stubGlobal('SpeechSynthesisUtterance', FakeSpeechSynthesisUtterance);
  Object.defineProperty(globalThis.window, 'speechSynthesis', {
    configurable: true,
    value: fake,
  });
  return fake;
}

type BuddyOptions = Parameters<typeof useBuddyVoiceOutput>[0];

function buildOptions(overrides: {
  enabled: boolean;
  liveOutput: CompanionUtteranceSeed | null;
  liveOutputId: string | null;
  voiceOutputMode?: 'off' | 'buddy_only' | 'important_only';
}): BuddyOptions {
  return {
    enabled: overrides.enabled,
    featureEnabled: true,
    featureReady: true,
    liveOutput: overrides.liveOutput,
    liveOutputId: overrides.liveOutputId,
    muted: false,
    profileName: 'Buddy',
    quietMode: false,
    voiceOutputMode: overrides.voiceOutputMode ?? 'buddy_only',
    voiceRate: 1,
    voiceVariant: 'system',
    voiceInputVisible: false,
  };
}

function makeSeed(text: string): CompanionUtteranceSeed {
  return { badge: '提示', text, tone: 'notice' };
}

let fakeSynth: FakeSpeechSynthesis;

beforeEach(() => {
  createdUtterances = [];
  fakeSynth = installFakeSpeechSynthesis();
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  // 还原 speechSynthesis，避免污染后续测试。
  Reflect.deleteProperty(globalThis.window, 'speechSynthesis');
});

describe('useBuddyVoiceOutput · AudioContext 警告回归', () => {
  it('voice 禁用时 liveOutput 多次变化不应调用 speechSynthesis.cancel', () => {
    const { rerender } = renderHook((props: BuddyOptions) => useBuddyVoiceOutput(props), {
      initialProps: buildOptions({
        enabled: false,
        liveOutput: makeSeed('第一段'),
        liveOutputId: 'live-1',
      }),
    });

    // 模拟流式对话：连续推 10 个新的 liveOutput 引用。
    for (let i = 2; i <= 11; i += 1) {
      rerender(
        buildOptions({
          enabled: false,
          liveOutput: makeSeed(`第 ${i} 段`),
          liveOutputId: `live-${i}`,
        }),
      );
    }

    expect(fakeSynth.cancel).not.toHaveBeenCalled();
    expect(fakeSynth.speak).not.toHaveBeenCalled();
  });

  it('voiceOutputMode=off 时同样不应调用 cancel', () => {
    const { rerender } = renderHook((props: BuddyOptions) => useBuddyVoiceOutput(props), {
      initialProps: buildOptions({
        enabled: true,
        liveOutput: makeSeed('段一'),
        liveOutputId: 'live-1',
        voiceOutputMode: 'off',
      }),
    });

    for (let i = 2; i <= 5; i += 1) {
      rerender(
        buildOptions({
          enabled: true,
          liveOutput: makeSeed(`段 ${i}`),
          liveOutputId: `live-${i}`,
          voiceOutputMode: 'off',
        }),
      );
    }

    expect(fakeSynth.cancel).not.toHaveBeenCalled();
    expect(fakeSynth.speak).not.toHaveBeenCalled();
  });

  it('启用后 speak 一次、再禁用时 cancel 一次，再禁用状态下追加 liveOutput 不再 cancel', () => {
    const { rerender } = renderHook((props: BuddyOptions) => useBuddyVoiceOutput(props), {
      initialProps: buildOptions({
        enabled: true,
        liveOutput: makeSeed('需要朗读的内容'),
        liveOutputId: 'live-spoken',
      }),
    });

    // 第一次 speak（启用状态下播报一次）。
    expect(fakeSynth.speak).toHaveBeenCalledTimes(1);
    // 第一次 speak 前没有 pending utterance，所以不会调 cancel。
    expect(fakeSynth.cancel).not.toHaveBeenCalled();

    // 切换到禁用，应该把那条 utterance 打断 1 次。
    rerender(
      buildOptions({
        enabled: false,
        liveOutput: makeSeed('需要朗读的内容'),
        liveOutputId: 'live-spoken',
      }),
    );
    expect(fakeSynth.cancel).toHaveBeenCalledTimes(1);

    // 此后再推新的 liveOutput（仍禁用），不应再 cancel。
    for (let i = 1; i <= 5; i += 1) {
      rerender(
        buildOptions({
          enabled: false,
          liveOutput: makeSeed(`下一段 ${i}`),
          liveOutputId: `live-next-${i}`,
        }),
      );
    }
    expect(fakeSynth.cancel).toHaveBeenCalledTimes(1);
  });

  it('utterance 自然 onend 后再切到禁用，不应再 cancel', () => {
    const { rerender } = renderHook((props: BuddyOptions) => useBuddyVoiceOutput(props), {
      initialProps: buildOptions({
        enabled: true,
        liveOutput: makeSeed('短句'),
        liveOutputId: 'live-finished',
      }),
    });

    expect(fakeSynth.speak).toHaveBeenCalledTimes(1);

    // 模拟浏览器播报完成（onend 内含 setIsSpeaking，需要包 act）。
    const utterance = createdUtterances.at(-1);
    expect(utterance).toBeDefined();
    act(() => {
      utterance?.onend?.(new Event('end'));
    });

    // 切到禁用，因为没有 pending utterance，应当不再 cancel。
    rerender(
      buildOptions({
        enabled: false,
        liveOutput: makeSeed('短句'),
        liveOutputId: 'live-finished',
      }),
    );
    expect(fakeSynth.cancel).not.toHaveBeenCalled();
  });
});

describe('useBuddyVoiceOutput · 人性化播报文案', () => {
  it('优先播报 spokenText 且不添加 Buddy 提醒前缀', () => {
    renderHook((props: BuddyOptions) => useBuddyVoiceOutput(props), {
      initialProps: buildOptions({
        enabled: true,
        liveOutput: {
          badge: '工具启动',
          spokenText: '它开始读文件了，我替你看着。',
          text: '它开始读文件了。我替你看着中间状态，你先不用分心。',
          tone: 'notice',
        },
        liveOutputId: 'spoken-humanized',
      }),
    });

    expect(fakeSynth.speak).toHaveBeenCalledTimes(1);
    expect(createdUtterances.at(-1)?.text).toBe('它开始读文件了，我替你看着。');
  });

  it('没有 spokenText 时播报 text 本身且不添加系统前缀', () => {
    renderHook((props: BuddyOptions) => useBuddyVoiceOutput(props), {
      initialProps: buildOptions({
        enabled: true,
        liveOutput: makeSeed('跑完了，线索我收好了。'),
        liveOutputId: 'spoken-fallback',
      }),
    });

    expect(fakeSynth.speak).toHaveBeenCalledTimes(1);
    expect(createdUtterances.at(-1)?.text).toBe('跑完了，线索我收好了。');
  });
});
