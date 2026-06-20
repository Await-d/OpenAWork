/**
 * 260515-team-phase-b · T-04 / T-06 单元测试
 *
 * 覆盖 Watcher tickOnce / recoveryTick + heartbeat 联动。
 */

import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type * as DbModule from '../../infra/db.js';
import type * as HandoffStoreModule from '../../handoff/store/handoff-store.js';
import type * as HeartbeatModule from '../../handoff/bus/heartbeat.js';
import type * as WatcherModule from '../../handoff/runner/watcher.js';
import type * as TeamEventsBusModule from '../../handoff/bus/team-events-bus.js';
import type * as TeamSessionCreateModule from '../../handoff/bus/team-session-create.js';
import {
  InProcessScheduler,
  __resetBackgroundTaskSchedulerForTesting,
} from '../../handoff/runner/scheduler.js';

vi.mock('../../provider/auxiliary-llm-config.js', () => ({
  resolveAuxiliaryLlmConfig: async () => null,
  resolveAuxiliaryLlmConfigCandidates: async () => [],
}));

// Per-record dispatch resilience: make createTeamSession throw for ONE
// poisoned parent session so we can prove tickOnce isolates the bad handoff
// and still dispatches the rest of the queue. Every other parent delegates to
// the real implementation.
const POISON_FROM_SESSION_ID = 's-watcher-poison-from';
vi.mock('../../handoff/bus/team-session-create.js', async (importOriginal) => {
  const actual = await importOriginal<typeof TeamSessionCreateModule>();
  return {
    ...actual,
    createTeamSession: vi.fn((input: { teamParentSessionId?: string }) => {
      if (input.teamParentSessionId === POISON_FROM_SESSION_ID) {
        throw new Error('simulated child-session creation failure');
      }
      return actual.createTeamSession(input as Parameters<typeof actual.createTeamSession>[0]);
    }),
    findOrCreateTeamRoleSession: vi.fn((input: { teamParentSessionId?: string }) => {
      if (input.teamParentSessionId === POISON_FROM_SESSION_ID) {
        throw new Error('simulated child-session creation failure');
      }
      return actual.findOrCreateTeamRoleSession(
        input as Parameters<typeof actual.findOrCreateTeamRoleSession>[0],
      );
    }),
  };
});

process.env['DATABASE_URL'] = ':memory:';
process.env['OPENAWORK_APP_VERSION'] = '0.0.0-test';

let dbModule: typeof DbModule;
let store: typeof HandoffStoreModule;
let heartbeat: typeof HeartbeatModule;
let watcherModule: typeof WatcherModule;
let teamEventsBus: typeof TeamEventsBusModule;

const USER_ID = 'u-watcher';
const FROM_SESSION_ID = 's-watcher-from';

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

beforeAll(async () => {
  dbModule = await import('../../infra/db.js');
  await dbModule.migrate();
  store = await import('../../handoff/store/handoff-store.js');
  heartbeat = await import('../../handoff/bus/heartbeat.js');
  watcherModule = await import('../../handoff/runner/watcher.js');
  teamEventsBus = await import('../../handoff/bus/team-events-bus.js');
});

beforeEach(() => {
  teamEventsBus.__clearTeamEventsBusForTesting();
  dbModule.sqliteRun('DELETE FROM user_settings', []);
  dbModule.sqliteRun('DELETE FROM users', []);
  seedUser(USER_ID, 'watcher@example.com');
  seedSession(FROM_SESSION_ID, USER_ID);
  seedSession(POISON_FROM_SESSION_ID, USER_ID);
  __resetBackgroundTaskSchedulerForTesting();
});

afterAll(async () => {
  await dbModule.closeDb();
});

