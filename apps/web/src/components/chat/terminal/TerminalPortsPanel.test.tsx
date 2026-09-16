// @vitest-environment jsdom
/**
 * 端口页（T-15，方案 C：只读列表 + 同机直接打开）：
 *  - 四态：loading（首次请求）/ empty（含 strategy === null 的 reason 文案）/ error（重试可再次发起）/ 有数据；
 *  - 有数据：端口升序、`—` 兜底（进程信息 best-effort 缺失）、绑定地址「仅本机 / 全网可达」标注；
 *  - 同机（回环网关 / 桌面 local 模式）→ 动作是 `http://localhost:<port>` 链接（`rel=noopener`）；
 *    远端（或桌面显式 remote）→ 动作为禁用按钮 + 「需要反向代理，当前未启用」说明。
 *
 * 网关客户端整体换成替身（仓库规定：apps 内不得直接 fetch 网关端点，必须走 web-client；
 * 这里 mock 的正是那一层，消费端接线仍被完整覆盖）。
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import type { ListeningPortsSnapshotView, ListeningPortView } from '@openAwork/web-client';

const portsClient = vi.hoisted(() => ({ list: vi.fn() }));

vi.mock('@openAwork/web-client', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@openAwork/web-client')>();
  return {
    ...actual,
    createListeningPortsClient: () => ({ list: portsClient.list }),
  };
});

const { TerminalPortsPanel } = await import('./TerminalPortsPanel.js');

const LOCAL_GATEWAY = 'http://127.0.0.1:3000';
const REMOTE_GATEWAY = 'https://gateway.example.com';
const TOKEN = 'token-1';

function makePort(overrides: Partial<ListeningPortView> = {}): ListeningPortView {
  return {
    port: 3000,
    protocol: 'tcp',
    bindAddress: '127.0.0.1',
    pid: 1234,
    processName: 'node',
    source: 'procfs',
    ...overrides,
  };
}

function makeSnapshot(
  overrides: Partial<ListeningPortsSnapshotView> = {},
): ListeningPortsSnapshotView {
  return { ports: [], strategy: 'procfs', collectedAtMs: 1_700_000_000_000, ...overrides };
}

function renderPanel(gatewayUrl: string = LOCAL_GATEWAY) {
  return render(<TerminalPortsPanel gatewayUrl={gatewayUrl} token={TOKEN} />);
}

function rowFor(port: number): HTMLElement {
  return screen.getByTestId(`terminal-ports-row-${port}`);
}

beforeEach(() => {
  portsClient.list.mockReset();
});

afterEach(() => {
  cleanup();
  localStorage.clear();
  Reflect.deleteProperty(window, '__TAURI__');
  Reflect.deleteProperty(window, '__TAURI_INTERNALS__');
  Reflect.deleteProperty(window, 'isTauri');
});

describe('四态', () => {
  it('loading：首次请求未返回时显示加载状态，且通过 T-14 客户端发起请求', () => {
    portsClient.list.mockReturnValue(new Promise(() => undefined));
    renderPanel();

    expect(screen.getByTestId('terminal-ports-loading')).toBeTruthy();
    expect(screen.getByText(/正在读取监听端口/)).toBeTruthy();
    expect(portsClient.list).toHaveBeenCalledWith(TOKEN, expect.objectContaining({ signal: expect.anything() }));
    expect(screen.queryByTestId('terminal-ports-table')).toBeNull();
  });

  it('empty：strategy === null 时把「不支持端口枚举」与 reason 一起显示', async () => {
    portsClient.list.mockResolvedValue(
      makeSnapshot({
        strategy: null,
        reason: '当前平台 aix 暂无端口枚举策略（仅支持 linux / darwin / win32）。',
      }),
    );
    renderPanel();

    expect(await screen.findByTestId('terminal-ports-empty')).toBeTruthy();
    expect(screen.getByText('当前运行时不支持端口枚举')).toBeTruthy();
    expect(screen.getByText(/aix 暂无端口枚举策略/)).toBeTruthy();
    expect(screen.queryByTestId('terminal-ports-table')).toBeNull();
  });

  it('empty：strategy 可用但没有监听端口 → 空状态（不是错误）', async () => {
    portsClient.list.mockResolvedValue(makeSnapshot({ ports: [] }));
    renderPanel();

    expect(await screen.findByTestId('terminal-ports-empty')).toBeTruthy();
    expect(screen.getByText('未发现监听端口')).toBeTruthy();
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('error：请求失败显示错误 + 重试按钮；点击重试再次发起并进入有数据态', async () => {
    portsClient.list
      .mockRejectedValueOnce(new Error('网络异常，读取监听端口失败。'))
      .mockResolvedValueOnce(makeSnapshot({ ports: [makePort()] }));
    renderPanel();

    expect(await screen.findByTestId('terminal-ports-error')).toBeTruthy();
    expect(screen.getByText('网络异常，读取监听端口失败。')).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: '重试' }));

    expect(await screen.findByTestId('terminal-ports-table')).toBeTruthy();
    expect(portsClient.list).toHaveBeenCalledTimes(2);
  });
});

describe('有数据：排序 / 兜底 / 绑定地址标注', () => {
  const PORTS: ListeningPortView[] = [
    makePort({ port: 8080, bindAddress: '0.0.0.0', pid: 42, processName: 'python3' }),
    makePort({ port: 3000, bindAddress: '127.0.0.1', pid: null, processName: null }),
    makePort({ port: 5173, bindAddress: '::1', pid: 777, processName: 'vite' }),
  ];

  it('端口升序渲染；进程缺失用 — 兜底；绑定地址标注「仅本机 / 全网可达」', async () => {
    portsClient.list.mockResolvedValue(makeSnapshot({ ports: PORTS }));
    renderPanel();

    const table = await screen.findByTestId('terminal-ports-table');
    const rowIds = within(table)
      .getAllByTestId(/^terminal-ports-row-/)
      .map((row) => row.getAttribute('data-testid'));
    expect(rowIds).toEqual([
      'terminal-ports-row-3000',
      'terminal-ports-row-5173',
      'terminal-ports-row-8080',
    ]);

    // 3000：进程名与 pid 都缺失 → —；回环地址 → 仅本机。
    const row3000 = rowFor(3000);
    expect(within(row3000).getByText('—')).toBeTruthy();
    expect(within(row3000).getByText('仅本机')).toBeTruthy();

    // 5173：::1 也是回环 → 仅本机；name + pid 组合展示。
    const row5173 = rowFor(5173);
    expect(within(row5173).getByText('vite · pid 777')).toBeTruthy();
    expect(within(row5173).getByText('仅本机')).toBeTruthy();

    // 8080：0.0.0.0 → 全网可达（通配地址，是暴露面）。
    const row8080 = rowFor(8080);
    expect(within(row8080).getByText('python3 · pid 42')).toBeTruthy();
    expect(within(row8080).getByText('全网可达')).toBeTruthy();
  });

  it('IPv4-mapped 回环地址（::ffff:127.0.0.1，双栈 socket 常见形态）也标注「仅本机」', async () => {
    portsClient.list.mockResolvedValue(
      makeSnapshot({ ports: [makePort({ port: 9090, bindAddress: '::ffff:127.0.0.1' })] }),
    );
    renderPanel();

    await screen.findByTestId('terminal-ports-table');
    expect(within(rowFor(9090)).getByText('仅本机')).toBeTruthy();
  });

  it('同机（回环网关）：行内动作是 http://localhost:<port> 链接，新窗口且 noopener', async () => {
    portsClient.list.mockResolvedValue(makeSnapshot({ ports: PORTS }));
    renderPanel(LOCAL_GATEWAY);

    await screen.findByTestId('terminal-ports-table');

    const link = within(rowFor(8080)).getByRole('link', { name: '在浏览器打开' });
    expect(link.getAttribute('href')).toBe('http://localhost:8080');
    expect(link.getAttribute('target')).toBe('_blank');
    expect(link.getAttribute('rel')).toBe('noopener noreferrer');
    expect(screen.queryByTestId('terminal-ports-remote-notice')).toBeNull();

    expect(within(rowFor(3000)).getByRole('link', { name: '在浏览器打开' }).getAttribute('href')).toBe(
      'http://localhost:3000',
    );
  });
});

describe('同机判定：远端网关 / 桌面标志', () => {
  const PORTS = [makePort({ port: 8080, bindAddress: '127.0.0.1' })];

  it('远端网关：动作禁用且给出「需要反向代理，当前未启用」说明，不渲染任何链接', async () => {
    portsClient.list.mockResolvedValue(makeSnapshot({ ports: PORTS }));
    renderPanel(REMOTE_GATEWAY);

    await screen.findByTestId('terminal-ports-table');

    expect(screen.getByTestId('terminal-ports-remote-notice').textContent).toContain(
      '需要反向代理，当前未启用',
    );
    const action = within(rowFor(8080)).getByRole('button', { name: '在浏览器打开' });
    expect((action as HTMLButtonElement).disabled).toBe(true);
    expect(action.getAttribute('title')).toBe('需要反向代理，当前未启用');
    expect(screen.queryByRole('link')).toBeNull();
  });

  it('桌面端（Tauri 标志）默认按同机：即使网关 URL 不是回环也允许打开', async () => {
    localStorage.setItem('desktop_gateway_mode', 'local');
    (window as Window & { __TAURI__?: unknown }).__TAURI__ = { core: { invoke: vi.fn() } };
    portsClient.list.mockResolvedValue(makeSnapshot({ ports: PORTS }));
    renderPanel(REMOTE_GATEWAY);

    await screen.findByTestId('terminal-ports-table');

    const link = within(rowFor(8080)).getByRole('link', { name: '在浏览器打开' });
    expect(link.getAttribute('href')).toBe('http://localhost:8080');
  });

  it('桌面端显式切远端模式（desktop_gateway_mode=remote）：按远端处理、动作禁用', async () => {
    localStorage.setItem('desktop_gateway_mode', 'remote');
    (window as Window & { __TAURI__?: unknown }).__TAURI__ = { core: { invoke: vi.fn() } };
    portsClient.list.mockResolvedValue(makeSnapshot({ ports: PORTS }));
    renderPanel(REMOTE_GATEWAY);

    await screen.findByTestId('terminal-ports-table');
    await waitFor(() => {
      expect((within(rowFor(8080)).getByRole('button', { name: '在浏览器打开' }) as HTMLButtonElement).disabled).toBe(
        true,
      );
    });
    expect(screen.queryByRole('link')).toBeNull();
  });
});
