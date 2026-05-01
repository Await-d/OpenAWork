import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  compareV1V2BridgeStructural,
  type BridgeDiffSummary,
} from '../v2-runtime/upstream/index.js';
import { isV2UpstreamShadow, refreshRuntimeFlagsForTesting } from '../v2-runtime/runtime-flag.js';
import type { ModelMessage } from 'ai';

describe('compareV1V2BridgeStructural', () => {
  function modelMessage(role: ModelMessage['role'], text: string): ModelMessage {
    if (role === 'tool') {
      return {
        role,
        content: [
          {
            type: 'tool-result',
            toolCallId: 'c',
            toolName: '',
            output: { type: 'text', value: text },
          },
        ],
      };
    }
    if (role === 'assistant') {
      return { role, content: [{ type: 'text', text }] };
    }
    return { role, content: text } as ModelMessage;
  }

  it('matches identical role / size sequences', () => {
    const v1 = [
      { role: 'system', content: 'sys' },
      { role: 'user', content: 'hello' },
      { role: 'assistant', content: 'reply' },
    ];
    const v2 = [
      modelMessage('system', 'sys'),
      modelMessage('user', 'hello'),
      modelMessage('assistant', 'reply'),
    ];
    const summary = compareV1V2BridgeStructural(v1, v2);
    expect(summary.matched).toBe(true);
    expect(summary.diffs).toHaveLength(0);
    expect(summary.v1Count).toBe(3);
    expect(summary.v2Count).toBe(3);
  });

  it('reports count mismatch as a single -1-indexed diff', () => {
    const v1 = [{ role: 'user', content: 'hi' }];
    const v2 = [modelMessage('user', 'hi'), modelMessage('assistant', 'reply')];
    const summary = compareV1V2BridgeStructural(v1, v2);
    expect(summary.matched).toBe(false);
    expect(summary.diffs[0]).toMatchObject({ index: -1 });
    expect(summary.v1Count).toBe(1);
    expect(summary.v2Count).toBe(2);
  });

  it('flags role mismatches with the specific index', () => {
    const v1 = [
      { role: 'user', content: 'q' },
      { role: 'assistant', content: 'a' },
    ];
    const v2 = [modelMessage('user', 'q'), modelMessage('user', 'a')];
    const summary = compareV1V2BridgeStructural(v1, v2);
    expect(summary.matched).toBe(false);
    expect(summary.diffs.some((d) => d.index === 1 && d.reason.includes('role'))).toBe(true);
  });

  it('flags large text-size drift but tolerates 1% / minimum 8-char drift', () => {
    const longText = 'x'.repeat(10000);
    const v1 = [{ role: 'user', content: longText }];
    // Drop a single character — within 1% tolerance.
    const v2 = [modelMessage('user', longText.slice(0, -1))];
    const summary = compareV1V2BridgeStructural(v1, v2);
    expect(summary.matched).toBe(true);

    // Drop 5% — should be flagged.
    const v2Drift = [modelMessage('user', longText.slice(0, 9500))];
    const driftSummary: BridgeDiffSummary = compareV1V2BridgeStructural(v1, v2Drift);
    expect(driftSummary.matched).toBe(false);
    expect(driftSummary.diffs.some((d) => d.reason.includes('text size'))).toBe(true);
  });

  it('flags tool-call count drift on assistant messages', () => {
    const v1 = [
      {
        role: 'assistant',
        content: 'reply',
        tool_calls: [
          { id: 'c1', function: { name: 'a', arguments: '{}' } },
          { id: 'c2', function: { name: 'b', arguments: '{}' } },
        ],
      },
    ];
    const v2 = [
      {
        role: 'assistant' as const,
        content: [
          { type: 'text' as const, text: 'reply' },
          { type: 'tool-call' as const, toolCallId: 'c1', toolName: 'a', input: {} },
        ],
      },
    ];
    const summary = compareV1V2BridgeStructural(v1, v2);
    expect(summary.matched).toBe(false);
    expect(summary.diffs.some((d) => d.reason.includes('tool call'))).toBe(true);
  });
});

describe('isV2UpstreamShadow', () => {
  beforeEach(() => {
    delete process.env['OPENAWORK_RUNTIME_UPSTREAM_SHADOW'];
    refreshRuntimeFlagsForTesting();
  });
  afterEach(() => {
    delete process.env['OPENAWORK_RUNTIME_UPSTREAM_SHADOW'];
    refreshRuntimeFlagsForTesting();
  });

  it('returns false when the env var is unset', () => {
    expect(isV2UpstreamShadow()).toBe(false);
  });

  it('accepts canonical truthy values (1 / true / on)', () => {
    expect(isV2UpstreamShadow({ OPENAWORK_RUNTIME_UPSTREAM_SHADOW: '1' })).toBe(true);
    expect(isV2UpstreamShadow({ OPENAWORK_RUNTIME_UPSTREAM_SHADOW: 'true' })).toBe(true);
    expect(isV2UpstreamShadow({ OPENAWORK_RUNTIME_UPSTREAM_SHADOW: '  ON ' })).toBe(true);
  });

  it('rejects unrecognised values (defaults to off)', () => {
    expect(isV2UpstreamShadow({ OPENAWORK_RUNTIME_UPSTREAM_SHADOW: '0' })).toBe(false);
    expect(isV2UpstreamShadow({ OPENAWORK_RUNTIME_UPSTREAM_SHADOW: 'false' })).toBe(false);
    expect(isV2UpstreamShadow({ OPENAWORK_RUNTIME_UPSTREAM_SHADOW: 'maybe' })).toBe(false);
  });
});
