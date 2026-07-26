import { describe, expect, it } from 'vitest';
import type { ChatMessage } from './support.js';
import {
  isTranscriptCompactionMessage,
  shouldShowMessageInTranscript,
  shouldShowRunEventInTranscript,
} from './transcript-visibility.js';

describe('transcript visibility for compaction', () => {
  it('shows GenerativeUI compaction cards in the main transcript', () => {
    const message: ChatMessage = {
      id: 'c1',
      role: 'assistant',
      content: JSON.stringify({
        type: 'compaction',
        payload: {
          title: '会话已自动压缩',
          summary: '压缩了较早的对话内容',
          trigger: 'automatic',
        },
      }),
      status: 'completed',
    };

    expect(shouldShowMessageInTranscript(message)).toBe(true);
    expect(isTranscriptCompactionMessage(message)).toBe(true);
  });

  it('hides non-compaction operational assistant events', () => {
    const message: ChatMessage = {
      id: 'p1',
      role: 'assistant',
      content: JSON.stringify({
        source: 'openawork_internal',
        type: 'assistant_event',
        payload: {
          kind: 'permission',
          title: '等待权限',
          message: '需要批准 bash',
          status: 'paused',
        },
      }),
      status: 'completed',
    };

    expect(shouldShowMessageInTranscript(message)).toBe(false);
    expect(isTranscriptCompactionMessage(message)).toBe(false);
  });

  it('keeps compaction run events visible in the transcript feed', () => {
    expect(
      shouldShowRunEventInTranscript({
        type: 'compaction',
        summary: 'compressed earlier turns',
        trigger: 'automatic',
      }),
    ).toBe(true);
    expect(
      shouldShowRunEventInTranscript({
        type: 'task_update',
        taskId: 't1',
        label: 'task',
        status: 'done',
      } as never),
    ).toBe(false);
  });
});
