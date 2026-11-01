/**
 * 提议抑制机制的边界回归（261101-记忆确认写入与周期整理）。
 *
 * `memory_review_decisions` 的用途是「**别再反复问我同一件事**」：某条建议被拒绝 /
 * 保留原状后，同内容不再重复弹出。这对**自动积累**（抽取、渠道、维护）是必要节制。
 *
 * 但它不能变成「用户明确要求保存也不可能」：用户拒绝过一次「这条规则」，之后主动、显式地
 * 再提交同一内容，属于**新的明确指令**，必须重新生成待确认项；否则用户看到的是一个无法
 * 解释的失败（接口 400、界面无条目），且没有任何自助解除途径。
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type * as DbModule from '../../infra/db.js';
import type * as ProposalStoreModule from '../../memory/governance/memory-proposal-store.js';
import type * as CommitServiceModule from '../../memory/governance/memory-commit-service.js';

process.env['DATABASE_URL'] = ':memory:';

let dbModule: typeof DbModule;
let createMemoryProposal: typeof ProposalStoreModule.createMemoryProposal;
let rejectMemoryProposal: typeof CommitServiceModule.rejectMemoryProposal;

const USER_ID = 'u-suppression';

beforeAll(async () => {
  dbModule = await import('../../infra/db.js');
  await dbModule.connectDb();
  await dbModule.migrate();
  createMemoryProposal = (await import('../../memory/governance/memory-proposal-store.js'))
    .createMemoryProposal;
  rejectMemoryProposal = (await import('../../memory/governance/memory-commit-service.js'))
    .rejectMemoryProposal;
});

beforeEach(() => {
  dbModule.sqliteRun('DELETE FROM memory_proposals', []);
  dbModule.sqliteRun('DELETE FROM memory_review_decisions', []);
  dbModule.sqliteRun('DELETE FROM memory_revisions', []);
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

const SCOPE = { type: 'user' as const, id: USER_ID };

function autoProposal(key: string, value: string) {
  return createMemoryProposal({
    userId: USER_ID,
    action: 'create',
    scope: SCOPE,
    payload: { type: 'fact', key, value },
    origin: 'auto_extract',
    reason: '自动抽取（待确认）',
  });
}

function explicitProposal(key: string, value: string, origin: 'api' | 'tool' | 'manual_extract') {
  return createMemoryProposal({
    userId: USER_ID,
    action: 'create',
    scope: SCOPE,
    payload: { type: 'fact', key, value },
    origin,
    reason: '用户显式提交（待确认）',
  });
}

function reject(proposalId: string): void {
  rejectMemoryProposal({
    userId: USER_ID,
    proposalId,
    decidedBy: USER_ID,
    note: null,
    keepOriginal: false,
  });
}

describe('提议抑制机制', () => {
  it('自动来源：同内容被拒绝后不再重复生成（这是设计意图，不要改）', () => {
    const first = autoProposal('runtime', '本项目使用 bun。');
    expect(first.outcome).toBe('created');
    reject(first.proposal?.id ?? '');

    const second = autoProposal('runtime', '本项目使用 bun。');
    expect(second.outcome).toBe('suppressed');
  });

  it.each(['api', 'tool', 'manual_extract'] as const)(
    '显式来源（%s）：用户再次主动提交同一内容时必须仍然生成待确认项',
    (origin) => {
      const first = explicitProposal('deploy', '正式部署使用 Docker。', origin);
      expect(first.outcome).toBe('created');
      reject(first.proposal?.id ?? '');

      const second = explicitProposal('deploy', '正式部署使用 Docker。', origin);
      // 用户明确要求过的东西不能因为没有自助解除途径而永久不可创建。
      expect(second.outcome).toBe('created');
      expect(second.proposal?.status).toBe('pending');
    },
  );
});
