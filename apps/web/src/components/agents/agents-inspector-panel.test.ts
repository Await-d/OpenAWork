/**
 * `summarizeAgentPrompt`（检视栏「覆盖情况 → 提示词来源」与提示词预览的取值）单元覆盖。
 *
 * 这里锁的是一个容易回归的交互：内置 Agent 的 `systemPrompt` 是**当前生效值**——可能是
 * 用户覆盖，也可能就是系统默认（编辑器用它预填表单）。若按「非空即已自定义」展示，
 * 用户会以为默认提示词是自己改过的；契约要求改用 `promptMetadata.hasPromptOverride`。
 * 自定义 Agent 无该字段，仍按非空判定。
 */

import { describe, expect, it } from 'vitest';
import { summarizeAgentPrompt } from './agents-inspector-panel.js';
import type { ManagedAgentRecord } from '@openAwork/shared';

function agent(overrides: Partial<ManagedAgentRecord> & { id: string }): ManagedAgentRecord {
  return {
    label: overrides.id,
    description: '',
    aliases: [],
    enabled: true,
    origin: 'builtin',
    source: 'builtin',
    removable: false,
    resettable: true,
    hasOverrides: false,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

describe('summarizeAgentPrompt', () => {
  it('未选择 Agent 时给出占位文案且无提示词内容', () => {
    expect(summarizeAgentPrompt(null)).toEqual({
      overridden: false,
      sourceLabel: '未选择 Agent',
      effectiveText: '',
      defaultText: '',
      showsRestoreHint: false,
    });
  });

  it('内置 Agent 存在覆盖时，当前值与默认值分开给出，并提示恢复目标', () => {
    const summary = summarizeAgentPrompt(
      agent({
        id: 'build',
        systemPrompt: '自定义提示词',
        promptMetadata: { hasPromptOverride: true, defaultText: '默认提示词' },
      }),
    );

    expect(summary.overridden).toBe(true);
    expect(summary.sourceLabel).toBe('用户覆盖（6 字符）');
    expect(summary.effectiveText).toBe('自定义提示词');
    expect(summary.defaultText).toBe('默认提示词');
    expect(summary.showsRestoreHint).toBe(true);
  });

  it('内置 Agent 的 systemPrompt 只是当前默认值时，标记为系统默认且无恢复提示', () => {
    const summary = summarizeAgentPrompt(
      agent({
        id: 'build',
        systemPrompt: '默认提示词',
        promptMetadata: { hasPromptOverride: false, defaultText: '默认提示词' },
      }),
    );

    expect(summary.overridden).toBe(false);
    expect(summary.sourceLabel).toBe('系统默认（5 字符）');
    expect(summary.effectiveText).toBe('默认提示词');
    expect(summary.showsRestoreHint).toBe(false);
  });

  it('未覆盖且 systemPrompt 缺省时，用 promptMetadata.defaultText 兜底当前值', () => {
    const summary = summarizeAgentPrompt(
      agent({
        id: 'build',
        systemPrompt: undefined,
        promptMetadata: { hasPromptOverride: false, defaultText: '默认提示词' },
      }),
    );

    expect(summary.effectiveText).toBe('默认提示词');
    expect(summary.sourceLabel).toBe('系统默认（5 字符）');
  });

  it('内置 Agent 既无覆盖也无默认文本时显示「未设置」', () => {
    const summary = summarizeAgentPrompt(
      agent({ id: 'build', promptMetadata: { hasPromptOverride: false } }),
    );

    expect(summary.sourceLabel).toBe('未设置');
    expect(summary.effectiveText).toBe('');
    expect(summary.showsRestoreHint).toBe(false);
  });

  it('自定义 Agent 没有 promptMetadata，按非空判定且没有恢复目标', () => {
    const withText = summarizeAgentPrompt(
      agent({ id: 'mine', origin: 'custom', source: 'custom', systemPrompt: 'abc' }),
    );
    expect(withText).toEqual({
      overridden: true,
      sourceLabel: '用户覆盖（3 字符）',
      effectiveText: 'abc',
      defaultText: '',
      showsRestoreHint: false,
    });

    const empty = summarizeAgentPrompt(agent({ id: 'mine', origin: 'custom', source: 'custom' }));
    expect(empty.sourceLabel).toBe('未设置');
    expect(empty.overridden).toBe(false);
  });

  it('有 promptMetadata 时忽略 hasOverrides（后者含模型字段，不能用来判提示词）', () => {
    const summary = summarizeAgentPrompt(
      agent({
        id: 'build',
        hasOverrides: true,
        model: 'anthropic/claude-opus-4.1',
        systemPrompt: '默认提示词',
        promptMetadata: { hasPromptOverride: false, defaultText: '默认提示词' },
      }),
    );

    expect(summary.overridden).toBe(false);
    expect(summary.sourceLabel).toBe('系统默认（5 字符）');
  });
});
