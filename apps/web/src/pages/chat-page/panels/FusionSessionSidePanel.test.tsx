// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useUIStateStore } from '../../../stores/ui/uiState.js';
import { FusionDockedSidePanel } from './FusionDockedSidePanel.js';
import { FusionSessionSidePanel } from './FusionSessionSidePanel.js';
import {
  makeReviewPanelDiffEntry,
  makeReviewPanelProjection,
} from './review-panel-test-fixtures.js';

const getFileChangesMock = vi.fn();

vi.mock('@openAwork/web-client', () => ({
  createSessionsClient: () => ({
    getFileChanges: getFileChangesMock,
  }),
}));

vi.mock('@openAwork/shared-ui', () => ({
  ContextPanel: () => <div data-testid="context-panel-mock" />,
  PlanHistoryPanel: () => <div data-testid="plan-history-panel-mock" />,
  UnifiedCodeDiff: (props: { readonly afterText?: string; readonly beforeText?: string }) => (
    <pre>{props.afterText ?? props.beforeText ?? ''}</pre>
  ),
}));

function resetUiState(): void {
  useUIStateStore.setState({
    reviewPanelOpened: true,
    reviewPanelWidth: 400,
    sidePanelActiveTab: 'review',
  });
}

const BASE_PROPS = {
  contextUsageSnapshot: null,
  currentSessionId: 'session-1',
  effectiveWorkingDirectory: '/home/await/project/OpenAWork',
  gatewayUrl: 'http://localhost:3000',
  onCompactSession: () => undefined,
  onOpenWorkspace: () => undefined,
  onTabChange: () => undefined,
  token: 'token',
  workspaceFileItems: [],
} as const;

const RUNTIME_SUMMARY = {
  activePlanTaskCount: 2,
  childSessionCount: 1,
  dagEdgeCount: 2,
  dagNodeCount: 3,
  failedToolCallCount: 1,
  mcpServerCount: 4,
  pendingPermissionCount: 1,
  toolCallCount: 5,
  totalPlanTaskCount: 6,
} as const;

beforeEach(() => {
  cleanup();
  getFileChangesMock.mockReset();
  Object.defineProperty(HTMLElement.prototype, 'setPointerCapture', {
    configurable: true,
    value: vi.fn(),
  });
  Object.defineProperty(HTMLElement.prototype, 'releasePointerCapture', {
    configurable: true,
    value: vi.fn(),
  });
  resetUiState();
});

afterEach(() => {
  cleanup();
  resetUiState();
});

