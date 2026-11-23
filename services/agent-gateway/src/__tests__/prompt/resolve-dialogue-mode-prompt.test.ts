import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type * as DbModule from '../../infra/db.js';
import type * as DialogueModePromptsModule from '../../routes/dialogue-mode-prompts/index.js';
import type * as PromptOverrideStoreModule from '../../prompt/prompt-override-store.js';
import type * as ResolveDialogueModePromptModule from '../../prompt/resolve-dialogue-mode-prompt.js';

process.env['DATABASE_URL'] = ':memory:';
process.env['JWT_SECRET'] = 'resolve-dialogue-mode-prompt-test-secret-1234567890';
process.env['OPENAWORK_APP_VERSION'] = '0.0.0-test';

let dbModule: typeof DbModule;
let dialogueModePrompts: typeof DialogueModePromptsModule;
let promptOverrideStore: typeof PromptOverrideStoreModule;
let resolver: typeof ResolveDialogueModePromptModule;

const USER_ID = 'u-resolve-dialogue-mode-prompt';
const OTHER_USER_ID = 'u-resolve-dialogue-mode-prompt-other';

beforeAll(async () => {
  dbModule = await import('../../infra/db.js');
  await dbModule.connectDb();
  await dbModule.migrate();

  dialogueModePrompts = await import('../../routes/dialogue-mode-prompts/index.js');
  promptOverrideStore = await import('../../prompt/prompt-override-store.js');
  resolver = await import('../../prompt/resolve-dialogue-mode-prompt.js');

  dbModule.sqliteRun("INSERT OR IGNORE INTO users (id, email, password_hash) VALUES (?, ?, 'x')", [
    USER_ID,
    `${USER_ID}@example.com`,
  ]);
  dbModule.sqliteRun("INSERT OR IGNORE INTO users (id, email, password_hash) VALUES (?, ?, 'x')", [
    OTHER_USER_ID,
    `${OTHER_USER_ID}@example.com`,
  ]);
});

beforeEach(() => {
  dbModule.sqliteRun('DELETE FROM user_settings WHERE user_id IN (?, ?)', [USER_ID, OTHER_USER_ID]);
  vi.restoreAllMocks();
});

afterAll(() => {
  vi.restoreAllMocks();
});

describe('resolveDialogueModePromptForRequest', () => {
  it('Given 用户存在覆盖 When 解析 Then 返回覆盖文本', () => {
    promptOverrideStore.writeDialogueModePromptOverride(USER_ID, 'coding', '用户的编码模式覆盖');
    const result = resolver.resolveDialogueModePromptForRequest({
      userId: USER_ID,
      dialogueMode: 'coding',
      effectiveAgentId: undefined,
    });
    expect(result).toBe('用户的编码模式覆盖');
  });

  it('Given 无覆盖 When 解析 Then 逐字等于默认常量', () => {
    const result = resolver.resolveDialogueModePromptForRequest({
      userId: USER_ID,
      dialogueMode: 'clarify',
      effectiveAgentId: undefined,
    });
    expect(result).toBe(dialogueModePrompts.DIALOGUE_MODE_SYSTEM_PROMPTS.clarify);
  });

  it('Given 显式 Agent When 解析 Then 返回 null 且不读库', () => {
    const readSpy = vi.spyOn(promptOverrideStore, 'readDialogueModePromptOverrides');
    const result = resolver.resolveDialogueModePromptForRequest({
      userId: USER_ID,
      dialogueMode: 'coding',
      effectiveAgentId: 'sisyphus',
    });
    expect(result).toBeNull();
    expect(readSpy).not.toHaveBeenCalled();
  });

  it('Given 未指定对话模式 When 解析 Then 返回 null', () => {
    const result = resolver.resolveDialogueModePromptForRequest({
      userId: USER_ID,
      dialogueMode: undefined,
      effectiveAgentId: undefined,
    });
    expect(result).toBeNull();
  });

  it('Given 其他用户有覆盖 When 解析 Then 不影响当前用户（回落默认）', () => {
    promptOverrideStore.writeDialogueModePromptOverride(
      OTHER_USER_ID,
      'programmer',
      '其他用户的编程模式覆盖',
    );
    const result = resolver.resolveDialogueModePromptForRequest({
      userId: USER_ID,
      dialogueMode: 'programmer',
      effectiveAgentId: undefined,
    });
    expect(result).toBe(dialogueModePrompts.DIALOGUE_MODE_SYSTEM_PROMPTS.programmer);
  });
});
