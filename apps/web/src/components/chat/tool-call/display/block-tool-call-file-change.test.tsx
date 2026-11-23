// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ToolCallDisplay } from './tool-call-display.js';
import { ToolOutputPreview } from '../io/tool-output-preview.js';

vi.mock('@openAwork/shared-ui', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  ...(await import('../../../../../../../packages/shared-ui/src/tools/UnifiedCodeDiff.js')),
}));

vi.mock('../../../../stores/settings/use-tool-expand-default.js', () => ({
  useToolExpandDefault: () => () => true,
}));
afterEach(cleanup);

const before = 'const original = 1;\n'.repeat(100);
const after = 'const replacement = 2;\n'.repeat(100);
const output = {
  success: true,
  files: [
    { action: 'update', path: 'src/example.ts', before, after, additions: 100, deletions: 100 },
  ],
};

describe('真实工具卡文件变更结果', () => {
  it('成功的请求补丁也保留结果、诊断原文入口及原生移动动作', async () => {
    const { container } = render(
      <ToolCallDisplay
        toolName="patch"
        input={{ patchText: '*** Begin Patch\n*** Add File: destination.ts\n+new\n*** End Patch' }}
        output={{
          success: true,
          files: [{ action: 'move', path: 'destination.ts', before: 'old', after: 'new' }],
          diagnostics: [{ message: 'diagnostic example' }],
        }}
        status="completed"
      />,
    );
    expect(container.querySelector('.patch-preview')).toBeTruthy();
    expect(container.querySelector('.file-change-result')).toBeTruthy();
    expect(screen.getByText('移动')).toBeTruthy();
    fireEvent.click(container.querySelector('.file-change-result-raw > summary')!);
    await waitFor(() => expect(container.textContent).toContain('diagnostic example'));
  });
  it.each(['preview', 'display'])('%s 对停在 before 中的原始输出标注不完整', (mode) => {
    const partial =
      '{"success":true,"files":[{"action":"update","path":"src/stream.ts","before":"whole source prefix';
    const { container } = render(
      mode === 'preview' ? (
        <ToolOutputPreview toolName="tool" output={partial} />
      ) : (
        <ToolCallDisplay toolName="tool" input={{}} status="completed" output={partial} />
      ),
    );
    expect(screen.getByText('src/stream.ts')).toBeTruthy();
    expect(screen.getByText(/内容可能已截断或缺少一侧/)).toBeTruthy();
    expect(container.querySelector('.tool-call-block-diff')).toBeNull();
    expect(container.textContent).not.toContain('whole source prefix');
    expect(container.querySelector('.file-change-result-raw')).toBeTruthy();
  });
  it.each(['tool', 'patch', 'edit'])(
    '%s 不依赖请求补丁，默认不挂载快照，按需显示 diff，原文可恢复',
    async (toolName) => {
      const { container } = render(
        <ToolCallDisplay
          toolName={toolName}
          input={{}}
          output={JSON.stringify(output)}
          status="completed"
          fileDiffs={[{ file: 'src/example.ts', before, after }]}
        />,
      );
      expect(screen.getByText('src/example.ts')).toBeTruthy();
      expect(screen.getByText(/变更结果 · 1 个文件/)).toBeTruthy();
      expect(container.querySelectorAll('.file-change-result-file')).toHaveLength(1);
      expect(container.querySelector('.tool-call-block-diff')).toBeNull();
      expect(container.querySelector('.json-preview')).toBeNull();
      expect(container.textContent).not.toContain('const original');
      const details = container.querySelector('details.file-change-result-file')!;
      fireEvent.click(details.querySelector('summary')!);
      await waitFor(() => expect(container.textContent).toContain('const replacement'));
      const raw = container.querySelector('details.file-change-result-raw')!;
      fireEvent.click(raw.querySelector('summary')!);
      await waitFor(() => expect(container.querySelector('.json-preview')).toBeTruthy());
      expect(container.textContent).toContain('"before"');
      expect(screen.getAllByRole('button', { name: /复制|Copy/ }).length).toBeGreaterThan(0);
    },
  );
  it.each([
    {
      metadata: { before: 'prefix…[truncated, 123 chars omitted]' },
      retained: 'prefix',
      omitted: 123,
    },
    { metadata: { afterTruncated: true }, retained: 'const original' },
    { metadata: { status: 'partial' }, retained: 'const original' },
  ])('两侧可用时展开带范围提示的前段差异 $metadata', async ({ metadata, retained, omitted }) => {
    const { container } = render(
      <ToolOutputPreview
        toolName="tool"
        output={{ success: true, files: [{ ...output.files[0], ...metadata }] }}
      />,
    );
    const details = container.querySelector('details.file-change-result-file')!;
    expect(screen.getByText(/以下仅对比已保留的前段内容/)).toBeTruthy();
    const diffSelector = '[data-diff-view-mode]';
    expect(details.querySelector(diffSelector)).toBeNull();
    fireEvent.click(details.querySelector('summary')!);
    await waitFor(() => expect(details.querySelector(diffSelector)).toBeTruthy());
    const diff = details.querySelector(diffSelector)!;
    expect(diff.textContent).toContain(retained);
    expect(diff.textContent).toContain('const replacement');
    expect(diff.textContent).not.toContain('[truncated');
    expect(
      screen.getByText(
        omitted
          ? `快照被截断 · 省略 ${omitted} 字符，以下仅对比已保留的前段内容`
          : '以下仅对比已保留的前段内容',
      ),
    ).toBeTruthy();
    expect(details.querySelector('summary')?.textContent).not.toMatch(/[+−]100/);
    expect(container.querySelector('.json-preview')).toBeNull();
  });
  it('缺少一侧时展开只显示不完整提示，不生成差异', async () => {
    const { container } = render(
      <ToolOutputPreview
        toolName="tool"
        output={{ success: true, files: [{ ...output.files[0], before: undefined }] }}
      />,
    );
    const details = container.querySelector('details.file-change-result-file')!;
    fireEvent.click(details.querySelector('summary')!);
    expect(await screen.findByText(/缺少一侧/)).toBeTruthy();
    expect(details.querySelector('[data-diff-view-mode]')).toBeNull();
    expect(details.textContent).not.toContain('const replacement');
    expect(container.querySelector('.json-preview')).toBeNull();
  });
  it('空快照和明确零计数有效，缺失计数不补零，失败不宣称应用', () => {
    const { container } = render(
      <ToolCallDisplay
        toolName="tool"
        input={{}}
        status="failed"
        output={{
          success: false,
          files: [
            { action: 'add', path: 'empty.ts', before: '', after: '', additions: 0 },
            { action: 'delete', path: 'removed.ts', before: 'old', after: '' },
            { action: 'update', path: 'old.ts', moveTo: 'moved.ts', before: '', after: '' },
          ],
        }}
      />,
    );
    expect(screen.getByText(/结果报告失败/)).toBeTruthy();
    expect(screen.getByText('old.ts → moved.ts')).toBeTruthy();
    expect(screen.getAllByText('+0')).toHaveLength(1);
    expect(screen.queryByText('−0')).toBeNull();
    expect(screen.queryByText(/已应用/)).toBeNull();
    expect(container.textContent).not.toContain('快照不完整');
  });
  it('双重序列化同样识别，损坏 JSON 保持原始兜底', () => {
    const { rerender, container } = render(
      <ToolOutputPreview toolName="tool" output={JSON.stringify(JSON.stringify(output))} />,
    );
    expect(screen.getByText('src/example.ts')).toBeTruthy();
    const broken = '{"success":true,"files":[…[truncated, 12 chars omitted]';
    rerender(<ToolOutputPreview toolName="tool" output={broken} />);
    expect(container.querySelector('.file-change-result')).toBeNull();
    expect(container.textContent).toContain('"success":true,"files":[');
  });
  it.each(['running', 'failed'] as const)('外层 %s 状态不被结果报告成功替换', (status) => {
    const { container } = render(
      <ToolCallDisplay toolName="tool" input={{}} status={status} output={output} />,
    );
    expect(container.querySelector(`[data-tool-status="${status}"]`)).toBeTruthy();
    expect(screen.queryByText(/已应用/)).toBeNull();
    expect(screen.getByText(/结果报告成功/)).toBeTruthy();
  });
  it('MCP 归一化后保留截断保护', async () => {
    const { container } = render(
      <ToolOutputPreview
        toolName="mcp__lsp__rename"
        output={{
          content: [{ type: 'text', text: JSON.stringify({ ...output, truncated: true }) }],
        }}
      />,
    );
    expect(screen.getByText('src/example.ts')).toBeTruthy();
    fireEvent.click(container.querySelector('.file-change-result-file > summary')!);
    await waitFor(() => expect(screen.getByText(/以下仅对比已保留的前段内容/)).toBeTruthy());
    expect(screen.queryByText('+100')).toBeNull();
  });
});
