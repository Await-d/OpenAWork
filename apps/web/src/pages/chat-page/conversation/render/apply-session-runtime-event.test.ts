import { describe, expect, it } from 'vitest';
import {
  applySessionChildRuntimeEvent,
  applyTaskUpdateRuntimeEvent,
} from './apply-session-runtime-event.js';

describe('applySessionChildRuntimeEvent', () => {
  it('会插入新子会话', () => {
    const next = applySessionChildRuntimeEvent([], { sessionId: 's1', title: 'child' });
    expect(next[0]?.id).toBe('s1');
  });

  it('会更新已有子会话标题', () => {
    const next = applySessionChildRuntimeEvent([{ id: 's1', title: 'old' } as never], {
      sessionId: 's1',
      title: 'new',
    });
    expect(next[0]?.title).toBe('new');
  });
});

describe('applyTaskUpdateRuntimeEvent', () => {
  it('会插入新任务', () => {
    const next = applyTaskUpdateRuntimeEvent([], {
      label: 'task',
      status: 'pending',
      taskId: 't1',
    });
    expect(next[0]?.id).toBe('t1');
  });

  it('会把 in_progress 归一化成 running', () => {
    const next = applyTaskUpdateRuntimeEvent([], {
      label: 'task',
      status: 'in_progress',
      taskId: 't1',
    });
    expect(next[0]?.status).toBe('running');
  });
});
