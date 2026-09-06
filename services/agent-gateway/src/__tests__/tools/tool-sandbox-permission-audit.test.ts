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
          params[5] === 0,
      ),
    ).toBe(true);
  });
});
