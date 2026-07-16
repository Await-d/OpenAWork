// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import {
  createAssistantTraceContent,
  type ChatMessage,
} from '../../conversation-runtime/messages/support.js';
import { useAuthStore } from '../../../stores/auth/auth.js';
import { useSnapshotAwareAction } from './useSnapshotAwareAction.js';

const originalFetch = globalThis.fetch;

function makeUserMessage(id: string, createdAt: string): ChatMessage {
  return {
    id,
    role: 'user',
    content: id,
    createdAt,
  };
}

function makeAssistantMessage(id: string, requestId: string, createdAt: string): ChatMessage {
  return {
    id,
    role: 'assistant',
    createdAt,
    content: createAssistantTraceContent({
      text: 'done',
      toolCalls: [
        {
          toolCallId: `tool-${requestId}`,
          toolName: 'write_file',
          input: {},
          clientRequestId: requestId,
          status: 'completed',
        },
      ],
      modifiedFilesSummary: {
        type: 'modified_files_summary',
        title: '变更',
        summary: '变更摘要',
        files: [
          {
            file: 'changed.ts',
            before: 'before',
            after: 'after',
            additions: 1,
            deletions: 0,
            clientRequestId: requestId,
          },
        ],
      },
    }),
  };
}

function makeSnapshot(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    treeHash: 'tree-default',
    parentTreeHash: 'tree-parent',
    clientRequestId: 'req-default',
    scopeKind: 'turn',
    sourceKind: 'session_snapshot',
    guaranteeLevel: 'strong',
    filesChanged: 1,
    additions: 1,
    deletions: 0,
    toolName: null,
    toolCallId: null,
    createdAt: '2026-07-15T10:05:00.000Z',
    ...overrides,
  };
}

