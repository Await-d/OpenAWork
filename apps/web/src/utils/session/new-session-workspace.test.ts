/**
 * 「新建会话」工作区继承解析回归测试。
 *
 * 需求：从哪个上下文点「新建会话」，默认就落到那个上下文的工作区，避免沿用
 * 全局陈旧选中值导致新建后还要手动调整工作区；SSH 远端会话必须把远端路径与
 * 连接 id 成对继承。
 */
import { describe, expect, it } from 'vitest';
import type { SessionWithWorkspaceLike } from './session-grouping.js';
import { resolveNewSessionWorkspace } from './new-session-workspace.js';

function makeSession(
  id: string,
  options: { parentSessionId?: string; sshConnectionId?: string; workingDirectory?: string } = {},
): SessionWithWorkspaceLike {
  const metadata: Record<string, string> = {};
  if (options.workingDirectory) metadata['workingDirectory'] = options.workingDirectory;
  if (options.parentSessionId) metadata['parentSessionId'] = options.parentSessionId;
  if (options.sshConnectionId) metadata['sshConnectionId'] = options.sshConnectionId;

  return {
    id,
    metadata_json: JSON.stringify(metadata),
    updated_at: '2026-09-23T08:00:00.000Z',
  };
}

describe('resolveNewSessionWorkspace', () => {
  it('显式路径优先于上下文与兜底值，且不改动现有 SSH 绑定', () => {
    expect(
      resolveNewSessionWorkspace({
        explicitWorkspacePath: '/ws/explicit',
        contextSessionId: 'session-a',
        activeSessionWorkspace: { sessionId: 'session-a', path: '/ws/context' },
        fallbackWorkspacePath: '/ws/fallback',
      }),
    ).toEqual({ workspacePath: '/ws/explicit' });
  });

  it('显式 null 表示该入口不绑定工作区，不回落上下文 / 兜底值并清掉 SSH 绑定', () => {
    expect(
      resolveNewSessionWorkspace({
        explicitWorkspacePath: null,
        contextSessionId: 'session-a',
        activeSessionWorkspace: { sessionId: 'session-a', path: '/ws/context' },
        fallbackWorkspacePath: '/ws/fallback',
      }),
    ).toEqual({ workspacePath: null, sshConnectionId: null });
  });

  it('空白显式路径按未绑定处理', () => {
    expect(
      resolveNewSessionWorkspace({
        explicitWorkspacePath: '   ',
        fallbackWorkspacePath: '/ws/x',
      }),
    ).toEqual({ workspacePath: null, sshConnectionId: null });
  });

  it('继承上下文会话的实时解析缓存（含 SSH 连接 id）', () => {
    expect(
      resolveNewSessionWorkspace({
        contextSessionId: 'session-a',
        activeSessionWorkspace: {
          sessionId: 'session-a',
          path: '/remote/repo',
          sshConnectionId: 'ssh-1',
        },
        fallbackWorkspacePath: '/ws/fallback',
      }),
    ).toEqual({ workspacePath: '/remote/repo', sshConnectionId: 'ssh-1' });
  });

  it('实时缓存命中「未绑定」时同样继承未绑定，不回落兜底值', () => {
    expect(
      resolveNewSessionWorkspace({
        contextSessionId: 'session-a',
        activeSessionWorkspace: { sessionId: 'session-a', path: null, sshConnectionId: null },
        fallbackWorkspacePath: '/ws/fallback',
      }),
    ).toEqual({ workspacePath: null, sshConnectionId: null });
  });

  it('缓存属于其它会话时不误用，退回会话列表解析', () => {
    expect(
      resolveNewSessionWorkspace({
        contextSessionId: 'session-a',
        activeSessionWorkspace: { sessionId: 'session-b', path: '/ws/other' },
        sessions: [makeSession('session-a', { workingDirectory: '/ws/list' })],
        fallbackWorkspacePath: '/ws/fallback',
      }),
    ).toEqual({ workspacePath: '/ws/list', sshConnectionId: null });
  });

  it('会话列表里没有 workingDirectory 时沿父会话链继承（含 SSH 绑定）', () => {
    expect(
      resolveNewSessionWorkspace({
        contextSessionId: 'session-child',
        sessions: [
          makeSession('session-parent', {
            sshConnectionId: 'ssh-parent',
            workingDirectory: '/remote/parent',
          }),
          makeSession('session-child', { parentSessionId: 'session-parent' }),
        ],
        fallbackWorkspacePath: '/ws/fallback',
      }),
    ).toEqual({ workspacePath: '/remote/parent', sshConnectionId: 'ssh-parent' });
  });

  it('上下文会话已确认未绑定时返回空绑定，不回落兜底值', () => {
    expect(
      resolveNewSessionWorkspace({
        contextSessionId: 'session-a',
        sessions: [makeSession('session-a')],
        fallbackWorkspacePath: '/ws/fallback',
      }),
    ).toEqual({ workspacePath: null, sshConnectionId: null });
  });

  it('上下文会话不可解析（列表被过滤 / 未加载）时回落全局选中值，且不改动 SSH 绑定', () => {
    expect(
      resolveNewSessionWorkspace({
        contextSessionId: 'session-missing',
        sessions: [makeSession('session-other', { workingDirectory: '/ws/other' })],
        fallbackWorkspacePath: '/ws/fallback',
      }),
    ).toEqual({ workspacePath: '/ws/fallback' });

    expect(
      resolveNewSessionWorkspace({
        contextSessionId: 'session-missing',
        fallbackWorkspacePath: '/ws/fallback',
      }),
    ).toEqual({ workspacePath: '/ws/fallback' });
  });

  it('无上下文时直接回落全局选中值', () => {
    expect(
      resolveNewSessionWorkspace({
        contextSessionId: null,
        fallbackWorkspacePath: '/ws/fallback',
      }),
    ).toEqual({ workspacePath: '/ws/fallback' });

    expect(resolveNewSessionWorkspace({ fallbackWorkspacePath: '  ' })).toEqual({
      workspacePath: null,
    });
  });
});

