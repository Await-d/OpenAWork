// @vitest-environment jsdom
/**
 * TeamInitSummaryPanel · 初始化成果常驻展示 smoke 测试
 *
 * 覆盖：
 *   1. 有 teamInit 时展示项目类型 / phase / 架构摘要 / 工具绑定
 *   2. 无 teamInit（非团队会话）时不渲染
 *   3. sessionId 为 null 时不渲染
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import type { TeamInitState } from '@openAwork/shared';

vi.mock('../../../../../stores/auth/auth.js', () => ({
  useAuthStore: (selector: (s: { accessToken: string; gatewayUrl: string }) => unknown) =>
    selector({ accessToken: 'tok', gatewayUrl: 'http://localhost:3000' }),
}));

vi.mock('../../../../../stores/team/team-events.js', () => ({
  useTeamNotificationStore: Object.assign(
    () => ({ events: [] }),
    { subscribe: () => () => undefined },
  ),
}));

vi.mock('../../../../../components/chat/markdown/markdown-message-content.js', () => ({
  default: ({ content }: { content: string }) => <div data-testid="md">{content}</div>,
}));

const getSessionInitMock = vi.fn();
vi.mock('@openAwork/web-client', () => ({
  createTeamClient: () => ({ getSessionInit: getSessionInitMock }),
}));

import { TeamInitSummaryPanel } from './TeamInitSummaryPanel.js';

const STATE: TeamInitState = {
  version: 1,
  phase: 'completed',
  projectKind: 'existing',
  detectedAt: '2026-05-31T00:00:00.000Z',
  steps: [
    {
      key: 'bind-tools-per-layer',
      title: '为各层绑定工具能力',
      description: '绑定 skill 与 MCP。',
      status: 'done',
      requiresConfirm: true,
      usesLlm: true,
      result: {
        perLayer: {
          executor: { skillIds: ['skill.a'], mcpServerIds: ['websearch'], rationale: '执行层' },
        },
      },
    },
  ],
  bindings: {
    perLayer: {},
    architectureSummary: '这是一个 monorepo 项目。',
  },
};

beforeEach(() => {
  getSessionInitMock.mockReset();
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('TeamInitSummaryPanel', () => {
  it('有 teamInit 时展示项目类型 / 架构摘要 / 工具绑定', async () => {
    getSessionInitMock.mockResolvedValue({ ok: true, teamInit: STATE });
    render(<TeamInitSummaryPanel sessionId="s1" />);
    await waitFor(() => expect(screen.getByText('🧭 初始化成果')).toBeTruthy());
    expect(screen.getByText('已有项目')).toBeTruthy();
    expect(screen.getByText('这是一个 monorepo 项目。')).toBeTruthy();
    expect(screen.getByText('为各层绑定工具能力')).toBeTruthy();
    expect(screen.getByText('skill.a')).toBeTruthy();
    expect(screen.getByText('websearch')).toBeTruthy();
  });

  it('无 teamInit（非团队会话）时不渲染', async () => {
    getSessionInitMock.mockResolvedValue({ ok: true, teamInit: null });
    const { container } = render(<TeamInitSummaryPanel sessionId="s2" />);
    await waitFor(() => expect(getSessionInitMock).toHaveBeenCalled());
    expect(container.textContent).not.toContain('初始化成果');
  });

  it('sessionId 为 null 时不渲染、不请求', () => {
    const { container } = render(<TeamInitSummaryPanel sessionId={null} />);
    expect(container.firstChild).toBeNull();
    expect(getSessionInitMock).not.toHaveBeenCalled();
  });

  it('full 变体在无记录时展示空态文案（而非空白）', async () => {
    getSessionInitMock.mockResolvedValue({ ok: true, teamInit: null });
    render(<TeamInitSummaryPanel sessionId="s9" variant="full" />);
    await waitFor(() => expect(getSessionInitMock).toHaveBeenCalled());
    expect(screen.getByText('当前会话没有初始化记录。')).toBeTruthy();
  });

  it('full 变体 sessionId 为 null 时提示先选会话', () => {
    render(<TeamInitSummaryPanel sessionId={null} variant="full" />);
    expect(screen.getByText(/请先在左侧选择一个团队会话/)).toBeTruthy();
  });
});
