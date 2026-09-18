// @vitest-environment jsdom
/**
 * 端口页（T-15，方案 C：只读列表 + 同机直接打开；P0 工具条 / 筛选 / 复制）：
 *  - 四态：loading（首次请求）/ empty（含 strategy === null 的 reason 文案）/ error（重试可再次发起）/ 有数据；
 *  - 有数据：端口升序、`—` 兜底（进程信息 best-effort 缺失）、绑定地址「仅本机 / 全网可达」标注；
 *  - 同机（回环网关 / 桌面 local 模式）→ 动作是 `http://localhost:<port>` 链接（`rel=noopener`）；
 *    远端（或桌面显式 remote）→ 动作为禁用按钮 + 「需要反向代理，当前未启用」说明；
 *  - P0：筛选（端口 / 进程 / 地址 / 协议，含无匹配空态与计数）、复制地址（**仅同机**，写剪贴板 +
 *    读屏播报，剪贴板不可用播报失败）、成功态「刷新」（静默，不闪回 loading）、暂停 / 继续按钮标签切换；
 *    远端不渲染「复制地址」—— `<网关 host>:<port>` 多数情况下不可达，不提供伪可用地址。
 *
 * 网关客户端整体换成替身（仓库规定：apps 内不得直接 fetch 网关端点，必须走 web-client；
 * 这里 mock 的正是那一层，消费端接线仍被完整覆盖）。
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import type {
  ListeningPortsSnapshotView,
  ListeningPortView,
  SSHConnectionEntry,
} from '@openAwork/web-client';

const portsClient = vi.hoisted(() => ({ list: vi.fn() }));
const terminalsClient = vi.hoisted(() => ({ kill: vi.fn() }));
// 「复制隧道命令」的 SSH 连接列表（仅远端网关请求）。必须有默认 resolve 值：
// 否则远端用例会走到真实的 createSshClient，向 gateway.example.com 发请求。
const sshClient = vi.hoisted(() => ({ list: vi.fn() }));

vi.mock('@openAwork/web-client', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@openAwork/web-client')>();
  return {
    ...actual,
    createListeningPortsClient: () => ({ list: portsClient.list }),
    // 终止必须走既有的 kill(token, sessionId, terminalId)：这里 mock 的正是
    // web-client 那一层，`terminals-api` 的封装与消费端接线仍被完整覆盖。
    createSessionTerminalsClient: () => terminalsClient,
    createSshClient: () => sshClient,
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
    establishedConnections: 0,
    processAlive: true,
    terminal: null,
    ...overrides,
  };
}

function makeSnapshot(
  overrides: Partial<ListeningPortsSnapshotView> = {},
): ListeningPortsSnapshotView {
  return {
    ports: [],
    strategy: 'procfs',
    attributionSupported: true,
    collectedAtMs: 1_700_000_000_000,
    ...overrides,
  };
}

function makeSshEntry(overrides: Partial<SSHConnectionEntry> = {}): SSHConnectionEntry {
  return {
    id: 'ssh-1',
    host: 'dev.example.com',
    port: 22,
    username: 'ubuntu',
    status: 'connected',
    ...overrides,
  };
}

function renderPanel(gatewayUrl: string = LOCAL_GATEWAY) {
  return render(<TerminalPortsPanel gatewayUrl={gatewayUrl} token={TOKEN} />);
}

function rowFor(port: number): HTMLElement {
  return screen.getByTestId(`terminal-ports-row-${port}`);
}

/** 复制走的是 `terminal-key-handlers` 的 writeClipboardText → navigator.clipboard。 */
function stubClipboard(writeText: (text: string) => Promise<void>): void {
  Object.defineProperty(navigator, 'clipboard', {
    configurable: true,
    value: { writeText },
  });
}

function typeFilter(value: string): void {
  fireEvent.change(screen.getByTestId('terminal-ports-filter-input'), {
    target: { value },
  });
}

beforeEach(() => {
  portsClient.list.mockReset();
  terminalsClient.kill.mockReset();
  sshClient.list.mockReset();
  sshClient.list.mockResolvedValue([]);
});

