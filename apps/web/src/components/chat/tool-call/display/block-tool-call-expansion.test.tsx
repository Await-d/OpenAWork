// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { useDisplayPreferencesStore } from '../../../../stores/settings/display-preferences.js';

vi.mock('@openAwork/shared-ui', async () => {
  // 高亮工具是纯函数：转发真实实现（FileContentPreview 会直接调用它们）。
  const { detectLanguage, highlightCodeLines } =
    await import('../../../../../../../packages/shared-ui/src/tools/UnifiedCodeDiff.js');
  return {
    BashTerminalCard: ({ view, running }: { view?: { output?: string }; running?: boolean }) => (
      <div data-testid="bash-terminal" data-running={running ? 'true' : 'false'}>
        {view?.output ?? ''}
      </div>
    ),
    FileTypeIcon: () => null,
    detectLanguage,
    highlightCodeLines,
    resolveToolCallCardDisplayData: (input: {
      toolName: string;
      input?: Record<string, unknown>;
      output?: unknown;
    }) => ({
      displayToolName: input.toolName,
      summary: input.toolName,
      showInputField: true,
      hasDetails: true,
      ...(input.toolName === 'bash'
        ? {
            bashView: {
              command: 'ls',
              ...(input.output && typeof input.output === 'object'
                ? { output: (input.output as Record<string, unknown>).output }
                : {}),
            },
          }
        : {}),
      ...(input.toolName === 'edit'
        ? {
            diffView: {
              beforeText: 'const a = 1;',
              afterText: 'const a = 2;',
              filePath: 'src/a.ts',
              summary: 'src/a.ts · +1 / -1',
            },
          }
        : {}),
    }),
    resolveToolVisualStatus: ({ status, isError }: { status?: string; isError?: boolean }) => {
      if (isError) return 'failed';
      return status === 'completed' ? 'completed' : 'running';
    },
    getProviderUiList: () => [],
    ToolGlyph: () => <span data-testid="tool-glyph" />,
    UnifiedCodeDiff: () => null,
  };
});

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

  it('bash 展开后不再渲染参数抽屉（命令已在终端块里）', () => {
    const { container } = render(
      <BlockToolCall
        toolName="bash"
        input={{ command: 'ls' }}
        output={{ command: 'ls', cwd: '/tmp', exitCode: 0, output: 'file-a.txt' }}
        status="completed"
      />,
    );

    fireEvent.click(screen.getByRole('button', { expanded: false }));

    expect(container.querySelector('details.tool-call-block-params')).toBeNull();
  });

  it('单条 bash 运行中：_batchProgress 的单元素 subTools 渲染为实时输出', () => {
    const { container } = render(
      <BlockToolCall
        toolName="bash"
        input={{
          command: 'bun test',
          _batchProgress: {
            completedCount: 0,
            totalCount: 1,
            subTools: [
              { index: 0, tool: 'bash', status: 'running', partialOutput: 'PASS  1 test' },
            ],
          },
        }}
        status="running"
      />,
    );

    fireEvent.click(screen.getByRole('button', { expanded: false }));

    const terminal = container.querySelector('[data-testid="bash-terminal"]');
    expect(terminal?.getAttribute('data-running')).toBe('true');
    expect(terminal?.textContent).toContain('PASS  1 test');
  });

  it('bash 结算后忽略残留 _batchProgress，渲染最终 output', () => {
    const { container } = render(
      <BlockToolCall
        toolName="bash"
        input={{
          command: 'bun test',
          _batchProgress: {
            completedCount: 0,
            totalCount: 1,
            subTools: [
              { index: 0, tool: 'bash', status: 'running', partialOutput: '旧的部分输出' },
            ],
          },
        }}
        output={{ command: 'bun test', exitCode: 0, output: 'ALL PASS' }}
        status="completed"
      />,
    );

    fireEvent.click(screen.getByRole('button', { expanded: false }));

    const terminal = container.querySelector('[data-testid="bash-terminal"]');
    expect(terminal?.getAttribute('data-running')).toBe('false');
    expect(terminal?.textContent).toContain('ALL PASS');
    expect(terminal?.textContent).not.toContain('旧的部分输出');
  });

  it('embedded 模式不渲染 header，直接渲染内容本体（batch 子行不再二次点击）', () => {
    const { container } = render(
      <BlockToolCall
        embedded
        toolName="read"
        input={{ path: 'src/long.ts' }}
        output={{ path: 'src/long.ts', content: FILE_CONTENT, totalLines: FILE_LINES.length }}
        status="completed"
      />,
    );

    expect(container.querySelector('.tool-call-block-header')).toBeNull();
    expect(container.querySelector('.tool-call-block-body')?.getAttribute('data-embedded')).toBe(
      'true',
    );
    expect(container.querySelectorAll('.file-content-line')).toHaveLength(FILE_LINES.length);
  });
});
