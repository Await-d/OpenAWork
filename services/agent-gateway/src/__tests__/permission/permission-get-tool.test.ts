import { inspect } from 'node:util';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type * as DbModule from '../../infra/db.js';
import type * as ToolModule from '../../permission/permission-get-tool.js';

process.env['DATABASE_URL'] = ':memory:';
let db: typeof DbModule;
let tool: typeof ToolModule;
const input = { session_id: 'child', request_id: 'approval' };

beforeAll(async () => {
  db = await import('../../infra/db.js');
  await db.connectDb();
  await db.migrate();
  tool = await import('../../permission/permission-get-tool.js');
});
afterAll(async () => {
  await db.closeDb();
});
beforeEach(() => {
  db.sqliteRun('DELETE FROM permission_requests');
  db.sqliteRun('DELETE FROM sessions');
  db.sqliteRun('DELETE FROM users');
  db.sqliteRun("INSERT INTO users (id,email,password_hash) VALUES ('owner','owner@test','x')");
  db.sqliteRun("INSERT INTO sessions (id,user_id,title) VALUES ('child','owner','child')");
  db.sqliteRun(
    `INSERT INTO permission_requests
       (id,session_id,tool_name,scope,reason,risk_level,status,request_payload_json,expires_at)
     VALUES ('approval','child','bash','bun -e test','需要执行工作区命令','high','deciding',?,1)`,
    [
      JSON.stringify({
        toolCallId: 'call',
        clientRequestId: 'turn',
        rawInput: { command: 'bun -e test', workdir: '/workspace', timeout: 1000 },
        requestData: { secret: 'must-not-leak' },
        blockedToolCalls: [{ rawInput: { secret: 'other-call' } }],
      }),
    ],
  );
});

describe('permission_get', () => {
  it('读取完整工具参数而不泄露恢复请求和其他调用', () => {
    const result = tool.runPermissionGetTool('owner', input);
    expect(result.request).toMatchObject({
      requestId: 'approval',
      sessionId: 'child',
      status: 'deciding',
      execution: {
        available: true,
        toolCallId: 'call',
        clientRequestId: 'turn',
        rawInput: { command: 'bun -e test', workdir: '/workspace', timeout: 1000 },
      },
    });
    expect(JSON.stringify(result)).not.toContain('must-not-leak');
    expect(JSON.stringify(result)).not.toContain('other-call');
  });

  it('越权、不存在和请求与会话不匹配都返回相同结果', () => {
    expect(tool.runPermissionGetTool('stranger', input)).toEqual({ request: null });
    expect(tool.runPermissionGetTool('owner', { ...input, request_id: 'missing' })).toEqual({
      request: null,
    });
    expect(tool.runPermissionGetTool('owner', { ...input, session_id: 'missing' })).toEqual({
      request: null,
    });
    db.sqliteRun("INSERT INTO sessions (id,user_id,title) VALUES ('other','owner','other')");
    expect(tool.runPermissionGetTool('owner', { ...input, session_id: 'other' })).toEqual({
      request: null,
    });
  });

  it.each(['pending', 'deciding', 'approved', 'rejected', 'consumed', 'cancelled', 'expired'])(
    '读取 %s 不改变审批或裁决记录，也不回收过期记录',
    (status) => {
      db.sqliteRun('UPDATE permission_requests SET status = ?, decision = ? WHERE id = ?', [
        status,
        'once',
        'approval',
      ]);
      const before = db.sqliteGet('SELECT * FROM permission_requests WHERE id = ?', ['approval']);
      const logs = db.sqliteGet('SELECT COUNT(*) AS n FROM permission_decision_logs');
      expect(tool.runPermissionGetTool('owner', input).request).toMatchObject({
        status,
        decision: 'once',
      });
      expect(db.sqliteGet('SELECT * FROM permission_requests WHERE id = ?', ['approval'])).toEqual(
        before,
      );
      expect(db.sqliteGet('SELECT COUNT(*) AS n FROM permission_decision_logs')).toEqual(logs);
    },
  );

  it.each([null, '{}', 'null', '{"rawInput":[]}', '{"rawInput":null}'])(
    '缺失或异常载荷 %s 仍返回记录并标明参数不可得',
    (payload) => {
      db.sqliteRun('UPDATE permission_requests SET request_payload_json = ?', [payload]);
      expect(tool.runPermissionGetTool('owner', input).request).toMatchObject({
        status: 'deciding',
        execution: { available: false },
      });
    },
  );

  it.each(['{secret', 'secret-credential'])(
    '坏 JSON %s 不抛异常且日志不含载荷或异常堆栈',
    (payload) => {
      const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
      try {
        db.sqliteRun('UPDATE permission_requests SET request_payload_json = ?', [payload]);
        expect(tool.runPermissionGetTool('owner', input).request?.execution.available).toBe(false);
        expect(warn).toHaveBeenCalledWith('权限详情载荷无法解析', {
          requestId: 'approval',
          rawLength: payload.length,
          errorType: 'syntax',
        });
        expect(inspect(warn.mock.calls, { depth: null })).not.toContain(payload);
      } finally {
        warn.mockRestore();
      }
    },
  );

  it('旧载荷缺少实际工具名时返回 null，不能用审批类别猜测', () => {
    expect(tool.runPermissionGetTool('owner', input).request).toMatchObject({
      permissionCategory: 'bash',
      execution: { available: true, toolName: null },
    });
  });

  it.each<[string, Record<string, unknown>]>([
    ['patch', { patchText: '*** Begin Patch\n*** End Patch' }],
    ['tool_invoke', { tool: 'patch', arguments: { patchText: 'full-patch' } }],
  ])('真实批量持久化后区分审批类别与 %s 调用', async (toolName, rawInput) => {
    db.sqliteRun(
      "UPDATE permission_requests SET status = 'pending', tool_name = 'edit', request_payload_json = ?",
      [JSON.stringify({ toolCallId: 'call', rawInput: {}, clientRequestId: 'turn' })],
    );
    const { recordBlockedToolCallsForPendingRequest } = await import('../../tools/tool-sandbox.js');
    recordBlockedToolCallsForPendingRequest('approval', [
      { toolCallId: 'call', toolName, rawInput },
      { toolCallId: 'other', toolName: 'bash', rawInput: { command: 'private-sibling' } },
    ]);
    const result = tool.runPermissionGetTool('owner', input);
    expect(result.request).toMatchObject({
      toolName: 'edit',
      permissionCategory: 'edit',
      execution: { available: true, toolName, toolCallId: 'call', rawInput },
    });
    expect(JSON.stringify(result)).not.toContain('private-sibling');
  });

  it.each([
    {},
    { ...input, session_id: ' ' },
    { ...input, request_id: '' },
    { ...input, userId: 'owner' },
  ])('拒绝非法输入 %j', (value) => {
    expect(tool.permissionGetInputSchema.safeParse(value).success).toBe(false);
  });
});
