/**
 * 端到端：模式提示词覆盖真正进入「稳定系统提示词」前缀。
 *
 * 现有 assembly 测试只覆盖 resolver 的门控（是否读库 / 是否返回 null），
 * prompt-override-store 测试只覆盖存取，system-prompt 测试只覆盖槽位顺序。
 * 三者之间「用户保存的覆盖文本 = 最终写进稳定前缀的字节」这一条完整链路
 * 此前**无任何用例断言**——一旦 resolver 读错账号、或 `buildTwoPartSystemPrompts`
 * 把 dialogueModePrompt 挪出 stable 段，测试仍会全绿而线上注入的已是旧值。
 *
 * 本用例按真实调用顺序串起：store 写入 → resolver 解析 → 稳定/动态两段拆分。
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type * as DbModule from '../../infra/db.js';
import type * as DialogueModePromptsModule from '../../routes/dialogue-mode-prompts/index.js';
import type * as PromptOverrideStoreModule from '../../prompt/prompt-override-store.js';
import type * as ResolveDialogueModePromptModule from '../../prompt/resolve-dialogue-mode-prompt.js';
import type * as StreamSystemPromptsModule from '../../routes/stream-system-prompts.js';

process.env['DATABASE_URL'] = ':memory:';
process.env['JWT_SECRET'] = 'dialogue-mode-override-stable-prompt-test-secret';
process.env['OPENAWORK_APP_VERSION'] = '0.0.0-test';

let dbModule: typeof DbModule;
let dialoguePrompts: typeof DialogueModePromptsModule;
let store: typeof PromptOverrideStoreModule;
let resolver: typeof ResolveDialogueModePromptModule;
let systemPrompts: typeof StreamSystemPromptsModule;

const USER_ID = 'u-stable-prompt-override';
const OVERRIDE_TEXT = '【稳定前缀覆盖】用户自定义编程纪律，必须逐字进入系统提示词。';

beforeAll(async () => {
  dbModule = await import('../../infra/db.js');
  await dbModule.connectDb();
  await dbModule.migrate();
  dialoguePrompts = await import('../../routes/dialogue-mode-prompts/index.js');
  store = await import('../../prompt/prompt-override-store.js');
  resolver = await import('../../prompt/resolve-dialogue-mode-prompt.js');
  systemPrompts = await import('../../routes/stream-system-prompts.js');
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

describe('模式提示词覆盖 → 稳定系统提示词', () => {
  it('Given 用户保存覆盖 When 经 resolver 与两段拆分 Then 覆盖逐字进入 stable 段', () => {
    store.writeDialogueModePromptOverride(USER_ID, 'programmer', OVERRIDE_TEXT);

    const dialogueModePrompt = resolver.resolveDialogueModePromptForRequest({
      userId: USER_ID,
      dialogueMode: 'programmer',
      effectiveAgentId: undefined,
    });
    expect(dialogueModePrompt).toBe(OVERRIDE_TEXT);

    const { stable, dynamic } = systemPrompts.buildTwoPartSystemPrompts({
      workspaceCtx: 'workspace-ctx',
      dialogueModePrompt: dialogueModePrompt ?? undefined,
    });

    // 覆盖必须落在**稳定前缀**（缓存命中的那一段），而不是动态尾。
    expect(stable).toContain(OVERRIDE_TEXT);
    expect(dynamic).not.toContain(OVERRIDE_TEXT);
  });

  it('Given 无覆盖 When 组装 Then stable 段是编译期默认而非用户文本', () => {
    const dialogueModePrompt = resolver.resolveDialogueModePromptForRequest({
      userId: USER_ID,
      dialogueMode: 'programmer',
      effectiveAgentId: undefined,
    });

    const { stable } = systemPrompts.buildTwoPartSystemPrompts({
      workspaceCtx: 'workspace-ctx',
      dialogueModePrompt: dialogueModePrompt ?? undefined,
    });

    expect(stable).toContain(dialoguePrompts.DIALOGUE_MODE_SYSTEM_PROMPTS.programmer);
    expect(stable).not.toContain(OVERRIDE_TEXT);
  });

  it('Given 显式 Agent When 解析 Then 稳定段不注入任何模式提示词（门控生效）', () => {
    store.writeDialogueModePromptOverride(USER_ID, 'programmer', OVERRIDE_TEXT);

    const dialogueModePrompt = resolver.resolveDialogueModePromptForRequest({
      userId: USER_ID,
      dialogueMode: 'programmer',
      effectiveAgentId: 'sisyphus',
    });
    expect(dialogueModePrompt).toBeNull();

    const { stable } = systemPrompts.buildTwoPartSystemPrompts({
      workspaceCtx: 'workspace-ctx',
      dialogueModePrompt: dialogueModePrompt ?? undefined,
    });

    expect(stable).not.toContain(OVERRIDE_TEXT);
    expect(stable).not.toContain(dialoguePrompts.DIALOGUE_MODE_SYSTEM_PROMPTS.programmer);
  });
});
