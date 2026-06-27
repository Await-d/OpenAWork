// @vitest-environment jsdom

import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, renderHook, waitFor } from '@testing-library/react';
import {
  useHandoffStore,
  useLayerStore,
  type HandoffEntry,
} from '../../../../../stores/team/team-events.js';
import { publishSessionRunState } from '../../../../../utils/session/session-list-events.js';
import type { AgentTeamsWorkspaceGroup } from '../../data/team-runtime-types.js';
import { useTeamSessionListRuntimeState } from './use-team-session-list-runtime-state.js';

function createWorkspaceGroups(
  status: 'idle' | 'running' | 'paused' | 'completed' | 'failed',
  subtitle: string,
): AgentTeamsWorkspaceGroup[] {
  return [
    {
      workspaceLabel: 'workspace/demo',
      workspacePath: '/workspace/demo',
      sessions: [
        {
          id: 'session-root',
          status,
          subtitle,
          title: '根会话',
          updatedAt: '2026-06-22T12:00:00.000Z',
        },
      ],
    },
  ];
}

afterEach(() => {
  cleanup();
  useHandoffStore.setState({ handoffs: new Map<string, HandoffEntry>() });
  useLayerStore.setState({ nodes: new Map() });
});

describe('useTeamSessionListRuntimeState', () => {
  it('基础快照为 completed，但下游实时仍在运行时，列表状态提升为 running', () => {
    useLayerStore.setState({
      nodes: new Map([
        [
          'session-root',
          {
            sessionId: 'session-root',
            parentSessionId: null,
            roleLayer: 'reception',
            state: 'idle',
          },
        ],
        [
          'session-child',
          {
            sessionId: 'session-child',
            parentSessionId: 'session-root',
            roleLayer: 'executor',
            state: 'running',
          },
        ],
      ]),
    });

    const { result } = renderHook(() =>
      useTeamSessionListRuntimeState(createWorkspaceGroups('completed', '已完成')),
    );

    const session = result.current.effectiveWorkspaceGroups[0]?.sessions[0];
    expect(session?.status).toBe('running');
    expect(session?.subtitle).toBe('运行中');
  });

  it('收到本地 idle 运行态事件后，列表显示已空闲而不是已完成', async () => {
    const { result } = renderHook(() =>
      useTeamSessionListRuntimeState(createWorkspaceGroups('running', '运行中')),
    );

    publishSessionRunState('session-root', 'idle');

    await waitFor(() => {
      const session = result.current.effectiveWorkspaceGroups[0]?.sessions[0];
      expect(session?.status).toBe('idle');
      expect(session?.subtitle).toBe('已空闲');
    });
  });
});
