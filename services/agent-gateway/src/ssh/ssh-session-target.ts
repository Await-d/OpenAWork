import { z } from 'zod';
import { SSHTerminalError } from '@openAwork/agent-core';
import { sqliteGet } from '../infra/db.js';
import { peekSshService } from './ssh-service.js';

const metadataSchema = z.object({
  sshConnectionId: z.string().nullable().optional(),
  workingDirectory: z.string().optional(),
  parentSessionId: z.string().optional(),
});

export function resolveSshSessionTarget(
  sessionId: string,
  userId: string,
): {
  connectionId: string;
  workingDirectory?: string;
} | null {
  const service = peekSshService();
  const seen = new Set<string>();
  let current: string | undefined = sessionId;
  let workingDirectory: string | undefined;
  while (current && seen.size < 6) {
    if (seen.has(current)) throw new SSHTerminalError('SSH 父会话存在循环绑定。');
    seen.add(current);
    const row:
      | { metadata_json: string | null; team_parent_session_id: string | null; user_id: string }
      | undefined = sqliteGet(
      'SELECT metadata_json, team_parent_session_id, user_id FROM sessions WHERE id = ?',
      [current],
    );
    if (!row) throw new SSHTerminalError('SSH 目标会话不存在。');
    if (row.user_id !== userId) throw new SSHTerminalError('SSH 父会话不属于当前用户。');
    const metadata = metadataSchema.parse(JSON.parse(row.metadata_json ?? '{}'));
    if (metadata.sshConnectionId === null) return null;
    workingDirectory ??= metadata.workingDirectory;
    const connectionId =
      service?.getBindings().getConnectionId(current) ?? metadata.sshConnectionId;
    if (connectionId) return { connectionId, ...(workingDirectory ? { workingDirectory } : {}) };
    current = row.team_parent_session_id ?? metadata.parentSessionId;
  }
  if (current) throw new SSHTerminalError('SSH 父会话链超过深度限制。');
  return null;
}
