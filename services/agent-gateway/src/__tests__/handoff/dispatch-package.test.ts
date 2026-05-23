/**
 * dispatch-package 分类与派发画像测试
 */

import { describe, expect, it } from 'vitest';
import { DEFAULT_FIXED_TEAM_MEMBER_SLOTS } from '@openAwork/shared';
import {
  buildDispatchPackages,
  buildTaskProfilePromptFragment,
  dispatchPackageSchema,
  inferTaskProfile,
  parseTaskLine,
  resolveAssignedMember,
} from '../../handoff/capability/dispatch-package.js';

describe('parseTaskLine', () => {
  it('能解析显式 KIND/SURFACE 标记并从标题中移除标记', () => {
    const task = parseTaskLine(
      '- [ ] T008 [P] [US2] [KIND:refactor] [SURFACE:workflow] 拆分 handoff 状态机',
    );

    expect(task?.taskId).toBe('T008');
    expect(task?.parallel).toBe(true);
    expect(task?.story).toBe('US2');
    expect(task?.explicitProfile).toEqual({ kind: 'refactor', surface: 'workflow' });
    expect(task?.title).toBe('拆分 handoff 状态机');
  });

  it('旧格式任务没有 explicitProfile，保留 fallback 推断空间', () => {
    const task = parseTaskLine('- [ ] T009 [US1] 修复后端 API 错误处理');

    expect(task?.explicitProfile).toBeNull();
    expect(task?.title).toBe('修复后端 API 错误处理');
  });
});

describe('inferTaskProfile', () => {
  it('能从任务标题推断 fix + ui', () => {
    const profile = inferTaskProfile({
      title: '修复前端登录页面样式问题',
      context: '需要兼容移动端响应式',
    });

    expect(profile.kind).toBe('fix');
    expect(profile.surface).toBe('ui');
  });

  it('能从上下文推断 review + backend', () => {
    const profile = inferTaskProfile({
      title: '代码评审：检查实现',
      context: '后端 API 路由与鉴权逻辑，重点检查 review 结果',
    });

    expect(profile.kind).toBe('review');
    expect(profile.surface).toBe('backend');
  });
});

describe('buildDispatchPackages', () => {
  it('会为 reviewer 任务补 taskProfile 且生成 reviewer 角色', () => {
    const packages = buildDispatchPackages({
      tasks: [
        {
          taskId: 'T001',
          parallel: false,
          story: 'US1',
          explicitProfile: null,
          title: '修复前端登录页面样式问题',
          priority: 'medium',
        },
        {
          taskId: 'T002',
          parallel: false,
          story: 'US1',
          explicitProfile: null,
          title: '代码评审：检查后端鉴权实现',
          priority: 'medium',
        },
      ],
      artifactRefs: { specId: 'spec-1', planId: 'plan-1', tasksId: 'tasks-1' },
      context: '前端页面 + 后端 API，review 关注实现正确性',
    });

    expect(dispatchPackageSchema.parse(packages[0]!)).toBeTruthy();
    expect(packages[0]!.taskProfile.kind).toBe('fix');
    expect(packages[0]!.taskProfile.surface).toBe('ui');

    expect(packages[1]!.role).toBe('reviewer');
    expect(packages[1]!.taskProfile.kind).toBe('review');
    expect(packages[1]!.taskProfile.surface).toBe('backend');
    expect(packages[1]!.dependsOn).toContain('T001');
  });

  it('优先使用 tasks.md 显式画像，而不是上下文自动推断', () => {
    const explicitTask = parseTaskLine(
      '- [ ] T010 [KIND:docs] [SURFACE:cross-cutting] 编写后端 API 使用说明',
    );
    expect(explicitTask).not.toBeNull();

    const packages = buildDispatchPackages({
      tasks: [explicitTask!],
      artifactRefs: { tasksId: 'tasks-1' },
      context: '后端 API 路由',
    });

    expect(packages[0]!.taskProfile).toEqual({ kind: 'docs', surface: 'cross-cutting' });
    expect(packages[0]!.role).toBe('executor');
    expect(packages[0]!.goal).toBe('编写后端 API 使用说明');
  });

  it('会按 workspace roster 给 dispatch package 分配具体成员', () => {
    const packages = buildDispatchPackages({
      tasks: [
        {
          taskId: 'T011',
          parallel: false,
          story: null,
          explicitProfile: { kind: 'build', surface: 'ui' },
          title: '实现前端设置页面',
          priority: 'medium',
        },
      ],
      artifactRefs: { tasksId: 'tasks-1' },
      assignedMemberRoster: DEFAULT_FIXED_TEAM_MEMBER_SLOTS,
      context: 'Team 默认 roster 派发',
    });

    expect(dispatchPackageSchema.parse(packages[0]!)).toBeTruthy();
    expect(packages[0]!.assignedMember?.id).toBe('executor-frontend');
    expect(packages[0]!.assignedMember?.specialty).toBe('frontend');
  });
});

describe('resolveAssignedMember', () => {
  it('会把部署/发布关键词优先分配给 DevOps 成员', () => {
    const member = resolveAssignedMember({
      goal: '配置自动部署流水线并发布预览版',
      profile: { kind: 'build', surface: 'cross-cutting' },
      role: 'executor',
      roster: DEFAULT_FIXED_TEAM_MEMBER_SLOTS,
    });

    expect(member?.id).toBe('executor-devops');
    expect(member?.specialty).toBe('devops');
  });

  it('review 任务只从 reviewer 层选择成员', () => {
    const member = resolveAssignedMember({
      goal: '审查后端鉴权与 API 安全',
      profile: { kind: 'review', surface: 'backend' },
      role: 'reviewer',
      roster: DEFAULT_FIXED_TEAM_MEMBER_SLOTS,
    });

    expect(member?.layer).toBe('reviewer');
    expect(member?.specialty).toBe('security');
  });

  it('质量验证任务会优先命中 qa/quality 成员', () => {
    const member = resolveAssignedMember({
      goal: '补测试并验证回归结果',
      profile: { kind: 'verify', surface: 'integration' },
      role: 'reviewer',
      roster: DEFAULT_FIXED_TEAM_MEMBER_SLOTS,
    });

    expect(member?.layer).toBe('reviewer');
    expect(['qa', 'quality']).toContain(member?.specialty);
  });
});

describe('buildTaskProfilePromptFragment', () => {
  it('会生成可注入 prompt 的任务画像片段', () => {
    const text = buildTaskProfilePromptFragment({ kind: 'verify', surface: 'integration' });
    expect(text).toContain('任务画像');
    expect(text).toContain('验证/测试任务');
    expect(text).toContain('集成关注');
  });
});
