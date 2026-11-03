import { describe, expect, it } from 'vitest';

import {
  buildChannelCapabilityToolGroupCounts,
  classifyCapabilityToolGroup,
} from './channel-capability-tool-groups.js';

/**
 * G-08（261102 修复规范名 subagent 静默漏点）：前端第二份分组实现
 * （`classifyCapabilityToolGroup`，与后端 `resolveChannelCapabilityToolGroup` 同名文件不同实现）
 * 的 `orchestration` 分组只登记历史别名 `task` 与呈报名 `Agent`，缺规范名 `subagent`
 * → 落 `default: 'other'`，与后端分组结果不一致。
 *
 * 本用例以 `'subagent'` 为入参（此前无任何覆盖）。修复前 `classifyCapabilityToolGroup('subagent')`
 * 返回 `'other'`，`toBe('orchestration')` 必失败。
 */
describe('G-08：前端 classifyCapabilityToolGroup 覆盖规范名 subagent', () => {
  it('subagent 与 task 归入同一 orchestration 分组', () => {
    expect(classifyCapabilityToolGroup('task')).toBe('orchestration');
    expect(classifyCapabilityToolGroup('subagent')).toBe('orchestration');
    expect(classifyCapabilityToolGroup('subagent')).toBe(classifyCapabilityToolGroup('task'));
  });

  it('委派相关工具全部落在 orchestration（含兼容呈报名）', () => {
    for (const name of ['subagent', 'task', 'Agent', 'Skill', 'batch']) {
      expect(classifyCapabilityToolGroup(name), name).toBe('orchestration');
    }
  });

  it('未登记工具仍落 other（防止把 default 分支改坏）', () => {
    expect(classifyCapabilityToolGroup('nonexistent_tool')).toBe('other');
  });

  /**
   * 前后端两份分组实现的对齐锁定（G-08 扩展）：
   * `repo_clone` / `repo_overview` 在前端由**前缀分支**（`label === 'repo_clone' | 'repo_overview'`）
   * 归入 `repo`，与后端 switch 的 `case` 语义等价 —— 实测两者一致，无需在 switch 里重复登记。
   */
  it('repo_clone / repo_overview 归入 repo（与后端一致）', () => {
    expect(classifyCapabilityToolGroup('repo_clone')).toBe('repo');
    expect(classifyCapabilityToolGroup('repo_overview')).toBe('repo');
  });

  it('分组计数把 subagent 统计进 orchestration 而非 other', () => {
    const counts = buildChannelCapabilityToolGroupCounts([
      { label: 'subagent', kind: 'tool', callable: true },
      { label: 'task', kind: 'tool', callable: true },
    ] as never);
    expect(counts.orchestration).toBe(2);
    expect(counts.other).toBe(0);
  });
});

/**
 * 追加（261102 渠道能力分组规则去重）：前端不再持有自己的分组实现，
 * `classifyCapabilityToolGroup` 是 `@openAwork/shared` 实现的别名。
 * 以下断言把「前后端同一实现」锁死，杜绝历史上那类两侧各写一份、只在一侧登记新名字的漂移。
 */
describe('前端分组规则来自 @openAwork/shared（唯一事实来源）', () => {
  it('共享契约黄金表逐条与前端结果一致（含历史漂移条目）', async () => {
    const shared = await import('@openAwork/shared');
    for (const entry of shared.CHANNEL_CAPABILITY_TOOL_GROUP_CONTRACT) {
      expect(classifyCapabilityToolGroup(entry.label), entry.label).toBe(entry.group);
    }
  });

  it('前端别名与后端解析是同一个函数对象', async () => {
    const shared = await import('@openAwork/shared');
    expect(classifyCapabilityToolGroup).toBe(shared.resolveChannelCapabilityToolGroup);
  });
});
