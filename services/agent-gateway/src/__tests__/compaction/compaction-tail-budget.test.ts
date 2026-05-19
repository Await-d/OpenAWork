import { describe, expect, it } from 'vitest';
import type { Message } from '@openAwork/shared';
import {
  selectTailByTokenBudget,
  estimateMessageTokens,
  boundPreserveTokens,
  MIN_PRESERVE_RECENT_TOKENS,
  MAX_PRESERVE_RECENT_TOKENS,
} from '../../compaction/compaction-tail-budget.js';

function userMsg(id: string, text: string): Message {
  return {
    id,
    role: 'user',
    content: [{ type: 'text', text }],
    createdAt: 0,
    sessionId: 's',
    userId: 'u',
    clientRequestId: id,
  } as unknown as Message;
}

function assistantMsg(id: string, text: string): Message {
  return {
    id,
    role: 'assistant',
    content: [{ type: 'text', text }],
    createdAt: 0,
    sessionId: 's',
    userId: 'u',
    clientRequestId: id,
  } as unknown as Message;
}

describe('selectTailByTokenBudget', () => {
  it('returns no tail when message list is empty', () => {
    const result = selectTailByTokenBudget({ messages: [], preserveRecentTokens: 5_000 });
    expect(result.boundary).toBe(0);
    expect(result.tailStartMessageId).toBeUndefined();
  });

  it('keeps the latest turns whose combined tokens fit the budget', () => {
    const messages: Message[] = [
      userMsg('u1', 'a'.repeat(40)),
      assistantMsg('a1', 'b'.repeat(40)),
      userMsg('u2', 'c'.repeat(40)),
      assistantMsg('a2', 'd'.repeat(40)),
    ];
    // Each message ~10 tokens with 4 chars/token; budget 25 fits exactly
    // the last 2-message turn (~20 tokens), but rejects adding the prior turn.
    const result = selectTailByTokenBudget({ messages, preserveRecentTokens: 25, maxTurns: 2 });
    expect(result.boundary).toBe(2);
    expect(result.tailStartMessageId).toBe('u2');
  });

  it('falls back to splitTurn when a single turn exceeds the budget', () => {
    const messages: Message[] = [
      userMsg('u1', 'a'.repeat(20)),
      assistantMsg('a1', 'b'.repeat(2_000)),
    ];
    const result = selectTailByTokenBudget({
      messages,
      preserveRecentTokens: 100,
      maxTurns: 1,
    });
    // The whole turn exceeds budget; split picks a sub-window inside it.
    // For a 2-message turn the only valid split is the trailing assistant
    // message (~500 tokens), which still doesn't fit; expect no tail kept.
    expect(result.boundary).toBe(messages.length);
    expect(result.tailStartMessageId).toBeUndefined();
  });

  it('respects the maxTurns ceiling', () => {
    const messages: Message[] = [
      userMsg('u1', 'a'),
      assistantMsg('a1', 'a'),
      userMsg('u2', 'a'),
      assistantMsg('a2', 'a'),
      userMsg('u3', 'a'),
      assistantMsg('a3', 'a'),
    ];
    const result = selectTailByTokenBudget({
      messages,
      preserveRecentTokens: MAX_PRESERVE_RECENT_TOKENS,
      maxTurns: 1,
    });
    // With maxTurns=1 only the final user turn is eligible, so the
    // boundary lands at u3 even though earlier turns would also fit.
    expect(result.boundary).toBe(4);
    expect(result.tailStartMessageId).toBe('u3');
  });
});

describe('estimateMessageTokens', () => {
  it('counts ~1 token per 4 characters of text content', () => {
    const m = userMsg('u1', 'a'.repeat(40));
    expect(estimateMessageTokens(m)).toBe(10);
  });
});

describe('boundPreserveTokens', () => {
  it('clamps to the documented [min, max] range', () => {
    expect(boundPreserveTokens(100)).toBe(MIN_PRESERVE_RECENT_TOKENS);
    expect(boundPreserveTokens(50_000)).toBe(MAX_PRESERVE_RECENT_TOKENS);
    expect(boundPreserveTokens(4_000)).toBe(4_000);
  });
});
