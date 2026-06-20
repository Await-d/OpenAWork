// @vitest-environment jsdom
import React from 'react';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter } from 'react-router';

import {
  ChatHistoryTabContent,
  ChatOverviewTabContent,
  type UpstreamSummaryItem,
} from './right-panel-sections.js';

const copyTextToClipboardMock = vi.hoisted(() =>
  vi.fn<(text: string) => Promise<void>>(async () => undefined),
);

vi.mock('../../../components/layout/file-tree/file-tree-actions.js', () => ({
  copyTextToClipboard: copyTextToClipboardMock,
}));

vi.mock('@openAwork/shared-ui', () => ({
  ContextPanel: () => <div data-testid="context-panel-mock" />,
  PlanHistoryPanel: () => <div data-testid="plan-history-panel-mock" />,
}));

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

beforeEach(() => {
  copyTextToClipboardMock.mockReset().mockResolvedValue(undefined);
});

const sharedUiThemeVars: React.CSSProperties = {};

const upstreamSummaries: UpstreamSummaryItem[] = [
  {
    id: 'summary-1',
    occurredAt: new Date('2026-06-14T10:20:30+08:00').getTime(),
    requestId: 'req-ui-1',
    runId: 'run-ui-1',
    summary: {
      stopReason: 'tool_use',
      textDeltaCount: 3,
      reasoningDeltaCount: 1,
      toolCallDeltaCount: 2,
      sawDone: true,
      sawError: false,
      stalled: false,
    },
  },
  {
    id: 'summary-2',
    occurredAt: new Date('2026-06-14T10:21:00+08:00').getTime(),
    requestId: 'req-ui-1',
    runId: 'run-ui-1',
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
];

describe('right-panel-sections UI', () => {
  it('history 分组头支持复制 request 级诊断上下文', async () => {
    render(
      <ChatHistoryTabContent
        childSessions={[]}
        compactions={[]}
        upstreamSummaries={upstreamSummaries}
        pendingPermissions={[]}
        planHistory={[]}
        sessionTodos={[]}
        sessionTasks={[]}
        onOpenSession={() => {}}
        sharedUiThemeVars={sharedUiThemeVars}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: '复制请求 req-ui-1诊断上下文' }));

    expect(copyTextToClipboardMock).toHaveBeenCalledTimes(1);
    const copiedText = copyTextToClipboardMock.mock.calls[0]?.[0];
    expect(copiedText).toContain('请求 req-ui-1');
    expect(copiedText).toContain('2 条 · 错误 1 / 卡住 1 / 工具 2');
  });

  it('history 在筛选后复制时仍使用完整 request 上下文', async () => {
    render(
      <ChatHistoryTabContent
        childSessions={[]}
        compactions={[]}
        upstreamSummaries={upstreamSummaries}
        pendingPermissions={[]}
        planHistory={[]}
        sessionTodos={[]}
        sessionTasks={[]}
        onOpenSession={() => {}}
        sharedUiThemeVars={sharedUiThemeVars}
      />,
    );

    fireEvent.change(screen.getByPlaceholderText('搜索 requestId / runId / 状态…'), {
      target: { value: '上游错误' },
    });
    fireEvent.click(screen.getByRole('button', { name: '复制请求 req-ui-1诊断上下文' }));

    expect(copyTextToClipboardMock).toHaveBeenCalledTimes(1);
    const copiedText = copyTextToClipboardMock.mock.calls[0]?.[0];
    expect(copiedText).toContain('2 条 · 错误 1 / 卡住 1 / 工具 2');
    expect(copiedText).toContain('1. 等待工具 · 文本 3 / 思考 1 / 工具 2 · done');
    expect(copiedText).toContain('2. 上游错误 · 文本 0 / 思考 0 / 工具 1 · stalled');
  });

  it('overview 显式显示当前聚焦请求并支持复制上下文', async () => {
    render(
      <MemoryRouter>
        <ChatOverviewTabContent
          attachmentItems={[]}
          artifactsWorkspaceHref={null}
          childSessions={[]}
          compactions={[]}
          upstreamSummaries={upstreamSummaries}
          focusedUpstreamGroupKey="request:req-ui-1"
          contextUsageSnapshot={null}
          contentArtifactCount={0}
          contentArtifactCountStatus="ready"
          currentSessionId="session-1"
          dialogueMode="coding"
          effectiveWorkingDirectory="/workspace/demo"
          messages={[]}
          pendingPermissions={[]}
          pendingQuestionsCount={0}
          sessionStateStatus="running"
          sessionTodos={[]}
          sessionTasks={[]}
          workspaceFileItems={[]}
          yoloMode={false}
          onCompactSession={() => {}}
          onOpenRecoveryStrategy={() => {}}
        />
      </MemoryRouter>,
    );

    expect(screen.getAllByText('当前聚焦请求').length).toBeGreaterThan(0);
    expect(screen.getAllByText('请求 req-ui-1').length).toBeGreaterThan(0);
    expect(screen.getByText('2 条 · 错误 1 / 卡住 1 / 工具 2')).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: '复制当前聚焦请求诊断上下文' }));

    expect(copyTextToClipboardMock).toHaveBeenCalledTimes(1);
    const copiedText = copyTextToClipboardMock.mock.calls[0]?.[0];
    expect(copiedText).toContain('请求 req-ui-1');
  });
});
