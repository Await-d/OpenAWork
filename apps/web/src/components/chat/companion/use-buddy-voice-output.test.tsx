// @vitest-environment jsdom

import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { CompanionVoiceOutputMode, CompanionVoiceVariant } from '@openAwork/shared';
import { useBuddyVoiceOutput } from './use-buddy-voice-output.js';
import type { CompanionUtteranceSeed } from './companion-display-model.js';

let root: Root | null = null;
let container: HTMLDivElement | null = null;

class MockSpeechSynthesisUtterance {
  text: string;
  rate = 1;
  pitch = 1;
  volume = 1;
  onend: (() => void) | null = null;
  onerror: (() => void) | null = null;
  onstart: (() => void) | null = null;

  constructor(text: string) {
    this.text = text;
  }
}

function Harness(props: {
  enabled: boolean;
  featureEnabled?: boolean;
  featureReady?: boolean;
  liveOutput: CompanionUtteranceSeed | null;
  liveOutputId: string | null;
  muted: boolean;
  quietMode: boolean;
  voiceOutputMode?: CompanionVoiceOutputMode;
  voiceRate?: number;
  voiceVariant?: CompanionVoiceVariant;
  voiceInputVisible: boolean;
}) {
  const state = useBuddyVoiceOutput({
    enabled: props.enabled,
    featureEnabled: props.featureEnabled ?? true,
    featureReady: props.featureReady ?? true,
    liveOutput: props.liveOutput,
    liveOutputId: props.liveOutputId,
    muted: props.muted,
    profileName: '稜镜',
    quietMode: props.quietMode,
    voiceOutputMode: props.voiceOutputMode ?? 'buddy_only',
    voiceRate: props.voiceRate ?? 1.02,
    voiceVariant: props.voiceVariant ?? 'system',
    voiceInputVisible: props.voiceInputVisible,
  });

  return <div data-status={state.speechStatusLabel}>{state.speechStatusLabel}</div>;
}

