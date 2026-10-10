/**
 * 「读路径不再写库」的回归防线。
 *
 * 背景：`hasPendingSessionInteraction` 曾经顺带调 `releaseStaleDecidingSessionRecords`，
 * 而它被 `GET /sessions` 列表对**每条会话**各调一次。于是一次列表请求最坏产生 N×2 个
 * 写事务（`limit` 上限 100），叠加侧栏 30s 轮询后就是每分钟数百个写事务去抢 SQLite
 * 写锁——纯放大器，且对数据毫无改变（僵尸 `deciding` 本来就被计入「未处理」）。
 *
 * 现在拆成两件事：
 *   - 判定 = 纯读（`hasPendingSessionInteraction`）
 *   - 回收 = 显式（批量路由入口 / pending 列表接口 / reconcile 默认开启）
 *
 * 因此本文件同时钉住两条不变量：
 *   1. 判定不再改数据；
 *   2. 回收能力没有跟着一起消失——用户该看到的待办仍然看得到。
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type * as DbModule from '../../infra/db.js';
import type * as RuntimeStateModule from '../../session/session-runtime-state.js';

process.env['DATABASE_URL'] = ':memory:';
process.env['OPENAWORK_APP_VERSION'] = '0.0.0-test';

let dbModule: typeof DbModule;
let runtimeState: typeof RuntimeStateModule;

const USER_ID = 'u-deciding-amplification';
const SESSION_ID = 'sess-deciding-amplification';

interface StatusRow {
  status: string;
  updated_at: string;
}

function seedSession(id = SESSION_ID, userId = USER_ID): void {
  dbModule.sqliteRun(
    `INSERT OR IGNORE INTO sessions (id, user_id, title, metadata_json, state_status)
     VALUES (?, ?, 'deciding', '{}', 'paused')`,
    [id, userId],
  );
}

/** 种一条超过 10 分钟没推进的僵尸 `deciding`。 */
function seedZombieDeciding(
  options: {
    id: string;
    sessionId?: string;
    table?: 'permission_requests' | 'question_requests';
  } = {
    id: 'perm-zombie',
  },
): void {
  const table = options.table ?? 'permission_requests';
  const sessionId = options.sessionId ?? SESSION_ID;
  const insert =
    table === 'permission_requests'
      ? `INSERT INTO permission_requests
           (id, session_id, tool_name, scope, reason, risk_level, status, created_at, updated_at)
         VALUES (?, ?, 'bash', 'bash pwd', '读取目录', 'low', 'deciding',
                 datetime('now', '-30 minutes'), datetime('now', '-30 minutes'))`
      : `INSERT INTO question_requests
           (id, session_id, user_id, tool_name, title, questions_json, status, created_at, updated_at)
         VALUES (?, ?, ?, 'ask', '需要澄清', '[]', 'deciding',
                 datetime('now', '-30 minutes'), datetime('now', '-30 minutes'))`;
  const params =
    table === 'permission_requests' ? [options.id, sessionId] : [options.id, sessionId, USER_ID];
  dbModule.sqliteRun(insert, params);
}

function statusOf(
  id: string,
  table: 'permission_requests' | 'question_requests' = 'permission_requests',
) {
  return dbModule.sqliteGet<StatusRow>(`SELECT status, updated_at FROM ${table} WHERE id = ?`, [
    id,
  ]);
}

beforeAll(async () => {
  dbModule = await import('../../infra/db.js');
  await dbModule.migrate();
  runtimeState = await import('../../session/session-runtime-state.js');
});

beforeEach(() => {
  dbModule.sqliteRun('DELETE FROM permission_requests', []);
  dbModule.sqliteRun('DELETE FROM question_requests', []);
  dbModule.sqliteRun('DELETE FROM sessions', []);
  dbModule.sqliteRun('DELETE FROM users', []);
  dbModule.sqliteRun('INSERT INTO users (id, email, password_hash) VALUES (?, ?, ?)', [
    USER_ID,
    `${USER_ID}@example.com`,
    'x',
  ]);
  seedSession();
});

afterAll(async () => {
  await dbModule.closeDb();
});

describe('hasPendingSessionInteraction 不再写库', () => {
  it('判定僵尸 deciding 仍然算「未处理」，但绝不改动记录本身', () => {
    seedZombieDeciding();

    expect(runtimeState.hasPendingSessionInteraction(SESSION_ID)).toBe(true);

    // 关键断言：判定是纯读。若这里变成 'pending'，说明写操作又回到了读路径。
    expect(statusOf('perm-zombie')?.status).toBe('deciding');
  });

  it('判定新鲜 deciding 也算未处理，且不改数据', () => {
    dbModule.sqliteRun(
      `INSERT INTO permission_requests
         (id, session_id, tool_name, scope, reason, risk_level, status, created_at, updated_at)
       VALUES ('perm-live', ?, 'bash', 'bash pwd', '读取目录', 'low', 'deciding',
               datetime('now'), datetime('now'))`,
      [SESSION_ID],
    );
    const before = statusOf('perm-live');

    expect(runtimeState.hasPendingSessionInteraction(SESSION_ID)).toBe(true);

    expect(statusOf('perm-live')).toEqual(before);
  });

  it('无任何交互时返回 false', () => {
    expect(runtimeState.hasPendingSessionInteraction(SESSION_ID)).toBe(false);
  });
});

