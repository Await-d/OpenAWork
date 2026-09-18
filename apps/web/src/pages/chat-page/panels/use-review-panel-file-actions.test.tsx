// @vitest-environment jsdom
import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import { HttpError } from '@openAwork/web-client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { makeReviewPanelDiffEntry } from './review-panel-test-fixtures.js';
import { useReviewPanelFileActions } from './use-review-panel-file-actions.js';

const reviewFileChangeMock = vi.fn();
const toastMock = vi.hoisted(() => vi.fn());

vi.mock('@openAwork/web-client', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@openAwork/web-client')>();
  return {
    ...actual,
    createSessionsClient: () => ({
      getFileChanges: vi.fn(),
      reviewFileChange: reviewFileChangeMock,
    }),
  };
});

vi.mock('../../../components/common/feedback/ToastNotification.js', () => ({
  toast: toastMock,
}));

const CONFLICT_BODY = {
  error: '当前工作区状态不满足恢复条件，暂不能应用恢复。',
  mode: 'file-review',
  target: { decision: 'rejected', filePath: 'src/app.ts', requestId: 'request:src/app.ts' },
  validateOnly: true,
  workspaceReview: {
    available: true,
    conflicts: [{ filePath: 'src/app.ts' }],
    dirtyCount: 1,
  },
};

function renderActions(revision: number) {
  return renderHook(() =>
    useReviewPanelFileActions({
      files: [makeReviewPanelDiffEntry('src/app.ts')],
      gatewayUrl: 'http://localhost:3000',
      onRefetch: () => undefined,
      revision,
      sessionId: 'session-1',
      token: 'token',
    }),
  );
}

describe('useReviewPanelFileActions 反馈状态', () => {
  beforeEach(() => {
    reviewFileChangeMock.mockReset();
    toastMock.mockReset();
    vi.stubGlobal(
      'confirm',
      vi.fn(() => true),
    );
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it('强制覆盖成功后清空冲突反馈，即使 revision 未变化', async () => {
    reviewFileChangeMock
      .mockRejectedValueOnce(
        new HttpError('当前工作区状态不满足恢复条件，暂不能应用恢复。', 409, CONFLICT_BODY),
      )
      .mockResolvedValue({
        decision: {
          createdAt: '2026-01-01T00:00:00.000Z',
          decision: 'rejected',
          filePath: 'src/app.ts',
          requestId: 'request:src/app.ts',
        },
        revertClientRequestId: 'file-revert-1',
      });

    const { result } = renderActions(0);

    await act(async () => {
      result.current.rejectFile(makeReviewPanelDiffEntry('src/app.ts'));
      await Promise.resolve();
    });

    await waitFor(() => {
      expect(result.current.feedback).not.toBeNull();
    });

    const feedback = result.current.feedback;
    if (!feedback) {
      throw new Error('预期存在冲突反馈');
    }
    expect(feedback.kind).toBe('conflict');

    await act(async () => {
      result.current.retryWithForce(feedback);
      await Promise.resolve();
    });

    await waitFor(() => {
      expect(reviewFileChangeMock).toHaveBeenCalledTimes(2);
    });

    expect(result.current.feedback).toBeNull();
    expect(toastMock).toHaveBeenCalledWith('已强制覆盖并拒绝：src/app.ts', 'success');
  });

  it('revision 变化时清空残留反馈', async () => {
    reviewFileChangeMock.mockRejectedValueOnce(
      new HttpError('该文件变更可信度不足，无法安全撤销。', 400, {
        error: '该文件变更可信度不足，无法安全撤销。',
      }),
    );

    const { result, rerender } = renderHook(
      (props: { readonly revision: number }) =>
        useReviewPanelFileActions({
          files: [makeReviewPanelDiffEntry('src/app.ts')],
          gatewayUrl: 'http://localhost:3000',
          onRefetch: () => undefined,
          revision: props.revision,
          sessionId: 'session-1',
          token: 'token',
        }),
      { initialProps: { revision: 0 } },
    );

    await act(async () => {
      result.current.rejectFile(makeReviewPanelDiffEntry('src/app.ts'));
      await Promise.resolve();
    });

    await waitFor(() => {
      expect(result.current.feedback).not.toBeNull();
    });

    rerender({ revision: 1 });

    await waitFor(() => {
      expect(result.current.feedback).toBeNull();
    });
  });
});
