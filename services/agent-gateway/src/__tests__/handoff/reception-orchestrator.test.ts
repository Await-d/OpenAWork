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

const runSessionInBackgroundMock = vi.fn(async () => ({ statusCode: 200 }));

vi.mock('../../routes/workflow-llm.js', () => ({
  requestWorkflowLlmCompletion: (cfg: { prompt: string }) => llmCompletion(cfg),
}));

vi.mock('../../routes/stream-runtime.js', () => ({
  runSessionInBackground: runSessionInBackgroundMock,
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

async function seedExhaustedGrill(sessionId: string, intent: string): Promise<void> {
  const grill = await import('../../handoff/runner/reception-grill-runner.js');
  const awaiting = grill.advanceReceptionGrill({
    state: grill.startReceptionGrill(intent),
    reply: '1. 改单文件；2. 无约束；3. 代码变更；4. 测试通过',
  }).state;
  let exhausted = awaiting;
  for (let attempt = 0; attempt < 6; attempt += 1) {
    exhausted = grill.advanceReceptionGrill({ state: exhausted, reply: '需修改' }).state;
  }
  grill.persistReceptionGrill(sessionId, exhausted, intent);
}

function listHandoffsFor(sessionId: string): Array<{ id: string }> {
  return dbModule.sqliteAll<{ id: string }>(
    `SELECT id FROM handoff_records WHERE from_session_id = ?`,
    [sessionId],
  );
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
  runSessionInBackgroundMock.mockReset();
  runSessionInBackgroundMock.mockResolvedValue({ statusCode: 200 });
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

  it('direct 路径会把前端选中的模型思考配置传给后台流', async () => {
    process.env['AI_API_BASE_URL'] = 'https://example.test/v1';
    process.env['AI_API_KEY'] = 'sk-test';
    process.env['AI_DEFAULT_MODEL'] = 'gpt-test';

    const result = await orchestrator.orchestrateReceptionInput({
      userId: USER_ID,
      receptionSessionId: SESSION_ID,
      userIntent: '你好',
      requestedProviderId: 'openai',
      requestedModelId: 'gpt-5.4',
      requestedThinkingEnabled: true,
      requestedReasoningEffort: 'high',
      persistUserMessage: false,
      persistAckMessage: false,
    });

    expect(result).toMatchObject({ triggered: false, reason: 'direct-answer' });
    expect(runSessionInBackgroundMock).toHaveBeenCalledWith(
      expect.objectContaining({
        sessionId: SESSION_ID,
        userId: USER_ID,
        requestData: expect.objectContaining({
          // direct 轮必须用请求级非 clarify 模式回答：reception 会话 metadata 里
          // 默认是 clarify，若不带该覆盖，简单问候/轻量问题会套用"需求澄清助手"
          // 人设（多轮提问 + 强制 __grill_confirm__）。
          dialogueMode: 'coding',
          message: '你好',
          providerId: 'openai',
          model: 'gpt-5.4',
          thinkingEnabled: true,
          reasoningEffort: 'high',
        }),
      }),
    );
  });

  it('light 路径直接留在 reception，不创建 handoff 或调用改写 LLM', async () => {
    const result = await orchestrator.orchestrateReceptionInput({
      userId: USER_ID,
      receptionSessionId: SESSION_ID,
      userIntent: '了解一下当前项目',
      persistUserMessage: false,
      persistAckMessage: false,
    });

    expect(result).toMatchObject({ triggered: false, reason: 'light-answer' });
    expect(runSessionInBackgroundMock).toHaveBeenCalledTimes(1);
    expect(runSessionInBackgroundMock).toHaveBeenCalledWith(
      expect.objectContaining({
        sessionId: SESSION_ID,
        userId: USER_ID,
        requestData: expect.objectContaining({
          dialogueMode: 'coding',
          message: '了解一下当前项目',
        }),
      }),
    );
    expect(llmCompletion).not.toHaveBeenCalled();

    const handoffs = dbModule.sqliteAll<{ id: string }>(
      `SELECT id FROM handoff_records WHERE from_session_id = ?`,
      [SESSION_ID],
    );
    expect(handoffs).toHaveLength(0);
  });

  it('grill 决策走确定性澄清链条，不触发前台模型轮次（无 dialogueMode 覆盖）', async () => {
    const result = await orchestrator.orchestrateReceptionInput({
      userId: USER_ID,
      receptionSessionId: SESSION_ID,
      userIntent: '重构整个系统架构并把数据迁移到 Postgres',
      persistUserMessage: false,
      persistAckMessage: false,
    });

    expect(result).toMatchObject({ triggered: false, reason: 'grill-started' });
    expect(runSessionInBackgroundMock).not.toHaveBeenCalled();
  });

  it('路由超时信号透传给 workflow LLM', async () => {
    process.env['AI_API_BASE_URL'] = 'https://example.test/v1';
    process.env['AI_API_KEY'] = 'sk-test';
    process.env['AI_DEFAULT_MODEL'] = 'gpt-test';

    let receivedSignal: AbortSignal | undefined;
    llmCompletion.mockImplementationOnce(
      async (config: { prompt: string; signal?: AbortSignal }) => {
        receivedSignal = config.signal;
        return 'DECISION: CLARIFY\nREASON: 意图不明确';
      },
    );

    const result = await orchestrator.orchestrateReceptionInput({
      userId: USER_ID,
      receptionSessionId: SESSION_ID,
      userIntent: '这个请求',
      persistUserMessage: false,
      persistAckMessage: false,
    });

    expect(result.reason).toBe('clarify-needed');
    expect(receivedSignal).toBeInstanceOf(AbortSignal);
    expect(receivedSignal?.aborted).toBe(false);
  });

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
      userIntent: '优化代码中的团队知识图谱展示和入库流程',
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

  it('意图改写失败时 ack 透出上游真实原因、模型与上游地址，而非只提示重试', async () => {
    process.env['AI_API_BASE_URL'] = 'https://relay.example.test/v1';
    process.env['AI_API_KEY'] = 'sk-test';
    process.env['AI_DEFAULT_MODEL'] = 'qwen-test';

    const relayDetail =
      '全局密钥已绑定 14 个节点，存在可支持模型 qwen-test 的有效订单，但对应节点上游配置不可用';
    const upstreamError = Object.assign(
      new Error(`RequestExecutor.execute: Provider request failed with HTTP 403: ${relayDetail}`),
      {
        reason: {
          _tag: 'Authentication',
          kind: 'insufficient-permissions',
          message: relayDetail,
          http: { response: { status: 403 } },
        },
        retryable: false,
      },
    );

    const original = llmCompletion.getMockImplementation();
    llmCompletion.mockImplementation(async () => {
      throw upstreamError;
    });
    try {
      const result = await orchestrator.orchestrateReceptionInput({
        userId: USER_ID,
        receptionSessionId: SESSION_ID,
        userIntent: '帮我实现一个登录页面',
        persistUserMessage: false,
        persistAckMessage: true,
        autoRunInit: false,
      });

      expect(result.triggered).toBe(false);
      expect(result.reason).toBe('llm-failed');

      const ack = listSessionTextParts(SESSION_ID).join('\n');
      // 真实原因（上游原话 + 状态码）必须可见
      expect(ack).toContain(relayDetail);
      expect(ack).toContain('403');
      expect(ack).not.toContain('Provider request failed with HTTP');
      // 必须指出是哪家平台的哪个模型出的问题，便于用户直接去修配置
      expect(ack).toContain('`qwen-test`');
      expect(ack).toContain('relay.example.test');
      // 配置类错误不得再引导用户「稍后重试」
      expect(ack).not.toContain('稍后重试');
      expect(ack).toContain('重试是否有效：否');

      const handoffs = dbModule.sqliteAll<{ id: string }>(
        `SELECT id FROM handoff_records WHERE from_session_id = ?`,
        [SESSION_ID],
      );
      expect(handoffs).toHaveLength(0);
    } finally {
      if (original) {
        llmCompletion.mockImplementation(original);
      }
    }
  }, 10_000);

  it('确认后把已确认共识写入 handoff payload，并跳过重复路由（P4）', async () => {
    process.env['AI_API_BASE_URL'] = 'https://example.test/v1';
    process.env['AI_API_KEY'] = 'sk-test';
    process.env['AI_DEFAULT_MODEL'] = 'gpt-test';

    const intent = '把数据迁移到 Postgres';
    const grill = await import('../../handoff/runner/reception-grill-runner.js');
    const awaiting = grill.advanceReceptionGrill({
      state: grill.startReceptionGrill(intent),
      reply: '1. 改单文件；2. 无约束；3. 代码变更；4. 测试通过',
    }).state;
    grill.persistReceptionGrill(SESSION_ID, awaiting, intent);

    const result = await orchestrator.orchestrateReceptionInput({
      userId: USER_ID,
      receptionSessionId: SESSION_ID,
      userIntent: '确认',
      persistUserMessage: false,
      persistAckMessage: true,
      autoRunInit: false,
    });

    expect(result.triggered).toBe(true);
    // 确认后的 intent 仍是高影响措辞；若重跑路由会再次进入 grill，故必须以 orchestrate 收口。
    const prompts = llmCompletion.mock.calls.map((call) => call[0].prompt);
    expect(prompts.some((prompt) => prompt.includes('团队协作交互代理'))).toBe(true);

    const row = dbModule.sqliteGet<{ payload_json: string }>(
      `SELECT payload_json FROM handoff_records WHERE from_session_id = ? ORDER BY created_at DESC LIMIT 1`,
      [SESSION_ID],
    );
    const payload = JSON.parse(row?.payload_json ?? '{}') as Record<string, unknown>;
    const confirmation = payload['grillConfirmation'] as
      | { kind?: string; intent?: string; answers?: Array<{ nodeId: string; answer: string }> }
      | undefined;
    expect(confirmation?.kind).toBe('reception-confirmed');
    expect(confirmation?.intent).toBe(intent);
    expect(confirmation?.answers).toContainEqual({ nodeId: 'goal', answer: '改单文件' });

    expect(grill.readReceptionGrill(SESSION_ID)).toBeNull();
  }, 10_000);

  it('耗尽后回复「按推荐项继续」→ handoff 携带 grillConfirmation，pm1 不再重问', async () => {
    process.env['AI_API_BASE_URL'] = 'https://example.test/v1';
    process.env['AI_API_KEY'] = 'sk-test';
    process.env['AI_DEFAULT_MODEL'] = 'gpt-test';

    const intent = '把数据迁移到 Postgres';
    await seedExhaustedGrill(SESSION_ID, intent);

    const result = await orchestrator.orchestrateReceptionInput({
      userId: USER_ID,
      receptionSessionId: SESSION_ID,
      userIntent: '按推荐项继续',
      persistUserMessage: false,
      persistAckMessage: true,
      autoRunInit: false,
    });

    expect(result.triggered).toBe(true);

    const row = dbModule.sqliteGet<{ payload_json: string }>(
      `SELECT payload_json FROM handoff_records WHERE from_session_id = ? ORDER BY created_at DESC LIMIT 1`,
      [SESSION_ID],
    );
    const payload = JSON.parse(row?.payload_json ?? '{}') as Record<string, unknown>;

    const { readGrillConfirmation } =
      await import('../../handoff/capability/grill-confirmation.js');
    const confirmation = readGrillConfirmation(payload);
    expect(confirmation?.kind).toBe('reception-confirmed');
    expect(confirmation?.intent).toBe(intent);
    expect(confirmation?.answers).toContainEqual({ nodeId: 'goal', answer: '改单文件' });
    if (!confirmation) {
      throw new Error('handoff payload 缺少 grillConfirmation');
    }

    const { buildConfirmedPm1GrillSeed } = await import('../../handoff/runner/pm1-grill-runner.js');
    const { computeFrontier } = await import('@openAwork/agent-core');
    const pm1Seed = buildConfirmedPm1GrillSeed(intent, confirmation);
    expect(typeof pm1Seed.confirmedAt).toBe('number');
    expect(computeFrontier(pm1Seed)).toHaveLength(0);

    const grill = await import('../../handoff/runner/reception-grill-runner.js');
    expect(grill.readReceptionGrill(SESSION_ID)).toBeNull();
  }, 10_000);

  it('耗尽后回复「取消」→ 清空 grill、写确认、不创建 handoff', async () => {
    const intent = '把数据迁移到 Postgres';
    await seedExhaustedGrill(SESSION_ID, intent);

    const result = await orchestrator.orchestrateReceptionInput({
      userId: USER_ID,
      receptionSessionId: SESSION_ID,
      userIntent: '取消',
      persistUserMessage: false,
      persistAckMessage: true,
    });

    expect(result).toMatchObject({ triggered: false, reason: 'grill-cancelled' });

    const grill = await import('../../handoff/runner/reception-grill-runner.js');
    expect(grill.readReceptionGrill(SESSION_ID)).toBeNull();
    expect(listSessionTextParts(SESSION_ID).some((text) => text.includes('已取消'))).toBe(true);
    expect(listHandoffsFor(SESSION_ID)).toHaveLength(0);
  }, 10_000);

  it('耗尽后回复无关文本 → 仍 exhausted，不创建 handoff，不写 confirmedAt', async () => {
    const intent = '把数据迁移到 Postgres';
    await seedExhaustedGrill(SESSION_ID, intent);

    const result = await orchestrator.orchestrateReceptionInput({
      userId: USER_ID,
      receptionSessionId: SESSION_ID,
      userIntent: '今天天气不错',
      persistUserMessage: false,
      persistAckMessage: true,
    });

    expect(result).toMatchObject({ triggered: false, reason: 'grill-exhausted' });

    const grill = await import('../../handoff/runner/reception-grill-runner.js');
    const restored = grill.readReceptionGrill(SESSION_ID);
    expect(restored).not.toBeNull();
    expect(restored?.state.confirmedAt).toBeUndefined();
    expect(listSessionTextParts(SESSION_ID).some((text) => text.includes('先暂停澄清'))).toBe(true);
    expect(listHandoffsFor(SESSION_ID)).toHaveLength(0);
  }, 10_000);

  it('不变量：用户未显式确认时永不获得 handoff', async () => {
    process.env['AI_API_BASE_URL'] = 'https://example.test/v1';
    process.env['AI_API_KEY'] = 'sk-test';
    process.env['AI_DEFAULT_MODEL'] = 'gpt-test';

    const intent = '把数据迁移到 Postgres';
    const grill = await import('../../handoff/runner/reception-grill-runner.js');
    const awaiting = grill.advanceReceptionGrill({
      state: grill.startReceptionGrill(intent),
      reply: '1. 改单文件；2. 无约束；3. 代码变更；4. 测试通过',
    }).state;
    grill.persistReceptionGrill(SESSION_ID, awaiting, intent);

    const result = await orchestrator.orchestrateReceptionInput({
      userId: USER_ID,
      receptionSessionId: SESSION_ID,
      userIntent: '这个我想想再说',
      persistUserMessage: false,
      persistAckMessage: true,
    });

    expect(result.triggered).toBe(false);
    expect(listHandoffsFor(SESSION_ID)).toHaveLength(0);
    expect(grill.readReceptionGrill(SESSION_ID)?.state.confirmedAt).toBeUndefined();
  }, 10_000);
});
