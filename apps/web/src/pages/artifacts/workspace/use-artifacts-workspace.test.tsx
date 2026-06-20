// @vitest-environment jsdom

import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ArtifactRecord, ArtifactVersionRecord } from '@openAwork/artifacts';
import { useArtifactsWorkspace } from './use-artifacts-workspace.js';

const listSessionsMock = vi.fn();
const listForSessionMock = vi.fn();
const listVersionsMock = vi.fn();
const removeArtifactMock = vi.fn();

vi.mock('@openAwork/web-client', () => ({
  createSessionsClient: () => ({
    list: listSessionsMock,
  }),
  createArtifactsClient: () => ({
    create: vi.fn(),
    listForSession: listForSessionMock,
    listVersions: listVersionsMock,
    remove: removeArtifactMock,
    revert: vi.fn(),
    update: vi.fn(),
  }),
}));

vi.mock('../../../components/common/feedback/ToastNotification.js', () => ({
  toast: vi.fn(),
}));

const FIRST_ARTIFACT: ArtifactRecord = {
  id: 'artifact-1',
  sessionId: 'session-1',
  userId: 'user-1',
  type: 'markdown',
  title: 'Spec',
  content: '# Spec',
  version: 1,
  parentVersionId: null,
  metadata: {},
  createdAt: '2026-06-08T00:00:00.000Z',
  updatedAt: '2026-06-08T00:00:00.000Z',
};

const SECOND_ARTIFACT: ArtifactRecord = {
  ...FIRST_ARTIFACT,
  id: 'artifact-2',
  title: 'Plan',
  content: '# Plan',
};

const EMPTY_VERSIONS: ArtifactVersionRecord[] = [];

beforeEach(() => {
  listSessionsMock.mockResolvedValue([
    {
      id: 'session-1',
      title: 'Team session',
      updated_at: '2026-06-08T00:00:00.000Z',
    },
  ]);
  listForSessionMock
    .mockResolvedValueOnce({ contentArtifacts: [FIRST_ARTIFACT, SECOND_ARTIFACT] })
    .mockResolvedValueOnce({ contentArtifacts: [SECOND_ARTIFACT] });
  listVersionsMock.mockImplementation(async (_token: string, artifactId: string) => ({
    artifact: artifactId === SECOND_ARTIFACT.id ? SECOND_ARTIFACT : FIRST_ARTIFACT,
    versions: EMPTY_VERSIONS,
  }));
  removeArtifactMock.mockResolvedValue(undefined);
  vi.spyOn(window, 'confirm').mockReturnValue(true);
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('useArtifactsWorkspace', () => {
  it('删除当前产物后重新拉取列表并切换到剩余产物', async () => {
    const { result } = renderHook(() =>
      useArtifactsWorkspace({
        gatewayUrl: 'http://localhost:3000',
        token: 'token-1',
      }),
    );

    await waitFor(() => expect(result.current.selectedArtifactId).toBe(FIRST_ARTIFACT.id));

    await act(async () => {
      await result.current.removeArtifact();
    });

    expect(removeArtifactMock).toHaveBeenCalledWith('token-1', FIRST_ARTIFACT.id);
    expect(listForSessionMock).toHaveBeenCalledTimes(2);
    await waitFor(() => expect(result.current.selectedArtifactId).toBe(SECOND_ARTIFACT.id));
    expect(result.current.sessionArtifacts).toEqual([SECOND_ARTIFACT]);
  });

  it('删除请求未完成时保留当前产物并暴露 deleting 状态', async () => {
    let resolveRemove: (() => void) | null = null;
    removeArtifactMock.mockReset().mockImplementation(
      () =>
        new Promise<void>((resolve) => {
          resolveRemove = resolve;
        }),
    );

    const { result } = renderHook(() =>
      useArtifactsWorkspace({
        gatewayUrl: 'http://localhost:3000',
        token: 'token-1',
      }),
    );

    await waitFor(() => expect(result.current.selectedArtifactId).toBe(FIRST_ARTIFACT.id));

    let removePromise: Promise<void>;
    await act(async () => {
      removePromise = result.current.removeArtifact();
    });

    expect(result.current.deletingArtifactId).toBe(FIRST_ARTIFACT.id);
    expect(result.current.selectedArtifactId).toBe(FIRST_ARTIFACT.id);
    expect(result.current.selectedArtifact?.id).toBe(FIRST_ARTIFACT.id);

    await act(async () => {
      resolveRemove?.();
      await removePromise;
    });

    await waitFor(() => expect(result.current.deletingArtifactId).toBeNull());
  });
});
