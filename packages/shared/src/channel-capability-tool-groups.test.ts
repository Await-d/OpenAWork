import { describe, expect, it } from 'vitest';

import {
  CHANNEL_CAPABILITY_TOOL_GROUP_CONTRACT,
  CHANNEL_CAPABILITY_TOOL_GROUP_KEYS,
  DEFAULT_CHANNEL_CAPABILITY_CONTEXT_TOOL_PROMPT_INJECTIONS,
  normalizeChannelCapabilityContextToolPromptInjections,
  resolveChannelCapabilityToolGroup,
} from './channel-capability-tool-groups.js';

describe('渠道能力分组规则（唯一事实来源）', () => {
  it('契约表逐条与实现一致（两端共用的防漂移黄金表）', () => {
    for (const entry of CHANNEL_CAPABILITY_TOOL_GROUP_CONTRACT) {
      expect(resolveChannelCapabilityToolGroup(entry.label), entry.label).toBe(entry.group);
    }
  });

  it('委派工具的规范名与历史别名归入同一分组（历史上真实漏过）', () => {
    expect(resolveChannelCapabilityToolGroup('subagent')).toBe('orchestration');
    expect(resolveChannelCapabilityToolGroup('task')).toBe('orchestration');
    expect(resolveChannelCapabilityToolGroup('Agent')).toBe('orchestration');
    expect(resolveChannelCapabilityToolGroup('subagent')).toBe(
      resolveChannelCapabilityToolGroup('task'),
    );
  });

  it('仓库族条目归入 repo（历史上前端曾漏 case，实际由前缀判断覆盖）', () => {
    expect(resolveChannelCapabilityToolGroup('repo_clone')).toBe('repo');
    expect(resolveChannelCapabilityToolGroup('repo_overview')).toBe('repo');
  });

  it('未登记的工具落 other', () => {
    expect(resolveChannelCapabilityToolGroup('mcp__lsp__diagnostics')).toBe('other');
    expect(resolveChannelCapabilityToolGroup('')).toBe('other');
  });

  it('默认值覆盖分组键全集，且不夹带多余键', () => {
    expect(Object.keys(DEFAULT_CHANNEL_CAPABILITY_CONTEXT_TOOL_PROMPT_INJECTIONS).sort()).toEqual(
      [...CHANNEL_CAPABILITY_TOOL_GROUP_KEYS].sort(),
    );
    expect(Object.values(DEFAULT_CHANNEL_CAPABILITY_CONTEXT_TOOL_PROMPT_INJECTIONS)).toEqual(
      CHANNEL_CAPABILITY_TOOL_GROUP_KEYS.map(() => true),
    );
  });

  it('归一化：缺省/非布尔值回落默认，显式布尔值保留', () => {
    const normalized = normalizeChannelCapabilityContextToolPromptInjections({
      web: false,
      orchestration: false,
    });
    expect(normalized).toEqual({
      ...DEFAULT_CHANNEL_CAPABILITY_CONTEXT_TOOL_PROMPT_INJECTIONS,
      web: false,
      orchestration: false,
    });

    expect(normalizeChannelCapabilityContextToolPromptInjections(undefined)).toEqual(
      DEFAULT_CHANNEL_CAPABILITY_CONTEXT_TOOL_PROMPT_INJECTIONS,
    );
    expect(normalizeChannelCapabilityContextToolPromptInjections(null)).toEqual(
      DEFAULT_CHANNEL_CAPABILITY_CONTEXT_TOOL_PROMPT_INJECTIONS,
    );
    // 非布尔值不穿透
    const coerced = normalizeChannelCapabilityContextToolPromptInjections({
      web: 'yes',
    } as unknown as Parameters<typeof normalizeChannelCapabilityContextToolPromptInjections>[0]);
    expect(coerced.web).toBe(true);
  });
});