describe('useBuddyVoiceOutput', () => {
  const speak = vi.fn((utterance: MockSpeechSynthesisUtterance) => {
    utterance.onstart?.();
  });
  const cancel = vi.fn();

  beforeEach(() => {
    (
      globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
    ).IS_REACT_ACT_ENVIRONMENT = true;
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
    Object.defineProperty(globalThis, 'SpeechSynthesisUtterance', {
      configurable: true,
      value: MockSpeechSynthesisUtterance,
    });
    Object.defineProperty(globalThis.window, 'speechSynthesis', {
      configurable: true,
      value: { cancel, speak },
    });
    vi.useFakeTimers();
  });

  afterEach(async () => {
    await act(async () => {
      root?.unmount();
    });
    container?.remove();
    root = null;
    container = null;
    speak.mockReset();
    cancel.mockReset();
    vi.useRealTimers();
  });

  it('speaks notice and active outputs when voice output is enabled', async () => {
    await act(async () => {
      root?.render(
        <Harness
          enabled={true}
          liveOutput={{
            badge: '待确认',
            text: '右侧还有 1 项待确认动作，别忘了看一眼。',
            tone: 'notice',
          }}
          liveOutputId="out-1"
          muted={false}
          quietMode={false}
          voiceInputVisible={false}
        />,
      );
    });

    expect(speak).toHaveBeenCalledTimes(1);
    expect((speak.mock.calls[0]?.[0] as MockSpeechSynthesisUtterance).text).toContain('稜镜提醒');
    expect((speak.mock.calls[0]?.[0] as MockSpeechSynthesisUtterance).rate).toBeCloseTo(1.02, 2);
    expect(container?.textContent).toContain('Buddy 正在播报短句');
  });

  it('applies voice variant and rate overrides to the utterance', async () => {
    await act(async () => {
      root?.render(
        <Harness
          enabled={true}
          liveOutput={{ badge: '待确认', text: '右侧还有 1 项待确认动作。', tone: 'notice' }}
          liveOutputId="variant-bright"
          muted={false}
          quietMode={false}
          voiceInputVisible={false}
          voiceRate={1.15}
          voiceVariant="bright"
        />,
      );
    });

    const utterance = speak.mock.calls[0]?.[0] as MockSpeechSynthesisUtterance;
    expect(utterance.rate).toBeCloseTo(1.21, 2);
    expect(utterance.pitch).toBeCloseTo(1.12, 2);
  });

  it('does not speak intro or ambient cues', async () => {
    await act(async () => {
      root?.render(
        <Harness
          enabled={true}
          liveOutput={{ badge: '初次亮相', text: '我先在旁边待命。', tone: 'intro' }}
          liveOutputId="out-intro"
          muted={false}
          quietMode={false}
          voiceInputVisible={false}
        />,
      );
    });

    expect(speak).not.toHaveBeenCalled();
  });

  it('does not speak notice cues while quiet mode is enabled', async () => {
    await act(async () => {
      root?.render(
        <Harness
          enabled={true}
          liveOutput={{ badge: '待确认', text: '右侧还有 1 项待确认动作。', tone: 'notice' }}
          liveOutputId="quiet-notice"
          muted={false}
          quietMode={true}
          voiceInputVisible={false}
        />,
      );
    });

    expect(speak).not.toHaveBeenCalled();
    expect(container?.textContent).toContain('Buddy 播报待命中');
  });

  it('suppresses non-notice speech in important-only mode', async () => {
    await act(async () => {
      root?.render(
        <Harness
          enabled={true}
          liveOutput={{ badge: '跟随生成', text: '主助手正在生成。', tone: 'active' }}
          liveOutputId="important-only"
          muted={false}
          quietMode={false}
          voiceInputVisible={false}
          voiceOutputMode="important_only"
        />,
      );
    });

    expect(speak).not.toHaveBeenCalled();
    expect(container?.textContent).toContain('Buddy 仅播报重点提醒');
  });

  it('treats off voice mode as a hard stop even when voice output is enabled', async () => {
    await act(async () => {
      root?.render(
        <Harness
          enabled={true}
          liveOutput={{ badge: '待确认', text: '右侧还有 1 项待确认动作。', tone: 'notice' }}
          liveOutputId="voice-off"
          muted={false}
          quietMode={false}
          voiceInputVisible={false}
          voiceOutputMode="off"
        />,
      );
    });

    expect(speak).not.toHaveBeenCalled();
    expect(container?.textContent).toContain('当前绑定关闭了播报模式');
  });

  it('deduplicates repeated speech for the same live output id', async () => {
    const output = {
      badge: '跟随生成',
      text: '主助手正在生成。',
      tone: 'active',
    } satisfies CompanionUtteranceSeed;

    await act(async () => {
      root?.render(
        <Harness
          enabled={true}
          liveOutput={output}
          liveOutputId="same-output"
          muted={false}
          quietMode={false}
          voiceInputVisible={false}
        />,
      );
    });

    await act(async () => {
      root?.render(
        <Harness
          enabled={true}
          liveOutput={output}
          liveOutputId="same-output"
          muted={false}
          quietMode={false}
          voiceInputVisible={false}
        />,
      );
    });

    expect(speak).toHaveBeenCalledTimes(1);
  });

  it('applies cooldown to repeated notice cues even when ids change', async () => {
    await act(async () => {
      root?.render(
        <Harness
          enabled={true}
          liveOutput={{ badge: '待确认', text: '右侧还有 1 项待确认动作。', tone: 'notice' }}
          liveOutputId="notice-1"
          muted={false}
          quietMode={false}
          voiceInputVisible={false}
        />,
      );
    });

    await act(async () => {
      root?.render(
        <Harness
          enabled={true}
          liveOutput={{ badge: '待确认', text: '右侧还有 2 项待确认动作。', tone: 'notice' }}
          liveOutputId="notice-2"
          muted={false}
          quietMode={false}
          voiceInputVisible={false}
        />,
      );
    });

    expect(speak).toHaveBeenCalledTimes(1);

    await act(async () => {
      vi.advanceTimersByTime(12_001);
      root?.render(
        <Harness
          enabled={true}
          liveOutput={{ badge: '待确认', text: '右侧还有 3 项待确认动作。', tone: 'notice' }}
          liveOutputId="notice-3"
          muted={false}
          quietMode={false}
          voiceInputVisible={false}
        />,
      );
    });

    expect(speak).toHaveBeenCalledTimes(2);
  });

  it('cancels voice output when voice input UI is visible', async () => {
    await act(async () => {
      root?.render(
        <Harness
          enabled={true}
          liveOutput={{ badge: '跟随生成', text: '主助手正在生成。', tone: 'active' }}
          liveOutputId="out-2"
          muted={false}
          quietMode={false}
          voiceInputVisible={true}
        />,
      );
    });

    expect(speak).not.toHaveBeenCalled();
    expect(cancel).toHaveBeenCalled();
    expect(container?.textContent).toContain('语音输入打开时暂停播报');
  });

  it('does not speak when the remote feature gate is off', async () => {
    await act(async () => {
      root?.render(
        <Harness
          enabled={true}
          featureEnabled={false}
          liveOutput={{ badge: '跟随生成', text: '主助手正在生成。', tone: 'active' }}
          liveOutputId="feature-off"
          muted={false}
          quietMode={false}
          voiceInputVisible={false}
        />,
      );
    });

    expect(speak).not.toHaveBeenCalled();
    expect(container?.textContent).toContain('远端功能开关已关闭');
  });

  it('does not speak while remote feature settings are still loading', async () => {
    await act(async () => {
      root?.render(
        <Harness
          enabled={true}
          featureEnabled={true}
          featureReady={false}
          liveOutput={{ badge: '跟随生成', text: '主助手正在生成。', tone: 'active' }}
          liveOutputId="feature-loading"
          muted={false}
          quietMode={false}
          voiceInputVisible={false}
        />,
      );
    });

    expect(speak).not.toHaveBeenCalled();
    expect(container?.textContent).toContain('远端设置读取中');
  });
});
