import { describe, expect, it } from 'vitest';
import {
  resolveTopSummaryAudience,
  resolveTopSummaryDescription,
  resolveTopSummaryStatus,
  resolveTopSummaryTitle,
} from './team-runtime-top-summary.js';

describe('resolveTopSummaryStatus', () => {
  it('共享会话暂停时优先返回已暂停', () => {
    expect(
      resolveTopSummaryStatus({
        hasPausedRuntimeSessions: false,
        selectedRuntimeSessionStateStatus: 'running',
        selectedSharedSessionStateStatus: 'paused',
      }),
    ).toBe('已暂停');
  });

  it('普通 runtime 会话 paused 标记为真时优先返回已暂停', () => {
    expect(
      resolveTopSummaryStatus({
        hasPausedRuntimeSessions: false,
        selectedRuntimeSessionPaused: true,
        selectedRuntimeSessionStateStatus: 'running',
        selectedSharedSessionStateStatus: null,
      }),
    ).toBe('已暂停');
  });

  it('普通 runtime 会话运行时，不被其他空闲会话误判为已暂停', () => {
    expect(
      resolveTopSummaryStatus({
        hasPausedRuntimeSessions: true,
        selectedRuntimeSessionPaused: false,
        selectedRuntimeSessionStateStatus: 'running',
        selectedSharedSessionStateStatus: null,
      }),
    ).toBe('运行中');
  });

  it('没有当前选中会话时，才回退到全局 idle 判断', () => {
    expect(
      resolveTopSummaryStatus({
        hasPausedRuntimeSessions: true,
        selectedRuntimeSessionStateStatus: null,
        selectedSharedSessionStateStatus: null,
      }),
    ).toBe('已暂停');
  });
});

describe('resolveTopSummaryTitle', () => {
  it('优先显示当前普通 runtime 会话标题', () => {
    expect(
      resolveTopSummaryTitle({
        activeWorkspaceName: '工作区 A',
        selectedRuntimeSessionTitle: 'PM2 实施会话',
        selectedSharedSessionTitle: '共享会话',
      }),
    ).toBe('PM2 实施会话');
  });

  it('没有 runtime 会话标题时回退到共享会话标题，再回退到工作区名', () => {
    expect(
      resolveTopSummaryTitle({
        activeWorkspaceName: '工作区 A',
        selectedSharedSessionTitle: '共享会话',
      }),
    ).toBe('共享会话');

    expect(
      resolveTopSummaryTitle({
        activeWorkspaceName: '工作区 A',
      }),
    ).toBe('工作区 A');
  });
});

describe('resolveTopSummaryAudience', () => {
  it('共享会话选中时使用 presence 和在线查看人数，而不是工作区成员数', () => {
    expect(
      resolveTopSummaryAudience({
        sharedSelected: true,
        sharedPresenceCount: 3,
        sharedActiveViewerCount: 2,
        workspaceMemberCount: 8,
        workspaceOnlineCount: 5,
      }),
    ).toEqual({
      memberCount: '3 成员',
      onlineCount: '2 在线',
    });
  });

  it('共享详情尚未加载时，不再回退到工作区人数', () => {
    expect(
      resolveTopSummaryAudience({
        sharedSelected: true,
        sharedPresenceCount: null,
        sharedActiveViewerCount: null,
        workspaceMemberCount: 8,
        workspaceOnlineCount: 5,
      }),
    ).toEqual({
      memberCount: '0 成员',
      onlineCount: '0 在线',
    });
  });

  it('普通工作区态继续展示工作区成员与在线人数', () => {
    expect(
      resolveTopSummaryAudience({
        sharedSelected: false,
        sharedPresenceCount: 3,
        sharedActiveViewerCount: 2,
        workspaceMemberCount: 8,
        workspaceOnlineCount: 5,
      }),
    ).toEqual({
      memberCount: '8 成员',
      onlineCount: '5 在线',
    });
  });
});

describe('resolveTopSummaryDescription', () => {
  it('优先描述当前 runtime 会话', () => {
    expect(
      resolveTopSummaryDescription({
        activeWorkspaceName: '工作区 A',
        activeWorkspaceWorkingRoot: '/workspace/a',
        selectedRuntimeSessionTitle: 'PM2 实施会话',
        selectedRuntimeSessionStateStatus: 'running',
      }),
    ).toBe('当前会话：PM2 实施会话 · 运行中');
  });

  it('没有 runtime 会话时回退到当前共享会话', () => {
    expect(
      resolveTopSummaryDescription({
        selectedSharedSessionTitle: '共享会话 B',
        selectedSharedSessionStateStatus: 'paused',
        selectedSharedWorkspaceLabel: '/workspace/shared',
      }),
    ).toBe('当前共享：共享会话 B · 已暂停 · /workspace/shared');
  });

  it('都没有时回退到工作区概览文案', () => {
    expect(
      resolveTopSummaryDescription({
        activeWorkspaceName: '工作区 A',
        activeWorkspaceWorkingRoot: '/workspace/a',
        workspaceOverviewLead: '已切换到 TeamWorkspaceSnapshot 主读链',
      }),
    ).toBe('工作区 A · /workspace/a · 已切换到 TeamWorkspaceSnapshot 主读链');
  });
});
