// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import { useLayerStore } from '../../../stores/team/team-events.js';
import { subscribeSessionStreamResumeAttach } from '../../../utils/session/session-stream-resume-events.js';
import { useTeamConversationState } from './use-team-conversation-state.js';

const SESSION_ID = 'session-test-001';
const TOKEN = 'tok-fake';
const GATEWAY = 'https://gw.test';
const EMAIL = 'qa@example.com';

function permissionReplyDecisionFrom(init: RequestInit | undefined): unknown {
  const body: unknown = JSON.parse(init?.body?.toString() ?? '{}');
  return typeof body === 'object' && body !== null ? Reflect.get(body, 'decision') : undefined;
}

beforeEach(() => {
  useLayerStore.getState().clear();
});

afterEach(() => {
  cleanup();
  useLayerStore.getState().clear();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('useTeamConversationState — 权限回复续跑', () => {
  it('允许当前会话权限后发布续跑 attach 信号并把状态切回 running', async () => {
    let recoveryCount = 0;
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = input.toString();
      if (url.includes('/permissions/reply')) {
        expect(permissionReplyDecisionFrom(init)).toBe('session');
        return new Response(null, { status: 204 });
      }

      recoveryCount += 1;
      return new Response(
        JSON.stringify({
          recovery: {
            pendingPermissions:
              recoveryCount === 1
                ? [
                    {
                      requestId: 'perm-team-allow',
                      sessionId: SESSION_ID,
                      toolName: 'mcp__git_bash__run',
                      scope: 'cat package.json',
                      reason: '读取 package.json',
                      riskLevel: 'low',
                      status: 'pending',
                      createdAt: '2026-07-11T00:00:00.000Z',
                    },
                  ]
                : [],
            pendingQuestions: [],
            session: {
              id: SESSION_ID,
              state_status: recoveryCount === 1 ? 'paused' : 'running',
              messages: [],
              role_layer: 'reception',
            },
            todoLanes: { lanes: [] },
            tasks: [],
            children: [],
            ratings: [],
            activeStream: null,
          },
        }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      );
    });
    vi.stubGlobal('fetch', fetchMock);
    let resumedSessionId: string | null = null;
    const unsubscribe = subscribeSessionStreamResumeAttach((sessionId) => {
      resumedSessionId = sessionId;
    });

    try {
      const { result } = renderHook(() =>
        useTeamConversationState({
          sessionId: SESSION_ID,
          currentUserEmail: EMAIL,
          gatewayUrl: GATEWAY,
          token: TOKEN,
          enableWriters: true,
        }),
      );

      await waitFor(() => {
        expect(result.current.sessionStateStatus).toBe('paused');
      });

      await act(async () => {
        await result.current.replyPermission('perm-team-allow', 'session');
      });

      expect(resumedSessionId).toBe(SESSION_ID);
      await waitFor(() => {
        expect(result.current.sessionStateStatus).toBe('running');
      });
      expect(result.current.pendingPermissions).toEqual([]);
    } finally {
      unsubscribe();
    }
  });

  it('允许子会话权限后把子节点标记为 running 以触发多路 attach', async () => {
    const childSessionId = 'child-session-allow';
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = input.toString();
      if (url.includes('/permissions/reply')) {
        return new Response(null, { status: 204 });
      }

      return new Response(
        JSON.stringify({
          recovery: {
            pendingPermissions: [
              {
                requestId: 'perm-child-allow',
                sessionId: childSessionId,
                toolName: 'mcp__git_bash__run',
                scope: 'cat child.json',
                reason: '读取子会话文件',
                riskLevel: 'low',
                status: 'pending',
                createdAt: '2026-07-11T00:00:00.000Z',
              },
            ],
            pendingQuestions: [],
            session: {
              id: SESSION_ID,
              state_status: 'running',
              messages: [],
              role_layer: 'reception',
            },
            todoLanes: { lanes: [] },
            tasks: [],
            children: [
              {
                id: childSessionId,
                role_layer: 'executor',
                messages: [],
              },
            ],
            ratings: [],
            activeStream: null,
          },
        }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      );
    });
    vi.stubGlobal('fetch', fetchMock);

    const { result } = renderHook(() =>
      useTeamConversationState({
        sessionId: SESSION_ID,
        currentUserEmail: EMAIL,
        gatewayUrl: GATEWAY,
        token: TOKEN,
        enableWriters: true,
      }),
    );

    await waitFor(() => {
      expect(result.current.childSessions.some((child) => child.id === childSessionId)).toBe(true);
    });

    await act(async () => {
      await result.current.replyPermission('perm-child-allow', 'once', {
        targetSessionId: childSessionId,
      });
    });

    expect(useLayerStore.getState().nodes.get(childSessionId)).toEqual(
      expect.objectContaining({
        parentSessionId: SESSION_ID,
        roleLayer: 'executor',
        state: 'running',
      }),
    );
  });
});
