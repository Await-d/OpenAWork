import { describe, expect, it } from 'vitest';
import {
  buildChatStreamToken,
  shouldApplyChatSessionMutation,
  shouldApplyChatStreamMutation,
} from '../hooks/chat-stream-guard.js';

describe('chat-stream-guard', () => {
  it('builds a session-scoped token for each stream request', () => {
    expect(buildChatStreamToken('session-a', 3)).toBe('session-a:3');
    expect(buildChatStreamToken(undefined, 1)).toBe('no-session:1');
  });

  it('accepts only mounted callbacks that still belong to the active session token', () => {
    expect(
      shouldApplyChatStreamMutation({
        activeToken: 'session-a:2',
        callbackToken: 'session-a:2',
        currentSessionId: 'session-a',
        mounted: true,
        requestSessionId: 'session-a',
      }),
    ).toBe(true);

    expect(
      shouldApplyChatStreamMutation({
        activeToken: 'session-a:2',
        callbackToken: 'session-a:1',
        currentSessionId: 'session-a',
        mounted: true,
        requestSessionId: 'session-a',
      }),
    ).toBe(false);

    expect(
      shouldApplyChatStreamMutation({
        activeToken: 'session-a:2',
        callbackToken: 'session-a:2',
        currentSessionId: 'session-b',
        mounted: true,
        requestSessionId: 'session-a',
      }),
    ).toBe(false);

    expect(
      shouldApplyChatStreamMutation({
        activeToken: 'session-a:2',
        callbackToken: 'session-a:2',
        currentSessionId: 'session-a',
        mounted: false,
        requestSessionId: 'session-a',
      }),
    ).toBe(false);
  });

  it('rejects async mutations for stale or unmounted session requests', () => {
    expect(
      shouldApplyChatSessionMutation({
        currentSessionId: 'session-a',
        mounted: true,
        requestSessionId: 'session-a',
      }),
    ).toBe(true);

    expect(
      shouldApplyChatSessionMutation({
        currentSessionId: 'session-b',
        mounted: true,
        requestSessionId: 'session-a',
      }),
    ).toBe(false);

    expect(
      shouldApplyChatSessionMutation({
        currentSessionId: 'session-a',
        mounted: false,
        requestSessionId: 'session-a',
      }),
    ).toBe(false);
  });
});
