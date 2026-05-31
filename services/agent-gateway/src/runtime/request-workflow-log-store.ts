import type { RequestContext, WorkflowStep } from '@openAwork/logger';
import type { ToolCallObservabilityAnnotation } from '@openAwork/shared';
import { sqliteAll, sqliteRun } from '../infra/db.js';
import { isSqliteMalformedError } from '../infra/sqlite-error-utils.js';

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

export interface RequestWorkflowToolCallRef {
  toolCallId: string;
  clientRequestId?: string;
  observability?: ToolCallObservabilityAnnotation;
}

let requestWorkflowLogStoreDisabled = false;

/**
 * request_workflow_logs 是网关最高频的只增表：每个请求结束（onResponse / onError /
 * onTimeout / onRequestAbort 四个钩子之一）都会落一行，此前从无裁剪。长时间运行的
 * 网关会让它无界膨胀，吃满磁盘并拖慢 `/settings` 诊断查询。这里按「全局保留最近 N 行」
 * 做有界裁剪。
 *
 * 与 team_audit_logs（按用户裁剪）不同：request_workflow_logs.user_id 可为 NULL
 * （未认证请求、健康检查、登录前流量），因此按全局总行数上限裁剪，而非按用户。
 *
 * 裁剪摊销执行：每累计 REQUEST_WORKFLOW_LOG_PRUNE_CHECK_INTERVAL 次插入才跑一次
 * DELETE，避免每次写入都触发 DELETE 造成写放大；实际行数最多比上限多出一个检查间隔的
 * 过冲。裁剪失败只告警、绝不影响请求日志写入或主请求流程；遇到库损坏与写入侧一致地
 * 禁用整个 store。
 */
const DEFAULT_REQUEST_WORKFLOW_LOG_MAX_ROWS = 5000;
export const REQUEST_WORKFLOW_LOG_PRUNE_CHECK_INTERVAL = 100;

let requestWorkflowLogRetentionOverride: number | null = null;
let insertsSincePrune = 0;

function resolveRequestWorkflowLogRetention(): number {
  if (requestWorkflowLogRetentionOverride !== null) {
    return requestWorkflowLogRetentionOverride;
  }
  const raw = globalThis.process?.env['OPENAWORK_REQUEST_WORKFLOW_LOG_MAX_ROWS'];
  if (raw === undefined || raw === null || raw.trim() === '') {
    return DEFAULT_REQUEST_WORKFLOW_LOG_MAX_ROWS;
  }
  const parsed = Number(raw);
  // 非正数 / NaN 视为「关闭裁剪」，与其它 env 死线开关语义一致。
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return 0;
  }
  return Math.floor(parsed);
}

function pruneRequestWorkflowLogs(limit: number): void {
  // 用自增主键 id 排序：created_at 是 datetime('now') 秒级精度，同秒内多条会并列；
  // id 单调唯一，能稳定区分「最近 N 行」。
  sqliteRun(
    `DELETE FROM request_workflow_logs
      WHERE id NOT IN (
        SELECT id FROM request_workflow_logs
         ORDER BY id DESC
         LIMIT ?
      )`,
    [limit],
  );
}

function maybePruneRequestWorkflowLogs(): void {
  const limit = resolveRequestWorkflowLogRetention();
  if (limit <= 0) {
    // 裁剪关闭：重置计数，避免重新开启后立刻触发一次大裁剪。
    insertsSincePrune = 0;
    return;
  }
  insertsSincePrune += 1;
  if (insertsSincePrune < REQUEST_WORKFLOW_LOG_PRUNE_CHECK_INTERVAL) {
    return;
  }
  insertsSincePrune = 0;
  try {
    pruneRequestWorkflowLogs(limit);
  } catch (error) {
    if (isSqliteMalformedError(error)) {
      requestWorkflowLogStoreDisabled = true;
      return;
    }
    console.warn(
      `[request-workflow-log-store] 裁剪 request_workflow_logs 失败：${
        error instanceof Error ? error.message : String(error)
      }`,
    );
  }
}

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

function buildPersistedWorkflowSteps(input: {
  steps: WorkflowStep[];
  toolCallRefs?: RequestWorkflowToolCallRef[];
}): Array<Omit<WorkflowStep, '_startedAt'>> {
  const persistedSteps = input.steps.map(stripPrivateWorkflowFields);
  if (!input.toolCallRefs || input.toolCallRefs.length === 0) {
    return persistedSteps;
  }

  return [
    ...persistedSteps,
    {
      name: 'tool.call.refs',
      status: 'success',
      fields: {
        toolCallRefsCount: input.toolCallRefs.length,
        toolCallRefsJson: JSON.stringify(input.toolCallRefs),
      },
    },
  ];
}

export function persistRequestWorkflowLog(input: {
  context: RequestContext;
  steps: WorkflowStep[];
  statusCode: number;
  userId?: string | null;
  toolCallRefs?: RequestWorkflowToolCallRef[];
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
        JSON.stringify(buildPersistedWorkflowSteps(input)),
      ],
    );
    maybePruneRequestWorkflowLogs();
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
       ORDER BY created_at DESC, id DESC
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
  insertsSincePrune = 0;
  requestWorkflowLogRetentionOverride = null;
}

/** 测试用：覆盖全局保留上限（传 null 恢复 env / 默认值）。 */
export function __setRequestWorkflowLogRetentionForTesting(limit: number | null): void {
  requestWorkflowLogRetentionOverride = limit;
}

/** 测试用：清空摊销计数状态。 */
export function __resetRequestWorkflowLogPruneStateForTesting(): void {
  insertsSincePrune = 0;
}
