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

/**
 * 引用稳定性。
 *
 * 回归背景：lookup 被 `renderContent` 闭包捕获并进入 `useChatRenderData` 的 memo
 * 依赖，引用一换就会击穿所有 `ChatGroupBlock` 的 `React.memo`。会话运行时快照每 3s
 * 轮询一次、`loadCurrentSessionSnapshot` 也会直接写 `childSessions`/`sessionTasks`，
 * 因此内容一致时必须返回同一个对象。
 */
describe('buildTaskToolRuntimeLookup 的引用稳定性', () => {
  it('内容一致时返回同一个 lookup 引用', () => {
    const first = buildTaskToolRuntimeLookup(
      [buildSession({ id: 'c1', state_status: 'running' })],
      [buildTask({ id: 't1', sessionId: 'c1', status: 'running' })],
    );
    // 模拟重新反序列化：对象全新但内容一致
    const second = buildTaskToolRuntimeLookup(
      [buildSession({ id: 'c1', state_status: 'running' })],
      [buildTask({ id: 't1', sessionId: 'c1', status: 'running' })],
    );

    expect(second).toBe(first);
  });

  it('任务状态推进时返回新引用', () => {
    const first = buildTaskToolRuntimeLookup([], [buildTask({ id: 't1', status: 'running' })]);
    const second = buildTaskToolRuntimeLookup([], [buildTask({ id: 't1', status: 'completed' })]);

    expect(second).not.toBe(first);
  });

  it('任务结果回填时返回新引用', () => {
    const first = buildTaskToolRuntimeLookup([], [buildTask({ id: 't1', status: 'running' })]);
    const second = buildTaskToolRuntimeLookup(
      [],
      [buildTask({ id: 't1', status: 'running', result: '完成' })],
    );

    expect(second).not.toBe(first);
  });

  it('子会话进入 paused（影响状态派生）时返回新引用', () => {
    const first = buildTaskToolRuntimeLookup(
      [buildSession({ id: 'c1', state_status: 'running' })],
      [buildTask({ id: 't1', sessionId: 'c1', status: 'running' })],
    );
    const second = buildTaskToolRuntimeLookup(
      [buildSession({ id: 'c1', state_status: 'paused' })],
      [buildTask({ id: 't1', sessionId: 'c1', status: 'running' })],
    );

    expect(second).not.toBe(first);
  });

  it('子会话与任务顺序变化时仍视为内容一致', () => {
    const first = buildTaskToolRuntimeLookup(
      [buildSession({ id: 'c1' }), buildSession({ id: 'c2' })],
      [buildTask({ id: 't1', sessionId: 'c1' }), buildTask({ id: 't2', sessionId: 'c2' })],
    );
    const reordered = buildTaskToolRuntimeLookup(
      [buildSession({ id: 'c2' }), buildSession({ id: 'c1' })],
      [buildTask({ id: 't2', sessionId: 'c2' }), buildTask({ id: 't1', sessionId: 'c1' })],
    );

    expect(reordered).toBe(first);
  });

  it('任务集合变化时返回新引用', () => {
    const first = buildTaskToolRuntimeLookup([], [buildTask({ id: 't1' })]);
    const second = buildTaskToolRuntimeLookup(
      [],
      [buildTask({ id: 't1' }), buildTask({ id: 't2' })],
    );

    expect(second).not.toBe(first);
  });
});
