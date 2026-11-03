import { describe, expect, it } from 'vitest';

import {
  DEFAULT_CHANNEL_CAPABILITY_CONTEXT_TOOL_PROMPT_INJECTIONS,
  normalizeChannelCapabilityContextToolPromptInjections,
  resolveChannelCapabilityToolGroup,
} from '../../channels/channel-capability-tool-groups.js';

/**
 * G2（261102 修复规范名 subagent 静默漏点）：能力目录 / 渠道提示词注入按工具名分组，
 * `orchestration` 分组注册了历史别名 `task` 与呈报名 `Agent`，却**缺规范名 `subagent`**
 * → 落入 `default: 'other'`，归类错误。
 *
 * 本用例以 **`'subagent'`** 为入参（此前无任何覆盖），并断言其与 `task` / `Agent` / `Skill`
 * 同组，从而卡住该漏点（修复前 `subagent` 会返回 `'other'`，用例失败）。
 */
describe('G2：resolveChannelCapabilityToolGroup 覆盖规范名 subagent', () => {
  it('subagent 与 task 归入同一 orchestration 分组', () => {
    expect(resolveChannelCapabilityToolGroup('task')).toBe('orchestration');
    expect(resolveChannelCapabilityToolGroup('subagent')).toBe('orchestration');
    expect(resolveChannelCapabilityToolGroup('subagent')).toBe(
      resolveChannelCapabilityToolGroup('task'),
    );
  });

  it('委派相关工具全部落在 orchestration（含兼容呈报名与编排工具）', () => {
    for (const name of [
      'subagent',
      'task',
      'Agent',
      'Skill',
      'batch',
      'task_create',
      'task_update',
      'AskUserQuestion',
    ]) {
      expect(resolveChannelCapabilityToolGroup(name), name).toBe('orchestration');
    }
  });

  it('orchestration 组内的委派名字彼此等价（task / subagent / Agent 同组）', () => {
    const group = resolveChannelCapabilityToolGroup('subagent');
    for (const name of ['task', 'subagent', 'Agent', 'Skill', 'batch']) {
      expect(resolveChannelCapabilityToolGroup(name), name).toBe(group);
    }
    // 修复前 subagent 会落 'other'，因此 group 应为 orchestration 而非 other。
    expect(group).not.toBe('other');
  });

  it('未登记工具仍落 other（防止把 default 分支改坏）', () => {
    expect(resolveChannelCapabilityToolGroup('nonexistent_tool')).toBe('other');
  });
});

describe('channel capability context tool prompt injections 归一化', () => {
  it('缺省时回退默认（orchestration 默认开启）', () => {
    const normalized = normalizeChannelCapabilityContextToolPromptInjections(undefined);
    expect(normalized.orchestration).toBe(
      DEFAULT_CHANNEL_CAPABILITY_CONTEXT_TOOL_PROMPT_INJECTIONS.orchestration,
    );
  });

  it('显式 false 覆盖默认', () => {
    const normalized = normalizeChannelCapabilityContextToolPromptInjections({
      orchestration: false,
    });
    expect(normalized.orchestration).toBe(false);
  });
});

/**
 * 追加（261102 渠道能力分组规则去重）：规则已上移至 `@openAwork/shared`，本包文件成为再导出垫片。
 * 这两条断言保证「只有一份实现」——若有人日后在本包内重新手写副本，契约表与同一性断言会立刻失败。
 */
describe('分组规则来自 @openAwork/shared（唯一事实来源）', () => {
  it('共享契约黄金表逐条与 gateway 侧结果一致', async () => {
    const shared = await import('@openAwork/shared');
    for (const entry of shared.CHANNEL_CAPABILITY_TOOL_GROUP_CONTRACT) {
      expect(resolveChannelCapabilityToolGroup(entry.label), entry.label).toBe(entry.group);
    }
  });

  it('gateway 再导出的就是共享实现本体（同一函数对象）', async () => {
    const shared = await import('@openAwork/shared');
    expect(resolveChannelCapabilityToolGroup).toBe(shared.resolveChannelCapabilityToolGroup);
    expect(normalizeChannelCapabilityContextToolPromptInjections).toBe(
      shared.normalizeChannelCapabilityContextToolPromptInjections,
    );
    expect(DEFAULT_CHANNEL_CAPABILITY_CONTEXT_TOOL_PROMPT_INJECTIONS).toBe(
      shared.DEFAULT_CHANNEL_CAPABILITY_CONTEXT_TOOL_PROMPT_INJECTIONS,
    );
  });
});
