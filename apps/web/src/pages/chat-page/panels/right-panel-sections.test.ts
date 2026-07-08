import { describe, expect, it } from 'vitest';

import {
  buildUpstreamSummaryGroupContextText,
  formatUpstreamSummaryGroupHeadline,
  groupUpstreamSummariesByRequest,
  summarizeUpstreamSummaryGroupCounts,
  type UpstreamSummaryItem,
} from './right-panel-sections.js';

describe('groupUpstreamSummariesByRequest', () => {
  it('优先按 requestId 分组，没有 requestId 时回退到 runId', () => {
    const items: UpstreamSummaryItem[] = [
      {
        id: 'a',
        occurredAt: 100,
        requestId: 'req-1',
        runId: 'run-1',
        summary: {
          stopReason: 'end_turn',
          textDeltaCount: 1,
          reasoningDeltaCount: 0,
          toolCallDeltaCount: 0,
          sawDone: true,
          sawError: false,
          stalled: false,
        },
      },
      {
        id: 'b',
        occurredAt: 200,
        requestId: 'req-1',
        runId: 'run-1',
        summary: {
          stopReason: 'tool_use',
          textDeltaCount: 0,
          reasoningDeltaCount: 0,
          toolCallDeltaCount: 1,
          sawDone: true,
          sawError: false,
          stalled: false,
        },
      },
      {
        id: 'c',
        occurredAt: 300,
        runId: 'run-2',
        summary: {
          stopReason: 'error',
          textDeltaCount: 0,
          reasoningDeltaCount: 0,
          toolCallDeltaCount: 0,
          sawDone: false,
          sawError: true,
          stalled: true,
        },
      },
    ];

    const groups = groupUpstreamSummariesByRequest(items);
    expect(groups).toHaveLength(2);
    expect(groups[0]).toMatchObject({
      key: 'request:req-1',
      label: '请求 req-1',
    });
    expect(groups[0]?.items.map((item) => item.id)).toEqual(['a', 'b']);
    expect(groups[1]).toMatchObject({
      key: 'run:run-2',
      label: '运行 run-2',
    });
    expect(groups[1]?.items.map((item) => item.id)).toEqual(['c']);
  });

  it('按组统计 error / stalled / tool 数量', () => {
    const groups = groupUpstreamSummariesByRequest([
      {
        id: 'a',
        occurredAt: 100,
        requestId: 'req-1',
        summary: {
          stopReason: 'error',
          textDeltaCount: 0,
          reasoningDeltaCount: 0,
          toolCallDeltaCount: 1,
          sawDone: false,
          sawError: true,
          stalled: true,
        },
      },
      {
        id: 'b',
        occurredAt: 200,
        requestId: 'req-1',
        summary: {
          stopReason: 'tool_use',
          textDeltaCount: 0,
          reasoningDeltaCount: 0,
          toolCallDeltaCount: 1,
          sawDone: true,
          sawError: false,
          stalled: false,
        },
      },
    ]);

    expect(summarizeUpstreamSummaryGroupCounts(groups[0]!)).toEqual({
      errorCount: 1,
      stalledCount: 1,
      toolCount: 2,
    });
  });

  it('group 顺序保留输入时间顺序，便于 overview 取聚焦组的最近摘要', () => {
    const groups = groupUpstreamSummariesByRequest([
      {
        id: 'older',
        occurredAt: 100,
        requestId: 'req-1',
        summary: {
          stopReason: 'end_turn',
          textDeltaCount: 1,
          reasoningDeltaCount: 0,
          toolCallDeltaCount: 0,
          sawDone: true,
          sawError: false,
          stalled: false,
        },
      },
      {
        id: 'newer',
        occurredAt: 200,
        requestId: 'req-1',
        summary: {
          stopReason: 'error',
          textDeltaCount: 0,
          reasoningDeltaCount: 0,
          toolCallDeltaCount: 1,
          sawDone: false,
          sawError: true,
          stalled: true,
        },
      },
    ]);

    expect(groups[0]?.items.map((item) => item.id)).toEqual(['older', 'newer']);
  });

  it('可生成用于复制的 request 级诊断上下文', () => {
    const groups = groupUpstreamSummariesByRequest([
      {
        id: 'a',
        occurredAt: new Date('2026-06-14T10:20:30+08:00').getTime(),
        requestId: 'req-copy-1',
        runId: 'run-copy-1',
        summary: {
          stopReason: 'tool_use',
          textDeltaCount: 4,
          reasoningDeltaCount: 1,
          toolCallDeltaCount: 2,
          sawDone: true,
          sawError: false,
          stalled: false,
        },
      },
      {
        id: 'b',
        occurredAt: new Date('2026-06-14T10:21:00+08:00').getTime(),
        requestId: 'req-copy-1',
        runId: 'run-copy-1',
        summary: {
          stopReason: 'error',
          textDeltaCount: 0,
          reasoningDeltaCount: 0,
          toolCallDeltaCount: 1,
          sawDone: false,
          sawError: true,
          stalled: true,
        },
      },
    ]);

    expect(formatUpstreamSummaryGroupHeadline(groups[0]!)).toBe('2 条 · 错误 1 / 卡住 1 / 工具 2');
    expect(buildUpstreamSummaryGroupContextText(groups[0]!)).toContain('请求 req-copy-1');
    expect(buildUpstreamSummaryGroupContextText(groups[0]!)).toContain(
      '2 条 · 错误 1 / 卡住 1 / 工具 2',
    );
    expect(buildUpstreamSummaryGroupContextText(groups[0]!)).toContain(
      '1. 等待工具 · 文本 4 / 思考 1 / 工具 2 · done',
    );
    expect(buildUpstreamSummaryGroupContextText(groups[0]!)).toContain(
      '2. 上游错误 · 文本 0 / 思考 0 / 工具 1 · stalled',
    );
    expect(buildUpstreamSummaryGroupContextText(groups[0]!)).toContain('10:20:30');
    expect(buildUpstreamSummaryGroupContextText(groups[0]!)).toContain('10:21:00');
  });
});
