// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, renderHook } from '@testing-library/react';
import { useTeamRuntimeProjection } from './use-team-runtime-projection.js';

beforeEach(() => {
  cleanup();
});

afterEach(() => {
  cleanup();
});

describe('useTeamRuntimeProjection', () => {
  it('关闭 autoSelectSharedSession 后不会自动选中第一条共享会话', async () => {
    const onSelectSharedSession = vi.fn();

    renderHook(() =>
      useTeamRuntimeProjection({
        autoSelectSharedSession: false,
        auditLogs: [],
        interactionRewriteArtifact: null,
        members: [],
        messages: [],
        onSelectSharedSession,
        selectedSharedSession: null,
        selectedSharedSessionId: null,
        runtimeTaskGroups: [],
        sessionShares: [],
        sessions: [],
        sharedSessions: [
          {
            sessionId: 'shared-1',
            title: '共享会话 A',
            stateStatus: 'running',
            workspacePath: '/workspace/demo',
            sharedByEmail: 'owner@example.com',
            permission: 'operate',
            createdAt: '2026-06-04T08:00:00.000Z',
            updatedAt: '2026-06-04T08:00:00.000Z',
            shareCreatedAt: '2026-06-04T08:05:00.000Z',
            shareUpdatedAt: '2026-06-04T08:05:00.000Z',
          },
        ],
        tasks: [],
      }),
    );

    await act(async () => {
      await Promise.resolve();
    });

    expect(onSelectSharedSession).not.toHaveBeenCalled();
  });

  it('默认仍会自动选中第一条共享会话', async () => {
    const onSelectSharedSession = vi.fn();

    renderHook(() =>
      useTeamRuntimeProjection({
        auditLogs: [],
        interactionRewriteArtifact: null,
        members: [],
        messages: [],
        onSelectSharedSession,
        selectedSharedSession: null,
        selectedSharedSessionId: null,
        runtimeTaskGroups: [],
        sessionShares: [],
        sessions: [],
        sharedSessions: [
          {
            sessionId: 'shared-1',
            title: '共享会话 A',
            stateStatus: 'running',
            workspacePath: '/workspace/demo',
            sharedByEmail: 'owner@example.com',
            permission: 'operate',
            createdAt: '2026-06-04T08:00:00.000Z',
            updatedAt: '2026-06-04T08:00:00.000Z',
            shareCreatedAt: '2026-06-04T08:05:00.000Z',
            shareUpdatedAt: '2026-06-04T08:05:00.000Z',
          },
        ],
        tasks: [],
      }),
    );

    await act(async () => {
      await Promise.resolve();
    });

    expect(onSelectSharedSession).toHaveBeenCalledWith('shared-1');
  });
});
