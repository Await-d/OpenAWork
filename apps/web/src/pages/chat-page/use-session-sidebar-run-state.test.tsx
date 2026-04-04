// @vitest-environment jsdom

import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { subscribeSessionRunState } from '../../utils/session-list-events.js';
import { useSessionSidebarRunState } from './use-session-sidebar-run-state.js';
import type { SessionStateStatus } from './session-runtime.js';

type HookHarnessProps = {
  activeStreamSessionId: string | null;
  currentSessionId: string | null;
  sessionStateStatus: SessionStateStatus | null;
  streaming: boolean;
};

function HookHarness(props: HookHarnessProps) {
  useSessionSidebarRunState(props);
  return null;
}

function setReactActEnvironment(enabled: boolean): void {
  (
    globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
  ).IS_REACT_ACT_ENVIRONMENT = enabled;
}

function clearReactActEnvironment(): void {
  delete (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean })
    .IS_REACT_ACT_ENVIRONMENT;
}

let root: Root | null = null;
let container: HTMLDivElement | null = null;

async function flushEffects(): Promise<void> {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
}

describe('useSessionSidebarRunState', () => {
  beforeEach(() => {
    setReactActEnvironment(true);
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    if (root) {
      act(() => {
        root?.unmount();
      });
    }

    root = null;
    container?.remove();
    container = null;
    vi.restoreAllMocks();
    clearReactActEnvironment();
  });

  it('keeps the previous session marked running after switching away while its stream is still active', async () => {
    const seen: Array<{ sessionId: string; state: string }> = [];
    const unsubscribe = subscribeSessionRunState((sessionId, state) => {
      seen.push({ sessionId, state });
    });

    await act(async () => {
      root!.render(
        <HookHarness
          activeStreamSessionId="session-a"
          currentSessionId="session-a"
          sessionStateStatus="running"
          streaming={true}
        />,
      );
    });
    await flushEffects();

    await act(async () => {
      root!.render(
        <HookHarness
          activeStreamSessionId="session-a"
          currentSessionId="session-b"
          sessionStateStatus="idle"
          streaming={false}
        />,
      );
    });
    await flushEffects();

    expect(seen).toEqual([
      { sessionId: 'session-a', state: 'running' },
      { sessionId: 'session-b', state: 'idle' },
    ]);

    unsubscribe();
  });

  it('keeps the previous session marked paused after switching away while its stream is still active', async () => {
    const seen: Array<{ sessionId: string; state: string }> = [];
    const unsubscribe = subscribeSessionRunState((sessionId, state) => {
      seen.push({ sessionId, state });
    });

    await act(async () => {
      root!.render(
        <HookHarness
          activeStreamSessionId="session-a"
          currentSessionId="session-a"
          sessionStateStatus="paused"
          streaming={false}
        />,
      );
    });
    await flushEffects();

    await act(async () => {
      root!.render(
        <HookHarness
          activeStreamSessionId="session-a"
          currentSessionId="session-b"
          sessionStateStatus="idle"
          streaming={false}
        />,
      );
    });
    await flushEffects();

    expect(seen).toEqual([
      { sessionId: 'session-a', state: 'paused' },
      { sessionId: 'session-b', state: 'idle' },
    ]);

    unsubscribe();
  });

  it('publishes idle when the current session is no longer busy', async () => {
    const seen: Array<{ sessionId: string; state: string }> = [];
    const unsubscribe = subscribeSessionRunState((sessionId, state) => {
      seen.push({ sessionId, state });
    });

    await act(async () => {
      root!.render(
        <HookHarness
          activeStreamSessionId="session-a"
          currentSessionId="session-a"
          sessionStateStatus="running"
          streaming={true}
        />,
      );
    });
    await flushEffects();

    await act(async () => {
      root!.render(
        <HookHarness
          activeStreamSessionId={null}
          currentSessionId="session-a"
          sessionStateStatus="idle"
          streaming={false}
        />,
      );
    });
    await flushEffects();

    expect(seen).toEqual([
      { sessionId: 'session-a', state: 'running' },
      { sessionId: 'session-a', state: 'idle' },
    ]);

    unsubscribe();
  });
});
