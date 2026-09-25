// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { useDisplayPreferencesStore } from '../../../../stores/settings/display-preferences.js';
import { BatchToolCallCard } from './batch-tool-call-card.js';

vi.mock('@openAwork/shared-ui', () => ({
  resolveToolVisualStatus: ({ isError, status }: { isError?: boolean; status?: string }) =>
    isError ? 'failed' : status === 'completed' ? 'completed' : 'running',
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

  it('子行常驻可见的展开线索（chevron），展开态标记在按钮上', () => {
    const view = render(
      <BatchToolCallCard
        input={{
          tool_calls: [{ tool: 'read', parameters: { file_path: 'src/a.ts' } }],
        }}
        output={{ results: [{ tool: 'read', output: 'file content' }] }}
        renderToolCallDisplay={() => <div data-testid="batch-detail" />}
      />,
    );

    const row = view.container.querySelector('.tool-call-batch-child-row');
    expect(view.container.querySelector('.tool-call-batch-child-chevron')).not.toBeNull();
    expect(row?.getAttribute('aria-expanded')).toBe('false');

    fireEvent.click(row!);
    expect(row?.getAttribute('aria-expanded')).toBe('true');
  });

  it('运行中的批次渲染进度条（完成 / 失败比例），终态移除', () => {
    const running = render(
      <BatchToolCallCard
        input={{
          tool_calls: [
            { tool: 'read', parameters: {} },
            { tool: 'read', parameters: {} },
          ],
        }}
        output={{ results: [{ tool: 'read', status: 'running' }, { tool: 'read' }] }}
        status="running"
        renderToolCallDisplay={() => <div />}
      />,
    );

    const bar = running.container.querySelector('[role="progressbar"]');
    expect(bar?.getAttribute('aria-valuenow')).toBe('1');
    expect(bar?.getAttribute('aria-valuemax')).toBe('2');
    cleanup();

    const done = render(
      <BatchToolCallCard
        input={{ tool_calls: [{ tool: 'read', parameters: {} }] }}
        output={{ results: [{ tool: 'read' }] }}
        status="completed"
        renderToolCallDisplay={() => <div />}
      />,
    );
    // 终态进度条会被误读成一条分隔线，信息由「N/M 完成」承担。
    expect(done.container.querySelector('[role="progressbar"]')).toBeNull();
  });

  it('子行展开时把 embedded 透传给嵌套渲染器（嵌套卡不再重复 header）', () => {
    const renderToolCallDisplay = vi.fn(() => <div data-testid="batch-detail" />);
    render(
      <BatchToolCallCard
        input={{ tool_calls: [{ tool: 'bash', parameters: { command: 'ls' } }] }}
        output={{ results: [{ tool: 'bash', status: 'completed' }] }}
        renderToolCallDisplay={renderToolCallDisplay}
      />,
    );

    fireEvent.click(screen.getByRole('button', { expanded: false }));

    expect(renderToolCallDisplay).toHaveBeenCalledWith(expect.objectContaining({ embedded: true }));
  });
});
