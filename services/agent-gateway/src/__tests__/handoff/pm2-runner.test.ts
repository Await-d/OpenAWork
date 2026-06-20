import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type * as DbModule from '../../infra/db.js';
import type * as HandoffStoreModule from '../../handoff/store/handoff-store.js';
import type * as Pm2RunnerModule from '../../handoff/runner/pm2-runner.js';
import type * as WorkflowLlmModule from '../../routes/workflow-llm.js';

const mocks = vi.hoisted(() => ({
  requestPrompts: [] as string[],
  requestWorkflowLlmCompletion: vi.fn(async (input: { prompt: string }) => {
    mocks.requestPrompts.push(input.prompt);
    return 'PASS';
  }),
  resolveAuxiliaryLlmConfig: vi.fn(),
}));

vi.mock('../../provider/auxiliary-llm-config.js', () => ({
  resolveAuxiliaryLlmConfig: mocks.resolveAuxiliaryLlmConfig,
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
let pm2RunnerModule: typeof Pm2RunnerModule;

const USER_ID = 'u-pm2-runner';
const PM1_SESSION_ID = 's-pm1-runner';
const PM2_SESSION_ID = 's-pm2-runner';
const TEAM_WORKSPACE_ID = 'tw-pm2-runner';

function seedUser(id: string, email: string): void {
  dbModule.sqliteRun("INSERT OR IGNORE INTO users (id, email, password_hash) VALUES (?, ?, 'x')", [
    id,
    email,
  ]);
}

function seedSession(sessionId: string, userId: string): void {
  dbModule.sqliteRun(
    `INSERT OR IGNORE INTO sessions (id, user_id, title, metadata_json, role_layer)
     VALUES (?, ?, 'demo', '{}', 'pm2')`,
    [sessionId, userId],
  );
}

function seedArtifact(input: {
  artifactId: string;
  sessionId: string;
  userId: string;
  title: string;
  content: string;
  phase: string;
}): void {
  dbModule.sqliteRun(
    `INSERT INTO artifacts (
       id, session_id, user_id, type, title, content, version, phase
     ) VALUES (?, ?, ?, 'markdown', ?, ?, 1, ?)`,
    [input.artifactId, input.sessionId, input.userId, input.title, input.content, input.phase],
  );
}

function buildValidSpec(title = '订单功能'): string {
  return `# 功能规格：${title}

## 用户场景与验收（必填）

### 用户故事 1 — 创建订单（优先级：P1）

用户可以提交订单。

**为什么是这个优先级**：核心主路径。

**独立可测**：调用接口并查看结果。

**验收场景**：

1. **给定** 已选择菜品，**当** 提交订单，**则** 返回订单详情

---

### 边界情况

- 当网络失败时展示错误
- 当参数缺失时拒绝提交

## 验收场景覆盖矩阵（必填）

| 用户故事 | 场景编号 | 场景摘要 | 对应需求 | 预期验证方式 | 预期证据 |
|----------|----------|----------|----------|--------------|----------|
| US1 | AC-1 | 提交订单成功 | FR-001 | API | 响应 |

## 需求（必填）

### 功能需求

- **FR-001**：系统必须创建订单

## 成功标准（必填）

- **SC-001**：用户可成功提交订单
`;
}

function buildValidPlan(extraLines = '', implementationNotes = ''): string {
  return `# 实施计划：订单功能

## 技术上下文

TypeScript

## 宪法对齐检查

| 宪法条目 | 本计划是否符合 | 备注 |
|----------|---------------|------|
| 通过 repository/store 访问数据 | ✅ | 通过 OrderRepository 持久化数据 |

## 项目结构

\`\`\`text
services/agent-gateway/src/routes/orders.ts
services/agent-gateway/src/modules/order-store.ts
\`\`\`

## 复杂度评估

| 维度 | 评估 |
|------|------|
| 影响文件数 | 2 |

## 风险与缓解

| 风险 | 缓解措施 |
|------|----------|
| 网络失败 | 添加错误提示 |

${implementationNotes}

## 验收场景实施映射（必填）

| 场景编号 | 实现模块/文件 | 分层路径 | 验证方式 | 交付证据 |
|----------|---------------|----------|----------|----------|
| AC-1 | services/agent-gateway/src/routes/orders.ts | Page -> web-client -> Route -> Service -> Repository/Store -> DB | API | 响应 |

## 架构守卫（必填）

- 数据访问只能通过 OrderRepository 层，禁止直接 SQL。
${extraLines}`;
}

function buildValidTasks(lines: string[]): string {
  return ['# 任务清单：订单功能', '', '## Phase 1: 基础设施（阻塞性前置）', '', ...lines, '', '**检查点**：用户故事 1 独立可用', ''].join('\n');
}

beforeAll(async () => {
  dbModule = await import('../../infra/db.js');
  await dbModule.migrate();
  store = await import('../../handoff/store/handoff-store.js');
  pm2RunnerModule = await import('../../handoff/runner/pm2-runner.js');
});

beforeEach(() => {
  dbModule.sqliteRun('DELETE FROM users', []);
  seedUser(USER_ID, 'pm2@example.com');
  seedSession(PM1_SESSION_ID, USER_ID);
  seedSession(PM2_SESSION_ID, USER_ID);
  mocks.resolveAuxiliaryLlmConfig.mockReset();
  mocks.requestWorkflowLlmCompletion.mockReset();
  mocks.requestWorkflowLlmCompletion.mockImplementation(async (input: { prompt: string }) => {
    mocks.requestPrompts.push(input.prompt);
    return 'PASS';
  });
  mocks.requestPrompts.length = 0;
});

afterAll(async () => {
  await dbModule.closeDb();
});

describe('createPm2Runner', () => {
  it('constitution check 辅助 LLM prompt 注入 PM2 可读工作区知识', async () => {
    dbModule.sqliteRun(
      `INSERT INTO team_workspaces (
         id, user_id, name, constitution_md, constitution_version
       ) VALUES (?, ?, 'PM2 Runner 工作区', '# 宪法\n- 必须保留工作区知识。', 1)`,
      [TEAM_WORKSPACE_ID, USER_ID],
    );
    dbModule.sqliteRun(
      `INSERT INTO memories (
         id, user_id, type, key, value, source, confidence, priority,
         workspace_root, team_workspace_id, role_layers_json, enabled, created_at, updated_at
       ) VALUES (
         'm-pm2-runner', ?, 'project_context', 'knowledge:pm2-runner',
         'PM2 宪法检查辅助模型必须使用的工作区知识。', 'manual', 1, 90,
         NULL, ?, '["pm2"]', 1, datetime('now'), datetime('now')
       )`,
      [USER_ID, TEAM_WORKSPACE_ID],
    );
    seedArtifact({
      artifactId: 'spec-constitution',
      sessionId: PM1_SESSION_ID,
      userId: USER_ID,
      title: 'spec',
      content: buildValidSpec(),
      phase: 'spec',
    });
    seedArtifact({
      artifactId: 'plan-constitution',
      sessionId: PM1_SESSION_ID,
      userId: USER_ID,
      title: 'plan',
      content: buildValidPlan(),
      phase: 'plan',
    });
    seedArtifact({
      artifactId: 'tasks-constitution',
      sessionId: PM1_SESSION_ID,
      userId: USER_ID,
      title: 'tasks',
      content: buildValidTasks([
        '- [ ] T001 [US1] [KIND:build] [SURFACE:backend] [services/agent-gateway/src/routes/orders.ts] 实现订单接口 - 返回订单详情',
      ]),
      phase: 'tasks',
    });
    mocks.resolveAuxiliaryLlmConfig.mockResolvedValue({
      apiBaseUrl: 'https://llm.example.test/v1',
      apiKey: 'sk-test',
      model: 'model-test',
      providerType: 'openai',
    });

    const handoff = store.createHandoff({
      userId: USER_ID,
      fromSessionId: PM1_SESSION_ID,
      fromRoleLayer: 'pm1',
      toRoleLayer: 'pm2',
      payload: {
        resultJson: {
          specArtifactId: 'spec-constitution',
          planArtifactId: 'plan-constitution',
          tasksArtifactId: 'tasks-constitution',
        },
        teamWorkspaceId: TEAM_WORKSPACE_ID,
      },
    });

    const runner = pm2RunnerModule.createPm2Runner();
    await runner({
      handoff,
      toSessionId: PM2_SESSION_ID,
      signal: new AbortController().signal,
    });

    const prompt = mocks.requestPrompts[0] ?? '';
    expect(prompt).toContain('workspace-knowledge:pm2');
    expect(prompt).toContain('PM2 宪法检查辅助模型必须使用的工作区知识。');
  });

  it('architecture review 遇到阻断问题时写入 review artifact 并阻止派发', async () => {
    seedArtifact({
      artifactId: 'spec-blocking',
      sessionId: PM1_SESSION_ID,
      userId: USER_ID,
      title: 'spec',
      content: buildValidSpec('阻断案例'),
      phase: 'spec',
    });
    seedArtifact({
      artifactId: 'plan-blocking',
      sessionId: PM1_SESSION_ID,
      userId: USER_ID,
      title: 'plan',
      content: buildValidPlan('', '- 直接 SQL 修改用户表\n- 绕过网关直接访问内部服务'),
      phase: 'plan',
    });
    seedArtifact({
      artifactId: 'tasks-blocking',
      sessionId: PM1_SESSION_ID,
      userId: USER_ID,
      title: 'tasks',
      content: buildValidTasks([
        '- [ ] T001 [US1] [KIND:build] [SURFACE:backend] [services/agent-gateway/src/routes/orders.ts] 实现订单接口 - 返回订单详情',
      ]),
      phase: 'tasks',
    });

    const handoff = store.createHandoff({
      userId: USER_ID,
      fromSessionId: PM1_SESSION_ID,
      fromRoleLayer: 'pm1',
      toRoleLayer: 'pm2',
      payload: {
        resultJson: {
          specArtifactId: 'spec-blocking',
          planArtifactId: 'plan-blocking',
          tasksArtifactId: 'tasks-blocking',
        },
      },
    });

    const runner = pm2RunnerModule.createPm2Runner();
    await expect(
      runner({
        handoff,
        toSessionId: PM2_SESSION_ID,
        signal: new AbortController().signal,
      }),
    ).rejects.toThrow(/Architecture Review 未通过/);

    const resultRow = dbModule.sqliteGet<{ result_json: string | null }>(
      `SELECT result_json FROM handoff_records WHERE id = ?`,
      [handoff.id],
    );
    const resultJson = JSON.parse(resultRow?.result_json ?? '{}') as Record<string, unknown>;
    const review = resultJson['architectureReview'] as Record<string, unknown>;
    expect(review['passed']).toBe(false);
    expect(review['blockingCount']).toBeGreaterThan(0);
    expect(typeof resultJson['architectureReviewArtifactId']).toBe('string');
    expect(resultJson['qualityReviewPending']).toBe(false);

    const architectureReviewArtifactId = resultJson['architectureReviewArtifactId'];
    expect(typeof architectureReviewArtifactId).toBe('string');
    const reviewArtifact = dbModule.sqliteGet<{ title: string; content: string; phase: string }>(
      `SELECT title, content, phase FROM artifacts WHERE id = ?`,
      [architectureReviewArtifactId as string],
    );
    expect(reviewArtifact).toMatchObject({
      title: 'Architecture Review',
      phase: 'review_report',
    });
    expect(reviewArtifact?.content).toContain('阻断问题数');
    expect(reviewArtifact?.content).toContain('直接 SQL');

    const downstreamCount = dbModule.sqliteGet<{ c: number }>(
      `SELECT COUNT(*) AS c
         FROM handoff_records
        WHERE from_session_id = ? AND to_role_layer IN ('executor', 'reviewer')`,
      [PM2_SESSION_ID],
    );
    expect(downstreamCount?.c).toBe(0);
  });

  it('architecture review 通过时保留 review artifact 并继续派发', async () => {
    seedArtifact({
      artifactId: 'spec-pass',
      sessionId: PM1_SESSION_ID,
      userId: USER_ID,
      title: 'spec',
      content: buildValidSpec('通过案例'),
      phase: 'spec',
    });
    seedArtifact({
      artifactId: 'plan-pass',
      sessionId: PM1_SESSION_ID,
      userId: USER_ID,
      title: 'plan',
      content: buildValidPlan('- 所有调用都经 gateway'),
      phase: 'plan',
    });
    seedArtifact({
      artifactId: 'tasks-pass',
      sessionId: PM1_SESSION_ID,
      userId: USER_ID,
      title: 'tasks',
      content: buildValidTasks([
        '- [ ] T001 [US1] [KIND:build] [SURFACE:backend] [services/agent-gateway/src/routes/orders.ts] 实现订单接口 - 返回订单详情',
        '- [ ] T002 [US1] [P] [KIND:review] [SURFACE:backend] [services/agent-gateway/src/routes/orders.ts] 评审订单接口 - 输出审查意见',
      ]),
      phase: 'tasks',
    });

    const handoff = store.createHandoff({
      userId: USER_ID,
      fromSessionId: PM1_SESSION_ID,
      fromRoleLayer: 'pm1',
      toRoleLayer: 'pm2',
      payload: {
        resultJson: {
          specArtifactId: 'spec-pass',
          planArtifactId: 'plan-pass',
          tasksArtifactId: 'tasks-pass',
        },
      },
    });

    const runner = pm2RunnerModule.createPm2Runner();
    await runner({
      handoff,
      toSessionId: PM2_SESSION_ID,
      signal: new AbortController().signal,
    });

    const resultRow = dbModule.sqliteGet<{ result_json: string | null }>(
      `SELECT result_json FROM handoff_records WHERE id = ?`,
      [handoff.id],
    );
    const resultJson = JSON.parse(resultRow?.result_json ?? '{}') as Record<string, unknown>;
    const review = resultJson['architectureReview'] as Record<string, unknown>;
    expect(review['passed']).toBe(true);
    expect(review['blockingCount']).toBe(0);
    expect(typeof resultJson['architectureReviewArtifactId']).toBe('string');
    expect(resultJson['qualityReviewPending']).toBe(true);

    const downstreamCount = dbModule.sqliteGet<{ c: number }>(
      `SELECT COUNT(*) AS c
         FROM handoff_records
        WHERE from_session_id = ? AND to_role_layer IN ('executor', 'reviewer')`,
      [PM2_SESSION_ID],
    );
    expect((downstreamCount?.c ?? 0) > 0).toBe(true);
  });
});
