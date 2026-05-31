import { describe, expect, it } from 'vitest';
import type { HandoffEvent } from '../../../../stores/team/team-events.js';
import {
  extractTeamRuntimeHandoffContextFromEvent,
  resolveTeamRuntimeTabFromBlockingReason,
} from './team-runtime-navigation.js';

function createEvent(overrides: Partial<HandoffEvent>): HandoffEvent {
  return {
    type: overrides.type ?? 'blocking',
    timestamp: overrides.timestamp ?? Date.now(),
    payload: overrides.payload ?? {},
    layer: overrides.layer,
    sessionId: overrides.sessionId,
    taskId: overrides.taskId,
  };
}

describe('resolveTeamRuntimeTabFromBlockingReason', () => {
  it('把阻塞 reason 映射到目标 tab', () => {
    expect(resolveTeamRuntimeTabFromBlockingReason('review_failed_threshold')).toBe('review');
    expect(resolveTeamRuntimeTabFromBlockingReason('needs_clarification')).toBe('artifacts');
    expect(resolveTeamRuntimeTabFromBlockingReason('dispatch_context')).toBe('artifacts');
    expect(resolveTeamRuntimeTabFromBlockingReason('artifacts_context')).toBe('artifacts');
    expect(resolveTeamRuntimeTabFromBlockingReason('constitution_violation')).toBe('health');
    expect(resolveTeamRuntimeTabFromBlockingReason(null)).toBe('health');
  });
});

describe('extractTeamRuntimeHandoffContextFromEvent', () => {
  it('优先从 payload 提取 handoff / session 上下文', () => {
    const target = extractTeamRuntimeHandoffContextFromEvent(
      createEvent({
        payload: {
          handoffId: 'handoff-1',
          fromSessionId: 'session-1',
          reason: 'review_failed_threshold',
        },
        taskId: 'task-fallback',
        sessionId: 'session-fallback',
      }),
    );

    expect(target).toEqual({
      handoffId: 'handoff-1',
      preferredTab: 'review',
      sessionId: 'session-1',
    });
  });

  it('在 payload 缺失时回退到 event 自身字段', () => {
    const target = extractTeamRuntimeHandoffContextFromEvent(
      createEvent({
        taskId: 'task-2',
        sessionId: 'session-2',
        payload: {
          reason: 'dispatch_context',
        },
      }),
    );

    expect(target).toEqual({
      handoffId: 'task-2',
      preferredTab: 'artifacts',
      sessionId: 'session-2',
    });
  });
});
