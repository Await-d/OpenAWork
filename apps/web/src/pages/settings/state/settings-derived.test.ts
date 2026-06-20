import { describe, expect, it } from 'vitest';

import {
  buildDevEventsFromLogs,
  formatUpstreamStreamSummary,
} from './settings-derived.js';
import type { SettingsDevLogRecord } from './settings-types.js';

describe('formatUpstreamStreamSummary', () => {
  it('把上游流摘要格式化成可读中文文案', () => {
    expect(
      formatUpstreamStreamSummary({
        stopReason: 'end_turn',
        textDeltaCount: 12,
        reasoningDeltaCount: 2,
        toolCallDeltaCount: 1,
        sawDone: true,
        sawError: false,
        stalled: false,
      }),
    ).toBe('上游流摘要：正常结束 · 文本 12 / 思考 2 / 工具 1 · done');
  });

  it('遇到 stall 时优先暴露 stalled 标记', () => {
    expect(
      formatUpstreamStreamSummary({
        stopReason: 'error',
        textDeltaCount: 0,
        reasoningDeltaCount: 0,
        toolCallDeltaCount: 0,
        sawDone: false,
        sawError: true,
        stalled: true,
      }),
    ).toBe('上游流摘要：上游错误 · 文本 0 / 思考 0 / 工具 0 · stalled / error');
  });
});

describe('buildDevEventsFromLogs', () => {
  it('为上游流摘要日志生成可读 label', () => {
    const logs: SettingsDevLogRecord[] = [
      {
        level: 'info',
        message: 'stream:V2_UPSTREAM_STREAM_SUMMARY 执行完成',
        source: 'stream:V2_UPSTREAM_STREAM_SUMMARY',
        timestamp: Date.now(),
        output: {
          stopReason: 'cancelled',
          textDeltaCount: 4,
          reasoningDeltaCount: 0,
          toolCallDeltaCount: 0,
          sawDone: false,
          sawError: false,
          stalled: false,
        },
      },
    ];

    const events = buildDevEventsFromLogs(logs);
    expect(events[0]?.label).toBe('上游流摘要：请求取消 · 文本 4 / 思考 0 / 工具 0');
  });
});
