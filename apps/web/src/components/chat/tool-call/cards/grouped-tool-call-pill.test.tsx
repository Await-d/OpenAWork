// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { useDisplayPreferencesStore } from '../../../../stores/settings/display-preferences.js';
import { GroupedToolCallPill } from './grouped-tool-call-pill.js';

vi.mock('../display/tool-icon.js', () => ({
  ToolIcon: () => <span data-testid="tool-icon" />,
}));

vi.mock('../display/tool-call-display.js', () => ({
  ToolCallDisplay: ({ toolName }: { toolName: string }) => (
    <div data-testid="grouped-tool-child">{toolName}</div>
  ),
}));

describe('GroupedToolCallPill', () => {
  beforeEach(() => {
    useDisplayPreferencesStore.setState({ toolCallsExpandedByDefault: false });
  });

  afterEach(() => {
    cleanup();
    useDisplayPreferencesStore.setState({ toolCallsExpandedByDefault: false });
  });

  it('默认遵循工具展开设置，关闭时只显示摘要', () => {
    render(
      <GroupedToolCallPill
        toolName="read"
        calls={[
          {
            toolName: 'read',
            input: { file_path: 'src/a.ts' },
            status: 'completed',
          },
          {
            toolName: 'read',
            input: { file_path: 'src/b.ts' },
            status: 'completed',
          },
        ]}
      />,
    );

    expect(screen.getByRole('button', { expanded: false })).toBeTruthy();
    expect(screen.queryAllByTestId('grouped-tool-child')).toHaveLength(0);
  });

  it('开启默认展开后自动展开分组工具详情', () => {
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
      <GroupedToolCallPill
        toolName="read"
        calls={[
          {
            toolName: 'read',
            input: { file_path: 'src/a.ts' },
            status: 'completed',
          },
          {
            toolName: 'read',
            input: { file_path: 'src/b.ts' },
            status: 'completed',
          },
        ]}
      />,
    );

    expect(screen.getByRole('button', { expanded: true })).toBeTruthy();
    expect(screen.getAllByTestId('grouped-tool-child')).toHaveLength(2);
  });

  it('运行期间自动展开的分组详情在完成后按默认折叠设置收起', () => {
    const view = render(
      <GroupedToolCallPill
        toolName="read"
        calls={[
          {
            toolName: 'read',
            input: { file_path: 'src/a.ts' },
            status: 'running',
          },
          {
            toolName: 'read',
            input: { file_path: 'src/b.ts' },
            status: 'completed',
          },
        ]}
      />,
    );

    expect(screen.getByRole('button', { expanded: true })).toBeTruthy();
    view.rerender(
      <GroupedToolCallPill
        toolName="read"
        calls={[
          {
            toolName: 'read',
            input: { file_path: 'src/a.ts' },
            status: 'completed',
          },
          {
            toolName: 'read',
            input: { file_path: 'src/b.ts' },
            status: 'completed',
          },
        ]}
      />,
    );

    expect(screen.getByRole('button', { expanded: false })).toBeTruthy();
    expect(screen.queryAllByTestId('grouped-tool-child')).toHaveLength(0);
  });
});
