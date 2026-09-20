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
import type { ChatOverviewTabContentProps } from './chat-overview-tab-content.js';

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

function createOverviewProps(
  overrides: Partial<ChatOverviewTabContentProps> = {},
): ChatOverviewTabContentProps {
  return {
    attachmentItems: [],
    artifactsWorkspaceHref: null,
    childSessions: [],
    compactions: [],
    contextUsageSnapshot: null,
    contentArtifactCount: 0,
    contentArtifactCountStatus: 'ready',
    currentSessionId: 'session-1',
    dialogueMode: 'coding',
    effectiveWorkingDirectory: '/workspace/demo',
    messages: [],
    onCompactSession: () => {},
    onOpenRecoveryStrategy: () => {},
    pendingPermissions: [],
    pendingQuestionsCount: 0,
    sessionStateStatus: 'running',
    sessionTasks: [],
    sessionTodos: [],
    upstreamSummaries: [],
    workspaceFileItems: [],
    yoloMode: false,
    ...overrides,
  };
}

function renderOverview(overrides: Partial<ChatOverviewTabContentProps> = {}) {
  return render(
    <MemoryRouter>
      <ChatOverviewTabContent {...createOverviewProps(overrides)} />
    </MemoryRouter>,
  );
}

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
    renderOverview({
      focusedUpstreamGroupKey: 'request:req-ui-1',
      upstreamSummaries,
    });

    fireEvent.click(screen.getByRole('button', { name: '诊断' }));
    fireEvent.click(screen.getByRole('button', { name: '会话元信息' }));

    expect(screen.getAllByText('当前聚焦请求').length).toBeGreaterThan(0);
    expect(screen.getAllByText('请求 req-ui-1').length).toBeGreaterThan(0);
    expect(screen.getByText('2 条 · 错误 1 / 卡住 1 / 工具 2')).toBeTruthy();
    // 未传 permissionMode 时按 legacy yoloMode 布尔回退：false → 「每次询问」。
    expect(screen.getByText('每次询问')).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: '复制当前聚焦请求诊断上下文' }));

    expect(copyTextToClipboardMock).toHaveBeenCalledTimes(1);
    const copiedText = copyTextToClipboardMock.mock.calls[0]?.[0];
    expect(copiedText).toContain('请求 req-ui-1');
  });

  it('overview 按档位展示审批方式文案（每次询问 / 编辑自动 / 免审批）', () => {
    const renderWithMode = (permissionMode: 'ask' | 'auto-edit' | 'yolo', yoloMode: boolean) => {
      renderOverview({ permissionMode, yoloMode });
      fireEvent.click(screen.getByRole('button', { name: '会话元信息' }));
    };

    renderWithMode('ask', false);
    expect(screen.getByText('审批方式')).toBeTruthy();
    expect(screen.getByText('每次询问')).toBeTruthy();
    cleanup();

    renderWithMode('auto-edit', false);
    expect(screen.getByText('编辑自动')).toBeTruthy();
    cleanup();

    renderWithMode('yolo', true);
    expect(screen.getByText('免审批（YOLO）')).toBeTruthy();
  });

  it('overview 合并 runtimeSummary 后每个 datum 只渲染一次（子会话 / 待处理审批以会话数据为准）', () => {
    renderOverview({
      childSessions: [{ id: 'child-session-1', title: '子代理会话' }],
      pendingPermissions: [
        {
          createdAt: '2026-06-14T10:20:30.000Z',
          reason: '需要写入工作区',
          requestId: 'perm-1',
          riskLevel: 'medium',
          scope: 'write',
          sessionId: 'session-1',
          status: 'pending',
          toolName: 'write_file',
        },
      ],
      sessionTasks: [
        {
          blockedBy: [],
          completedSubtaskCount: 0,
          createdAt: 1,
          depth: 0,
          id: 'task-1',
          priority: 'medium',
          readySubtaskCount: 0,
          status: 'running',
          subtaskCount: 0,
          tags: [],
          title: '运行中的任务',
          unmetDependencyCount: 0,
          updatedAt: 1,
        },
      ],
      runtimeSummary: {
        activePlanTaskCount: 2,
        childSessionCount: 9,
        dagEdgeCount: 2,
        dagNodeCount: 3,
        failedToolCallCount: 1,
        mcpServerCount: 4,
        pendingPermissionCount: 7,
        toolCallCount: 5,
        totalPlanTaskCount: 6,
      },
    });

    const metricTiles = screen.getAllByRole('listitem').map((tile) => tile.textContent);
    expect(metricTiles.filter((tile) => tile?.startsWith('子会话'))).toEqual(['子会话1 个']);
    expect(metricTiles.filter((tile) => tile?.startsWith('待处理审批'))).toEqual([
      '待处理审批1 项',
    ]);
    expect(metricTiles.filter((tile) => tile?.startsWith('计划任务'))).toEqual([]);
    expect(screen.queryByText('9 个')).toBeNull();
    expect(screen.queryByText('待审批')).toBeNull();
    expect(screen.getAllByText('计划任务')).toHaveLength(1);
    expect(screen.getByText('2/6 项')).toBeTruthy();
    expect(screen.getByText('任务状态')).toBeTruthy();
    expect(screen.getByText('进行中 1')).toBeTruthy();
  });

  it('overview 折叠区块翻转 aria-expanded 并同步显隐 aria-controls 指向的正文', () => {
    renderOverview();

    const toggle = screen.getByRole('button', { name: '诊断' });
    const contentId = toggle.getAttribute('aria-controls');
    expect(contentId).not.toBeNull();
    expect(toggle.getAttribute('aria-expanded')).toBe('false');
    expect(document.getElementById(contentId ?? '')?.hasAttribute('hidden')).toBe(true);

    fireEvent.click(toggle);

    expect(toggle.getAttribute('aria-expanded')).toBe('true');
    expect(document.getElementById(contentId ?? '')?.hasAttribute('hidden')).toBe(false);
    expect(screen.getByText('检查点与恢复')).toBeTruthy();
  });
});
