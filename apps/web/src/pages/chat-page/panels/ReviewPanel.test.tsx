// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ReviewPanel } from './ReviewPanel.js';
import {
  makeReviewPanelDiffEntry,
  makeReviewPanelProjection,
} from './review-panel-test-fixtures.js';
import { useUIStateStore } from '../../../stores/ui/uiState.js';

const getFileChangesMock = vi.fn();

vi.mock('@openAwork/web-client', () => ({
  createSessionsClient: () => ({
    getFileChanges: getFileChangesMock,
  }),
}));

function resetUiState(): void {
  useUIStateStore.setState({
    reviewPanelOpened: true,
    reviewPanelWidth: 360,
  });
}

beforeEach(() => {
  cleanup();
  getFileChangesMock.mockReset();
  resetUiState();
});

afterEach(() => {
  cleanup();
  resetUiState();
});

describe('ReviewPanel', () => {
  it('加载当前会话的真实文件变更并展示 diff', async () => {
    getFileChangesMock.mockResolvedValue(
      makeReviewPanelProjection([
        makeReviewPanelDiffEntry('src/app.ts', {
          additions: 2,
          after: 'export const title = \"new\";\nexport const mode = \"fusion\";\n',
          before: 'export const title = \"old\";\n',
          deletions: 1,
        }),
      ]),
    );

    render(<ReviewPanel gatewayUrl="http://localhost:3000" sessionId="session-1" token="token" />);

    await waitFor(() => {
      expect(screen.getAllByText('src/app.ts').length).toBeGreaterThan(0);
    });

    expect(getFileChangesMock).toHaveBeenCalledWith(
      'token',
      'session-1',
      expect.objectContaining({ includeText: true }),
    );
    expect(screen.getByText('1')).not.toBeNull();
    expect(screen.getByText('1 文件 · +2 / -1 · 强保证')).not.toBeNull();
    expect(screen.getByText('+2')).not.toBeNull();
    expect(screen.getByText('-1')).not.toBeNull();
    expect(screen.getAllByText('hash_edit').length).toBeGreaterThan(0);
    expect(screen.getByText(/export const title/)).not.toBeNull();
  });

  it('选择文件时更新选中态与 Diff 预览', async () => {
    getFileChangesMock.mockResolvedValue(
      makeReviewPanelProjection(
        [
          makeReviewPanelDiffEntry('src/first.ts', {
            additions: 2,
            after: 'export const first = "new";\n',
            before: 'export const first = "old";\n',
            deletions: 1,
          }),
          makeReviewPanelDiffEntry('src/second.ts', {
            additions: 1,
            after: 'export const second = true;\n',
            deletions: 0,
            guaranteeLevel: 'medium',
            sourceKind: 'session_snapshot',
            status: 'added',
            toolName: 'snapshot',
          }),
        ],
        { summary: { weakestGuaranteeLevel: 'medium' } },
      ),
    );

    render(<ReviewPanel gatewayUrl="http://localhost:3000" sessionId="session-1" token="token" />);

    const firstFile = await screen.findByRole('button', {
      name: 'src/first.ts，修改，新增 2 行，删除 1 行',
    });
    const secondFile = screen.getByRole('button', {
      name: 'src/second.ts，新增，新增 1 行，删除 0 行',
    });

    expect(firstFile.getAttribute('aria-pressed')).toBe('true');
    expect(firstFile.getAttribute('aria-current')).toBe('true');
    expect(secondFile.getAttribute('aria-pressed')).toBe('false');
    expect(secondFile.hasAttribute('aria-current')).toBe(false);
    expect(screen.getByText(/export const first/)).not.toBeNull();

    fireEvent.click(secondFile);

    expect(firstFile.getAttribute('aria-pressed')).toBe('false');
    expect(firstFile.hasAttribute('aria-current')).toBe(false);
    expect(secondFile.getAttribute('aria-pressed')).toBe('true');
    expect(secondFile.getAttribute('aria-current')).toBe('true');
    expect(screen.getByText(/export const second/)).not.toBeNull();
  });

  it('将文件变更中的 HTML payload 作为文本展示', async () => {
    const imageErrorSpy = vi.fn();
    getFileChangesMock.mockResolvedValue(
      makeReviewPanelProjection([
        makeReviewPanelDiffEntry('src/<img src=x onerror=window.__reviewPanelPayload()>.ts', {
          additions: 1,
          after: '<img src=x onerror="window.__reviewPanelPayload()">\n',
          before: '<script>window.__reviewPanelPayload()</script>\n',
          deletions: 1,
          toolName: '<script>window.__reviewPanelPayload()</script>',
        }),
      ]),
    );
    Object.defineProperty(window, '__reviewPanelPayload', {
      configurable: true,
      value: imageErrorSpy,
    });

    const { container } = render(
      <ReviewPanel gatewayUrl="http://localhost:3000" sessionId="session-1" token="token" />,
    );

    await waitFor(() => {
      expect(screen.getAllByText(/window.__reviewPanelPayload/).length).toBeGreaterThan(0);
    });

    expect(container.querySelector('img')).toBeNull();
    expect(container.querySelector('script')).toBeNull();
    expect(imageErrorSpy).not.toHaveBeenCalled();
  });

  it('切换当前范围后使用当前请求快照计算摘要', async () => {
    const currentFile = makeReviewPanelDiffEntry('src/current.ts', {
      additions: 1,
      after: 'export const current = true;\n',
      deletions: 0,
      status: 'added',
    });

    getFileChangesMock.mockResolvedValue(
      makeReviewPanelProjection(
        [
          makeReviewPanelDiffEntry('src/all.ts', {
            additions: 6,
            after: 'export const all = true;\n',
            deletions: 2,
            guaranteeLevel: 'medium',
            sourceKind: 'session_snapshot',
            toolName: 'snapshot',
          }),
          currentFile,
        ],
        {
          snapshots: [
            {
              createdAt: '2026-07-06T07:00:00.000Z',
              files: [currentFile],
              scopeKind: 'request',
              snapshotRef: 'req:latest',
              summary: {
                additions: 1,
                deletions: 0,
                files: 1,
                guaranteeLevel: 'strong',
                sourceKinds: ['structured_tool_diff'],
              },
            },
          ],
          summary: {
            latestSnapshotAt: '2026-07-06T07:00:00.000Z',
            latestSnapshotRef: 'req:latest',
            latestSnapshotScopeKind: 'request',
            weakestGuaranteeLevel: 'medium',
          },
        },
      ),
    );

    render(<ReviewPanel gatewayUrl="http://localhost:3000" sessionId="session-1" token="token" />);

    await waitFor(() => {
      expect(screen.getAllByText('src/all.ts').length).toBeGreaterThan(0);
    });

    fireEvent.click(screen.getByRole('button', { name: '当前' }));

    await waitFor(() => {
      expect(screen.getAllByText('src/current.ts').length).toBeGreaterThan(0);
    });

    expect(screen.queryAllByText('src/all.ts')).toHaveLength(0);
    expect(screen.getByText('1 文件 · +1 / -0 · 强保证')).not.toBeNull();
    expect(screen.getByText('+1 / -0')).not.toBeNull();
    expect(screen.queryByText('+7 / -2')).toBeNull();
    expect(screen.getByRole('button', { name: '当前' }).getAttribute('aria-pressed')).toBe('true');
    expect(screen.getByRole('button', { name: '全部' }).getAttribute('aria-pressed')).toBe('false');
  });

  it('切换 Diff 视图模式时保持分段控制语义', async () => {
    getFileChangesMock.mockResolvedValue(
      makeReviewPanelProjection([makeReviewPanelDiffEntry('src/app.ts')]),
    );

    render(<ReviewPanel gatewayUrl="http://localhost:3000" sessionId="session-1" token="token" />);

    await screen.findByRole('group', { name: 'Diff 视图模式' });

    const unifiedButton = screen.getByRole('button', { name: '统一' });
    const splitButton = screen.getByRole('button', { name: '分割' });
    expect(unifiedButton.getAttribute('aria-pressed')).toBe('true');
    expect(splitButton.getAttribute('aria-pressed')).toBe('false');

    fireEvent.click(splitButton);

    expect(unifiedButton.getAttribute('aria-pressed')).toBe('false');
    expect(splitButton.getAttribute('aria-pressed')).toBe('true');
  });

  it('无文件变更时展示列表与 Diff 预览空态', async () => {
    getFileChangesMock.mockResolvedValue(
      makeReviewPanelProjection([], { summary: { snapshotCount: 0 } }),
    );

    render(<ReviewPanel gatewayUrl="http://localhost:3000" sessionId="session-1" token="token" />);

    await waitFor(() => {
      expect(screen.getAllByText('暂无文件变更')).toHaveLength(1);
    });

    expect(screen.getByText('选择文件后查看 Diff。')).not.toBeNull();
  });

  it('收起后展示可聚焦的审查 rail 并可重新展开', async () => {
    getFileChangesMock.mockResolvedValue(
      makeReviewPanelProjection([], { summary: { snapshotCount: 0 } }),
    );

    render(<ReviewPanel gatewayUrl="http://localhost:3000" sessionId="session-1" token="token" />);

    await waitFor(() => {
      expect(screen.getByRole('complementary', { name: '代码审查面板' })).toBeTruthy();
    });

    fireEvent.click(screen.getByRole('button', { name: '收起审查面板' }));

    expect(screen.queryByRole('complementary', { name: '代码审查面板' })).toBeNull();

    const collapsedRail = screen.getByRole('button', { name: '展开审查面板' });
    expect(collapsedRail.classList.contains('review-panel-collapsed-rail')).toBe(true);
    expect(collapsedRail.hasAttribute('style')).toBe(false);

    collapsedRail.focus();
    expect(document.activeElement).toBe(collapsedRail);

    fireEvent.click(collapsedRail);

    expect(screen.getByRole('complementary', { name: '代码审查面板' })).toBeTruthy();
  });

  it('无 token 时展示等待状态且不请求网关', () => {
    render(<ReviewPanel gatewayUrl="http://localhost:3000" sessionId="session-1" token={null} />);

    expect(screen.getAllByText('等待会话上下文')).toHaveLength(2);
    expect(getFileChangesMock).not.toHaveBeenCalled();
  });

  it('加载失败时展示错误态', async () => {
    getFileChangesMock.mockRejectedValue(new Error('gateway down'));

    render(<ReviewPanel gatewayUrl="http://localhost:3000" sessionId="session-1" token="token" />);

    await waitFor(() => {
      expect(screen.getAllByText('gateway down')).toHaveLength(2);
    });
  });
});
