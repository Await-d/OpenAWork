// @vitest-environment jsdom
import React from 'react';
import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';

import { SessionRunStateBar } from './session-run-state-bar.js';

describe('SessionRunStateBar', () => {
  it('在运行状态中展示最近上游流摘要', () => {
    render(
      <SessionRunStateBar
        status="running"
        latestUpstreamSummary={{
          stopReason: 'end_turn',
          textDeltaCount: 6,
          reasoningDeltaCount: 2,
          toolCallDeltaCount: 1,
          sawDone: true,
          sawError: false,
          stalled: false,
        }}
      />,
    );

    expect(screen.getByText(/流摘要 文本 6 \/ 思考 2 \/ 工具 1 \/ done/)).toBeTruthy();
  });
});
