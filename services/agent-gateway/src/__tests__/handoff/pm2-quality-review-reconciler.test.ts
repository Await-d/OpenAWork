import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type * as DbModule from '../../infra/db.js';
import type * as HandoffStoreModule from '../../handoff/store/handoff-store.js';
import type * as Pm2QualityReviewModule from '../../handoff/runner/pm2-quality-review-reconciler.js';
import type * as WorkflowLlmModule from '../../routes/workflow-llm.js';

const mocks = vi.hoisted(() => ({
  resolveAuxiliaryLlmConfig: vi.fn(),
  resolveAuxiliaryLlmConfigCandidates: vi.fn(),
  requestWorkflowLlmCompletion: vi.fn(),
}));

vi.mock('../../provider/auxiliary-llm-config.js', () => ({
  resolveAuxiliaryLlmConfig: mocks.resolveAuxiliaryLlmConfig,
  resolveAuxiliaryLlmConfigCandidates: mocks.resolveAuxiliaryLlmConfigCandidates,
}));

vi.mock('../../routes/workflow-llm.js', async (importOriginal) => {
  const actual = await importOriginal<typeof WorkflowLlmModule>();
  return {
    ...actual,
    requestWorkflowLlmCompletion: mocks.requestWorkflowLlmCompletion,
  };
});

process.env['DATABASE_URL'] = ':memory:';
process.env['OPENAWORK_APP_VERSION'] = '0.0.0-test';

let dbModule: typeof DbModule;
let store: typeof HandoffStoreModule;
let reconciler: typeof Pm2QualityReviewModule;

const USER_ID = 'u-pm2-quality-review';
const PM1_SESSION_ID = 's-pm2-quality-review-parent';
const PM2_SESSION_ID = 's-pm2-quality-review';
const TEAM_WORKSPACE_ID = 'tw-pm2-quality-review';

function seedUser(id: string, email: string): void {
  dbModule.sqliteRun("INSERT OR IGNORE INTO users (id, email, password_hash) VALUES (?, ?, 'x')", [
    id,
    email,
  ]);
}

function seedSession(sessionId: string, roleLayer = 'pm2'): void {
  dbModule.sqliteRun(
    `INSERT OR IGNORE INTO sessions (id, user_id, title, metadata_json, role_layer)
     VALUES (?, ?, 'demo', '{}', ?)`,
    [sessionId, USER_ID, roleLayer],
  );
}

function seedCompletedChild(input: {
  childSessionId: string;
  fromSessionId: string;
  goal?: string;
  ownedPaths?: string[];
  roleLayer: 'executor' | 'reviewer';
  taskId?: string;
  token: string;
}): HandoffStoreModule.HandoffRecord {
  seedSession(input.childSessionId, input.roleLayer);
  const goal = input.goal ?? `[demo/${input.roleLayer}.md] 完成 ${input.roleLayer} 任务 - 产出结果`;
  const taskId = input.taskId ?? `T-${input.roleLayer}`;
  const child = store.createHandoff({
    userId: USER_ID,
    fromSessionId: input.fromSessionId,
    fromRoleLayer: 'pm2',
    toRoleLayer: input.roleLayer,
    payload: {
      goal,
      ownedPaths: input.ownedPaths,
      taskMarkers: { taskId },
    },
  });
  store.claimHandoff({ handoffId: child.id, claimToken: input.token });
  store.startHandoff({
    handoffId: child.id,
    claimToken: input.token,
    toSessionId: input.childSessionId,
  });
  dbModule.sqliteRun(`UPDATE handoff_records SET result_json = ? WHERE id = ?`, [
    JSON.stringify({
      role: input.roleLayer,
      taskTitle: goal,
      summary: `${input.roleLayer} 已提交结果摘要。`,
      artifactCount: 1,
      evidenceSource: 'summary',
      protocol: 'stream',
    }),
    child.id,
  ]);
  store.completeHandoff({ handoffId: child.id, claimToken: input.token });
  return child;
}

