import { ProviderManagerImpl } from '@openAwork/agent-core';
import type { AIProvider } from '@openAwork/agent-core';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ sqliteGet: vi.fn() }));
vi.mock('../../infra/db.js', () => ({ sqliteGet: mocks.sqliteGet }));

import { selectDelegatedModelForUser } from '../../task/task-model-selection.js';

function provider(overrides: Partial<AIProvider> = {}): AIProvider {
  return {
    id: 'relay',
    type: 'custom',
    name: '测试平台',
    enabled: true,
    baseUrl: 'https://relay.invalid/v1',
    apiKey: 'test-key',
    defaultModels: [{ id: 'available-model', label: '可用模型', enabled: true }],
    createdAt: '2026-11-14T00:00:00.000Z',
    updatedAt: '2026-11-14T00:00:00.000Z',
    ...overrides,
  };
}

function store(providers: AIProvider[]) {
  mocks.sqliteGet.mockReturnValue({ value: JSON.stringify(providers) });
}

describe('selectDelegatedModelForUser', () => {
  beforeEach(() => {
    mocks.sqliteGet.mockReset();
    vi.stubEnv('AI_API_KEY', '');
    vi.stubEnv('OPENAI_API_KEY', '');
    vi.spyOn(ProviderManagerImpl.prototype, 'syncFromModelsDev').mockImplementation(async function (
      this: ProviderManagerImpl,
    ) {
      return this.syncBuiltinPresets();
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
  });

  it('空候选不读取配置', async () => {
    expect(await selectDelegatedModelForUser('user-1', [])).toBeUndefined();
    expect(mocks.sqliteGet).not.toHaveBeenCalled();
  });

  it.each([undefined, '{invalid', '{}', '[]', '[null]'])(
    '配置 %s 不返回内置首选模型',
    async (value) => {
      mocks.sqliteGet.mockReturnValue(value === undefined ? undefined : { value });
      expect(await selectDelegatedModelForUser('user-1', ['minimax-m2.7'])).toBeUndefined();
    },
  );

  it('未接入首选模型时按顺序选择已配置候选', async () => {
    store([provider()]);
    expect(
      await selectDelegatedModelForUser('user-1', ['minimax-m2.7', 'available-model']),
    ).toEqual({ providerId: 'relay', modelId: 'available-model' });
  });

  it('所有候选都未接入时交由调用方回退', async () => {
    store([provider()]);
    expect(await selectDelegatedModelForUser('user-1', ['minimax-m2.7'])).toBeUndefined();
  });

  it.each([
    { enabled: false },
    { apiKey: '' },
    { apiKey: '   ' },
    { defaultModels: [{ id: 'available-model', label: '已禁用', enabled: false }] },
  ])('跳过不可调用的平台或模型：%j', async (overrides) => {
    store([provider(overrides)]);
    expect(await selectDelegatedModelForUser('user-1', ['available-model'])).toBeUndefined();
  });

  it('同模型的首个平台缺少凭据时继续寻找可用平台', async () => {
    store([provider({ id: 'no-key', apiKey: '' }), provider()]);
    expect(await selectDelegatedModelForUser('user-1', ['available-model'])).toEqual({
      providerId: 'relay',
      modelId: 'available-model',
    });
  });

  it('保留候选平台约束和思考档位', async () => {
    store([provider({ id: 'other' }), provider()]);
    expect(
      await selectDelegatedModelForUser('user-1', [
        { modelId: 'available-model', providerHints: ['relay'], variant: 'high' },
      ]),
    ).toEqual({ providerId: 'relay', modelId: 'available-model', variant: 'high' });
    expect(
      await selectDelegatedModelForUser('user-1', [
        { modelId: 'available-model', providerHints: ['missing'] },
      ]),
    ).toBeUndefined();
  });

  it('只存覆盖项的内置平台仍能解析完整模型目录和环境变量凭据', async () => {
    vi.stubEnv('OPENAI_API_KEY', 'env-key');
    store([
      provider({
        id: 'openai-main',
        type: 'openai',
        baseUrl: 'https://api.openai.com/v1',
        apiKey: '',
        apiKeyEnv: 'OPENAI_API_KEY',
        defaultModels: [],
      }),
    ]);
    expect(
      await selectDelegatedModelForUser('user-1', [
        { modelId: 'gpt-4o', providerHints: ['openai'] },
      ]),
    ).toEqual({ providerId: 'openai-main', modelId: 'gpt-4o' });
  });

  it('目录同步补入的平台不视为用户已接入', async () => {
    vi.stubEnv('AI_API_KEY', 'global-key');
    store([provider()]);
    expect(await selectDelegatedModelForUser('user-1', ['gpt-4o'])).toBeUndefined();
  });

  it('本地 Ollama 平台允许无密钥调用', async () => {
    store([
      provider({ id: 'local', type: 'ollama', baseUrl: 'http://localhost:11434', apiKey: '' }),
    ]);
    expect(await selectDelegatedModelForUser('user-1', ['available-model'])).toEqual({
      providerId: 'local',
      modelId: 'available-model',
    });
  });
});