describe('FusionSessionSidePanel', () => {
  it('在审查 tab 展示真实变更数量与 diff 内容', async () => {
    getFileChangesMock.mockResolvedValue(
      makeReviewPanelProjection([
        makeReviewPanelDiffEntry('src/app.ts', {
          additions: 3,
          after: 'export const layout = "fusion";\n',
          deletions: 1,
        }),
        makeReviewPanelDiffEntry('src/team.ts', {
          additions: 1,
          deletions: 0,
        }),
      ]),
    );

    render(<FusionSessionSidePanel {...BASE_PROPS} activeTab="review" />);

    await waitFor(() => {
      expect(screen.getAllByText('src/app.ts').length).toBeGreaterThan(0);
    });

    expect(screen.getAllByRole('tab', { name: /审查/ })[0]?.textContent).toContain('2');
    expect(screen.getByText('2 文件 · +4 / -1 · 强保证')).not.toBeNull();
    expect(screen.getByText(/export const layout/)).not.toBeNull();
  });

  it('侧栏 tab 使用可访问 tablist 并上报切换动作', () => {
    getFileChangesMock.mockResolvedValue(makeReviewPanelProjection([]));
    const onTabChange = vi.fn();

    render(<FusionSessionSidePanel {...BASE_PROPS} activeTab="review" onTabChange={onTabChange} />);

    const tablist = screen.getByRole('tablist', { name: '会话侧面板' });
    const reviewTab = screen.getByRole('tab', { name: '审查' });
    const filesTab = screen.getByRole('tab', { name: '文件' });

    expect(tablist).not.toBeNull();
    expect(reviewTab.getAttribute('aria-selected')).toBe('true');

    fireEvent.click(filesTab);

    expect(onTabChange).toHaveBeenCalledWith('files');
  });

  it('侧栏 tab 支持方向键切换焦点和激活目标', () => {
    getFileChangesMock.mockResolvedValue(makeReviewPanelProjection([]));
    const onTabChange = vi.fn();

    render(<FusionSessionSidePanel {...BASE_PROPS} activeTab="review" onTabChange={onTabChange} />);

    const reviewTab = screen.getByRole('tab', { name: '审查' });
    const filesTab = screen.getByRole('tab', { name: '文件' });

    reviewTab.focus();
    fireEvent.keyDown(reviewTab, { key: 'ArrowRight' });

    expect(onTabChange).toHaveBeenCalledWith('files');
    expect(document.activeElement).toBe(filesTab);
  });

  it('在文件 tab 展示工作区文件上下文并触发工作区选择', () => {
    getFileChangesMock.mockResolvedValue(makeReviewPanelProjection([]));
    const openWorkspace = vi.fn();

    render(
      <FusionSessionSidePanel
        {...BASE_PROPS}
        activeTab="files"
        onOpenWorkspace={openWorkspace}
        workspaceFileItems={[
          {
            label: 'ChatPage.tsx',
            path: '/home/await/project/OpenAWork/apps/web/src/pages/chat-page/ChatPage.tsx',
            relativePath: 'apps/web/src/pages/chat-page/ChatPage.tsx',
          },
        ]}
      />,
    );

    expect(screen.getByText('1 个索引文件')).not.toBeNull();
    expect(screen.getByText('ChatPage.tsx')).not.toBeNull();

    fireEvent.click(screen.getByRole('button', { name: '选择工作区' }));

    expect(openWorkspace).toHaveBeenCalledTimes(1);
  });

  it('在 Context tab 展示 token 用量并保留压缩入口', () => {
    getFileChangesMock.mockResolvedValue(makeReviewPanelProjection([]));
    const compactSession = vi.fn();

    render(
      <FusionSessionSidePanel
        {...BASE_PROPS}
        activeTab="context"
        contextUsageSnapshot={{ estimated: false, maxTokens: 4000, usedTokens: 2000 }}
        onCompactSession={compactSession}
      />,
    );

    expect(screen.getByText('50% 已用')).not.toBeNull();
    expect(screen.getByRole('meter', { name: '上下文用量' }).getAttribute('aria-valuenow')).toBe(
      '2000',
    );

    fireEvent.click(screen.getByRole('button', { name: '压缩会话' }));

    expect(compactSession).toHaveBeenCalledTimes(1);
  });

  it('在 Context tab 展示 Fusion 运行摘要，覆盖工具、计划、DAG、MCP 和审批信号', () => {
    getFileChangesMock.mockResolvedValue(makeReviewPanelProjection([]));

    render(
      <FusionSessionSidePanel
        {...BASE_PROPS}
        activeTab="context"
        runtimeSummary={RUNTIME_SUMMARY}
      />,
    );

    expect(screen.getByText('工具调用')).not.toBeNull();
    expect(screen.getByText('5 次')).not.toBeNull();
    expect(screen.getByText('1 个失败')).not.toBeNull();
    expect(screen.getByText('计划任务')).not.toBeNull();
    expect(screen.getByText('2/6 进行中')).not.toBeNull();
    expect(screen.getByText('DAG')).not.toBeNull();
    expect(screen.getByText('3 节点 / 2 边')).not.toBeNull();
    expect(screen.getByText('MCP')).not.toBeNull();
    expect(screen.getByText('4 个服务')).not.toBeNull();
    expect(screen.getByText('待审批')).not.toBeNull();
    expect(screen.getByText('1 项')).not.toBeNull();
    expect(screen.getByText('子会话')).not.toBeNull();
    expect(screen.getByText('1 个')).not.toBeNull();
  });

  it('在 Context tab 融合旧版概览信息并避免重复 fallback 小卡', () => {
    getFileChangesMock.mockResolvedValue(makeReviewPanelProjection([]));
    const openRecoveryStrategy = vi.fn();

    render(
      <FusionSessionSidePanel
        {...BASE_PROPS}
        activeTab="context"
        overview={{
          attachmentItems: [],
          artifactsWorkspaceHref: null,
          childSessions: [],
          compactions: [],
          contextUsageSnapshot: null,
          contentArtifactCount: 2,
          contentArtifactCountStatus: 'ready',
          currentSessionId: 'session-1',
          dialogueMode: 'coding',
          effectiveWorkingDirectory: '/home/await/project/OpenAWork',
          messages: [],
          onCompactSession: () => undefined,
          onOpenRecoveryStrategy: openRecoveryStrategy,
          pendingPermissions: [],
          pendingQuestionsCount: 1,
          sessionStateStatus: 'paused',
          sessionTasks: [],
          sessionTodos: [],
          upstreamSummaries: [],
          workspaceFileItems: [],
          yoloMode: false,
        }}
      />,
    );

    expect(screen.getByText('消息数量')).not.toBeNull();
    expect(screen.getByText('0 条')).not.toBeNull();
    expect(screen.getByText('产物工作区')).not.toBeNull();
    expect(screen.getByText('2 个')).not.toBeNull();
    expect(screen.queryByText('剩余 Token')).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: '恢复详情' }));

    expect(openRecoveryStrategy).toHaveBeenCalledTimes(1);
  });

  it('在融合 dock 内拖拽手柄可调整右侧面板宽度', () => {
    getFileChangesMock.mockResolvedValue(makeReviewPanelProjection([]));

    render(<FusionDockedSidePanel {...BASE_PROPS} activeTab="files" />);

    expect(screen.getByTestId('fusion-docked-side-panel').style.flex).toBe('1 1 400px');

    const handle = screen.getByRole('separator', { name: '拖拽调整面板宽度' });
    fireEvent.pointerDown(handle, { clientX: 500, pointerId: 1 });
    fireEvent.pointerMove(handle, { clientX: 460, pointerId: 1 });
    fireEvent.pointerUp(handle, { clientX: 460, pointerId: 1 });

    expect(useUIStateStore.getState().reviewPanelWidth).toBe(440);
  });
});
