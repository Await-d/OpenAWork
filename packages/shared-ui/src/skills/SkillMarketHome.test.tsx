// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { SkillMarketHome, type MarketSkill } from '../index.js';

const skill = (patch: Partial<MarketSkill> = {}): MarketSkill => ({
  id: 'foo',
  name: 'Foo Skill',
  version: '1.0.0',
  description: '一个测试技能',
  category: 'other',
  tags: ['tag-a'],
  downloads: 12,
  verified: false,
  installable: true,
  ...patch,
});

function renderMarket(overrides: Partial<Parameters<typeof SkillMarketHome>[0]> = {}) {
  const props = {
    skills: [skill()],
    categories: [],
    currentPage: 1,
    pageSize: 24,
    total: 1,
    onInstall: vi.fn(),
    onSelect: vi.fn(),
    ...overrides,
  };
  const view = render(<SkillMarketHome {...props} />);
  return { ...props, view };
}

afterEach(cleanup);

describe('SkillMarketHome', () => {
  it('渲染卡片信息与安装量', () => {
    renderMarket();

    expect(screen.getByText('Foo Skill')).toBeTruthy();
    expect(screen.getByText('一个测试技能')).toBeTruthy();
    expect(screen.getByText('tag-a')).toBeTruthy();
    expect(screen.getByText('12 次安装')).toBeTruthy();
    expect(screen.getByText('显示 1-1 / 共 1 个技能')).toBeTruthy();
  });

  it('分类为空时不渲染多余的分类行', () => {
    renderMarket();
    expect(screen.queryByText('全部')).toBeNull();
  });

  it('搜索与分类切换回传 onSearch', () => {
    const onSearch = vi.fn();
    renderMarket({ categories: ['writing', 'coding'], onSearch });

    fireEvent.change(screen.getByLabelText('搜索技能'), { target: { value: 'foo' } });
    fireEvent.click(screen.getByText('搜索'));
    expect(onSearch).toHaveBeenCalledWith('foo', undefined);

    fireEvent.click(screen.getByText('writing'));
    expect(onSearch).toHaveBeenLastCalledWith('foo', 'writing');
  });

  it('不可安装的技能按钮禁用且显示「仅浏览」', () => {
    const { onInstall } = renderMarket({ skills: [skill({ installable: false })] });

    const button = screen.getByText('仅浏览') as HTMLButtonElement;
    expect(button.disabled).toBe(true);
    fireEvent.click(button);
    expect(onInstall).not.toHaveBeenCalled();
  });

  it('点击详情与安装分别回传 id', () => {
    const { onInstall, onSelect } = renderMarket();
    fireEvent.click(screen.getByText('详情'));
    expect(onSelect).toHaveBeenCalledWith('foo');
    fireEvent.click(screen.getByText('安装'));
    expect(onInstall).toHaveBeenCalledWith('foo');
  });

  it('错误态与空态有明确反馈', () => {
    const { view } = renderMarket({ error: '加载失败：boom' });
    expect(screen.getByRole('alert').textContent).toContain('加载失败：boom');
    view.unmount();

    renderMarket({ skills: [], total: 0 });
    expect(screen.getByText('该分类下暂无技能。')).toBeTruthy();
  });
});