afterEach(() => {
  cleanup();
  localStorage.clear();
  Reflect.deleteProperty(navigator, 'clipboard');
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
    expect(portsClient.list).toHaveBeenCalledWith(
      TOKEN,
      expect.objectContaining({ signal: expect.anything() }),
    );
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

    expect(
      within(rowFor(3000)).getByRole('link', { name: '在浏览器打开' }).getAttribute('href'),
    ).toBe('http://localhost:3000');
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
      expect(
        (within(rowFor(8080)).getByRole('button', { name: '在浏览器打开' }) as HTMLButtonElement)
          .disabled,
      ).toBe(true);
    });
    expect(screen.queryByRole('link')).toBeNull();
  });
});

describe('specific 绑定：打开被禁用（真实缺陷修复）', () => {
  it('同机 + 具体地址：不再渲染打开链接，禁用并说明绑定地址连不上；复制地址照常可用', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    stubClipboard(writeText);
    portsClient.list.mockResolvedValue(
      makeSnapshot({
        ports: [makePort({ port: 8080, bindAddress: '192.168.1.7', processName: 'python3' })],
      }),
    );
    renderPanel(LOCAL_GATEWAY);
    await screen.findByTestId('terminal-ports-table');

    const row = rowFor(8080);
    expect(within(row).getByText('指定地址')).toBeTruthy();
    // 关键回归锁：不再渲染点了必然连不上的 http://localhost:8080。
    expect(within(row).queryByRole('link')).toBeNull();
    const open = within(row).getByRole('button', { name: '在浏览器打开' }) as HTMLButtonElement;
    expect(open.disabled).toBe(true);
    expect(open.getAttribute('title')).toBe('端口只监听 192.168.1.7，localhost 无法访问');

    fireEvent.click(within(row).getByTestId('terminal-ports-copy-8080'));
    await waitFor(() => expect(writeText).toHaveBeenCalledWith('localhost:8080'));
    expect(screen.getByTestId('terminal-ports-copy-status').textContent).toBe(
      '已复制 localhost:8080',
    );
  });

  it('远端 + 具体地址：禁用原因同时说明无代理路径与绑定地址；链接始终不渲染', async () => {
    portsClient.list.mockResolvedValue(
      makeSnapshot({ ports: [makePort({ port: 8080, bindAddress: '192.168.1.7' })] }),
    );
    renderPanel(REMOTE_GATEWAY);
    await screen.findByTestId('terminal-ports-table');

    const open = within(rowFor(8080)).getByRole('button', { name: '在浏览器打开' });
    expect((open as HTMLButtonElement).disabled).toBe(true);
    expect(open.getAttribute('title')).toBe(
      '需要反向代理，当前未启用；且端口只监听 192.168.1.7，localhost 无法访问',
    );
    expect(screen.queryByRole('link')).toBeNull();
  });
});

