import { sqliteGet } from '../infra/db.js';
import { parseSessionMetadataJson } from '../session/session-workspace-metadata.js';
import { buildTeamInstructionStack } from './team-instruction-stack.js';
import type { SoulRoleLayer } from '../team-phase-a-content/index.js';

interface SessionInstructionContextRow {
  id: string;
  metadata_json: string;
  team_parent_session_id: string | null;
}

interface TeamWorkspaceRootRow {
  default_working_root: string | null;
}

export interface AuxiliaryTeamInstructionInput {
  userId: string;
  sessionId: string;
  teamWorkspaceId?: string | null;
  roleLayer: SoulRoleLayer;
}

export async function buildAuxiliaryTeamInstructionPrefix(
  input: AuxiliaryTeamInstructionInput,
): Promise<string | null> {
  const sessionContext = resolveAuxiliarySessionContext(input);
  const teamWorkspaceId = sessionContext.teamWorkspaceId;
  const workspaceRoot =
    sessionContext.workspaceRoot ??
    (teamWorkspaceId
      ? resolveTeamWorkspaceDefaultRoot({
          teamWorkspaceId,
          userId: input.userId,
        })
      : null);

  const stack = await buildTeamInstructionStack({
    userId: input.userId,
    workspaceRoot,
    teamWorkspaceId,
    roleLayer: input.roleLayer,
  });
  const stableBlock = stack.stableBlock.trim();
  return stableBlock.length > 0 ? stableBlock : null;
}

export function prependAuxiliaryTeamInstructionPrefix(input: {
  instructionPrefix: string | null;
  prompt: string;
}): string {
  if (!input.instructionPrefix) {
    return input.prompt;
  }
  return `${input.instructionPrefix}\n\n${input.prompt}`;
}

function resolveAuxiliarySessionContext(input: AuxiliaryTeamInstructionInput): {
  teamWorkspaceId: string | null;
  workspaceRoot: string | null;
} {
  const explicitTeamWorkspaceId = normalizeOptionalString(input.teamWorkspaceId);
  const current = loadSessionInstructionContext({
    sessionId: input.sessionId,
    userId: input.userId,
  });
  const resolvedFromSession = current
    ? resolveSessionInstructionContext({
        row: current,
        seenSessionIds: new Set<string>(),
        userId: input.userId,
      })
    : { teamWorkspaceId: null, workspaceRoot: null };
  const sessionWorkspaceRootAllowed =
    !explicitTeamWorkspaceId ||
    !resolvedFromSession.teamWorkspaceId ||
    resolvedFromSession.teamWorkspaceId === explicitTeamWorkspaceId;

  return {
    teamWorkspaceId: explicitTeamWorkspaceId ?? resolvedFromSession.teamWorkspaceId,
    workspaceRoot: sessionWorkspaceRootAllowed ? resolvedFromSession.workspaceRoot : null,
  };
}

function resolveSessionInstructionContext(input: {
  row: SessionInstructionContextRow;
  seenSessionIds: Set<string>;
  userId: string;
}): { teamWorkspaceId: string | null; workspaceRoot: string | null } {
  if (input.seenSessionIds.has(input.row.id)) {
    return { teamWorkspaceId: null, workspaceRoot: null };
  }
  input.seenSessionIds.add(input.row.id);

  const metadata = parseSessionMetadataJson(input.row.metadata_json);
  const workspaceRoot = normalizeOptionalString(metadata['workingDirectory']);
  const teamWorkspaceId = normalizeOptionalString(metadata['teamWorkspaceId']);
  if (!input.row.team_parent_session_id) {
    return {
      teamWorkspaceId,
      workspaceRoot,
    };
  }

  const parent = loadSessionInstructionContext({
    sessionId: input.row.team_parent_session_id,
    userId: input.userId,
  });
  if (!parent) {
    return {
      teamWorkspaceId,
      workspaceRoot,
    };
  }

  const parentContext = resolveSessionInstructionContext({
    row: parent,
    seenSessionIds: input.seenSessionIds,
    userId: input.userId,
  });
  return {
    teamWorkspaceId: teamWorkspaceId ?? parentContext.teamWorkspaceId,
    workspaceRoot: workspaceRoot ?? parentContext.workspaceRoot,
  };
}

function loadSessionInstructionContext(input: {
  sessionId: string;
  userId: string;
}): SessionInstructionContextRow | null {
  const row = sqliteGet<SessionInstructionContextRow>(
    `SELECT id, metadata_json, team_parent_session_id
       FROM sessions
      WHERE id = ? AND user_id = ?
      LIMIT 1`,
    [input.sessionId, input.userId],
  );
  return row ?? null;
}

function resolveTeamWorkspaceDefaultRoot(input: {
  teamWorkspaceId: string;
  userId: string;
}): string | null {
  const row = sqliteGet<TeamWorkspaceRootRow>(
    `SELECT default_working_root
       FROM team_workspaces
      WHERE id = ? AND user_id = ?
      LIMIT 1`,
    [input.teamWorkspaceId, input.userId],
  );
  return normalizeOptionalString(row?.default_working_root);
}

function normalizeOptionalString(value: unknown): string | null {
  return typeof value === 'string' && value.trim().length > 0 ? value : null;
}