beforeAll(async () => {
  dbModule = await import('../../infra/db.js');
  await dbModule.migrate();
  store = await import('../../handoff/store/handoff-store.js');
  reconciler = await import('../../handoff/runner/pm2-quality-review-reconciler.js');
});

beforeEach(() => {
  dbModule.sqliteRun('DELETE FROM artifacts', []);
  dbModule.sqliteRun('DELETE FROM handoff_records', []);
  dbModule.sqliteRun('DELETE FROM sessions', []);
  dbModule.sqliteRun('DELETE FROM users', []);
  seedUser(USER_ID, 'pm2-quality-review@example.com');
  dbModule.sqliteRun(
    `INSERT INTO team_workspaces (id, user_id, name)
     VALUES (?, ?, 'PM2 质量复核工作区')`,
    [TEAM_WORKSPACE_ID, USER_ID],
  );
  dbModule.sqliteRun(
    `INSERT INTO memories (
       id, user_id, type, key, value, source, confidence, priority,
       workspace_root, team_workspace_id, role_layers_json, enabled, created_at, updated_at
     ) VALUES (
       'm-pm2-quality', ?, 'project_context', 'knowledge:pm2-quality',
       'PM2 质量复核辅助模型必须使用的工作区知识。', 'manual', 1, 90,
       NULL, ?, '["pm2"]', 1, datetime('now'), datetime('now')
     )`,
    [USER_ID, TEAM_WORKSPACE_ID],
  );
  seedSession(PM1_SESSION_ID, 'pm1');
  seedSession(PM2_SESSION_ID, 'pm2');
  mocks.resolveAuxiliaryLlmConfig.mockReset();
  mocks.resolveAuxiliaryLlmConfigCandidates.mockReset();
  mocks.requestWorkflowLlmCompletion.mockReset();
});

afterAll(async () => {
  await dbModule.closeDb();
});

