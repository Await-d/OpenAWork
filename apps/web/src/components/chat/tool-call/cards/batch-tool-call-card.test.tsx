// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react';
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
});
