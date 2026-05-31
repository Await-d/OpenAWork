/**
 * team-init-store · 会话上的「初始化标记」读写
 *
 * 初始化状态持久化在 sessions.metadata_json.teamInit（与 @openAwork/shared 的
 * TeamInitState 同构）。本模块提供原子的读 / 整块写 / 单步更新能力，所有写操作
 * 都经过 validateSessionMetadataPatch 校验，避免写坏 metadata。
 */

import {
  deriveTeamInitPhase,
  type TeamInitState,
  type TeamInitStep,
  type TeamInitStepKey,
} from '@openAwork/shared';
import { sqliteGet, sqliteRun } from '../../infra/db.js';
import {
  mergeSessionMetadataForUpdate,
  parseSessionMetadataJson,
} from '../../session/session-workspace-metadata.js';

interface SessionRow {
  id: string;
  user_id: string;
  metadata_json: string | null;
  role_layer: string | null;
}

export interface TeamInitSessionContext {
  sessionId: string;
  userId: string;
  roleLayer: string | null;
  workingDirectory: string | null;
  teamWorkspaceId: string | null;
  teamInit: TeamInitState | null;
}

/** 读取会话及其 teamInit 标记。会话不存在 / 跨用户时返回 null。 */
export function loadTeamInitSessionContext(
  sessionId: string,
  userId: string,
): TeamInitSessionContext | null {
  const row = sqliteGet<SessionRow>(
    `SELECT id, user_id, metadata_json, role_layer
       FROM sessions WHERE id = ? AND user_id = ? LIMIT 1`,
    [sessionId, userId],
  );
  if (!row) return null;

  const metadata = parseSessionMetadataJson(row.metadata_json ?? '{}');
  const teamInit = (metadata['teamInit'] as TeamInitState | undefined) ?? null;
  const workingDirectory =
    typeof metadata['workingDirectory'] === 'string'
      ? (metadata['workingDirectory'] as string)
      : null;
  const teamWorkspaceId =
    typeof metadata['teamWorkspaceId'] === 'string'
      ? (metadata['teamWorkspaceId'] as string)
      : null;

  return {
    sessionId: row.id,
    userId: row.user_id,
    roleLayer: row.role_layer,
    workingDirectory,
    teamWorkspaceId,
    teamInit,
  };
}

/** 把完整 teamInit 状态块写回会话 metadata（保留其它字段）。 */
export function writeTeamInitState(
  sessionId: string,
  userId: string,
  nextState: TeamInitState,
): boolean {
  const row = sqliteGet<SessionRow>(
    `SELECT id, user_id, metadata_json, role_layer
       FROM sessions WHERE id = ? AND user_id = ? LIMIT 1`,
    [sessionId, userId],
  );
  if (!row) return false;

  const current = parseSessionMetadataJson(row.metadata_json ?? '{}');
  const { metadata } = mergeSessionMetadataForUpdate(current, { teamInit: nextState });
  sqliteRun(`UPDATE sessions SET metadata_json = ? WHERE id = ? AND user_id = ?`, [
    JSON.stringify(metadata),
    sessionId,
    userId,
  ]);
  return true;
}

/**
 * 原子更新单个步骤（按 key 定位），并根据剩余步骤重新派生 phase。
 * 当 phase 已是 'skipped'（用户显式跳过）时不覆盖，保留终态。
 * mutate 返回被替换后的 step。
 */
export function updateTeamInitStep(
  sessionId: string,
  userId: string,
  stepKey: TeamInitStepKey,
  mutate: (step: TeamInitStep) => TeamInitStep,
): TeamInitState | null {
  const ctx = loadTeamInitSessionContext(sessionId, userId);
  if (!ctx?.teamInit) return null;

  const steps = ctx.teamInit.steps.map((step) => (step.key === stepKey ? mutate(step) : step));
  const phase = ctx.teamInit.phase === 'skipped' ? 'skipped' : deriveTeamInitPhase(steps);

  const nextState: TeamInitState = {
    ...ctx.teamInit,
    steps,
    phase,
  };
  const ok = writeTeamInitState(sessionId, userId, nextState);
  return ok ? nextState : null;
}

/** 把整个初始化阶段标记为跳过（用户直接提需求时）。 */
export function markTeamInitSkipped(sessionId: string, userId: string): TeamInitState | null {
  const ctx = loadTeamInitSessionContext(sessionId, userId);
  if (!ctx?.teamInit) return null;
  const nextState: TeamInitState = { ...ctx.teamInit, phase: 'skipped' };
  const ok = writeTeamInitState(sessionId, userId, nextState);
  return ok ? nextState : null;
}
