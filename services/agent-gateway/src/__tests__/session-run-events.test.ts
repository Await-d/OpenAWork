import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  appendSessionMessageMock: vi.fn(),
  sqliteGetMock: vi.fn(),
  sqliteRunMock: vi.fn(),
  sqliteAllMock: vi.fn(),
}));

vi.mock('../db.js', () => ({
  sqliteGet: mocks.sqliteGetMock,
  sqliteRun: mocks.sqliteRunMock,
  sqliteAll: mocks.sqliteAllMock,
}));

vi.mock('../session-message-store.js', () => ({
  appendSessionMessage: mocks.appendSessionMessageMock,
}));

import {
  listSessionRunEventsByRequest,
  publishSessionRunEvent,
  subscribeSessionRunEvents,
} from '../session-run-events.js';

describe('session run events', () => {
  beforeEach(() => {
    mocks.appendSessionMessageMock.mockReset();
    mocks.sqliteGetMock.mockReset();
    mocks.sqliteRunMock.mockReset();
    mocks.sqliteAllMock.mockReset();
  });

  it('publishes events to active subscribers and stops after unsubscribe', () => {
    mocks.sqliteGetMock.mockReturnValue({ user_id: 'user-a' });
    const handler = vi.fn();
    const unsubscribe = subscribeSessionRunEvents('session-1', handler);

    publishSessionRunEvent('session-1', {
      type: 'permission_asked',
      requestId: 'perm-1',
      toolName: 'bash',
      scope: 'workspace',
      reason: '需要运行命令',
      riskLevel: 'medium',
    });

    expect(handler).toHaveBeenCalledTimes(1);

    unsubscribe();
    publishSessionRunEvent('session-1', {
      type: 'permission_replied',
      requestId: 'perm-1',
      decision: 'once',
    });

    expect(handler).toHaveBeenCalledTimes(1);
    expect(mocks.sqliteRunMock).toHaveBeenCalledTimes(2);
  });

  it('persists tool_result observability in payload_json for request-scoped replay', () => {
    mocks.sqliteGetMock.mockReturnValue({ user_id: 'user-a' });

    publishSessionRunEvent(
      'session-2',
      {
        type: 'tool_result',
        toolCallId: 'call-1',
        toolName: 'write',
        clientRequestId: 'req-1',
        output: { ok: true },
        isError: false,
        fileDiffs: [
          {
            file: '/repo/a.ts',
            before: 'a',
            after: 'b',
            additions: 1,
            deletions: 1,
            status: 'modified',
            clientRequestId: 'req-1',
            toolCallId: 'call-1',
            toolName: 'write',
          },
        ],
        observability: {
          presentedToolName: 'Write',
          canonicalToolName: 'write',
          toolSurfaceProfile: 'claude_code_default',
          adapterVersion: '1.0.0',
        },
      },
      { clientRequestId: 'req-1' },
    );

    const params = mocks.sqliteRunMock.mock.calls[0]?.[1] as unknown[];
    expect(JSON.parse(String(params?.[8]))).toMatchObject({
      type: 'tool_result',
      toolCallId: 'call-1',
      clientRequestId: 'req-1',
      fileDiffs: [
        {
          file: '/repo/a.ts',
          before: 'a',
          after: 'b',
          additions: 1,
          deletions: 1,
          status: 'modified',
          clientRequestId: 'req-1',
          toolCallId: 'call-1',
          toolName: 'write',
        },
      ],
      observability: {
        presentedToolName: 'Write',
        canonicalToolName: 'write',
        toolSurfaceProfile: 'claude_code_default',
        adapterVersion: '1.0.0',
      },
    });

    mocks.sqliteAllMock.mockReturnValue([
      {
        payload_json: JSON.stringify({
          type: 'tool_result',
          toolCallId: 'call-1',
          toolName: 'write',
          clientRequestId: 'req-1',
          output: { ok: true },
          isError: false,
          fileDiffs: [
            {
              file: '/repo/a.ts',
              before: 'a',
              after: 'b',
              additions: 1,
              deletions: 1,
              status: 'modified',
              clientRequestId: 'req-1',
              toolCallId: 'call-1',
              toolName: 'write',
            },
          ],
          observability: {
            presentedToolName: 'Write',
            canonicalToolName: 'write',
            toolSurfaceProfile: 'claude_code_default',
            adapterVersion: '1.0.0',
          },
        }),
      },
    ]);

    expect(
      listSessionRunEventsByRequest({ sessionId: 'session-2', clientRequestId: 'req-1' }),
    ).toEqual([
      {
        type: 'tool_result',
        toolCallId: 'call-1',
        toolName: 'write',
        clientRequestId: 'req-1',
        output: { ok: true },
        isError: false,
        fileDiffs: [
          {
            file: '/repo/a.ts',
            before: 'a',
            after: 'b',
            additions: 1,
            deletions: 1,
            status: 'modified',
            clientRequestId: 'req-1',
            toolCallId: 'call-1',
            toolName: 'write',
          },
        ],
        observability: {
          presentedToolName: 'Write',
          canonicalToolName: 'write',
          toolSurfaceProfile: 'claude_code_default',
          adapterVersion: '1.0.0',
        },
      },
    ]);
  });

  it('mirrors displayable run events into assistant_event session messages', () => {
    mocks.sqliteGetMock.mockReturnValue({ user_id: 'user-a' });

    publishSessionRunEvent(
      'session-3',
      {
        type: 'permission_asked',
        requestId: 'perm-1',
        toolName: 'bash',
        scope: 'workspace-write',
        reason: '需要写入工作区文件',
        riskLevel: 'medium',
        previewAction: '创建配置文件',
        occurredAt: 123,
      },
      { clientRequestId: 'req-3' },
    );

    expect(mocks.appendSessionMessageMock).toHaveBeenCalledWith(
      expect.objectContaining({
        sessionId: 'session-3',
        userId: 'user-a',
        role: 'assistant',
        clientRequestId: 'assistant_event:req-3:seq:1:permission_asked',
        createdAt: 123,
        content: [
          {
            type: 'text',
            text: expect.stringContaining('"type":"assistant_event"'),
          },
        ],
      }),
    );
    const mirroredText = mocks.appendSessionMessageMock.mock.calls[0]?.[0]?.content?.[0]?.text;
    expect(JSON.parse(String(mirroredText))).toMatchObject({
      type: 'assistant_event',
      payload: {
        title: '等待权限 · bash',
        status: 'paused',
      },
    });
  });

  it('uses eventId as the mirrored assistant_event idempotency key when available', () => {
    mocks.sqliteGetMock.mockReturnValue({ user_id: 'user-a' });

    publishSessionRunEvent('session-4', {
      type: 'compaction',
      summary: '保留最近 20 条消息，其余已压缩。',
      trigger: 'manual',
      eventId: 'evt-compact-1',
      occurredAt: 456,
    });

    expect(mocks.appendSessionMessageMock).toHaveBeenCalledWith(
      expect.objectContaining({
        clientRequestId: 'assistant_event:evt-compact-1',
      }),
    );
  });

  it('mirrors compaction lifecycle phases into assistant event cards', () => {
    mocks.sqliteGetMock.mockReturnValue({ user_id: 'user-a' });

    publishSessionRunEvent(
      'session-5',
      {
        type: 'compaction',
        summary: '正在压缩会话上下文。',
        trigger: 'automatic',
        phase: 'started',
        cause: 'provider_overflow',
        strategy: 'synthetic_continue',
        compactedMessages: 4,
        representedMessages: 12,
        eventId: 'evt-compact-start',
        occurredAt: 789,
      },
      { clientRequestId: 'req-compact' },
    );

    const mirroredText = mocks.appendSessionMessageMock.mock.calls.at(-1)?.[0]?.content?.[0]?.text;
    expect(JSON.parse(String(mirroredText))).toMatchObject({
      type: 'assistant_event',
      payload: {
        title: '正在压缩会话',
        status: 'running',
      },
    });
  });
});
