import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ChatMarkdownTable } from './chat-markdown-table.js';

afterEach(cleanup);

function cell(tagName: 'th' | 'td', value: string) {
  return {
    type: 'element',
    tagName,
    properties: {},
    children: [{ type: 'text', value }],
  };
}

function row(cells: unknown[]) {
  return { type: 'element', tagName: 'tr', properties: {}, children: cells };
}

function buildTableNode(columnCount: number, bodyRows: number) {
  const header = Array.from({ length: columnCount }, (_, index) => cell('th', `列${index + 1}`));
  const body = Array.from({ length: bodyRows }, (_, rowIndex) =>
    row(
      Array.from({ length: columnCount }, (_, columnIndex) =>
        cell('td', `${rowIndex + 1}-${columnIndex + 1}`),
      ),
    ),
  );

  return {
    type: 'element',
    tagName: 'table',
    properties: {},
    children: [
      { type: 'element', tagName: 'thead', properties: {}, children: [row(header)] },
      { type: 'element', tagName: 'tbody', properties: {}, children: body },
    ],
  };
}

function renderTable(node: unknown) {
  return render(
    <ChatMarkdownTable node={node}>
      <tbody />
    </ChatMarkdownTable>,
  );
}

describe('ChatMarkdownTable', () => {
  it('展示行列统计与导出入口', () => {
    renderTable(buildTableNode(3, 2));

    expect(screen.getByText('2 行 × 3 列')).toBeTruthy();
    expect(screen.getByTestId('chat-markdown-table-copy')).toBeTruthy();
    expect(screen.getByTestId('chat-markdown-table-download')).toBeTruthy();
  });

  it('列数多时切换为紧凑密度', () => {
    renderTable(buildTableNode(7, 3));

    expect(screen.getByTestId('chat-markdown-table').getAttribute('data-density')).toBe('compact');
  });

  it('列数少时保持舒适密度', () => {
    renderTable(buildTableNode(3, 3));

    expect(screen.getByTestId('chat-markdown-table').getAttribute('data-density')).toBe(
      'comfortable',
    );
  });

  it('复制为可直接粘贴到表格软件的制表符文本', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.assign(navigator, { clipboard: { writeText } });

    renderTable(buildTableNode(2, 1));
    fireEvent.click(screen.getByTestId('chat-markdown-table-copy'));

    await waitFor(() => {
      expect(writeText).toHaveBeenCalledWith('列1\t列2\n1-1\t1-2');
    });
    await waitFor(() => {
      expect(screen.getByTestId('chat-markdown-table-copy').textContent).toBe('✓ 已复制');
    });
  });

  it('下载 CSV 时带 BOM，Excel 打开中文不乱码', async () => {
    const createObjectURL = vi.fn((_blob: Blob) => 'blob:mock');
    const revokeObjectURL = vi.fn();
    Object.assign(URL, { createObjectURL, revokeObjectURL });
    const click = vi
      .spyOn(HTMLAnchorElement.prototype, 'click')
      .mockImplementation(() => undefined);

    renderTable(buildTableNode(2, 1));
    fireEvent.click(screen.getByTestId('chat-markdown-table-download'));

    await waitFor(() => {
      expect(createObjectURL).toHaveBeenCalledTimes(1);
    });

    const blob = createObjectURL.mock.calls[0]?.[0];
    expect(blob?.type).toContain('text/csv');

    // 前置 3 字节 BOM（EF BB BF）：让 Excel 以 UTF-8 打开
    const bytes = new Uint8Array((await blob?.arrayBuffer()) ?? new ArrayBuffer(0));
    expect([...bytes.slice(0, 3)]).toEqual([0xef, 0xbb, 0xbf]);
    expect(new TextDecoder().decode(bytes)).toBe('列1,列2\r\n1-1,1-2');
    expect(click).toHaveBeenCalled();
    expect(revokeObjectURL).toHaveBeenCalledWith('blob:mock');

    click.mockRestore();
  });

  it('拿不到表格结构时只渲染表格本身，不出现空的工具栏', () => {
    renderTable(undefined);

    expect(screen.queryByTestId('chat-markdown-table-copy')).toBeNull();
    expect(screen.getByTestId('chat-markdown-table')).toBeTruthy();
  });
});
