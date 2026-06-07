import { describe, expect, it } from 'vitest';
import type { SharedSessionDetailRecord, SharedSessionSummaryRecord } from '@openAwork/web-client';
import {
  resolveActiveSharedSession,
  resolveMatchedSharedSessionDetail,
  resolveMatchedSharedSummary,
  resolveSelectedSharedSummary,
} from './team-runtime-shared-context.js';

function sharedSummary(sessionId: string, title: string): SharedSessionSummaryRecord {
  return {
    sessionId,
    title,
    stateStatus: 'running',
    workspacePath: '/workspace/demo',
    sharedByEmail: 'owner@example.com',
    permission: 'operate',
    createdAt: '2026-06-04T10:00:00.000Z',
    updatedAt: '2026-06-04T10:00:00.000Z',
    shareCreatedAt: '2026-06-04T10:00:00.000Z',
    shareUpdatedAt: '2026-06-04T10:00:00.000Z',
  };
}

function sharedDetail(sessionId: string, title: string): SharedSessionDetailRecord {
  return {
    comments: [],
    pendingPermissions: [],
    pendingQuestions: [],
    presence: [],
    share: sharedSummary(sessionId, title),
    session: {
      id: sessionId,
      title,
      state_status: 'running',
      messages: [],
    },
  };
}

describe('resolveSelectedSharedSummary', () => {
  it('当前选中的 team 若是共享会话，则只返回对应摘要', () => {
    const result = resolveSelectedSharedSummary({
      selectedTeamId: 'shared-2',
      snapshotSharedSessions: [sharedSummary('shared-1', '共享会话 A')],
      sharedSessions: [sharedSummary('shared-2', '共享会话 B')],
      selectedSharedSessionShare: sharedSummary('shared-1', '共享会话 A'),
      selectedSharedSessionId: 'shared-1',
    });

    expect(result?.sessionId).toBe('shared-2');
  });

  it('当前选中的 team 不是共享会话时，不回退到其他共享摘要', () => {
    const result = resolveSelectedSharedSummary({
      selectedTeamId: 'runtime-session-1',
      snapshotSharedSessions: [sharedSummary('shared-1', '共享会话 A')],
      sharedSessions: [sharedSummary('shared-2', '共享会话 B')],
      selectedSharedSessionShare: sharedSummary('shared-1', '共享会话 A'),
      selectedSharedSessionId: 'shared-1',
    });

    expect(result).toBeNull();
  });

  it('未选中具体 team 时，按当前选中的共享会话和首条摘要回退', () => {
    const result = resolveSelectedSharedSummary({
      selectedTeamId: null,
      snapshotSharedSessions: [sharedSummary('shared-1', '共享会话 A')],
      sharedSessions: [sharedSummary('shared-2', '共享会话 B')],
      selectedSharedSessionShare: null,
      selectedSharedSessionId: 'shared-2',
    });

    expect(result?.sessionId).toBe('shared-2');
  });
});

describe('resolveActiveSharedSession', () => {
  it('当前选中的 team 若与共享详情匹配，则返回对应详情', () => {
    const detail = sharedDetail('shared-1', '共享会话 A');
    expect(
      resolveActiveSharedSession({
        selectedTeamId: 'shared-1',
        selectedSharedSession: detail,
      }),
    ).toBe(detail);
  });

  it('当前选中的 team 若是普通 runtime session，则不回退显示旧共享详情', () => {
    expect(
      resolveActiveSharedSession({
        selectedTeamId: 'runtime-session-1',
        selectedSharedSession: sharedDetail('shared-1', '共享会话 A'),
      }),
    ).toBeNull();
  });
});

describe('resolveMatchedSharedSummary', () => {
  it('优先返回与当前选中共享会话匹配的 active 详情摘要', () => {
    const result = resolveMatchedSharedSummary({
      selectedTeamId: 'shared-2',
      activeSharedSession: sharedDetail('shared-2', '共享会话 B'),
      selectedSharedSession: sharedDetail('shared-1', '共享会话 A'),
      sharedSessions: [sharedSummary('shared-1', '共享会话 A')],
    });

    expect(result?.sessionId).toBe('shared-2');
    expect(result?.title).toBe('共享会话 B');
  });

  it('active 详情不匹配时，回退到同 id 的 selected 详情摘要', () => {
    const result = resolveMatchedSharedSummary({
      selectedTeamId: 'shared-2',
      activeSharedSession: sharedDetail('shared-1', '共享会话 A'),
      selectedSharedSession: sharedDetail('shared-2', '共享会话 B'),
      sharedSessions: [sharedSummary('shared-1', '共享会话 A')],
    });

    expect(result?.sessionId).toBe('shared-2');
    expect(result?.title).toBe('共享会话 B');
  });
});

describe('resolveMatchedSharedSessionDetail', () => {
  it('不会把别的共享会话详情误返回给当前选中会话', () => {
    const result = resolveMatchedSharedSessionDetail({
      selectedTeamId: 'shared-2',
      activeSharedSession: sharedDetail('shared-1', '共享会话 A'),
      selectedSharedSession: null,
    });

    expect(result).toBeNull();
  });

  it('active 详情不匹配时，会回退到同 id 的 selected 详情', () => {
    const detail = sharedDetail('shared-2', '共享会话 B');
    expect(
      resolveMatchedSharedSessionDetail({
        selectedTeamId: 'shared-2',
        activeSharedSession: sharedDetail('shared-1', '共享会话 A'),
        selectedSharedSession: detail,
      }),
    ).toBe(detail);
  });
});
