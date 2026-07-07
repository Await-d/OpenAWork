// @vitest-environment jsdom
import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import type { SessionFileChangesProjection } from '@openAwork/web-client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useReviewPanelFileChanges } from './use-review-panel-file-changes.js';

type GetFileChanges = (
  token: string,
  sessionId: string,
  options: { readonly includeText: boolean; readonly signal: AbortSignal },
) => Promise<SessionFileChangesProjection>;

interface Deferred<T> {
  readonly promise: Promise<T>;
  readonly reject: (error: unknown) => void;
  readonly resolve: (value: T) => void;
}

const getFileChangesMock = vi.fn<GetFileChanges>();

vi.mock('@openAwork/web-client', () => ({
  createSessionsClient: () => ({
    getFileChanges: getFileChangesMock,
  }),
}));

function createDeferred<T>(): Deferred<T> {
  let resolveDeferred: ((value: T) => void) | undefined;
  let rejectDeferred: ((error: unknown) => void) | undefined;
  const promise = new Promise<T>((resolve, reject) => {
    resolveDeferred = resolve;
    rejectDeferred = reject;
  });

  if (!resolveDeferred || !rejectDeferred) {
    throw new Error('Deferred promise handlers were not initialized');
  }

  return {
    promise,
    reject: rejectDeferred,
    resolve: resolveDeferred,
  };
}

function makeProjection(file: string): SessionFileChangesProjection {
  return {
    fileDiffs: [
      {
        additions: 1,
        after: `export const file = "${file}";\n`,
        before: '',
        deletions: 0,
        file,
        guaranteeLevel: 'strong',
        sourceKind: 'structured_tool_diff',
        status: 'added',
        toolName: 'hash_edit',
      },
    ],
    snapshots: [],
    summary: {
      snapshotCount: 1,
      sourceKinds: ['structured_tool_diff'],
      totalAdditions: 1,
      totalDeletions: 0,
      totalFileDiffs: 1,
      weakestGuaranteeLevel: 'strong',
    },
  };
}

function expectReadyProjection(
  state: ReturnType<typeof useReviewPanelFileChanges>,
): SessionFileChangesProjection {
  expect(state.kind).toBe('ready');
  if (state.kind !== 'ready') {
    throw new Error(`Expected ready state, received ${state.kind}`);
  }
  return state.projection;
}

beforeEach(() => {
  getFileChangesMock.mockReset();
});

afterEach(() => {
  cleanup();
});

describe('useReviewPanelFileChanges', () => {
  it('忽略已取消请求的延迟成功响应', async () => {
    const firstRequest = createDeferred<SessionFileChangesProjection>();
    const secondRequest = createDeferred<SessionFileChangesProjection>();
    getFileChangesMock
      .mockReturnValueOnce(firstRequest.promise)
      .mockReturnValueOnce(secondRequest.promise);

    const { result, rerender } = renderHook(
      (props: { readonly sessionId: string }) =>
        useReviewPanelFileChanges({
          gatewayUrl: 'http://localhost:3000',
          opened: true,
          sessionId: props.sessionId,
          token: 'token',
        }),
      { initialProps: { sessionId: 'session-a' } },
    );

    await waitFor(() => {
      expect(getFileChangesMock).toHaveBeenCalledTimes(1);
    });

    rerender({ sessionId: 'session-b' });

    await waitFor(() => {
      expect(getFileChangesMock).toHaveBeenCalledTimes(2);
    });

    await act(async () => {
      secondRequest.resolve(makeProjection('src/current.ts'));
      await secondRequest.promise;
    });

    await waitFor(() => {
      expect(expectReadyProjection(result.current).fileDiffs[0]?.file).toBe('src/current.ts');
    });

    await act(async () => {
      firstRequest.resolve(makeProjection('src/stale.ts'));
      await firstRequest.promise;
    });

    expect(expectReadyProjection(result.current).fileDiffs[0]?.file).toBe('src/current.ts');
  });

  it('切换会话时中止上一轮文件变更请求', async () => {
    const firstRequest = createDeferred<SessionFileChangesProjection>();
    const secondRequest = createDeferred<SessionFileChangesProjection>();
    getFileChangesMock
      .mockReturnValueOnce(firstRequest.promise)
      .mockReturnValueOnce(secondRequest.promise);

    const { rerender } = renderHook(
      (props: { readonly sessionId: string }) =>
        useReviewPanelFileChanges({
          gatewayUrl: 'http://localhost:3000',
          opened: true,
          sessionId: props.sessionId,
          token: 'token',
        }),
      { initialProps: { sessionId: 'session-a' } },
    );

    await waitFor(() => {
      expect(getFileChangesMock).toHaveBeenCalledTimes(1);
    });
    const firstSignal = getFileChangesMock.mock.calls[0]?.[2].signal;

    rerender({ sessionId: 'session-b' });

    await waitFor(() => {
      expect(firstSignal?.aborted).toBe(true);
      expect(getFileChangesMock).toHaveBeenCalledTimes(2);
    });
  });

  it('切换会话后新请求未返回前不展示旧文件变更', async () => {
    const firstRequest = createDeferred<SessionFileChangesProjection>();
    const secondRequest = createDeferred<SessionFileChangesProjection>();
    getFileChangesMock
      .mockReturnValueOnce(firstRequest.promise)
      .mockReturnValueOnce(secondRequest.promise);

    const { result, rerender } = renderHook(
      (props: { readonly sessionId: string }) =>
        useReviewPanelFileChanges({
          gatewayUrl: 'http://localhost:3000',
          opened: true,
          sessionId: props.sessionId,
          token: 'token',
        }),
      { initialProps: { sessionId: 'session-a' } },
    );

    await act(async () => {
      firstRequest.resolve(makeProjection('src/old-session.ts'));
      await firstRequest.promise;
    });

    await waitFor(() => {
      expect(expectReadyProjection(result.current).fileDiffs[0]?.file).toBe('src/old-session.ts');
    });

    rerender({ sessionId: 'session-b' });

    await waitFor(() => {
      expect(getFileChangesMock).toHaveBeenCalledTimes(2);
      expect(result.current.kind).toBe('loading');
    });
  });
});
