// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

const { highlightCodeLines } = vi.hoisted(() => ({ highlightCodeLines: vi.fn() }));
vi.mock('@openAwork/shared-ui', () => ({
  detectLanguage: () => 'typescript',
  highlightCodeLines,
}));
vi.mock('../../../../App.js', () => ({
  useFileEditorContext: () => ({ openRef: { current: null }, isAvailable: false }),
}));
import { FileContentPreview } from './file-content-preview.js';
import { ToolCardExpansionProvider } from '../shared/tool-card-expansion.js';

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe('文件预览高亮预算', () => {
  it('展开工具卡内只高亮300行，复制和显示全部均保留全文', () => {
    const lines = Array.from({ length: 1000 }, (_, i) => `const value${i} = ${i};`);
    const content = lines.join('\n');
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText } });
    const { container } = render(
      <ToolCardExpansionProvider>
        <FileContentPreview data={{ path: 'a.ts', content, lineStart: 20 }} />
      </ToolCardExpansionProvider>,
    );
    expect(container.querySelectorAll('.file-content-line')).toHaveLength(300);
    expect(highlightCodeLines).toHaveBeenLastCalledWith(
      lines.slice(0, 300).join('\n'),
      'typescript',
    );
    fireEvent.click(screen.getByTitle('复制内容'));
    expect(writeText).toHaveBeenCalledWith(content);
    fireEvent.click(screen.getByText('显示全部（1000 行）'));
    expect(container.querySelectorAll('.file-content-line')).toHaveLength(1000);
    expect(highlightCodeLines).toHaveBeenLastCalledWith(content, 'typescript');
    fireEvent.click(screen.getByText('收起'));
    expect(container.querySelectorAll('.file-content-line')).toHaveLength(300);
    expect(container.querySelector('.file-content-line-num')?.textContent?.trim()).toBe('20');
  });

  it('高亮仅消费可见前缀，显式展开仍能查看全文', () => {
    const lines = Array.from({ length: 1000 }, (_, i) => `const value${i} = ${i};`);
    const { container } = render(
      <FileContentPreview data={{ path: 'a.ts', content: lines.join('\n') }} />,
    );
    expect(highlightCodeLines).toHaveBeenLastCalledWith(
      lines.slice(0, 30).join('\n'),
      'typescript',
    );
    expect(container.querySelectorAll('.file-content-line')).toHaveLength(30);
    fireEvent.click(screen.getByText('显示全部（1000 行）'));
    expect(highlightCodeLines).toHaveBeenLastCalledWith(lines.join('\n'), 'typescript');
    expect(container.querySelectorAll('.file-content-line')).toHaveLength(1000);
  });
});
