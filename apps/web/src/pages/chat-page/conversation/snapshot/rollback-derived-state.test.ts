import { describe, expect, it } from 'vitest';
import type { Session, SessionTask } from '@openAwork/web-client';
import type { SubagentNotice } from '@openAwork/shared';
import {
  readTaskParentRequestId,
  resolveRollbackDerivedState,
  TASK_PARENT_TOOL_REQUEST_ID_KEY,
} from './rollback-derived-state.js';

function makeChildSession(input: {
  id: string;
  parentRequestId?: string | null;
  metadataJson?: string;
}): Session {
  const metadataJson =
    input.metadataJson ??
    (input.parentRequestId
      ? JSON.stringify({
          parentSessionId: 'sess-1',
          [TASK_PARENT_TOOL_REQUEST_ID_KEY]: input.parentRequestId,
        })
      : JSON.stringify({ parentSessionId: 'sess-1' }));
  return { id: input.id, metadata_json: metadataJson };
}

function makeTask(id: string, sessionId?: string): SessionTask {
  return {
    id,
    title: id,
    status: 'completed',
    blockedBy: [],
    completedSubtaskCount: 0,
    readySubtaskCount: 0,
    priority: 'medium',
    tags: [],
    createdAt: 0,
    updatedAt: 0,
    depth: 0,
    subtaskCount: 0,
    unmetDependencyCount: 0,
    ...(sessionId ? { sessionId } : {}),
  };
}

function makeNotice(id: string, createdAt: number): SubagentNotice {
  return {
    id,
    agent: 'explore',
    state: 'done',
    description: `任务 ${id}`,
    text: `正文 ${id}`,
    createdAt,
  };
}

const RECEIPT = {
  cutoffTimeMs: 1_000,
  tombstoneAtMs: 2_000,
  invalidatedClientRequestIds: ['req-rolled-back'],
};

describe('readTaskParentRequestId', () => {
  it('读取 metadata 里的父回合键；脏数据一律返回 null', () => {
    expect(
      readTaskParentRequestId(JSON.stringify({ [TASK_PARENT_TOOL_REQUEST_ID_KEY]: 'req-1' })),
    ).toBe('req-1');
    expect(readTaskParentRequestId(JSON.stringify({ parentSessionId: 'sess-1' }))).toBeNull();
    expect(
      readTaskParentRequestId(JSON.stringify({ [TASK_PARENT_TOOL_REQUEST_ID_KEY]: 42 })),
    ).toBeNull();
    expect(readTaskParentRequestId('not-json')).toBeNull();
    expect(readTaskParentRequestId(JSON.stringify(['req-1']))).toBeNull();
    expect(readTaskParentRequestId(undefined)).toBeNull();
  });
});

describe('resolveRollbackDerivedState', () => {
  it('receipt 为空 / 未失效任何回合时原样返回（幂等 no-op）', () => {
    const childSessions = [makeChildSession({ id: 'child-1', parentRequestId: 'req-x' })];
    const sessionTasks = [makeTask('task-1', 'child-1')];
    const subagentNotices = [makeNotice('n-1', 1_500)];

    const noReceipt = resolveRollbackDerivedState({
      receipt: null,
      childSessions,
      sessionTasks,
      subagentNotices,
    });
    expect(noReceipt.childSessions).toHaveLength(1);
    expect(noReceipt.sessionTasks).toHaveLength(1);
    expect(noReceipt.subagentNotices).toHaveLength(1);

    const emptyReceipt = resolveRollbackDerivedState({
      receipt: { cutoffTimeMs: 0, tombstoneAtMs: 0, invalidatedClientRequestIds: [] },
      childSessions,
      sessionTasks,
      subagentNotices,
    });
    expect(emptyReceipt.childSessions).toHaveLength(1);
    expect(emptyReceipt.removedChildSessionIds).toEqual([]);
  });

  it('摘除被作废回合创建的子会话，并连带移除其任务', () => {
    const childSessions = [
      makeChildSession({ id: 'child-rolled-back', parentRequestId: 'req-rolled-back' }),
      makeChildSession({ id: 'child-kept', parentRequestId: 'req-kept' }),
      makeChildSession({ id: 'child-legacy' }),
    ];
    const sessionTasks = [
      makeTask('task-rolled-back', 'child-rolled-back'),
      makeTask('task-kept', 'child-kept'),
      makeTask('task-unbound'),
    ];

    const result = resolveRollbackDerivedState({
      receipt: RECEIPT,
      childSessions,
      sessionTasks,
      subagentNotices: [],
    });

    expect(result.childSessions.map((session) => session.id)).toEqual([
      'child-kept',
      'child-legacy',
    ]);
    expect(result.removedChildSessionIds).toEqual(['child-rolled-back']);
    expect(result.sessionTasks.map((task) => task.id)).toEqual(['task-kept', 'task-unbound']);
  });

  it('按作废窗口过滤子代理通知，窗口外与时间缺失的保留', () => {
    const subagentNotices = [
      makeNotice('n-before', 999),
      makeNotice('n-inside-start', 1_000),
      makeNotice('n-inside', 1_500),
      makeNotice('n-inside-end', 1_999),
      makeNotice('n-after', 2_000),
    ];

    const result = resolveRollbackDerivedState({
      receipt: RECEIPT,
      childSessions: [],
      sessionTasks: [],
      subagentNotices,
    });

    expect(result.subagentNotices.map((notice) => notice.id)).toEqual(['n-before', 'n-after']);

    const withoutTimestamp = resolveRollbackDerivedState({
      receipt: RECEIPT,
      childSessions: [],
      sessionTasks: [],
      subagentNotices: [{ ...makeNotice('n-unknown', 0), createdAt: undefined as never }],
    });
    expect(withoutTimestamp.subagentNotices).toHaveLength(1);
  });

  it('子会话 metadata 脏数据不影响其它条目清理', () => {
    const result = resolveRollbackDerivedState({
      receipt: RECEIPT,
      childSessions: [
        makeChildSession({ id: 'child-bad-metadata', metadataJson: '{not-json' }),
        makeChildSession({ id: 'child-rolled-back', parentRequestId: 'req-rolled-back' }),
      ],
      sessionTasks: [],
      subagentNotices: [],
    });
    expect(result.childSessions.map((session) => session.id)).toEqual(['child-bad-metadata']);
  });
});
