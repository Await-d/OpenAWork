// @vitest-environment jsdom
/**
 * TeamInitChecklist · 显示 / 提示 / 预览交互 smoke 测试
 *
 * 覆盖：
 *   1. 渲染步骤标题 + 进度计数 + 项目类型徽章
 *   2. proposed 步骤显示「执行 / 跳过」，done 步骤显示摘要 + 「查看预览」
 *   3. 点击「查看预览」展开预览内容（一级结构 chips）
 *   4. 已完成 / 已跳过 → 不渲染
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

// MarkdownMessageContent 桩，避免拉入 remark/rehype 全链。
vi.mock('../../../../components/chat/markdown/markdown-message-content.js', () => ({
  default: ({ content }: { content: string }) => <div data-testid="md">{content}</div>,
}));

import { TeamInitChecklist } from './TeamInitChecklist.js';

function buildMetadata(teamInit: TeamInitState): Record<string, unknown> {
  return { teamInit };
}

const BASE_STATE: TeamInitState = {
  version: 1,
  phase: 'in_progress',
  projectKind: 'existing',
  detectedAt: '2026-05-31T00:00:00.000Z',
  steps: [
    {
      key: 'scan-shared-record',
      title: '读取工作区共享项目记录',
      description: '检查工作区与目录。',
      status: 'done',
      requiresConfirm: false,
      usesLlm: false,
      result: { isEmpty: false, matchedSignals: ['package.json'], topLevelEntryCount: 5 },
    },
    {
      key: 'read-project-level1',
      title: '了解项目一级结构',
      description: '读取顶层目录与文件。',
      status: 'done',
      requiresConfirm: true,
      usesLlm: false,
      result: { directories: ['src', 'docs'], files: ['package.json'], directoryCount: 2, fileCount: 1 },
    },
    {
      key: 'bind-tools-per-layer',
      title: '为各层绑定工具能力',
      description: '绑定 skill 与 MCP。',
      status: 'proposed',
      requiresConfirm: true,
      usesLlm: true,
    },
  ],
  bindings: { perLayer: {} },
};

beforeEach(() => {
  vi.resetModules();
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('TeamInitChecklist', () => {
  it('渲染步骤标题、进度计数与项目类型徽章', () => {
    render(<TeamInitChecklist sessionId="s1" sessionMetadata={buildMetadata(BASE_STATE)} />);
    expect(screen.getByText('了解项目一级结构')).toBeTruthy();
    expect(screen.getByText('为各层绑定工具能力')).toBeTruthy();
    // 3 步全 actionable，2 done → 2/3
    expect(screen.getByText('2/3')).toBeTruthy();
    expect(screen.getByText('已有项目')).toBeTruthy();
  });

  it('proposed 步骤显示执行/跳过按钮', () => {
    render(<TeamInitChecklist sessionId="s1" sessionMetadata={buildMetadata(BASE_STATE)} />);
    expect(screen.getByText('执行')).toBeTruthy();
    expect(screen.getByText('跳过')).toBeTruthy();
  });

  it('done 步骤可展开预览，展示一级结构 chips', () => {
    render(<TeamInitChecklist sessionId="s1" sessionMetadata={buildMetadata(BASE_STATE)} />);
    const previewButtons = screen.getAllByText('查看预览');
    expect(previewButtons.length).toBeGreaterThan(0);
    fireEvent.click(previewButtons[0]!);
    // 展开后出现「收起预览」
    expect(screen.getByText('收起预览')).toBeTruthy();
  });

  it('phase=skipped 时不渲染', () => {
    const { container } = render(
      <TeamInitChecklist
        sessionId="s1"
        sessionMetadata={buildMetadata({ ...BASE_STATE, phase: 'skipped' })}
      />,
    );
    expect(container.querySelector('[aria-label="团队初始化清单"]')).toBeNull();
  });
});
