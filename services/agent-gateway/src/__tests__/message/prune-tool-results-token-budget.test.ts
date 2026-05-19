import { describe, expect, it } from 'vitest';
import type { Message } from '@openAwork/shared';
import {
  pruneToolResultsByTokenBudget,
  PRUNE_PROTECT_TOKENS,
  PRUNE_MINIMUM_TOKENS,
} from '../../session/session-message-store.js';

function assistantToolCall(id: string, callId: string, toolName: string): Message {
  return {
    id,
    role: 'assistant',
    content: [
      {
        type: 'tool_call',
        toolCallId: callId,
        toolName,
        input: {},
      },
    ],
    createdAt: 0,
    sessionId: 's',
    userId: 'u',
    clientRequestId: id,
  } as unknown as Message;
}

function userToolResult(id: string, callId: string, output: string): Message {
  return {
    id,
    role: 'user',
    content: [
      {
        type: 'tool_result',
        toolCallId: callId,
        output,
      },
    ],
    createdAt: 0,
    sessionId: 's',
    userId: 'u',
    clientRequestId: id,
  } as unknown as Message;
}

describe('pruneToolResultsByTokenBudget', () => {
  it('is a no-op when total tool_result tokens stay under PRUNE_PROTECT', () => {
    const messages: Message[] = [
      assistantToolCall('a1', 'c1', 'bash'),
      userToolResult('u1', 'c1', 'small output'),
    ];
    const out = pruneToolResultsByTokenBudget(messages);
    expect(out).toBe(messages);
  });

  it('rewrites older tool_results once savings exceed PRUNE_MINIMUM', () => {
    // 4 chars/token: 8 messages × 12_000 chars each ≈ 24_000 tokens each;
    // total ≈ 192_000 tokens. PRUNE_PROTECT=40_000 protects the most
    // recent ~2 outputs (~48_000 tokens). The remaining ~6 should be
    // rewritten because savings (~144_000) >> PRUNE_MINIMUM (20_000).
    const big = 'x'.repeat(48_000);
    const messages: Message[] = [];
    for (let i = 0; i < 8; i++) {
      const callId = `c${i}`;
      messages.push(assistantToolCall(`a${i}`, callId, 'bash'));
      messages.push(userToolResult(`u${i}`, callId, big));
    }

    const out = pruneToolResultsByTokenBudget(messages);
    const outputs = out
      .flatMap((m) => m.content)
      .filter((c) => c.type === 'tool_result')
      .map((c) => (c as { output: string }).output);

    const pruned = outputs.filter((o) => o.startsWith('[Old tool result content'));
    const verbatim = outputs.filter((o) => o === big);
    expect(pruned.length).toBeGreaterThan(0);
    expect(verbatim.length).toBeGreaterThanOrEqual(1);
    expect(verbatim.length).toBeLessThan(outputs.length);
  });

  it('never prunes outputs from PRUNE_PROTECTED_TOOLS (e.g. "skill")', () => {
    const big = 'x'.repeat(48_000);
    const messages: Message[] = [];
    for (let i = 0; i < 8; i++) {
      const callId = `c${i}`;
      // Half the calls go to the protected "skill" tool.
      const toolName = i % 2 === 0 ? 'skill' : 'bash';
      messages.push(assistantToolCall(`a${i}`, callId, toolName));
      messages.push(userToolResult(`u${i}`, callId, big));
    }

    const out = pruneToolResultsByTokenBudget(messages);
    // Every "skill" tool_result must remain verbatim regardless of age.
    const skillCallIds = new Set(
      messages
        .flatMap((m) => m.content)
        .filter((c) => c.type === 'tool_call' && (c as { toolName: string }).toolName === 'skill')
        .map((c) => (c as { toolCallId: string }).toolCallId),
    );
    for (const m of out) {
      for (const c of m.content) {
        if (c.type === 'tool_result' && skillCallIds.has(c.toolCallId)) {
          expect(c.output).toBe(big);
        }
      }
    }
  });

  it('exposes PRUNE_PROTECT_TOKENS and PRUNE_MINIMUM_TOKENS aligned with opencode', () => {
    expect(PRUNE_PROTECT_TOKENS).toBe(40_000);
    expect(PRUNE_MINIMUM_TOKENS).toBe(20_000);
  });
});
