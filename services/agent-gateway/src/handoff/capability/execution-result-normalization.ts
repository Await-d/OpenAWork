import type { ChecklistItem, SubmitExecutionResultInput } from './completion-protocol-contract.js';

type ExecutionResultStatus = NonNullable<SubmitExecutionResultInput['status']>;

const EXECUTION_BLOCKED_PHRASES = [/\bblocked\b/i, /阻塞/, /无法继续/, /等待依赖/] as const;

const EXECUTION_FAILED_PHRASES = [
  /\bfail(?:ed|ure)?\b/i,
  /失败/,
  /未完成/,
  /不通过/,
  /报错/,
  /错误/,
] as const;

function inferExecutionStatus(summary: string): ExecutionResultStatus {
  if (EXECUTION_BLOCKED_PHRASES.some((pattern) => pattern.test(summary))) {
    return 'blocked';
  }
  if (EXECUTION_FAILED_PHRASES.some((pattern) => pattern.test(summary))) {
    return 'failed';
  }
  return 'completed';
}

export interface NormalizedExecutionResult {
  readonly taskId: string;
  readonly status: ExecutionResultStatus;
  readonly changedFiles: string[];
  readonly checklist: ChecklistItem[];
  readonly summary: string;
  readonly verification: string[];
  readonly blockedReason?: string;
}

export function normalizeExecutionResult(
  args: SubmitExecutionResultInput,
  expectedTaskId?: string,
): NormalizedExecutionResult {
  const summary =
    [args.summary, args.content]
      .find((value): value is string => typeof value === 'string' && value.trim().length > 0)
      ?.trim() ?? '';
  const taskId = args.taskId ?? expectedTaskId ?? 'unknown';
  const status = args.status ?? inferExecutionStatus(summary);
  const checklistStatus: ChecklistItem['status'] =
    status === 'completed' ? 'pass' : status === 'failed' ? 'fail' : 'blocked';
  const checklist: ChecklistItem[] =
    args.checklist && args.checklist.length > 0
      ? args.checklist
      : [
          {
            id: taskId,
            status: checklistStatus,
            evidence: summary,
          },
        ];
  const blockedReason = args.blockedReason ?? (status === 'blocked' ? summary : undefined);

  return {
    taskId,
    status,
    changedFiles: args.changedFiles ?? [],
    checklist,
    summary,
    verification: args.verification ?? [],
    ...(blockedReason ? { blockedReason } : {}),
  };
}
