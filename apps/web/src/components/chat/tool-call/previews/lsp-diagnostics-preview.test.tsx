// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import { extractLspDiagnostics, LspDiagnosticsPreview } from './lsp-diagnostics-preview.js';

afterEach(cleanup);

describe('extractLspDiagnostics — map 形态', () => {
  it('LSP 原生 range（0-based 行）折算为 1-based，并保留列', () => {
    const entries = extractLspDiagnostics({
      'src/a.ts': [
        {
          message: "Type 'string' is not assignable",
          severity: 1,
          range: { start: { line: 11, character: 5 }, end: { line: 11, character: 9 } },
          source: 'ts',
        },
      ],
    });

    expect(entries).toHaveLength(1);
    expect(entries?.[0]).toEqual({
      filePath: 'src/a.ts',
      line: 12,
      column: 5,
      severity: 'error',
      message: "Type 'string' is not assignable",
      source: 'ts',
    });
  });

  it('扁平 line / column 与字符串 severity 同样支持', () => {
    const entries = extractLspDiagnostics({
      'src/b.ts': [{ message: 'unused var', severity: 'warning', line: 3, column: 1 }],
    });

    expect(entries?.[0]?.line).toBe(3);
    expect(entries?.[0]?.severity).toBe('warning');
  });

  it('severity 数字 2/3/4 映射 warning / info / hint', () => {
    const entries = extractLspDiagnostics({
      'a.ts': [
        { message: 'w', severity: 2 },
        { message: 'i', severity: 3 },
        { message: 'h', severity: 4 },
      ],
    });

    expect(entries?.map((entry) => entry.severity)).toEqual(['warning', 'info', 'hint']);
  });

  it('缺 message 的条目跳过', () => {
    const entries = extractLspDiagnostics({ 'a.ts': [{ severity: 1 }, null, 'text'] });

    expect(entries).toEqual([]);
  });
});

describe('extractLspDiagnostics — 数组与其他形态', () => {
  it('已拍平的数组形态可用（filePath 为空）', () => {
    const entries = extractLspDiagnostics([{ message: 'boom', line: 1, column: 0 }]);

    expect(entries).toHaveLength(1);
    expect(entries?.[0]?.filePath).toBe('');
  });

  it('空对象 = 没有诊断（不是「无法识别」）', () => {
    expect(extractLspDiagnostics({})).toEqual([]);
  });

  it('非诊断对象返回 null（回退通用渲染）', () => {
    expect(extractLspDiagnostics({ foo: 'bar' })).toBeNull();
    expect(extractLspDiagnostics(null)).toBeNull();
    expect(extractLspDiagnostics('text')).toBeNull();
  });
});

describe('LspDiagnosticsPreview', () => {
  it('按文件分组，展示问题数与位置 / 严重度 / 来源', () => {
    const entries = extractLspDiagnostics({
      'src/a.ts': [
        { message: 'first', severity: 1, range: { start: { line: 11, character: 5 } } },
        { message: 'second', severity: 2, line: 20, column: 3 },
      ],
      'src/b.ts': [{ message: 'third', severity: 3, line: 1, column: 0, source: 'eslint' }],
    });

    const { container } = render(<LspDiagnosticsPreview entries={entries ?? []} />);

    expect(container.textContent).toContain('src/a.ts');
    expect(container.textContent).toContain('2 个问题');
    expect(container.textContent).toContain('错误');
    expect(container.textContent).toContain('警告');
    // 行内只给「行:列」，完整路径在分组头（避免 375px 下重复路径撑破卡片）。
    expect(container.textContent).toContain('12:5');
    expect(container.textContent).toContain('1:0');
    expect(container.textContent).toContain('src/a.ts');
    expect(container.textContent).toContain('src/b.ts');
    expect(container.textContent).toContain('eslint');
  });

  it('空诊断给出空态', () => {
    render(<LspDiagnosticsPreview entries={[]} />);

    expect(screen.getByText('（没有诊断信息）')).toBeTruthy();
  });

  it('超过 30 条时给出「还有 N 条未展示」', () => {
    const entries = Array.from({ length: 35 }, (_, index) => ({
      filePath: 'a.ts',
      line: index + 1,
      severity: 'error' as const,
      message: `issue ${index + 1}`,
    }));

    const { container } = render(<LspDiagnosticsPreview entries={entries} />);

    expect(container.textContent).toContain('还有 5 条未展示');
    expect(container.querySelectorAll('[data-lsp-severity]')).toHaveLength(30);
  });
});
