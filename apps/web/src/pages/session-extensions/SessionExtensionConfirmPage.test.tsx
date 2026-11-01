// @vitest-environment jsdom
/**
 * 会话扩展确认页回归（T-17）。
 *
 * 关注点：
 *   1. 只有待确认状态才允许点「确认 / 拒绝」；
 *   2. 页面不展示密钥，端点只给主机名；
 *   3. 非归属 / 不存在的提案给出可操作提示，而不是空白页。
 */
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const authState = {
  accessToken: 'token-test',
  gatewayUrl: 'https://gateway.test',
};

const mocks = vi.hoisted(() => ({
  getOperation: vi.fn(),
  getState: vi.fn(),
  listOperations: vi.fn(),
  decide: vi.fn(),
}));

vi.mock('@openAwork/web-client', () => ({
  createSessionExtensionsClient: () => ({
    getOperation: mocks.getOperation,
    getState: mocks.getState,
    listOperations: mocks.listOperations,
    decide: mocks.decide,
  }),
}));

vi.mock('../../stores/auth/auth.js', () => ({
  useAuthStore: (selector: (state: typeof authState) => unknown) => selector(authState),
}));

import SessionExtensionConfirmPage from './SessionExtensionConfirmPage.js';

const SESSION = 's-confirm-1';
const OPERATION = 'opx_confirm_1';

function operationDetail(overrides: Record<string, unknown> = {}) {
  return {
    ok: true,
    operation: {
      operationId: OPERATION,
      nonce: 'nonce-confirm-1',
      kind: 'skill',
      action: 'install',
      status: 'pending_approval',
      resourceRef: 'skill:session:demo',
      configDigest: 'digest-1',
      expectedRevision: 1,
      requestedAt: Date.now() - 1000,
      expiresAt: Date.now() + 600_000,
      decisionAt: null,
      appliedAt: null,
      approverUserId: null,
      requesterActorId: 'actor-1',
      channelId: 'ch-1',
      chatId: 'chat-1',
      errorCode: null,
      errorMessage: null,
      result: null,
      preview: {
        skillId: 'demo',
        displayName: '演示技能',
        sourceId: 'builtin',
        version: '1.0.0',
        scope: 'session',
        effectiveFrom: 'next_turn',
        declaredPermissions: [],
        hasMcp: false,
        warnings: ['该技能声明了权限项，请向用户说明。'],
      },
      ...overrides,
    },
  };
}

function renderPage(query = `?session=${SESSION}&operation=${OPERATION}`) {
  return render(
    <MemoryRouter initialEntries={[`/session-extensions/confirm${query}`]}>
      <SessionExtensionConfirmPage />
    </MemoryRouter>,
  );
}

