import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type * as DbModule from '../../infra/db.js';
import type * as HandoffStoreModule from '../../handoff/store/handoff-store.js';
import type * as Pm1RunnerModule from '../../handoff/runner/pm1-runner.js';

const mocks = vi.hoisted(() => ({
  requestPrompts: [] as string[],
  requestWorkflowLlmCompletion: vi.fn(async (input: { prompt: string }) => {
    mocks.requestPrompts.push(input.prompt);
    return 'LLM OK';
  }),
  resolveAuxiliaryLlmConfig: vi.fn(),
  runArtifactChain: vi.fn(
    async (input: { callLlm: (systemPrompt: string, userMessage: string) => Promise<string> }) => {
      await input.callLlm('你是 PM1 功能规格文档生成器。', '请生成规格。');
      return {
        planArtifactId: 'plan',
        specArtifactId: 'spec',
        tasksArtifactId: 'tasks',
      };
    },
  ),
}));

vi.mock('../../provider/auxiliary-llm-config.js', () => ({
  resolveAuxiliaryLlmConfig: mocks.resolveAuxiliaryLlmConfig,
}));

vi.mock('../../routes/workflow-llm.js', () => ({
  requestWorkflowLlmCompletion: mocks.requestWorkflowLlmCompletion,
}));

vi.mock('../../handoff/runner/artifact-chain.js', () => ({
  runArtifactChain: mocks.runArtifactChain,
}));

process.env['DATABASE_URL'] = ':memory:';
process.env['OPENAWORK_APP_VERSION'] = '0.0.0-test';

let dbModule: typeof DbModule;
let store: typeof HandoffStoreModule;
let pm1RunnerModule: typeof Pm1RunnerModule;

const USER_ID = 'u-pm1-aux';
const TEAM_WORKSPACE_ID = 'tw-pm1-aux';
const RECEPTION_SESSION_ID = 's-pm1-aux-reception';
const PM1_SESSION_ID = 's-pm1-aux';

function seedUser(): void {
  dbModule.sqliteRun("INSERT OR IGNORE INTO users (id, email, password_hash) VALUES (?, ?, 'x')", [
    USER_ID,
    'pm1-aux@example.com',
  ]);
}

beforeAll(async () => {
  dbModule = await import('../../infra/db.js');
  await dbModule.migrate();
  store = await import('../../handoff/store/handoff-store.js');
  pm1RunnerModule = await import('../../handoff/runner/pm1-runner.js');
});

beforeEach(() => {
  dbModule.sqliteRun('DELETE FROM users', []);
  seedUser();
  dbModule.sqliteRun(
    `INSERT INTO team_workspaces (id, user_id, name)
     VALUES (?, ?, 'PM1 辅助工作区')`,
    [TEAM_WORKSPACE_ID, USER_ID],
  );
  dbModule.sqliteRun(
    `INSERT INTO sessions (id, user_id, title, metadata_json, role_layer)
     VALUES (?, ?, 'Reception', ?, 'reception')`,
    [RECEPTION_SESSION_ID, USER_ID, JSON.stringify({ teamWorkspaceId: TEAM_WORKSPACE_ID })],
  );
  dbModule.sqliteRun(
    `INSERT INTO sessions (
       id, user_id, title, metadata_json, role_layer, team_parent_session_id
     ) VALUES (?, ?, 'PM1', '{}', 'pm1', ?)`,
    [PM1_SESSION_ID, USER_ID, RECEPTION_SESSION_ID],
  );
  dbModule.sqliteRun(
    `INSERT INTO memories (
       id, user_id, type, key, value, source, confidence, priority,
       workspace_root, team_workspace_id, role_layers_json, enabled, created_at, updated_at
     ) VALUES (
       'm-pm1-aux', ?, 'project_context', 'knowledge:pm1-aux',
       'PM1 产物链辅助模型必须使用的工作区知识。', 'manual', 1, 90,
       NULL, ?, '["pm1"]', 1, datetime('now'), datetime('now')
     )`,
    [USER_ID, TEAM_WORKSPACE_ID],
  );
  dbModule.sqliteRun(
    `INSERT INTO memories (
       id, user_id, type, key, value, source, confidence, priority,
       workspace_root, team_workspace_id, role_layers_json, enabled, created_at, updated_at
     ) VALUES (
       'm-pm1-aux-executor', ?, 'project_context', 'knowledge:executor-only',
       '执行层专用知识不应进入 PM1 产物链。', 'manual', 1, 80,
       NULL, ?, '["executor"]', 1, datetime('now'), datetime('now')
     )`,
    [USER_ID, TEAM_WORKSPACE_ID],
  );
  mocks.resolveAuxiliaryLlmConfig.mockReset();
  mocks.resolveAuxiliaryLlmConfig.mockResolvedValue({
    apiBaseUrl: 'https://llm.example.test/v1',
    apiKey: 'sk-test',
    model: 'model-test',
    providerType: 'openai',
  });
  mocks.requestWorkflowLlmCompletion.mockClear();
  mocks.requestPrompts.length = 0;
  mocks.runArtifactChain.mockClear();
});

afterAll(async () => {
  await dbModule.closeDb();
});

describe('createPhaseCAwareRunner PM1 auxiliary knowledge', () => {
  it('PM1 产物链辅助 LLM prompt 注入当前层可读的工作区知识', async () => {
    const handoff = store.createHandoff({
      userId: USER_ID,
      fromSessionId: RECEPTION_SESSION_ID,
      fromRoleLayer: 'reception',
      toRoleLayer: 'pm1',
      payload: {
        sourceIntent: '优化知识图谱',
        rewrittenIntent: '优化工作区知识图谱',
        teamWorkspaceId: TEAM_WORKSPACE_ID,
      },
    });

    const runner = pm1RunnerModule.createPhaseCAwareRunner();
    await runner({
      handoff,
      toSessionId: PM1_SESSION_ID,
      signal: new AbortController().signal,
    });

    expect(mocks.runArtifactChain).toHaveBeenCalledOnce();
    const prompt = mocks.requestPrompts[0] ?? '';
    expect(prompt).toContain('workspace-knowledge:pm1');
    expect(prompt).toContain('PM1 产物链辅助模型必须使用的工作区知识。');
    expect(prompt).not.toContain('执行层专用知识不应进入 PM1 产物链。');
  });
});
