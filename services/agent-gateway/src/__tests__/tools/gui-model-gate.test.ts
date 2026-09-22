import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  sqliteGet: vi.fn(),
  getProviderConfigForSelection: vi.fn(),
}));

vi.mock('../../infra/db.js', () => ({ sqliteGet: mocks.sqliteGet }));
vi.mock('../../provider/provider-config.js', () => ({
  getProviderConfigForSelection: mocks.getProviderConfigForSelection,
}));

import { resolveGuiModelGate } from '../../tools/gui/gui-model-gate.js';

interface StubProvider {
  readonly id: string;
  readonly type: string;
  readonly name: string;
  readonly enabled: boolean;
  readonly baseUrl: string;
  readonly defaultModels: readonly unknown[];
}

function stubProvider(type: string, id: string, name: string): StubProvider {
  return { id, type, name, enabled: true, baseUrl: '', defaultModels: [] };
}

function stubConfig(type: string, modelId: string, id = `provider-${type}`, name = type) {
  return { provider: stubProvider(type, id, name), modelId };
}

const ENV_KEYS = ['OPENAWORK_GUI_ENDPOINT_URL', 'OPENAWORK_GUI_ENDPOINT_MODEL'] as const;

describe('resolveGuiModelGate', () => {
  beforeEach(() => {
    mocks.sqliteGet.mockReset();
    mocks.getProviderConfigForSelection.mockReset();
    for (const key of ENV_KEYS) {
      delete globalThis.process.env[key];
    }
  });

  afterEach(() => {
    for (const key of ENV_KEYS) {
      delete globalThis.process.env[key];
    }
  });

  it('未配置任何模型时明确拒绝并给出中文原因', async () => {
    mocks.getProviderConfigForSelection.mockResolvedValue(null);

    const result = await resolveGuiModelGate('user-1');

    expect(result.allowed).toBe(false);
    expect(result.reason).toContain('GUI grounding');
    expect(result.route).toBeUndefined();
  });

  it('当前选中模型不具备 grounding 时拒绝', async () => {
    mocks.getProviderConfigForSelection.mockResolvedValue(
      stubConfig('openai', 'gpt-4o', 'provider-openai', 'OpenAI'),
    );

    const result = await resolveGuiModelGate('user-1');

    expect(result.allowed).toBe(false);
    expect(result.reason).toContain('gpt-4o');
    expect(result.reason).toContain('grounding');
    expect(result.route).toBeUndefined();
  });

  it('当前选中 OpenAI computer-use 模型时放行并返回路由', async () => {
    mocks.getProviderConfigForSelection.mockResolvedValue(
      stubConfig('openai', 'computer-use-preview', 'provider-openai', 'OpenAI'),
    );

    const result = await resolveGuiModelGate('user-1');

    expect(result.allowed).toBe(true);
    expect(result.route).toEqual({
      providerId: 'provider-openai',
      modelId: 'computer-use-preview',
    });
  });

  it('当前选中 Anthropic computer use 模型时放行', async () => {
    mocks.getProviderConfigForSelection.mockResolvedValue(
      stubConfig('anthropic', 'claude-sonnet-4-0', 'provider-anthropic', 'Anthropic'),
    );

    const result = await resolveGuiModelGate('user-1');

    expect(result.allowed).toBe(true);
    expect(result.route?.modelId).toBe('claude-sonnet-4-0');
  });

  it('当前选中 Anthropic 非 grounding 模型时拒绝', async () => {
    mocks.getProviderConfigForSelection.mockResolvedValue(
      stubConfig('anthropic', 'claude-3-haiku-20240307', 'provider-anthropic', 'Anthropic'),
    );

    const result = await resolveGuiModelGate('user-1');

    expect(result.allowed).toBe(false);
    expect(result.reason).toContain('claude-3-haiku-20240307');
  });

  it('配置了自定义 GUI endpoint 时按路径 B 放行', async () => {
    globalThis.process.env['OPENAWORK_GUI_ENDPOINT_URL'] = 'https://gui.example.com/v1';
    globalThis.process.env['OPENAWORK_GUI_ENDPOINT_MODEL'] = 'ui-tars-1.5-7b';
    mocks.getProviderConfigForSelection.mockResolvedValue(
      stubConfig('openai', 'gpt-4o', 'provider-openai', 'OpenAI'),
    );

    const result = await resolveGuiModelGate('user-1');

    expect(result.allowed).toBe(true);
    expect(result.route).toEqual({ providerId: 'gui-endpoint', modelId: 'ui-tars-1.5-7b' });
    expect(result.reason).toContain('自定义 GUI endpoint');
  });

  it('只配置了 URL 而未配置模型时不走路径 B', async () => {
    globalThis.process.env['OPENAWORK_GUI_ENDPOINT_URL'] = 'https://gui.example.com/v1';
    mocks.getProviderConfigForSelection.mockResolvedValue(
      stubConfig('openai', 'gpt-4o', 'provider-openai', 'OpenAI'),
    );

    const result = await resolveGuiModelGate('user-1');

    expect(result.allowed).toBe(false);
  });

  it('从 user_settings 读取 providers / active_selection 并解析 JSON 后传入', async () => {
    const providers = [stubProvider('openai', 'provider-openai', 'OpenAI')];
    const selection = { chat: { providerId: 'provider-openai', modelId: 'gpt-4o' } };
    mocks.sqliteGet.mockImplementation((sql: string) => {
      if (sql.includes("'providers'")) {
        return { value: JSON.stringify(providers) };
      }
      if (sql.includes("'active_selection'")) {
        return { value: JSON.stringify(selection) };
      }
      return undefined;
    });
    mocks.getProviderConfigForSelection.mockResolvedValue(stubConfig('openai', 'gpt-4o'));

    await resolveGuiModelGate('user-1');

    // 第三个参数是会话级 override；未传 sessionId 时为 undefined（保持原行为）。
    expect(mocks.getProviderConfigForSelection).toHaveBeenCalledWith(
      providers,
      selection,
      undefined,
    );
  });

  describe('会话级模型优先（GUI 必须与主对话用同一个模型）', () => {
    /** 让 providers / active_selection / sessions 三条查询各返回不同值。 */
    function stubRows(input: { sessionMetadata?: Record<string, unknown> | null }): void {
      mocks.sqliteGet.mockImplementation((sql: string) => {
        if (sql.includes("'providers'")) {
          return { value: JSON.stringify([stubProvider('openai', 'provider-openai', 'OpenAI')]) };
        }
        if (sql.includes("'active_selection'")) {
          return {
            value: JSON.stringify({ chat: { providerId: 'provider-openai', modelId: 'gpt-4o' } }),
          };
        }
        if (sql.includes('FROM sessions')) {
          return input.sessionMetadata === null || input.sessionMetadata === undefined
            ? undefined
            : { metadata_json: JSON.stringify(input.sessionMetadata) };
        }
        return undefined;
      });
    }

    it('会话指定了 grounding 模型时，把它作为 override 传给选择器', async () => {
      stubRows({
        sessionMetadata: {
          providerId: 'provider-openai',
          modelId: 'computer-use-preview',
          modelSelectionSource: 'manual',
        },
      });
      mocks.getProviderConfigForSelection.mockResolvedValue(
        stubConfig('openai', 'computer-use-preview'),
      );

      const result = await resolveGuiModelGate('user-1', 'session-1');

      // 第三个参数即会话级 override —— 没有它就会落到全局 active_selection。
      expect(mocks.getProviderConfigForSelection).toHaveBeenCalledWith(
        expect.anything(),
        expect.anything(),
        { providerId: 'provider-openai', modelId: 'computer-use-preview' },
      );
      expect(result.allowed).toBe(true);
      expect(result.route).toEqual({
        providerId: 'provider-openai',
        modelId: 'computer-use-preview',
      });
    });

    it('会话未指定模型时回退到全局选择（override 为 undefined）', async () => {
      stubRows({ sessionMetadata: { parentSessionId: 'parent-1' } });
      mocks.getProviderConfigForSelection.mockResolvedValue(stubConfig('openai', 'gpt-4o'));

      await resolveGuiModelGate('user-1', 'session-1');

      expect(mocks.getProviderConfigForSelection).toHaveBeenCalledWith(
        expect.anything(),
        expect.anything(),
        undefined,
      );
    });

    it('未传 sessionId 时不查询 sessions 表', async () => {
      stubRows({ sessionMetadata: { providerId: 'p', modelId: 'm' } });
      mocks.getProviderConfigForSelection.mockResolvedValue(stubConfig('openai', 'gpt-4o'));

      await resolveGuiModelGate('user-1');

      const sessionQueries = mocks.sqliteGet.mock.calls.filter((call) =>
        String(call[0]).includes('FROM sessions'),
      );
      expect(sessionQueries).toHaveLength(0);
    });

    it('会话 metadata 缺 providerId / modelId 时不产生 override', async () => {
      stubRows({ sessionMetadata: { providerId: 'provider-openai' } });
      mocks.getProviderConfigForSelection.mockResolvedValue(stubConfig('openai', 'gpt-4o'));

      await resolveGuiModelGate('user-1', 'session-1');

      expect(mocks.getProviderConfigForSelection).toHaveBeenCalledWith(
        expect.anything(),
        expect.anything(),
        undefined,
      );
    });

    it('查询会话时带上 user_id 约束（防止跨用户读取）', async () => {
      stubRows({ sessionMetadata: null });
      mocks.getProviderConfigForSelection.mockResolvedValue(stubConfig('openai', 'gpt-4o'));

      await resolveGuiModelGate('user-1', 'session-1');

      const sessionQuery = mocks.sqliteGet.mock.calls.find((call) =>
        String(call[0]).includes('FROM sessions'),
      );
      expect(sessionQuery?.[1]).toEqual(['session-1', 'user-1']);
    });
  });
});