describe('复制隧道命令（仅远端网关，即「在浏览器打开」被禁用的同一条件）', () => {
  it('远端：出现隧道动作，复制带 SSH 连接的命令并播报 user@host；title 带容器提醒', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    stubClipboard(writeText);
    sshClient.list.mockResolvedValue([makeSshEntry({ host: 'dev.example.com', port: 2222 })]);
    portsClient.list.mockResolvedValue(
      makeSnapshot({ ports: [makePort({ port: 3000, bindAddress: '127.0.0.1' })] }),
    );
    renderPanel(REMOTE_GATEWAY);
    await screen.findByTestId('terminal-ports-table');

    // 取数走 web-client 的 SSH 客户端（带取消信号），且只在远端发生。
    expect(sshClient.list).toHaveBeenCalledWith(
      TOKEN,
      expect.objectContaining({ signal: expect.anything() }),
    );

    const tunnel = screen.getByTestId('terminal-ports-tunnel-3000');
    expect(tunnel.getAttribute('title')).toContain('容器');
    fireEvent.click(tunnel);

    await waitFor(() =>
      expect(writeText).toHaveBeenCalledWith(
        'ssh -L 3000:127.0.0.1:3000 -p 2222 ubuntu@dev.example.com',
      ),
    );
    expect(screen.getByTestId('terminal-ports-copy-status').textContent).toBe(
      '已复制隧道命令（ubuntu@dev.example.com）',
    );
    expect(screen.getByTestId('terminal-ports-tunnel-3000').getAttribute('data-copied')).toBe(
      'true',
    );
    // 远端没有「复制地址」动作（地址不可达，见「P0 复制地址」describe）：隧道按钮是唯一的复制入口。
    expect(screen.queryByTestId('terminal-ports-copy-3000')).toBeNull();
  });

  it('specific 绑定：隧道目标用实际绑定地址（不是 localhost）', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    stubClipboard(writeText);
    sshClient.list.mockResolvedValue([makeSshEntry()]);
    portsClient.list.mockResolvedValue(
      makeSnapshot({ ports: [makePort({ port: 8080, bindAddress: '192.168.1.7' })] }),
    );
    renderPanel(REMOTE_GATEWAY);
    await screen.findByTestId('terminal-ports-table');

    fireEvent.click(screen.getByTestId('terminal-ports-tunnel-8080'));

    await waitFor(() =>
      expect(writeText).toHaveBeenCalledWith('ssh -L 8080:192.168.1.7:8080 ubuntu@dev.example.com'),
    );
  });

  it('同机：既不发 SSH 列表请求，也不渲染隧道动作（直连链接已覆盖该场景）', async () => {
    portsClient.list.mockResolvedValue(makeSnapshot({ ports: [makePort({ port: 3000 })] }));
    renderPanel(LOCAL_GATEWAY);
    await screen.findByTestId('terminal-ports-table');

    expect(screen.queryByTestId('terminal-ports-tunnel-3000')).toBeNull();
    expect(sshClient.list).not.toHaveBeenCalled();
  });

  it('没有配置 SSH 连接：复制占位模板并明确播报「模板」，端口列表照常工作', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    stubClipboard(writeText);
    sshClient.list.mockResolvedValue([]);
    portsClient.list.mockResolvedValue(
      makeSnapshot({ ports: [makePort({ port: 8080, bindAddress: '192.168.1.7' })] }),
    );
    renderPanel(REMOTE_GATEWAY);
    await screen.findByTestId('terminal-ports-table');

    fireEvent.click(screen.getByTestId('terminal-ports-tunnel-8080'));

    await waitFor(() =>
      expect(writeText).toHaveBeenCalledWith('ssh -L 8080:192.168.1.7:8080 <用户名>@<主机>'),
    );
    expect(screen.getByTestId('terminal-ports-copy-status').textContent).toBe('已复制隧道命令模板');
    expect(screen.getByTestId('terminal-ports-table')).toBeTruthy();
  });

  it('SSH 列表读取失败：静默降级为占位模板，端口列表不出现错误态', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    stubClipboard(writeText);
    sshClient.list.mockRejectedValue(new Error('网络异常，读取 SSH 连接列表失败。'));
    portsClient.list.mockResolvedValue(
      makeSnapshot({ ports: [makePort({ port: 3000, bindAddress: '0.0.0.0' })] }),
    );
    renderPanel(REMOTE_GATEWAY);
    await screen.findByTestId('terminal-ports-table');

    fireEvent.click(screen.getByTestId('terminal-ports-tunnel-3000'));

    await waitFor(() =>
      expect(writeText).toHaveBeenCalledWith('ssh -L 3000:127.0.0.1:3000 <用户名>@<主机>'),
    );
    expect(screen.getByTestId('terminal-ports-copy-status').textContent).toBe('已复制隧道命令模板');
    expect(screen.queryByTestId('terminal-ports-error')).toBeNull();
  });
});

describe('远端说明：容器边界', () => {
  it('单行 chip 写明容器内的监听 localhost 与 ssh -L 都不可达；原因全文在 title', async () => {
    portsClient.list.mockResolvedValue(makeSnapshot({ ports: [makePort()] }));
    renderPanel(REMOTE_GATEWAY);
    await screen.findByTestId('terminal-ports-table');

    const notice = screen.getByTestId('terminal-ports-remote-notice');
    expect(notice.textContent).toContain('容器');
    expect(notice.textContent).toContain('ssh -L');
    // 全文在 title：-L 目标由 SSH 服务端（宿主机）解析，而不是容器网络命名空间。
    const title = notice.getAttribute('title') ?? '';
    expect(title).toContain('SSH 服务端');
    expect(title).toContain('容器网络命名空间');
  });
});

