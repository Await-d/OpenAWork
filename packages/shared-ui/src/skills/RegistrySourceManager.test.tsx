// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { RegistrySourceManager, type RegistrySource } from '../index.js';

const source = (patch: Partial<RegistrySource> = {}): RegistrySource => ({
  id: 'community-1',
  name: '示例源',
  url: 'https://registry.example.com',
  type: 'community',
  enabled: true,
  trust: 'verified',
  ...patch,
});

function renderSources(overrides: Partial<Parameters<typeof RegistrySourceManager>[0]> = {}) {
  const props = {
    sources: [source()],
    onAdd: vi.fn(),
    onRemove: vi.fn(),
    onToggle: vi.fn(),
    ...overrides,
  };
  const view = render(<RegistrySourceManager {...props} />);
  return { ...props, view };
}

afterEach(cleanup);

describe('RegistrySourceManager', () => {
  it('渲染来源信息与中文类型/信任标签', () => {
    renderSources();

    expect(screen.getByText('示例源')).toBeTruthy();
    expect(screen.getByText('https://registry.example.com')).toBeTruthy();
    expect(screen.getByText('社区')).toBeTruthy();
    expect(screen.getByText('已校验')).toBeTruthy();
    expect(screen.getByText('1 个来源')).toBeTruthy();
  });

  it('开关按下一态回传', () => {
    const { onToggle } = renderSources();
    const toggle = screen.getByRole('switch', { name: '禁用注册源 示例源' });
    expect(toggle.getAttribute('aria-checked')).toBe('true');
    fireEvent.click(toggle);
    expect(onToggle).toHaveBeenCalledWith('community-1', false);
  });

  it('只读来源不渲染开关与移除', () => {
    renderSources({ sources: [source({ readonly: true, type: 'official', trust: 'full' })] });

    expect(screen.queryByRole('switch')).toBeNull();
    expect(screen.getByText('只读')).toBeTruthy();
    expect(screen.queryByText('移除')).toBeNull();
  });

  it('添加来源会去除首尾空白并清空输入', () => {
    const { onAdd } = renderSources();
    const input = screen.getByLabelText('注册源地址') as HTMLInputElement;

    fireEvent.change(input, { target: { value: '  https://new.example.com  ' } });
    fireEvent.click(screen.getByText('添加来源'));

    expect(onAdd).toHaveBeenCalledWith('https://new.example.com');
    expect(input.value).toBe('');
  });

  it('移除需要二次确认', () => {
    const { onRemove } = renderSources();

    fireEvent.click(screen.getByText('移除'));
    expect(onRemove).not.toHaveBeenCalled();

    fireEvent.click(screen.getByText('取消'));
    expect(onRemove).not.toHaveBeenCalled();

    fireEvent.click(screen.getByText('移除'));
    fireEvent.click(screen.getByText('确认移除'));
    expect(onRemove).toHaveBeenCalledWith('community-1');
  });
});
