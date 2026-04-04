import { describe, expect, it } from 'vitest';
import {
  buildChatScreenSessionResetState,
  buildChatScreenStaleSendAbortState,
} from '../screens/chat-screen-state.js';

describe('chat-screen-state', () => {
  it('keeps the next session unlocked when a stale send callback returns late', () => {
    const sessionAState = {
      activities: ['subagent-running'],
      artifactHistory: ['artifact-a'],
      historyLoading: false,
      messages: ['user-a', 'assistant-a'],
      sending: true,
    };

    const sessionBState = buildChatScreenSessionResetState<string, string, string>();

    expect(sessionBState).toEqual({
      activities: [],
      artifactHistory: [],
      historyLoading: true,
      messages: [],
      sending: false,
    });

    const afterLateSessionACallback = buildChatScreenStaleSendAbortState({
      ...sessionBState,
      activities: sessionAState.activities,
      artifactHistory: sessionBState.artifactHistory,
      historyLoading: sessionBState.historyLoading,
      messages: sessionBState.messages,
    });

    expect(afterLateSessionACallback).toEqual({
      activities: ['subagent-running'],
      artifactHistory: [],
      historyLoading: true,
      messages: [],
      sending: false,
    });
  });
});