describe('P0 工具条：刷新 / 暂停', () => {
  const PORTS = [makePort({ port: 3000 })];

  it('成功态提供「刷新」：点击立刻再取数，且不闪回 loading 状态', async () => {
    portsClient.list.mockResolvedValue(makeSnapshot({ ports: PORTS }));
    renderPanel();

    await screen.findByTestId('terminal-ports-table');
    expect(screen.getByRole('button', { name: '刷新' })).toBeTruthy();

    fireEvent.click(screen.getByTestId('terminal-ports-refresh'));

    await waitFor(() => expect(portsClient.list).toHaveBeenCalledTimes(2));
    expect(screen.queryByTestId('terminal-ports-loading')).toBeNull();
    expect(screen.getByTestId('terminal-ports-table')).toBeTruthy();
  });

  it('「暂停 / 继续」按钮：文案与 aria-label 随状态切换（完整语义走 aria-label）', async () => {
    portsClient.list.mockResolvedValue(makeSnapshot({ ports: PORTS }));
    renderPanel();

    await screen.findByTestId('terminal-ports-table');
    const toggle = screen.getByTestId('terminal-ports-pause');
    expect(toggle.getAttribute('aria-label')).toBe('暂停自动刷新');
    expect(toggle.textContent).toBe('暂停');

    fireEvent.click(toggle);

    const resumed = screen.getByTestId('terminal-ports-pause');
    expect(resumed.getAttribute('aria-label')).toBe('继续自动刷新');
    expect(resumed.textContent).toBe('继续');
  });
});

describe('P0 筛选', () => {
  const PORTS: ListeningPortView[] = [
    makePort({ port: 8080, bindAddress: '0.0.0.0', pid: 42, processName: 'python3' }),
    makePort({ port: 3000, bindAddress: '127.0.0.1', pid: 1234, processName: 'node' }),
    makePort({ port: 5173, bindAddress: '::1', pid: 777, processName: 'vite', protocol: 'tcp6' }),
  ];

  it('筛选框带 data-terminal-ui-input 标记（面板级快捷键放行的唯一判据）', async () => {
    portsClient.list.mockResolvedValue(makeSnapshot({ ports: PORTS }));
    renderPanel();
    await screen.findByTestId('terminal-ports-table');

    expect(
      screen.getByTestId('terminal-ports-filter-input').hasAttribute('data-terminal-ui-input'),
    ).toBe(true);
  });

  it('按进程名过滤，计数显示「匹配 N / M」', async () => {
    portsClient.list.mockResolvedValue(makeSnapshot({ ports: PORTS }));
    renderPanel();
    await screen.findByTestId('terminal-ports-table');

    typeFilter('vite');

    expect(screen.getByTestId('terminal-ports-row-5173')).toBeTruthy();
    expect(screen.queryByTestId('terminal-ports-row-3000')).toBeNull();
    expect(screen.queryByTestId('terminal-ports-row-8080')).toBeNull();
    expect(screen.getByTestId('terminal-ports-count').textContent).toBe('匹配 1 / 3 个');
  });

  it('大小写不敏感、先 trim；端口数字 / 绑定地址 / 协议均可命中', async () => {
    portsClient.list.mockResolvedValue(makeSnapshot({ ports: PORTS }));
    renderPanel();
    await screen.findByTestId('terminal-ports-table');

    typeFilter('  PYTHON3 ');
    expect(screen.getByTestId('terminal-ports-row-8080')).toBeTruthy();
    expect(screen.queryByTestId('terminal-ports-row-3000')).toBeNull();

    typeFilter('127.0.0.1');
    expect(screen.getByTestId('terminal-ports-row-3000')).toBeTruthy();
    expect(screen.queryByTestId('terminal-ports-row-8080')).toBeNull();

    typeFilter('tcp6');
    expect(screen.getByTestId('terminal-ports-row-5173')).toBeTruthy();
    expect(screen.queryByTestId('terminal-ports-row-3000')).toBeNull();

    typeFilter('3000');
    expect(screen.getByTestId('terminal-ports-row-3000')).toBeTruthy();
    expect(screen.queryByTestId('terminal-ports-row-5173')).toBeNull();
  });

  it('无匹配：专用空态 + 「匹配 0 / 3」；清除筛选后恢复完整列表', async () => {
    portsClient.list.mockResolvedValue(makeSnapshot({ ports: PORTS }));
    renderPanel();
    await screen.findByTestId('terminal-ports-table');

    typeFilter('没有这个进程');

    expect(screen.getByTestId('terminal-ports-filter-empty')).toBeTruthy();
    expect(screen.queryByTestId('terminal-ports-table')).toBeNull();
    expect(screen.getByTestId('terminal-ports-count').textContent).toBe('匹配 0 / 3 个');

    fireEvent.click(screen.getByRole('button', { name: '清除筛选' }));

    expect(screen.getByTestId('terminal-ports-table')).toBeTruthy();
    expect(screen.getAllByTestId(/^terminal-ports-row-/)).toHaveLength(3);
    expect(screen.getByTestId('terminal-ports-count').textContent).toBe('共 3 个监听端口');
  });
});

