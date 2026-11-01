/**
 * 确认门「修改后接受」（override payload）的护栏回归（261101-记忆确认写入与周期整理）。
 *
 * 界面允许用户在确认前改内容。`memoryProposalPayloadSchema` 的所有字段都是**可选**的，
 * 于是覆盖载荷既可能缺 `key` 也可能整个是 `{}`。提交器若直接把它交给 `createMemory`，
 * 兜底值 `''` 会写出一条**空键记忆**：它以 `- [fact] : 内容` 的形式进入之后每一轮提示词，
 * 并占住 `(user, scope, type, '')` 的唯一索引位。这是「确认门本身」的输入校验缺口——
 * 不能只依赖「提议是老流程创建的所以一定完整」。
 *
 * 同时钉住来源标签：`api` 是用户显式提交，不应被记成「自动抽取」。
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type * as DbModule from '../../infra/db.js';
import type * as ProposalStoreModule from '../../memory/governance/memory-proposal-store.js';
import type * as CommitServiceModule from '../../memory/governance/memory-commit-service.js';

process.env['DATABASE_URL'] = ':memory:';

let dbModule: typeof DbModule;
let createMemoryProposal: typeof ProposalStoreModule.createMemoryProposal;
let commitMemoryProposal: typeof CommitServiceModule.commitMemoryProposal;

const USER_ID = 'u-override-guard';
const SCOPE = { type: 'user' as const, id: USER_ID };

beforeAll(async () => {
  dbModule = await import('../../infra/db.js');
  await dbModule.connectDb();
  await dbModule.migrate();
  createMemoryProposal = (await import('../../memory/governance/memory-proposal-store.js'))
    .createMemoryProposal;
  commitMemoryProposal = (await import('../../memory/governance/memory-commit-service.js'))
    .commitMemoryProposal;
});

beforeEach(() => {
  dbModule.sqliteRun('DELETE FROM memory_proposals', []);
  dbModule.sqliteRun('DELETE FROM memory_rule_entries', []);
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

function count(sql: string): number {
  return dbModule.sqliteGet<{ count: number }>(sql)?.count ?? 0;
}

function createProposal(
  origin: 'auto_extract' | 'api' = 'auto_extract',
  action: 'create' | 'rule' = 'create',
) {
  return createMemoryProposal({
    userId: USER_ID,
    action,
    scope: SCOPE,
    payload:
      action === 'rule'
        ? { name: '提交纪律', body: '提交前必须跑 preflight。' }
        : { type: 'fact', key: 'runtime', value: '使用 bun。' },
    origin,
    reason: '测试提议',
  });
}

describe('确认门的覆盖载荷护栏', () => {
  it('覆盖载荷缺 key 时拒绝提交，不写空键记忆，且提议保持待确认', () => {
    const proposed = createProposal();
    const id = proposed.proposal?.id ?? '';

    const result = commitMemoryProposal({
      userId: USER_ID,
      proposalId: id,
      decidedBy: USER_ID,
      overridePayload: { value: '改过的内容' },
    });

    expect(result.ok).toBe(false);
    expect(count('SELECT COUNT(*) AS count FROM memories')).toBe(0);
    const status = dbModule.sqliteGet<{ status: string }>(
      'SELECT status FROM memory_proposals WHERE id = ?',
      [id],
    );
    // 保持 pending：用户改完再提交即可，不该被迫重新发起。
    expect(status?.status).toBe('pending');
  });

  it('覆盖载荷整段为空时同样拒绝（不会写入空键空值条目）', () => {
    const proposed = createProposal();
    const id = proposed.proposal?.id ?? '';

    const result = commitMemoryProposal({
      userId: USER_ID,
      proposalId: id,
      decidedBy: USER_ID,
      overridePayload: {},
    });

    expect(result.ok).toBe(false);
    expect(count('SELECT COUNT(*) AS count FROM memories')).toBe(0);
  });

  it('规则提议的覆盖载荷缺 body 时拒绝，不落无名/无正文规则', () => {
    const proposed = createProposal('auto_extract', 'rule');
    const id = proposed.proposal?.id ?? '';

    const result = commitMemoryProposal({
      userId: USER_ID,
      proposalId: id,
      decidedBy: USER_ID,
      overridePayload: { name: '只有名字' },
    });

    expect(result.ok).toBe(false);
    expect(count('SELECT COUNT(*) AS count FROM memory_rule_entries')).toBe(0);
  });

  it('覆盖载荷完整时正常提交，并落用户改后的内容', () => {
    const proposed = createProposal();
    const id = proposed.proposal?.id ?? '';

    const result = commitMemoryProposal({
      userId: USER_ID,
      proposalId: id,
      decidedBy: USER_ID,
      overridePayload: { type: 'fact', key: 'runtime', value: '改后：使用 bun 而非 npm。' },
    });

    expect(result.ok).toBe(true);
    expect(result.memory?.value).toBe('改后：使用 bun 而非 npm。');
    expect(result.memory?.confirmationKind).toBe('proposal');
  });

  it('api 来源的用户显式提交，不会被记成「自动抽取」', () => {
    const proposed = createProposal('api');
    const id = proposed.proposal?.id ?? '';

    const result = commitMemoryProposal({
      userId: USER_ID,
      proposalId: id,
      decidedBy: USER_ID,
    });

    expect(result.ok).toBe(true);
    // `api` 是用户在界面/接口上的显式提交；标成 auto_extracted 会让来源筛选与界面标签失真。
    expect(result.memory?.source).toBe('manual');
  });

  it('自动抽取来源仍保留 auto_extracted 标签（不能被人工来源污染）', () => {
    const proposed = createProposal('auto_extract');
    const id = proposed.proposal?.id ?? '';

    const result = commitMemoryProposal({
      userId: USER_ID,
      proposalId: id,
      decidedBy: USER_ID,
    });

    expect(result.ok).toBe(true);
    expect(result.memory?.source).toBe('auto_extracted');
  });
});
