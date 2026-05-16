/**
 * 260515-team-phase-b · T-08 内部助手
 *
 * 创建一条带有团队层级语义的 session（绑定 role_layer / team_parent_session_id /
 * handoff_state）。
 *
 * 与现有 `routes/sessions.ts::POST /sessions` 关键区别：
 *   - 现有端点：generic session，不写 role_layer / team_parent_session_id
 *   - 此处端点：team session，必写 role_layer，可写 team_parent_session_id
 *
 * 这个模块同时被两类调用方使用：
 *   1. HTTP 路由 `POST /team/sessions`（路由层做参数校验）
 *   2. Watcher 守护进程（T-04，内部调用，不走 HTTP）
 */

import { randomUUID } from 'node:crypto';
import { sqliteGet, sqliteRun } from '../db.js';
import type { HandoffRoleLayer } from './handoff-store.js';

export interface CreateTeamSessionInput {
  userId: string;
  roleLayer: HandoffRoleLayer;
  teamParentSessionId?: string | null;
  /** 写入 sessions.metadata_json，原样存（调用方负责合法性） */
  metadataJson?: string;
  /** 初始 handoff_state（pending/running/null） */
  handoffState?: 'pending' | 'running' | null;
  /** session 标题，调用方可选 */
  title?: string | null;
}

export interface CreateTeamSessionResult {
  sessionId: string;
}

/**
 * 校验 team_parent_session_id：必须存在且属于同一用户。
 * 不存在 / 跨用户 → 返回 false 让上层 400/404。
 */
export function validateTeamParentSession(input: {
  userId: string;
  teamParentSessionId: string;
}): boolean {
  const row = sqliteGet<{ id: string }>(
    `SELECT id FROM sessions WHERE id = ? AND user_id = ? LIMIT 1`,
    [input.teamParentSessionId, input.userId],
  );
  return row !== undefined;
}

export function createTeamSession(input: CreateTeamSessionInput): CreateTeamSessionResult {
  const sessionId = randomUUID();
  const metadataJson = input.metadataJson ?? '{}';
  sqliteRun(
    `INSERT INTO sessions (
       id, user_id, messages_json, state_status, metadata_json, title,
       team_parent_session_id, role_layer, handoff_state
     ) VALUES (?, ?, '[]', 'idle', ?, ?, ?, ?, ?)`,
    [
      sessionId,
      input.userId,
      metadataJson,
      input.title ?? null,
      input.teamParentSessionId ?? null,
      input.roleLayer,
      input.handoffState ?? null,
    ],
  );
  return { sessionId };
}
