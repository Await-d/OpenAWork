import { describe, expect, it } from 'vitest';
import type { RunEvent } from '@openAwork/shared';
import { buildAssistantEventMessageContent } from '../../session/assistant-event-message.js';

function readPayloadSummary(event: RunEvent): string {
  const content = buildAssistantEventMessageContent(event);
  expect(content).not.toBeNull();
  expect(content).toHaveLength(1);
  const first = content?.[0];
  expect(first?.type).toBe('text');
  if (!first || first.type !== 'text') {
    throw new Error('expected text assistant event content');
  }

  return (JSON.parse(first.text) as { payload: { summary: string } }).payload.summary;
}

function readPayloadTitle(event: RunEvent): string {
  const content = buildAssistantEventMessageContent(event);
  expect(content).not.toBeNull();
  const first = content?.[0];
  expect(first?.type).toBe('text');
  if (!first || first.type !== 'text') {
    throw new Error('expected text assistant event content');
  }

  return (JSON.parse(first.text) as { payload: { title: string } }).payload.title;
}

describe('assistant event message', () => {
  it('uses compact as the user-facing compaction title', () => {
    const title = readPayloadTitle({
      type: 'compaction',
      summary: '已预防性压缩较早消息。',
      trigger: 'automatic',
      phase: 'completed',
      cause: 'proactive_near_overflow',
      strategy: 'runtime_replace',
    });

    expect(title).toBe('compact');
  });

  it('renders compaction summary without exposing internal strategy aliases', () => {
    const summary = readPayloadSummary({
      type: 'compaction',
      summary: '已预防性压缩较早消息。',
      trigger: 'automatic',
      phase: 'completed',
      cause: 'proactive_near_overflow',
      strategy: 'runtime_replace',
      compactedMessages: 12,
      representedMessages: 64,
    });

    expect(summary).toContain('已预防性压缩较早消息。');
    expect(summary).toContain('新增压缩：12 条');
    expect(summary).toContain('累计覆盖：64 条');
    expect(summary).not.toContain('恢复策略：');
  });

  it('keeps fallback compaction summary free of alias explanations', () => {
    const summary = readPayloadSummary({
      type: 'compaction',
      summary: '压缩 LLM 失败，已回退到结构化摘要。',
      trigger: 'manual',
      phase: 'failed',
      cause: 'manual',
      strategy: 'summary_only',
    });

    expect(summary).toContain('压缩 LLM 失败，已回退到结构化摘要。');
    expect(summary).not.toContain('恢复策略：');
  });

  it('does not invent a replacement strategy label for intermediate compaction passes', () => {
    const summary = readPayloadSummary({
      type: 'compaction',
      summary: '上下文超限，已截断 3 个大型工具输出。',
      trigger: 'automatic',
      phase: 'completed',
      cause: 'usage_overflow',
      compactedMessages: 3,
    });

    expect(summary).toContain('上下文超限，已截断 3 个大型工具输出。');
    expect(summary).not.toContain('恢复策略：');
  });
});
