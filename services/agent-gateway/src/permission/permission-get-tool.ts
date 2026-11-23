import type { ToolDefinition } from '@openAwork/agent-core';
import { z } from 'zod';
import { sqliteGet } from '../infra/db.js';
import { logGatewayWarn } from '../infra/gateway-logger.js';

export const permissionGetInputSchema = z
  .object({
    session_id: z.string().trim().min(1),
    request_id: z.string().trim().min(1),
  })
  .strict();

export const permissionGetToolDefinition: ToolDefinition<
  typeof permissionGetInputSchema,
  z.ZodUnknown
> = {
  name: 'permission_get',
  description:
    '只读查询当前用户拥有的会话内单条权限请求，含完整工具参数、审批状态与裁决；支持 deciding 和终态，不批准、不续跑。使用通知中的子会话 ID 与权限请求 ID。',
  inputSchema: permissionGetInputSchema,
  outputSchema: z.unknown(),
  timeout: 30000,
  execute: async () => {
    throw new Error('permission_get must execute through the gateway-managed sandbox path');
  },
};

interface PermissionDetailRow {
  id: string;
  session_id: string;
  tool_name: string;
  scope: string;
  reason: string;
  risk_level: string;
  preview_action: string | null;
  status: string;
  decision: string | null;
  created_at: string;
  updated_at: string;
  expires_at: number | null;
  request_payload_json: string | null;
}

const payloadSchema = z.object({
  toolName: z.string().min(1).optional(),
  toolCallId: z.string().optional(),
  clientRequestId: z.string().optional(),
  rawInput: z.record(z.unknown()).optional(),
});

function readExecution(row: PermissionDetailRow) {
  if (!row.request_payload_json) {
    return { available: false as const, reason: '未保存工具原始参数' };
  }
  try {
    const parsed = payloadSchema.safeParse(JSON.parse(row.request_payload_json) as unknown);
    if (!parsed.success || !parsed.data.rawInput) {
      return { available: false as const, reason: '工具原始参数格式不完整' };
    }
    // 仅投影当前请求绑定的调用，不暴露 requestData 或同批其他审批的调用。
    return { available: true as const, ...parsed.data, toolName: parsed.data.toolName ?? null };
  } catch (error) {
    // JSON.parse 的异常消息可能包含原始载荷，不能将 Error 或 stack 写入日志。
    logGatewayWarn('权限详情载荷无法解析', {
      requestId: row.id,
      rawLength: row.request_payload_json.length,
      errorType: error instanceof SyntaxError ? 'syntax' : 'invalid-value',
    });
    return { available: false as const, reason: '工具原始参数无法解析' };
  }
}

export function runPermissionGetTool(
  userId: string,
  input: z.infer<typeof permissionGetInputSchema>,
) {
  const row = sqliteGet<PermissionDetailRow>(
    `SELECT p.id, p.session_id, p.tool_name, p.scope, p.reason, p.risk_level,
            p.preview_action, p.status, p.decision, p.created_at, p.updated_at,
            p.expires_at, p.request_payload_json
     FROM permission_requests p JOIN sessions s ON s.id = p.session_id
     WHERE p.id = ? AND p.session_id = ? AND s.user_id = ?`,
    [input.request_id, input.session_id, userId],
  );
  if (!row) return { request: null };
  return {
    request: {
      requestId: row.id,
      sessionId: row.session_id,
      toolName: row.tool_name,
      permissionCategory: row.tool_name,
      scope: row.scope,
      reason: row.reason,
      riskLevel: row.risk_level,
      previewAction: row.preview_action,
      status: row.status,
      decision: row.decision,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      expiresAt: row.expires_at,
      execution: readExecution(row),
    },
  };
}
