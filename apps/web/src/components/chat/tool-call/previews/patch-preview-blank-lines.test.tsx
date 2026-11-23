// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { parsePatchFiles } from '../shared/patch-view.js';
import { PatchPreview } from './patch-preview.js';

afterEach(cleanup);

async function renderPatch(lines: string[], explicitHunk = true) {
  const files = parsePatchFiles(
    [
      '*** Begin Patch',
      '*** Update File: a.ts',
      ...(explicitHunk ? ['@@'] : []),
      ...lines,
      '*** End Patch',
    ].join('\n'),
  );
  expect(files).not.toBeNull();
  const view = render(<PatchPreview files={files!} label="补丁请求" />);
  const details = view.container.querySelector('details')!;
  details.open = true;
  fireEvent(details, new Event('toggle'));
  return screen.findByLabelText('补丁变更内容');
}

describe('补丁空行保真', () => {
  it('省略片段标记时仍展示正文之间的空行', async () => {
    const lines = [' first', '', '-old', '+new'];
    const content = await renderPatch(lines, false);
    expect(Array.from(content.children, (row) => row.textContent)).toEqual(
      lines.map((line) => `${line}\n`),
    );
  });

  it.each([
    { line: '+', kind: 'added' },
    { line: '-', kind: 'removed' },
  ])('单独的 $kind 空行显示一条真实变更', async ({ line, kind }) => {
    const content = await renderPatch([line]);
    expect(Array.from(content.children, (row) => row.textContent)).toEqual([`${line}\n`]);
    expect(content.children[0]?.getAttribute('data-kind')).toBe(kind);
    expect(screen.queryByText(/未提供行级变更/)).toBeNull();
  });

  it('混合空行上下文与空行增删保持相对位置且不制造额外变更', async () => {
    const lines = ['', ' before', '+', '', '-', ' after', ' '];
    const content = await renderPatch(lines);
    expect(Array.from(content.children, (row) => row.textContent)).toEqual(
      lines.map((line) => `${line}\n`),
    );
    expect(Array.from(content.children, (row) => row.getAttribute('data-kind'))).toEqual([
      'context',
      'context',
      'added',
      'context',
      'removed',
      'context',
      'context',
    ]);
  });

  it('没有正文的片段不凭空显示空行变更', async () => {
    const files = parsePatchFiles('*** Begin Patch\n*** Update File: a.ts\n*** End Patch')!;
    const { container } = render(<PatchPreview files={files} label="补丁请求" />);
    const details = container.querySelector('details')!;
    details.open = true;
    fireEvent(details, new Event('toggle'));
    expect(await screen.findByText('未提供行级变更。')).toBeTruthy();
    expect(container.querySelector('[data-kind]')).toBeNull();
  });
});