describe('P0 复制地址', () => {
  const PORTS: ListeningPortView[] = [
    makePort({ port: 8080, bindAddress: '0.0.0.0', pid: 42, processName: 'python3' }),
    makePort({ port: 3000, bindAddress: '127.0.0.1', pid: null, processName: null }),
  ];

  it('同机：渲染复制动作并复制 localhost:<port>；按钮切对勾，读屏区播报「已复制 …」', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    stubClipboard(writeText);
    portsClient.list.mockResolvedValue(makeSnapshot({ ports: PORTS }));
    renderPanel(LOCAL_GATEWAY);
    await screen.findByTestId('terminal-ports-table');

    const copy8080 = screen.getByTestId('terminal-ports-copy-8080');
    expect(copy8080.getAttribute('aria-label')).toBe('复制地址');
    expect(copy8080.getAttribute('title')).toBe('复制 localhost:8080');

    fireEvent.click(copy8080);

    await waitFor(() => expect(writeText).toHaveBeenCalledWith('localhost:8080'));
    expect(screen.getByTestId('terminal-ports-copy-status').textContent).toBe(
      '已复制 localhost:8080',
    );
    expect(screen.getByTestId('terminal-ports-copy-8080').getAttribute('data-copied')).toBe('true');
    // 对勾只出现在被复制的那一行。
    expect(screen.getByTestId('terminal-ports-copy-3000').getAttribute('data-copied')).toBeNull();
  });

  it('远端：不渲染「复制地址」动作（<网关 host>:<port> 多数不可达，不提供伪可用地址）', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    stubClipboard(writeText);
    portsClient.list.mockResolvedValue(makeSnapshot({ ports: PORTS }));
    renderPanel(REMOTE_GATEWAY);
    await screen.findByTestId('terminal-ports-table');

    // 网关 host 只说明「网关在哪」，不代表该监听端口从用户机器可达；整个动作不存在。
    expect(screen.queryByRole('button', { name: '复制地址' })).toBeNull();
    for (const port of PORTS) {
      expect(
        within(rowFor(port.port)).queryByTestId(`terminal-ports-copy-${port.port}`),
      ).toBeNull();
    }
    expect(writeText).not.toHaveBeenCalled();

    // 诚实的替代仍在：ssh -L 隧道命令 + 远端不可达说明 chip。
    expect(screen.getByTestId('terminal-ports-tunnel-8080')).toBeTruthy();
    expect(screen.getByTestId('terminal-ports-remote-notice')).toBeTruthy();
  });

  it('远端 + 未知状态：null 语义保持不变（不代表 0 / 不代表退出 / 不代表外部进程）', async () => {
    portsClient.list.mockResolvedValue(
      makeSnapshot({
        attributionSupported: false,
        ports: [
          makePort({
            port: 4202,
            source: 'lsof',
            pid: null,
            processName: null,
            establishedConnections: null,
            processAlive: null,
            terminal: null,
          }),
        ],
      }),
    );
    renderPanel(REMOTE_GATEWAY);
    await screen.findByTestId('terminal-ports-table');

    const row = rowFor(4202);
    // establishedConnections === null：不显示成「无连接」或任何数字。
    expect(within(row).queryByText(/无连接|条连接/)).toBeNull();
    // processAlive === null：不显示「进程已退出」。
    expect(within(row).queryByTestId('terminal-ports-exited-4202')).toBeNull();
    // attributionSupported === false：terminal === null 只能说「归属不可用」。
    const chip = within(row).getByTestId('terminal-ports-owner-4202');
    expect(chip.textContent).toBe('归属不可用');
    expect(within(row).queryByText('外部进程')).toBeNull();

    // 本次唯一的远端变化是不再有「复制地址」；状态 title 仍完整解释未知。
    expect(within(row).queryByTestId('terminal-ports-copy-4202')).toBeNull();
    const status = row.querySelector('.terminal-ports__cell--status');
    expect(status?.getAttribute('title')).toContain('不代表为 0');
    expect(status?.getAttribute('title')).toContain('不代表进程已退出');
  });

  it('剪贴板不可用：播报失败原因，不静默吞掉', async () => {
    stubClipboard(vi.fn().mockRejectedValue(new Error('当前环境不支持写入剪贴板')));
    portsClient.list.mockResolvedValue(makeSnapshot({ ports: PORTS }));
    renderPanel(LOCAL_GATEWAY);
    await screen.findByTestId('terminal-ports-table');

    fireEvent.click(screen.getByTestId('terminal-ports-copy-3000'));

    await waitFor(() =>
      expect(screen.getByTestId('terminal-ports-copy-status').textContent).toBe(
        '复制失败：当前环境不支持写入剪贴板',
      ),
    );
    expect(screen.getByTestId('terminal-ports-copy-3000').getAttribute('data-copied')).toBeNull();
  });
});

