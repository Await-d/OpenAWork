import { describe, expect, it } from 'vitest';
import {
  buildTeamSessionRoute,
  resolveTeamSessionFromRoute,
  resolveTeamSessionWorkspacePath,
  resolveTeamWorkspaceIdForWorkspacePath,
} from './team-session-route.js';

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

  it('返回会话所在分组的工作区路径', () => {
    expect(
      resolveTeamSessionWorkspacePath({
        groups: [
          {
            sessions: [{ id: 'session-default' }, { id: 'session-requested' }],
            workspacePath: '/workspace/demo',
          },
          { sessions: [{ id: 'session-other' }], workspacePath: '/workspace/other' },
        ],
        sessionId: 'session-requested',
      }),
    ).toBe('/workspace/demo');
  });

  it('会话不属于任何分组时返回 null', () => {
    expect(
      resolveTeamSessionWorkspacePath({
        groups: [{ sessions: [{ id: 'session-default' }], workspacePath: '/workspace/demo' }],
        sessionId: 'session-missing',
      }),
    ).toBeNull();
  });

  it('分组没有工作区路径时返回 null', () => {
    expect(
      resolveTeamSessionWorkspacePath({
        groups: [{ sessions: [{ id: 'session-default' }], workspacePath: null }],
        sessionId: 'session-default',
      }),
    ).toBeNull();
  });

  it('工作区路径为空白时返回 null', () => {
    expect(
      resolveTeamSessionWorkspacePath({
        groups: [{ sessions: [{ id: 'session-default' }], workspacePath: '   ' }],
        sessionId: 'session-default',
      }),
    ).toBeNull();
  });

  it('嵌套路径命中工作区根目录时返回工作区 id', () => {
    expect(
      resolveTeamWorkspaceIdForWorkspacePath({
        workspacePath: '/workspace/demo/packages/app',
        workspaces: [{ id: 'workspace-demo', defaultWorkingRoot: '/workspace/demo' }],
      }),
    ).toBe('workspace-demo');
  });

  it('路径不在任何工作区根目录下时返回 null', () => {
    expect(
      resolveTeamWorkspaceIdForWorkspacePath({
        workspacePath: '/workspace/outside',
        workspaces: [{ id: 'workspace-demo', defaultWorkingRoot: '/workspace/demo' }],
      }),
    ).toBeNull();
  });

  it('工作区路径为 null 时返回 null', () => {
    expect(
      resolveTeamWorkspaceIdForWorkspacePath({
        workspacePath: null,
        workspaces: [{ id: 'workspace-demo', defaultWorkingRoot: '/workspace/demo' }],
      }),
    ).toBeNull();
  });

  it('路径归属第二个工作区时不误取第一个工作区', () => {
    expect(
      resolveTeamWorkspaceIdForWorkspacePath({
        workspacePath: '/workspace/beta/project',
        workspaces: [
          { id: 'workspace-alpha', defaultWorkingRoot: '/workspace/alpha' },
          { id: 'workspace-beta', defaultWorkingRoot: '/workspace/beta' },
        ],
      }),
    ).toBe('workspace-beta');
  });
});