describe('HandoffWatcher.tickOnce', () => {
  it('claim pending → 创建子 session → start handoff → 排队 task', async () => {
    const scheduler = new InProcessScheduler();
    let runnerCalled = 0;
    const watcher = new watcherModule.HandoffWatcher({
      taskRunner: async () => {
        runnerCalled += 1;
      },
      scheduler,
    });

    const created = store.createHandoff({
      userId: USER_ID,
      fromSessionId: FROM_SESSION_ID,
      fromRoleLayer: 'reception',
      toRoleLayer: 'pm1',
      payload: { intent: '测试' },
    });

    const result = await watcher.tickOnce();
    expect(result.claimed).toBe(1);
    expect(result.skipped).toBe(0);

    const after = store.getHandoff({ userId: USER_ID, handoffId: created.id });
    expect(after?.state).toBe('running');
    expect(after?.toSessionId).not.toBeNull();

    // 等 scheduler 异步完成
    await new Promise((r) => setImmediate(r));
    await new Promise((r) => setImmediate(r));
    expect(runnerCalled).toBe(1);

    const final = store.getHandoff({ userId: USER_ID, handoffId: created.id });
    expect(final?.state).toBe('completed');
  });

  it('多个 pending 同 tick 内全部处理', async () => {
    const watcher = new watcherModule.HandoffWatcher({
      scheduler: new InProcessScheduler(),
    });
    for (let i = 0; i < 3; i += 1) {
      store.createHandoff({
        userId: USER_ID,
        fromSessionId: FROM_SESSION_ID,
        fromRoleLayer: 'reception',
        toRoleLayer: 'pm1',
      });
    }
    const result = await watcher.tickOnce();
    expect(result.claimed).toBe(3);
  });

  it('同一会话内相同 personaKey 的 handoff 复用同一个角色 session', async () => {
    const watcher = new watcherModule.HandoffWatcher({
      taskRunner: async () => {},
      scheduler: new InProcessScheduler(),
    });
    const payload = {
      goal: '实现前端交互',
      assignedMember: {
        id: 'executor-frontend',
        displayName: '前端开发者',
        personaKey: 'executor:frontend',
        specialty: 'frontend',
      },
    };
    const first = store.createHandoff({
      userId: USER_ID,
      fromSessionId: FROM_SESSION_ID,
      fromRoleLayer: 'pm2',
      toRoleLayer: 'executor',
      payload,
    });
    const second = store.createHandoff({
      userId: USER_ID,
      fromSessionId: FROM_SESSION_ID,
      fromRoleLayer: 'pm2',
      toRoleLayer: 'executor',
      payload,
    });

    const result = await watcher.tickOnce();
    expect(result.claimed).toBe(2);

    const afterFirst = store.getHandoff({ userId: USER_ID, handoffId: first.id });
    const afterSecond = store.getHandoff({ userId: USER_ID, handoffId: second.id });
    expect(afterFirst?.toSessionId).toBeTruthy();
    expect(afterSecond?.toSessionId).toBe(afterFirst?.toSessionId);

    const roleSessions = dbModule.sqliteAll<{ id: string; metadata_json: string; title: string }>(
      `SELECT id, metadata_json, title
         FROM sessions
        WHERE user_id = ?
          AND role_layer = 'executor'
          AND json_extract(
            CASE WHEN json_valid(metadata_json) THEN metadata_json ELSE '{}' END,
            '$.teamRoleInstance.personaKey'
          ) = 'executor:frontend'`,
      [USER_ID],
    );
    expect(roleSessions).toHaveLength(1);
    expect(roleSessions[0]?.id).toBe(afterFirst?.toSessionId);
    expect(roleSessions[0]?.title).toBe('前端开发者');
    expect(
      JSON.parse(roleSessions[0]?.metadata_json ?? '{}') as Record<string, unknown>,
    ).toMatchObject({
      teamRoleInstance: {
        rootSessionId: FROM_SESSION_ID,
        roleLayer: 'executor',
        personaKey: 'executor:frontend',
        displayName: '前端开发者',
      },
    });
  });

  it('失败 handoff 重试后继续复用原角色 session', async () => {
    const payload = {
      goal: '修复前端缺陷',
      assignedMember: {
        id: 'executor-frontend',
        displayName: '前端开发者',
        personaKey: 'executor:frontend',
        specialty: 'frontend',
      },
    };
    const created = store.createHandoff({
      userId: USER_ID,
      fromSessionId: FROM_SESSION_ID,
      fromRoleLayer: 'pm2',
      toRoleLayer: 'executor',
      payload,
    });

    const failingWatcher = new watcherModule.HandoffWatcher({
      scheduler: new InProcessScheduler(),
      taskRunner: async () => {
        throw new Error('runner-fail');
      },
    });
    await failingWatcher.tickOnce();
    await new Promise((r) => setImmediate(r));
    await new Promise((r) => setImmediate(r));

    const failed = store.getHandoff({ userId: USER_ID, handoffId: created.id });
    expect(failed?.state).toBe('failed');
    expect(failed?.toSessionId).toBeTruthy();
    const firstSessionId = failed?.toSessionId;

    expect(store.retryFailedHandoff({ userId: USER_ID, handoffId: created.id })).toBe(true);
    const retriedPending = store.getHandoff({ userId: USER_ID, handoffId: created.id });
    expect(retriedPending?.state).toBe('pending');
    expect(retriedPending?.toSessionId).toBeNull();

    const retryWatcher = new watcherModule.HandoffWatcher({
      scheduler: new InProcessScheduler(),
      taskRunner: async () => {},
    });
    await retryWatcher.tickOnce();

    const retriedRunning = store.getHandoff({ userId: USER_ID, handoffId: created.id });
    expect(retriedRunning?.state).toBe('running');
    expect(retriedRunning?.toSessionId).toBe(firstSessionId);
  });

  it('单条 handoff 派发抛错时不中断整轮扫描，其余照常 claim', async () => {
    // Regression (§0.94/§0.98 class, team dispatch loop): tickOnce iterates
    // pending handoffs and, after claiming each, runs child-session creation
    // which can throw. Without a per-record guard one poison handoff aborted
    // the whole sweep and starved the rest of the queue. Here the poisoned
    // record (its createTeamSession throws) must be skipped while the two
    // healthy handoffs still get claimed + dispatched.
    const watcher = new watcherModule.HandoffWatcher({
      taskRunner: async () => {},
      scheduler: new InProcessScheduler(),
    });

    const poison = store.createHandoff({
      userId: USER_ID,
      fromSessionId: POISON_FROM_SESSION_ID,
      fromRoleLayer: 'reception',
      toRoleLayer: 'pm1',
    });
    const okA = store.createHandoff({
      userId: USER_ID,
      fromSessionId: FROM_SESSION_ID,
      fromRoleLayer: 'reception',
      toRoleLayer: 'pm1',
    });
    const okB = store.createHandoff({
      userId: USER_ID,
      fromSessionId: FROM_SESSION_ID,
      fromRoleLayer: 'reception',
      toRoleLayer: 'pm1',
    });

    // Must not reject despite the poison record throwing mid-dispatch.
    const result = await watcher.tickOnce();

    // Two healthy handoffs dispatched, the poison one skipped — sweep survived.
    expect(result.claimed).toBe(2);
    expect(result.skipped).toBeGreaterThanOrEqual(1);
    expect(store.getHandoff({ userId: USER_ID, handoffId: okA.id })?.state).toBe('running');
    expect(store.getHandoff({ userId: USER_ID, handoffId: okB.id })?.state).toBe('running');
    // The poison record was claimed but never reached 'running' (its dispatch
    // threw); the recovery tick re-pends it later.
    expect(store.getHandoff({ userId: USER_ID, handoffId: poison.id })?.state).not.toBe('running');
  });

  it('已被别处 claim 的会跳过（skipped 计数）', async () => {
    const watcher = new watcherModule.HandoffWatcher({
      scheduler: new InProcessScheduler(),
    });
    const a = store.createHandoff({
      userId: USER_ID,
      fromSessionId: FROM_SESSION_ID,
      fromRoleLayer: 'reception',
      toRoleLayer: 'pm1',
    });
    // 抢先 claim
    store.claimHandoff({ handoffId: a.id, claimToken: 'external' });

    const result = await watcher.tickOnce();
    // pending 列表查询时已经不包含 a（因为 state='claimed'），所以 claimed=0/skipped=0
    expect(result.claimed).toBe(0);
  });

  it('paused 的 pending handoff 不会被 watcher claim', async () => {
    const watcher = new watcherModule.HandoffWatcher({
      scheduler: new InProcessScheduler(),
    });
    const paused = store.createHandoff({
      userId: USER_ID,
      fromSessionId: FROM_SESSION_ID,
      fromRoleLayer: 'reception',
      toRoleLayer: 'pm1',
    });
    expect(store.pauseHandoff({ userId: USER_ID, handoffId: paused.id })).toBe(true);

    const result = await watcher.tickOnce();
    expect(result.claimed).toBe(0);

    const after = store.getHandoff({ userId: USER_ID, handoffId: paused.id });
    expect(after?.state).toBe('pending');
    expect(after?.paused).toBe(true);
  });

  it('runner 抛错时 handoff 进入 failed', async () => {
    const watcher = new watcherModule.HandoffWatcher({
      scheduler: new InProcessScheduler(),
      taskRunner: async () => {
        throw new Error('runner-fail');
      },
    });
    const created = store.createHandoff({
      userId: USER_ID,
      fromSessionId: FROM_SESSION_ID,
      fromRoleLayer: 'pm2',
      toRoleLayer: 'executor',
    });
    await watcher.tickOnce();
    await new Promise((r) => setImmediate(r));
    await new Promise((r) => setImmediate(r));
    const final = store.getHandoff({ userId: USER_ID, handoffId: created.id });
    expect(final?.state).toBe('failed');
    expect(final?.failureReason).toBe('runner-fail');
  });

  it('pm2 handoff 在 dispatch 后保持 running，等待后续 review 收口', async () => {
    const { createPm2Runner } = await import('../../handoff/runner/pm2-runner.js');
    const watcher = new watcherModule.HandoffWatcher({
      scheduler: new InProcessScheduler(),
      taskRunner: createPm2Runner(),
    });

    seedSession('s-pm2-parent', USER_ID);
    dbModule.sqliteRun(
      `INSERT INTO artifacts (id, session_id, user_id, type, title, content, version, phase)
       VALUES ('tasks-pm2-watcher', 's-pm2-parent', ?, 'markdown', 'tasks', ?, 1, 'tasks')`,
      [
        USER_ID,
        '# 任务清单\n\n## Phase 1\n- [ ] T001 [US1] 修复后端 API\n- [ ] T002 [US1] [P] 补测试',
      ],
    );
    const created = store.createHandoff({
      userId: USER_ID,
      fromSessionId: 's-pm2-parent',
      fromRoleLayer: 'pm1',
      toRoleLayer: 'pm2',
      payload: {
        resultJson: {
          tasksArtifactId: 'tasks-pm2-watcher',
        },
      },
    });

    await watcher.tickOnce();
    await new Promise((r) => setImmediate(r));
    await new Promise((r) => setImmediate(r));

    const after = store.getHandoff({ userId: USER_ID, handoffId: created.id });
    expect(after?.state).toBe('running');
    const downstream = dbModule.sqliteGet<{ c: number }>(
      `SELECT COUNT(*) AS c
         FROM handoff_records
        WHERE from_session_id = ? AND to_role_layer IN ('executor', 'reviewer')`,
      [after?.toSessionId],
    );
    expect((downstream?.c ?? 0) > 0).toBe(true);
  });

  it('running 的 pm2 在 qualityReviewPending 且子任务已完成时，可直接收口 review', async () => {
    const reconciler = await import('../../handoff/runner/pm2-quality-review-reconciler.js');
    seedSession('s-pm2-review-parent', USER_ID);
    seedSession('s-pm2-review', USER_ID);
    seedSession('s-child-review-1', USER_ID);
    seedSession('s-child-review-2', USER_ID);

    const pm2 = store.createHandoff({
      userId: USER_ID,
      fromSessionId: 's-pm2-review-parent',
      fromRoleLayer: 'pm1',
      toRoleLayer: 'pm2',
    });
    store.claimHandoff({ handoffId: pm2.id, claimToken: 'tok-pm2-review' });
    store.startHandoff({
      handoffId: pm2.id,
      claimToken: 'tok-pm2-review',
      toSessionId: 's-pm2-review',
    });

    const childA = store.createHandoff({
      userId: USER_ID,
      fromSessionId: 's-pm2-review',
      fromRoleLayer: 'pm2',
      toRoleLayer: 'executor',
    });
    store.claimHandoff({ handoffId: childA.id, claimToken: 'tok-child-a' });
    store.startHandoff({
      handoffId: childA.id,
      claimToken: 'tok-child-a',
      toSessionId: 's-child-review-1',
    });
    store.completeHandoff({ handoffId: childA.id, claimToken: 'tok-child-a' });

    const childB = store.createHandoff({
      userId: USER_ID,
      fromSessionId: 's-pm2-review',
      fromRoleLayer: 'pm2',
      toRoleLayer: 'reviewer',
    });
    store.claimHandoff({ handoffId: childB.id, claimToken: 'tok-child-b' });
    store.startHandoff({
      handoffId: childB.id,
      claimToken: 'tok-child-b',
      toSessionId: 's-child-review-2',
    });
    store.completeHandoff({ handoffId: childB.id, claimToken: 'tok-child-b' });

    dbModule.sqliteRun(
      `UPDATE handoff_records
          SET result_json = ?
        WHERE id = ?`,
      [
        JSON.stringify({
          dispatchedHandoffIds: [childA.id, childB.id],
          qualityReviewPending: true,
        }),
        pm2.id,
      ],
    );

    const result = await reconciler.reconcilePm2QualityReview({
      pm2HandoffId: pm2.id,
      userId: USER_ID,
    });
    expect(result.status).toBe('completed');

    const after = store.getHandoff({ userId: USER_ID, handoffId: pm2.id });
    expect(after?.state).toBe('completed');
  });

  it('running 的 pm2 在 qualityReviewPending 且子任务有失败时，会走降级失败收口', async () => {
    const reconciler = await import('../../handoff/runner/pm2-quality-review-reconciler.js');
    seedSession('s-pm2-review-parent-2', USER_ID);
    seedSession('s-pm2-review-2', USER_ID);
    seedSession('s-child-review-fail', USER_ID);

    const pm2 = store.createHandoff({
      userId: USER_ID,
      fromSessionId: 's-pm2-review-parent-2',
      fromRoleLayer: 'pm1',
      toRoleLayer: 'pm2',
    });
    store.claimHandoff({ handoffId: pm2.id, claimToken: 'tok-pm2-review-2' });
    store.startHandoff({
      handoffId: pm2.id,
      claimToken: 'tok-pm2-review-2',
      toSessionId: 's-pm2-review-2',
    });

    const child = store.createHandoff({
      userId: USER_ID,
      fromSessionId: 's-pm2-review-2',
      fromRoleLayer: 'pm2',
      toRoleLayer: 'executor',
    });
    store.claimHandoff({ handoffId: child.id, claimToken: 'tok-child-fail' });
    store.startHandoff({
      handoffId: child.id,
      claimToken: 'tok-child-fail',
      toSessionId: 's-child-review-fail',
    });
    store.failHandoff({
      handoffId: child.id,
      claimToken: 'tok-child-fail',
      reason: 'runner-fail',
    });

    dbModule.sqliteRun(
      `UPDATE handoff_records
          SET result_json = ?
        WHERE id = ?`,
      [
        JSON.stringify({
          dispatchedHandoffIds: [child.id],
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
    expect(after?.failureReason).toBe('quality-review-degraded-summary-failed:1');
  });
});

describe('HandoffWatcher.recoveryTick', () => {
  it('心跳超时的 running 退回 pending（retry+1）', async () => {
    const watcher = new watcherModule.HandoffWatcher({
      scheduler: new InProcessScheduler(),
      // 用极短的 stale 阈值 + maxRetry 让测试可控
      heartbeatStaleAfterMs: 1,
      maxRetry: 5,
    });
    const created = store.createHandoff({
      userId: USER_ID,
      fromSessionId: FROM_SESSION_ID,
      fromRoleLayer: 'pm2',
      toRoleLayer: 'executor',
    });
    store.claimHandoff({ handoffId: created.id, claimToken: 'tok' });
    // 手动创建 to session，模拟 watcher 之前的工作
    seedSession('to-session-recovery', USER_ID);
    store.startHandoff({
      handoffId: created.id,
      claimToken: 'tok',
      toSessionId: 'to-session-recovery',
    });
    // 不写 heartbeat → 视为超时

    // 等够 stale 阈值
    await new Promise((r) => setTimeout(r, 5));

    const result = await watcher.recoveryTick();
    expect(result.recovered).toBe(1);
    const re = store.getHandoff({ userId: USER_ID, handoffId: created.id });
    expect(re?.state).toBe('pending');
    expect(re?.retryCount).toBe(1);
  });

  it('§0.148: tickOnce 派发的在途 handoff 心跳保持新鲜，recoveryTick 不误回收', async () => {
    // 注入一个阻塞的 taskRunner：模拟 pm1/pm2 这类非流式 runner——它们自己从不写
    // 心跳（只有流式 executor/reviewer 路径写）。修复前 watcher 也不补心跳，子
    // session 的 last_heartbeat 停留在 NULL，被 reclaim 查询当成「立即超时」。
    let releaseRunner: () => void = () => undefined;
    const runnerGate = new Promise<void>((resolve) => {
      releaseRunner = resolve;
    });
    const watcher = new watcherModule.HandoffWatcher({
      scheduler: new InProcessScheduler(),
      heartbeatStaleAfterMs: 60_000,
      maxRetry: 5,
      taskRunner: async () => {
        await runnerGate; // 模拟仍在执行的长任务
      },
    });

    store.createHandoff({
      userId: USER_ID,
      fromSessionId: FROM_SESSION_ID,
      fromRoleLayer: 'reception',
      toRoleLayer: 'pm1',
    });

    const tick = await watcher.tickOnce();
    expect(tick.claimed).toBe(1);

    // 子 session 已创建；watcher 在 run wrapper 起始同步打了一次心跳。
    const running = store
      .listHandoffsBySession({ userId: USER_ID, sessionId: FROM_SESSION_ID })
      .find((h) => h.toRoleLayer === 'pm1' && h.state === 'running');
    if (!running || !running.toSessionId) {
      throw new Error('expected a running pm1 handoff with a child session');
    }
    const hbRow = dbModule.sqliteGet<{ last_heartbeat: string | null }>(
      `SELECT last_heartbeat FROM sessions WHERE id = ?`,
      [running.toSessionId],
    );
    expect(hbRow?.last_heartbeat).not.toBeNull();

    // 心跳新鲜 → 恢复 tick 不得回收这个健康的在途 handoff。
    const recovery = await watcher.recoveryTick();
    expect(recovery.recovered).toBe(0);
    expect(store.getHandoff({ userId: USER_ID, handoffId: running.id })?.state).toBe('running');

    // 收尾：释放 runner 并停 watcher（清理心跳泵）。
    releaseRunner();
    await watcher.stop();
  });
});

describe('heartbeat helpers', () => {
  it('touchSessionHeartbeat 写入 last_heartbeat', () => {
    seedSession('hb-session', USER_ID);
    heartbeat.touchSessionHeartbeat('hb-session');
    const row = dbModule.sqliteGet<{ last_heartbeat: string | null }>(
      `SELECT last_heartbeat FROM sessions WHERE id = ?`,
      ['hb-session'],
    );
    expect(row?.last_heartbeat).not.toBeNull();
  });

  it('clearSessionHeartbeat 清空', () => {
    seedSession('hb2', USER_ID);
    heartbeat.touchSessionHeartbeat('hb2');
    heartbeat.clearSessionHeartbeat('hb2');
    const row = dbModule.sqliteGet<{ last_heartbeat: string | null }>(
      `SELECT last_heartbeat FROM sessions WHERE id = ?`,
      ['hb2'],
    );
    expect(row?.last_heartbeat).toBeNull();
  });

  it('findStaleHeartbeatCutoffIso 返回 ISO-like 字符串', () => {
    const iso = heartbeat.findStaleHeartbeatCutoffIso(60_000);
    expect(iso).toMatch(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/);
  });
});

describe('start/stop 生命周期', () => {
  it('start 后 stop 不挂起', async () => {
    vi.useFakeTimers();
    try {
      const watcher = new watcherModule.HandoffWatcher({
        scheduler: new InProcessScheduler(),
        watcherIntervalMs: 100,
        recoveryIntervalMs: 5_000,
      });
      watcher.start();
      await watcher.stop();
      // 没异常即通过
    } finally {
      vi.useRealTimers();
    }
  });
});
