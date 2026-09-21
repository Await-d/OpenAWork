/**
 * Batch tool permission pause: collecting blocked calls and parsing the resume.
 *
 * Guards the fix for "a permission pause only remembers a single tool": one pause
 * can block several calls (the one awaiting approval plus the siblings held back
 * to preserve `tool_use` order). They must all be persisted on the pending payload
 * and resumed in order, otherwise the next upstream request carries an incomplete
 * `tool_result` set.
 */

import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type * as DbModule from '../../infra/db.js';
import type * as MessageV2Module from '../../message/message-v2-adapter.js';
import type * as PermissionContractModule from '../../permission/permission-contract.js';
import type * as StreamRuntimeModule from '../../routes/stream-runtime.js';
import type * as ToolSandboxModule from '../../tools/tool-sandbox.js';

process.env['DATABASE_URL'] = ':memory:';
process.env['OPENAWORK_APP_VERSION'] = '0.0.0-test';

let dbModule: typeof DbModule;
let contract: typeof PermissionContractModule;
let sandbox: typeof ToolSandboxModule;
let streamRuntime: typeof StreamRuntimeModule;
let messageV2: typeof MessageV2Module;

const USER_ID = 'u-blocked-calls';
const SESSION_ID = 'sess-blocked-calls';

beforeAll(async () => {
  dbModule = await import('../../infra/db.js');
  await dbModule.connectDb();
  await dbModule.migrate();
  contract = await import('../../permission/permission-contract.js');
  sandbox = await import('../../tools/tool-sandbox.js');
  streamRuntime = await import('../../routes/stream-runtime.js');
  messageV2 = await import('../../message/message-v2-adapter.js');
}, 60000);

beforeEach(() => {
  dbModule.sqliteRun('DELETE FROM message_v2', []);
  dbModule.sqliteRun('DELETE FROM permission_requests', []);
  dbModule.sqliteRun('DELETE FROM sessions', []);
  dbModule.sqliteRun('DELETE FROM users', []);
  dbModule.sqliteRun("INSERT INTO users (id, email, password_hash) VALUES (?, ?, 'x')", [
    USER_ID,
    `${USER_ID}@example.com`,
  ]);
  dbModule.sqliteRun(
    `INSERT INTO sessions (id, user_id, title, metadata_json, state_status)
     VALUES (?, ?, 'blocked calls', '{}', 'paused')`,
    [SESSION_ID, USER_ID],
  );
});

afterAll(async () => {
  await dbModule.closeDb();
});

const BASE_PAYLOAD = {
  clientRequestId: 'turn-1',
  nextRound: 2,
  requestData: { clientRequestId: 'turn-1', message: '继续' },
};

function insertPendingRequest(payload: Record<string, unknown> | null): void {
  dbModule.sqliteRun(
    `INSERT INTO permission_requests
       (id, session_id, tool_name, scope, reason, risk_level, status, request_payload_json)
     VALUES ('req-blocked', ?, 'write', 'a.txt', 'r', 'medium', 'pending', ?)`,
    [SESSION_ID, payload ? JSON.stringify(payload) : null],
  );
}

function readPayload(): Record<string, unknown> {
  const row = dbModule.sqliteGet<{ request_payload_json: string | null }>(
    `SELECT request_payload_json FROM permission_requests WHERE id = 'req-blocked'`,
  );
  return JSON.parse(row?.request_payload_json ?? '{}') as Record<string, unknown>;
}

describe('isPermissionSafeSiblingTool', () => {
  it('lets side-effect-free read tools keep running after a pause', () => {
    for (const tool of [
      'read',
      'list',
      'glob',
      'grep',
      'webfetch',
      'websearch',
      'look_at',
      'lsp',
    ]) {
      expect(sandbox.isPermissionSafeSiblingTool(tool)).toBe(true);
    }
  });

  it('holds back state-mutating tools so tool_use order is preserved', () => {
    for (const tool of ['write', 'edit', 'bash', 'task', 'delegate_task', 'todowrite']) {
      expect(sandbox.isPermissionSafeSiblingTool(tool)).toBe(false);
    }
  });
});

