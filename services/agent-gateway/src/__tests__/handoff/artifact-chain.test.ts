/**
 * 260515-team-phase-c · T-02 / T-03 / T-05 单元测试
 *
 * 覆盖：
 *   - parseClarifications 正则解析
 *   - parseConstitutionCheck 表格解析
 *   - runArtifactChain 完整流程（mock LLM）
 *   - handoff result_json 写入
 */

import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type * as DbModule from '../../db.js';
import type * as ArtifactChainModule from '../../handoff/runner/artifact-chain.js';
import type * as HandoffStoreModule from '../../handoff/store/handoff-store.js';

process.env['DATABASE_URL'] = ':memory:';
process.env['OPENAWORK_APP_VERSION'] = '0.0.0-test';
// L1.3 改造 3：c 层等 inbound 时不要拖慢测试
process.env['OPENAWORK_TEAM_INBOUND_POLL_MS'] = '20';
process.env['OPENAWORK_TEAM_CLARIFICATION_TIMEOUT_MS'] = '300';

let dbModule: typeof DbModule;
let artifactChain: typeof ArtifactChainModule;
let store: typeof HandoffStoreModule;

const USER_ID = 'u-artifact';
const SESSION_ID = 's-artifact';
const FROM_SESSION_ID = 's-from-artifact';
const TEAM_WORKSPACE_ID = 'tw-artifact';

function seedUser(id: string, email: string): void {
  dbModule.sqliteRun("INSERT OR IGNORE INTO users (id, email, password_hash) VALUES (?, ?, 'x')", [
    id,
    email,
  ]);
}

function seedSession(sessionId: string, userId: string): void {
  dbModule.sqliteRun(
    `INSERT OR IGNORE INTO sessions (id, user_id, title, metadata_json)
     VALUES (?, ?, 'demo', '{}')`,
    [sessionId, userId],
  );
}

function seedTeamWorkspace(workspaceId: string, userId: string): void {
  dbModule.sqliteRun(
    `INSERT OR IGNORE INTO team_workspaces (id, user_id, name, constitution_md, constitution_version)
     VALUES (?, ?, '测试工作区', '# 宪法\n禁止空 catch。', 1)`,
    [workspaceId, userId],
  );
}

beforeAll(async () => {
  dbModule = await import('../../db.js');
  await dbModule.migrate();
  artifactChain = await import('../../handoff/runner/artifact-chain.js');
  store = await import('../../handoff/store/handoff-store.js');
});

beforeEach(() => {
  dbModule.sqliteRun('DELETE FROM users', []);
  seedUser(USER_ID, 'artifact@example.com');
  seedSession(SESSION_ID, USER_ID);
  seedSession(FROM_SESSION_ID, USER_ID);
  seedTeamWorkspace(TEAM_WORKSPACE_ID, USER_ID);
});

afterAll(async () => {
  await dbModule.closeDb();
});

describe('parseClarifications', () => {
  it('提取多个 [NEEDS CLARIFICATION] 标记', () => {
    const content = `
- **FR-001**: 系统必须支持登录
- **FR-002**: 系统必须 [NEEDS CLARIFICATION: 认证方式未指定 - 邮箱/OAuth?]
- **FR-003**: 系统必须保留数据 [NEEDS CLARIFICATION: 保留期限未指定]
    `;
    const items = artifactChain.parseClarifications(content);
    expect(items).toHaveLength(2);
    expect(items[0]?.question).toBe('认证方式未指定 - 邮箱/OAuth?');
    expect(items[1]?.question).toBe('保留期限未指定');
  });

  it('无标记时返回空数组', () => {
    const items = artifactChain.parseClarifications('一切都很清楚');
    expect(items).toHaveLength(0);
  });

  it('多次调用不受 lastIndex 影响', () => {
    const content = '[NEEDS CLARIFICATION: 问题A] 和 [NEEDS CLARIFICATION: 问题B]';
    const first = artifactChain.parseClarifications(content);
    const second = artifactChain.parseClarifications(content);
    expect(first).toHaveLength(2);
    expect(second).toHaveLength(2);
  });
});