/**
 * 回归锁定：工作区身份是「路径 + SSH 连接」二元组，任何一条解析分支漏掉连接
 * 都会让远端工作区的新会话以裸路径落库，UI 上表现为「SSH 绑定提示消失、
 * 路径被当成本地目录」。
 */
describe('resolveNewSessionWorkspace — SSH 连接维度不得丢失', () => {
  it('显式路径带远端连接时成对返回（工作区分组「+」入口）', () => {
    expect(
      resolveNewSessionWorkspace({
        explicitWorkspacePath: '/remote/repo',
        explicitSshConnectionId: 'ssh-a',
      }),
    ).toEqual({ workspacePath: '/remote/repo', sshConnectionId: 'ssh-a' });
  });

  it('显式路径带本地连接时返回 null，避免残留上一轮的远端绑定', () => {
    expect(
      resolveNewSessionWorkspace({
        explicitWorkspacePath: '/local/repo',
        explicitSshConnectionId: null,
      }),
    ).toEqual({ workspacePath: '/local/repo', sshConnectionId: null });
  });

  it('显式路径未提供连接时仍是 undefined（保持「不改动草稿绑定」的既有语义）', () => {
    expect(resolveNewSessionWorkspace({ explicitWorkspacePath: '/repo/a' })).toEqual({
      workspacePath: '/repo/a',
      sshConnectionId: undefined,
    });
  });

  it('显式路径优先于上下文：远端分组入口不会被上下文会话的连接覆盖', () => {
    expect(
      resolveNewSessionWorkspace({
        explicitWorkspacePath: '/remote/repo',
        explicitSshConnectionId: 'ssh-a',
        contextSessionId: 'session-a',
        activeSessionWorkspace: {
          sessionId: 'session-a',
          path: '/local/other',
          sshConnectionId: null,
        },
        fallbackWorkspacePath: '/ws/fallback',
      }),
    ).toEqual({ workspacePath: '/remote/repo', sshConnectionId: 'ssh-a' });
  });

  it('全局兜底带远端连接时成对返回（远端工作区里点无参「新建会话」）', () => {
    expect(
      resolveNewSessionWorkspace({
        contextSessionId: null,
        fallbackWorkspacePath: '/remote/repo',
        fallbackSshConnectionId: 'ssh-a',
      }),
    ).toEqual({ workspacePath: '/remote/repo', sshConnectionId: 'ssh-a' });
  });

  it('上下文不可解析时兜底仍保留远端连接', () => {
    expect(
      resolveNewSessionWorkspace({
        contextSessionId: 'session-missing',
        sessions: [makeSession('session-other', { workingDirectory: '/ws/other' })],
        fallbackWorkspacePath: '/remote/repo',
        fallbackSshConnectionId: 'ssh-a',
      }),
    ).toEqual({ workspacePath: '/remote/repo', sshConnectionId: 'ssh-a' });
  });

  it('全局兜底未提供连接时保持 undefined', () => {
    expect(resolveNewSessionWorkspace({ fallbackWorkspacePath: '/ws/fallback' })).toEqual({
      workspacePath: '/ws/fallback',
      sshConnectionId: undefined,
    });
  });

  it('显式 null 路径仍强制清空连接（不绑定工作区语义优先）', () => {
    expect(
      resolveNewSessionWorkspace({
        explicitWorkspacePath: null,
        explicitSshConnectionId: 'ssh-a',
        contextSessionId: 'session-a',
        activeSessionWorkspace: {
          sessionId: 'session-a',
          path: '/remote/repo',
          sshConnectionId: 'ssh-a',
        },
      }),
    ).toEqual({ workspacePath: null, sshConnectionId: null });
  });
});
