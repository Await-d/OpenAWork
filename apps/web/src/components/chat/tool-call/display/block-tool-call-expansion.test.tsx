// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { useDisplayPreferencesStore } from '../../../../stores/settings/display-preferences.js';

vi.mock('@openAwork/shared-ui', () => ({
  BashTerminalCard: () => null,
  resolveToolCallCardDisplayData: () => ({
    displayToolName: 'read',
    summary: 'read',
    showInputField: true,
    hasDetails: true,
  }),
  resolveToolVisualStatus: ({ status, isError }: { status?: string; isError?: boolean }) => {
    if (isError) return 'failed';
    return status === 'completed' ? 'completed' : 'running';
  },
  getProviderUiList: () => [],
  ToolGlyph: () => <span data-testid="tool-glyph" />,
  UnifiedCodeDiff: () => null,
}));

import { BlockToolCall } from './block-tool-call.js';

const FILE_LINES = Array.from({ length: 45 }, (_, i) => `const value${i + 1} = ${i + 1};`);
const FILE_CONTENT = FILE_LINES.join('\n');

function renderBlock(outputStatus?: 'running' | 'completed') {
  return render(
    <BlockToolCall
      toolName="read"
      input={{ path: 'src/long.ts' }}
      output={{
        path: 'src/long.ts',
        content: FILE_CONTENT,
        totalLines: FILE_LINES.length,
      }}
      {...(outputStatus !== undefined ? { status: outputStatus } : {})}
    />,
  );
}

beforeEach(() => {
  useDisplayPreferencesStore.setState({ toolCallsExpandedByDefault: false });
});

afterEach(() => {
  cleanup();
  useDisplayPreferencesStore.setState({ toolCallsExpandedByDefault: false });
});

describe('BlockToolCall 展开行为', () => {
  it('执行中保持折叠，点击后内层文件内容完整渲染且无二级按钮', () => {
    const { container } = renderBlock('running');

    expect(container.querySelector('.tool-call-block-body')).toBeNull();

    fireEvent.click(screen.getByRole('button', { expanded: false }));

    expect(container.querySelectorAll('.file-content-line')).toHaveLength(FILE_LINES.length);
    expect(container.querySelector('.file-content-pre')?.textContent).toContain(
      'const value45 = 45;',
    );
    expect(screen.queryByRole('button', { name: /显示全部/ })).toBeNull();
    expect(container.querySelector('details.tool-call-block-params')?.hasAttribute('open')).toBe(
      true,
    );
  });

  it('用户偏好默认展开时同样一次性完整渲染内层内容', () => {
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

    const { container } = renderBlock('completed');

    expect(container.querySelectorAll('.file-content-line')).toHaveLength(FILE_LINES.length);
    expect(screen.queryByRole('button', { name: /显示全部/ })).toBeNull();
  });

  it('bash 折叠摘要取 shell 文本首行而非 JSON 包裹的首个字符', () => {
    const { container } = render(
      <BlockToolCall
        toolName="bash"
        input={{ command: 'ls' }}
        output={{
          command: 'ls',
          cwd: '/tmp',
          exitCode: 0,
          output: 'file-a.txt\nfile-b.txt',
          truncated: false,
        }}
        status="completed"
      />,
    );

    const summary = container.querySelector('.tool-call-block-collapsed-summary')?.textContent;
    expect(summary).toContain('file-a.txt');
    expect(summary).not.toContain('{');
  });
});
