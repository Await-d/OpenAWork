// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, renderHook } from '@testing-library/react';
import { useRef, useState } from 'react';
import { useChatBranchSession } from './use-chat-branch-session.js';

const getRecovery = vi.fn<(...args: unknown[]) => Promise<unknown>>();
const importSession = vi.fn<(...args: unknown[]) => Promise<{ sessionId: string }>>();
const updateMetadata = vi.fn<(...args: unknown[]) => Promise<void>>();

vi.mock('@openAwork/web-client', () => ({
  createSessionsClient: vi.fn(() => ({ getRecovery, importSession, updateMetadata })),
}));

afterEach(() => {
  cleanup();
  getRecovery.mockReset();
  importSession.mockReset();
  updateMetadata.mockReset();
});

function renderBranchHook() {
  const focusComposerWithText = vi.fn();
  const requestSessionListRefresh = vi.fn();
  const sendMessage = vi.fn(async () => true);
  const clearSessionMetadataDirty = vi.fn();
  const navigateToSession = vi.fn();

  const hook = renderHook(() => {
    const activeSessionRef = useRef<string | null>('s1');
    const pendingBootstrapSessionRef = useRef<string | null>(null);
    const lastPersistedSessionMetadataSnapshotRef = useRef<string | null>(null);
    const [currentSessionId, setCurrentSessionId] = useState<string | null>('s1');
    const [messages, setMessages] = useState<unknown[]>([]);
    const [_sessionModesHydrated, setSessionModesHydrated] = useState(false);
    const [_streamError, setStreamError] = useState<string | null>('old');

    return {
      state: { activeSessionRef, pendingBootstrapSessionRef, currentSessionId, messages },
      api: useChatBranchSession({
        token: 'tok',
        gatewayUrl: 'https://gw.test',
        currentSessionId,
        activeSessionRef,
        pendingBootstrapSessionRef,
        setCurrentSessionId,
        setMessages: setMessages as never,
        clearSessionMetadataDirty,
        buildSessionMetadata: (overrides) => ({ base: true, ...overrides }),
        lastPersistedSessionMetadataSnapshotRef,
        setSessionModesHydrated,
        resetStreamState: vi.fn(),
        setStreamError,
        focusComposerWithText,
        requestSessionListRefresh,
        navigateToSession,
        sendMessage,
      }),
    };
  });

  return {
    hook,
    focusComposerWithText,
    requestSessionListRefresh,
    sendMessage,
    clearSessionMetadataDirty,
    navigateToSession,
  };
}

describe('useChatBranchSession', () => {
  it('无 inputParts 时切到分支会话并回填输入框', async () => {
    getRecovery.mockResolvedValue({
      session: {
        messages: [
          { id: 'm1', role: 'user', content: 'hello' },
          { id: 'm2', role: 'assistant', content: 'world' },
        ],
      },
    });
    importSession.mockResolvedValue({ sessionId: 'branch-1' });
    updateMetadata.mockResolvedValue();
    const {
      hook,
      focusComposerWithText,
      requestSessionListRefresh,
      sendMessage,
      navigateToSession,
    } = renderBranchHook();

    await act(async () => {
      await hook.result.current.api.createBranchSessionFromMessage('retry text', 'm2');
    });

    expect(focusComposerWithText).toHaveBeenCalledWith('retry text');
    expect(requestSessionListRefresh).toHaveBeenCalled();
    expect(navigateToSession).toHaveBeenCalledWith('branch-1');
    expect(sendMessage).not.toHaveBeenCalled();
    expect(hook.result.current.state.currentSessionId).toBe('branch-1');
  });

  it('有 inputParts 时创建分支后立即发送', async () => {
    getRecovery.mockResolvedValue({
      session: { messages: [{ id: 'm1', role: 'user', content: 'hello' }] },
    });
    importSession.mockResolvedValue({ sessionId: 'branch-2' });
    updateMetadata.mockResolvedValue();
    const { hook, sendMessage } = renderBranchHook();
    const inputParts = [{ type: 'input_image', artifactId: 'a1' }] as const;

    await act(async () => {
      await hook.result.current.api.createBranchSessionFromMessage('retry text', 'm1', [
        ...inputParts,
      ]);
    });

    expect(sendMessage).toHaveBeenCalledWith('retry text', {
      existingInputParts: [...inputParts],
      forcedSessionId: 'branch-2',
    });
  });
});
