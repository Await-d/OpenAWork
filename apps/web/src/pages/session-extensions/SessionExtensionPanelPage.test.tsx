// @vitest-environment jsdom
/**
 * 会话扩展面板回归（261101）。
 *
 * 关注点：
 *   1. 渠道未开启管理时面板为只读（写操作全禁用）——这是渠道默认关的可见形态；
 *   2. 只提供收窄方向：能禁用 / 移除，界面不出现「启用」；
 *   3. 凭据保存后**清空输入框**，页面任何位置都不含明文。
 */
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const authState = { accessToken: 'token-test', gatewayUrl: 'https://gateway.test' };

const mocks = vi.hoisted(() => ({
  getState: vi.fn(),
  listOperations: vi.fn(),
  setInheritance: vi.fn(),
  revoke: vi.fn(),
  putSecret: vi.fn(),
  deleteSecret: vi.fn(),
}));

vi.mock('@openAwork/web-client', () => ({
  createSessionExtensionsClient: () => ({
    getState: mocks.getState,
    listOperations: mocks.listOperations,
    setInheritance: mocks.setInheritance,
    revoke: mocks.revoke,
    putSecret: mocks.putSecret,
    deleteSecret: mocks.deleteSecret,
  }),
}));

vi.mock('../../stores/auth/auth.js', () => ({
  useAuthStore: (selector: (state: typeof authState) => unknown) => selector(authState),
}));

import SessionExtensionPanelPage from './SessionExtensionPanelPage.js';

const SESSION = 's-panel-1';

function statePayload(overrides: Record<string, unknown> = {}) {
  return {
    sessionId: SESSION,
    source: 'channel',
    managementEnabled: true,
    inheritance: 'explicit' as const,
    configured: true,
    revision: 3,
    skills: [
      {
        skillId: 'demo-skill',
        resourceRef: 'skill:session:demo-skill',
        version: '1.0.0',
        enabled: true,
        pinned: false,
        contentDigest: 'd1',
      },
    ],
    mcpServers: [
      { resourceRef: 'mcp:session:demo', displayId: 'demo-mcp', enabled: true, hasSecret: true },
    ],
    secrets: [{ name: 'api-key', updatedAt: 1_700_000_000_000 }],
    ...overrides,
  };
}

function renderPage(): void {
  render(
    <MemoryRouter initialEntries={[`/session-extensions/panel?session=${SESSION}`]}>
      <SessionExtensionPanelPage />
    </MemoryRouter>,
  );
}

beforeEach(() => {
  mocks.getState.mockResolvedValue(statePayload());
  mocks.listOperations.mockResolvedValue({ ok: true, count: 0, operations: [] });
  mocks.revoke.mockResolvedValue(statePayload());
  mocks.setInheritance.mockResolvedValue(statePayload());
  mocks.putSecret.mockResolvedValue({ ok: true, name: 'api-key', secrets: [] });
  mocks.deleteSecret.mockResolvedValue({ ok: true, name: 'api-key', secrets: [] });
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe('会话扩展面板', () => {
  it('列出会话技能、MCP 与凭据，并只提供收窄按钮', async () => {
    renderPage();
    await waitFor(() => expect(screen.getByText('demo-skill')).toBeTruthy());
    expect(screen.getByText(/demo-mcp/)).toBeTruthy();
    expect(screen.getByText('api-key')).toBeTruthy();

    // 只有「禁用 / 移除」，不存在「启用」这类扩权入口。
    expect(screen.getAllByText('禁用').length).toBe(2);
    expect(screen.getAllByText('移除').length).toBe(2);
    expect(screen.queryByText('启用')).toBeNull();
  });

  it('移除技能时带上会话身份与 resourceRef', async () => {
    renderPage();
    await waitFor(() => expect(screen.getByText('demo-skill')).toBeTruthy());

    fireEvent.click(screen.getAllByText('移除')[0] as HTMLButtonElement);
    await waitFor(() => expect(mocks.revoke).toHaveBeenCalledTimes(1));
    expect(mocks.revoke).toHaveBeenCalledWith('token-test', SESSION, {
      kind: 'skill',
      resourceRef: 'skill:session:demo-skill',
      remove: true,
    });
  });

  it('渠道只能收窄继承策略：不能点「继承用户级」', async () => {
    renderPage();
    await waitFor(() => expect(screen.getByText('继承用户级')).toBeTruthy());
    expect((screen.getByText('继承用户级') as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByText('只用会话条目') as HTMLButtonElement).disabled).toBe(true);
  });

  it('保存凭据后清空输入框，且页面不含明文', async () => {
    renderPage();
    await waitFor(() => expect(screen.getByText('保存凭据')).toBeTruthy());

    const name = screen.getByLabelText('凭据名称') as HTMLInputElement;
    const value = screen.getByLabelText('凭据内容') as HTMLInputElement;
    fireEvent.change(name, { target: { value: 'new-key' } });
    fireEvent.change(value, { target: { value: 'plain-secret-value' } });
    fireEvent.click(screen.getByText('保存凭据'));

    await waitFor(() => expect(mocks.putSecret).toHaveBeenCalledTimes(1));
    expect(mocks.putSecret).toHaveBeenCalledWith(
      'token-test',
      SESSION,
      'new-key',
      'plain-secret-value',
    );
    // 明文用完即清：不留在组件状态里。
    await waitFor(() => expect(name.value).toBe(''));
    expect(value.value).toBe('');
  });

  it('未开启管理的来源给出只读说明并禁用全部写操作', async () => {
    mocks.getState.mockResolvedValue(statePayload({ managementEnabled: false, source: 'channel' }));
    renderPage();
    await waitFor(() => expect(screen.getByText(/未开启会话级扩展管理/)).toBeTruthy());
    for (const button of screen.getAllByText('禁用')) {
      expect((button as HTMLButtonElement).disabled).toBe(true);
    }
    expect((screen.getByText('保存凭据') as HTMLButtonElement).disabled).toBe(true);
  });
});
