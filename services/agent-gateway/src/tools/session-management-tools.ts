/**
 * `session_rename` / `session_move` 工具定义与执行体。
 *
 * 两个工具都作用于「当前会话」（session_move）或「当前/指定会话」
 * （session_rename），复用：
 * - `renameSessionTitle`（session/session-title.ts）
 * - `warpSessionWorkspace`（session/session-workspace-warp.ts）
 */
import type { ToolDefinition } from '@openAwork/agent-core';
import { z } from 'zod';
import {
  SESSION_TITLE_MAX_LENGTH,
  renameSessionTitle,
  sessionExistsForUser,
} from '../session/session-title.js';
import {
  SESSION_WORKSPACE_IMMUTABLE_ERROR,
  warpSessionWorkspace,
} from '../session/session-workspace-warp.js';

const sessionRenameInputSchema = z.object({
  sessionID: z
    .string()
    .min(1)
    .max(200)
    .optional()
    .describe('要重命名的会话 ID；省略时重命名当前会话。'),
  title: z
    .string()
    .min(1)
    .max(SESSION_TITLE_MAX_LENGTH)
    .describe('新的会话标题（1–200 字符，去除首尾空白后不能为空）。'),
});

const sessionMoveInputSchema = z.object({
  directory: z
    .string()
    .min(1)
    .nullable()
    .describe('会话新的工作目录；传 null 表示解绑当前工作区。'),
  force: z
    .boolean()
    .optional()
    .describe('true 时强制切换已绑定工作区，并写入 workspaceWarpHistory 审计。'),
});

export type SessionRenameInput = z.infer<typeof sessionRenameInputSchema>;
export type SessionMoveInput = z.infer<typeof sessionMoveInputSchema>;

export interface SessionRenameOutput {
  sessionID: string;
  title: string;
}

export interface SessionMoveOutput {
  sessionID: string;
  workingDirectory: string | null;
  /** 工作目录是否实际发生变化。 */
  changed: boolean;
  /** 是否以 force=true 强制重绑已绑定工作区。 */
  forced: boolean;
}

export type SessionRenameToolResult =
  ({ ok: true } & SessionRenameOutput) | { ok: false; error: string };

export type SessionMoveToolResult =
  ({ ok: true } & SessionMoveOutput) | { ok: false; error: string };

export const sessionRenameToolDefinition: ToolDefinition<
  typeof sessionRenameInputSchema,
  z.ZodUnknown
> = {
  name: 'session_rename',
  description: '重命名会话；省略 sessionID 时重命名当前会话。请使用简短、能概括当前工作的标题。',
  inputSchema: sessionRenameInputSchema,
  outputSchema: z.unknown(),
  timeout: 30000,
  execute: async () => {
    throw new Error('session_rename must execute through the gateway-managed sandbox path');
  },
};

export const sessionMoveToolDefinition: ToolDefinition<
  typeof sessionMoveInputSchema,
  z.ZodUnknown
> = {
  name: 'session_move',
  description:
    '把会话移动到另一个工作目录（directory 传 null 表示解绑当前工作区）。已绑定工作区的会话默认会被拒绝，需显式传 force=true 才会强制切换并写入 workspaceWarpHistory 审计记录。会话工作目录在写入后生效；同一轮内不要执行依赖目标目录的工具。',
  inputSchema: sessionMoveInputSchema,
  outputSchema: z.unknown(),
  timeout: 30000,
  execute: async () => {
    throw new Error('session_move must execute through the gateway-managed sandbox path');
  },
};

export function runSessionRenameTool(
  currentSessionId: string,
  userId: string,
  input: SessionRenameInput,
): SessionRenameToolResult {
  const sessionID = input.sessionID ?? currentSessionId;
  if (!sessionExistsForUser(sessionID, userId)) {
    return { ok: false, error: `会话不存在：${sessionID}` };
  }

  // 工具侧负责 trim 与校验；共享写函数按原样写入（路由语义不变）。
  const title = input.title.trim();
  if (title.length === 0) {
    return { ok: false, error: '会话标题不能为空。' };
  }
  if (title.length > SESSION_TITLE_MAX_LENGTH) {
    return { ok: false, error: `会话标题过长，最多 ${SESSION_TITLE_MAX_LENGTH} 个字符。` };
  }

  const renamed = renameSessionTitle({ sessionId: sessionID, userId, title });
  if (!renamed.ok) {
    return { ok: false, error: renamed.error };
  }
  return { ok: true, sessionID, title: renamed.title };
}

export function runSessionMoveTool(
  currentSessionId: string,
  userId: string,
  input: SessionMoveInput,
): SessionMoveToolResult {
  const result = warpSessionWorkspace({
    sessionId: currentSessionId,
    userId,
    workingDirectory: input.directory,
    force: input.force === true,
  });

  switch (result.kind) {
    case 'not_found':
      return { ok: false, error: '目标会话不存在。' };
    case 'forbidden_path':
      return { ok: false, error: '工作区路径不在允许范围内。' };
    case 'immutable':
      return {
        ok: false,
        error: `${SESSION_WORKSPACE_IMMUTABLE_ERROR}如确需切换，请传 force=true。`,
      };
    case 'unchanged':
      return {
        ok: true,
        sessionID: currentSessionId,
        workingDirectory: result.workingDirectory,
        changed: false,
        forced: false,
      };
    case 'warped':
      return {
        ok: true,
        sessionID: currentSessionId,
        workingDirectory: result.workingDirectory,
        changed: true,
        forced: result.forced,
      };
  }
}