describe('useSnapshotAwareAction', () => {
  beforeEach(() => {
    useAuthStore.setState({
      accessToken: 'token-1',
      gatewayUrl: 'http://localhost:3000',
    });
  });

  afterEach(() => {
    cleanup();
    globalThis.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  it('只在源消息之后存在快照时才拦截', async () => {
    const onProceed = vi.fn();

    globalThis.fetch = vi.fn(async (input) => {
      const url = String(input);
      if (url.endsWith('/sessions/session-1/snapshot-trees')) {
        return new Response(
          JSON.stringify({
            trees: [
              makeSnapshot({
                treeHash: 'tree-before',
                parentTreeHash: 'tree-before-parent',
                createdAt: '2026-07-15T09:59:59.000Z',
              }),
            ],
          }),
          {
            status: 200,
            headers: { 'content-type': 'application/json' },
          },
        );
      }
      throw new Error(`unexpected fetch: ${url}`);
    }) as typeof fetch;

    const { result } = renderHook(() =>
      useSnapshotAwareAction({
        sessionId: 'session-1',
        gatewayUrl: 'http://localhost:3000',
        messages: [makeUserMessage('source-user', '2026-07-15T10:00:00.000Z')],
      }),
    );

    act(() => {
      result.current.checkAndExecute({
        action: 'retry',
        sourceMessageId: 'source-user',
        onProceed,
      });
    });

    await waitFor(() => {
      expect(onProceed).toHaveBeenCalledTimes(1);
    });
    expect(result.current.dialogProps.open).toBe(false);
  });

  it('恢复时会带上受影响文件全集并删除目标快照中不存在的文件', async () => {
    const onProceed = vi.fn();
    const fetchMock = vi.fn(async (input, init) => {
      const url = String(input);
      if (url.endsWith('/sessions/session-1/snapshot-trees')) {
        return new Response(
          JSON.stringify({
            trees: [
              makeSnapshot({
                treeHash: 'tree-affected-2',
                parentTreeHash: 'tree-affected-1',
                clientRequestId: 'req-1',
                createdAt: '2026-07-15 10:05:00',
              }),
              makeSnapshot({
                treeHash: 'tree-affected-1',
                parentTreeHash: 'tree-keep',
                clientRequestId: 'req-1',
                createdAt: '2026-07-15 10:05:00',
              }),
            ],
          }),
          {
            status: 200,
            headers: { 'content-type': 'application/json' },
          },
        );
      }
      if (url.endsWith('/sessions/session-1/snapshot-trees?clientRequestId=req-1')) {
        return new Response(
          JSON.stringify({
            trees: [
              makeSnapshot({
                treeHash: 'tree-affected-2',
                parentTreeHash: 'tree-affected-1',
                clientRequestId: 'req-1',
                createdAt: '2026-07-15 10:05:00',
              }),
              makeSnapshot({
                treeHash: 'tree-affected-1',
                parentTreeHash: 'tree-keep',
                clientRequestId: 'req-1',
                createdAt: '2026-07-15 10:05:00',
              }),
            ],
          }),
          {
            status: 200,
            headers: { 'content-type': 'application/json' },
          },
        );
      }
      if (url.endsWith('/sessions/session-1/snapshot-trees/tree-affected-1')) {
        return new Response(
          JSON.stringify({
            tree: makeSnapshot({ treeHash: 'tree-affected-1', parentTreeHash: 'tree-keep' }),
            files: [{ filePath: 'changed.ts', status: 'modified', additions: 1, deletions: 0 }],
            chain: [],
          }),
          {
            status: 200,
            headers: { 'content-type': 'application/json' },
          },
        );
      }
      if (url.endsWith('/sessions/session-1/snapshot-trees/tree-affected-2')) {
        return new Response(
          JSON.stringify({
            tree: makeSnapshot({ treeHash: 'tree-affected-2', parentTreeHash: 'tree-affected-1' }),
            files: [
              { filePath: 'added.ts', status: 'added', additions: 1, deletions: 0 },
              { filePath: 'changed.ts', status: 'modified', additions: 1, deletions: 0 },
            ],
            chain: [],
          }),
          {
            status: 200,
            headers: { 'content-type': 'application/json' },
          },
        );
      }
      if (url.endsWith('/sessions/session-1/restore/to-tree')) {
        expect(init?.method).toBe('POST');
        expect(init?.body).toBeDefined();
        const body = JSON.parse(String(init?.body)) as {
          deleteMissing?: boolean;
          files?: string[];
          mode: string;
          treeHash: string;
        };
        expect(body).toMatchObject({
          treeHash: 'tree-keep',
          mode: 'apply',
          deleteMissing: true,
        });
        expect(body.files).toEqual(['added.ts', 'changed.ts']);
        return new Response(
          JSON.stringify({
            mode: 'apply',
            files: ['added.ts', 'changed.ts'],
            changed: 2,
            afterTreeHash: 'tree-after-restore',
          }),
          {
            status: 200,
            headers: { 'content-type': 'application/json' },
          },
        );
      }
      throw new Error(`unexpected fetch: ${url}`);
    });
    globalThis.fetch = fetchMock as typeof fetch;

    const { result } = renderHook(() =>
      useSnapshotAwareAction({
        sessionId: 'session-1',
        gatewayUrl: 'http://localhost:3000',
        messages: [
          makeUserMessage('source-user', '2026-07-15T10:00:00.000Z'),
          makeAssistantMessage('assistant-after', 'req-1', '2026-07-15T10:05:00.000Z'),
        ],
      }),
    );

    await act(async () => {
      result.current.checkAndExecute({
        action: 'edit',
        sourceMessageId: 'source-user',
        onProceed,
      });
    });

    await waitFor(() => {
      expect(result.current.dialogProps.open).toBe(true);
      expect(result.current.dialogProps.restoreTargetTreeHash).toBe('tree-keep');
      expect(
        result.current.dialogProps.affectedSnapshots.map((snapshot) => snapshot.treeHash),
      ).toEqual(['tree-affected-1', 'tree-affected-2']);
    });

    await act(async () => {
      result.current.dialogProps.onRestoreAndContinue();
    });

    await waitFor(() => {
      expect(onProceed).toHaveBeenCalledTimes(1);
    });
    expect(fetchMock).toHaveBeenCalled();
    expect(result.current.dialogProps.open).toBe(false);
  });

  it('多个 request 同秒发生时仍按消息先后锁定最早恢复基线', async () => {
    globalThis.fetch = vi.fn(async (input) => {
      const url = String(input);
      if (url.endsWith('/sessions/session-1/snapshot-trees?clientRequestId=req-1')) {
        return new Response(
          JSON.stringify({
            trees: [
              makeSnapshot({
                treeHash: 'tree-affected-1',
                parentTreeHash: 'tree-keep',
                clientRequestId: 'req-1',
                createdAt: '2026-07-15 10:05:00',
              }),
            ],
          }),
          {
            status: 200,
            headers: { 'content-type': 'application/json' },
          },
        );
      }
      if (url.endsWith('/sessions/session-1/snapshot-trees?clientRequestId=req-2')) {
        return new Response(
          JSON.stringify({
            trees: [
              makeSnapshot({
                treeHash: 'tree-affected-2',
                parentTreeHash: 'tree-affected-1',
                clientRequestId: 'req-2',
                createdAt: '2026-07-15 10:05:00',
              }),
            ],
          }),
          {
            status: 200,
            headers: { 'content-type': 'application/json' },
          },
        );
      }
      if (url.endsWith('/sessions/session-1/snapshot-trees/tree-affected-1')) {
        return new Response(
          JSON.stringify({
            tree: makeSnapshot({ treeHash: 'tree-affected-1', parentTreeHash: 'tree-keep' }),
            files: [{ filePath: 'first.ts', status: 'modified', additions: 1, deletions: 0 }],
            chain: [],
          }),
          {
            status: 200,
            headers: { 'content-type': 'application/json' },
          },
        );
      }
      if (url.endsWith('/sessions/session-1/snapshot-trees/tree-affected-2')) {
        return new Response(
          JSON.stringify({
            tree: makeSnapshot({ treeHash: 'tree-affected-2', parentTreeHash: 'tree-affected-1' }),
            files: [{ filePath: 'second.ts', status: 'modified', additions: 1, deletions: 0 }],
            chain: [],
          }),
          {
            status: 200,
            headers: { 'content-type': 'application/json' },
          },
        );
      }
      throw new Error(`unexpected fetch: ${url}`);
    }) as typeof fetch;

    const { result } = renderHook(() =>
      useSnapshotAwareAction({
        sessionId: 'session-1',
        gatewayUrl: 'http://localhost:3000',
        messages: [
          makeUserMessage('source-user', '2026-07-15T10:00:00.000Z'),
          makeAssistantMessage('assistant-after-1', 'req-1', '2026-07-15T10:05:00.000Z'),
          makeAssistantMessage('assistant-after-2', 'req-2', '2026-07-15T10:05:00.500Z'),
        ],
      }),
    );

    await act(async () => {
      result.current.checkAndExecute({
        action: 'retry',
        sourceMessageId: 'source-user',
        onProceed: vi.fn(),
      });
    });

    await waitFor(() => {
      expect(result.current.dialogProps.open).toBe(true);
      expect(result.current.dialogProps.restoreTargetTreeHash).toBe('tree-keep');
      expect(
        result.current.dialogProps.affectedSnapshots.map((snapshot) => snapshot.treeHash),
      ).toEqual(['tree-affected-1', 'tree-affected-2']);
    });
  });

  it('恢复失败时不会静默继续后续截断/重发', async () => {
    const onProceed = vi.fn();

    globalThis.fetch = vi.fn(async (input) => {
      const url = String(input);
      if (url.endsWith('/sessions/session-1/snapshot-trees')) {
        return new Response(
          JSON.stringify({
            trees: [
              makeSnapshot({
                treeHash: 'tree-affected-1',
                parentTreeHash: 'tree-keep',
                createdAt: '2026-07-15T10:05:00.000Z',
              }),
            ],
          }),
          {
            status: 200,
            headers: { 'content-type': 'application/json' },
          },
        );
      }
      if (url.endsWith('/sessions/session-1/snapshot-trees?clientRequestId=req-restore-fail')) {
        return new Response(
          JSON.stringify({
            trees: [
              makeSnapshot({
                treeHash: 'tree-affected-1',
                parentTreeHash: 'tree-keep',
                clientRequestId: 'req-restore-fail',
                createdAt: '2026-07-15 10:05:00',
              }),
            ],
          }),
          {
            status: 200,
            headers: { 'content-type': 'application/json' },
          },
        );
      }
      if (url.endsWith('/sessions/session-1/snapshot-trees/tree-affected-1')) {
        return new Response(
          JSON.stringify({
            tree: makeSnapshot({ treeHash: 'tree-affected-1', parentTreeHash: 'tree-keep' }),
            files: [{ filePath: 'changed.ts', status: 'modified', additions: 1, deletions: 0 }],
            chain: [],
          }),
          {
            status: 200,
            headers: { 'content-type': 'application/json' },
          },
        );
      }
      if (url.endsWith('/sessions/session-1/restore/to-tree')) {
        return new Response(JSON.stringify({ error: 'restore failed badly' }), {
          status: 500,
          headers: { 'content-type': 'application/json' },
        });
      }
      throw new Error(`unexpected fetch: ${url}`);
    }) as typeof fetch;

    const { result } = renderHook(() =>
      useSnapshotAwareAction({
        sessionId: 'session-1',
        gatewayUrl: 'http://localhost:3000',
        messages: [
          makeUserMessage('source-user', '2026-07-15T10:00:00.000Z'),
          makeAssistantMessage('assistant-after', 'req-restore-fail', '2026-07-15T10:05:00.000Z'),
        ],
      }),
    );

    await act(async () => {
      result.current.checkAndExecute({
        action: 'retry',
        sourceMessageId: 'source-user',
        onProceed,
      });
    });

    await waitFor(() => {
      expect(result.current.dialogProps.open).toBe(true);
    });

    await act(async () => {
      result.current.dialogProps.onRestoreAndContinue();
    });

    await waitFor(() => {
      expect(result.current.dialogProps.restoreErrorMessage).toBe('restore failed badly');
    });
    expect(onProceed).not.toHaveBeenCalled();
    expect(result.current.dialogProps.open).toBe(true);
  });

  it('没有前序快照时会明确标记无法自动恢复', async () => {
    globalThis.fetch = vi.fn(async (input) => {
      const url = String(input);
      if (url.endsWith('/sessions/session-1/snapshot-trees')) {
        return new Response(
          JSON.stringify({
            trees: [
              makeSnapshot({
                treeHash: 'tree-first',
                parentTreeHash: null,
                createdAt: '2026-07-15T10:05:00.000Z',
              }),
            ],
          }),
          {
            status: 200,
            headers: { 'content-type': 'application/json' },
          },
        );
      }
      if (url.endsWith('/sessions/session-1/snapshot-trees?clientRequestId=req-no-parent')) {
        return new Response(
          JSON.stringify({
            trees: [
              makeSnapshot({
                treeHash: 'tree-first',
                parentTreeHash: null,
                clientRequestId: 'req-no-parent',
                createdAt: '2026-07-15 10:05:00',
              }),
            ],
          }),
          {
            status: 200,
            headers: { 'content-type': 'application/json' },
          },
        );
      }
      if (url.endsWith('/sessions/session-1/snapshot-trees/tree-first')) {
        return new Response(
          JSON.stringify({
            tree: makeSnapshot({ treeHash: 'tree-first', parentTreeHash: null }),
            files: [{ filePath: 'changed.ts', status: 'modified', additions: 1, deletions: 0 }],
            chain: [],
          }),
          {
            status: 200,
            headers: { 'content-type': 'application/json' },
          },
        );
      }
      throw new Error(`unexpected fetch: ${url}`);
    }) as typeof fetch;

    const { result } = renderHook(() =>
      useSnapshotAwareAction({
        sessionId: 'session-1',
        gatewayUrl: 'http://localhost:3000',
        messages: [
          makeUserMessage('source-user', '2026-07-15T10:00:00.000Z'),
          makeAssistantMessage('assistant-after', 'req-no-parent', '2026-07-15T10:05:00.000Z'),
        ],
      }),
    );

    await act(async () => {
      result.current.checkAndExecute({
        action: 'edit',
        sourceMessageId: 'source-user',
        onProceed: vi.fn(),
      });
    });

    await waitFor(() => {
      expect(result.current.dialogProps.restoreUnavailableReason).toContain('没有可用快照');
    });
    expect(result.current.dialogProps.restoreTargetTreeHash).toBeNull();
  });
});
