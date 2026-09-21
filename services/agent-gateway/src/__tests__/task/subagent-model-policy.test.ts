import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  sqliteGet: vi.fn(),
}));

vi.mock('../../infra/db.js', () => ({
  sqliteGet: mocks.sqliteGet,
}));

import { DEFAULT_SUBAGENT_MODEL_POLICY } from '../../provider/provider-config.js';
import {
  completeInheritedParentModel,
  resolveInheritedParentModel,
  resolveSubagentModelPolicyForUser,
} from '../../task/subagent-model-policy.js';

describe('resolveInheritedParentModel', () => {
  it('requestData.model 优先于父会话 metadata.modelId', () => {
    expect(
      resolveInheritedParentModel({
        requestData: { model: 'gpt-5.2' },
        parentSessionMetadata: { modelId: 'claude-opus-4-6' },
      }),
    ).toEqual({ modelId: 'gpt-5.2' });
  });

  it('requestData.model 缺失或为 default 时回退 metadata.modelId', () => {
    expect(
      resolveInheritedParentModel({
        requestData: {},
        parentSessionMetadata: { modelId: 'claude-opus-4-6' },
      }),
    ).toEqual({ modelId: 'claude-opus-4-6' });

    expect(
      resolveInheritedParentModel({
        requestData: { model: 'default' },
        parentSessionMetadata: { modelId: 'claude-opus-4-6' },
      }),
    ).toEqual({ modelId: 'claude-opus-4-6' });
  });

  it('providerId 与 variant 分别从两个来源继承，requestData 优先', () => {
    expect(
      resolveInheritedParentModel({
        requestData: { model: 'gpt-5.2', providerId: 'openai-main', variant: 'high' },
        parentSessionMetadata: {
          modelId: 'claude-opus-4-6',
          providerId: 'anthropic-backup',
          variant: 'low',
        },
      }),
    ).toEqual({ modelId: 'gpt-5.2', providerId: 'openai-main', variant: 'high' });

    expect(
      resolveInheritedParentModel({
        requestData: { model: 'gpt-5.2' },
        parentSessionMetadata: { providerId: 'anthropic-backup', variant: 'low' },
      }),
    ).toEqual({
      modelId: 'gpt-5.2',
      providerId: 'anthropic-backup',
      variant: 'low',
    });
  });

  it('两个来源都无模型时返回 undefined', () => {
    expect(
      resolveInheritedParentModel({
        parentSessionMetadata: {},
      }),
    ).toBeUndefined();

    expect(
      resolveInheritedParentModel({
        requestData: { model: 'default' },
        parentSessionMetadata: { modelId: '   ' },
      }),
    ).toBeUndefined();
  });

  it('去除首尾空白', () => {
    expect(
      resolveInheritedParentModel({
        requestData: { model: ' gpt-5.2 ' },
        parentSessionMetadata: {},
      }),
    ).toEqual({ modelId: 'gpt-5.2' });
  });
});

describe('completeInheritedParentModel', () => {
  it('model-only + 能找到归属时补齐 providerId，并在继承缺 variant 时补上归属 variant', () => {
    const resolveOwner = vi.fn(
      (_modelId: string): { providerId?: string; variant?: string } | undefined => ({
        providerId: 'openai-main',
        variant: 'high',
      }),
    );

    expect(completeInheritedParentModel({ modelId: 'gpt-5.2' }, resolveOwner)).toEqual({
      modelId: 'gpt-5.2',
      providerId: 'openai-main',
      variant: 'high',
    });
    expect(resolveOwner).toHaveBeenCalledWith('gpt-5.2');
  });

  it('已有 providerId 时不调用归属解析器，结果不变', () => {
    const resolveOwner = vi.fn(
      (_modelId: string): { providerId?: string; variant?: string } | undefined => ({
        providerId: 'anthropic-backup',
        variant: 'low',
      }),
    );
    const selection = { modelId: 'gpt-5.2', providerId: 'openai-main' };

    expect(completeInheritedParentModel(selection, resolveOwner)).toBe(selection);
    expect(resolveOwner).not.toHaveBeenCalled();
  });

  it('归属解析不到（undefined 或未带 providerId）时保持 model-only', () => {
    const notFound = vi.fn((_modelId: string): { providerId?: string } | undefined => undefined);
    const noProvider = vi.fn((_modelId: string): { variant?: string } | undefined => ({
      variant: 'high',
    }));

    expect(completeInheritedParentModel({ modelId: 'gpt-5.2' }, notFound)).toEqual({
      modelId: 'gpt-5.2',
    });
    expect(completeInheritedParentModel({ modelId: 'gpt-5.2' }, noProvider)).toEqual({
      modelId: 'gpt-5.2',
    });
  });

  it('继承选择已有 variant 时不采用归属 variant', () => {
    const resolveOwner = vi.fn(
      (_modelId: string): { providerId?: string; variant?: string } | undefined => ({
        providerId: 'openai-main',
        variant: 'high',
      }),
    );

    expect(
      completeInheritedParentModel({ modelId: 'gpt-5.2', variant: 'low' }, resolveOwner),
    ).toEqual({
      modelId: 'gpt-5.2',
      providerId: 'openai-main',
      variant: 'low',
    });
  });

  it('归属与继承都没有 variant 时只补 providerId', () => {
    expect(
      completeInheritedParentModel({ modelId: 'gpt-5.2' }, () => ({ providerId: 'openai-main' })),
    ).toEqual({ modelId: 'gpt-5.2', providerId: 'openai-main' });
  });
});

describe('resolveSubagentModelPolicyForUser', () => {
  beforeEach(() => {
    mocks.sqliteGet.mockReset();
  });

  it('缺少存储行时回落 auto', () => {
    mocks.sqliteGet.mockReturnValue(undefined);

    expect(resolveSubagentModelPolicyForUser('user-1')).toEqual(DEFAULT_SUBAGENT_MODEL_POLICY);
    expect(mocks.sqliteGet).toHaveBeenCalledWith(expect.stringContaining('subagent_model_policy'), [
      'user-1',
    ]);
  });

  it('读取有效的 inherit-main 值', () => {
    mocks.sqliteGet.mockReturnValue({ value: JSON.stringify({ modelMode: 'inherit-main' }) });

    expect(resolveSubagentModelPolicyForUser('user-1')).toEqual({ modelMode: 'inherit-main' });
  });

  it('存储值 JSON 损坏时回落 auto', () => {
    mocks.sqliteGet.mockReturnValue({ value: '{not-json' });

    expect(resolveSubagentModelPolicyForUser('user-1')).toEqual(DEFAULT_SUBAGENT_MODEL_POLICY);
  });

  it('存储值 schema 不匹配时回落 auto', () => {
    mocks.sqliteGet.mockReturnValue({ value: JSON.stringify({ modelMode: 'unknown' }) });

    expect(resolveSubagentModelPolicyForUser('user-1')).toEqual(DEFAULT_SUBAGENT_MODEL_POLICY);
  });

  it('数据库读取抛错时回落 auto', () => {
    mocks.sqliteGet.mockImplementation(() => {
      throw new Error('db unavailable');
    });

    expect(resolveSubagentModelPolicyForUser('user-1')).toEqual(DEFAULT_SUBAGENT_MODEL_POLICY);
  });
});
