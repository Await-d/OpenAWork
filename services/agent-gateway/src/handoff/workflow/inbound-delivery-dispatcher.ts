import type { InputImageContent, TeamReasoningEffort } from '@openAwork/shared';
import { randomUUID } from 'node:crypto';
import { sqliteAll, sqliteGet, sqliteRun, sqliteTransaction } from '../../infra/db.js';
import { appendSessionMessageV2 } from '../../message/message-v2-adapter.js';
import { getAnyInFlightStreamRequestForSession } from '../../routes/stream-cancellation.js';
import { logGatewayWarn } from '../../infra/gateway-logger.js';
import { reconcileSessionStateStatus } from '../../session/session-runtime-state.js';
import { orchestrateReceptionInput } from '../runner/reception-orchestrator.js';

const LEASE_MS = 60_000;
const MAX_ATTEMPTS = 5;
const inFlight = new Set<string>();
const workers = new Set<Promise<void>>();
let stopping = false;

interface DeliveryRow {
  inbound_id: string;
  request_id: string;
  outcome_json: string | null;
  attempt_count: number;
  user_id: string;
  to_session_id: string;
  payload_json: string;
  state_status: string | null;
  metadata_json: string | null;
}

export async function stopInboundDeliveries(): Promise<void> {
  stopping = true;
  await Promise.allSettled([...workers]);
}

