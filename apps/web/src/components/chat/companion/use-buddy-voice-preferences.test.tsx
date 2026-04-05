// @vitest-environment jsdom

import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { CompanionAgentBinding } from '@openAwork/shared';
import { useBuddyVoicePreferences } from './use-buddy-voice-preferences.js';
import { useAuthStore } from '../../../stores/auth.js';

let root: Root | null = null;
let container: HTMLDivElement | null = null;

function Harness({ agentId, scope }: { agentId?: string; scope: string }) {
  const {
    bindings,
    companionFeatureMode,
    enabled,
    injectionMode,
    isVoiceOutputFeatureReady,
    isVoiceOutputFeatureEnabled,
    muted,
    quietMode,
    reducedMotion,
    syncStatusLabel,
    setEnabled,
    setInjectionMode,
    setMuted,
    setQuietMode,
    setReducedMotion,
    voiceOutputEnabled,
    setVoiceOutputEnabled,
    saveAgentBinding,
  } = useBuddyVoicePreferences(scope, agentId);

  const sampleBinding: CompanionAgentBinding = {
    behaviorTone: 'focused',
    displayName: 'Heph 小锤',
    injectionMode: 'always',
    species: 'robot',
    themeVariant: 'playful',
    verbosity: 'minimal',
    voiceOutputMode: 'important_only',
    voiceRate: 1.15,
    voiceVariant: 'bright',
  };

  return (
    <div>
      <button type="button" onClick={() => setVoiceOutputEnabled((value) => !value)}>
        {voiceOutputEnabled ? 'voice:on' : 'voice:off'}
      </button>
      <button type="button" onClick={() => setEnabled((value) => !value)}>
        {enabled ? 'companion:on' : 'companion:off'}
      </button>
      <button type="button" onClick={() => setMuted((value) => !value)}>
        {muted ? 'muted:on' : 'muted:off'}
      </button>
      <button type="button" onClick={() => setQuietMode((value) => !value)}>
        {quietMode ? 'quiet:on' : 'quiet:off'}
      </button>
      <button type="button" onClick={() => setReducedMotion((value) => !value)}>
        {reducedMotion ? 'motion:reduced' : 'motion:full'}
      </button>
      <button
        type="button"
        onClick={() =>
          setInjectionMode((value) => (value === 'always' ? 'mention_only' : 'always'))
        }
      >
        {`inject:${injectionMode}`}
      </button>
      <button type="button" onClick={() => void saveAgentBinding('hephaestus', sampleBinding)}>
        save-binding
      </button>
      <span>{isVoiceOutputFeatureEnabled ? 'feature:on' : 'feature:off'}</span>
      <span>{isVoiceOutputFeatureReady ? 'feature:ready' : 'feature:loading'}</span>
      <span>{`mode:${companionFeatureMode}`}</span>
      <span>{`sync:${syncStatusLabel}`}</span>
      <span>{`bindings:${Object.keys(bindings).length}`}</span>
    </div>
  );
}

