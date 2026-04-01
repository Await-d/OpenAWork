// @vitest-environment jsdom

import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useAuthStore } from '../../../stores/auth.js';
import { CompanionStage } from './companion-stage.js';

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

describe('CompanionStage', () => {
  beforeEach(() => {
    (
      globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
    ).IS_REACT_ACT_ENVIRONMENT = true;
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
    useAuthStore.setState({ accessToken: null, gatewayUrl: 'http://localhost:3000' });
  });

  afterEach(async () => {
    await act(async () => {
      root?.unmount();
    });
    container?.remove();
    root = null;
    container = null;
    vi.unstubAllGlobals();
  });

  async function renderStage() {
    await act(async () => {
      root?.render(
        <CompanionStage
          attachedCount={1}
          currentUserEmail="buddy@example.com"
          editorMode={false}
          input="这里有一张截图需要一起看"
          pendingPermissionCount={0}
          prefersReducedMotion={false}
          queuedCount={2}
          rightOpen={false}
          sessionBusyState={null}
          sessionId="session-1"
          showVoice={false}
          streaming={false}
          todoCount={1}
        />,
      );
    });
  }

  it('renders the companion preview dock and expands the detail panel', async () => {
    await renderStage();

    expect(container?.textContent).toContain('Buddy 精灵');
    expect(container?.textContent).toContain('无播报');
    expect(container?.textContent).toContain('我在替你看着 2 条待发消息');
    expect(container?.querySelector('[data-testid="companion-sync-badge"]')).not.toBeNull();
    expect(container?.querySelector('[data-testid="companion-panel"]')).toBeNull();
    expect(container?.querySelector('[data-testid="companion-terminal-sprite"]')).not.toBeNull();

    const expandButton = Array.from(container?.querySelectorAll('button') ?? []).find((button) =>
      button.textContent?.includes('展开详情'),
    );
    act(() => {
      expandButton?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });

    expect(container?.querySelector('[data-testid="companion-panel"]')).not.toBeNull();
    expect(container?.textContent).toContain('最近会话输出');
    expect(container?.textContent).toContain('当前环境无本地播报');
    expect(container?.textContent).toContain('仅本地保存');
    expect(container?.textContent).toContain('终端同款精灵壳层；本地 TTS MVP 只播稳定短句。');
  });

  it('hides the reaction bubble after muting', async () => {
    await renderStage();
    expect(container?.querySelector('[data-testid="companion-reaction"]')).not.toBeNull();

    const muteButton = Array.from(container?.querySelectorAll('button') ?? []).find((button) =>
      button.textContent?.includes('可出声'),
    );
    act(() => {
      muteButton?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });

    expect(container?.querySelector('[data-testid="companion-reaction"]')).toBeNull();
    expect(container?.textContent).toContain('已静音');
  });

  it('resets to the home-view expanded state when the session becomes null', async () => {
    await renderStage();
    expect(container?.querySelector('[data-testid="companion-panel"]')).toBeNull();

    await act(async () => {
      root?.render(
        <CompanionStage
          attachedCount={0}
          currentUserEmail="buddy@example.com"
          editorMode={false}
          input=""
          pendingPermissionCount={0}
          prefersReducedMotion={false}
          queuedCount={0}
          rightOpen={false}
          sessionBusyState={null}
          sessionId={null}
          showVoice={false}
          streaming={false}
          todoCount={0}
        />,
      );
    });

    expect(container?.querySelector('[data-testid="companion-panel"]')).not.toBeNull();
    expect(container?.textContent).toContain('当前阶段');
  });

  it('records a new session output when the reaction changes with session progress', async () => {
    await renderStage();

    await act(async () => {
      root?.render(
        <CompanionStage
          attachedCount={0}
          currentUserEmail="buddy@example.com"
          editorMode={false}
          input="/buddy 看看这轮结果"
          pendingPermissionCount={0}
          prefersReducedMotion={false}
          queuedCount={0}
          rightOpen={false}
          sessionBusyState="running"
          sessionId="session-1"
          showVoice={false}
          streaming={true}
          todoCount={1}
        />,
      );
    });

    const expandButton = Array.from(container?.querySelectorAll('button') ?? []).find((button) =>
      button.textContent?.includes('展开详情'),
    );
    act(() => {
      expandButton?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });

    expect(container?.textContent).toContain('跟随生成');
    expect(container?.textContent).toContain('最近会话输出');
    expect(container?.textContent).toContain('初次亮相');
  });

  it('shows terminal-style pet hearts when /buddy appears in the session input', async () => {
    await renderStage();

    await act(async () => {
      root?.render(
        <CompanionStage
          attachedCount={0}
          currentUserEmail="buddy@example.com"
          editorMode={false}
          input="/buddy 过来一下"
          pendingPermissionCount={0}
          prefersReducedMotion={false}
          queuedCount={0}
          rightOpen={false}
          sessionBusyState={null}
          sessionId="session-1"
          showVoice={false}
          streaming={false}
          todoCount={0}
        />,
      );
    });

    expect(container?.querySelector('[data-testid="companion-pet-hearts"]')).not.toBeNull();
  });

  it('toggles buddy voice output UI when local speech synthesis is available', async () => {
    const speak = vi.fn((utterance: MockSpeechSynthesisUtterance) => {
      utterance.onstart?.();
    });
    const cancel = vi.fn();
    Object.defineProperty(globalThis, 'SpeechSynthesisUtterance', {
      configurable: true,
      value: MockSpeechSynthesisUtterance,
    });
    Object.defineProperty(globalThis.window, 'speechSynthesis', {
      configurable: true,
      value: { cancel, speak },
    });

    await renderStage();
    expect(container?.textContent).toContain('播报关');

    const voiceButton = Array.from(container?.querySelectorAll('button') ?? []).find((button) =>
      button.textContent?.includes('播报关'),
    );
    await act(async () => {
      voiceButton?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });

    expect(container?.textContent).toMatch(/播报(开|中)/);
  });

  it('disables the voice toggle when the remote companion feature gate is off', async () => {
    useAuthStore.setState({ accessToken: 'token-a', gatewayUrl: 'http://localhost:3000' });
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(
        JSON.stringify({
          feature: { enabled: false, mode: 'off' },
          preferences: { voiceOutputEnabled: true, muted: false, verbosity: 'normal' },
          profile: null,
        }),
        { status: 200 },
      ),
    );
    vi.stubGlobal('fetch', fetchMock);

    await renderStage();

    expect(container?.textContent).toContain('功能关闭');
    const voiceButton = Array.from(container?.querySelectorAll('button') ?? []).find((button) =>
      button.textContent?.includes('功能关闭'),
    );
    expect(voiceButton?.getAttribute('disabled')).not.toBeNull();
  });
});
