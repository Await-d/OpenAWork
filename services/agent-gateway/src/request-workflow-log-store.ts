import type { RequestContext, WorkflowStep } from '@openAwork/logger';
import { sqliteAll, sqliteRun } from './db.js';
import { isSqliteMalformedError } from './sqlite-error-utils.js';

interface RequestWorkflowLogRow {
  id: number;
  request_id: string;
  user_id: string | null;
  session_id: string | null;
  method: string;
  path: string;
  status_code: number;
  ip: string | null;
  user_agent: string | null;
  workflow_json: string;
  created_at: string;
}

let requestWorkflowLogStoreDisabled = false;

function stripPrivateWorkflowFields(step: WorkflowStep): Omit<WorkflowStep, '_startedAt'> {
  return {
    name: step.name,
    status: step.status,
    ...(step.message !== undefined ? { message: step.message } : {}),
    ...(step.durationMs !== undefined ? { durationMs: step.durationMs } : {}),
    ...(step.fields ? { fields: step.fields } : {}),
    ...(step.children ? { children: step.children.map(stripPrivateWorkflowFields) } : {}),
  };
}

function detectSessionId(path: string): string | null {
  const match = path.match(/\/sessions\/([^/?]+)/u);
  return match?.[1] ?? null;
}

export function persistRequestWorkflowLog(input: {
  context: RequestContext;
  steps: WorkflowStep[];
  statusCode: number;
  userId?: string | null;
}): void {
  if (requestWorkflowLogStoreDisabled) {
    return;
  }

  try {
    sqliteRun(
      `INSERT INTO request_workflow_logs
       (request_id, user_id, session_id, method, path, status_code, ip, user_agent, workflow_json, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))`,
      [
        input.context.requestId,
        input.userId ?? null,
        detectSessionId(input.context.path),
        input.context.method,
        input.context.path,
        input.statusCode,
        input.context.ip ?? null,
        input.context.userAgent ?? null,
        JSON.stringify(input.steps.map(stripPrivateWorkflowFields)),
      ],
    );
  } catch (error) {
    if (isSqliteMalformedError(error)) {
      requestWorkflowLogStoreDisabled = true;
      return;
    }

    throw error;
  }
}

export function listRequestWorkflowLogs(userId: string, limit = 100): RequestWorkflowLogRow[] {
  if (requestWorkflowLogStoreDisabled) {
    return [];
  }

  try {
    return sqliteAll<RequestWorkflowLogRow>(
      `SELECT id, request_id, user_id, session_id, method, path, status_code, ip, user_agent, workflow_json, created_at
       FROM request_workflow_logs
       WHERE user_id = ?
       ORDER BY created_at DESC
       LIMIT ?`,
      [userId, limit],
    );
  } catch (error) {
    if (isSqliteMalformedError(error)) {
      requestWorkflowLogStoreDisabled = true;
      return [];
    }

    throw error;
  }
}

export function resetRequestWorkflowLogStoreStateForTests(): void {
  requestWorkflowLogStoreDisabled = false;
}
