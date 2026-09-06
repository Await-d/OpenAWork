import { describe, expect, it } from 'vitest';
import { buildTeamSessionRoute, resolveTeamSessionFromRoute } from './team-session-route.js';

const groups = [
  {
    sessions: [{ id: 'session-default' }, { id: 'session-requested' }],
  },
];

describe('team session route', () => {
  it('生成可在刷新后恢复会话的深链', () => {
    expect(buildTeamSessionRoute('workspace/1', 'session?2')).toBe(
      '/team/workspace%2F1?sessionId=session%3F2',
    );
  });

  it('优先恢复 URL 中存在的会话', () => {
    expect(
      resolveTeamSessionFromRoute({
        defaultSessionId: 'session-default',
        groups,
        requestedSessionId: 'session-requested',
      }),
    ).toBe('session-requested');
  });

  it('旧工作区链接回退到默认会话', () => {
    expect(
      resolveTeamSessionFromRoute({
        defaultSessionId: 'session-default',
        groups,
        requestedSessionId: null,
      }),
    ).toBe('session-default');
  });

  it('URL 会话不存在时回退到当前工作区默认会话', () => {
    expect(
      resolveTeamSessionFromRoute({
        defaultSessionId: 'session-default',
        groups,
        requestedSessionId: 'session-missing',
      }),
    ).toBe('session-default');
  });
});
