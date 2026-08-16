// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { useDisplayPreferencesStore } from '../../../../stores/settings/display-preferences.js';
import { InlineToolCall } from './inline-tool-call.js';

vi.mock('@openAwork/shared-ui', () => ({
  resolveToolVisualStatus: ({
    status,
    isError,
  }: {
    status?: 'running' | 'completed';
    isError?: boolean;
  }) => {
    if (isError) return 'failed';
    return status === 'completed' ? 'completed' : 'running';
  },
}));

vi.mock('./tool-icon', () => ({
  ToolIcon: () => <span data-testid="tool-icon" />,
}));

vi.mock('../shared/tool-approval-actions.js', () => ({
  ToolApprovalActions: () => null,
}));

vi.mock('../io/tool-input-preview.js', () => ({
  ToolInputPreview: () => <div data-testid="inline-input-preview">参数预览</div>,
}));

vi.mock('../io/tool-output-preview.js', () => ({
  ToolOutputPreview: () => <div data-testid="inline-output-preview">输出预览</div>,
}));

describe('InlineToolCall', () => {
  beforeEach(() => {
    useDisplayPreferencesStore.setState({ toolCallsExpandedByDefault: false });
  });

  afterEach(() => {
    cleanup();
    useDisplayPreferencesStore.setState({ toolCallsExpandedByDefault: false });
  });

  it('已完成的内联工具在关闭默认展开时退化为摘要展示', () => {
    render(
      <InlineToolCall
        toolName="skill"
        input={{ skillId: 'frontend', prompt: '整理展示逻辑' }}
        output={{ ok: true }}
        status="completed"
      />,
    );

    expect(screen.queryByTestId('inline-input-preview')).toBeNull();
    expect(screen.queryByTestId('inline-output-preview')).toBeNull();
  });

  it('开启默认展开后自动展示内联工具详情', () => {
    useDisplayPreferencesStore.setState({
      toolCallsExpandedByDefault: true,
      toolExpandedOverrides: {
        bash: false,
        fileEdit: false,
        fileRead: false,
        mcp: false,
        skill: true,
        web: false,
        batch: false,
        other: false,
      },
    });

    render(
      <InlineToolCall
        toolName="skill"
        input={{ skillId: 'frontend', prompt: '整理展示逻辑' }}
        output={{ ok: true }}
        status="completed"
      />,
    );

    expect(screen.getByTestId('inline-input-preview')).toBeTruthy();
    expect(screen.getByTestId('inline-output-preview')).toBeTruthy();
  });

  it('运行期间自动展开的详情在完成后按默认折叠设置收起', () => {
    const view = render(
      <InlineToolCall
        toolName="skill"
        input={{ skillId: 'frontend', prompt: '整理展示逻辑' }}
        output={{ ok: true }}
        status="running"
      />,
    );

    expect(screen.getByTestId('inline-input-preview')).toBeTruthy();
    view.rerender(
      <InlineToolCall
        toolName="skill"
        input={{ skillId: 'frontend', prompt: '整理展示逻辑' }}
        output={{ ok: true }}
        status="completed"
      />,
    );

    expect(screen.queryByTestId('inline-input-preview')).toBeNull();
    expect(screen.queryByTestId('inline-output-preview')).toBeNull();
  });
});
