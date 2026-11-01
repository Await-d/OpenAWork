/**
 * 周期整理任务持久化与租约回归（真实内存 SQLite）。
 *
 * 覆盖：同周期幂等入队、并发领取互斥、迟到 worker 不得覆盖、租约回收、
 * 重试退避与失败上限、维护水位 UPSERT、报告读写与通知标记。
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type * as DbModule from '../../infra/db.js';
import type * as JobStoreModule from '../../memory/governance/memory-job-store.js';

process.env['DATABASE_URL'] = ':memory:';
process.env['OPENAWORK_APP_VERSION'] = '0.0.0-test';

let dbModule: typeof DbModule;
let jobs: typeof JobStoreModule;

const USER_ID = 'u-memory-jobs';
const OWNER_A = 'worker-a';
const OWNER_B = 'worker-b';

const BASE_TIME = new Date('2026-11-01T00:00:00.000Z');

function at(offsetMs: number): Date {
  return new Date(BASE_TIME.getTime() + offsetMs);
}

function userScope(): { type: 'user'; id: string } {
  return { type: 'user', id: USER_ID };
}

beforeAll(async () => {
  dbModule = await import('../../infra/db.js');
  await dbModule.connectDb();
  await dbModule.migrate();
  jobs = await import('../../memory/governance/memory-job-store.js');
});

beforeEach(() => {
  dbModule.sqliteRun('DELETE FROM memory_jobs', []);
  dbModule.sqliteRun('DELETE FROM memory_maintenance_reports', []);
  dbModule.sqliteRun('DELETE FROM memory_maintenance_state', []);
  dbModule.sqliteRun('DELETE FROM users', []);
  dbModule.sqliteRun("INSERT OR IGNORE INTO users (id, email, password_hash) VALUES (?, ?, 'x')", [
    USER_ID,
    `${USER_ID}@example.com`,
  ]);
});

afterAll(async () => {
  await dbModule.closeDb();
});

function countJobs(): number {
  return dbModule.sqliteGet<{ n: number }>('SELECT COUNT(*) AS n FROM memory_jobs', [])?.n ?? 0;
}

function readJob(jobId: string): {
  status: string;
  attempts: number;
  due_at: string;
  lease_owner: string | null;
  lease_token: string | null;
} {
  const row = dbModule.sqliteGet<{
    status: string;
    attempts: number;
    due_at: string;
    lease_owner: string | null;
    lease_token: string | null;
  }>('SELECT status, attempts, due_at, lease_owner, lease_token FROM memory_jobs WHERE id = ?', [
    jobId,
  ]);
  if (row === undefined) {
    throw new Error(`job ${jobId} not found`);
  }
  return row;
}

function enqueueDue(periodKey = '2026-11-01'): string {
  jobs.enqueueMemoryJob({
    userId: USER_ID,
    kind: 'daily_patrol',
    scope: userScope(),
    periodKey,
    dueAt: at(0).toISOString(),
    now: at(0),
  });
  const row = dbModule.sqliteGet<{ id: string }>(
    'SELECT id FROM memory_jobs WHERE period_key = ?',
    [periodKey],
  );
  if (row === undefined) {
    throw new Error('enqueue failed');
  }
  return row.id;
}

describe('memory-job-store · 入队与领取', () => {
  it('同周期重复入队只建一行，到期后可被 claim', () => {
    const jobId = enqueueDue();
    jobs.enqueueMemoryJob({
      userId: USER_ID,
      kind: 'daily_patrol',
      scope: userScope(),
      periodKey: '2026-11-01',
      dueAt: at(0).toISOString(),
      now: at(0),
    });
    jobs.enqueueMemoryJob({
      userId: USER_ID,
      kind: 'daily_patrol',
      scope: userScope(),
      periodKey: '2026-11-01',
      dueAt: at(999).toISOString(),
      now: at(999),
    });

    expect(countJobs()).toBe(1);
    expect(readJob(jobId).status).toBe('queued');

    const lease = jobs.claimDueMemoryJob({ owner: OWNER_A, now: at(1) });
    expect(lease).not.toBeNull();
    expect(lease?.jobId).toBe(jobId);
    expect(lease?.scope).toEqual(userScope());
    expect(lease?.owner).toBe(OWNER_A);
    expect(typeof lease?.token).toBe('string');
    expect(readJob(jobId).status).toBe('running');
    expect(readJob(jobId).attempts).toBe(1);
  });

  it('未到期任务不可领取', () => {
    jobs.enqueueMemoryJob({
      userId: USER_ID,
      kind: 'daily_patrol',
      scope: userScope(),
      periodKey: '2026-11-02',
      dueAt: at(60_000).toISOString(),
      now: at(0),
    });
    expect(jobs.claimDueMemoryJob({ owner: OWNER_A, now: at(0) })).toBeNull();
  });

  it('两方并发 claim 同一 job：只有一个拿到 lease，另一个返回 null', () => {
    const jobId = enqueueDue();

    const first = jobs.claimDueMemoryJob({ owner: OWNER_A, now: at(1) });
    const second = jobs.claimDueMemoryJob({ owner: OWNER_B, now: at(1) });

    expect(first?.jobId).toBe(jobId);
    expect(second).toBeNull();
    expect(readJob(jobId).lease_owner).toBe(OWNER_A);
    expect(readJob(jobId).attempts).toBe(1);
  });

  it('kind 过滤生效：不匹配的任务不被领取', () => {
    enqueueDue('2026-11-03');
    const lease = jobs.claimDueMemoryJob({
      owner: OWNER_A,
      now: at(1),
      kinds: ['weekly_semantic'],
    });
    expect(lease).toBeNull();
    const matched = jobs.claimDueMemoryJob({
      owner: OWNER_A,
      now: at(1),
      kinds: ['daily_patrol'],
    });
    expect(matched).not.toBeNull();
  });
});

describe('memory-job-store · 租约 fencing', () => {
  it('completeMemoryJob 用旧 token 返回 false（迟到 worker 不覆盖）', () => {
    const jobId = enqueueDue();
    const leaseA = jobs.claimDueMemoryJob({ owner: OWNER_A, now: at(1) });
    expect(leaseA).not.toBeNull();

    // A 的租约过期，B 接手同一任务。
    jobs.recoverExpiredMemoryJobLeases(at(10 * 60 * 1000));
    const leaseB = jobs.claimDueMemoryJob({ owner: OWNER_B, now: at(10 * 60 * 1000 + 1) });
    expect(leaseB?.jobId).toBe(jobId);

    // A 迟到完成：token 已被 B 覆盖 → 不得改动状态。
    expect(jobs.completeMemoryJob(leaseA!, at(10 * 60 * 1000 + 2))).toBe(false);
    expect(readJob(jobId).status).toBe('running');
    expect(readJob(jobId).lease_owner).toBe(OWNER_B);

    // B 正常完成。
    expect(jobs.completeMemoryJob(leaseB!, at(10 * 60 * 1000 + 3))).toBe(true);
    expect(readJob(jobId).status).toBe('succeeded');
    expect(readJob(jobId).lease_owner).toBeNull();
  });

  it('renewMemoryJobLease 只有持原 token 的 worker 能续', () => {
    enqueueDue();
    const leaseA = jobs.claimDueMemoryJob({ owner: OWNER_A, now: at(1) });
    expect(jobs.renewMemoryJobLease(leaseA!, at(60_000))).toBe(true);
    expect(jobs.renewMemoryJobLease({ ...leaseA!, token: 'stale-token' }, at(60_000))).toBe(false);
  });

  it('recoverExpiredMemoryJobLeases 把过期 running 拉回 retry_wait', () => {
    const jobId = enqueueDue();
    jobs.claimDueMemoryJob({ owner: OWNER_A, now: at(1) });

    expect(jobs.recoverExpiredMemoryJobLeases(at(60_000))).toBe(0);

    const recovered = jobs.recoverExpiredMemoryJobLeases(at(6 * 60 * 1000));
    expect(recovered).toBe(1);
    const row = readJob(jobId);
    expect(row.status).toBe('retry_wait');
    expect(row.lease_owner).toBeNull();
    expect(row.lease_token).toBeNull();

    const lastError = dbModule.sqliteGet<{ last_error: string | null }>(
      'SELECT last_error FROM memory_jobs WHERE id = ?',
      [jobId],
    );
    expect(lastError?.last_error).toBe('lease_expired');

    // 回收后立即可被重新领取。
    expect(jobs.claimDueMemoryJob({ owner: OWNER_B, now: at(6 * 60 * 1000 + 1) })?.jobId).toBe(
      jobId,
    );
  });
});

describe('memory-job-store · 失败与退避', () => {
  it('failMemoryJob 未达上限置 retry_wait 且 due_at 前移', () => {
    const jobId = enqueueDue();
    const lease = jobs.claimDueMemoryJob({ owner: OWNER_A, now: at(1) })!;

    expect(jobs.failMemoryJob(lease, 'boom', at(1000))).toBe(true);
    const row = readJob(jobId);
    expect(row.status).toBe('retry_wait');
    expect(row.attempts).toBe(1);
    expect(new Date(row.due_at).getTime()).toBeGreaterThan(at(1000).getTime());
    expect(row.lease_owner).toBeNull();

    // 旧 token 再失败无效。
    expect(jobs.failMemoryJob(lease, 'late', at(2000))).toBe(false);
  });

  it('failMemoryJob 在 attempts 达上限后置 failed', () => {
    const jobId = enqueueDue();
    let finalLease: JobStoreModule.MemoryJobLease | null = null;

    for (let attempt = 0; attempt < 5; attempt += 1) {
      const current = jobs.claimDueMemoryJob({
        owner: OWNER_A,
        now: at(50_000_000 * (attempt + 1)),
      });
      if (current === null) {
        // 前一次失败把 due_at 推到未来，直接把 due_at 拉回以便继续尝试。
        dbModule.sqliteRun('UPDATE memory_jobs SET due_at = ? WHERE id = ?', [
          at(50_000_000 * (attempt + 1)).toISOString(),
          jobId,
        ]);
        const retried = jobs.claimDueMemoryJob({
          owner: OWNER_A,
          now: at(50_000_000 * (attempt + 1) + 1),
        });
        expect(retried).not.toBeNull();
        finalLease = retried;
      } else {
        finalLease = current;
      }
      jobs.failMemoryJob(finalLease!, 'boom', at(50_000_000 * (attempt + 1) + 2));
    }

    const row = readJob(jobId);
    expect(row.attempts).toBe(5);
    expect(row.status).toBe('failed');
  });

  it('releaseMemoryJob 交还任务且立即可再领', () => {
    const jobId = enqueueDue();
    const lease = jobs.claimDueMemoryJob({ owner: OWNER_A, now: at(1) })!;
    expect(jobs.releaseMemoryJob(lease, 'yield', at(2))).toBe(true);
    expect(readJob(jobId).status).toBe('retry_wait');
    expect(jobs.claimDueMemoryJob({ owner: OWNER_B, now: at(2) })?.jobId).toBe(jobId);
  });
});

describe('memory-job-store · 维护水位与报告', () => {
  it('readMemoryMaintenanceState 无行返回默认值；write 走 UPSERT', () => {
    expect(jobs.readMemoryMaintenanceState(USER_ID)).toEqual({
      changeWatermark: 0,
      lastPatrolAt: null,
      lastSemanticAt: null,
      lastReviewAt: null,
    });

    jobs.writeMemoryMaintenanceState(USER_ID, { changeWatermark: 42 }, at(1));
    expect(jobs.readMemoryMaintenanceState(USER_ID).changeWatermark).toBe(42);

    // 部分 patch 不得覆盖已有字段。
    jobs.writeMemoryMaintenanceState(USER_ID, { lastPatrolAt: at(2).toISOString() }, at(2));
    const row = jobs.readMemoryMaintenanceState(USER_ID);
    expect(row.changeWatermark).toBe(42);
    expect(row.lastPatrolAt).toBe(at(2).toISOString());
  });

  it('countPendingMemoryJobs 统计未结束且到期的任务', () => {
    enqueueDue('2026-11-04');
    jobs.enqueueMemoryJob({
      userId: USER_ID,
      kind: 'weekly_semantic',
      scope: userScope(),
      periodKey: '2026-W44',
      dueAt: at(60_000).toISOString(),
      now: at(0),
    });
    expect(jobs.countPendingMemoryJobs(at(0))).toBe(1);
    expect(jobs.countPendingMemoryJobs(at(60_000))).toBe(2);
  });

  it('报告创建 / 列出未通知 / 标记已通知', () => {
    const jobId = enqueueDue();
    void jobId;
    const reportId = jobs.createMemoryMaintenanceReport({
      userId: USER_ID,
      jobId,
      scope: userScope(),
      summary: {
        kind: 'daily_patrol',
        scope: userScope(),
        checked: 3,
        proposalsCreated: 1,
        expiredProposals: 0,
        duplicates: 0,
        conflicts: 0,
        transient: 0,
        notes: [],
      },
      watermark: 7,
      now: at(5),
    });

    const pending = jobs.listUnnotifiedMemoryMaintenanceReports(USER_ID);
    expect(pending).toHaveLength(1);
    expect(pending[0]?.id).toBe(reportId);
    expect(pending[0]?.summary.proposalsCreated).toBe(1);
    expect(pending[0]?.scope).toEqual(userScope());

    jobs.markMemoryMaintenanceReportsNotified([reportId], at(6));
    expect(jobs.listUnnotifiedMemoryMaintenanceReports(USER_ID)).toHaveLength(0);

    // 重复标记是幂等的 no-op。
    jobs.markMemoryMaintenanceReportsNotified([reportId], at(7));
    expect(jobs.listUnnotifiedMemoryMaintenanceReports(USER_ID)).toHaveLength(0);
  });

  it('createMemoryJobOwnerId 每次调用不同', () => {
    expect(jobs.createMemoryJobOwnerId()).not.toBe(jobs.createMemoryJobOwnerId());
  });
});
