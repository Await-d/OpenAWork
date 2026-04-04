import { describe, expect, it } from 'vitest';
import {
  buildChatRouteHistoryLocalHydrationState,
  buildChatRouteHistoryReadyState,
  buildChatRouteHistoryResetState,
} from '../chat-route-history-state.js';

describe('chat-route-history-state', () => {
  it('resets route state according to whether a session exists', () => {
    expect(buildChatRouteHistoryResetState<string>({ hasSessionId: false })).toEqual({
      input: '',
      loadingHistory: false,
      messages: [],
    });

    expect(buildChatRouteHistoryResetState<string>({ hasSessionId: true })).toEqual({
      input: '',
      loadingHistory: true,
      messages: [],
    });
  });

  it('hydrates cached draft and messages while keeping remote loading active', () => {
    expect(
      buildChatRouteHistoryLocalHydrationState({
        draft: '继续上一条思路',
        messages: ['cached-user', 'cached-assistant'],
      }),
    ).toEqual({
      input: '继续上一条思路',
      loadingHistory: true,
      messages: ['cached-user', 'cached-assistant'],
    });
  });

  it('settles route history with the latest retained input and messages', () => {
    const localState = buildChatRouteHistoryLocalHydrationState({
      draft: '保留草稿',
      messages: ['cached-user'],
    });

    expect(
      buildChatRouteHistoryReadyState({
        input: localState.input,
        messages: ['remote-user', 'remote-assistant'],
      }),
    ).toEqual({
      input: '保留草稿',
      loadingHistory: false,
      messages: ['remote-user', 'remote-assistant'],
    });
  });
});
