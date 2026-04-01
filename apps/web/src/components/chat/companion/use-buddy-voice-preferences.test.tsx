// @vitest-environment jsdom

import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useBuddyVoicePreferences } from './use-buddy-voice-preferences.js';
import { useAuthStore } from '../../../stores/auth.js';

let root: Root | null = null;
let container: HTMLDivElement | null = null;

function Harness({ scope }: { scope: string }) {
  const {
    companionFeatureMode,
    isVoiceOutputFeatureReady,
    isVoiceOutputFeatureEnabled,
    muted,
    quietMode,
    syncStatusLabel,
    setMuted,
    setQuietMode,
    voiceOutputEnabled,
    setVoiceOutputEnabled,
  } = useBuddyVoicePreferences(scope);

  return (
    <div>
      <button type="button" onClick={() => setVoiceOutputEnabled((value) => !value)}>
        {voiceOutputEnabled ? 'voice:on' : 'voice:off'}
      </button>
      <button type="button" onClick={() => setMuted((value) => !value)}>
        {muted ? 'muted:on' : 'muted:off'}
      </button>
      <button type="button" onClick={() => setQuietMode((value) => !value)}>
        {quietMode ? 'quiet:on' : 'quiet:off'}
      </button>
      <span>{isVoiceOutputFeatureEnabled ? 'feature:on' : 'feature:off'}</span>
      <span>{isVoiceOutputFeatureReady ? 'feature:ready' : 'feature:loading'}</span>
      <span>{`mode:${companionFeatureMode}`}</span>
      <span>{`sync:${syncStatusLabel}`}</span>
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
            feature: { enabled: false, mode: 'off' },
            preferences: { voiceOutputEnabled: true, muted: true, verbosity: 'minimal' },
            profile: null,
          }),
          { status: 200 },
        ),
      )
      .mockResolvedValueOnce(new Response(JSON.stringify({ ok: true }), { status: 200 }));

    await act(async () => {
      root?.render(<Harness scope="buddy@example.com" />);
    });

    expect(fetchMock).toHaveBeenCalledWith('http://localhost:3000/settings/companion', {
      headers: { Authorization: 'Bearer token-a' },
      signal: expect.any(AbortSignal),
    });
    expect(container?.textContent).toContain('voice:on');
    expect(container?.textContent).toContain('muted:on');
    expect(container?.textContent).toContain('quiet:on');
    expect(container?.textContent).toContain('feature:off');
    expect(container?.textContent).toContain('feature:ready');
    expect(container?.textContent).toContain('mode:off');
    expect(container?.textContent).toContain('sync:已同步');

    const button = container?.querySelectorAll('button')[0];
    act(() => {
      button?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });

    expect(container?.textContent).toContain('sync:同步中');

    await act(async () => {
      vi.advanceTimersByTime(501);
      await Promise.resolve();
    });

    expect(fetchMock).toHaveBeenLastCalledWith('http://localhost:3000/settings/companion', {
      method: 'PUT',
      headers: {
        Authorization: 'Bearer token-a',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        preferences: {
          muted: true,
          verbosity: 'minimal',
          voiceOutputEnabled: false,
        },
      }),
    });
    expect(container?.textContent).toContain('sync:已同步');
  });

  it('debounces rapid toggles and persists only the final voice setting', async () => {
    useAuthStore.setState({ accessToken: 'token-a', gatewayUrl: 'http://localhost:3000' });
    fetchMock
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            feature: { enabled: true, mode: 'beta' },
            preferences: { voiceOutputEnabled: false, muted: false, verbosity: 'normal' },
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
          muted: false,
          verbosity: 'normal',
          voiceOutputEnabled: true,
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
            feature: { enabled: true, mode: 'beta' },
            preferences: { voiceOutputEnabled: false, muted: false, verbosity: 'normal' },
            profile: null,
          }),
          { status: 200 },
        ),
      )
      .mockResolvedValueOnce(new Response(JSON.stringify({ error: 'boom' }), { status: 500 }));

    await act(async () => {
      root?.render(<Harness scope="buddy@example.com" />);
    });

    const muteButton = container?.querySelectorAll('button')[1];
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
});
