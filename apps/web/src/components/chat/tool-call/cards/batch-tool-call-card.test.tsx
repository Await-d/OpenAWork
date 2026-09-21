// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { useDisplayPreferencesStore } from '../../../../stores/settings/display-preferences.js';
import { BatchToolCallCard } from './batch-tool-call-card.js';

vi.mock('@openAwork/shared-ui', () => ({
  resolveToolVisualStatus: () => 'completed',
}));

vi.mock('../display/tool-icon.js', () => ({
  ToolIcon: () => <span data-testid="tool-icon" />,
}));

vi.mock('../shared/tool-approval-actions.js', () => ({
  ToolApprovalActions: () => null,
}));

describe('BatchToolCallCard', () => {
  beforeEach(() => {
    useDisplayPreferencesStore.setState({ toolCallsExpandedByDefault: false });
  });

  afterEach(() => {
    cleanup();
    useDisplayPreferencesStore.setState({ toolCallsExpandedByDefault: false });
  });

  it('默认关闭批量子工具详情，保留摘要行', () => {
    render(
      <BatchToolCallCard
        input={{
          tool_calls: [{ tool: 'read', parameters: { file_path: 'src/a.ts' } }],
        }}
        output={{
          results: [
            {
              tool: 'read',
              output: 'file content',
            },
          ],
        }}
        renderToolCallDisplay={({ toolName }) => <div data-testid="batch-detail">{toolName}</div>}
      />,
    );

    expect(screen.getByRole('button', { expanded: false })).toBeTruthy();
    expect(screen.queryByTestId('batch-detail')).toBeNull();
  });

  it('开启默认展开后自动展开批量子工具详情', () => {
    useDisplayPreferencesStore.setState({
      toolCallsExpandedByDefault: true,
      toolExpandedOverrides: {
        bash: false,
        fileEdit: false,
        fileRead: true,
        mcp: false,
        skill: false,
        web: false,
        batch: false,
        other: false,
      },
    });

    render(
      <BatchToolCallCard
        input={{
          tool_calls: [{ tool: 'read', parameters: { file_path: 'src/a.ts' } }],
        }}
        output={{
          results: [
            {
              tool: 'read',
              output: 'file content',
            },
          ],
        }}
        renderToolCallDisplay={({ toolName }) => <div data-testid="batch-detail">{toolName}</div>}
      />,
    );

    expect(screen.getByRole('button', { expanded: true })).toBeTruthy();
    expect(screen.getByTestId('batch-detail')).toBeTruthy();
  });

  it('运行期间不再自动展开，点击行后才展示子工具详情', () => {
    render(
      <BatchToolCallCard
        input={{
          tool_calls: [{ tool: 'read', parameters: { file_path: 'src/a.ts' } }],
        }}
        output={{
          results: [
            {
              tool: 'read',
              status: 'running',
              output: 'partial content',
            },
          ],
        }}
        renderToolCallDisplay={({ toolName }) => <div data-testid="batch-detail">{toolName}</div>}
      />,
    );

    expect(screen.getByRole('button', { expanded: false })).toBeTruthy();
    expect(screen.queryByTestId('batch-detail')).toBeNull();

    fireEvent.click(screen.getByRole('button', { expanded: false }));

    expect(screen.getByRole('button', { expanded: true })).toBeTruthy();
    expect(screen.getByTestId('batch-detail')).toBeTruthy();
  });

  it('等待权限的子调用渲染为待审批而不是失败', () => {
    const view = render(
      <BatchToolCallCard
        input={{
          tool_calls: [{ tool: 'bash', parameters: { command: 'rm -rf /tmp/demo' } }],
        }}
        output={{
          results: [
            {
              tool: 'bash',
              status: 'error',
              isError: true,
              output:
                'Tool "bash" requires approval before it can run. Permission request req-1 has been created. Ask the user to approve it, then retry.',
            },
          ],
        }}
        renderToolCallDisplay={({ toolName }) => <div data-testid="batch-detail">{toolName}</div>}
      />,
    );

    const row = view.container.querySelector('[data-batch-sub-status="pending"]');
    expect(row).not.toBeNull();
    expect(screen.getByText('待审批')).toBeTruthy();
    expect(view.container.querySelector('[data-batch-sub-status="failed"]')).toBeNull();
    // 聚合计数必须把待审批排除在「完成 / 失败」之外，否则批次头部会错报
    // 「1/1 完成 · 1 失败」，让用户以为工具已经失败而不是在等审批。
    expect(screen.getByText('1 待审批…')).toBeTruthy();
    expect(screen.queryByText('1 失败')).toBeNull();
    expect(screen.queryByText('1/1 完成')).toBeNull();
  });
});