describe('parseConstitutionCheck', () => {
  it('解析宪法对齐表格', () => {
    const plan = `
## 宪法对齐检查

| 宪法条目 | 本计划是否符合 | 备注 |
|----------|---------------|------|
| 禁止空 catch | ✅ | 所有 catch 都有日志 |
| 小步可逆 | ⚠️ | 部分改动较大 |
| 必须有测试 | ❌ | 时间不够 |
    `;
    const warnings = artifactChain.parseConstitutionCheck(plan);
    expect(warnings).toHaveLength(3);
    expect(warnings[0]).toMatchObject({ clause: '禁止空 catch', status: 'pass' });
    expect(warnings[1]).toMatchObject({ clause: '小步可逆', status: 'warning' });
    expect(warnings[2]).toMatchObject({ clause: '必须有测试', status: 'conflict' });
  });

  it('无表格时返回空数组', () => {
    const warnings = artifactChain.parseConstitutionCheck('没有表格的 plan');
    expect(warnings).toHaveLength(0);
  });

  it('多次调用不受 lastIndex 影响', () => {
    const plan = '| 条目A | ✅ | ok |\n| 条目B | ⚠️ | warn |';
    const first = artifactChain.parseConstitutionCheck(plan);
    const second = artifactChain.parseConstitutionCheck(plan);
    expect(first).toHaveLength(2);
    expect(second).toHaveLength(2);
  });
});