describe('reconcilePm2QualityReview', () => {
  it('首个辅助 LLM 候选返回 Invalid JSON response 时，会尝试下一个候选并完成评审', async () => {
    mocks.resolveAuxiliaryLlmConfigCandidates.mockResolvedValue([
      {
        apiBaseUrl: 'https://broken.example.com/v1',
        apiKey: 'broken-key',
        model: 'broken-model',
        providerType: 'openai',
      },
      {
        apiBaseUrl: 'https://healthy.example.com/v1',
        apiKey: 'healthy-key',
        model: 'healthy-model',
        providerType: 'openai',
      },
    ]);
    mocks.requestWorkflowLlmCompletion.mockImplementation(
      async (input: WorkflowLlmModule.WorkflowLlmRequestConfig) => {
        if (input.apiBaseUrl.includes('broken.example.com')) {
          throw new Error('Invalid JSON response');
        }
        return 'PASS';
      },
    );

    const pm2 = store.createHandoff({
      userId: USER_ID,
      fromSessionId: PM1_SESSION_ID,
      fromRoleLayer: 'pm1',
      toRoleLayer: 'pm2',
      payload: { teamWorkspaceId: TEAM_WORKSPACE_ID },
    });
    store.claimHandoff({ handoffId: pm2.id, claimToken: 'tok-pm2' });
    store.startHandoff({
      handoffId: pm2.id,
      claimToken: 'tok-pm2',
      toSessionId: PM2_SESSION_ID,
    });
    const executor = seedCompletedChild({
      childSessionId: 's-pm2-quality-review-executor',
      fromSessionId: PM2_SESSION_ID,
      roleLayer: 'executor',
      token: 'tok-executor',
    });
    const reviewer = seedCompletedChild({
      childSessionId: 's-pm2-quality-review-reviewer',
      fromSessionId: PM2_SESSION_ID,
      roleLayer: 'reviewer',
      token: 'tok-reviewer',
    });
    dbModule.sqliteRun(
      `UPDATE handoff_records
          SET result_json = ?
        WHERE id = ?`,
      [
        JSON.stringify({
          dispatchedHandoffIds: [executor.id, reviewer.id],
          qualityReviewPending: true,
        }),
        pm2.id,
      ],
    );

    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    let result: Awaited<ReturnType<typeof reconciler.reconcilePm2QualityReview>>;
    try {
      result = await reconciler.reconcilePm2QualityReview({
        pm2HandoffId: pm2.id,
        userId: USER_ID,
      });
    } finally {
      warn.mockRestore();
    }

    expect(result.status).toBe('completed');
    const after = store.getHandoff({ userId: USER_ID, handoffId: pm2.id });
    expect(after?.state).toBe('completed');
    const baseUrls = mocks.requestWorkflowLlmCompletion.mock.calls.map(
      (call) => (call[0] as WorkflowLlmModule.WorkflowLlmRequestConfig).apiBaseUrl,
    );
    expect(baseUrls.filter((url) => url.includes('broken.example.com'))).toHaveLength(2);
    expect(baseUrls.filter((url) => url.includes('healthy.example.com'))).toHaveLength(2);
    const prompts = mocks.requestWorkflowLlmCompletion.mock.calls.map(
      (call) => (call[0] as WorkflowLlmModule.WorkflowLlmRequestConfig).prompt,
    );
    expect(prompts.every((prompt) => prompt.includes('workspace-knowledge:pm2'))).toBe(true);
    expect(
      prompts.every((prompt) => prompt.includes('PM2 质量复核辅助模型必须使用的工作区知识。')),
    ).toBe(true);
  });

  it('quality review 只命中当前 dispatch scope 时，仍允许自动 redispatch', async () => {
    mocks.resolveAuxiliaryLlmConfigCandidates.mockResolvedValue([
      {
        apiBaseUrl: 'https://healthy.example.com/v1',
        apiKey: 'healthy-key',
        model: 'healthy-model',
        providerType: 'openai',
      },
    ]);
    mocks.requestWorkflowLlmCompletion.mockImplementation(
      async (input: WorkflowLlmModule.WorkflowLlmRequestConfig) => {
        if (input.prompt.includes('Spec Review 审查员')) {
          return 'PASS';
        }
        return 'ISSUE: [apps/web/src/current-form.tsx] 当前任务文件测试失败';
      },
    );

    const pm2 = store.createHandoff({
      userId: USER_ID,
      fromSessionId: PM1_SESSION_ID,
      fromRoleLayer: 'pm1',
      toRoleLayer: 'pm2',
      payload: { teamWorkspaceId: TEAM_WORKSPACE_ID },
    });
    store.claimHandoff({ handoffId: pm2.id, claimToken: 'tok-pm2-scope-ok' });
    store.startHandoff({
      handoffId: pm2.id,
      claimToken: 'tok-pm2-scope-ok',
      toSessionId: PM2_SESSION_ID,
    });
    const executor = seedCompletedChild({
      childSessionId: 's-pm2-quality-review-executor-scope-ok',
      fromSessionId: PM2_SESSION_ID,
      goal: '[apps/web/src/current-form.tsx] 实现当前表单 - 可提交并校验',
      ownedPaths: ['apps/web/src/current-form.tsx'],
      roleLayer: 'executor',
      taskId: 'T-current-form',
      token: 'tok-executor-scope-ok',
    });
    const reviewer = seedCompletedChild({
      childSessionId: 's-pm2-quality-review-reviewer-scope-ok',
      fromSessionId: PM2_SESSION_ID,
      goal: '[apps/web/src/current-form.tsx] 评审当前表单 - 验证交互与测试',
      ownedPaths: ['apps/web/src/current-form.tsx'],
      roleLayer: 'reviewer',
      taskId: 'T-current-form-review',
      token: 'tok-reviewer-scope-ok',
    });
    dbModule.sqliteRun(
      `UPDATE handoff_records
          SET result_json = ?
        WHERE id = ?`,
      [
        JSON.stringify({
          dispatchedHandoffIds: [executor.id, reviewer.id],
          qualityReviewPending: true,
        }),
        pm2.id,
      ],
    );

    const result = await reconciler.reconcilePm2QualityReview({
      pm2HandoffId: pm2.id,
      userId: USER_ID,
    });

    expect(result.status).toBe('reclaimed');
    const after = store.getHandoff({ userId: USER_ID, handoffId: pm2.id });
    expect(after?.state).toBe('pending');
    expect(after?.retryCount).toBe(1);
  });

  it('quality review 只命中当前 dispatch scope 外的文件时，不自动 redispatch', async () => {
    mocks.resolveAuxiliaryLlmConfigCandidates.mockResolvedValue([
      {
        apiBaseUrl: 'https://healthy.example.com/v1',
        apiKey: 'healthy-key',
        model: 'healthy-model',
        providerType: 'openai',
      },
    ]);
    mocks.requestWorkflowLlmCompletion.mockImplementation(
      async (input: WorkflowLlmModule.WorkflowLlmRequestConfig) => {
        if (input.prompt.includes('Spec Review 审查员')) {
          return 'PASS';
        }
        return 'ISSUE: [apps/web/src/external-shared-file.tsx] 外部并发修改导致当前检查失败';
      },
    );

    const pm2 = store.createHandoff({
      userId: USER_ID,
      fromSessionId: PM1_SESSION_ID,
      fromRoleLayer: 'pm1',
      toRoleLayer: 'pm2',
      payload: { teamWorkspaceId: TEAM_WORKSPACE_ID },
    });
    store.claimHandoff({ handoffId: pm2.id, claimToken: 'tok-pm2-scope-blocked' });
    store.startHandoff({
      handoffId: pm2.id,
      claimToken: 'tok-pm2-scope-blocked',
      toSessionId: PM2_SESSION_ID,
    });
    const executor = seedCompletedChild({
      childSessionId: 's-pm2-quality-review-executor-scope-blocked',
      fromSessionId: PM2_SESSION_ID,
      goal: '[apps/web/src/current-panel.tsx] 实现当前面板 - 可展示状态',
      ownedPaths: ['apps/web/src/current-panel.tsx'],
      roleLayer: 'executor',
      taskId: 'T-current-panel',
      token: 'tok-executor-scope-blocked',
    });
    const reviewer = seedCompletedChild({
      childSessionId: 's-pm2-quality-review-reviewer-scope-blocked',
      fromSessionId: PM2_SESSION_ID,
      goal: '[apps/web/src/current-panel.tsx] 评审当前面板 - 验证行为与回归',
      ownedPaths: ['apps/web/src/current-panel.tsx'],
      roleLayer: 'reviewer',
      taskId: 'T-current-panel-review',
      token: 'tok-reviewer-scope-blocked',
    });
    dbModule.sqliteRun(
      `UPDATE handoff_records
          SET result_json = ?
        WHERE id = ?`,
      [
        JSON.stringify({
          dispatchedHandoffIds: [executor.id, reviewer.id],
          qualityReviewPending: true,
        }),
        pm2.id,
      ],
    );

    const result = await reconciler.reconcilePm2QualityReview({
      pm2HandoffId: pm2.id,
      userId: USER_ID,
    });

    expect(result.status).toBe('failed');
    const after = store.getHandoff({ userId: USER_ID, handoffId: pm2.id });
    expect(after?.state).toBe('failed');
    expect(after?.failureReason).toContain('当前 PM2 派发范围外的文件');
    const payload =
      after?.payload && typeof after.payload === 'object' && !Array.isArray(after.payload)
        ? (after.payload as Record<string, unknown>)
        : null;
    const reviewDisposition =
      payload?.['reviewDisposition'] &&
      typeof payload['reviewDisposition'] === 'object' &&
      payload['reviewDisposition'] !== null &&
      !Array.isArray(payload['reviewDisposition'])
        ? (payload['reviewDisposition'] as Record<string, unknown>)
        : null;
    expect(reviewDisposition?.['action']).toBe('escalate-to-user');
  });

  it('spec review 只命中当前 dispatch scope 外的文件时，不自动 return-to-c', async () => {
    mocks.resolveAuxiliaryLlmConfigCandidates.mockResolvedValue([
      {
        apiBaseUrl: 'https://healthy.example.com/v1',
        apiKey: 'healthy-key',
        model: 'healthy-model',
        providerType: 'openai',
      },
    ]);
    mocks.requestWorkflowLlmCompletion.mockImplementation(
      async (input: WorkflowLlmModule.WorkflowLlmRequestConfig) => {
        if (input.prompt.includes('Spec Review 审查员')) {
          return 'ISSUE: [apps/web/src/external-plan.ts] 外部规划文件和当前实现不一致';
        }
        return 'PASS';
      },
    );

    const pm2 = store.createHandoff({
      userId: USER_ID,
      fromSessionId: PM1_SESSION_ID,
      fromRoleLayer: 'pm1',
      toRoleLayer: 'pm2',
      payload: { teamWorkspaceId: TEAM_WORKSPACE_ID },
    });
    store.claimHandoff({ handoffId: pm2.id, claimToken: 'tok-pm2-return-to-c-blocked' });
    store.startHandoff({
      handoffId: pm2.id,
      claimToken: 'tok-pm2-return-to-c-blocked',
      toSessionId: PM2_SESSION_ID,
    });
    const executor = seedCompletedChild({
      childSessionId: 's-pm2-quality-review-executor-return-to-c-blocked',
      fromSessionId: PM2_SESSION_ID,
      goal: '[apps/web/src/current-panel.tsx] 实现当前面板 - 可展示状态',
      ownedPaths: ['apps/web/src/current-panel.tsx'],
      roleLayer: 'executor',
      taskId: 'T-current-panel',
      token: 'tok-executor-return-to-c-blocked',
    });
    const reviewer = seedCompletedChild({
      childSessionId: 's-pm2-quality-review-reviewer-return-to-c-blocked',
      fromSessionId: PM2_SESSION_ID,
      goal: '[apps/web/src/current-panel.tsx] 评审当前面板 - 验证行为与回归',
      ownedPaths: ['apps/web/src/current-panel.tsx'],
      roleLayer: 'reviewer',
      taskId: 'T-current-panel-review',
      token: 'tok-reviewer-return-to-c-blocked',
    });
    dbModule.sqliteRun(
      `UPDATE handoff_records
          SET result_json = ?
        WHERE id = ?`,
      [
        JSON.stringify({
          dispatchedHandoffIds: [executor.id, reviewer.id],
          qualityReviewPending: true,
        }),
        pm2.id,
      ],
    );

    const result = await reconciler.reconcilePm2QualityReview({
      pm2HandoffId: pm2.id,
      userId: USER_ID,
    });

    expect(result.status).toBe('failed');
    const after = store.getHandoff({ userId: USER_ID, handoffId: pm2.id });
    expect(after?.state).toBe('failed');
    expect(after?.failureReason).toContain('当前 PM2 派发范围外的文件');
    const payload =
      after?.payload && typeof after.payload === 'object' && !Array.isArray(after.payload)
        ? (after.payload as Record<string, unknown>)
        : null;
    const reviewDisposition =
      payload?.['reviewDisposition'] &&
      typeof payload['reviewDisposition'] === 'object' &&
      payload['reviewDisposition'] !== null &&
      !Array.isArray(payload['reviewDisposition'])
        ? (payload['reviewDisposition'] as Record<string, unknown>)
        : null;
    expect(reviewDisposition?.['action']).toBe('escalate-to-user');
  });
});
