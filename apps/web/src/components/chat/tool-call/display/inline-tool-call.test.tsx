// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
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

  it('运行期间不再自动展开，点击后才展示详情', () => {
    render(
      <InlineToolCall
        toolName="skill"
        input={{ skillId: 'frontend', prompt: '整理展示逻辑' }}
        output={{ ok: true }}
        status="running"
      />,
    );

    expect(screen.queryByTestId('inline-input-preview')).toBeNull();
    expect(screen.queryByTestId('inline-output-preview')).toBeNull();

    fireEvent.click(screen.getByRole('button'));

    expect(screen.getByTestId('inline-input-preview')).toBeTruthy();
    expect(screen.getByTestId('inline-output-preview')).toBeTruthy();
  });

  it('embedded 模式隐藏整行 header，直接渲染输出（入参不展示）', () => {
    const { container } = render(
      <InlineToolCall
        embedded
        toolName="skill"
        input={{ skillId: 'frontend', prompt: '整理展示逻辑' }}
        output={{ ok: true }}
        status="completed"
      />,
    );

    // 外层 batch 子行已提供工具名 / 摘要 / 状态，这里不再重复一行。
    expect(container.querySelector('.tool-call-inline')).toBeNull();
    expect(container.querySelector('.tool-call-inline-output')?.getAttribute('data-embedded')).toBe(
      'true',
    );
    expect(screen.getByTestId('inline-output-preview')).toBeTruthy();
    // 用户口径：embedded 下入参不重要，不渲染参数区。
    expect(screen.queryByTestId('inline-input-preview')).toBeNull();
  });

  it('查看类工具（read）展开后不渲染参数区（只要路径 + 预览）', () => {
    render(
      <InlineToolCall
        toolName="read"
        input={{ filePath: 'src/a.ts', offset: 12, limit: 50 }}
        output={{ path: 'src/a.ts', content: 'line', lineStart: 12, lineEnd: 61, totalLines: 240 }}
        status="completed"
      />,
    );

    fireEvent.click(screen.getByRole('button'));

    expect(screen.queryByTestId('inline-input-preview')).toBeNull();
    expect(screen.getByTestId('inline-output-preview')).toBeTruthy();
  });

  it('提问类工具（askuserquestion）展开后不渲染分区标签（问答对自带问题）', () => {
    const { container } = render(
      <InlineToolCall
        toolName="askuserquestion"
        input={{ questions: [{ question: '用哪个包管理器？' }] }}
        output={'用哪个包管理器？="pnpm"'}
        status="completed"
      />,
    );

    fireEvent.click(screen.getByRole('button'));

    const labels = Array.from(container.querySelectorAll('.tool-call-inline-section-label'));
    expect(labels).toHaveLength(0);
    expect(screen.getByTestId('inline-output-preview')).toBeTruthy();
  });
});
