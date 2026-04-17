// @vitest-environment jsdom

import { act, useEffect, useRef } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ManagedAgentRecord } from '@openAwork/shared';
import { useAuthStore } from '../../../stores/auth.js';
import { useResolvedTeamRuntimeReferenceData } from './team-runtime-reference-data.js';

type ReferenceDataState = ReturnType<typeof useResolvedTeamRuntimeReferenceData>;

const mockUseTeamCollaboration = vi.fn();
const mockUseTeamRuntimeRoleBindings = vi.fn();
const mockUseTeamWorkflowTemplates = vi.fn();
const mockUseTeamRuntimeProjection = vi.fn();

vi.mock('../use-team-collaboration.js', () => ({
  useTeamCollaboration: (...args: unknown[]) => mockUseTeamCollaboration(...args),
}));

vi.mock('./use-team-runtime-role-bindings.js', () => ({
  useTeamRuntimeRoleBindings: () => mockUseTeamRuntimeRoleBindings(),
}));

vi.mock('./use-team-workflow-templates.js', () => ({
  useTeamWorkflowTemplates: () => mockUseTeamWorkflowTemplates(),
}));

vi.mock('./use-team-runtime-projection.js', () => ({
  useTeamRuntimeProjection: () => mockUseTeamRuntimeProjection(),
}));

function buildCollaborationMock(overrides: Record<string, unknown> = {}) {
  return {
    auditLogs: [],
    busy: false,
    createMessage: vi.fn(async () => true),
    createSharedSessionComment: vi.fn(async () => true),
    createTask: vi.fn(async () => true),
    deleteSession: vi.fn(async () => true),
    error: null,
    feedback: null,
    loading: false,
    members: [],
    messages: [],
    refresh: vi.fn(async () => undefined),
    replySharedPermission: vi.fn(async () => true),
    replySharedQuestion: vi.fn(async () => true),
    runtimeTaskGroups: [],
    runtimeTaskRecords: [],
    selectedSharedSession: null,
    selectedSharedSessionId: null,
    sessionShares: [],
    sessions: [],
    setSelectedSharedSessionId: vi.fn(),
    sharedCommentBusy: false,
    sharedOperateBusy: false,
    sharedSessions: [],
    tasks: [],
    toggleSessionState: vi.fn(async () => true),
    updateTask: vi.fn(async () => true),
    ...overrides,
  };
}

function buildRoleBindingsMock(overrides: Record<string, unknown> = {}) {
  return {
    loading: false,
    roleCards: [null, null, null, null],
    ...overrides,
  };
}

function buildWorkflowTemplatesMock(overrides: Record<string, unknown> = {}) {
  return {
    canCreateTemplate: false,
    createTemplate: vi.fn(async () => false),
    error: null,
    loading: false,
    sections: [],
    templateCount: 0,
    ...overrides,
  };
}

function buildProjectionMock(overrides: Record<string, unknown> = {}) {
  return {
    buddyProjection: { activeAgentCount: 0 },
    metrics: [],
    workspaceOverviewLines: [],
    ...overrides,
  };
}

function buildManagedAgent(
  id: string,
  label: string,
  coreRole: 'planner' | 'researcher' | 'executor' | 'reviewer',
): ManagedAgentRecord {
  return {
    id,
    label,
    description: `${label} description`,
    aliases: [],
    canonicalRole: { coreRole, confidence: 'high' },
    createdAt: '2026-04-01T00:00:00.000Z',
    updatedAt: '2026-04-01T00:00:00.000Z',
    enabled: true,
    fallbackModels: [],
    hasOverrides: false,
    model: 'gpt-test',
    note: null as never,
    origin: 'builtin',
    removable: false,
    resettable: false,
    source: 'builtin',
    systemPrompt: '',
    variant: 'default',
  };
}

function HookHarness({
  onState,
  options,
}: {
  onState: (state: ReferenceDataState) => void;
  options?: Parameters<typeof useResolvedTeamRuntimeReferenceData>[0];
}) {
  const state = useResolvedTeamRuntimeReferenceData(options);
  const onStateRef = useRef(onState);
  onStateRef.current = onState;

  useEffect(() => {
    onStateRef.current({ ...state });
  });

  return null;
}

