/**
 * `agents-editor-state` 的纯函数覆盖：表单状态 ↔ 记录的双向转换、别名解析、
 * 角色 / 说明的本地化展示。
 *
 * 这些函数原先混在 `AgentsPageSections.tsx` 里（无覆盖）。转换错了不会编译报错，
 * 只会表现为「打开编辑器时字段静默变空」或「保存后别名丢失」，所以这里逐字段固定。
 */

import { describe, expect, it } from 'vitest';
import {
  emptyEditorState,
  formatCanonicalRoleZh,
  localizeAgentDescription,
  parseAliases,
  toEditorState,
} from './agents-editor-state.js';
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

describe('emptyEditorState', () => {
  it('默认启用且所有字段为空', () => {
    expect(emptyEditorState()).toEqual({
      label: '',
      description: '',
      aliasesText: '',
      coreRole: '',
      preset: '',
      model: '',
      variant: '',
      fallbackModelsText: '',
      systemPrompt: '',
      note: '',
      enabled: true,
    });
  });
});

describe('toEditorState', () => {
  it('null 与空表单等价', () => {
    expect(toEditorState(null)).toEqual(emptyEditorState());
  });

  it('数组字段转成逗号分隔文本，缺失的可选字段回落为空串', () => {
    const state = toEditorState(
      agent({
        id: 'architect-advisor',
        label: '架构顾问',
        description: '负责架构评审。',
        aliases: ['arch', '架构审查'],
        canonicalRole: { coreRole: 'planner', preset: 'architect' },
        model: 'anthropic/claude-opus-4.1',
        variant: 'high',
        fallbackModels: ['anthropic/claude-sonnet-4.5', 'openai/gpt-5'],
        systemPrompt: '先确认约束。',
        note: '大重构专用',
        enabled: false,
      }),
    );

    expect(state).toEqual({
      label: '架构顾问',
      description: '负责架构评审。',
      aliasesText: 'arch, 架构审查',
      coreRole: 'planner',
      preset: 'architect',
      model: 'anthropic/claude-opus-4.1',
      variant: 'high',
      fallbackModelsText: 'anthropic/claude-sonnet-4.5, openai/gpt-5',
      systemPrompt: '先确认约束。',
      note: '大重构专用',
      enabled: false,
    });
  });

  it('未设置角色时 coreRole / preset 均为空串（而不是 undefined）', () => {
    const state = toEditorState(agent({ id: 'build' }));
    expect(state.coreRole).toBe('');
    expect(state.preset).toBe('');
    expect(state.model).toBe('');
    expect(state.fallbackModelsText).toBe('');
  });

  it('往返转换不丢别名与回退链', () => {
    const source = agent({
      id: 'x',
      aliases: ['a', 'b'],
      fallbackModels: ['m1', 'm2'],
    });
    const state = toEditorState(source);

    expect(parseAliases(state.aliasesText)).toEqual(['a', 'b']);
    expect(parseAliases(state.fallbackModelsText)).toEqual(['m1', 'm2']);
  });
});

describe('parseAliases', () => {
  it.each([
    ['空串', '', []],
    ['仅空白', '   ', []],
    ['去空白 + 去重 + 丢弃空项', ' arch , arch ,, reviewer , ', ['arch', 'reviewer']],
    ['保留顺序', 'b, a, c', ['b', 'a', 'c']],
  ])('%s', (_label, input, expected) => {
    expect(parseAliases(input)).toEqual(expected);
  });
});

describe('formatCanonicalRoleZh', () => {
  it('无角色时返回 undefined', () => {
    expect(formatCanonicalRoleZh(agent({ id: 'build' }))).toBeUndefined();
  });

  it('只有核心角色时返回中文角色名', () => {
    expect(formatCanonicalRoleZh(agent({ id: 'a', canonicalRole: { coreRole: 'reviewer' } }))).toBe(
      '评审',
    );
  });

  it('核心角色 + 预设拼接为「核心 / 预设」', () => {
    expect(
      formatCanonicalRoleZh(
        agent({ id: 'a', canonicalRole: { coreRole: 'planner', preset: 'architect' } }),
      ),
    ).toBe('规划 / 架构');
  });

  it('连字符预设也按中文标签展示', () => {
    expect(
      formatCanonicalRoleZh(
        agent({ id: 'a', canonicalRole: { coreRole: 'reviewer', preset: 'code-review' } }),
      ),
    ).toBe('评审 / 代码审查');
  });
});

describe('localizeAgentDescription', () => {
  it('已知内置 Agent 用中文说明覆盖原始描述', () => {
    expect(
      localizeAgentDescription(agent({ id: 'build', description: 'Default primary agent.' })),
    ).toBe('默认主智能体，负责统筹执行与结果交付。');
  });

  it('未知内置 id 回落到记录里的描述', () => {
    expect(localizeAgentDescription(agent({ id: 'brand-new', description: '未收录的说明' }))).toBe(
      '未收录的说明',
    );
  });

  it('自定义 Agent 永远使用自己的描述', () => {
    expect(
      localizeAgentDescription(
        agent({ id: 'build', description: '我的自定义 build', origin: 'custom', source: 'custom' }),
      ),
    ).toBe('我的自定义 build');
  });
});