export async function dispatchInboundDeliveries(
  input: {
    sessionId?: string;
    nowMs?: number;
    waitForCompletion?: boolean;
  } = {},
): Promise<void> {
  if (stopping) return;
  const now = input.nowMs ?? Date.now();
  const staleSessions = sqliteAll<{ id: string; user_id: string }>(
    `SELECT DISTINCT s.id, s.user_id FROM team_inbound_outbox o
    JOIN session_inbound_messages i ON i.id = o.inbound_id JOIN sessions s ON s.id = i.to_session_id AND s.user_id = i.user_id
    WHERE s.role_layer = 'reception' AND s.state_status = 'running'
      AND (o.state = 'pending' OR (o.state = 'processing' AND o.lease_until_ms <= ?))
      AND (? IS NULL OR s.id = ?) LIMIT 32`,
    [now, input.sessionId ?? null, input.sessionId ?? null],
  );
  for (const row of staleSessions) {
    if (!inFlight.has(row.id))
      reconcileSessionStateStatus({
        sessionId: row.id,
        userId: row.user_id,
        nowMs: now,
        releaseStaleDeciding: false,
      });
  }
  sqliteTransaction(() => {
    const terminal = sqliteAll<{
      inbound_id: string;
      user_id: string;
      to_session_id: string;
      expired: number;
    }>(
      `SELECT o.inbound_id, i.user_id, i.to_session_id,
      CASE WHEN i.state = 'expired' OR (i.expires_at IS NOT NULL AND i.expires_at < datetime(? / 1000, 'unixepoch')) THEN 1 ELSE 0 END AS expired
      FROM team_inbound_outbox o JOIN session_inbound_messages i ON i.id = o.inbound_id
      WHERE o.state IN ('pending','processing') AND (o.state = 'pending' OR o.lease_until_ms <= ?)
        AND (i.state IN ('expired','dead') OR (i.expires_at IS NOT NULL AND i.expires_at < datetime(? / 1000, 'unixepoch')) OR (o.attempt_count >= ? AND o.outcome_json IS NULL)) LIMIT 64`,
      [now, now, now, MAX_ATTEMPTS],
    );
    for (const row of terminal) {
      sqliteRun(
        "UPDATE team_inbound_outbox SET state = 'dead', last_error = ?, lease_token = NULL, lease_until_ms = NULL WHERE inbound_id = ?",
        [row.expired ? 'input-expired' : 'delivery-attempts-exhausted', row.inbound_id],
      );
      sqliteRun('UPDATE session_inbound_messages SET state = ?, last_error = ? WHERE id = ?', [
        row.expired ? 'expired' : 'dead',
        row.expired ? 'input-expired' : 'delivery-attempts-exhausted',
        row.inbound_id,
      ]);
      appendSessionMessageV2({
        sessionId: row.to_session_id,
        userId: row.user_id,
        role: 'assistant',
        content: [
          {
            type: 'text',
            text: row.expired
              ? '有一条等待中的输入已过期，未执行，请重新提交。'
              : '这条输入多次投递未能完成，已停止重试，请检查后重新提交。',
          },
        ],
      });
    }
  });
  const rows = sqliteAll<DeliveryRow>(
    `SELECT o.*, i.user_id, i.to_session_id, i.payload_json, s.state_status, s.metadata_json
    FROM team_inbound_outbox o JOIN session_inbound_messages i ON i.id = o.inbound_id
    JOIN sessions s ON s.id = i.to_session_id AND s.user_id = i.user_id
    WHERE s.role_layer = 'reception' AND (o.state = 'pending' OR (o.state = 'processing' AND o.lease_until_ms <= ?))
      AND o.available_at_ms <= ? AND (? IS NULL OR i.to_session_id = ?)
      AND i.state NOT IN ('expired', 'dead')
      AND (o.outcome_json IS NOT NULL OR (COALESCE(s.state_status, '') NOT IN ('running','paused')
        AND NOT EXISTS (SELECT 1 FROM session_inbound_messages control WHERE control.to_session_id = i.to_session_id AND control.state = 'pending' AND control.message_type IN ('cancel_signal','pause_signal','resume_signal'))
        AND NOT EXISTS (SELECT 1 FROM handoff_records h WHERE h.from_session_id = i.to_session_id AND h.state IN ('pending','claimed','running'))))
      AND NOT EXISTS (SELECT 1 FROM team_inbound_outbox previous JOIN session_inbound_messages pi ON pi.id = previous.inbound_id
        WHERE pi.to_session_id = i.to_session_id AND previous.state IN ('pending','processing') AND pi.rowid < i.rowid)
    ORDER BY o.available_at_ms, i.rowid LIMIT 16`,
    [now, now, input.sessionId ?? null, input.sessionId ?? null],
  );
  const started: Promise<void>[] = [];
  for (const row of rows) {
    if (inFlight.size >= 8) break;
    if (inFlight.has(row.to_session_id)) continue;
    if (
      !row.outcome_json &&
      (row.state_status === 'paused' ||
        row.state_status === 'running' ||
        getAnyInFlightStreamRequestForSession({
          sessionId: row.to_session_id,
          userId: row.user_id,
        }))
    )
      continue;
    const token = randomUUID();
    const claimed = sqliteGet<{ inbound_id: string }>(
      `UPDATE team_inbound_outbox SET state = 'processing', lease_token = ?, lease_until_ms = ?, attempt_count = attempt_count + 1
      WHERE inbound_id = ? AND (state = 'pending' OR (state = 'processing' AND lease_until_ms <= ?)) RETURNING inbound_id`,
      [token, now + LEASE_MS, row.inbound_id, now],
    );
    if (!claimed) continue;
    inFlight.add(row.to_session_id);
    const task = runDelivery(row, token).catch((error) => {
      logGatewayWarn(`[team-inbound] worker failed: ${String(error)}`);
    });
    workers.add(task);
    void task.then(() => workers.delete(task));
    started.push(task);
  }
  if (input.waitForCompletion !== false) await Promise.all(started);
}