describe('P0 紧凑重排的 DOM 契约', () => {
  // jsdom 不评估 CSS、更没有容器查询：这里只锁「窄宽度不丢进程信息」的 DOM 前提 ——
  // 进程单元格照常渲染且带 terminal-ports__col-process、动作按钮恒在；真实的两行重排 /
  // 粘性表头 / 无横向溢出只能在浏览器里验证（CSS 文本契约见
  // terminal-ports-layout.contract.test.ts 的注释）。
  it('每行都渲染进程单元格、绑定地址与两个动作按钮（不会被窄宽度移除）', async () => {
    portsClient.list.mockResolvedValue(
      makeSnapshot({
        ports: [makePort({ port: 8080, bindAddress: '0.0.0.0', pid: 42, processName: 'python3' })],
      }),
    );
    renderPanel();
    const table = await screen.findByTestId('terminal-ports-table');

    expect(table.querySelector('.terminal-ports__col-process')?.textContent).toBe(
      'python3 · pid 42',
    );
    expect(table.querySelector('.terminal-ports__cell--bind')?.textContent).toContain('0.0.0.0');
    expect(within(rowFor(8080)).getByTestId('terminal-ports-copy-8080')).toBeTruthy();
    expect(within(rowFor(8080)).getByRole('link', { name: '在浏览器打开' })).toBeTruthy();
  });
});

