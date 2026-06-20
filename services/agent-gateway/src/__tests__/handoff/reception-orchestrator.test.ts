/**
 * 260518-team-l1.3 · reception-orchestrator 单元测试
 *
 * 覆盖：
 *   - feature flag 关闭 → triggered=false
 *   - reception session 已有活跃 handoff → triggered=false（避免并行链路）
 *   - 无 LLM 配置 → triggered=false
 *   - 成功路径下不易在单元测试覆盖（需要 mock LLM HTTP），但可以验证基础守卫
 */

import { mkdtempSync, mkdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type * as DbModule from '../../infra/db.js';
import type * as OrchestratorModule from '../../handoff/runner/reception-orchestrator.js';
import type * as HandoffStoreModule from '../../handoff/store/handoff-store.js';
import type * as PlannerModule from '../../team/init/team-init-planner.js';
import type * as MemoryStoreModule from '../../memory/memory-store.js';

const llmCompletion = vi.fn(async ({ prompt }: { prompt: string }) => {
  if (prompt.includes('团队工具配置专家')) {
    return JSON.stringify({
      executor: { skillIds: [], mcpServerIds: [], rationale: '测试：空工具池' },
      pm1: { skillIds: [], mcpServerIds: [], rationale: '测试：无需 MCP' },
      pm2: { skillIds: [], mcpServerIds: [], rationale: '测试：无需 MCP' },
    });
  }
  if (prompt.includes('初始项目记忆骨架')) {
    return '# 项目记忆\n- 目标：创建一个任务看板';
  }
  return '【改写结果】创建一个任务看板\n【推荐角色】planner\n【下一步】拆解任务并派发执行';
});

vi.mock('../../routes/workflow-llm.js', () => ({
  requestWorkflowLlmCompletion: (cfg: { prompt: string }) => llmCompletion(cfg),
}));

process.env['DATABASE_URL'] = ':memory:';
process.env['OPENAWORK_APP_VERSION'] = '0.0.0-test';

let dbModule: typeof DbModule;
let orchestrator: typeof OrchestratorModule;
let handoffStore: typeof HandoffStoreModule;
let planner: typeof PlannerModule;
let memoryStore: typeof MemoryStoreModule;

const USER_ID = 'u-orch';
const SESSION_ID = 's-orch-reception';
const TEAM_WORKSPACE_ID = 'tw-orch';
const workspaceRoots: string[] = [];

function seedUser(): void {
  dbModule.sqliteRun("INSERT OR IGNORE INTO users (id, email, password_hash) VALUES (?, ?, 'x')", [
    USER_ID,
    'orch@example.com',
  ]);
}

function seedReception(): void {
  dbModule.sqliteRun(
    `INSERT OR IGNORE INTO sessions (id, user_id, title, metadata_json, role_layer)
     VALUES (?, ?, 'reception', '{}', 'reception')`,
    [SESSION_ID, USER_ID],
  );
}

async function seedEmptyReceptionWithInit(sessionId: string, workingRoot: string): Promise<void> {
  const teamInit = await planner.planTeamInit({
    workingRoot,
    teamWorkspaceId: TEAM_WORKSPACE_ID,
    userId: USER_ID,
  });
  dbModule.sqliteRun(
    `INSERT OR REPLACE INTO sessions (id, user_id, title, metadata_json, role_layer)
     VALUES (?, ?, 'empty reception', ?, 'reception')`,
    [
      sessionId,
      USER_ID,
      JSON.stringify({
        teamWorkspaceId: TEAM_WORKSPACE_ID,
        workingDirectory: workingRoot,
        teamInit,
        teamDefinition: {
          version: 2,
          source: { kind: 'blank' },
          requiredRoleBindings: [],
          memberSlots: [{ id: 'exec', layer: 'executor' }],
        },
      }),
    ],
  );
}

function listSessionTextParts(sessionId: string): string[] {
  const rows = dbModule.sqliteAll<{ data: string }>(
    `SELECT data
       FROM part_v2
      WHERE session_id = ?
      ORDER BY time_created ASC, id ASC`,
    [sessionId],
  );
  return rows
    .map((row) => {
      try {
        const data = JSON.parse(row.data) as Record<string, unknown>;
        return data['type'] === 'text' && typeof data['text'] === 'string' ? data['text'] : null;
      } catch {
        return null;
      }
    })
    .filter((text): text is string => text !== null);
}

beforeAll(async () => {
  dbModule = await import('../../infra/db.js');
  await dbModule.migrate();
  orchestrator = await import('../../handoff/runner/reception-orchestrator.js');
  handoffStore = await import('../../handoff/store/handoff-store.js');
  planner = await import('../../team/init/team-init-planner.js');
  memoryStore = await import('../../memory/memory-store.js');
});

beforeEach(() => {
  dbModule.sqliteRun('DELETE FROM handoff_records', []);
  dbModule.sqliteRun('DELETE FROM message_v2', []);
  dbModule.sqliteRun('DELETE FROM part_v2', []);
  dbModule.sqliteRun('DELETE FROM sessions', []);
  dbModule.sqliteRun('DELETE FROM users', []);
  // 注意：message_v2 / part_v2 由 ON DELETE CASCADE 通过 sessions / users 清理
  seedUser();
  seedReception();
});

afterEach(() => {
  // 清理任何残留环境变量
  delete process.env['AI_API_BASE_URL'];
  delete process.env['AI_API_KEY'];
  delete process.env['AI_DEFAULT_MODEL'];
  llmCompletion.mockClear();
});

afterAll(async () => {
  await dbModule.closeDb();
  for (const root of workspaceRoots) {
    rmSync(root, { recursive: true, force: true });
  }
});

describe('orchestrateReceptionInput', () => {
  it('reception 会话已有活跃 handoff → triggered=false（避免并行链路）', async () => {
    handoffStore.createHandoff({
      userId: USER_ID,
      fromSessionId: SESSION_ID,
      fromRoleLayer: 'reception',
      toRoleLayer: 'pm1',
      payload: { sourceIntent: 'pre-existing' },
    });
    const result = await orchestrator.orchestrateReceptionInput({
      userId: USER_ID,
      receptionSessionId: SESSION_ID,
      userIntent: '又来了',
    });
    expect(result.triggered).toBe(false);
    expect(result.reason).toBe('handoff-active');
  });

  it('无 LLM 配置 → triggered=false（reason=no-llm-config）', async () => {
    // 强制让 resolveAuxiliaryLlmConfig 返回 null：删除所有可能的 LLM 配置源
    delete process.env['OPENAI_API_KEY'];
    delete process.env['OPENAI_API_BASE_URL'];
    delete process.env['ANTHROPIC_API_KEY'];
    delete process.env['LLM_API_KEY'];
    delete process.env['LLM_API_BASE_URL'];
    delete process.env['AUXILIARY_LLM_API_KEY'];
    delete process.env['AUXILIARY_LLM_API_BASE_URL'];

    // 使用"你好"触发 direct 路径（规则匹配问候语），避免走 orchestrate 的 LLM 调用
    const result = await orchestrator.orchestrateReceptionInput({
      userId: USER_ID,
      receptionSessionId: SESSION_ID,
      userIntent: '你好',
    });
    // "你好" 会被 router 分到 direct → 尝试 runSessionInBackground
    // 如果 session 不存在或 LLM 不可用，会 catch 并返回
    expect(result.triggered).toBe(false);
  }, 10_000);

  it('并发编排同一 reception 会话时只创建一条 handoff（in-flight 守卫，防并行 pm1 链路）', async () => {
    // 无 LLM 配置：body 在 await resolveAuxiliaryLlmConfig 后立刻返回 no-llm-config。
    // 第一次调用同步取得 in-flight 守卫后在该 await 处让出事件循环；第二次调用同步
    // 跑到守卫检查时发现已被占用，确定性地返回 orchestration-in-flight——不会越过
    // active-handoff 的 TOCTOU 窗口再创建第二条 reception→pm1 handoff。
    delete process.env['OPENAI_API_KEY'];
    delete process.env['OPENAI_API_BASE_URL'];
    delete process.env['ANTHROPIC_API_KEY'];
    delete process.env['LLM_API_KEY'];
    delete process.env['LLM_API_BASE_URL'];
    delete process.env['AUXILIARY_LLM_API_KEY'];
    delete process.env['AUXILIARY_LLM_API_BASE_URL'];

    const [first, second] = await Promise.all([
      orchestrator.orchestrateReceptionInput({
        userId: USER_ID,
        receptionSessionId: SESSION_ID,
        userIntent: '帮我重构这个后端模块',
        persistMessages: false,
      }),
      orchestrator.orchestrateReceptionInput({
        userId: USER_ID,
        receptionSessionId: SESSION_ID,
        userIntent: '帮我重构这个后端模块',
        persistMessages: false,
      }),
    ]);

    const inFlightRejections = [first, second].filter(
      (r) => r.reason === 'orchestration-in-flight',
    );
    // 恰好一个被 in-flight 守卫挡下（另一个进入 body，因无 LLM 配置返回 no-llm-config）。
    expect(inFlightRejections).toHaveLength(1);
    // 两者都没真正创建 handoff（无 LLM 配置），但关键不变量是：第二个被守卫确定性挡下，
    // 绝不会与第一个并行越过 active-handoff 检查去 createHandoff。
    expect([first, second].some((r) => r.triggered)).toBe(false);
  }, 10_000);

  it('空项目首次真实任务前写入初始化状态提示，并继续派发 handoff', async () => {
    process.env['AI_API_BASE_URL'] = 'https://example.test/v1';
    process.env['AI_API_KEY'] = 'sk-test';
    process.env['AI_DEFAULT_MODEL'] = 'gpt-test';

    const root = mkdtempSync(join(tmpdir(), 'openawork-orch-empty-'));
    workspaceRoots.push(root);
    const workingRoot = join(root, 'empty-project');
    mkdirSync(workingRoot, { recursive: true });
    await seedEmptyReceptionWithInit('s-orch-empty', workingRoot);

    const result = await orchestrator.orchestrateReceptionInput({
      userId: USER_ID,
      receptionSessionId: 's-orch-empty',
      userIntent: '帮我创建一个任务看板',
      teamWorkspaceId: TEAM_WORKSPACE_ID,
      persistUserMessage: false,
      persistAckMessage: true,
    });

    expect(result.triggered).toBe(true);
    const texts = listSessionTextParts('s-orch-empty');
    expect(texts.some((text) => text.includes('空项目') && text.includes('绑定合适工具'))).toBe(
      true,
    );
    expect(texts.some((text) => text.includes('团队开始接管'))).toBe(true);

    const handoffs = dbModule.sqliteAll<{ id: string }>(
      `SELECT id FROM handoff_records WHERE from_session_id = ? AND to_role_layer = 'pm1'`,
      ['s-orch-empty'],
    );
    expect(handoffs).toHaveLength(1);
  }, 10_000);

  it('输入过短触发 clarify 时写入专用提示文案', async () => {
    process.env['AI_API_BASE_URL'] = 'https://example.test/v1';
    process.env['AI_API_KEY'] = 'sk-test';
    process.env['AI_DEFAULT_MODEL'] = 'gpt-test';

    const result = await orchestrator.orchestrateReceptionInput({
      userId: USER_ID,
      receptionSessionId: SESSION_ID,
      userIntent: '嗯',
      persistUserMessage: false,
      persistAckMessage: true,
    });

    expect(result.triggered).toBe(false);
    expect(result.reason).toBe('clarify-needed');

    const texts = listSessionTextParts(SESSION_ID);
    expect(texts.some((text) => text.includes('输入的内容太少了'))).toBe(true);
    expect(texts.some((text) => text.includes('帮我解释 XX'))).toBe(true);
    expect(texts.some((text) => text.includes('输入过短'))).toBe(true);
  });

  it('意图改写辅助 LLM prompt 注入 reception 可读工作区知识', async () => {
    process.env['AI_API_BASE_URL'] = 'https://example.test/v1';
    process.env['AI_API_KEY'] = 'sk-test';
    process.env['AI_DEFAULT_MODEL'] = 'gpt-test';

    dbModule.sqliteRun(`UPDATE sessions SET metadata_json = ? WHERE id = ?`, [
      JSON.stringify({ teamWorkspaceId: TEAM_WORKSPACE_ID }),
      SESSION_ID,
    ]);
    memoryStore.createMemory(USER_ID, {
      key: 'knowledge:reception-only',
      roleLayers: ['reception'],
      source: 'manual',
      teamWorkspaceId: TEAM_WORKSPACE_ID,
      type: 'project_context',
      value: '接待层改写模型必须使用的工作区知识。',
    });
    memoryStore.createMemory(USER_ID, {
      key: 'knowledge:pm1-only',
      roleLayers: ['pm1'],
      source: 'manual',
      teamWorkspaceId: TEAM_WORKSPACE_ID,
      type: 'project_context',
      value: 'PM1 专用知识不应进入接待层改写模型。',
    });

    const result = await orchestrator.orchestrateReceptionInput({
      userId: USER_ID,
      receptionSessionId: SESSION_ID,
      userIntent: '优化团队知识图谱展示和入库流程',
      teamWorkspaceId: TEAM_WORKSPACE_ID,
      persistUserMessage: false,
      persistAckMessage: false,
      autoRunInit: false,
    });

    expect(result.triggered).toBe(true);
    const prompts = llmCompletion.mock.calls.map((call) => call[0].prompt);
    const rewritePrompt = prompts.find((prompt) => prompt.includes('团队协作交互代理'));
    expect(rewritePrompt).toContain('workspace-knowledge:reception');
    expect(rewritePrompt).toContain('接待层改写模型必须使用的工作区知识。');
    expect(rewritePrompt).not.toContain('PM1 专用知识不应进入接待层改写模型。');
  }, 10_000);
});