async function runDelivery(row: DeliveryRow, token: string): Promise<void> {
  let leaseLost = false;
  const heartbeat = setInterval(() => {
    try {
      const renewed = sqliteGet<{ inbound_id: string }>(
        `UPDATE team_inbound_outbox SET lease_until_ms = ?
        WHERE inbound_id = ? AND state = 'processing' AND lease_token = ? AND lease_until_ms > ? RETURNING inbound_id`,
        [Date.now() + LEASE_MS, row.inbound_id, token, Date.now()],
      );
      if (!renewed) leaseLost = true;
    } catch (error) {
      leaseLost = true;
      logGatewayWarn(
        `[team-inbound] lease heartbeat failed for ${row.inbound_id}: ${String(error)}`,
      );
    }
    if (leaseLost) clearInterval(heartbeat);
  }, LEASE_MS / 3);
  try {
    let outcome: { triggered?: boolean; reason?: string };
    if (row.outcome_json) outcome = JSON.parse(row.outcome_json);
    else {
      const payload = JSON.parse(row.payload_json) as Record<string, unknown>;
      const metadata = JSON.parse(row.metadata_json ?? '{}') as Record<string, unknown>;
      outcome = await orchestrateReceptionInput({
        userId: row.user_id,
        receptionSessionId: row.to_session_id,
        userIntent: typeof payload['text'] === 'string' ? payload['text'] : '',
        ...(Array.isArray(payload['inputParts'])
          ? { inputParts: payload['inputParts'] as InputImageContent[] }
          : {}),
        teamWorkspaceId:
          typeof metadata['teamWorkspaceId'] === 'string' ? metadata['teamWorkspaceId'] : null,
        streamClientRequestId: row.request_id,
        persistUserMessage: false,
        ...(typeof payload['providerId'] === 'string'
          ? { requestedProviderId: payload['providerId'] }
          : {}),
        ...(typeof payload['modelId'] === 'string' ? { requestedModelId: payload['modelId'] } : {}),
        ...(typeof payload['thinkingEnabled'] === 'boolean'
          ? { requestedThinkingEnabled: payload['thinkingEnabled'] }
          : {}),
        ...(typeof payload['reasoningEffort'] === 'string' &&
        ['none', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max'].includes(
          payload['reasoningEffort'],
        )
          ? { requestedReasoningEffort: payload['reasoningEffort'] as TeamReasoningEffort }
          : {}),
      });
    }
    if (leaseLost) return;
    if (['handoff-active', 'orchestration-in-flight'].includes(outcome.reason ?? '')) {
      sqliteRun(
        `UPDATE team_inbound_outbox SET state = 'pending', attempt_count = attempt_count - 1, available_at_ms = ?, lease_token = NULL, lease_until_ms = NULL WHERE inbound_id = ? AND lease_token = ? AND lease_until_ms > ?`,
        [Date.now() + 1_000, row.inbound_id, token, Date.now()],
      );
      return;
    }
    const success =
      outcome.triggered ||
      [
        'direct-answer',
        'light-answer',
        'clarify-needed',
        'grill-started',
        'grill-images-added',
        'grill-cancelled',
        'grill-question',
        'grill-awaiting-confirmation',
        'grill-none',
        'grill-exhausted',
      ].includes(outcome.reason ?? '');
    if (!success) throw new Error(outcome.reason ?? 'delivery-outcome-unknown');
    sqliteTransaction(() => {
      const done = sqliteGet<{ inbound_id: string }>(
        `UPDATE team_inbound_outbox SET state = 'delivered', outcome_json = ?, lease_token = NULL, lease_until_ms = NULL, last_error = NULL, updated_at = datetime('now') WHERE inbound_id = ? AND lease_token = ? AND lease_until_ms > ? RETURNING inbound_id`,
        [JSON.stringify(outcome), row.inbound_id, token, Date.now()],
      );
      if (done)
        sqliteRun(
          "UPDATE session_inbound_messages SET state = 'consumed', consumed_at = datetime('now') WHERE id = ?",
          [row.inbound_id],
        );
    });
  } catch (error) {
    if (leaseLost) return;
    const dead = row.attempt_count + 1 >= MAX_ATTEMPTS;
    sqliteTransaction(() => {
      const updated = sqliteGet<{ inbound_id: string }>(
        `UPDATE team_inbound_outbox SET state = ?, available_at_ms = ?, last_error = ?, lease_token = NULL, lease_until_ms = NULL WHERE inbound_id = ? AND lease_token = ? AND lease_until_ms > ? RETURNING inbound_id`,
        [
          dead ? 'dead' : 'pending',
          Date.now() + Math.min(60_000, 1_000 * 2 ** row.attempt_count),
          String(error).slice(0, 1000),
          row.inbound_id,
          token,
          Date.now(),
        ],
      );
      if (dead && updated) {
        sqliteRun(
          "UPDATE session_inbound_messages SET state = 'dead', last_error = 'delivery-attempts-exhausted' WHERE id = ?",
          [row.inbound_id],
        );
        appendSessionMessageV2({
          sessionId: row.to_session_id,
          userId: row.user_id,
          role: 'assistant',
          clientRequestId: null,
          content: [
            { type: 'text', text: '这条输入多次投递失败，尚未被团队处理。请检查模型配置后重试。' },
          ],
        });
      }
    });
    logGatewayWarn(
      `[team-inbound] delivery ${row.inbound_id} ${dead ? 'dead' : 'retry'}: ${String(error)}`,
    );
  } finally {
    clearInterval(heartbeat);
    inFlight.delete(row.to_session_id);
  }
}