describe('僵尸 deciding 的回收能力未丢失', () => {
  it('单会话释放把超时 deciding 退回 pending，未超时的不动', () => {
    seedZombieDeciding({ id: 'perm-stale' });
    dbModule.sqliteRun(
      `INSERT INTO permission_requests
         (id, session_id, tool_name, scope, reason, risk_level, status, created_at, updated_at)
       VALUES ('perm-live', ?, 'bash', 'bash pwd', '读取目录', 'low', 'deciding',
               datetime('now'), datetime('now'))`,
      [SESSION_ID],
    );

    // 单会话释放的唯一生产入口是 reconcile（该函数刻意不导出），所以从这里验证。
    runtimeState.reconcileSessionStateStatus({ sessionId: SESSION_ID, userId: USER_ID });

    expect(statusOf('perm-stale')?.status).toBe('pending');
    // 在途决策（未超时）绝不能被抢回 pending，否则会重复弹审批。
    expect(statusOf('perm-live')?.status).toBe('deciding');
  });

  it('按用户批量释放覆盖该用户全部会话，且不动别人的会话', () => {
    const otherUser = 'u-deciding-other';
    const otherSession = 'sess-deciding-other';
    dbModule.sqliteRun('INSERT INTO users (id, email, password_hash) VALUES (?, ?, ?)', [
      otherUser,
      `${otherUser}@example.com`,
      'x',
    ]);
    // 同一个用户的两个会话：都应被回收。
    seedSession('sess-deciding-mine-2', USER_ID);
    seedZombieDeciding({ id: 'perm-mine-a', sessionId: SESSION_ID });
    seedZombieDeciding({ id: 'perm-mine-b', sessionId: 'sess-deciding-mine-2' });
    // 别人的会话：即便同样是僵尸也不该被本用户的批量释放碰到。
    seedSession(otherSession, otherUser);
    seedZombieDeciding({ id: 'perm-theirs', sessionId: otherSession });

    runtimeState.releaseStaleDecidingSessionRecordsForUser(USER_ID);

    expect(statusOf('perm-mine-a')?.status).toBe('pending');
    expect(statusOf('perm-mine-b')?.status).toBe('pending');
    expect(statusOf('perm-theirs')?.status).toBe('deciding');
  });

  it('question_requests 的僵尸同样被回收', () => {
    seedZombieDeciding({ id: 'q-stale', table: 'question_requests' });

    expect(runtimeState.hasPendingSessionInteraction(SESSION_ID)).toBe(true);
    runtimeState.releaseStaleDecidingSessionRecordsForUser(USER_ID);

    expect(statusOf('q-stale', 'question_requests')?.status).toBe('pending');
  });

  it('reconcile 默认开启回收（启动对账 / remediation 依赖这一步）', () => {
    seedZombieDeciding({ id: 'perm-reconcile' });

    runtimeState.reconcileSessionStateStatus({ sessionId: SESSION_ID, userId: USER_ID });

    expect(statusOf('perm-reconcile')?.status).toBe('pending');
  });

  it('reconcile 传 releaseStaleDeciding=false 时不回收（批量读路径）', () => {
    seedZombieDeciding({ id: 'perm-bulk' });

    runtimeState.reconcileSessionStateStatus({
      releaseStaleDeciding: false,
      sessionId: SESSION_ID,
      userId: USER_ID,
    });

    expect(statusOf('perm-bulk')?.status).toBe('deciding');
  });
});

describe('releaseStaleDecidingSessionRecordsForUserThrottled 按用户节流', () => {
  it('窗口内第二次调用不再写库,且不波及别的用户', () => {
    const throttledUser = 'u-throttled';
    const otherUser = 'u-throttled-other';
    dbModule.sqliteRun('INSERT OR IGNORE INTO users (id, email, password_hash) VALUES (?, ?, ?)', [
      throttledUser,
      `${throttledUser}@example.com`,
      'x',
    ]);
    dbModule.sqliteRun('INSERT OR IGNORE INTO users (id, email, password_hash) VALUES (?, ?, ?)', [
      otherUser,
      `${otherUser}@example.com`,
      'x',
    ]);
    seedSession('sess-throttled', throttledUser);
    seedSession('sess-throttled-other', otherUser);

    // 第一拍:窗口内首次调用,正常释放。
    seedZombieDeciding({ id: 'perm-throttled-1', sessionId: 'sess-throttled' });
    runtimeState.releaseStaleDecidingSessionRecordsForUserThrottled(throttledUser);
    expect(statusOf('perm-throttled-1')?.status).toBe('pending');

    // 第二拍(同一用户、仍在窗口内):被节流跳过——新种的僵尸保持 deciding。
    // 这条断言就是「写放大被削掉」的证明:若节流失效,它会被改成 pending。
    seedZombieDeciding({ id: 'perm-throttled-2', sessionId: 'sess-throttled' });
    runtimeState.releaseStaleDecidingSessionRecordsForUserThrottled(throttledUser);
    expect(statusOf('perm-throttled-2')?.status).toBe('deciding');

    // 另一用户的节流桶相互独立:它的首次调用仍然即时释放。
    seedZombieDeciding({ id: 'perm-throttled-other', sessionId: 'sess-throttled-other' });
    runtimeState.releaseStaleDecidingSessionRecordsForUserThrottled(otherUser);
    expect(statusOf('perm-throttled-other')?.status).toBe('pending');
  });
});
