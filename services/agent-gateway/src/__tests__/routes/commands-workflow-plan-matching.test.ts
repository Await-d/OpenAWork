import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { __testing } from '../../routes/commands.js';

const BASE_PLAN = {
  completed: 0,
  filePath: '/workspace/.agentdocs/workflow/260706-lazycodex-native-workflow.md',
  modifiedAt: 1,
  pendingItems: ['T1 计划发现与目录兼容'],
  relativePath: '.agentdocs/workflow/260706-lazycodex-native-workflow.md',
  title: 'LazyCodex/OmO 原生化接入工作流',
  total: 8,
};

describe('commands workflow plan matching', () => {
  it('按文件名 slug 匹配中文标题的工作流计划', () => {
    const match = __testing.findMatchingWorkflowPlan([BASE_PLAN], 'lazycodex-native-workflow');

    expect(match?.relativePath).toBe(BASE_PLAN.relativePath);
  });

  it('优先使用精确匹配，避免短关键词命中较新的非目标计划', () => {
    const newerPartialMatch = {
      ...BASE_PLAN,
      filePath: '/workspace/.agentdocs/workflow/260707-lazycodex-native-workflow-followup.md',
      modifiedAt: 2,
      relativePath: '.agentdocs/workflow/260707-lazycodex-native-workflow-followup.md',
      title: 'LazyCodex 后续整理',
    };

    const match = __testing.findMatchingWorkflowPlan(
      [newerPartialMatch, BASE_PLAN],
      '260706-lazycodex-native-workflow',
    );

    expect(match?.relativePath).toBe(BASE_PLAN.relativePath);
  });

  it('/start-work 计划匹配兼容 .omo/plans 目录', async () => {
    const workspaceRoot = await mkdtemp(join(tmpdir(), 'openawork-omo-plan-'));
    try {
      const planDir = join(workspaceRoot, '.omo', 'plans');
      await mkdir(planDir, { recursive: true });
      await writeFile(
        join(planDir, 'lazycodex-native-workflow.md'),
        ['# LazyCodex/OmO 原生化接入工作流', '', '- [ ] T1 计划发现兼容'].join('\n'),
        'utf-8',
      );

      const match = await __testing.findLatestWorkflowPlan(
        workspaceRoot,
        'lazycodex-native-workflow',
      );

      expect(match?.relativePath).toBe('.omo/plans/lazycodex-native-workflow.md');
    } finally {
      await rm(workspaceRoot, { force: true, recursive: true });
    }
  });
});