describe('recordBlockedToolCallsForPendingRequest', () => {
  it('stores the whole blocked batch and mirrors the first call onto legacy fields', () => {
    insertPendingRequest({ ...BASE_PAYLOAD, toolCallId: 'call-b', rawInput: { path: 'a.txt' } });

    sandbox.recordBlockedToolCallsForPendingRequest('req-blocked', [
      { toolCallId: 'call-b', toolName: 'write', rawInput: { path: 'a.txt' } },
      { toolCallId: 'call-c', toolName: 'bash', rawInput: { command: 'rm a.txt' } },
    ]);

    const payload = readPayload();
    expect(payload['blockedToolCalls']).toEqual([
      { toolCallId: 'call-b', toolName: 'write', rawInput: { path: 'a.txt' } },
      { toolCallId: 'call-c', toolName: 'bash', rawInput: { command: 'rm a.txt' } },
    ]);
    expect(payload['toolCallId']).toBe('call-b');
    expect(payload['toolName']).toBe('write');
    expect(payload['rawInput']).toEqual({ path: 'a.txt' });
  });

  it('dedupes by toolCallId so a re-pause does not duplicate entries', () => {
    insertPendingRequest({ ...BASE_PAYLOAD, toolCallId: 'call-b', rawInput: {} });

    sandbox.recordBlockedToolCallsForPendingRequest('req-blocked', [
      { toolCallId: 'call-b', toolName: 'write', rawInput: {} },
    ]);
    sandbox.recordBlockedToolCallsForPendingRequest('req-blocked', [
      { toolCallId: 'call-b', toolName: 'write', rawInput: {} },
      { toolCallId: 'call-c', toolName: 'bash', rawInput: {} },
    ]);

    expect(readPayload()['blockedToolCalls']).toHaveLength(2);
  });

  it('is a no-op for already-resolved requests so a late write cannot resurrect a payload', () => {
    insertPendingRequest({ ...BASE_PAYLOAD, toolCallId: 'call-b', rawInput: {} });
    dbModule.sqliteRun(
      `UPDATE permission_requests SET status = 'approved' WHERE id = 'req-blocked'`,
    );

    sandbox.recordBlockedToolCallsForPendingRequest('req-blocked', [
      { toolCallId: 'call-c', toolName: 'bash', rawInput: {} },
    ]);

    expect(readPayload()['blockedToolCalls']).toBeUndefined();
  });
});

describe('resolveBlockedCalls', () => {
  it('prefers the real tool name from the blocked batch over the permission category', () => {
    const calls = streamRuntime.resolveBlockedCalls({
      clientRequestId: 'turn-1',
      nextRound: 2,
      requestData: {},
      toolCallId: 'call-1',
      toolName: 'edit',
      rawInput: { path: 'a.ts' },
      blockedToolCalls: [
        { toolCallId: 'call-1', toolName: 'apply_patch', rawInput: { path: 'a.ts' } },
      ],
    });

    expect(calls).toEqual([
      { toolCallId: 'call-1', toolName: 'apply_patch', rawInput: { path: 'a.ts' } },
    ]);
  });

  it('falls back to the legacy single-call payload when no batch is present', () => {
    const calls = streamRuntime.resolveBlockedCalls({
      clientRequestId: 'turn-1',
      nextRound: 2,
      requestData: {},
      toolCallId: 'call-1',
      toolName: 'edit',
      rawInput: { path: 'a.ts' },
    });

    expect(calls).toEqual([{ toolCallId: 'call-1', toolName: 'edit', rawInput: { path: 'a.ts' } }]);
  });
});

describe('deriveResumeRound', () => {
  it('derives the next round from the persisted transcript, ignoring the payload round', () => {
    messageV2.appendSessionMessageV2({
      sessionId: SESSION_ID,
      userId: USER_ID,
      role: 'assistant',
      clientRequestId: 'turn-1:assistant:3',
      content: [{ type: 'text', text: '第 3 轮' }],
    });

    expect(
      streamRuntime.deriveResumeRound({
        clientRequestId: 'turn-1',
        fallbackRound: 2,
        sessionId: SESSION_ID,
        userId: USER_ID,
      }),
    ).toBe(4);
  });

  it('falls back to the payload round when no intermediate round is recoverable', () => {
    expect(
      streamRuntime.deriveResumeRound({
        clientRequestId: 'turn-unknown',
        fallbackRound: 2,
        sessionId: SESSION_ID,
        userId: USER_ID,
      }),
    ).toBe(2);
  });
});

describe('parseApprovedPermissionResumePayload blockedToolCalls', () => {
  it('parses the batch in order', () => {
    const parsed = contract.parseApprovedPermissionResumePayload(
      JSON.stringify({
        ...BASE_PAYLOAD,
        toolCallId: 'call-b',
        toolName: 'write',
        rawInput: { path: 'a.txt' },
        blockedToolCalls: [
          { toolCallId: 'call-b', toolName: 'write', rawInput: { path: 'a.txt' } },
          { toolCallId: 'call-c', toolName: 'bash', rawInput: { command: 'rm a.txt' } },
        ],
      }),
    );
    expect(parsed?.blockedToolCalls).toHaveLength(2);
    expect(parsed?.blockedToolCalls?.[1]).toEqual({
      toolCallId: 'call-c',
      toolName: 'bash',
      rawInput: { command: 'rm a.txt' },
    });
  });

  it('omits blockedToolCalls for legacy single-call payloads', () => {
    const parsed = contract.parseApprovedPermissionResumePayload(
      JSON.stringify({ ...BASE_PAYLOAD, toolCallId: 'call-b', rawInput: {} }),
    );
    expect(parsed?.toolCallId).toBe('call-b');
    expect(parsed?.blockedToolCalls).toBeUndefined();
  });

  it('drops malformed batch entries instead of failing the whole resume', () => {
    const parsed = contract.parseApprovedPermissionResumePayload(
      JSON.stringify({
        ...BASE_PAYLOAD,
        toolCallId: 'call-b',
        rawInput: {},
        blockedToolCalls: [
          { toolCallId: 'call-b', toolName: 'write', rawInput: {} },
          { toolCallId: 'call-x' },
          null,
          { toolCallId: 'call-y', toolName: 'bash', rawInput: 'not-an-object' },
        ],
      }),
    );
    expect(parsed?.blockedToolCalls).toEqual([
      { toolCallId: 'call-b', toolName: 'write', rawInput: {} },
    ]);
  });
});
