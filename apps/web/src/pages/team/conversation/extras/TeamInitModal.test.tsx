// @vitest-environment jsdom
/**
 * TeamInitModal · 自动弹窗 + 重开入口 smoke 测试
 *
 * 覆盖：
 *   1. 有未完成清单时自动弹出弹窗（dialog 出现，含步骤标题）
 *   2. 关闭后保留「点此继续」重开入口，点击可重新打开
 *   3. phase=skipped 时不弹、也不显示重开入口
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import type { TeamInitState } from '@openAwork/shared';

vi.mock('../../../../stores/auth/auth.js', () => ({
  useAuthStore: (selector: (s: { accessToken: string; gatewayUrl: string }) => unknown) =>
    selector({ accessToken: 'tok', gatewayUrl: 'http://localhost:3000' }),
}));

vi.mock('@openAwork/web-client', () => ({
  createTeamClient: () => ({
    confirmSessionInitStep: vi.fn(async () => ({ ok: true, teamInit: null })),
    skipSessionInitStep: vi.fn(async () => ({ ok: true, teamInit: null })),
    skipSessionInit: vi.fn(async () => ({ ok: true, teamInit: null })),
  }),
}));

vi.mock('../../../../components/chat/markdown/markdown-message-content.js', () => ({
  default: ({ content }: { content: string }) => <div data-testid="md">{content}</div>,
}));

import { TeamInitModal } from './TeamInitModal.js';

const STATE: TeamInitState = {
  version: 1,
  phase: 'proposed',
  projectKind: 'existing',
  detectedAt: '2026-05-31T00:00:00.000Z',
  steps: [
    {
      key: 'read-project-level1',
      title: '了解项目一级结构',
      description: '读取顶层目录与文件。',
      status: 'proposed',
      requiresConfirm: true,
      usesLlm: false,
    },
  ],
  bindings: { perLayer: {} },
};

beforeEach(() => {
  vi.resetModules();
  try {
    sessionStorage.clear();
  } catch {
    /* noop */
  }
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('TeamInitModal', () => {
  it('有未完成清单时自动弹出弹窗', () => {
    render(<TeamInitModal sessionId="s1" sessionMetadata={{ teamInit: STATE }} />);
    expect(screen.getByRole('dialog', { name: '团队初始化准备' })).toBeTruthy();
    expect(screen.getByText('了解项目一级结构')).toBeTruthy();
  });

  it('关闭后显示常驻重开入口横幅，点击可重新打开', () => {
    render(<TeamInitModal sessionId="s2" sessionMetadata={{ teamInit: STATE }} />);
    fireEvent.click(screen.getByLabelText('关闭'));
    // 关闭后显示明显的横幅 + 「查看 / 继续」按钮
    expect(screen.getByText('团队初始化准备未完成')).toBeTruthy();
    const reopen = screen.getByText('查看 / 继续');
    expect(reopen).toBeTruthy();
    fireEvent.click(reopen);
    expect(screen.getByRole('dialog', { name: '团队初始化准备' })).toBeTruthy();
  });

  it('phase=skipped 时不弹也不显示入口', () => {
    const { container } = render(
      <TeamInitModal sessionId="s3" sessionMetadata={{ teamInit: { ...STATE, phase: 'skipped' } }} />,
    );
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(container.textContent).not.toContain('团队初始化准备未完成');
  });
});
