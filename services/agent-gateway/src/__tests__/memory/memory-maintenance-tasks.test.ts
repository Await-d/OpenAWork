/**
 * 周期整理任务回归（内存 SQLite + migrate）。
 *
 * 覆盖：同周期规划幂等、日巡检重复/临时识别且**不改写正式记忆**、周增量
 * 「无变化跳过 / 有变化产冲突提议且两值都在」、job 租约互斥。
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { MemoryProposal } from '@openAwork/agent-core';
import type * as DbModule from '../../infra/db.js';
import type * as TasksModule from '../../memory/maintenance/memory-maintenance-tasks.js';
import type * as SchedulerModule from '../../memory/maintenance/memory-maintenance-scheduler.js';
import type * as JobStoreModule from '../../memory/governance/memory-job-store.js';
import type * as ProposalStoreModule from '../../memory/governance/memory-proposal-store.js';
import type * as MemoryStoreModule from '../../memory/memory-store.js';

process.env['DATABASE_URL'] = ':memory:';
process.env['OPENAWORK_APP_VERSION'] = '0.0.0-test';

let dbModule: typeof DbModule;
let tasks: typeof TasksModule;
let scheduler: typeof SchedulerModule;
let jobs: typeof JobStoreModule;
let proposals: typeof ProposalStoreModule;
let memoryStore: typeof MemoryStoreModule;

const USER_ID = 'u-maint-tasks';
const OWNER = 'maintenance-owner';
const BASE_TIME = new Date('2026-11-01T03:00:00.000Z');

function scope(): { type: 'user'; id: string } {
  return { type: 'user', id: USER_ID };
}

beforeAll(async () => {
  dbModule = await import('../../infra/db.js');
  await dbModule.connectDb();
  await dbModule.migrate();
  tasks = await import('../../memory/maintenance/memory-maintenance-tasks.js');
  scheduler = await import('../../memory/maintenance/memory-maintenance-scheduler.js');
  jobs = await import('../../memory/governance/memory-job-store.js');
  proposals = await import('../../memory/governance/memory-proposal-store.js');
  memoryStore = await import('../../memory/memory-store.js');
});

beforeEach(() => {
  dbModule.sqliteRun('DELETE FROM memory_jobs', []);
  dbModule.sqliteRun('DELETE FROM memory_maintenance_reports', []);
  dbModule.sqliteRun('DELETE FROM memory_maintenance_state', []);
  dbModule.sqliteRun('DELETE FROM memory_proposals', []);
  dbModule.sqliteRun('DELETE FROM memory_review_decisions', []);
  dbModule.sqliteRun('DELETE FROM memories', []);
  dbModule.sqliteRun('DELETE FROM users', []);
  dbModule.sqliteRun("INSERT OR IGNORE INTO users (id, email, password_hash) VALUES (?, ?, 'x')", [
    USER_ID,
    `${USER_ID}@example.com`,
  ]);
});

afterAll(async () => {
  await dbModule.closeDb();
});

function seedMemory(key: string, value: string, type: 'fact' | 'preference' = 'fact'): string {
  return memoryStore.createMemory(USER_ID, { type, key, value, source: 'manual', scope: scope() })
    .id;
}

function listPendingProposals(): MemoryProposal[] {
  return proposals.listMemoryProposals(USER_ID, { status: ['pending'], limit: 100 });
}

describe('planMemoryMaintenanceJobs · 周期规划', () => {
  it('同日重复调用只建一次 job（countPendingMemoryJobs 断言）', () => {
    seedMemory('语言', '中文');

    const first = tasks.planMemoryMaintenanceJobs({ now: BASE_TIME, userIds: [USER_ID] });
    // 3 个 kind × 1 个 scope = 3 个 job。
    expect(first).toBe(3);
    // 无一条 job 到期（dueAt 全部 <= now，故 countPendingMemoryJobs(now) 统计到 3）。
    expect(jobs.countPendingMemoryJobs(BASE_TIME)).toBe(3);

    const second = tasks.planMemoryMaintenanceJobs({ now: BASE_TIME, userIds: [USER_ID] });
    expect(second).toBe(0);
    expect(jobs.countPendingMemoryJobs(BASE_TIME)).toBe(3);
  });

  it('无正式记忆的用户不产生任务', () => {
    const created = tasks.planMemoryMaintenanceJobs({ now: BASE_TIME, userIds: [USER_ID] });
    expect(created).toBe(0);
    expect(jobs.countPendingMemoryJobs(BASE_TIME)).toBe(0);
  });
});

describe('日巡检 · 确定性识别', () => {
  it('重复项确认前不变，确认后仅保留一条active且历史条目保留', async () => {
    // 唯一索引按**原始** key 判定，故「大小写 / 空白不同、规范化后相同」的两条
    // 可同时 active —— 这正是日巡检要识别的「完全重复」。
    const firstId = seedMemory('编辑器', 'VSCode');
    const secondId = seedMemory('  编辑器 ', '  vscode ');

    const beforeFirst = memoryStore.getMemoryById(USER_ID, firstId);
    const beforeSecond = memoryStore.getMemoryById(USER_ID, secondId);

    const summary = tasks.buildDailyPatrolSummary(USER_ID, scope(), BASE_TIME);
    expect(summary.duplicates).toBe(1);

    const mergeProposals = listPendingProposals().filter((p) => p.action === 'merge');
    expect(mergeProposals.length).toBe(1);
    expect(mergeProposals[0]?.reason).toContain('重复');

    // 正式记忆内容、revision 均未变。
    const afterFirst = memoryStore.getMemoryById(USER_ID, firstId);
    const afterSecond = memoryStore.getMemoryById(USER_ID, secondId);
    expect(afterFirst?.value).toBe(beforeFirst?.value);
    expect(afterFirst?.revision).toBe(beforeFirst?.revision);
    expect(afterSecond?.value).toBe(beforeSecond?.value);
    expect(afterSecond?.revision).toBe(beforeSecond?.revision);
    const proposal = mergeProposals[0];
    if (!proposal) throw new Error('缺少重复提案');
    const { commitMemoryProposal } =
      await import('../../memory/governance/memory-commit-service.js');
    const committed = commitMemoryProposal({
      userId: USER_ID,
      decidedBy: USER_ID,
      proposalId: proposal.id,
      now: BASE_TIME,
    });
    expect(committed.ok).toBe(true);
    expect(memoryStore.listActiveMemoriesForScope(USER_ID, scope())).toHaveLength(1);
    expect(committed.memory?.lifecycle).toBe('superseded');
    expect(committed.memory?.supersededBy).toBe(proposal.payload.mergeIntoId);
    expect(memoryStore.getMemoryById(USER_ID, firstId)).toBeDefined();
    expect(memoryStore.getMemoryById(USER_ID, secondId)).toBeDefined();
  });

  it('合并提案待确认期间保留项变化，不能归档仍有用的重复项', async () => {
    seedMemory('编辑器', 'VSCode');
    seedMemory(' 编辑器 ', ' vscode ');
    tasks.buildDailyPatrolSummary(USER_ID, scope(), BASE_TIME);
    const proposal = listPendingProposals().find((entry) => entry.action === 'merge');
    if (!proposal?.payload.mergeIntoId) throw new Error('缺少保留项');
    memoryStore.updateMemory(USER_ID, proposal.payload.mergeIntoId, { value: 'Emacs' });
    const { commitMemoryProposal } =
      await import('../../memory/governance/memory-commit-service.js');
    expect(
      commitMemoryProposal({
        userId: USER_ID,
        decidedBy: USER_ID,
        proposalId: proposal.id,
        now: BASE_TIME,
      }).ok,
    ).toBe(false);
    expect(memoryStore.listActiveMemoriesForScope(USER_ID, scope())).toHaveLength(2);
  });

  it('疑似临时信息 → 产生 archive 提议且记忆仍 active', () => {
    const id = seedMemory('临时分支', '临时用一下这个分支');

    const summary = tasks.buildDailyPatrolSummary(USER_ID, scope(), BASE_TIME);
    expect(summary.transient).toBe(1);

    const archiveProposals = listPendingProposals().filter((p) => p.action === 'archive');
    expect(archiveProposals.length).toBe(1);

    expect(memoryStore.getMemoryById(USER_ID, id)?.lifecycle).toBe('active');
    expect(memoryStore.getMemoryById(USER_ID, id)?.enabled).toBe(true);
  });

  it('value 为空的记忆计入 note 但不生成提议', () => {
    seedMemory('空值', '   ');
    const summary = tasks.buildDailyPatrolSummary(USER_ID, scope(), BASE_TIME);
    expect(summary.proposalsCreated).toBe(0);
    expect(summary.notes.some((note) => note.includes('value 为空'))).toBe(true);
  });
});

describe('周增量 · 水位与冲突', () => {
  it('报告写入失败时任务完成与scope水位一起回滚，下次可以重试', async () => {
    seedMemory('运行环境', 'bun');
    jobs.enqueueMemoryJob({
      userId: USER_ID,
      kind: 'weekly_semantic',
      scope: scope(),
      periodKey: 'report-rollback',
      dueAt: BASE_TIME.toISOString(),
      now: BASE_TIME,
    });
    dbModule.sqliteRun(`CREATE TEMP TRIGGER fail_maintenance_report BEFORE INSERT ON memory_maintenance_reports
      BEGIN SELECT RAISE(ABORT, 'report write failed'); END`);
    try {
      const result = await tasks.runMemoryMaintenanceTick({
        now: BASE_TIME,
        owner: OWNER,
        maxJobs: 1,
      });
      expect(result.failed).toBe(1);
      expect(result.completed).toBe(0);
      expect(result.summaries).toEqual([]);
      expect(
        dbModule.sqliteGet<{ status: string }>(
          'SELECT status FROM memory_jobs WHERE period_key = ?',
          ['report-rollback'],
        )?.status,
      ).toBe('retry_wait');
      expect(
        dbModule.sqliteGet('SELECT * FROM memory_scope_watermarks WHERE user_id = ?', [USER_ID]),
      ).toBeUndefined();
      expect(jobs.readMemoryMaintenanceState(USER_ID).changeWatermark).toBe(0);
      expect(jobs.listUnnotifiedMemoryMaintenanceReports(USER_ID)).toEqual([]);
    } finally {
      dbModule.sqliteRun('DROP TRIGGER fail_maintenance_report');
    }
    const retried = await tasks.runMemoryMaintenanceTick({
      now: new Date(BASE_TIME.getTime() + 120_000),
      owner: OWNER,
      maxJobs: 1,
    });
    expect(retried.completed).toBe(1);
    expect(jobs.listUnnotifiedMemoryMaintenanceReports(USER_ID)).toHaveLength(1);
    expect(
      dbModule.sqliteGet<{ change_watermark: number }>(
        'SELECT change_watermark FROM memory_scope_watermarks WHERE user_id = ?',
        [USER_ID],
      )?.change_watermark,
    ).toBeGreaterThan(0);
  });
  it('不同scope的周任务不因其他scope推进用户水位而漏扫', async () => {
    for (const path of ['/a', '/b']) {
      memoryStore.createMemory(USER_ID, {
        type: 'fact',
        key: 'runtime',
        value: 'bun',
        scope: { type: 'workspace', id: path },
      });
      jobs.enqueueMemoryJob({
        userId: USER_ID,
        kind: 'weekly_semantic',
        scope: { type: 'workspace', id: path },
        periodKey: 'scope-regression',
        dueAt: BASE_TIME.toISOString(),
        now: BASE_TIME,
      });
    }
    const result = await tasks.runMemoryMaintenanceTick({
      now: BASE_TIME,
      owner: OWNER,
      maxJobs: 2,
    });
    expect(result.completed).toBe(2);
    const reports = jobs.listUnnotifiedMemoryMaintenanceReports(USER_ID);
    expect(reports.map((report) => report.scope.id).sort()).toEqual(['/a', '/b']);
  });
  it('changeWatermark 之后无变化 → 不产生提议、不产生报告', () => {
    seedMemory('键', '值');
    const state = jobs.readMemoryMaintenanceState(USER_ID);
    // 水位设为当前最大值 → 无变化。
    const maxSeq = memoryStore.listActiveMemoriesChangedSince(USER_ID, 0)[0]?.changeSeq ?? 0;
    const { summary } = tasks.buildIncrementalSummary(USER_ID, scope(), maxSeq, BASE_TIME);
    expect(summary.checked).toBe(0);
    expect(listPendingProposals()).toHaveLength(0);
    expect(jobs.listUnnotifiedMemoryMaintenanceReports(USER_ID)).toHaveLength(0);
    void state;
  });

  it('有变化且同键不同值 → 产生 update 提议且两个旧值都还在', () => {
    // 两个原始 key 不同、规范化后同键（`部署环境` vs `部署环境 `），value 不同。
    const firstId = seedMemory('部署环境', '生产 A');
    const secondId = seedMemory('部署环境 ', '生产 B');

    // 水位设为 0（模拟「有变化」）。
    const { summary } = tasks.buildIncrementalSummary(USER_ID, scope(), 0, BASE_TIME);
    expect(summary.conflicts).toBe(1);

    const updateProposals = listPendingProposals().filter((p) => p.action === 'update');
    expect(updateProposals.length).toBe(1);
    expect(updateProposals[0]?.reason).toContain('不同取值');

    // 两个旧值都还在（没有被自动覆盖）。
    expect(memoryStore.getMemoryById(USER_ID, firstId)?.value).toBe('生产 A');
    expect(memoryStore.getMemoryById(USER_ID, secondId)?.value).toBe('生产 B');
  });
});

describe('runMemoryMaintenanceTick · 租约与异常隔离', () => {
  it('正在运行（lease 未过期）时另一个 owner claim 不到', async () => {
    seedMemory('键', '值');
    tasks.planMemoryMaintenanceJobs({ now: BASE_TIME, userIds: [USER_ID] });

    // owner A 先领一个。
    const firstRun = await tasks.runMemoryMaintenanceTick({
      now: BASE_TIME,
      owner: 'owner-a',
      maxJobs: 1,
    });
    expect(firstRun.claimed).toBe(1);

    // owner B 用同一时间（租约未过期）claim：模块内部会先 recoverExpired（不到期不回收），
    // 故 B 只能领到剩余 2 个，不能领到 A 正在持有的那个。
    const secondRun = await tasks.runMemoryMaintenanceTick({
      now: BASE_TIME,
      owner: 'owner-b',
      maxJobs: 10,
    });
    expect(secondRun.claimed).toBe(2);
  });

  it('tick 全流程可完成并写入报告状态', async () => {
    seedMemory('键', '常规值');
    tasks.planMemoryMaintenanceJobs({ now: BASE_TIME, userIds: [USER_ID] });

    const result = await tasks.runMemoryMaintenanceTick({
      now: BASE_TIME,
      owner: OWNER,
      maxJobs: 10,
    });
    expect(result.claimed).toBe(3);
    expect(result.failed).toBe(0);
    // 日巡检 + 月复核各写一份报告。
    expect(result.summaries.length).toBeGreaterThanOrEqual(1);
    expect(jobs.countPendingMemoryJobs(BASE_TIME)).toBe(0);
  });
});

describe('registerMemoryGovernanceBackgroundTasks · 开关', () => {
  function collectRegistrations(env: Record<string, string | undefined>): string[] {
    const names: string[] = [];
    scheduler.registerMemoryGovernanceBackgroundTasks(
      {
        register: (task) => {
          names.push(task.name);
        },
      },
      { env },
    );
    return names;
  }

  it('OPENAWORK_DISABLE_MEMORY_MAINTENANCE=1 时不注册任何任务', () => {
    expect(collectRegistrations({ OPENAWORK_DISABLE_MEMORY_MAINTENANCE: '1' })).toEqual([]);
    expect(collectRegistrations({ OPENAWORK_DISABLE_MEMORY_MAINTENANCE: 'true' })).toEqual([]);
  });

  it('默认注册三个任务，且非法间隔回落默认', () => {
    const names = collectRegistrations({});
    expect(names).toEqual([
      'memory.governance.tick',
      'memory.governance.notify',
      'memory.governance.lease-recovery',
    ]);
  });

  it('env 覆盖非法值（0 / NaN）时回落默认而不是抛错', () => {
    const names = collectRegistrations({
      MEMORY_MAINTENANCE_INTERVAL_MS: '0',
      MEMORY_NOTIFY_INTERVAL_MS: 'not-a-number',
    });
    expect(names).toHaveLength(3);
  });
});
