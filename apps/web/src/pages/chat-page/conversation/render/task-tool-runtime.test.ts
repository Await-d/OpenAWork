import { describe, expect, it } from 'vitest';
import type { Session, SessionTask } from '@openAwork/web-client';
import { buildTaskToolRuntimeLookup, resolveTaskToolRuntimeSnapshot } from './task-tool-runtime.js';

function buildTask(overrides: Partial<SessionTask> & Pick<SessionTask, 'id'>): SessionTask {
  return {
    blockedBy: [],
    completedSubtaskCount: 0,
    createdAt: 0,
    depth: 0,
    priority: 'medium',
    readySubtaskCount: 0,
    status: 'running',
    subtaskCount: 0,
    tags: [],
    title: '子代理任务',
    unmetDependencyCount: 0,
    updatedAt: 0,
    ...overrides,
  };
}

function buildSession(overrides: Partial<Session> & Pick<Session, 'id'>): Session {
  return { ...overrides };
}

const CHILD_SESSION = buildSession({ id: 'ses_child_1', title: '子代理 A' });
const TASK = buildTask({ id: 'task_1', sessionId: CHILD_SESSION.id, title: '调查 foo' });
const LOOKUP = buildTaskToolRuntimeLookup([CHILD_SESSION], [TASK]);

describe('resolveTaskToolRuntimeSnapshot', () => {
  it('input.task_id 命中任务快照', () => {
    const snapshot = resolveTaskToolRuntimeSnapshot({ task_id: 'task_1' }, undefined, LOOKUP);
    expect(snapshot?.sessionId).toBe('ses_child_1');
    expect(snapshot?.title).toBe('调查 foo');
  });

  it('文本输出里的 <subagent sessionID="…"> 命中子会话快照', () => {
    const snapshot = resolveTaskToolRuntimeSnapshot(
      { prompt: '跑一下' },
      '<subagent sessionID="ses_child_1" state="completed">done</subagent>',
      LOOKUP,
    );
    expect(snapshot?.taskId).toBe('task_1');
  });

  it('后台文本输出的「会话 ID：」行同样命中', () => {
    const snapshot = resolveTaskToolRuntimeSnapshot(
      { prompt: '后台跑' },
      '后台 agent 任务已成功启动。\n\n任务 ID：task_1\n会话 ID：ses_child_1',
      LOOKUP,
    );
    expect(snapshot?.taskId).toBe('task_1');
  });

  it('JSON 字符串输出（历史消息序列化形态）同样命中', () => {
    const snapshot = resolveTaskToolRuntimeSnapshot(
      { prompt: '调查' },
      '{"taskId":"task_1","sessionId":"ses_child_1","status":"completed"}',
      LOOKUP,
    );
    expect(snapshot?.taskId).toBe('task_1');
  });

  it('resume 输入 session_id 命中子会话快照', () => {
    const snapshot = resolveTaskToolRuntimeSnapshot(
      { prompt: '继续', session_id: 'ses_child_1' },
      undefined,
      LOOKUP,
    );
    expect(snapshot?.taskId).toBe('task_1');
  });

  it('上游别名 sessionID 同样命中', () => {
    const snapshot = resolveTaskToolRuntimeSnapshot(
      { prompt: '继续', sessionID: 'ses_child_1' },
      undefined,
      LOOKUP,
    );
    expect(snapshot?.taskId).toBe('task_1');
  });

  it('无法关联时返回 undefined', () => {
    expect(resolveTaskToolRuntimeSnapshot({ prompt: 'x' }, undefined, LOOKUP)).toBeUndefined();
    expect(resolveTaskToolRuntimeSnapshot({ prompt: 'x' }, undefined, undefined)).toBeUndefined();
  });
});
