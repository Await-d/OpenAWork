/**
 * 内置 Agent 系统提示词用户级覆盖回归（真实内存 SQLite + 真实 agent-catalog）。
 *
 * 覆盖闭环：保存 → 重读 → 合并 → 重置。
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type * as DbModule from '../../infra/db.js';
import type * as CatalogModule from '../../agent/agent-catalog.js';
import { buildDynamicOrchestratorPrompt } from '../../agent/dynamic-agent-prompt-builder.js';

process.env['DATABASE_URL'] = ':memory:';
process.env['OPENAWORK_APP_VERSION'] = '0.0.0-test';

let dbModule: typeof DbModule;
let catalog: typeof CatalogModule;

const USER_ID = 'u-agent-catalog-prompt';
const BUILTIN_ID = 'general';
const OVERRIDE_PROMPT = '你是被用户定制的通用助手。';

function update(input: Parameters<typeof catalog.updateManagedAgentForUser>[2]) {
  return catalog.updateManagedAgentForUser(USER_ID, BUILTIN_ID, input);
}

function readBuiltin() {
  const record = catalog.listManagedAgentsForUser(USER_ID).find((agent) => agent.id === BUILTIN_ID);
  if (!record) {
    throw new Error(`builtin agent ${BUILTIN_ID} missing`);
  }
  return record;
}

beforeAll(async () => {
  dbModule = await import('../../infra/db.js');
  await dbModule.connectDb();
  await dbModule.migrate();
  catalog = await import('../../agent/agent-catalog.js');
});

beforeEach(() => {
  dbModule.sqliteRun('DELETE FROM user_settings', []);
  dbModule.sqliteRun('DELETE FROM users', []);
  dbModule.sqliteRun("INSERT OR IGNORE INTO users (id, email, password_hash) VALUES (?, ?, 'x')", [
    USER_ID,
    `${USER_ID}@example.com`,
  ]);
});

afterAll(async () => {
  await dbModule.closeDb();
});

describe('agent-catalog · 系统提示词覆盖', () => {
  it('Sisyphus 默认按意图交付，动态段不再按关键词强制委派', () => {
    const prompt = catalog
      .listManagedAgentsForUser(USER_ID)
      .find(({ id }) => id === 'sisyphus')?.systemPrompt;
    const dynamic = buildDynamicOrchestratorPrompt();

    expect(prompt).toContain('直接回答，不调用工具');
    expect(prompt).toContain('按需只读调查');
    expect(prompt).toContain('实施不等于授权提交、推送或发布');
    expect(prompt).not.toContain('有专家时绝不独自工作');
    expect(dynamic).toContain('下列条目只用于在已决定委派后匹配角色');
    expect(dynamic).toContain('`explore`');
    expect(dynamic).toContain('`librarian`');
    expect(dynamic).not.toMatch(/分类前检查|立即启动 librarian|完整的实施周期|2\+ 模块涉及/);
  });

  it('仅修改 systemPrompt 后重新读取仍返回覆盖值（防被误判为默认而删除）', () => {
    const defaultPrompt = readBuiltin().systemPrompt;
    expect(defaultPrompt).toBeTruthy();

    const updated = update({ systemPrompt: OVERRIDE_PROMPT });
    expect(updated.systemPrompt).toBe(OVERRIDE_PROMPT);
    expect(updated.hasOverrides).toBe(true);
    expect(updated.resettable).toBe(true);

    const replayed = readBuiltin();
    expect(replayed.systemPrompt).toBe(OVERRIDE_PROMPT);
    expect(replayed.hasOverrides).toBe(true);
  });

  it('覆盖提示词后再仅改模型，提示词覆盖必须保留', () => {
    update({ systemPrompt: OVERRIDE_PROMPT });

    const updated = update({ model: 'openai/gpt-5-mini' });
    expect(updated.systemPrompt).toBe(OVERRIDE_PROMPT);
    expect(updated.model).toBe('openai/gpt-5-mini');
    expect(readBuiltin().systemPrompt).toBe(OVERRIDE_PROMPT);
  });

  it('systemPrompt: null 清除覆盖并回落到默认', () => {
    const defaultPrompt = readBuiltin().systemPrompt;
    update({ systemPrompt: OVERRIDE_PROMPT });
    expect(readBuiltin().systemPrompt).toBe(OVERRIDE_PROMPT);

    const cleared = update({ systemPrompt: null });
    expect(cleared.systemPrompt).toBe(defaultPrompt);
    expect(cleared.hasOverrides).toBe(false);
    expect(cleared.resettable).toBe(false);
  });

  it('systemPrompt 空串视为清除覆盖', () => {
    const defaultPrompt = readBuiltin().systemPrompt;
    update({ systemPrompt: OVERRIDE_PROMPT });

    const cleared = update({ systemPrompt: '   ' });
    expect(cleared.systemPrompt).toBe(defaultPrompt);
    expect(cleared.hasOverrides).toBe(false);
    expect(readBuiltin().systemPrompt).toBe(defaultPrompt);
  });

  it('覆盖文本等于当前默认 → 视为无覆盖（不固化默认）', () => {
    const defaultPrompt = readBuiltin().systemPrompt ?? '';

    const noop = update({ systemPrompt: defaultPrompt });
    expect(noop.hasOverrides).toBe(false);
    expect(noop.resettable).toBe(false);

    const parsed = JSON.parse(
      dbModule.sqliteGet<{ value: string }>(
        `SELECT value FROM user_settings WHERE user_id = ? AND key = 'agent_catalog'`,
        [USER_ID],
      )?.value ?? '{}',
    ) as { builtinOverrides?: Record<string, { systemPrompt?: string }> };
    expect(parsed.builtinOverrides?.[BUILTIN_ID]?.systemPrompt).toBeUndefined();
  });

  it('已有模型覆盖时提交等于默认的提示词，也不把默认值固化进覆盖记录', () => {
    const defaultPrompt = readBuiltin().systemPrompt ?? '';
    update({ model: 'openai/gpt-5-mini' });

    const updated = update({ systemPrompt: defaultPrompt });

    // 生效提示词仍是默认值 → 不显示为覆盖；模型覆盖保留。
    expect(updated.systemPrompt).toBe(defaultPrompt);
    expect(updated.promptMetadata?.hasPromptOverride).toBe(false);
    expect(updated.model).toBe('openai/gpt-5-mini');

    const parsed = JSON.parse(
      dbModule.sqliteGet<{ value: string }>(
        `SELECT value FROM user_settings WHERE user_id = ? AND key = 'agent_catalog'`,
        [USER_ID],
      )?.value ?? '{}',
    ) as { builtinOverrides?: Record<string, { systemPrompt?: string; model?: string }> };

    expect(parsed.builtinOverrides?.[BUILTIN_ID]?.model).toBe('openai/gpt-5-mini');
    expect(parsed.builtinOverrides?.[BUILTIN_ID]?.systemPrompt).toBeUndefined();
  });

  it('覆盖记录只存与默认不同的字段：提交等于默认的模型 / 回退链不会被钉住', () => {
    const baseline = readBuiltin();
    const defaultModel = baseline.model;
    const defaultFallbacks = baseline.fallbackModels ?? [];

    // 用户只改提示词，但表单会把它预填的「生效值」（此刻等于默认值）一并提交；
    // 该内置 Agent 可能本就没有默认模型，此时按「不提交该字段」处理。
    const updated = update({
      ...(defaultModel === undefined ? {} : { model: defaultModel }),
      fallbackModels: [...defaultFallbacks],
      systemPrompt: OVERRIDE_PROMPT,
    });

    expect(updated.systemPrompt).toBe(OVERRIDE_PROMPT);
    expect(updated.model).toBe(defaultModel);

    const parsed = JSON.parse(
      dbModule.sqliteGet<{ value: string }>(
        `SELECT value FROM user_settings WHERE user_id = ? AND key = 'agent_catalog'`,
        [USER_ID],
      )?.value ?? '{}',
    ) as {
      builtinOverrides?: Record<
        string,
        { systemPrompt?: string; model?: string; fallbackModels?: string[] }
      >;
    };

    // 只有真正被改动的提示词落库；等于默认值的模型与回退链不得写入，
    // 否则上游升级默认模型后该 Agent 会静默留在旧模型上。
    expect(parsed.builtinOverrides?.[BUILTIN_ID]?.systemPrompt).toBe(OVERRIDE_PROMPT);
    expect(parsed.builtinOverrides?.[BUILTIN_ID]?.model).toBeUndefined();
    expect(parsed.builtinOverrides?.[BUILTIN_ID]?.fallbackModels).toBeUndefined();
  });

  it('仅改了提示词时，模型覆盖不会被误删', () => {
    update({ model: 'openai/gpt-5-mini' });
    const updated = update({ systemPrompt: OVERRIDE_PROMPT });
    expect(updated.model).toBe('openai/gpt-5-mini');
    expect(updated.systemPrompt).toBe(OVERRIDE_PROMPT);
  });

  it('reset 清除提示词覆盖并恢复默认', () => {
    const defaultPrompt = readBuiltin().systemPrompt;
    update({ systemPrompt: OVERRIDE_PROMPT });
    expect(readBuiltin().systemPrompt).toBe(OVERRIDE_PROMPT);

    const reset = catalog.resetManagedAgentForUser(USER_ID, BUILTIN_ID);
    expect(reset.hasOverrides).toBe(false);
    expect(reset.resettable).toBe(false);
    expect(reset.systemPrompt).toBe(defaultPrompt);
  });

  it('既有拒绝行为仍成立（label / enabled 不可更新）', () => {
    const message = 'Builtin agents only allow model configuration updates';
    expect(() => update({ label: '改名' })).toThrow(message);
    expect(() => update({ enabled: false })).toThrow(message);
  });
});

describe('agent-catalog · promptMetadata', () => {
  it('默认状态下无覆盖，defaultText 即当前默认提示词', () => {
    const record = readBuiltin();
    expect(record.promptMetadata).toBeDefined();
    expect(record.promptMetadata?.defaultText).toBe(record.systemPrompt);
    expect(record.promptMetadata?.hasPromptOverride).toBe(false);
  });

  it('仅改提示词：hasPromptOverride 为 true，defaultText 不变', () => {
    const defaultPrompt = readBuiltin().promptMetadata?.defaultText;
    const updated = update({ systemPrompt: OVERRIDE_PROMPT });
    expect(updated.promptMetadata?.hasPromptOverride).toBe(true);
    expect(updated.promptMetadata?.defaultText).toBe(defaultPrompt);
  });

  it('仅改模型：hasPromptOverride 仍为 false（不因模型覆盖误判）', () => {
    const updated = update({ model: 'openai/gpt-5-mini' });
    expect(updated.promptMetadata?.hasPromptOverride).toBe(false);
    expect(updated.hasOverrides).toBe(true);
  });

  it('清除提示词覆盖后 hasPromptOverride 回落 false', () => {
    update({ systemPrompt: OVERRIDE_PROMPT });
    const cleared = update({ systemPrompt: null });
    expect(cleared.promptMetadata?.hasPromptOverride).toBe(false);
  });

  it('自定义 Agent 不填充 promptMetadata', () => {
    const created = catalog.createManagedAgentForUser(USER_ID, {
      label: '自定义',
      description: '自定义 Agent',
      aliases: [],
      systemPrompt: '你是自定义 Agent。',
    });
    expect(created.promptMetadata).toBeUndefined();
  });
});
