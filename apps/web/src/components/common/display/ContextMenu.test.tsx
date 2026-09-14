// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { ContextMenu } from './ContextMenu.js';

afterEach(() => {
  cleanup();
});

function noop(): void {
  return undefined;
}

describe('ContextMenu', () => {
  it('header 渲染为信息行，不占用 menuitem 语义', () => {
    render(
      <ContextMenu
        x={12}
        y={34}
        items={[
          { id: 'path', type: 'header', hint: '文件路径', label: '/workspace/demo/src/app.ts' },
          { id: 'copy-path', label: '复制完整路径', onSelect: noop },
        ]}
        onClose={noop}
      />,
    );

    expect(screen.getByText('文件路径')).toBeTruthy();
    expect(screen.getByText('/workspace/demo/src/app.ts')).toBeTruthy();
    expect(screen.getAllByRole('menuitem')).toHaveLength(1);
    expect(screen.queryByRole('menuitem', { name: /app\.ts/u })).toBeNull();
  });

  it('点击信息行不会触发关闭或任何动作', () => {
    const onClose = vi.fn();
    render(
      <ContextMenu
        x={0}
        y={0}
        items={[{ id: 'path', type: 'header', hint: '文件路径', label: '/workspace/a.md' }]}
        onClose={onClose}
      />,
    );

    fireEvent.mouseDown(screen.getByText('/workspace/a.md'));
    fireEvent.click(screen.getByText('/workspace/a.md'));

    expect(onClose).not.toHaveBeenCalled();
  });

  it('点击普通菜单项后关闭菜单并回调', async () => {
    const onSelect = vi.fn();
    const onClose = vi.fn();
    render(
      <ContextMenu
        x={0}
        y={0}
        items={[{ id: 'copy', label: '复制完整路径', onSelect }]}
        onClose={onClose}
      />,
    );

    fireEvent.click(screen.getByRole('menuitem'));

    expect(onClose).toHaveBeenCalledTimes(1);
    // The action itself is deferred to a microtask so the close can settle.
    await waitFor(() => expect(onSelect).toHaveBeenCalledTimes(1));
  });

  it('禁用项点击后既不回调也不关闭', async () => {
    const onSelect = vi.fn();
    const onClose = vi.fn();
    render(
      <ContextMenu
        x={0}
        y={0}
        items={[{ id: 'copy', label: '复制全部内容', disabled: true, onSelect }]}
        onClose={onClose}
      />,
    );

    fireEvent.click(screen.getByRole('menuitem'));

    expect(onClose).not.toHaveBeenCalled();
    await Promise.resolve();
    expect(onSelect).not.toHaveBeenCalled();
  });

  it('分隔符不产生可点击行', () => {
    render(
      <ContextMenu
        x={0}
        y={0}
        items={[
          { id: 'a', label: '第一项', onSelect: noop },
          { id: 'sep', type: 'separator' },
          { id: 'b', label: '第二项', onSelect: noop },
        ]}
        onClose={noop}
      />,
    );

    expect(screen.getAllByRole('menuitem')).toHaveLength(2);
    expect(screen.getAllByRole('separator')).toHaveLength(1);
  });
});
