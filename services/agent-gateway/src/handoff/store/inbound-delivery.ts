import type { InputImageContent } from '@openAwork/shared';
import { sqliteRun, sqliteTransaction } from '../../infra/db.js';
import { appendSessionMessageV2 } from '../../message/message-v2-adapter.js';
import { buildUserInputContent } from '../../message/input-image-content.js';
import { submitInboundMessage, type SubmitInboundInput } from './inbound-store.js';

export function submitInboundWithHistory(
  input: SubmitInboundInput & { requestId: string | null; roleLayer: string | null },
) {
  return sqliteTransaction(() => {
    const result = submitInboundMessage(input);
    if (input.messageType !== 'user_input') return result;
    if (!result.reused) {
      const payload = result.record.payload as Record<string, unknown>;
      const content = buildUserInputContent(
        typeof payload['text'] === 'string' ? payload['text'] : '',
        payload['inputParts'] as InputImageContent[] | undefined,
      );
      if (content.length)
        appendSessionMessageV2({
          sessionId: input.toSessionId,
          userId: input.userId,
          role: 'user',
          content,
          clientRequestId: input.requestId,
        });
    }
    if (input.roleLayer === 'reception')
      sqliteRun(
        `INSERT OR IGNORE INTO team_inbound_outbox (inbound_id, request_id) VALUES (?, ?)`,
        [result.record.id, input.requestId ?? `team-inbound:${result.record.id}`],
      );
    return result;
  });
}

export function recordInboundOutcome(sessionId: string, requestId: string, outcome: unknown): void {
  sqliteRun(
    `UPDATE team_inbound_outbox SET outcome_json = ?, updated_at = datetime('now')
    WHERE request_id = ? AND inbound_id IN (SELECT id FROM session_inbound_messages WHERE to_session_id = ?)`,
    [JSON.stringify(outcome), requestId, sessionId],
  );
}