describe('runArtifactChain', () => {
  it('完整流程：生成 3 个 artifact + 写入 handoff result', async () => {
    const handoff = store.createHandoff({
      userId: USER_ID,
      fromSessionId: FROM_SESSION_ID,
      fromRoleLayer: 'reception',
      toRoleLayer: 'pm1',
      payload: { intent: '测试意图' },
    });

    let callCount = 0;
    const mockLlm = async (_system: string, _user: string): Promise<string> => {
      callCount += 1;
      if (callCount <= 2) {
        // spec (may be called twice if retry triggers)
        return `# 功能规格：测试功能\n\n## 用户故事 1\n\n描述\n\n## 需求\n\n- **FR-001**: 系统必须 [NEEDS CLARIFICATION: 具体范围未定]\n\n## 成功标准\n- SC-001: 可用`;
      }
      if (callCount <= 4) {
        // plan (may be called twice if retry triggers)
        return `# 实施计划\n\n## 技术上下文\n\nTypeScript\n\n## 宪法对齐检查\n\n| 宪法条目 | 本计划是否符合 | 备注 |\n|---|---|---|\n| 禁止空 catch | ✅ | ok |`;
      }
      // tasks
      return `# 任务清单\n\n## Phase 1\n\n- [ ] T001 [US1] 实现核心功能`;
    };

    const result = await artifactChain.runArtifactChain({
      userId: USER_ID,
      sessionId: SESSION_ID,
      handoff,
      sourceIntent: '原始意图',
      rewrittenIntent: '改写后意图',
      teamWorkspaceId: TEAM_WORKSPACE_ID,
      callLlm: mockLlm,
    });

    expect(callCount).toBeGreaterThanOrEqual(3);
    expect(result.specArtifactId).toBeTruthy();
    expect(result.planArtifactId).toBeTruthy();
    expect(result.tasksArtifactId).toBeTruthy();
    expect(result.clarifications).toHaveLength(1);
    expect(result.clarifications[0]?.question).toBe('具体范围未定');
    expect(result.constitutionWarnings).toHaveLength(1);
    expect(result.constitutionWarnings[0]?.status).toBe('pass');

    // 验证 artifact 写入 DB
    const specRow = dbModule.sqliteGet<{ phase: string; parent_artifact_id: string | null }>(
      `SELECT phase, parent_artifact_id FROM artifacts WHERE id = ?`,
      [result.specArtifactId],
    );
    expect(specRow?.phase).toBe('spec');
    expect(specRow?.parent_artifact_id).toBeNull();

    const planRow = dbModule.sqliteGet<{ phase: string; parent_artifact_id: string | null }>(
      `SELECT phase, parent_artifact_id FROM artifacts WHERE id = ?`,
      [result.planArtifactId],
    );
    expect(planRow?.phase).toBe('plan');
    expect(planRow?.parent_artifact_id).toBe(result.specArtifactId);

    const tasksRow = dbModule.sqliteGet<{ phase: string; parent_artifact_id: string | null }>(
      `SELECT phase, parent_artifact_id FROM artifacts WHERE id = ?`,
      [result.tasksArtifactId],
    );
    expect(tasksRow?.phase).toBe('tasks');
    expect(tasksRow?.parent_artifact_id).toBe(result.planArtifactId);

    // 验证 handoff result_json 写入
    const handoffRow = dbModule.sqliteGet<{ result_json: string | null }>(
      `SELECT result_json FROM handoff_records WHERE id = ?`,
      [handoff.id],
    );
    expect(handoffRow?.result_json).not.toBeNull();
    const resultJson = JSON.parse(handoffRow!.result_json!) as Record<string, unknown>;
    expect(resultJson['specArtifactId']).toBe(result.specArtifactId);
    expect(resultJson['planArtifactId']).toBe(result.planArtifactId);
    expect(resultJson['tasksArtifactId']).toBe(result.tasksArtifactId);
  });

  it('无 teamWorkspaceId 时跳过 constitution 注入', async () => {
    const handoff = store.createHandoff({
      userId: USER_ID,
      fromSessionId: FROM_SESSION_ID,
      fromRoleLayer: 'reception',
      toRoleLayer: 'pm1',
    });

    let planPrompt = '';
    const mockLlm = async (_system: string, user: string): Promise<string> => {
      planPrompt = user;
      return '# 产物';
    };

    await artifactChain.runArtifactChain({
      userId: USER_ID,
      sessionId: SESSION_ID,
      handoff,
      sourceIntent: '意图',
      rewrittenIntent: '改写',
      teamWorkspaceId: null,
      callLlm: mockLlm,
    });

    // plan 的 user message 不应包含 <constitution> 块
    expect(planPrompt).not.toContain('<constitution>');
  });

  it('clarification 阻塞门禁：超时回退继续生成 plan（fallback assumption）', async () => {
    const handoff = store.createHandoff({
      userId: USER_ID,
      fromSessionId: FROM_SESSION_ID,
      fromRoleLayer: 'reception',
      toRoleLayer: 'pm1',
    });

    let planPrompt = '';
    const mockLlm = async (system: string, user: string): Promise<string> => {
      if (system.includes('实施计划')) {
        if (!planPrompt) planPrompt = user;
        return `# 实施计划\n\n## 技术上下文\n\nTypeScript\n\n## 宪法对齐检查\n\n| 宪法条目 | 本计划是否符合 | 备注 |\n|---|---|---|\n| 禁止空 catch | ✅ | ok |`;
      }
      if (system.includes('任务清单')) {
        return `# 任务清单\n\n## Phase 1\n- [ ] T001 [US1] 任务`;
      }
      // spec：含一个 NEEDS CLARIFICATION，让阻塞门禁生效
      return `# 规格\n\n## 用户故事 1\n\n## 需求\n- **FR-001**: 系统必须 [NEEDS CLARIFICATION: x?]`;
    };

    await artifactChain.runArtifactChain({
      userId: USER_ID,
      sessionId: SESSION_ID,
      handoff,
      sourceIntent: '原始',
      rewrittenIntent: '改写',
      teamWorkspaceId: null,
      callLlm: mockLlm,
    });

    // 阻塞超时 fallback：plan 输入里应该包含"用户未在超时前回答"提示
    expect(planPrompt).toMatch(/用户未在超时前回答|默认假设/);
  });

  it('clarification 阻塞门禁：收到 inbound 答案后注入到 plan', async () => {
    const handoff = store.createHandoff({
      userId: USER_ID,
      fromSessionId: FROM_SESSION_ID,
      fromRoleLayer: 'reception',
      toRoleLayer: 'pm1',
      payload: {},
    });

    const inboundStore = await import('../../handoff/store/inbound-store.js');

    let planPrompt = '';
    const mockLlm = async (system: string, user: string): Promise<string> => {
      if (system.includes('实施计划')) {
        if (!planPrompt) planPrompt = user;
        return `# 实施计划\n\n## 技术上下文\n\nTypeScript\n\n## 宪法对齐\n\n| 宪法条目 | 本计划是否符合 | 备注 |\n|---|---|---|\n| 禁止空 catch | ✅ | ok |`;
      }
      if (system.includes('任务清单')) {
        return `# 任务清单\n\n## Phase 1\n- [ ] T001 [US1] 任务`;
      }
      return `# 规格\n\n## 用户故事 1\n\n## 需求\n- **FR-001**: 系统必须 [NEEDS CLARIFICATION: 认证方式?]`;
    };

    // 在 100ms 后投递 clarification answer
    const injectionTimer = setTimeout(() => {
      inboundStore.submitInboundMessage({
        userId: USER_ID,
        toSessionId: SESSION_ID,
        fromRoleLayer: 'reception',
        messageType: 'clarification_answer',
        payload: { answer: '使用 OAuth 2.0', answeredBy: 'user' },
      });
    }, 100);

    try {
      await artifactChain.runArtifactChain({
        userId: USER_ID,
        sessionId: SESSION_ID,
        handoff,
        sourceIntent: '原始',
        rewrittenIntent: '改写',
        teamWorkspaceId: null,
        callLlm: mockLlm,
      });
    } finally {
      clearTimeout(injectionTimer);
    }

    // plan 输入里应该包含 OAuth 2.0 的回答
    expect(planPrompt).toContain('OAuth 2.0');
  });
});
