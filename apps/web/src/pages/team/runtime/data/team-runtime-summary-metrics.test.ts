import { describe, expect, it } from 'vitest';
import {
  buildFooterLead,
  buildFooterStats,
  buildMetricCards,
} from './team-runtime-summary-metrics.js';

describe('buildMetricCards', () => {
  it('未选中会话时返回工作区级摘要', () => {
    expect(
      buildMetricCards({
        scoped: false,
        sharedSelected: false,
        membersCount: 4,
        teamCompletedTaskCount: 2,
        teamTaskCount: 5,
        teamMessageCount: 7,
        selectedSessionScopeSize: 0,
        participatingLayerCount: 0,
        runtimeTaskTotal: 0,
        completedRuntimeTasks: 0,
        failedRuntimeTasks: 0,
        runningRuntimeTasks: 0,
        pendingRuntimeTasks: 0,
        handoffTotal: 0,
        sharedSessionCount: 3,
        pendingReviewCount: 0,
        sharedCommentCount: 0,
        sharedViewerCount: 0,
        sharedRunning: false,
        sharedFailed: false,
      }),
    ).toEqual([
      { icon: 'members', label: '成员', value: '4' },
      { icon: 'tasks', label: '任务', value: '2/5' },
      { icon: 'conversation', label: '汇报', value: '7' },
    ]);
  });

  it('选中会话时返回当前会话子树摘要', () => {
    expect(
      buildMetricCards({
        scoped: true,
        sharedSelected: false,
        membersCount: 4,
        teamCompletedTaskCount: 2,
        teamTaskCount: 5,
        teamMessageCount: 7,
        selectedSessionScopeSize: 2,
        participatingLayerCount: 3,
        runtimeTaskTotal: 4,
        completedRuntimeTasks: 1,
        failedRuntimeTasks: 1,
        runningRuntimeTasks: 1,
        pendingRuntimeTasks: 1,
        handoffTotal: 6,
        sharedSessionCount: 3,
        pendingReviewCount: 0,
        sharedCommentCount: 0,
        sharedViewerCount: 0,
        sharedRunning: false,
        sharedFailed: false,
      }),
    ).toEqual([
      { icon: 'members', label: '成员', value: '3' },
      { icon: 'tasks', label: '任务', value: '1/4' },
      { icon: 'conversation', label: '汇报', value: '6' },
    ]);
  });

  it('选中共享会话时返回共享会话级摘要', () => {
    expect(
      buildMetricCards({
        scoped: false,
        sharedSelected: true,
        membersCount: 4,
        teamCompletedTaskCount: 2,
        teamTaskCount: 5,
        teamMessageCount: 7,
        selectedSessionScopeSize: 0,
        participatingLayerCount: 0,
        runtimeTaskTotal: 0,
        completedRuntimeTasks: 0,
        failedRuntimeTasks: 0,
        runningRuntimeTasks: 0,
        pendingRuntimeTasks: 0,
        handoffTotal: 0,
        sharedSessionCount: 3,
        pendingReviewCount: 2,
        sharedCommentCount: 5,
        sharedViewerCount: 2,
        sharedRunning: true,
        sharedFailed: false,
      }),
    ).toEqual([
      { icon: 'members', label: '在线', value: '2' },
      { icon: 'tasks', label: '待办', value: '2' },
      { icon: 'conversation', label: '评论', value: '5' },
    ]);
  });
});

describe('buildFooterStats', () => {
  it('未选中会话时返回工作区级 footer', () => {
    expect(
      buildFooterStats({
        scoped: false,
        sharedSelected: false,
        membersCount: 4,
        teamCompletedTaskCount: 0,
        teamTaskCount: 0,
        teamMessageCount: 0,
        selectedSessionScopeSize: 0,
        participatingLayerCount: 0,
        runtimeTaskTotal: 0,
        completedRuntimeTasks: 0,
        failedRuntimeTasks: 2,
        runningRuntimeTasks: 3,
        pendingRuntimeTasks: 4,
        handoffTotal: 0,
        sharedSessionCount: 5,
        pendingReviewCount: 1,
        sharedCommentCount: 0,
        sharedViewerCount: 0,
        sharedRunning: false,
        sharedFailed: false,
      }),
    ).toEqual([
      { label: '总', value: '5' },
      { label: '运行', value: '3' },
      { label: '等待', value: '5' },
      { label: '异常', value: '2' },
    ]);
  });

  it('选中会话时返回当前会话子树 footer', () => {
    expect(
      buildFooterStats({
        scoped: true,
        sharedSelected: false,
        membersCount: 4,
        teamCompletedTaskCount: 0,
        teamTaskCount: 0,
        teamMessageCount: 0,
        selectedSessionScopeSize: 2,
        participatingLayerCount: 3,
        runtimeTaskTotal: 4,
        completedRuntimeTasks: 1,
        failedRuntimeTasks: 1,
        runningRuntimeTasks: 2,
        pendingRuntimeTasks: 3,
        handoffTotal: 6,
        sharedSessionCount: 5,
        pendingReviewCount: 2,
        sharedCommentCount: 0,
        sharedViewerCount: 0,
        sharedRunning: false,
        sharedFailed: false,
      }),
    ).toEqual([
      { label: '总', value: '2' },
      { label: '运行', value: '2' },
      { label: '等待', value: '5' },
      { label: '异常', value: '1' },
    ]);
  });

  it('选中共享会话时返回共享会话级 footer', () => {
    expect(
      buildFooterStats({
        scoped: false,
        sharedSelected: true,
        membersCount: 4,
        teamCompletedTaskCount: 0,
        teamTaskCount: 0,
        teamMessageCount: 0,
        selectedSessionScopeSize: 0,
        participatingLayerCount: 0,
        runtimeTaskTotal: 0,
        completedRuntimeTasks: 0,
        failedRuntimeTasks: 0,
        runningRuntimeTasks: 0,
        pendingRuntimeTasks: 0,
        handoffTotal: 0,
        sharedSessionCount: 5,
        pendingReviewCount: 3,
        sharedCommentCount: 4,
        sharedViewerCount: 2,
        sharedRunning: true,
        sharedFailed: false,
      }),
    ).toEqual([
      { label: '总', value: '1' },
      { label: '运行', value: '1' },
      { label: '等待', value: '3' },
      { label: '异常', value: '0' },
    ]);
  });
});

describe('buildFooterLead', () => {
  it('工作区级展示活跃成员数', () => {
    expect(
      buildFooterLead({
        activeAgentCount: 2,
        totalMembers: 4,
        scoped: false,
        sharedSelected: false,
        sharedCommentCount: 0,
        sharedViewerCount: 0,
        participatingLayerCount: 0,
        selectedSessionScopeSize: 0,
      }),
    ).toBe('活跃 2 / 共 4');
  });

  it('选中会话时展示子树会话与参与层级', () => {
    expect(
      buildFooterLead({
        activeAgentCount: 2,
        totalMembers: 4,
        scoped: true,
        sharedSelected: false,
        sharedCommentCount: 0,
        sharedViewerCount: 0,
        participatingLayerCount: 3,
        selectedSessionScopeSize: 2,
      }),
    ).toBe('子树 2 / 层级 3');
  });

  it('选中共享会话时展示共享在线与评论摘要', () => {
    expect(
      buildFooterLead({
        activeAgentCount: 2,
        totalMembers: 4,
        scoped: false,
        sharedSelected: true,
        sharedCommentCount: 5,
        sharedViewerCount: 2,
        participatingLayerCount: 0,
        selectedSessionScopeSize: 0,
      }),
    ).toBe('在线 2 / 评论 5');
  });
});
