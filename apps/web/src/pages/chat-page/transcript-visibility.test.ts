import { describe, expect, it } from 'vitest';
import type { RunEvent } from '@openAwork/shared';
import type { ChatMessage } from './support.js';
import {
  filterTranscriptMessages,
  shouldShowMessageInTranscript,
  shouldShowRunEventInTranscript,
} from './transcript-visibility.js';

describe('transcript-visibility', () => {
  it('hides assistant_event compaction cards from the visible transcript', () => {
    const message: ChatMessage = {
      id: 'assistant-compaction',
      role: 'assistant',
      content: JSON.stringify({
        source: 'openawork_internal',
        type: 'assistant_event',
        payload: {
          kind: 'compaction',
          title: '会话已压缩',
          message: '已自动压缩新增的 2 条较早消息',
          status: 'success',
        },
      }),
      createdAt: 1,
      status: 'completed',
    };

    expect(shouldShowMessageInTranscript(message)).toBe(false);
    expect(filterTranscriptMessages([message])).toEqual([]);
  });

  it('hides all assistant_event cards from the visible transcript', () => {
    const message: ChatMessage = {
      id: 'assistant-permission',
      role: 'assistant',
      content: JSON.stringify({
        source: 'openawork_internal',
        type: 'assistant_event',
        payload: {
          kind: 'permission',
          title: '等待权限 · bash',
          message: '需要写入工作区',
          status: 'paused',
        },
      }),
      createdAt: 1,
      status: 'completed',
    };

    expect(shouldShowMessageInTranscript(message)).toBe(false);
    expect(filterTranscriptMessages([message])).toEqual([]);
  });

  it('suppresses operational run events from live transcript mirroring', () => {
    const compactionEvent: RunEvent = {
      type: 'compaction',
      summary: '保留最近 20 条消息，其余已压缩。',
      trigger: 'automatic',
    };
    const taskEvent: RunEvent = {
      type: 'task_update',
      taskId: 'task-1',
      label: '整理结论',
      status: 'in_progress',
    };
    const auditEvent: RunEvent = {
      type: 'audit_ref',
      auditLogId: 'audit-1',
      toolName: 'bash',
    };
    const childEvent: RunEvent = {
      type: 'session_child',
      sessionId: 'child-1',
      parentSessionId: 'session-1',
      title: '子代理',
    };

    expect(shouldShowRunEventInTranscript(compactionEvent)).toBe(false);
    expect(shouldShowRunEventInTranscript(taskEvent)).toBe(false);
    expect(shouldShowRunEventInTranscript(auditEvent)).toBe(false);
    expect(shouldShowRunEventInTranscript(childEvent)).toBe(false);
  });
});
