import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type * as DbModule from '../../infra/db.js';
import type * as HandoffStoreModule from '../../handoff/store/handoff-store.js';
import type * as Pm2RunnerModule from '../../handoff/runner/pm2-runner.js';

process.env['DATABASE_URL'] = ':memory:';
process.env['OPENAWORK_APP_VERSION'] = '0.0.0-test';

let dbModule: typeof DbModule;
let store: typeof HandoffStoreModule;
let pm2RunnerModule: typeof Pm2RunnerModule;

const USER_ID = 'u-pm2-runner';
const PM1_SESSION_ID = 's-pm1-runner';
const PM2_SESSION_ID = 's-pm2-runner';

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
});

afterAll(async () => {
  await dbModule.closeDb();
});

describe('createPm2Runner', () => {
  it('architecture review 遇到阻断问题时写入 review artifact 并阻止派发', async () => {
    seedArtifact({
      artifactId: 'spec-blocking',
      sessionId: PM1_SESSION_ID,
      userId: USER_ID,
      title: 'spec',
      content: '# 规格',
      phase: 'spec',
    });
    seedArtifact({
      artifactId: 'plan-blocking',
      sessionId: PM1_SESSION_ID,
      userId: USER_ID,
      title: 'plan',
      content: '# 实施计划\n\n- 直接 SQL 修改用户表\n- 绕过网关直接访问内部服务',
      phase: 'plan',
    });
    seedArtifact({
      artifactId: 'tasks-blocking',
      sessionId: PM1_SESSION_ID,
      userId: USER_ID,
      title: 'tasks',
      content: '# 任务清单\n\n## Phase 1\n- [ ] T001 [US1] 修复后端 API',
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
      content: '# 规格',
      phase: 'spec',
    });
    seedArtifact({
      artifactId: 'plan-pass',
      sessionId: PM1_SESSION_ID,
      userId: USER_ID,
      title: 'plan',
      content: '# 实施计划\n\n- 通过 store 层处理数据\n- 所有调用都经 gateway',
      phase: 'plan',
    });
    seedArtifact({
      artifactId: 'tasks-pass',
      sessionId: PM1_SESSION_ID,
      userId: USER_ID,
      title: 'tasks',
      content:
        '# 任务清单\n\n## Phase 1\n- [ ] T001 [US1] 修复后端 API\n- [ ] T002 [US1] [P] 补测试',
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
