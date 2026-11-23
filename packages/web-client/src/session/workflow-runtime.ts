import type {
  WorkflowRuntimeEvidenceState,
  WorkflowRuntimeEvidenceStatus,
  WorkflowRuntimeLoopState,
  WorkflowRuntimeMode,
  WorkflowRuntimePlanState,
  WorkflowRuntimeState,
  WorkflowRuntimeVerificationStatus,
} from '@openAwork/shared';

export interface SessionWorkflowRuntimeSource {
  readonly metadata_json?: string;
  readonly workflowRuntime?: WorkflowRuntimeState;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function readMetadataObject(metadataJson: string | undefined): Record<string, unknown> {
  if (!metadataJson) return {};

  try {
    const parsed: unknown = JSON.parse(metadataJson);
    return isRecord(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

function optionalString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim().length > 0 ? value : undefined;
}

function optionalNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

function optionalStringArray(value: unknown): readonly string[] {
  if (!Array.isArray(value)) {
    return [];
  }

  const seen = new Set<string>();
  const result: string[] = [];
  for (const item of value) {
    if (typeof item !== 'string') {
      continue;
    }
    const trimmed = item.trim();
    if (trimmed.length === 0 || seen.has(trimmed)) {
      continue;
    }
    seen.add(trimmed);
    result.push(trimmed);
  }
  return result;
}

function loopKind(value: unknown): WorkflowRuntimeLoopState['kind'] | undefined {
  return value === 'ralph' || value === 'ulw' ? value : undefined;
}

function loopStrategy(value: unknown): WorkflowRuntimeLoopState['strategy'] | undefined {
  return value === 'continue' || value === 'reset' ? value : undefined;
}

function dialogueMode(value: unknown): 'clarify' | 'coding' | 'programmer' | undefined {
  return value === 'clarify' || value === 'coding' || value === 'programmer' ? value : undefined;
}

function buildPlanState(metadata: Record<string, unknown>): WorkflowRuntimePlanState | undefined {
  const plan: WorkflowRuntimePlanState = {
    path: optionalString(metadata['activeWorkflowPlanPath']),
    progress: optionalString(metadata['activeWorkflowPlanProgress']),
    requestedWorktreePath: optionalString(metadata['requestedWorkflowWorktreePath']),
    title: optionalString(metadata['activeWorkflowPlanTitle']),
    worktreePath: optionalString(metadata['activeWorkflowWorktreePath']),
  };

  return Object.values(plan).some((value) => value !== undefined) ? plan : undefined;
}

function buildLoopState(metadata: Record<string, unknown>): WorkflowRuntimeLoopState | undefined {
  const kind = loopKind(metadata['activeLoopKind']);
  if (!kind) return undefined;

  const verificationRequired =
    kind === 'ulw' &&
    (metadata['ulwLoopVerificationRequired'] === true ||
      typeof metadata['ulwVerificationPendingTaskId'] === 'string');
  const verificationStatus: WorkflowRuntimeVerificationStatus =
    typeof metadata['ulwVerificationPendingTaskId'] === 'string' ? 'pending' : 'none';

  return {
    completionPromise: optionalString(metadata['ulwLoopCompletionPromise']),
    kind,
    startedAt: optionalNumber(
      kind === 'ulw' ? metadata['ulwLoopStartedAt'] : metadata['ralphLoopStartedAt'],
    ),
    strategy: loopStrategy(
      kind === 'ulw' ? metadata['ulwLoopStrategy'] : metadata['ralphLoopStrategy'],
    ),
    taskDescription: optionalString(metadata['activeLoopTaskDescription']),
    taskId:
      optionalString(metadata['activeLoopTaskId']) ??
      optionalString(kind === 'ulw' ? metadata['ulwLoopTaskId'] : metadata['ralphLoopTaskId']),
    verificationRequired,
    verificationStatus,
  };
}

function resolveMode(input: {
  activeLoop?: WorkflowRuntimeLoopState;
  activePlan?: WorkflowRuntimePlanState;
  mode?: 'clarify' | 'coding' | 'programmer';
}): WorkflowRuntimeMode {
  if (input.activeLoop?.kind === 'ulw') return 'ulw';
  if (input.activeLoop || input.activePlan) return 'execution';
  if (input.mode === 'clarify') return 'planning';
  if (input.mode === 'programmer') return 'execution';
  return 'normal';
}

function evidenceStatus(
  value: unknown,
  artifactRefs: readonly string[],
  activeLoop?: WorkflowRuntimeLoopState,
): WorkflowRuntimeEvidenceStatus {
  if (value === 'pending' || value === 'available' || value === 'none') {
    return value;
  }
  if (artifactRefs.length > 0) {
    return 'available';
  }
  return activeLoop?.verificationStatus === 'pending' ? 'pending' : 'none';
}

function buildEvidenceState(
  metadata: Record<string, unknown>,
  activeLoop?: WorkflowRuntimeLoopState,
): WorkflowRuntimeEvidenceState {
  const artifactRefs = optionalStringArray(metadata['workflowRuntimeEvidenceArtifactRefs']);
  return {
    artifactRefs,
    status: evidenceStatus(metadata['workflowRuntimeEvidenceStatus'], artifactRefs, activeLoop),
  };
}

/**
 * 来源托管会话（渠道 `channel` / 定时任务 `cron`）：它们**没有**对话模式。
 *
 * 规则本身与网关 `services/agent-gateway/src/session/session-runtime-policy.ts` 的
 * `isSourceManagedSessionMetadata` 同源。这里刻意**内联**而非导出/导入：本包新增导出会
 * 击穿网页端大量 `vi.mock('@openAwork/web-client')` 的局部工厂——凡是导入链经过本模块的
 * 测试都会整体报「No "X" export is defined on the mock」。
 */
function isSourceManagedMetadata(metadata: Record<string, unknown>): boolean {
  const source = metadata['source'];
  return source === 'channel' || source === 'cron';
}

function buildWorkflowRuntimeState(metadataJson: string | undefined): WorkflowRuntimeState {
  const metadata = readMetadataObject(metadataJson);
  const activePlan = buildPlanState(metadata);
  const activeLoop = buildLoopState(metadata);

  return {
    ...(activeLoop ? { activeLoop } : {}),
    ...(activePlan ? { activePlan } : {}),
    evidence: buildEvidenceState(metadata, activeLoop),
    // 来源会话的 `dialogueMode` 只可能是上游误写的脏值，不得把它投影成「规划中」
    //（clarify → planning）。真实进度（activePlan / activeLoop）与对话模式无关，照常投影。
    mode: resolveMode({
      activeLoop,
      activePlan,
      mode: isSourceManagedMetadata(metadata) ? undefined : dialogueMode(metadata['dialogueMode']),
    }),
  };
}

export function getSessionWorkflowRuntime(
  session: SessionWorkflowRuntimeSource,
): WorkflowRuntimeState {
  return session.workflowRuntime ?? buildWorkflowRuntimeState(session.metadata_json);
}
