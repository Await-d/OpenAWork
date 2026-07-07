// @vitest-environment jsdom

import type { TeamAuditLogRecord } from '@openAwork/web-client';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AuditView } from './AuditView.js';

const state = vi.hoisted(() => ({
  auditLogs: [
    {
      id: 'audit-in',
      action: 'handoff_control' as const,
      actorEmail: 'alice@example.com',
      actorUserId: 'user-1',
      entityType: 'handoff' as const,
      entityId: 'handoff-1',
      sessionId: 'child-session',
      summary: '当前子树内的审计',
      detail: null,
      createdAt: '2026-06-06T10:00:00.000Z',
    },
    {
      id: 'audit-out',
      action: 'handoff_control' as const,
      actorEmail: 'bob@example.com',
      actorUserId: 'user-2',
      entityType: 'handoff' as const,
      entityId: 'handoff-2',
      sessionId: 'other-session',
      summary: '其他会话的审计',
      detail: null,
      createdAt: '2026-06-06T09:00:00.000Z',
    },
    {
      id: 'audit-legacy',
      action: 'route_decision' as const,
      actorEmail: 'system@example.com',
      actorUserId: null,
      entityType: 'session' as const,
      entityId: 'session-root',
      sessionId: null,
      summary: '旧审计记录无 sessionId',
      detail: null,
      createdAt: '2026-06-06T08:00:00.000Z',
    },
  ] as TeamAuditLogRecord[],
  sessions: [
    { id: 'root-session', parentSessionId: null },
    { id: 'child-session', parentSessionId: 'root-session' },
    { id: 'other-session', parentSessionId: null },
  ],
}));

vi.mock('../../data/team-runtime-reference-data.js', () => ({
  useTeamRuntimeReferenceViewData: () => ({
    auditLogs: state.auditLogs,
    sessions: state.sessions,
  }),
}));

beforeEach(() => {
  cleanup();
  state.auditLogs = [
    {
      id: 'audit-in',
      action: 'handoff_control' as const,
      actorEmail: 'alice@example.com',
      actorUserId: 'user-1',
      entityType: 'handoff' as const,
      entityId: 'handoff-1',
      sessionId: 'child-session',
      summary: '当前子树内的审计',
      detail: null,
      createdAt: '2026-06-06T10:00:00.000Z',
    },
    {
      id: 'audit-out',
      action: 'handoff_control' as const,
      actorEmail: 'bob@example.com',
      actorUserId: 'user-2',
      entityType: 'handoff' as const,
      entityId: 'handoff-2',
      sessionId: 'other-session',
      summary: '其他会话的审计',
      detail: null,
      createdAt: '2026-06-06T09:00:00.000Z',
    },
    {
      id: 'audit-legacy',
      action: 'route_decision' as const,
      actorEmail: 'system@example.com',
      actorUserId: null,
      entityType: 'session' as const,
      entityId: 'session-root',
      sessionId: null,
      summary: '旧审计记录无 sessionId',
      detail: null,
      createdAt: '2026-06-06T08:00:00.000Z',
    },
  ];
  state.sessions = [
    { id: 'root-session', parentSessionId: null },
    { id: 'child-session', parentSessionId: 'root-session' },
    { id: 'other-session', parentSessionId: null },
  ];
});

afterEach(() => {
  cleanup();
});

describe('AuditView', () => {
  it('支持切换到当前会话子树范围，并过滤掉 scope 外的审计记录', () => {
    render(<AuditView selectedSessionId="root-session" selectedSessionTitle="根会话" />);

    expect(screen.getByText('治理工作台摘要')).toBeTruthy();
    expect(screen.getByText('审计记录')).toBeTruthy();
    expect(screen.getByText('操作者')).toBeTruthy();
    expect(screen.getByText('当前子树内的审计')).toBeTruthy();
    expect(screen.getByText('其他会话的审计')).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: /当前会话子树/i }));

    expect(screen.getByText('当前子树内的审计')).toBeTruthy();
    expect(screen.queryByText('其他会话的审计')).toBeNull();
    // 旧审计记录在过渡期没有 sessionId，仍保留。
    expect(screen.getByText('旧审计记录无 sessionId')).toBeTruthy();
  });

  it('共享会话也支持按当前会话范围过滤审计记录', () => {
    state.auditLogs = [
      {
        id: 'audit-shared-in',
        action: 'shared_comment_created',
        actorEmail: 'alice@example.com',
        actorUserId: 'user-1',
        entityType: 'shared_session_comment',
        entityId: 'comment-1',
        sessionId: 'shared-1',
        summary: '共享会话内评论',
        detail: null,
        createdAt: '2026-06-06T10:20:00.000Z',
      },
      {
        id: 'audit-shared-out',
        action: 'share_created',
        actorEmail: 'bob@example.com',
        actorUserId: 'user-2',
        entityType: 'session_share',
        entityId: 'share-1',
        sessionId: 'shared-2',
        summary: '其他共享会话记录',
        detail: null,
        createdAt: '2026-06-06T10:10:00.000Z',
      },
    ];
    state.sessions = [];

    render(<AuditView selectedSessionId="shared-1" selectedSessionTitle="共享会话 A" />);

    expect(screen.getByText('共享会话内评论')).toBeTruthy();
    expect(screen.getByText('其他共享会话记录')).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: /当前会话子树/i }));

    expect(screen.getByText('共享会话内评论')).toBeTruthy();
    expect(screen.queryByText('其他共享会话记录')).toBeNull();
  });
});
