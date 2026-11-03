import { describe, expect, it } from 'vitest';
import type { ManagedAgentRecord } from '@openAwork/shared';
import { emptyEditorState } from '../../components/agents/agents-editor-state.js';
import { toBuiltinUpdateInput } from './agents-builtin-update-input.js';

const BASE = {
  label: '通用',
  description: '',
  aliases: [],
  enabled: true,
  removable: false,
  resettable: false,
  hasOverrides: false,
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
} satisfies Omit<ManagedAgentRecord, 'id' | 'origin' | 'source'>;

function builtinAgent(systemPrompt?: string, defaultText?: string): ManagedAgentRecord {
  return {
    ...BASE,
    id: 'general',
    origin: 'builtin',
    source: 'builtin',
    ...(systemPrompt === undefined ? {} : { systemPrompt }),
    ...(defaultText === undefined
      ? {}
      : {
          promptMetadata: {
            hasPromptOverride: systemPrompt !== undefined && systemPrompt !== defaultText,
            defaultText,
          },
        }),
  };
}

describe('toBuiltinUpdateInput', () => {
  it('只改模型时不提交 systemPrompt（避免把默认提示词固化成覆盖）', () => {
    const state = { ...emptyEditorState(), model: 'gpt-5', systemPrompt: '默认提示词' };
    const agent = builtinAgent('默认提示词');

    const input = toBuiltinUpdateInput(state, agent);

    expect(input.model).toBe('gpt-5');
    expect('systemPrompt' in input).toBe(false);
  });

  it('改为新文本时提交该文本（保留原始空白）', () => {
    const state = { ...emptyEditorState(), systemPrompt: '  自定义纪律  ' };
    const agent = builtinAgent('默认提示词');

    const input = toBuiltinUpdateInput(state, agent);

    expect(input.systemPrompt).toBe('  自定义纪律  ');
  });

  it('清空或纯空白时提交 null（服务端删除覆盖、回落默认）', () => {
    const agent = builtinAgent('默认提示词');

    expect(toBuiltinUpdateInput({ ...emptyEditorState(), systemPrompt: '' }, agent)).toMatchObject({
      systemPrompt: null,
    });
    expect(
      toBuiltinUpdateInput({ ...emptyEditorState(), systemPrompt: '   ' }, agent),
    ).toMatchObject({ systemPrompt: null });
  });

  it('该 Agent 无默认提示词时，未填写不提交、填写才提交', () => {
    const agent = builtinAgent();

    expect('systemPrompt' in toBuiltinUpdateInput(emptyEditorState(), agent)).toBe(false);
    expect(
      toBuiltinUpdateInput({ ...emptyEditorState(), systemPrompt: '新提示词' }, agent).systemPrompt,
    ).toBe('新提示词');
  });

  it('已存在覆盖时，改回覆盖值不算改动（不提交）', () => {
    const state = { ...emptyEditorState(), systemPrompt: '已有覆盖' };
    const agent = builtinAgent('已有覆盖');

    expect('systemPrompt' in toBuiltinUpdateInput(state, agent)).toBe(false);
  });

  it('「恢复默认提示词」（填回默认文本）提交 null，不把默认值固化成覆盖', () => {
    // 编辑器把默认值填回输入框，因此这里是「改动过」的值；若原样提交，且用户同时改了
    // 模型，服务端的 sameAsDefault（要求四个字段全等于默认）不会删除覆盖记录，这段
    // 等于默认值的文本就会被存下来，等上游默认提示词升级后变成一条陈旧覆盖。
    const agent = builtinAgent('我的自定义覆盖', '默认提示词');
    const input = toBuiltinUpdateInput(
      { ...emptyEditorState(), model: 'gpt-5', systemPrompt: '默认提示词' },
      agent,
    );

    expect(input.model).toBe('gpt-5');
    expect(input.systemPrompt).toBeNull();
  });

  it('手工输入与默认提示词完全相同的文本时，同样按无覆盖处理', () => {
    const agent = builtinAgent('旧覆盖', '默认提示词');

    expect(
      toBuiltinUpdateInput({ ...emptyEditorState(), systemPrompt: '默认提示词' }, agent)
        .systemPrompt,
    ).toBeNull();
  });

  it('与默认值不同时照常提交覆盖文本', () => {
    const agent = builtinAgent('默认提示词', '默认提示词');

    expect(
      toBuiltinUpdateInput({ ...emptyEditorState(), systemPrompt: '我的纪律' }, agent).systemPrompt,
    ).toBe('我的纪律');
  });

  it('老数据没有 promptMetadata 时退回「清空才提交 null」的语义', () => {
    const agent = builtinAgent('旧覆盖');

    expect(
      toBuiltinUpdateInput({ ...emptyEditorState(), systemPrompt: '默认提示词' }, agent)
        .systemPrompt,
    ).toBe('默认提示词');
  });
});
