import { sqliteAll, sqliteGet, sqliteRun } from '../infra/db.js';

export type TeamRuntimeAlertControlState = 'acknowledged' | 'suppressed';

interface TeamRuntimeAlertControlRow {
  alert_code: string;
  note: string | null;
  state: string;
  suppressed_until_ms: number | null;
  updated_at: string;
  user_id: string;
}

export interface TeamRuntimeAlertControlRecord {
  alertCode: string;
  note: string | null;
  state: TeamRuntimeAlertControlState;
  suppressedUntilMs: number | null;
  updatedAt: string;
  userId: string;
}

function mapRow(row: TeamRuntimeAlertControlRow): TeamRuntimeAlertControlRecord {
  return {
    alertCode: row.alert_code,
    note: row.note,
    state: row.state as TeamRuntimeAlertControlState,
    suppressedUntilMs: row.suppressed_until_ms,
    updatedAt: row.updated_at,
    userId: row.user_id,
  };
}

function clearExpiredSuppressedControls(input: {
  alertCodes?: string[];
  nowMs?: number;
  userId: string;
}): void {
  const nowMs = input.nowMs ?? Date.now();
  if (input.alertCodes && input.alertCodes.length === 0) {
    return;
  }
  if (input.alertCodes && input.alertCodes.length > 0) {
    sqliteRun(
      `DELETE FROM team_runtime_alert_controls
        WHERE user_id = ?
          AND state = 'suppressed'
          AND suppressed_until_ms IS NOT NULL
          AND suppressed_until_ms <= ?
          AND alert_code IN (${input.alertCodes.map(() => '?').join(',')})`,
      [input.userId, nowMs, ...input.alertCodes],
    );
    return;
  }
  sqliteRun(
    `DELETE FROM team_runtime_alert_controls
      WHERE user_id = ?
        AND state = 'suppressed'
        AND suppressed_until_ms IS NOT NULL
        AND suppressed_until_ms <= ?`,
    [input.userId, nowMs],
  );
}

export function consumeExpiredSuppressedAlertControls(input: {
  alertCodes?: string[];
  nowMs?: number;
  userId: string;
}): string[] {
  const nowMs = input.nowMs ?? Date.now();
  if (input.alertCodes && input.alertCodes.length === 0) {
    return [];
  }
  const rows =
    input.alertCodes && input.alertCodes.length > 0
      ? sqliteAll<{ alert_code: string }>(
          `SELECT alert_code
             FROM team_runtime_alert_controls
            WHERE user_id = ?
              AND state = 'suppressed'
              AND suppressed_until_ms IS NOT NULL
              AND suppressed_until_ms <= ?
              AND alert_code IN (${input.alertCodes.map(() => '?').join(',')})`,
          [input.userId, nowMs, ...input.alertCodes],
        )
      : sqliteAll<{ alert_code: string }>(
          `SELECT alert_code
             FROM team_runtime_alert_controls
            WHERE user_id = ?
              AND state = 'suppressed'
              AND suppressed_until_ms IS NOT NULL
              AND suppressed_until_ms <= ?`,
          [input.userId, nowMs],
        );

  if (rows.length === 0) {
    return [];
  }

  clearExpiredSuppressedControls({
    alertCodes: input.alertCodes,
    nowMs,
    userId: input.userId,
  });
  return rows.map((row) => row.alert_code);
}

export function listTeamRuntimeAlertControls(input: {
  alertCodes?: string[];
  nowMs?: number;
  userId: string;
}): TeamRuntimeAlertControlRecord[] {
  clearExpiredSuppressedControls(input);
  if (input.alertCodes && input.alertCodes.length === 0) {
    return [];
  }
  const rows =
    input.alertCodes && input.alertCodes.length > 0
      ? sqliteAll<TeamRuntimeAlertControlRow>(
          `SELECT user_id, alert_code, state, note, suppressed_until_ms, updated_at
             FROM team_runtime_alert_controls
            WHERE user_id = ? AND alert_code IN (${input.alertCodes.map(() => '?').join(',')})`,
          [input.userId, ...input.alertCodes],
        )
      : sqliteAll<TeamRuntimeAlertControlRow>(
          `SELECT user_id, alert_code, state, note, suppressed_until_ms, updated_at
             FROM team_runtime_alert_controls
            WHERE user_id = ?`,
          [input.userId],
        );

  return rows.map(mapRow);
}

export function getTeamRuntimeAlertControl(input: {
  alertCode: string;
  nowMs?: number;
  userId: string;
}): TeamRuntimeAlertControlRecord | null {
  clearExpiredSuppressedControls({
    alertCodes: [input.alertCode],
    nowMs: input.nowMs,
    userId: input.userId,
  });
  const row = sqliteGet<TeamRuntimeAlertControlRow>(
    `SELECT user_id, alert_code, state, note, suppressed_until_ms, updated_at
       FROM team_runtime_alert_controls
      WHERE user_id = ? AND alert_code = ?
      LIMIT 1`,
    [input.userId, input.alertCode],
  );
  return row ? mapRow(row) : null;
}

export function upsertTeamRuntimeAlertControl(input: {
  alertCode: string;
  note?: string | null;
  state: TeamRuntimeAlertControlState;
  suppressedUntilMs?: number | null;
  userId: string;
}): TeamRuntimeAlertControlRecord {
  sqliteRun(
    `INSERT INTO team_runtime_alert_controls (
       user_id, alert_code, state, note, suppressed_until_ms, created_at, updated_at
     ) VALUES (?, ?, ?, ?, ?, datetime('now'), datetime('now'))
     ON CONFLICT(user_id, alert_code) DO UPDATE SET
       state = excluded.state,
       note = excluded.note,
       suppressed_until_ms = excluded.suppressed_until_ms,
       updated_at = datetime('now')`,
    [
      input.userId,
      input.alertCode,
      input.state,
      input.note ?? null,
      input.suppressedUntilMs ?? null,
    ],
  );

  const control = getTeamRuntimeAlertControl({
    userId: input.userId,
    alertCode: input.alertCode,
  });
  if (!control) {
    throw new Error('team runtime alert control write succeeded but read-back failed');
  }
  return control;
}

export function clearTeamRuntimeAlertControl(input: {
  alertCode: string;
  userId: string;
}): boolean {
  const before = getTeamRuntimeAlertControl(input);
  if (!before) {
    return false;
  }
  sqliteRun(
    `DELETE FROM team_runtime_alert_controls WHERE user_id = ? AND alert_code = ?`,
    [input.userId, input.alertCode],
  );
  return true;
}
