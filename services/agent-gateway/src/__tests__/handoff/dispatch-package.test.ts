/**
 * dispatch-package 分类与派发画像测试
 */

import { describe, expect, it } from 'vitest';
import { DEFAULT_FIXED_TEAM_MEMBER_SLOTS, type FixedTeamMemberSlot } from '@openAwork/shared';
import {
  buildDispatchPackages,
  buildTaskProfilePromptFragment,
  dispatchPackageSchema,
  extractComparablePathsFromText,
  inferTaskProfile,
  parseAllTasks,
  parseTaskLine,
  resolveAssignedMember,
  validateParsedTasks,
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
          title: '[apps/web/src/pages/login.tsx] 修复前端登录页面样式问题 - 页面样式恢复正常',
          priority: 'medium',
          fileEntries: [],
          ownedPaths: ['apps/web/src/pages/login.tsx'],
        },
        {
          taskId: 'T002',
          parallel: false,
          story: 'US1',
          explicitProfile: null,
          title: '[services/agent-gateway/src/routes/auth.ts] 代码评审检查后端鉴权实现 - 输出审查结论',
          priority: 'medium',
          fileEntries: [],
          ownedPaths: ['services/agent-gateway/src/routes/auth.ts'],
        },
      ],
      artifactRefs: { specId: 'spec-1', planId: 'plan-1', tasksId: 'tasks-1' },
      context: '前端页面 + 后端 API，review 关注实现正确性',
    });

    expect(dispatchPackageSchema.parse(packages[0]!)).toBeTruthy();
    expect(packages[0]!.taskProfile.kind).toBe('fix');
    expect(packages[0]!.taskProfile.surface).toBe('ui');
    expect(packages[0]!.ownedPaths).toEqual(['apps/web/src/pages/login.tsx']);

    expect(packages[1]!.role).toBe('reviewer');
    expect(packages[1]!.taskProfile.kind).toBe('review');
    expect(packages[1]!.taskProfile.surface).toBe('backend');
    expect(packages[1]!.dependsOn).toContain('T001');
    expect(packages[1]!.ownedPaths).toEqual(['services/agent-gateway/src/routes/auth.ts']);
  });

  it('优先使用 tasks.md 显式画像，而不是上下文自动推断', () => {
    const explicitTask = parseTaskLine(
      '- [ ] T010 [KIND:docs] [SURFACE:cross-cutting] 编写后端 API 使用说明',
    );
    expect(explicitTask).not.toBeNull();

    const packages = buildDispatchPackages({
      tasks: [
        {
          ...explicitTask!,
          title: '[docs/api/auth.md] 编写后端 API 使用说明 - 提供接入文档',
          ownedPaths: ['docs/api/auth.md'],
        },
      ],
      artifactRefs: { tasksId: 'tasks-1' },
      context: '后端 API 路由',
    });

    expect(packages[0]!.taskProfile).toEqual({ kind: 'docs', surface: 'cross-cutting' });
    expect(packages[0]!.role).toBe('executor');
    expect(packages[0]!.goal).toBe('[docs/api/auth.md] 编写后端 API 使用说明 - 提供接入文档');
  });

  it('会按 workspace roster 给 dispatch package 分配具体成员', () => {
    const packages = buildDispatchPackages({
      tasks: [
        {
          taskId: 'T011',
          parallel: false,
          story: null,
          explicitProfile: { kind: 'build', surface: 'ui' },
          title: '[apps/web/src/pages/settings.tsx] 实现前端设置页面 - 可展示并编辑设置项',
          priority: 'medium',
          fileEntries: [],
          ownedPaths: ['apps/web/src/pages/settings.tsx'],
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

  it('maxPackages 上限会截断任务、只派发文档顺序的前 N 个（防 fan-out 失控）', () => {
    const tasks = Array.from({ length: 10 }, (_, i) => ({
      taskId: `T${String(i + 1).padStart(3, '0')}`,
      parallel: true,
      story: null,
      explicitProfile: { kind: 'build' as const, surface: 'backend' as const },
      title: `[services/agent-gateway/src/modules/task-${i + 1}.ts] 实现任务 ${i + 1} - 交付对应能力`,
      priority: 'medium' as const,
      fileEntries: [],
      ownedPaths: [`services/agent-gateway/src/modules/task-${i + 1}.ts`],
    }));

    const capped = buildDispatchPackages({
      tasks,
      artifactRefs: { tasksId: 'tasks-1' },
      context: '大量任务',
      maxPackages: 3,
    });
    expect(capped).toHaveLength(3);
    expect(capped.map((p) => p.taskMarkers.taskId)).toEqual(['T001', 'T002', 'T003']);

    // maxPackages <= 0 视为关闭上限：全部派发。
    const uncapped = buildDispatchPackages({
      tasks,
      artifactRefs: { tasksId: 'tasks-1' },
      context: '大量任务',
      maxPackages: 0,
    });
    expect(uncapped).toHaveLength(10);

    // 不传 maxPackages 时也不截断。
    const noCap = buildDispatchPackages({
      tasks,
      artifactRefs: { tasksId: 'tasks-1' },
      context: '大量任务',
    });
    expect(noCap).toHaveLength(10);
  });

  it('会拒绝未命名或无路径的任务标题', () => {
    const issues = validateParsedTasks([
      {
        taskId: 'T999',
        parallel: false,
        story: 'US1',
        explicitProfile: null,
        title: '未命名任务',
        priority: 'medium',
        fileEntries: [],
        ownedPaths: [],
      },
    ]);

    expect(issues.length).toBeGreaterThan(0);
    expect(issues.join('；')).toContain('未命名任务');
  });
});

describe('extractComparablePathsFromText', () => {
  it('能从标题和错误文本中提取结构化路径', () => {
    expect(
      extractComparablePathsFromText(
        '[apps/web/src/pages/login.tsx] 修复登录页 - 处理 apps/web/src/components/login-form.tsx 的交互问题',
      ),
    ).toEqual([
      'apps/web/src/pages/login.tsx',
      'apps/web/src/components/login-form.tsx',
    ]);
  });

  it('支持方括号内的多文件逗号列举', () => {
    expect(
      extractComparablePathsFromText(
        '[apps/web/src/pages/login.tsx, apps/web/src/pages/login.test.tsx] 实现登录页面 - 页面可提交且测试覆盖主流程',
      ),
    ).toEqual([
      'apps/web/src/pages/login.tsx',
      'apps/web/src/pages/login.test.tsx',
    ]);
  });

  it('parseAllTasks 会把任务块中的 Create/Modify/Test 文件清单并入 ownedPaths', () => {
    const tasks = parseAllTasks(`## Phase 1

- [ ] T001 [KIND:build] [SURFACE:ui] [apps/web/src/pages/login.tsx] 实现登录页面 - 页面可提交
**文件**：
- Modify: \`apps/web/src/pages/login.tsx\`
- Test: \`apps/web/src/pages/login.test.tsx\`
- Modify: \`apps/web/src/components/login-form.tsx\`
`);

    expect(tasks).toHaveLength(1);
    expect(tasks[0]?.ownedPaths).toEqual([
      'apps/web/src/pages/login.tsx',
      'apps/web/src/pages/login.test.tsx',
      'apps/web/src/components/login-form.tsx',
    ]);
  });

  it('不会把 executor/reviewer 这类带斜杠短语误判成路径', () => {
    expect(
      extractComparablePathsFromText(
        'PM2 将重新派发 executor/reviewer 任务，并等待 pm1/pm2 链路重新收口',
      ),
    ).toEqual([]);
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

  it('自定义角色的 routingKeywords 命中任务时被动态优先派发', () => {
    const customPerf: FixedTeamMemberSlot = {
      id: 'executor-custom-perf',
      layer: 'executor',
      specialty: 'custom',
      displayName: '性能优化专家',
      personaKey: 'executor:custom:perf',
      toolsets: ['read', 'write', 'shell', 'lsp', 'test'],
      required: false,
      custom: true,
      systemPrompt: '你是性能优化专家。',
      routingKeywords: ['性能', '渲染瓶颈', 'profiling'],
    };
    const roster: FixedTeamMemberSlot[] = [...DEFAULT_FIXED_TEAM_MEMBER_SLOTS, customPerf];

    // 任务命中自定义角色关键词「性能 / 渲染瓶颈」→ 应优先派给它，而非默认前端/后端。
    const hit = resolveAssignedMember({
      goal: '排查首页渲染瓶颈并做性能优化',
      profile: { kind: 'build', surface: 'ui' },
      role: 'executor',
      roster,
    });
    expect(hit?.personaKey).toBe('executor:custom:perf');

    // 不命中关键词的普通任务不应被该自定义角色截胡（仍走预置 specialty 匹配）。
    const miss = resolveAssignedMember({
      goal: '实现后端登录接口',
      profile: { kind: 'build', surface: 'backend' },
      role: 'executor',
      roster,
    });
    expect(miss?.specialty).toBe('backend');
  });

  it('同分时 dispatchPriority=high 的成员优先', () => {
    const lowFe: FixedTeamMemberSlot = {
      id: 'executor-custom-fe-low',
      layer: 'executor',
      specialty: 'custom',
      displayName: '前端 A（低优先）',
      personaKey: 'executor:custom:fe-low',
      toolsets: ['read', 'write'],
      required: false,
      custom: true,
      routingKeywords: ['表单'],
      dispatchPriority: 'low',
    };
    const highFe: FixedTeamMemberSlot = {
      id: 'executor-custom-fe-high',
      layer: 'executor',
      specialty: 'custom',
      displayName: '前端 B（高优先）',
      personaKey: 'executor:custom:fe-high',
      toolsets: ['read', 'write'],
      required: false,
      custom: true,
      routingKeywords: ['表单'],
      dispatchPriority: 'high',
    };
    // 两者关键词命中数相同（同分）→ 应选 dispatchPriority=high 的。
    const member = resolveAssignedMember({
      goal: '实现一个表单',
      profile: { kind: 'build', surface: 'ui' },
      role: 'executor',
      roster: [lowFe, highFe],
    });
    expect(member?.personaKey).toBe('executor:custom:fe-high');
  });

  it('过短的路由关键词（<2 字符）被忽略，不会截胡所有任务', () => {
    const greedy: FixedTeamMemberSlot = {
      id: 'executor-custom-greedy',
      layer: 'executor',
      specialty: 'custom',
      displayName: '贪婪角色',
      personaKey: 'executor:custom:greedy',
      toolsets: ['read', 'write'],
      required: false,
      custom: true,
      routingKeywords: ['a', '的', 'e'], // 全是单字符，应被忽略
    };
    const roster: FixedTeamMemberSlot[] = [...DEFAULT_FIXED_TEAM_MEMBER_SLOTS, greedy];
    // 一个后端任务：贪婪角色的单字符关键词不应让它击败后端专长成员。
    const member = resolveAssignedMember({
      goal: '实现后端登录接口',
      profile: { kind: 'build', surface: 'backend' },
      role: 'executor',
      roster,
    });
    expect(member?.specialty).toBe('backend');
    expect(member?.personaKey).not.toBe('executor:custom:greedy');
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
