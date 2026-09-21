// @vitest-environment jsdom
import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import type { ArtifactRecord } from '@openAwork/artifacts';
import { HttpError } from '@openAwork/web-client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useReviewPanelArtifacts } from './useReviewPanelArtifacts.js';

interface ArtifactsListPayload {
  readonly contentArtifacts?: ArtifactRecord[];
}

type ListForSession = (
  token: string,
  sessionId: string,
  options: { readonly signal: AbortSignal },
) => Promise<ArtifactsListPayload>;

type GetArtifact = (
  token: string,
  artifactId: string,
  options: { readonly signal: AbortSignal },
) => Promise<{ readonly artifact: ArtifactRecord }>;

interface Deferred<T> {
  readonly promise: Promise<T>;
  readonly reject: (error: unknown) => void;
  readonly resolve: (value: T) => void;
}

const listForSessionMock = vi.fn<ListForSession>();
const getArtifactMock = vi.fn<GetArtifact>();

vi.mock('@openAwork/web-client', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@openAwork/web-client')>();
  return {
    ...actual,
    createArtifactsClient: () => ({
      get: getArtifactMock,
      listForSession: listForSessionMock,
    }),
  };
});

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

function makeArtifact(id: string, overrides: Partial<ArtifactRecord> = {}): ArtifactRecord {
  return {
    id,
    sessionId: 'session-1',
    userId: 'user-1',
    type: 'image',
    title: `产物 ${id}`,
    content: `data:image/png;base64,${id}`,
    version: 1,
    parentVersionId: null,
    metadata: {},
    createdAt: '2026-03-21T10:00:00.000Z',
    updatedAt: '2026-03-21T10:00:00.000Z',
    ...overrides,
  };
}

function renderArtifactsHook(initialProps: {
  readonly opened?: boolean;
  readonly revision?: number;
  readonly sessionId: string | null;
}) {
  return renderHook(
    (props: {
      readonly opened: boolean;
      readonly revision: number;
      readonly sessionId: string | null;
    }) =>
      useReviewPanelArtifacts({
        gatewayUrl: 'http://localhost:3000',
        opened: props.opened,
        revision: props.revision,
        sessionId: props.sessionId,
        token: 'token',
      }),
    {
      initialProps: {
        opened: initialProps.opened ?? true,
        revision: initialProps.revision ?? 0,
        sessionId: initialProps.sessionId,
      },
    },
  );
}

beforeEach(() => {
  listForSessionMock.mockReset();
  getArtifactMock.mockReset();
});

afterEach(() => {
  cleanup();
});

