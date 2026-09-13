// @vitest-environment jsdom
import { act, cleanup, render } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { useComposerPasteCollapse } from './use-composer-paste-collapse.js';
import type { ComposerPasteCollapse } from './use-composer-paste-collapse.js';

afterEach(() => {
  cleanup();
});

function renderHarness() {
  const ref: { current: ComposerPasteCollapse | null } = { current: null };

  function Harness() {
    ref.current = useComposerPasteCollapse();
    return null;
  }

  render(<Harness />);

  function state(): ComposerPasteCollapse {
    if (!ref.current) throw new Error('paste collapse state 未初始化');
    return ref.current;
  }

  return { state };
}

describe('useComposerPasteCollapse', () => {
  it('初始没有折叠内容', () => {
    const { state } = renderHarness();

    expect(state().collapsed).toBeNull();
    expect(state().previewExpanded).toBe(false);
  });

  it('collapse 记录文本与行数', () => {
    const { state } = renderHarness();

    act(() => state().collapse('第一行\n第二行\n第三行'));

    expect(state().collapsed?.text).toBe('第一行\n第二行\n第三行');
    expect(state().collapsed?.lineCount).toBe(3);
  });

  it('collapse 会收起展开态', () => {
    const { state } = renderHarness();

    act(() => state().collapse('内容'));
    act(() => state().togglePreview());
    expect(state().previewExpanded).toBe(true);

    act(() => state().collapse('另一段内容'));
    expect(state().previewExpanded).toBe(false);
  });

  it('updateText 只替换文本内容，保留行数', () => {
    const { state } = renderHarness();

    act(() => state().collapse('原始内容'));
    act(() => state().updateText('编辑后的内容'));

    expect(state().collapsed?.text).toBe('编辑后的内容');
    expect(state().collapsed?.lineCount).toBe(1);
  });

  it('clear 同时清空折叠内容与展开态', () => {
    const { state } = renderHarness();

    act(() => state().collapse('内容'));
    act(() => state().togglePreview());
    act(() => state().clear());

    expect(state().collapsed).toBeNull();
    expect(state().previewExpanded).toBe(false);
  });

  it('没有折叠内容时 updateText 不产生状态', () => {
    const { state } = renderHarness();

    act(() => state().updateText('孤立更新'));

    expect(state().collapsed).toBeNull();
  });
});