describe('端口状态与归属 chip（A + B）', () => {
  function renderRows(ports: ListeningPortView[], attributionSupported = true): void {
    portsClient.list.mockResolvedValue(makeSnapshot({ ports, attributionSupported }));
    renderPanel();
  }

  it('连接状态：0 → 无连接；N → N 条连接；未知（null）不显示数字，原因在 title', async () => {
    renderRows([
      makePort({ port: 4000, establishedConnections: 0 }),
      makePort({ port: 4001, establishedConnections: 2 }),
      makePort({
        port: 4002,
        establishedConnections: null,
        processAlive: null,
        source: 'lsof',
      }),
    ]);
    await screen.findByTestId('terminal-ports-table');

    expect(within(rowFor(4000)).getByText('无连接')).toBeTruthy();
    expect(within(rowFor(4001)).getByText('2 条连接')).toBeTruthy();

    const unknownStatus = rowFor(4002).querySelector('.terminal-ports__cell--status');
    expect(within(rowFor(4002)).queryByText(/无连接|条连接/)).toBeNull();
    expect(unknownStatus?.getAttribute('title')).toContain('不代表为 0');
    expect(unknownStatus?.getAttribute('title')).toContain('不代表进程已退出');
  });

  it('processAlive === false 才出现「进程已退出」；true / null 都不出现（不制造恒亮噪音）', async () => {
    renderRows([
      makePort({ port: 4100, processAlive: false }),
      makePort({ port: 4101, processAlive: true }),
      makePort({ port: 4102, processAlive: null }),
    ]);
    await screen.findByTestId('terminal-ports-table');

    const exited = within(rowFor(4100)).getByTestId('terminal-ports-exited-4100');
    expect(exited.textContent).toContain('进程已退出');
    expect(exited.getAttribute('title')).toContain('端口可能已释放');

    expect(within(rowFor(4101)).queryByTestId('terminal-ports-exited-4101')).toBeNull();
    expect(within(rowFor(4102)).queryByTestId('terminal-ports-exited-4102')).toBeNull();
  });

  it('归属 chip：命中终端 → 「本网关终端」（title 带会话 / 终端）且可终止；未命中 → 「外部进程」', async () => {
    renderRows([
      makePort({ port: 4000, terminal: { sessionId: 's-9', terminalId: 't-9' } }),
      makePort({ port: 5000, terminal: null }),
    ]);
    await screen.findByTestId('terminal-ports-table');

    const attributed = within(rowFor(4000)).getByTestId('terminal-ports-owner-4000');
    expect(attributed.textContent).toBe('本网关终端');
    expect(attributed.getAttribute('title')).toContain('会话 s-9');
    expect(attributed.getAttribute('title')).toContain('终端 t-9');
    expect(within(rowFor(4000)).getByRole('button', { name: '终止该终端' })).toBeTruthy();

    const external = within(rowFor(5000)).getByTestId('terminal-ports-owner-5000');
    expect(external.textContent).toBe('外部进程');
    expect(external.getAttribute('title')).toContain('无法从此处处理');
    expect(within(rowFor(5000)).queryByRole('button', { name: '终止该终端' })).toBeNull();
  });

  it('平台不支持归属：chip 显示「归属不可用」而不是「外部进程」，且没有终止动作', async () => {
    renderRows(
      [
        makePort({
          port: 4202,
          source: 'lsof',
          pid: null,
          terminal: null,
          establishedConnections: null,
          processAlive: null,
        }),
      ],
      false,
    );
    await screen.findByTestId('terminal-ports-table');

    const chip = within(rowFor(4202)).getByTestId('terminal-ports-owner-4202');
    expect(chip.textContent).toBe('归属不可用');
    expect(chip.getAttribute('title')).toContain('不代表它是外部进程');
    expect(within(rowFor(4202)).queryByText('外部进程')).toBeNull();
    expect(within(rowFor(4202)).queryByRole('button', { name: '终止该终端' })).toBeNull();

    // 进程列的 title 也不能把「不知道」说成「不是你的终端」。
    expect(rowFor(4202).querySelector('.terminal-ports__col-process')?.getAttribute('title')).toBe(
      '当前平台无法判断占用者是否属于本网关终端（仅 linux/procfs 支持归属）',
    );
  });
});