describe('useBuddyVoicePreferences', () => {
  const fetchMock = vi.fn<typeof fetch>();

  beforeEach(() => {
    (
      globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
    ).IS_REACT_ACT_ENVIRONMENT = true;
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
    globalThis.window.localStorage.clear();
    useAuthStore.setState({ accessToken: null, gatewayUrl: 'http://localhost:3000' });
    vi.stubGlobal('fetch', fetchMock);
    fetchMock.mockReset();
    vi.useFakeTimers();
  });

  afterEach(async () => {
    await act(async () => {
      root?.unmount();
    });
    container?.remove();
    container = null;
    root = null;
    globalThis.window.localStorage.clear();
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  it('persists voice output enabled per scope', async () => {
    await act(async () => {
      root?.render(<Harness scope="buddy@example.com" />);
    });

    expect(container?.textContent).toContain('voice:off');
    expect(container?.textContent).toContain('sync:仅本地保存');

    const button = container?.querySelectorAll('button')[0];
    act(() => {
      button?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });

    expect(container?.textContent).toContain('voice:on');

    await act(async () => {
      root?.render(<Harness scope="buddy@example.com" />);
    });

    expect(container?.textContent).toContain('voice:on');
  });

  it('isolates stored preference between scopes', async () => {
    globalThis.window.localStorage.setItem('openawork-buddy-voice-output:buddy@example.com', '1');

    await act(async () => {
      root?.render(<Harness scope="another@example.com" />);
    });

    expect(container?.textContent).toContain('voice:off');
  });

  it('falls back safely when localStorage access throws', async () => {
    const getItemSpy = vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new DOMException('blocked');
    });
    const setItemSpy = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new DOMException('blocked');
    });

    await act(async () => {
      root?.render(<Harness scope="buddy@example.com" />);
    });

    expect(container?.textContent).toContain('voice:off');

    const button = container?.querySelectorAll('button')[0];
    act(() => {
      button?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });

    expect(container?.textContent).toContain('voice:on');

    getItemSpy.mockRestore();
    setItemSpy.mockRestore();
  });

  it('hydrates from remote companion settings and saves updates back to gateway', async () => {
    useAuthStore.setState({ accessToken: 'token-a', gatewayUrl: 'http://localhost:3000' });
    fetchMock
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            activeBinding: undefined,
            feature: { enabled: false, mode: 'off' },
            preferences: {
              enabled: false,
              injectionMode: 'always',
              voiceOutputEnabled: true,
              voiceOutputMode: 'buddy_only',
              voiceRate: 1.02,
              voiceVariant: 'system',
              muted: true,
              reducedMotion: true,
              verbosity: 'minimal',
            },
            profile: null,
          }),
          { status: 200 },
        ),
      )
      .mockResolvedValueOnce(new Response(JSON.stringify({ ok: true }), { status: 200 }));

    await act(async () => {
      root?.render(<Harness scope="buddy@example.com" agentId="hephaestus" />);
    });

    expect(fetchMock).toHaveBeenCalledWith(
      'http://localhost:3000/settings/companion?agentId=hephaestus',
      {
        headers: { Authorization: 'Bearer token-a' },
        signal: expect.any(AbortSignal),
      },
    );
    expect(container?.textContent).toContain('voice:on');
    expect(container?.textContent).toContain('companion:off');
    expect(container?.textContent).toContain('muted:on');
    expect(container?.textContent).toContain('quiet:on');
    expect(container?.textContent).toContain('motion:reduced');
    expect(container?.textContent).toContain('inject:always');
    expect(container?.textContent).toContain('feature:off');
    expect(container?.textContent).toContain('feature:ready');
    expect(container?.textContent).toContain('mode:off');
    expect(container?.textContent).toContain('sync:已同步');
    expect(container?.textContent).toContain('bindings:0');

    const button = container?.querySelectorAll('button')[0];
    act(() => {
      button?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });

    expect(container?.textContent).toContain('sync:同步中');

    await act(async () => {
      vi.advanceTimersByTime(501);
      await Promise.resolve();
    });

    expect(fetchMock).toHaveBeenLastCalledWith(
      'http://localhost:3000/settings/companion?agentId=hephaestus',
      {
        method: 'PUT',
        headers: {
          Authorization: 'Bearer token-a',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          preferences: {
            enabled: false,
            injectionMode: 'always',
            muted: true,
            reducedMotion: true,
            verbosity: 'minimal',
            voiceOutputEnabled: false,
            voiceOutputMode: 'buddy_only',
            voiceRate: 1.02,
            voiceVariant: 'system',
          },
        }),
      },
    );
    expect(container?.textContent).toContain('sync:已同步');
  });

  it('debounces rapid toggles and persists only the final voice setting', async () => {
    useAuthStore.setState({ accessToken: 'token-a', gatewayUrl: 'http://localhost:3000' });
    fetchMock
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            activeBinding: undefined,
            feature: { enabled: true, mode: 'beta' },
            preferences: {
              enabled: true,
              injectionMode: 'mention_only',
              voiceOutputEnabled: false,
              voiceOutputMode: 'buddy_only',
              voiceRate: 1.02,
              voiceVariant: 'system',
              muted: false,
              reducedMotion: false,
              verbosity: 'normal',
            },
            profile: null,
          }),
          { status: 200 },
        ),
      )
      .mockResolvedValue(new Response(JSON.stringify({ ok: true }), { status: 200 }));

    await act(async () => {
      root?.render(<Harness scope="buddy@example.com" />);
    });

    const voiceButton = container?.querySelectorAll('button')[0];
    act(() => {
      voiceButton?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      voiceButton?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      voiceButton?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });

    expect(container?.textContent).toContain('voice:on');
    expect(container?.textContent).toContain('sync:同步中');

    await act(async () => {
      vi.advanceTimersByTime(501);
      await Promise.resolve();
    });

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock).toHaveBeenLastCalledWith('http://localhost:3000/settings/companion', {
      method: 'PUT',
      headers: {
        Authorization: 'Bearer token-a',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        preferences: {
          enabled: true,
          injectionMode: 'mention_only',
          muted: false,
          reducedMotion: false,
          verbosity: 'normal',
          voiceOutputEnabled: true,
          voiceOutputMode: 'buddy_only',
          voiceRate: 1.02,
          voiceVariant: 'system',
        },
      }),
    });
    expect(container?.textContent).toContain('sync:已同步');
  });

  it('surfaces sync error when the debounced save fails', async () => {
    useAuthStore.setState({ accessToken: 'token-a', gatewayUrl: 'http://localhost:3000' });
    fetchMock
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            activeBinding: undefined,
            feature: { enabled: true, mode: 'beta' },
            preferences: {
              enabled: true,
              injectionMode: 'mention_only',
              voiceOutputEnabled: false,
              voiceOutputMode: 'buddy_only',
              voiceRate: 1.02,
              voiceVariant: 'system',
              muted: false,
              reducedMotion: false,
              verbosity: 'normal',
            },
            profile: null,
          }),
          { status: 200 },
        ),
      )
      .mockResolvedValueOnce(new Response(JSON.stringify({ error: 'boom' }), { status: 500 }));

    await act(async () => {
      root?.render(<Harness scope="buddy@example.com" />);
    });

    const muteButton = container?.querySelectorAll('button')[2];
    act(() => {
      muteButton?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });

    expect(container?.textContent).toContain('sync:同步中');

    await act(async () => {
      vi.advanceTimersByTime(501);
      await Promise.resolve();
    });

    expect(container?.textContent).toContain('sync:同步失败，先本地生效');
  });

  it('saves buddy-agent bindings through the companion settings route', async () => {
    useAuthStore.setState({ accessToken: 'token-a', gatewayUrl: 'http://localhost:3000' });
    fetchMock
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            bindings: {},
            activeBinding: undefined,
            feature: { enabled: true, mode: 'beta' },
            preferences: {
              enabled: true,
              injectionMode: 'mention_only',
              voiceOutputEnabled: false,
              voiceOutputMode: 'buddy_only',
              voiceRate: 1.02,
              voiceVariant: 'system',
              muted: false,
              reducedMotion: false,
              verbosity: 'normal',
            },
            profile: null,
          }),
          { status: 200 },
        ),
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            bindings: {
              hephaestus: {
                behaviorTone: 'focused',
                displayName: 'Heph 小锤',
                injectionMode: 'always',
                species: 'robot',
                themeVariant: 'playful',
                verbosity: 'minimal',
                voiceOutputMode: 'important_only',
                voiceRate: 1.15,
                voiceVariant: 'bright',
              },
            },
            activeBinding: {
              behaviorTone: 'focused',
              displayName: 'Heph 小锤',
              injectionMode: 'always',
              species: 'robot',
              themeVariant: 'playful',
              verbosity: 'minimal',
              voiceOutputMode: 'important_only',
              voiceRate: 1.15,
              voiceVariant: 'bright',
            },
            feature: { enabled: true, mode: 'beta' },
            preferences: {
              enabled: true,
              injectionMode: 'mention_only',
              voiceOutputEnabled: false,
              voiceOutputMode: 'buddy_only',
              voiceRate: 1.02,
              voiceVariant: 'system',
              muted: false,
              reducedMotion: false,
              verbosity: 'normal',
            },
            profile: {
              accentColor: 'var(--accent)',
              accentTint: 'color-mix(in oklch, var(--accent) 14%, transparent)',
              archetype: '工作台回声体',
              glyph: '✦',
              name: 'Heph 小锤',
              note: '只在你需要时露面，不抢主助手的话筒。',
              rarityStars: '★★★',
              species: '机械体',
              sprite: {
                eye: '✦',
                hat: 'none',
                rarity: 'rare',
                shiny: false,
                species: 'robot',
              },
              traits: ['低打扰', '跟命令'],
            },
          }),
          { status: 200 },
        ),
      );

    await act(async () => {
      root?.render(<Harness scope="buddy@example.com" agentId="hephaestus" />);
    });

    const saveBindingButton = Array.from(container?.querySelectorAll('button') ?? []).find(
      (button) => button.textContent?.includes('save-binding'),
    );

    await act(async () => {
      saveBindingButton?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      await Promise.resolve();
    });

    expect(fetchMock).toHaveBeenLastCalledWith(
      'http://localhost:3000/settings/companion?agentId=hephaestus',
      {
        method: 'PUT',
        headers: {
          Authorization: 'Bearer token-a',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          bindings: {
            hephaestus: {
              behaviorTone: 'focused',
              displayName: 'Heph 小锤',
              injectionMode: 'always',
              species: 'robot',
              themeVariant: 'playful',
              verbosity: 'minimal',
              voiceOutputMode: 'important_only',
              voiceRate: 1.15,
              voiceVariant: 'bright',
            },
          },
        }),
      },
    );
    expect(container?.textContent).toContain('bindings:1');
  });
});
