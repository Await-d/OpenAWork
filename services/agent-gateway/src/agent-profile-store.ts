import { randomUUID } from 'node:crypto';
import { sqliteAll, sqliteGet, sqliteRun } from './db.js';
import { validateWorkspacePath } from './workspace-paths.js';
import type { ToolSurfaceProfile } from './session-workspace-metadata.js';

export interface AgentProfileRecord {
  agentId: string | null;
  createdAt: string;
  id: string;
  label: string;
  modelId: string | null;
  note: string | null;
  providerId: string | null;
  toolSurfaceProfile: ToolSurfaceProfile;
  updatedAt: string;
  workspacePath: string;
}

export interface UpsertAgentProfileInput {
  agentId?: string;
  label: string;
  modelId?: string;
  note?: string;
  providerId?: string;
  toolSurfaceProfile?: ToolSurfaceProfile;
  workspacePath: string;
}

interface AgentProfileRow {
  agent_id: string | null;
  created_at: string;
  id: string;
  label: string;
  model_id: string | null;
  note: string | null;
  provider_id: string | null;
  tool_surface_profile: ToolSurfaceProfile;
  updated_at: string;
  workspace_path: string;
}

export function listAgentProfilesForUser(userId: string): AgentProfileRecord[] {
  return sqliteAll<AgentProfileRow>(
    `SELECT id, workspace_path, label, agent_id, provider_id, model_id, tool_surface_profile, note, created_at, updated_at
     FROM agent_profiles
     WHERE user_id = ?
     ORDER BY updated_at DESC, created_at DESC`,
    [userId],
  ).map(mapAgentProfileRow);
}

export function getAgentProfileForUser(
  userId: string,
  profileId: string,
): AgentProfileRecord | null {
  const row = sqliteGet<AgentProfileRow>(
    `SELECT id, workspace_path, label, agent_id, provider_id, model_id, tool_surface_profile, note, created_at, updated_at
     FROM agent_profiles WHERE user_id = ? AND id = ? LIMIT 1`,
    [userId, profileId],
  );
  return row ? mapAgentProfileRow(row) : null;
}

export function getAgentProfileForWorkspace(
  userId: string,
  workspacePath: string,
): AgentProfileRecord | null {
  const safeWorkspacePath = validateWorkspacePath(workspacePath);
  if (!safeWorkspacePath) {
    return null;
  }

  const row = sqliteGet<AgentProfileRow>(
    `SELECT id, workspace_path, label, agent_id, provider_id, model_id, tool_surface_profile, note, created_at, updated_at
     FROM agent_profiles WHERE user_id = ? AND workspace_path = ? LIMIT 1`,
    [userId, safeWorkspacePath],
  );
  return row ? mapAgentProfileRow(row) : null;
}

export function createAgentProfileForUser(
  userId: string,
  input: UpsertAgentProfileInput,
): AgentProfileRecord {
  const workspacePath = requireWorkspacePath(input.workspacePath);
  const id = randomUUID();
  sqliteRun(
    `INSERT INTO agent_profiles (id, user_id, workspace_path, label, agent_id, provider_id, model_id, tool_surface_profile, note, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'), datetime('now'))`,
    [
      id,
      userId,
      workspacePath,
      input.label.trim(),
      input.agentId?.trim() || null,
      input.providerId?.trim() || null,
      input.modelId?.trim() || null,
      input.toolSurfaceProfile ?? 'openawork',
      input.note?.trim() || null,
    ],
  );
  return getAgentProfileForUser(userId, id)!;
}

export function updateAgentProfileForUser(
  userId: string,
  profileId: string,
  input: Partial<UpsertAgentProfileInput>,
): AgentProfileRecord {
  const current = getAgentProfileForUser(userId, profileId);
  if (!current) {
    throw new Error('Agent profile not found');
  }

  const workspacePath = input.workspacePath
    ? requireWorkspacePath(input.workspacePath)
    : current.workspacePath;
  sqliteRun(
    `UPDATE agent_profiles
     SET workspace_path = ?, label = ?, agent_id = ?, provider_id = ?, model_id = ?, tool_surface_profile = ?, note = ?, updated_at = datetime('now')
     WHERE id = ? AND user_id = ?`,
    [
      workspacePath,
      input.label?.trim() || current.label,
      input.agentId !== undefined ? input.agentId.trim() || null : current.agentId,
      input.providerId !== undefined ? input.providerId.trim() || null : current.providerId,
      input.modelId !== undefined ? input.modelId.trim() || null : current.modelId,
      input.toolSurfaceProfile ?? current.toolSurfaceProfile,
      input.note !== undefined ? input.note.trim() || null : current.note,
      profileId,
      userId,
    ],
  );
  return getAgentProfileForUser(userId, profileId)!;
}

export function removeAgentProfileForUser(userId: string, profileId: string): void {
  sqliteRun('DELETE FROM agent_profiles WHERE id = ? AND user_id = ?', [profileId, userId]);
}

function mapAgentProfileRow(row: AgentProfileRow): AgentProfileRecord {
  return {
    agentId: row.agent_id,
    createdAt: row.created_at,
    id: row.id,
    label: row.label,
    modelId: row.model_id,
    note: row.note,
    providerId: row.provider_id,
    toolSurfaceProfile: row.tool_surface_profile,
    updatedAt: row.updated_at,
    workspacePath: row.workspace_path,
  };
}

function requireWorkspacePath(workspacePath: string): string {
  const normalized = validateWorkspacePath(workspacePath);
  if (!normalized) {
    throw new Error('Invalid workspace path');
  }
  return normalized;
}
