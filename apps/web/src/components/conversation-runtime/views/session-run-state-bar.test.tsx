// @vitest-environment jsdom
import React from 'react';
import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';

import { SessionRunStateBar } from './session-run-state-bar.js';

afterEach(() => {
  cleanup();
});

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

  it('在有待审批权限时展示「等待审批」而非「持续运行中」', () => {
    render(<SessionRunStateBar status="running" pendingPermissionsCount={1} />);

    expect(screen.getByText('会话等待审批')).toBeTruthy();
    expect(screen.queryAllByText(/持续运行中/)).toHaveLength(0);
  });

  it('在有待回答问题且无待审批权限时展示「等待回答」', () => {
    render(<SessionRunStateBar status="running" pendingQuestionsCount={1} />);

    expect(screen.getByText('会话等待回答')).toBeTruthy();
  });

  it('在重新接入且无待办交互时展示「恢复中」而非「持续运行中」', () => {
    render(<SessionRunStateBar status="running" reconnecting />);

    expect(screen.getByText('会话恢复中')).toBeTruthy();
    expect(screen.queryAllByText(/持续运行中/)).toHaveLength(0);
  });

  it('在上一轮因权限暂停中断、正在继续同一次回答时展示「继续中」而非「恢复中」', () => {
    render(
      <SessionRunStateBar
        status="running"
        latestUpstreamSummary={{
          stopReason: 'tool_permission',
          textDeltaCount: 0,
          reasoningDeltaCount: 0,
          toolCallDeltaCount: 1,
          sawDone: true,
          sawError: false,
          stalled: false,
        }}
      />,
    );

    expect(screen.getByText('会话继续中')).toBeTruthy();
    expect(screen.queryAllByText(/持续运行中/)).toHaveLength(0);
    expect(screen.queryAllByText(/会话恢复中/)).toHaveLength(0);
  });

  it('在待审批权限、重连与权限续跑信号同时存在时，待审批优先展示「等待审批」', () => {
    render(
      <SessionRunStateBar
        status="running"
        pendingPermissionsCount={1}
        reconnecting
        latestUpstreamSummary={{
          stopReason: 'tool_permission',
          textDeltaCount: 0,
          reasoningDeltaCount: 0,
          toolCallDeltaCount: 1,
          sawDone: true,
          sawError: false,
          stalled: false,
        }}
      />,
    );

    expect(screen.getByText('会话等待审批')).toBeTruthy();
  });
});
