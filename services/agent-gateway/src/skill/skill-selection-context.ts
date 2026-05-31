/**
 * Bridge between Fastify request handlers / sandbox executors and the pure
 * `resolveEffectiveSkills` core. Centralises the boilerplate of digging the
 * working directory out of `sessions.metadata_json` so call sites only have
 * to provide the session id (or, for the GET endpoints that don't have one
 * yet, the workspacePath directly).
 */

import { sqliteGet } from '../infra/db.js';
import { resolveEffectiveSkills, type EffectiveSkill } from './skill-selection.js';
import {
  extractSessionWorkingDirectory,
  parseSessionMetadataJson,
} from '../session/session-workspace-metadata.js';

interface SessionContextRow {
  user_id: string;
  metadata_json: string;
}

/**
 * Resolve effective skills for a Fastify request that already has the user
 * id and an explicit workspacePath (e.g. /capabilities, /tools list).
 */
export function getEffectiveSkillsForUser(input: {
  userId: string;
  workspacePath: string | null;
  sessionId?: string | null;
}): EffectiveSkill[] {
  return resolveEffectiveSkills({
    userId: input.userId,
    workspacePath: input.workspacePath,
    sessionId: input.sessionId ?? null,
  });
}

/**
 * Resolve effective skills using only a session id. Loads the session row,
 * extracts working directory from `metadata_json`, and returns null when the
 * session is missing (so callers can degrade gracefully).
 */
export function getEffectiveSkillsForSession(sessionId: string): EffectiveSkill[] | null {
  const row = sqliteGet<SessionContextRow>(
    'SELECT user_id, metadata_json FROM sessions WHERE id = ? LIMIT 1',
    [sessionId],
  );
  if (!row) return null;
  const metadata = parseSessionMetadataJson(row.metadata_json ?? '{}');
  const workspacePath = extractSessionWorkingDirectory(metadata);
  const requested = metadata['requestedSkills'];
  const requestedSkillIds = Array.isArray(requested)
    ? requested.filter((v): v is string => typeof v === 'string' && v.length > 0)
    : [];
  return resolveEffectiveSkills({
    userId: row.user_id,
    workspacePath,
    sessionId,
    ...(requestedSkillIds.length > 0 ? { requestedSkillIds } : {}),
  });
}

/**
 * Variant for callers that already have metadata_json + userId in scope (saves
 * a DB roundtrip on the stream hot path).
 */
export function getEffectiveSkillsFromSessionContext(input: {
  userId: string;
  sessionId: string;
  metadataJson: string | null | undefined;
}): EffectiveSkill[] {
  const metadata = input.metadataJson ? parseSessionMetadataJson(input.metadataJson) : {};
  const workspacePath = input.metadataJson ? extractSessionWorkingDirectory(metadata) : null;
  const requested = metadata['requestedSkills'];
  const requestedSkillIds = Array.isArray(requested)
    ? requested.filter((v): v is string => typeof v === 'string' && v.length > 0)
    : [];
  return resolveEffectiveSkills({
    userId: input.userId,
    workspacePath,
    sessionId: input.sessionId,
    ...(requestedSkillIds.length > 0 ? { requestedSkillIds } : {}),
  });
}
