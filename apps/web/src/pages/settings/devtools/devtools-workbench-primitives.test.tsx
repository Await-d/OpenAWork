// @vitest-environment jsdom
import React from 'react';
import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';

import { LogDetailsPanel } from './devtools-workbench-primitives.js';
import type { SettingsDevLogRecord } from '../state/settings-types.js';

describe('LogDetailsPanel', () => {
  it('为上游流摘要日志渲染专用摘要卡片', () => {
    const log: SettingsDevLogRecord = {
      level: 'info',
      message: '上游流摘要：正常结束 · 文本 8 / 思考 1 / 工具 0 · done',
      source: 'stream:V2_UPSTREAM_STREAM_SUMMARY',
      timestamp: Date.now(),
      output: {
        stopReason: 'end_turn',
        textDeltaCount: 8,
        reasoningDeltaCount: 1,
        toolCallDeltaCount: 0,
        sawDone: true,
        sawError: false,
        stalled: false,
      },
    };

    render(<LogDetailsPanel log={log} />);

    expect(screen.getByText('流式摘要')).toBeTruthy();
    expect(
      screen.getAllByText('上游流摘要：正常结束 · 文本 8 / 思考 1 / 工具 0 · done'),
    ).toHaveLength(2);
    expect(screen.getByText('文本增量')).toBeTruthy();
    expect(screen.getByText('8')).toBeTruthy();
    expect(screen.getByText('收到 done')).toBeTruthy();
    expect(screen.getByText('是')).toBeTruthy();
  });
});
