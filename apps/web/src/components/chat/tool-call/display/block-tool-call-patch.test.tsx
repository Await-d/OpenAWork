// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ToolCallDisplay } from './tool-call-display.js';

vi.mock('../../../../stores/settings/use-tool-expand-default.js', () => ({
  useToolExpandDefault: () => () => true,
}));

const patchText = `*** Begin Patch
*** Update File: src/example.ts
@@ function example
-const before = 1;
+const after = 2;
*** Add File: src/new.ts
+export const value = 3;
*** Delete File: src/removed.ts
*** Update File: src/old.ts
*** Move to: src/moved.ts
*** End Patch`;
const output = JSON.stringify({
  success: true,
  files: [
    { action: 'update', path: 'src/example.ts' },
    { action: 'add', path: 'src/new.ts' },
    { action: 'delete', path: 'src/removed.ts' },
    { action: 'update', path: 'src/old.ts' },
  ],
});

afterEach(cleanup);

describe('实时聊天 patch 专用展示', () => {
  it('apply_patch 别名复用补丁预览并合并输出截断信息', () => {
    const { container } = render(
      <ToolCallDisplay
        toolName="apply_patch"
        input={{ patch: patchText }}
        output={JSON.stringify({
          success: true,
          files: [{ path: 'src/example.ts', before: '…[truncated]', after: '' }],
        })}
        fileDiffs={[]}
        status="completed"
      />,
    );
    expect(container.querySelectorAll('.patch-preview-file')).toHaveLength(4);
    expect(screen.getByText(/结果快照已截断/)).toBeTruthy();
    expect(screen.getByText(/补丁已应用/)).toBeTruthy();
  });
  it('用户输入和 JSON 输出显示可折叠文件及真实差异，不显示原始参数', async () => {
    const { container } = render(
      <ToolCallDisplay
        toolName="patch"
        input={{ patchText }}
        output={output}
        status="completed"
        fileDiffs={[
          { file: 'src/example.ts', before: 'prefix… truncated', after: 'prefix' },
          { file: 'src/example.ts', before: 'prefix', after: 'prefix' },
        ]}
      />,
    );
    expect(screen.getByText(/补丁已应用/)).toBeTruthy();
    expect(container.querySelectorAll('.patch-preview-file')).toHaveLength(4);
    expect(screen.queryByText(/参数 \(/)).toBeNull();
    expect(screen.getByText('移动')).toBeTruthy();
    expect(screen.getByText('src/old.ts → src/moved.ts')).toBeTruthy();
    const details = container.querySelector('details.patch-preview-file')!;
    fireEvent.click(details.querySelector('summary')!);
    await waitFor(() => expect(container.textContent).toContain('const after = 2;'));
    expect(container.textContent).toContain('const before = 1;');
    expect(container.textContent).toContain('结果快照已截断');
    expect(container.querySelector('.patch-preview-hunk')).toBeTruthy();
  });

  it('等待结果时仅展示请求，不宣称已应用', () => {
    render(<ToolCallDisplay toolName="patch" input={{ patchText }} status="running" />);
    expect(screen.getByText(/等待补丁结果/)).toBeTruthy();
    expect(screen.queryByText(/补丁已应用/)).toBeNull();
  });

  it.each([
    {
      status: 'failed' as const,
      output: JSON.stringify({ success: false, error: 'anchor mismatch' }),
    },
    { status: 'failed' as const, output },
    {
      status: 'completed' as const,
      output: JSON.stringify({ success: false, error: 'anchor mismatch' }),
    },
  ])('失败结果保留请求及错误详情 $status', (props) => {
    render(<ToolCallDisplay toolName="patch" input={{ patchText }} {...props} />);
    expect(screen.getByText(/补丁失败/)).toBeTruthy();
    expect(screen.queryByText(/补丁已应用/)).toBeNull();
  });

  it('损坏输出保留原始内容，输入截断如实标记', () => {
    render(
      <ToolCallDisplay
        toolName="patch"
        input={{ patchText: patchText.replace('*** End Patch', '') }}
        output="broken output"
        status="completed"
      />,
    );
    expect(screen.getByText(/结果未确认/)).toBeTruthy();
    expect(screen.getByText('broken output')).toBeTruthy();
    expect(screen.getAllByText(/补丁输入未完整接收/)).toHaveLength(4);
  });

  it('输入无法解析时仍走现有参数与输出兜底', () => {
    render(
      <ToolCallDisplay
        toolName="patch"
        input={{ patchText: 'invalid patch' }}
        output="invalid patch error"
        status="failed"
      />,
    );
    expect(screen.getByText('invalid patch')).toBeTruthy();
    // 失败态现在走结构化失败卡：结论行与「原始输出」都会给出这段文本。
    expect(screen.getAllByText('invalid patch error')).toHaveLength(2);
    expect(document.querySelector('.tool-failure-headline')?.textContent).toBe(
      'invalid patch error',
    );
  });
});
