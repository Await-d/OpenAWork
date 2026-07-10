// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

const createWorkspaceMock = vi.hoisted(() => vi.fn(async () => 'workspace-1'));

const webClientMocks = vi.hoisted(() => ({
  listResources: vi.fn(async () => ({
    skills: [],
    agents: [],
    agentTemplates: [
      {
        id: 'resource-agent-template-agents',
        name: 'AGENTS',
        title: 'AGENTS.md',
        description: '工作区协议模板',
        integration: 'reference',
        visibility: 'feature',
        feature: 'team',
        usageKind: 'agent-template',
        path: '/resources/agents/reference/templates/AGENTS.md',
        content: '# AGENTS.md\n\n工作区协议',
      },
      {
        id: 'resource-agent-template-user',
        name: 'USER',
        title: 'USER.md',
        description: '用户偏好模板',
        integration: 'user',
        visibility: 'feature',
        feature: 'team',
        usageKind: 'agent-template',
        path: 'user_resources/user-template.md',
        source: 'user',
        removable: true,
        content: '# USER.md\n\n用户偏好',
      },
    ],
    commands: [],
    souls: [
      {
        id: 'resource-soul-balanced',
        name: 'balanced-collaborator',
        title: '稳健协作者',
        description: '通道人设，不应出现在工作区模板选择中',
        integration: 'reference',
        visibility: 'feature',
        feature: 'channels',
        usageKind: 'channel-persona',
        path: '/resources/souls/reference/balanced-collaborator.md',
        content: '# Balanced',
      },
    ],
    prompts: [],
    extensions: [],
    mcps: [],
  })),
  upsertWorkspaceKnowledge: vi.fn(async () => ({
    created: true,
    knowledge: {
      confidence: 1,
      createdAt: '2026-07-09T00:00:00.000Z',
      enabled: true,
      id: 'knowledge-1',
      key: 'resource-agent-template:agents',
      priority: 70,
      roleLayers: null,
      source: 'api',
      teamWorkspaceId: 'workspace-1',
      type: 'project_context',
      updatedAt: '2026-07-09T00:00:00.000Z',
      value: '# AGENTS.md',
      workspaceRoot: null,
    },
  })),
}));

vi.mock('@openAwork/web-client', () => ({
  createResourcesClient: vi.fn(() => ({
    list: webClientMocks.listResources,
  })),
  createTeamPhaseAClient: vi.fn(() => ({
    upsertWorkspaceKnowledge: webClientMocks.upsertWorkspaceKnowledge,
  })),
  createWorkspaceClient: vi.fn(() => ({})),
}));

vi.mock('../../../../../stores/auth/auth.js', () => ({
  useAuthStore: <T,>(selector: (state: { accessToken: string; gatewayUrl: string }) => T): T =>
    selector({ accessToken: 'token-1', gatewayUrl: 'http://gateway.local' }),
}));

vi.mock('../../data/team-runtime-reference-data.js', () => ({
  useTeamRuntimeReferenceViewData: () => ({
    workspaces: [],
    createWorkspace: createWorkspaceMock,
  }),
}));

vi.mock('../../../../../components/common/modal/WorkspacePickerModal.js', () => ({
  default: () => null,
}));

import { NewTeamWorkspaceModal } from './NewTeamWorkspaceModal.js';

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe('NewTeamWorkspaceModal', () => {
  it('Given team agentTemplates resources When rendering Then it shows them as workspace templates only', async () => {
    render(<NewTeamWorkspaceModal onClose={vi.fn()} />);

    await waitFor(() => {
      expect(webClientMocks.listResources).toHaveBeenCalledWith('token-1');
    });

    expect(await screen.findByText('AGENTS.md')).toBeTruthy();
    expect(screen.getByText('USER.md')).toBeTruthy();
    expect(screen.queryByText('稳健协作者')).toBeNull();
  });

  it('Given a selected workspace template When creating workspace Then it initializes workspace knowledge', async () => {
    const onClose = vi.fn();
    const onCreated = vi.fn();
    render(<NewTeamWorkspaceModal onClose={onClose} onCreated={onCreated} />);

    fireEvent.change(screen.getByLabelText(/名称/), { target: { value: '资源集成工作区' } });
    fireEvent.click(await screen.findByLabelText('选择 AGENTS.md 工作区模板'));
    fireEvent.click(screen.getByRole('button', { name: /创建工作区/ }));

    await waitFor(() => {
      expect(webClientMocks.upsertWorkspaceKnowledge).toHaveBeenCalledWith(
        'token-1',
        'workspace-1',
        expect.objectContaining({
          confidence: 1,
          key: 'resource-agent-template:agents',
          priority: 70,
          roleLayers: null,
          source: 'api',
          type: 'project_context',
          value: expect.stringContaining('# AGENTS.md'),
        }),
      );
    });

    expect(onCreated).toHaveBeenCalledWith('workspace-1');
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