describe('终止该终端：归属门禁 + 确认 + 反馈', () => {
  const ATTRIBUTED = makePort({
    port: 4000,
    pid: 9001,
    processName: 'node',
    terminal: { sessionId: 'session-1', terminalId: 'term-1' },
  });
  const FOREIGN = makePort({
    port: 5000,
    pid: 8100,
    processName: 'other',
    terminal: null,
  });

  function renderWithPorts(): void {
    portsClient.list.mockResolvedValue(makeSnapshot({ ports: [ATTRIBUTED, FOREIGN] }));
    renderPanel();
  }

  async function openKillConfirm(): Promise<void> {
    renderWithPorts();
    await screen.findByTestId('terminal-ports-table');
    fireEvent.click(screen.getByTestId('terminal-ports-kill-4000'));
    await screen.findByTestId('terminal-ports-kill-confirm');
  }

  it('只有归属到本人终端的行显示「终止该终端」；未归属行没有动作并解释原因', async () => {
    renderWithPorts();
    await screen.findByTestId('terminal-ports-table');

    expect(within(rowFor(4000)).getByRole('button', { name: '终止该终端' })).toBeTruthy();
    expect(within(rowFor(5000)).queryByRole('button', { name: '终止该终端' })).toBeNull();

    const attributedProcess = rowFor(4000).querySelector('.terminal-ports__col-process');
    expect(attributedProcess?.getAttribute('title')).toBe(
      '该端口由你启动的终端（会话 session-1）占用，可在此终止',
    );
    const foreignProcess = rowFor(5000).querySelector('.terminal-ports__col-process');
    expect(foreignProcess?.getAttribute('title')).toBe(
      '占用者不是本网关为你启动的终端，请在那台机器上处理',
    );
  });

  it('点击终止只打开确认条，不直接调用 kill；Escape 取消（焦点先落在确认按钮）', async () => {
    await openKillConfirm();

    expect(terminalsClient.kill).not.toHaveBeenCalled();
    expect(screen.getByTestId('terminal-ports-kill-confirm').textContent).toContain('term-1');
    expect(document.activeElement).toBe(screen.getByTestId('terminal-ports-kill-confirm-accept'));

    fireEvent.keyDown(screen.getByTestId('terminal-ports-kill-confirm'), { key: 'Escape' });

    expect(screen.queryByTestId('terminal-ports-kill-confirm')).toBeNull();
    expect(terminalsClient.kill).not.toHaveBeenCalled();
  });

  it('「取消」关闭确认条且不发请求', async () => {
    await openKillConfirm();

    fireEvent.click(screen.getByTestId('terminal-ports-kill-confirm-cancel'));

    expect(screen.queryByTestId('terminal-ports-kill-confirm')).toBeNull();
    expect(terminalsClient.kill).not.toHaveBeenCalled();
  });

  it('确认后调用 kill(token, sessionId, terminalId)，成功后静默刷新 + role=status 播报', async () => {
    terminalsClient.kill.mockResolvedValue({
      result: { found: true, alreadyClosed: false, killed: true },
      terminal: null,
    });

    await openKillConfirm();
    fireEvent.click(screen.getByTestId('terminal-ports-kill-confirm-accept'));

    await waitFor(() =>
      // 第 4 个参数是封装层附带的取消信号选项：只钉死「发给谁」的三元组。
      expect(terminalsClient.kill).toHaveBeenCalledWith(
        TOKEN,
        'session-1',
        'term-1',
        expect.anything(),
      ),
    );
    await waitFor(() => expect(portsClient.list).toHaveBeenCalledTimes(2));

    // 静默刷新：不闪回 loading，列表仍在。
    expect(screen.queryByTestId('terminal-ports-loading')).toBeNull();
    expect(screen.getByTestId('terminal-ports-table')).toBeTruthy();
    expect(screen.queryByTestId('terminal-ports-kill-confirm')).toBeNull();

    const notice = screen.getByTestId('terminal-ports-kill-notice');
    expect(notice.getAttribute('role')).toBe('status');
    expect(notice.textContent).toBe('已终止终端，正在刷新端口列表');
  });

  it('kill 失败：内联 alert 提示失败原因，不触发刷新、确认条保留', async () => {
    terminalsClient.kill.mockRejectedValue(new Error('目标终端不存在，无法终止终端。'));

    await openKillConfirm();
    fireEvent.click(screen.getByTestId('terminal-ports-kill-confirm-accept'));

    const notice = await screen.findByTestId('terminal-ports-kill-notice');
    expect(notice.getAttribute('role')).toBe('alert');
    expect(notice.textContent).toBe('终止终端失败：目标终端不存在，无法终止终端。');
    expect(portsClient.list).toHaveBeenCalledTimes(1);
    expect(screen.getByTestId('terminal-ports-kill-confirm')).toBeTruthy();
  });
});