describe('useReviewPanelArtifacts', () => {
  it('缺少会话上下文时进入 waiting 且不发请求', () => {
    const { result } = renderArtifactsHook({ sessionId: null });

    expect(result.current.artifactsState.kind).toBe('waiting');
    expect(result.current.selectedArtifact).toBeNull();
    expect(result.current.preview.kind).toBe('idle');
    expect(listForSessionMock).not.toHaveBeenCalled();
  });

  it('面板未打开时不拉取产物并保持 waiting', () => {
    const { result } = renderArtifactsHook({ opened: false, sessionId: 'session-1' });

    expect(result.current.artifactsState.kind).toBe('waiting');
    expect(listForSessionMock).not.toHaveBeenCalled();
  });

  it('空列表返回 ready 空数组且预览保持 idle', async () => {
    listForSessionMock.mockResolvedValue({ contentArtifacts: [] });

    const { result } = renderArtifactsHook({ sessionId: 'session-1' });

    await waitFor(() => {
      expect(result.current.artifactsState.kind).toBe('ready');
    });

    if (result.current.artifactsState.kind !== 'ready') {
      throw new Error('expected ready state');
    }
    expect(result.current.artifactsState.artifacts).toEqual([]);
    expect(result.current.selectedArtifact).toBeNull();
    expect(result.current.preview.kind).toBe('idle');
  });

  it('加载成功时默认选中首个产物并用列表内联内容预览', async () => {
    const first = makeArtifact('artifact-1', { title: '生成的图片' });
    const second = makeArtifact('artifact-2', { content: 'hello markdown', type: 'markdown' });
    listForSessionMock.mockResolvedValue({ contentArtifacts: [first, second] });

    const { result } = renderArtifactsHook({ sessionId: 'session-1' });

    await waitFor(() => {
      expect(result.current.artifactsState.kind).toBe('ready');
    });

    expect(result.current.selectedArtifact?.id).toBe('artifact-1');
    expect(result.current.preview).toEqual({
      kind: 'ready',
      content: 'data:image/png;base64,artifact-1',
    });
    expect(getArtifactMock).not.toHaveBeenCalled();
  });

  it('加载失败时 4xx 服务端文案可透出', async () => {
    listForSessionMock.mockRejectedValue(
      new HttpError('目标产物资源不存在，无法读取会话产物列表。', 404, {}),
    );

    const { result } = renderArtifactsHook({ sessionId: 'session-1' });

    await waitFor(() => {
      expect(result.current.artifactsState.kind).toBe('error');
    });

    if (result.current.artifactsState.kind !== 'error') {
      throw new Error('expected error state');
    }
    expect(result.current.artifactsState.message).toBe(
      '目标产物资源不存在，无法读取会话产物列表。',
    );
    expect(result.current.selectedArtifact).toBeNull();
  });

  it('加载失败时 5xx 降级为通用文案，不回显服务端细节', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    try {
      listForSessionMock.mockRejectedValue(
        new HttpError('读取会话产物列表失败（HTTP 500）。', 500, { error: '内部堆栈' }),
      );

      const { result } = renderArtifactsHook({ sessionId: 'session-1' });

      await waitFor(() => {
        expect(result.current.artifactsState.kind).toBe('error');
      });

      if (result.current.artifactsState.kind !== 'error') {
        throw new Error('expected error state');
      }
      expect(result.current.artifactsState.message).toBe('产物加载失败，请稍后重试');
    } finally {
      consoleError.mockRestore();
    }
  });

  it('切换选中产物后预览内容跟随变化', async () => {
    listForSessionMock.mockResolvedValue({
      contentArtifacts: [
        makeArtifact('artifact-1', { content: 'first content' }),
        makeArtifact('artifact-2', { content: 'second content' }),
      ],
    });

    const { result } = renderArtifactsHook({ sessionId: 'session-1' });

    await waitFor(() => {
      expect(result.current.artifactsState.kind).toBe('ready');
    });

    act(() => {
      result.current.selectArtifact('artifact-2');
    });

    await waitFor(() => {
      expect(result.current.selectedArtifact?.id).toBe('artifact-2');
    });
    expect(result.current.preview).toEqual({ kind: 'ready', content: 'second content' });
  });

  it('列表条目缺少 content 时回退到 get 拉取内容', async () => {
    const artifactWithoutContent = makeArtifact('artifact-1', { content: undefined });
    listForSessionMock.mockResolvedValue({ contentArtifacts: [artifactWithoutContent] });
    getArtifactMock.mockResolvedValue({
      artifact: makeArtifact('artifact-1', { content: 'fetched content' }),
    });

    const { result } = renderArtifactsHook({ sessionId: 'session-1' });

    await waitFor(() => {
      expect(result.current.preview.kind).toBe('ready');
    });

    expect(getArtifactMock).toHaveBeenCalledTimes(1);
    expect(getArtifactMock.mock.calls[0]?.[1]).toBe('artifact-1');
    expect(result.current.preview).toEqual({ kind: 'ready', content: 'fetched content' });
  });

  it('切换会话时中止上一轮请求且旧响应不覆盖新会话', async () => {
    const firstRequest = createDeferred<ArtifactsListPayload>();
    const secondRequest = createDeferred<ArtifactsListPayload>();
    listForSessionMock
      .mockReturnValueOnce(firstRequest.promise)
      .mockReturnValueOnce(secondRequest.promise);

    const { result, rerender } = renderArtifactsHook({ sessionId: 'session-a' });

    await waitFor(() => {
      expect(listForSessionMock).toHaveBeenCalledTimes(1);
    });
    const firstSignal = listForSessionMock.mock.calls[0]?.[2].signal;

    rerender({ opened: true, revision: 0, sessionId: 'session-b' });

    await waitFor(() => {
      expect(firstSignal?.aborted).toBe(true);
      expect(listForSessionMock).toHaveBeenCalledTimes(2);
      expect(result.current.artifactsState.kind).toBe('loading');
    });

    await act(async () => {
      secondRequest.resolve({ contentArtifacts: [makeArtifact('artifact-b')] });
      await secondRequest.promise;
    });

    await waitFor(() => {
      expect(result.current.selectedArtifact?.id).toBe('artifact-b');
    });

    await act(async () => {
      firstRequest.resolve({ contentArtifacts: [makeArtifact('artifact-a')] });
      await firstRequest.promise;
    });

    expect(result.current.selectedArtifact?.id).toBe('artifact-b');
  });

  it('卸载后延迟响应不触发状态更新且不抛错', async () => {
    const request = createDeferred<ArtifactsListPayload>();
    listForSessionMock.mockReturnValueOnce(request.promise);

    const { unmount } = renderArtifactsHook({ sessionId: 'session-1' });

    await waitFor(() => {
      expect(listForSessionMock).toHaveBeenCalledTimes(1);
    });

    unmount();

    await act(async () => {
      request.resolve({ contentArtifacts: [makeArtifact('artifact-1')] });
      await request.promise;
    });

    expect(listForSessionMock.mock.calls[0]?.[2].signal.aborted).toBe(true);
  });

  it('revision 变化时重新拉取会话产物', async () => {
    listForSessionMock.mockResolvedValue({ contentArtifacts: [makeArtifact('artifact-1')] });

    const { rerender } = renderArtifactsHook({ revision: 0, sessionId: 'session-1' });

    await waitFor(() => {
      expect(listForSessionMock).toHaveBeenCalledTimes(1);
    });

    rerender({ opened: true, revision: 1, sessionId: 'session-1' });

    await waitFor(() => {
      expect(listForSessionMock).toHaveBeenCalledTimes(2);
    });
  });

  it('reload 触发一次新的拉取', async () => {
    listForSessionMock.mockResolvedValue({ contentArtifacts: [] });

    const { result } = renderArtifactsHook({ sessionId: 'session-1' });

    await waitFor(() => {
      expect(result.current.artifactsState.kind).toBe('ready');
    });

    act(() => {
      result.current.reload();
    });

    await waitFor(() => {
      expect(listForSessionMock).toHaveBeenCalledTimes(2);
    });
  });
});
