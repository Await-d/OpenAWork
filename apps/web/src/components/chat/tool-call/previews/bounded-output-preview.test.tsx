// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ToolCardExpansionProvider } from '../shared/tool-card-expansion.js';
import { ArrayOutputPreview } from './array-output-preview.js';
import { JsonPreview } from './json-preview.js';
import { ParamValue, ParameterListPreview } from './parameter-list-preview.js';
import { StructuredOutputPreview } from './structured-output-preview.js';
import { copyTextToClipboard } from '../../../layout/file-tree/file-tree-actions.js';

vi.mock('../../../layout/file-tree/file-tree-actions.js', () => ({
  copyTextToClipboard: vi.fn().mockResolvedValue(undefined),
}));
afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe('通用输出的有界预览', () => {
  it('关闭的嵌套对象不读取值，展开后才挂载正文，关闭后卸载', () => {
    const read = vi.fn(() => 'nested body');
    const value = Object.defineProperty({}, 'body', { enumerable: true, get: read });
    const { container } = render(<ParamValue value={value} />);
    expect(read).not.toHaveBeenCalled();
    expect(container.querySelector('pre')).toBeNull();
    const details = container.querySelector('details')!;
    details.open = true;
    fireEvent(details, new Event('toggle'));
    expect(container.querySelector('pre')?.textContent).toContain('nested body');
    details.open = false;
    fireEvent(details, new Event('toggle'));
    expect(container.querySelector('pre')).toBeNull();
  });

  it.each([
    StructuredOutputPreview,
    ({ data }: { data: Record<string, unknown> }) => <ParameterListPreview input={data} />,
  ])('对象字段分批加载且不提前读取后面的字段', (Preview) => {
    const data: Record<string, unknown> = Object.fromEntries(
      Array.from({ length: 120 }, (_, i) => [`key${i}`, i]),
    );
    const read = vi.fn(() => 'last field');
    Object.defineProperty(data, 'key119', { enumerable: true, get: read });
    render(<Preview data={data} />);
    expect(read).not.toHaveBeenCalled();
    expect(screen.queryByText('key119')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: /加载更多字段/ }));
    expect(screen.getByText('key50')).toBeTruthy();
  });

  it('展开卡片仍分批显示数组，且不挂载关闭条目的 JSON', () => {
    const { container } = render(
      <ToolCardExpansionProvider>
        <ArrayOutputPreview
          data={Array.from({ length: 120 }, (_, i) => ({ name: `item${i}`, body: 'x' }))}
        />
      </ToolCardExpansionProvider>,
    );
    expect(container.querySelectorAll('details')).toHaveLength(50);
    expect(container.querySelector('pre')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: /加载更多项目/ }));
    expect(container.querySelectorAll('details')).toHaveLength(100);
  });

  it('JSON 初始序列化不读取远端字段，复制才读取完整原始数据', async () => {
    const read = vi.fn(() => 'original tail');
    const data = {
      body: 'x'.repeat(100_000),
      get tail() {
        return read();
      },
    };
    const { container } = render(<JsonPreview data={data} />);
    expect(read).not.toHaveBeenCalled();
    expect(container.querySelector('code')!.textContent!.length).toBeLessThan(21_000);
    fireEvent.click(screen.getByRole('button', { name: /复制完整/ }));
    await vi.waitFor(() =>
      expect(copyTextToClipboard).toHaveBeenCalledWith(JSON.stringify(data, null, 2)),
    );
  });

  it('超长文本摘要和 title 有界，并可继续加载与复制全文', () => {
    const value = 'a'.repeat(100_000) + 'TAIL';
    const { container } = render(
      <ToolCardExpansionProvider>
        <ParamValue value={value} />
      </ToolCardExpansionProvider>,
    );
    expect(container.textContent!.length).toBeLessThan(22_000);
    expect(container.querySelector('summary')!.title.length).toBeLessThan(200);
    expect(screen.getByRole('button', { name: /加载更多/ })).toBeTruthy();
    expect(screen.getByRole('button', { name: /复制完整/ })).toBeTruthy();
  });
});
