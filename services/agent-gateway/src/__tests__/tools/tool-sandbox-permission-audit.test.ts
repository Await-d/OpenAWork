import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  sqliteAllMock: vi.fn(() => []),
  sqliteGetMock: vi.fn((query: string) => {
    if (query.includes('SELECT user_id FROM sessions')) {
      return { user_id: 'user-1' };
    }
    if (query.includes('SELECT metadata_json')) {
      return { metadata_json: '{}' };
    }
    return undefined;
  }),
  sqliteRunMock: vi.fn((..._args: unknown[]) => undefined),
}));

vi.mock('../../infra/db.js', () => ({
  WORKSPACE_ACCESS_RESTRICTED: false,
  WORKSPACE_ROOT: '/home/await/project/OpenAWork',
  WORKSPACE_ROOTS: ['/home/await/project/OpenAWork'],
  sqliteAll: mocks.sqliteAllMock,
  sqliteGet: mocks.sqliteGetMock,
  sqliteRun: mocks.sqliteRunMock,
  sqliteRunWithRowId: vi.fn(() => 1),
}));

vi.mock('../../session/session-run-events.js', () => ({
  publishSessionRunEvent: vi.fn(),
}));

import { createDefaultSandbox } from '../../tools/tool-sandbox.js';

describe('tool sandbox permission audit', () => {
  beforeEach(() => {
    mocks.sqliteAllMock.mockClear();
    mocks.sqliteGetMock.mockClear();
    mocks.sqliteRunMock.mockClear();
  });

  it('records a permission pause as a non-error audit event', async () => {
    const sandbox = createDefaultSandbox();
    const result = await sandbox.execute(
      {
        toolCallId: 'call-bash-permission',
        toolName: 'bash',
        rawInput: { command: 'printf ok', workdir: '/home/await/project/OpenAWork' },
      },
      new AbortController().signal,
      'session-1',
      {
        clientRequestId: 'req-bash-permission',
        nextRound: 1,
        requestData: { clientRequestId: 'req-bash-permission' },
      },
    );

    expect(result.pendingPermissionRequestId).toBeDefined();
    expect(result.isError).toBe(true);
    expect(
      mocks.sqliteRunMock.mock.calls.some(
        ([query, params]) =>
          typeof query === 'string' &&
          query.includes('INSERT INTO audit_logs') &&
          Array.isArray(params) &&
          params.includes('call-bash-permission') &&
          params[5] === 0 &&
          params[6] === 1,
      ),
    ).toBe(true);
  });

  /**
   * 提问 / 计划审批必须以 isError 返回给模型（让模型停下等输入），但它不是故障。
   * 提问分支只写 `question_requests`、不写 `audit_logs`，因此天然不会进错误列表；
   * 本断言锁住这个性质，防止将来有人给提问路径补审计写入时漏掉标记。
   */
  it('提问挂起不产生 is_error=1 的审计行', async () => {
    const sandbox = createDefaultSandbox();
    await sandbox.execute(
      {
        toolCallId: 'call-question-pending',
        toolName: 'question',
        rawInput: {
          questions: [
            {
              question: '走哪条路？',
              header: '路线',
              multiSelect: false,
              options: ['方案 A', '方案 B'],
            },
          ],
        },
      },
      new AbortController().signal,
      'session-1',
      {
        clientRequestId: 'req-question-pending',
        nextRound: 1,
        requestData: { clientRequestId: 'req-question-pending' },
      },
    );

    const errorAuditRows = mocks.sqliteRunMock.mock.calls.filter(
      ([query, params]) =>
        typeof query === 'string' &&
        query.includes('INSERT INTO audit_logs') &&
        Array.isArray(params) &&
        params[5] === 1 &&
        params[6] !== 1,
    );
    expect(errorAuditRows).toEqual([]);
  });

  /**
   * 所有审计写入都必须绑定 `pending_interaction`（参数表第 7 位）。
   * 加列时漏改某个调用点会让参数错位、`is_error` 写进 `pending_interaction`，
   * 这条断言把这类回归挡在 CI。
   */
  it('每条审计写入都绑定 pending_interaction 列', () => {
    const sandbox = createDefaultSandbox();
    return sandbox
      .execute(
        {
          toolCallId: 'call-param-alignment',
          toolName: 'bash',
          rawInput: { command: 'printf ok', workdir: '/home/await/project/OpenAWork' },
        },
        new AbortController().signal,
        'session-1',
      )
      .then(() => {
        const auditInserts = mocks.sqliteRunMock.mock.calls.filter(
          ([query, params]) =>
            typeof query === 'string' &&
            query.includes('INSERT INTO audit_logs') &&
            Array.isArray(params),
        );
        expect(auditInserts.length).toBeGreaterThan(0);
        for (const [query, params] of auditInserts) {
          const [, , , , , , , pendingInteraction] = params as unknown[];
          expect(typeof query).toBe('string');
          // 第 7 位必须是 0/1，不能是 undefined（undefined 会写进 duration_ms）。
          expect(pendingInteraction === 0 || pendingInteraction === 1).toBe(true);
        }
      });
  });
});
