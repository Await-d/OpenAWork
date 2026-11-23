import { describe, expect, it } from 'vitest';
import { buildPermissionDecisionMessage } from '../../task/task-parent-permission-message.js';

function createInput() {
  return {
    childSessionId: 'child-session',
    parentSessionId: 'parent-session',
    parentTaskId: 'parent-task',
    permission: {
      id: 'permission-request',
      preview_action: '执行预览',
      reason: '需要批准',
      risk_level: 'high',
      scope: '/workspace',
      tool_name: 'bash',
    },
  };
}

describe('buildPermissionDecisionMessage', () => {
  it('展示父子会话与请求标识，并用子会话查询权限', () => {
    const message = buildPermissionDecisionMessage(createInput());

    expect(message).toContain('父任务：parent-task');
    expect(message).toContain('父会话：parent-session');
    expect(message).toContain('子会话：child-session');
    expect(message).toContain('权限请求：permission-request');
    expect(message).toContain(
      'permission_get({"session_id":"child-session","request_id":"permission-request"})',
    );
    expect(message).toContain('tool_search({"query":"permission_get"})');
    expect(message).toContain('只读查询，不会批准请求或续跑子会话');
    expect(message).toContain('决策前允许调用工具；最终回复只输出 JSON');
    expect(message).toContain('execution.available 为 false');
    expect(message).toContain('查询失败或请求已终结时，不得据摘要批准');
    expect(message).toContain('应保守拒绝');
  });

  it('查询示例中的特殊字符可通过 JSON 无损还原', () => {
    const input = createInput();
    input.childSessionId = 'child-"\\\n\r\t中文';
    input.permission.id = 'request-"\\\n\r\t中文';
    const message = buildPermissionDecisionMessage(input);
    const queryLine = message.split('\n').find((line) => line.startsWith('查询示例：'));
    const invokeLine = message.split('\n').find((line) => line.startsWith('tool_invoke('));
    const expectedArguments = {
      session_id: input.childSessionId,
      request_id: input.permission.id,
    };

    expect(queryLine).toBeDefined();
    expect(invokeLine).toBeDefined();
    expect(JSON.parse(queryLine!.slice('查询示例：permission_get('.length, -1))).toEqual(
      expectedArguments,
    );
    expect(JSON.parse(invokeLine!.slice('tool_invoke('.length, -1))).toEqual({
      tool: 'permission_get',
      arguments: expectedArguments,
    });
  });

  it.each(['scope', 'reason', 'preview_action'] as const)(
    '长 %s 不会截掉查询指引，且消息不超过 16000 字符',
    (field) => {
      const input = createInput();
      input.permission[field] = '长'.repeat(20000);
      const message = buildPermissionDecisionMessage(input);

      expect(message).toHaveLength(16000);
      expect(message).toContain(
        'permission_get({"session_id":"child-session","request_id":"permission-request"})',
      );
      expect(message).toContain('tool_search({"query":"permission_get"})');
      expect(message).toContain('tool_invoke({"tool":"permission_get","arguments":');
      expect(message).toContain('必须先查询并阅读 execution.rawInput 完整工具参数');
      expect(message.indexOf('tool_invoke(')).toBeLessThan(message.indexOf('范围：'));
    },
  );

  it('不投影权限载荷或原始工具参数，并保留空预览兜底', () => {
    const input = createInput();
    const permission = {
      ...input.permission,
      preview_action: null,
      request_payload_json: '{"rawInput":{"secret":"payload-secret"}}',
      rawInput: { secret: 'raw-input-secret' },
    };
    const message = buildPermissionDecisionMessage({ ...input, permission });

    expect(message).toContain('预览：无');
    expect(message).not.toContain('request_payload_json');
    expect(message).not.toContain('"rawInput"');
    expect(message).not.toContain('payload-secret');
    expect(message).not.toContain('raw-input-secret');
    expect(message.length).toBeLessThan(16000);
  });
});