beforeEach(() => {
  mocks.getOperation.mockReset();
  mocks.getState.mockReset();
  mocks.listOperations.mockReset();
  mocks.decide.mockReset();

  mocks.getOperation.mockResolvedValue(operationDetail());
  mocks.getState.mockResolvedValue({
    sessionId: SESSION,
    source: 'channel',
    managementEnabled: true,
    inheritance: 'explicit',
    configured: true,
    revision: 1,
    skills: [],
    mcpServers: [],
  });
  mocks.listOperations.mockResolvedValue({ ok: true, count: 0, operations: [] });
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe('会话扩展确认页', () => {
  it('展示目标、仅会话范围与风险提示', async () => {
    renderPage();
    await waitFor(() => expect(screen.getByText('演示技能')).toBeTruthy());
    // 精确匹配「生效范围」行的值，避免命中标题里的同名字样。
    expect(screen.getByText('仅当前会话')).toBeTruthy();
    expect(screen.getByText('该技能声明了权限项，请向用户说明。')).toBeTruthy();
    expect(screen.getByText(/其他会话与用户级配置不受影响/)).toBeTruthy();
  });

  it('确认后调用 decide(approve) 并提示结果', async () => {
    mocks.decide.mockResolvedValue({
      ok: true,
      decision: 'approved',
      applied: { kind: 'succeeded' },
    });
    renderPage();
    await waitFor(() => expect(screen.getByText('确认并生效')).toBeTruthy());

    fireEvent.click(screen.getByText('确认并生效'));
    await waitFor(() => expect(mocks.decide).toHaveBeenCalledTimes(1));
    expect(mocks.decide).toHaveBeenCalledWith('token-test', SESSION, OPERATION, {
      decision: 'approve',
      nonce: 'nonce-confirm-1',
    });
    await waitFor(() => expect(screen.getByText(/已确认并生效/)).toBeTruthy());
  });

  it('拒绝后提示未做任何变更', async () => {
    mocks.decide.mockResolvedValue({ ok: true, decision: 'rejected' });
    renderPage();
    await waitFor(() => expect(screen.getByText('拒绝')).toBeTruthy());

    fireEvent.click(screen.getByText('拒绝'));
    await waitFor(() => expect(screen.getByText(/已拒绝该提案，未做任何变更/)).toBeTruthy());
  });

  it.each([{ nonce: undefined }, { expiresAt: 1 }])(
    '缺少 nonce 或过期时禁止确认',
    async (override) => {
      mocks.getOperation.mockResolvedValue(operationDetail(override));
      renderPage();
      await waitFor(() => expect(screen.getByText('确认并生效')).toBeTruthy());
      expect((screen.getByText('确认并生效') as HTMLButtonElement).disabled).toBe(true);
      fireEvent.click(screen.getByText('确认并生效'));
      expect(mocks.decide).not.toHaveBeenCalled();
    },
  );

  it('委托管理员无需读取 owner 专属面板也能确认', async () => {
    mocks.getState.mockRejectedValue(new Error('会话不存在'));
    mocks.listOperations.mockRejectedValue(new Error('会话不存在'));
    renderPage();
    await waitFor(() => expect(screen.getByText('演示技能')).toBeTruthy());
    expect((screen.getByText('确认并生效') as HTMLButtonElement).disabled).toBe(false);
    expect(screen.queryByText('nonce-confirm-1')).toBeNull();
  });

  it('非待确认状态不允许再次确认', async () => {
    mocks.getOperation.mockResolvedValue(operationDetail({ status: 'succeeded' }));
    renderPage();
    await waitFor(() => expect(screen.getByText('确认并生效')).toBeTruthy());

    const approve = screen.getByText('确认并生效') as HTMLButtonElement;
    expect(approve.disabled).toBe(true);
    expect(screen.getByText(/无需再次确认/)).toBeTruthy();
    expect(mocks.decide).not.toHaveBeenCalled();
  });

  it('探活失败语义在页面上明确区分（配置已保存但不可用）', async () => {
    mocks.getOperation.mockResolvedValue(
      operationDetail({
        status: 'configured_unavailable',
        kind: 'mcp',
        errorMessage: 'connect ECONNREFUSED',
        preview: {
          displayId: 'local',
          transport: 'sse',
          endpointHost: 'example.com/mcp',
          hasSecret: true,
          scope: 'session',
          effectiveFrom: 'next_turn',
        },
      }),
    );
    renderPage();
    await waitFor(() => expect(screen.getByText('配置已保存但不可用')).toBeTruthy());
    expect(screen.getByText(/ECONNREFUSED/)).toBeTruthy();
    expect(screen.getByText('example.com/mcp')).toBeTruthy();
    // 凭据只显示「已配置引用」，不回显任何值。
    expect(screen.getByText('已配置引用（不回显）')).toBeTruthy();
  });

  it('找不到提案时给出可操作提示，而不是空白页', async () => {
    mocks.getOperation.mockRejectedValue(new Error('操作不存在。'));
    renderPage();
    await waitFor(() => expect(screen.getByText('找不到该提案')).toBeTruthy());
    expect(screen.getByText(/重新发起/)).toBeTruthy();
  });

  it('链接缺少参数时提示回到会话重新发起', async () => {
    renderPage('?session=');
    await waitFor(() => expect(screen.getByText('找不到该提案')).toBeTruthy());
    expect(screen.getByText(/链接缺少会话或操作参数/)).toBeTruthy();
  });
});
