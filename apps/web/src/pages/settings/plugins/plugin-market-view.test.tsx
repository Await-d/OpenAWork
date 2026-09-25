// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { PluginMarketEntry, PluginMarketSource } from '@openAwork/web-client';
import { PluginMarketView } from './plugin-market-view.js';

const SOURCE: PluginMarketSource = {
  id: 'acme/plugins',
  name: 'acme/plugins',
  repo: 'acme/plugins',
  enabled: true,
  createdAt: '2026-09-24',
};

const ENTRY: PluginMarketEntry = {
  id: 'acme/plugins/echo',
  name: 'echo',
  description: '回声插件',
  version: '1.0.0',
  path: 'plugins/echo',
  sourceId: 'acme/plugins',
  sourceName: 'acme/plugins',
  repo: 'acme/plugins',
  fallback: false,
};

function renderView(
  overrides: Partial<Parameters<typeof PluginMarketView>[0]> = {},
): Parameters<typeof PluginMarketView>[0] {
  const props: Parameters<typeof PluginMarketView>[0] = {
    sources: [SOURCE],
    entries: [ENTRY],
    failedSources: [],
    loading: false,
    error: null,
    busy: false,
    statusMessage: null,
    detail: null,
    detailLoading: false,
    onRefresh: vi.fn(),
    onOpenEntry: vi.fn(),
    onCloseDetail: vi.fn(),
    onInstall: vi.fn(),
    onAddSource: vi.fn(async () => true),
    onRemoveSource: vi.fn(),
    ...overrides,
  };
  render(<PluginMarketView {...props} />);
  return props;
}

describe('PluginMarketView', () => {
  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it('渲染市场条目（名称 / 版本 / 描述 / 来源）', () => {
    renderView();

    expect(screen.getByText('echo')).toBeTruthy();
    expect(screen.getByText('v1.0.0')).toBeTruthy();
    expect(screen.getByText('回声插件')).toBeTruthy();
    expect(screen.getByText(/acme\/plugins · plugins\/echo/)).toBeTruthy();
  });

  it('搜索把关键字交给 onRefresh', () => {
    const props = renderView();

    fireEvent.change(screen.getByLabelText('搜索插件市场'), { target: { value: '翻译' } });
    fireEvent.click(screen.getByRole('button', { name: '搜索' }));

    expect(props.onRefresh).toHaveBeenCalledWith('翻译');
  });

  it('安装需要二次确认且展示来源与信任提示', () => {
    const props = renderView();

    fireEvent.click(screen.getByRole('button', { name: '安装' }));
    expect(props.onInstall).not.toHaveBeenCalled();
    expect(screen.getByText(/无沙箱/)).toBeTruthy();
    expect(screen.getByText(/acme\/plugins · 路径 plugins\/echo/)).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: '确认安装' }));
    expect(props.onInstall).toHaveBeenCalledWith(ENTRY);
  });

  it('详情：打开回调、README 渲染、关闭回调', () => {
    const props = renderView({
      detail: {
        entry: ENTRY,
        readme: '# Echo\n用法说明',
        repoUrl: 'https://github.com/acme/plugins',
      },
    });

    expect(screen.getByText(/# Echo/)).toBeTruthy();
    expect(screen.getByRole('link', { name: 'https://github.com/acme/plugins' })).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: '关闭' }));
    expect(props.onCloseDetail).toHaveBeenCalled();
  });

  it('详情按钮把条目交给 onOpenEntry', () => {
    const props = renderView();

    fireEvent.click(screen.getByRole('button', { name: '详情' }));
    expect(props.onOpenEntry).toHaveBeenCalledWith(ENTRY);
  });

  it('来源面板：展开、添加与移除', async () => {
    const props = renderView();

    fireEvent.click(screen.getByRole('button', { name: /来源（1）/ }));
    expect(screen.getByText('市场来源（GitHub 仓库）')).toBeTruthy();

    fireEvent.change(screen.getByLabelText('插件源仓库'), { target: { value: 'acme/new' } });
    fireEvent.click(screen.getByRole('button', { name: '添加来源' }));
    await waitFor(() => {
      expect(props.onAddSource).toHaveBeenCalledWith('acme/new', undefined);
    });

    fireEvent.click(screen.getByRole('button', { name: '移除' }));
    expect(props.onRemoveSource).toHaveBeenCalledWith('acme/plugins');
  });

  it('空态与失败源提示', () => {
    renderView({
      entries: [],
      failedSources: [{ sourceId: 'acme/broken', error: '清单格式无效' }],
    });

    expect(screen.getByText('市场里还没有可安装的插件')).toBeTruthy();
    expect(screen.getByText(/acme\/broken 读取失败：清单格式无效/)).toBeTruthy();
  });

  it('加载失败可重试', () => {
    const props = renderView({ error: '网络异常，读取插件市场失败。' });

    expect(screen.getByRole('alert').textContent).toContain('读取插件市场失败');
    fireEvent.click(screen.getByRole('button', { name: '重试' }));
    expect(props.onRefresh).toHaveBeenCalled();
  });
});
