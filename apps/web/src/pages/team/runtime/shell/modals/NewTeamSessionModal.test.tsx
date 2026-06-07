// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';

const creationDraft = {
  title: '团队会话',
  source: { kind: 'blank' as const },
  requiredRoleBindings: {
    planner: 'agent-planner',
    researcher: 'agent-researcher',
    executor: 'agent-executor',
    reviewer: 'agent-reviewer',
  },
  optionalAgentIds: [] as string[],
  defaultProvider: null,
  memberSlots: [],
  workingDirectory: null,
};

const applyTemplateMock = vi.fn();

vi.mock('../../data/team-runtime-reference-data.js', () => ({
  useTeamRuntimeReferenceViewData: () => ({
    templateLoading: false,
    templates: [
      {
        id: 'tpl-1',
        name: '研究模板',
        description: '默认研究团队模板',
        category: 'team-playbook',
        badges: [],
        nodes: [],
        edges: [],
        metadata: {
          teamTemplate: {
            defaultProvider: 'anthropic',
          },
        },
      },
    ],
  }),
}));

vi.mock('../../hooks/use-team-runtime-role-bindings.js', () => ({
  useTeamRuntimeRoleBindings: () => ({
    agents: [
      {
        id: 'agent-planner',
        label: 'Planner',
        enabled: true,
        canonicalRole: { coreRole: 'planner' },
      },
      {
        id: 'agent-researcher',
        label: 'Researcher',
        enabled: true,
        canonicalRole: { coreRole: 'researcher' },
      },
      {
        id: 'agent-executor',
        label: 'Executor',
        enabled: true,
        canonicalRole: { coreRole: 'executor' },
      },
      {
        id: 'agent-reviewer',
        label: 'Reviewer',
        enabled: true,
        canonicalRole: { coreRole: 'reviewer' },
      },
    ],
    error: null,
  }),
}));

vi.mock('../../hooks/use-team-session-creation.js', () => ({
  generateDefaultSessionTitle: () => '默认团队会话',
  useTeamSessionCreation: () => ({
    step: 'review',
    currentStepIndex: 3,
    canSubmit: true,
    canAdvance: true,
    draft: creationDraft,
    fillDefaultTitle: vi.fn(),
    prevStep: vi.fn(),
    nextStep: vi.fn(),
    setSource: vi.fn(),
    applyTemplate: applyTemplateMock,
    setTitle: vi.fn(),
    toggleOptionalAgent: vi.fn(),
  }),
}));

vi.mock('@openAwork/web-client', () => ({
  createWorkspaceClient: () => ({}),
}));

vi.mock('../../../../../stores/auth/auth.js', () => ({
  useAuthStore: () => ({
    accessToken: 'token-1',
    gatewayUrl: 'http://localhost:3000',
  }),
}));

import { NewTeamSessionModal } from './NewTeamSessionModal.js';

beforeEach(() => {
  cleanup();
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  applyTemplateMock.mockReset();
});

describe('NewTeamSessionModal', () => {
  it('提交失败时会在弹窗内展示错误信息', async () => {
    render(
      <NewTeamSessionModal
        onClose={vi.fn()}
        onSubmitDraft={async () => {
          throw new Error('创建团队会话失败：网络异常。');
        }}
        workspaceLabel="默认工作区"
        teamWorkspaceId="tw-1"
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: /确认创建/i }));

    await waitFor(() => {
      expect(screen.getByRole('alert').textContent).toContain('创建团队会话失败：网络异常。');
    });
  });

  it('提交返回 false 时保留弹窗并显示通用错误信息', async () => {
    render(
      <NewTeamSessionModal
        onClose={vi.fn()}
        onSubmitDraft={vi.fn(async () => false)}
        workspaceLabel="默认工作区"
        teamWorkspaceId="tw-1"
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: /确认创建/i }));

    await waitFor(() => {
      expect(screen.getByRole('alert').textContent).toContain(
        '创建团队会话失败，请检查工作区配置或稍后重试。',
      );
    });
  });

  it('传入 initialTemplateId 时会自动套用对应模板', async () => {
    render(
      <NewTeamSessionModal
        onClose={vi.fn()}
        onSubmitDraft={vi.fn()}
        workspaceLabel="默认工作区"
        teamWorkspaceId="tw-1"
        initialTemplateId="tpl-1"
      />,
    );

    await waitFor(() => {
      expect(applyTemplateMock).toHaveBeenCalledWith(
        expect.objectContaining({
          id: 'tpl-1',
          name: '研究模板',
        }),
      );
    });
  });
});