(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

let container: HTMLDivElement | null = null;
let root: Root | null = null;

beforeEach(() => {
  vi.clearAllMocks();
  useAuthStore.setState({ accessToken: 'token-123', gatewayUrl: 'http://localhost:3000' });
  mockUseTeamCollaboration.mockReturnValue(buildCollaborationMock());
  mockUseTeamRuntimeRoleBindings.mockReturnValue(buildRoleBindingsMock());
  mockUseTeamWorkflowTemplates.mockReturnValue(buildWorkflowTemplatesMock());
  mockUseTeamRuntimeProjection.mockReturnValue(buildProjectionMock());

  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => {
    root?.unmount();
  });
  root = null;
  container?.remove();
  container = null;
});

async function mountHarness(
  options?: Parameters<typeof useResolvedTeamRuntimeReferenceData>[0],
): Promise<ReferenceDataState> {
  let captured: ReferenceDataState | null = null;

  await act(async () => {
    root!.render(
      <HookHarness
        options={options}
        onState={(state) => {
          captured = state;
        }}
      />,
    );
    await Promise.resolve();
  });

  if (!captured) {
    throw new Error('Reference data state not captured');
  }

  const state = captured;
  return state;
}

describe('useResolvedTeamRuntimeReferenceData', () => {
  it('returns mock mode when auth is unavailable', async () => {
    useAuthStore.setState({ accessToken: null });

    const state = await mountHarness();

    expect(state.activeMode).toBe('mock');
    expect(state.canCreateSession).toBe(false);
    expect(state.canManageRuntime).toBe(false);
  });

  it('includes workspace snapshot loading in the resolved loading state', async () => {
    const state = await mountHarness({ workspaceSnapshotLoading: true });

    expect(state.activeMode).toBe('live');
    expect(state.loading).toBe(true);
  });

  it('passes teamWorkspaceId and collaborationEnabled into the collaboration hook', async () => {
    await mountHarness({ teamWorkspaceId: 'workspace-1', collaborationEnabled: false });

    expect(mockUseTeamCollaboration).toHaveBeenCalledWith('workspace-1', { enabled: false });
  });

  it('includes workspace snapshot errors in the resolved error surface', async () => {
    const state = await mountHarness({ workspaceSnapshotError: 'snapshot failed' });

    expect(state.activeMode).toBe('live');
    expect(state.error).toBe('snapshot failed');
  });

  it('prefers the selected team id when resolving the live top summary title', async () => {
    mockUseTeamCollaboration.mockReturnValue(
      buildCollaborationMock({
        sharedSessions: [
          {
            sessionId: 'session-a',
            title: '共享会话 session-a',
            stateStatus: 'running',
            workspacePath: '/workspace/a',
            sharedByEmail: 'a@openawork.local',
            permission: 'operate',
            createdAt: '2026-04-04T00:00:00.000Z',
            updatedAt: '2026-04-04T00:00:00.000Z',
            shareCreatedAt: '2026-04-04T00:00:00.000Z',
            shareUpdatedAt: '2026-04-04T00:00:00.000Z',
          },
          {
            sessionId: 'session-b',
            title: '共享会话 session-b',
            stateStatus: 'paused',
            workspacePath: '/workspace/b',
            sharedByEmail: 'b@openawork.local',
            permission: 'view',
            createdAt: '2026-04-05T00:00:00.000Z',
            updatedAt: '2026-04-05T00:00:00.000Z',
            shareCreatedAt: '2026-04-05T00:00:00.000Z',
            shareUpdatedAt: '2026-04-05T00:00:00.000Z',
          },
        ],
      }),
    );

    const state = await mountHarness({ selectedTeamId: 'session-b' });

    expect(state.activeMode).toBe('live');
    expect(state.topSummary.title).toBe('共享会话 session-b');
    expect(state.topSummary.status).toBe('已暂停');
  });

  it('builds office agents from real selectedAgent bindings instead of static slot ids', async () => {
    mockUseTeamRuntimeRoleBindings.mockReturnValue(
      buildRoleBindingsMock({
        roleCards: [
          {
            role: 'planner',
            roleLabel: '规划',
            selectedAgentId: 'agent-planner',
            selectedAgent: buildManagedAgent('agent-planner', '真实规划代理', 'planner'),
            recommendedCapabilities: [],
          },
          {
            role: 'researcher',
            roleLabel: '研究',
            selectedAgentId: 'agent-researcher',
            selectedAgent: buildManagedAgent('agent-researcher', '真实研究代理', 'researcher'),
            recommendedCapabilities: [],
          },
          {
            role: 'executor',
            roleLabel: '执行',
            selectedAgentId: 'agent-executor',
            selectedAgent: buildManagedAgent('agent-executor', '真实执行代理', 'executor'),
            recommendedCapabilities: [],
          },
          {
            role: 'reviewer',
            roleLabel: '审查',
            selectedAgentId: 'agent-reviewer',
            selectedAgent: buildManagedAgent('agent-reviewer', '真实审查代理', 'reviewer'),
            recommendedCapabilities: [],
          },
        ],
      }),
    );

    const state = await mountHarness();

    expect(state.officeAgents.map((agent) => agent.id)).toEqual([
      'agent-planner',
      'agent-researcher',
      'agent-executor',
      'agent-reviewer',
    ]);
    expect(state.officeAgents.map((agent) => agent.label)).toEqual([
      '[L] 真实规划代理',
      '真实研究代理',
      '真实执行代理',
      '真实审查代理',
    ]);
    expect(state.officeAgents.map((agent) => agent.status)).toEqual([
      'discussing',
      'working',
      'working',
      'resting',
    ]);
    expect(state.roleChips.map((chip) => chip.id)).toEqual([
      'agent-planner',
      'agent-researcher',
      'agent-executor',
      'agent-reviewer',
    ]);
    expect(state.roleChips.map((chip) => chip.role)).toEqual([
      '真实规划代理',
      '真实研究代理',
      '真实执行代理',
      '真实审查代理',
    ]);
    expect(state.defaultSelectedAgentId).toBe('agent-planner');
  });

  it('sets all office agents to resting when the selected team session is paused', async () => {
    mockUseTeamCollaboration.mockReturnValue(
      buildCollaborationMock({
        sharedSessions: [
          {
            sessionId: 'session-b',
            title: '共享会话 session-b',
            stateStatus: 'paused',
            workspacePath: '/workspace/b',
            sharedByEmail: 'b@openawork.local',
            permission: 'view',
            createdAt: '2026-04-05T00:00:00.000Z',
            updatedAt: '2026-04-05T00:00:00.000Z',
            shareCreatedAt: '2026-04-05T00:00:00.000Z',
            shareUpdatedAt: '2026-04-05T00:00:00.000Z',
          },
        ],
      }),
    );
    mockUseTeamRuntimeRoleBindings.mockReturnValue(
      buildRoleBindingsMock({
        roleCards: [
          {
            role: 'planner',
            roleLabel: '规划',
            selectedAgentId: 'agent-planner',
            selectedAgent: buildManagedAgent('agent-planner', '真实规划代理', 'planner'),
            recommendedCapabilities: [],
          },
          {
            role: 'researcher',
            roleLabel: '研究',
            selectedAgentId: 'agent-researcher',
            selectedAgent: buildManagedAgent('agent-researcher', '真实研究代理', 'researcher'),
            recommendedCapabilities: [],
          },
          {
            role: 'executor',
            roleLabel: '执行',
            selectedAgentId: 'agent-executor',
            selectedAgent: buildManagedAgent('agent-executor', '真实执行代理', 'executor'),
            recommendedCapabilities: [],
          },
          {
            role: 'reviewer',
            roleLabel: '审查',
            selectedAgentId: 'agent-reviewer',
            selectedAgent: buildManagedAgent('agent-reviewer', '真实审查代理', 'reviewer'),
            recommendedCapabilities: [],
          },
        ],
      }),
    );

    const state = await mountHarness({ selectedTeamId: 'session-b' });

    expect(state.topSummary.status).toBe('已暂停');
    expect(state.officeAgents.map((agent) => agent.status)).toEqual([
      'resting',
      'resting',
      'resting',
      'resting',
    ]);
  });

  it('exposes workflow templates through the resolved view data', async () => {
    mockUseTeamWorkflowTemplates.mockReturnValue(
      buildWorkflowTemplatesMock({
        templates: [
          {
            id: 'workflow-1',
            name: '研究团队模板',
            description: 'team-playbook',
            category: 'team-playbook',
            metadata: {
              teamTemplate: {
                defaultProvider: 'anthropic',
                optionalAgentIds: ['atlas'],
                requiredRoles: ['planner', 'researcher'],
              },
            },
            nodes: [],
            edges: [],
          },
        ],
      }),
    );

    const state = await mountHarness();

    expect(state.templates).toHaveLength(1);
    expect(state.templates[0]?.metadata?.teamTemplate?.defaultProvider).toBe('anthropic');
  });
});
