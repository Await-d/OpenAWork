// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ThirdPartyPluginsPanel } from './third-party-plugins-panel.js';

const pluginsClientMocks = vi.hoisted(() => ({
  list: vi.fn(async (): Promise<unknown[]> => []),
  install: vi.fn(async (): Promise<unknown> => null),
  remove: vi.fn(async (): Promise<void> => undefined),
  reload: vi.fn(async (): Promise<unknown> => ({ reloaded: true })),
  disable: vi.fn(async (): Promise<void> => undefined),
  enable: vi.fn(async (): Promise<unknown> => ({ enabled: true })),
}));

vi.mock('@openAwork/web-client', () => ({
  createPluginsClient: () => ({
    list: pluginsClientMocks.list,
    install: pluginsClientMocks.install,
    remove: pluginsClientMocks.remove,
    reload: pluginsClientMocks.reload,
    disable: pluginsClientMocks.disable,
    enable: pluginsClientMocks.enable,
  }),
}));

function renderPanel(): void {
  render(<ThirdPartyPluginsPanel gatewayUrl="https://gateway.test" token="test-token" />);
}

describe('ThirdPartyPluginsPanel', () => {
  beforeEach(() => {
    pluginsClientMocks.list.mockResolvedValue([]);
  });

  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it('只列出第三方插件，过滤内置组', async () => {
    pluginsClientMocks.list.mockResolvedValueOnce([
      {
        id: 'builtin.image-generation',
        source: 'internal',
        state: { status: 'active' },
        guarded: true,
      },
      {
        id: 'my-plugin',
        source: '/srv/plugins/my-plugin',
        installId: 'my-plugin',
        state: { status: 'active' },
        guarded: false,
      },
    ]);

    renderPanel();

    await waitFor(() => {
      expect(screen.getByText('my-plugin')).toBeTruthy();
    });
    expect(screen.queryByText('builtin.image-generation')).toBeNull();
    expect(screen.getByText('运行中')).toBeTruthy();
    expect(screen.getByText('已安装')).toBeTruthy();
  });

  it('失败插件显示错误原因与危险状态', async () => {
    pluginsClientMocks.list.mockResolvedValueOnce([
      {
        id: 'broken-plugin',
        source: '/srv/plugins/broken-plugin',
        installId: 'broken-plugin',
        state: { status: 'failed', error: 'setup exploded' },
        guarded: false,
      },
    ]);

    renderPanel();

    await waitFor(() => {
      expect(screen.getByText('失败')).toBeTruthy();
    });
    expect(screen.getByText('setup exploded')).toBeTruthy();
  });

  it('空清单显示空状态引导', async () => {
    renderPanel();

    await waitFor(() => {
      expect(screen.getByText('还没有安装第三方插件')).toBeTruthy();
    });
  });

  it('卸载需要二次确认后才会调用网关', async () => {
    pluginsClientMocks.list.mockResolvedValue([
      {
        id: 'my-plugin',
        source: '/srv/plugins/my-plugin',
        installId: 'my-plugin',
        state: { status: 'active' },
        guarded: false,
      },
    ]);

    renderPanel();

    fireEvent.click(await screen.findByRole('button', { name: '卸载' }));
    expect(pluginsClientMocks.remove).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole('button', { name: '确认卸载' }));
    await waitFor(() => {
      expect(pluginsClientMocks.remove).toHaveBeenCalledWith('test-token', 'my-plugin');
    });
  });

  it('重载按钮调用 reload 并回显状态', async () => {
    pluginsClientMocks.list.mockResolvedValue([
      {
        id: 'my-plugin',
        source: '/srv/plugins/my-plugin',
        installId: 'my-plugin',
        state: { status: 'active' },
        guarded: false,
      },
    ]);

    renderPanel();

    fireEvent.click(await screen.findByRole('button', { name: '重载' }));
    await waitFor(() => {
      expect(pluginsClientMocks.reload).toHaveBeenCalledWith('test-token', 'my-plugin');
    });
    await waitFor(() => {
      expect(screen.getByText('已重载 my-plugin。')).toBeTruthy();
    });
  });

  it('停用与启用：停用调用 disable 并显示已停用，启用调用 enable', async () => {
    pluginsClientMocks.list.mockResolvedValueOnce([
      {
        id: 'my-plugin',
        source: '/srv/plugins/my-plugin',
        installId: 'my-plugin',
        state: { status: 'active' },
        guarded: false,
      },
    ]);
    // 第二次 list（停用后刷新）返回 disabled 状态。
    pluginsClientMocks.list.mockResolvedValueOnce([
      {
        id: 'my-plugin',
        source: '/srv/plugins/my-plugin',
        installId: 'my-plugin',
        state: { status: 'disabled' },
        guarded: false,
      },
    ]);
    // 第三次 list（启用后刷新）恢复 active。
    pluginsClientMocks.list.mockResolvedValueOnce([
      {
        id: 'my-plugin',
        source: '/srv/plugins/my-plugin',
        installId: 'my-plugin',
        state: { status: 'active' },
        guarded: false,
      },
    ]);

    renderPanel();

    fireEvent.click(await screen.findByRole('button', { name: '停用' }));
    await waitFor(() => {
      expect(pluginsClientMocks.disable).toHaveBeenCalledWith('test-token', 'my-plugin');
    });
    await waitFor(() => {
      expect(screen.getByText('已停用')).toBeTruthy();
    });
    expect(screen.queryByRole('button', { name: '重载' })).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: '启用' }));
    await waitFor(() => {
      expect(pluginsClientMocks.enable).toHaveBeenCalledWith('test-token', 'my-plugin');
    });
    await waitFor(() => {
      expect(screen.getByText('运行中')).toBeTruthy();
    });
  });

  it('安装表单提交调用 install 并回显激活状态', async () => {
    pluginsClientMocks.install.mockResolvedValueOnce({
      install: {
        installId: 'my-plugin',
        path: '/data/plugins/my-plugin',
        entrypoint: '/data/plugins/my-plugin/index.mjs',
      },
      plugin: { id: 'my-plugin', state: { status: 'active' } },
    });

    renderPanel();
    await screen.findByText('还没有安装第三方插件');

    fireEvent.change(screen.getByLabelText('插件路径'), {
      target: { value: '/srv/plugins/my-plugin' },
    });
    const form = screen.getByRole('button', { name: '安装' }).closest('form');
    if (!form) throw new Error('未找到安装表单');
    fireEvent.submit(form);

    await waitFor(() => {
      expect(pluginsClientMocks.install).toHaveBeenCalledWith('test-token', {
        path: '/srv/plugins/my-plugin',
        force: false,
      });
    });
    await waitFor(() => {
      expect(screen.getByText('已安装并激活 my-plugin。')).toBeTruthy();
    });
  });

  it('加载失败显示错误并可重试', async () => {
    pluginsClientMocks.list.mockRejectedValueOnce(new Error('网络异常，读取插件列表失败。'));

    renderPanel();

    await waitFor(() => {
      expect(screen.getByRole('alert').textContent).toContain('读取插件列表失败');
    });

    pluginsClientMocks.list.mockResolvedValueOnce([]);
    fireEvent.click(screen.getByRole('button', { name: '重试' }));

    await waitFor(() => {
      expect(screen.getByText('还没有安装第三方插件')).toBeTruthy();
    });
  });
});
