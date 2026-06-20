import type { CanonicalRoleDescriptor } from '@openAwork/shared';

export interface AgentRole {
  id: string;
  displayName: string;
  description: string;
  systemPrompt: string;
  allowedTools: string[];
  model?: string;
  maxTokens?: number;
  maxIterations?: number;
  subAgentPromptPrefix?: string;
  canonicalRole?: CanonicalRoleDescriptor;
  aliases?: string[];
}

export interface RuntimeRoleMetadata {
  agentRoleId?: string;
  canonicalRole?: CanonicalRoleDescriptor;
}

export type DAGNodeStatus = 'pending' | 'running' | 'completed' | 'failed' | 'skipped';
export type DAGStatus = 'pending' | 'running' | 'completed' | 'failed';
export type WorkflowMode = 'interactive' | 'delegated';
export type DataFlow = 'sequential' | 'parallel' | 'conditional';
export type DataType = 'context' | 'result' | 'tool_output';

export interface RetryPolicy {
  maxRetries: number;
  backoffMs: number;
  escalateOnExhaustion: boolean;
  /**
   * 每任务重试预算（参考 hermes-agent v0.13.0）。
   *
   * 与 maxRetries 不同，retryBudget 是该节点的**总生命周期**重试上限，
   * 跨多次执行周期累积。当累积重试次数超过 retryBudget 时，
   * 不再重试而是直接升级到人工介入。
   *
   * 不设置时默认等于 maxRetries（保持向后兼容）。
   */
  retryBudget?: number;
}

export type RootCauseCategory =
  | 'logic_error'
  | 'missing_dependency'
  | 'env_issue'
  | 'input_format'
  | 'model_capability';

export interface RootCauseAnalysis {
  category: RootCauseCategory;
  whyRetryFailed: string;
  affectedNodes: string[];
  fixSuggestion: string;
  requiresHuman: boolean;
  autoFixApplied?: string;
}

export interface FailureEscalationRecord {
  attempt: number;
  error: string;
  timestamp: number;
  rootCauseAnalysis?: RootCauseAnalysis;
  resolvedAt?: number;
}

export interface DAGNode {
  id: string;
  type: 'orchestrator' | 'subagent' | 'tool' | 'human_input';
  agentRole?: AgentRole;
  label: string;
  status: DAGNodeStatus;
  input?: unknown;
  output?: unknown;
  startedAt?: number;
  completedAt?: number;
  durationMs?: number;
  executionTimeoutMs?: number;
  approvalTimeoutMs?: number;
  retryPolicy?: RetryPolicy;
  failureEscalationLog?: FailureEscalationRecord[];
  /**
   * 幻觉检测结果（参考 hermes-agent v0.13.0）。
   *
   * 当节点声称完成时，系统会验证其输出是否真实存在（如声明的文件修改
   * 是否实际写入）。如果检测到幻觉，节点会被标记回 pending 重试，
   * 或在重试预算耗尽后标记为 failed。
   */
  hallucinationCheck?: HallucinationCheckResult;
}

/**
 * 幻觉检测结果。
 */
export interface HallucinationCheckResult {
  /** 是否通过验证（true = 没有幻觉） */
  passed: boolean;
  /** 检测到的幻觉类型 */
  issues: HallucinationIssue[];
  /** 检查时间戳 */
  checkedAt: number;
  /** 检查耗时（ms） */
  durationMs: number;
}

export type HallucinationIssueType =
  | 'claimed_file_not_found'
  | 'claimed_change_not_present'
  | 'empty_output'
  | 'output_mismatch'
  | 'repeated_failure_pattern';

export interface HallucinationIssue {
  type: HallucinationIssueType;
  detail: string;
  /** 期望的值/状态 */
  expected?: string;
  /** 实际的值/状态 */
  actual?: string;
}

export interface DAGEdge {
  id: string;
  source: string;
  target: string;
  label?: string;
  dataFlow?: DataFlow;
  dataType?: DataType;
}

export interface AgentDAG {
  id: string;
  sessionId: string;
  nodes: DAGNode[];
  edges: DAGEdge[];
  status: DAGStatus;
  createdAt: number;
  completedAt?: number;
  layout?: Record<string, { x: number; y: number }>;
}

export type DAGEvent =
  | ({ type: 'node_started'; nodeId: string; timestamp: number } & RuntimeRoleMetadata)
  | ({
      type: 'node_completed';
      nodeId: string;
      output: unknown;
      timestamp: number;
    } & RuntimeRoleMetadata)
  | ({
      type: 'node_failed';
      nodeId: string;
      error: string;
      timestamp: number;
    } & RuntimeRoleMetadata)
  | { type: 'edge_activated'; edgeId: string; timestamp: number }
  | { type: 'dag_completed'; result: unknown; timestamp: number }
  | {
      type: 'human_approval_required';
      nodeId: string;
      plan: string;
      options: string[];
      autoResolveMs?: number;
    }
  | { type: 'risk_escalation'; nodeId: string; riskDetail: string; suggestedAction: string }
  | {
      type: 'hallucination_detected';
      nodeId: string;
      issues: Array<{ type: string; detail: string }>;
      timestamp: number;
    }
  | {
      type: 'diagnostic_alert';
      nodeId: string;
      pattern: string;
      detail: string;
      timestamp: number;
    };

export type DAGEventHandler = (event: DAGEvent) => void;

/**
 * 带优先级的事件订阅（参考 spec-kit v0.10.0 per-event hook lists with priority ordering）。
 *
 * priority 数字越小越先执行（默认 0）。
 * continueOnError 为 true 时，该 handler 抛异常不会阻断后续 handler。
 */
export interface DAGEventSubscription {
  handler: DAGEventHandler;
  /** 优先级，数字越小越先执行（默认 0） */
  priority?: number;
  /** handler 抛异常时是否继续执行后续 handler（默认 true） */
  continueOnError?: boolean;
  /** 订阅者名称，用于 debug 日志 */
  name?: string;
}

export interface MultiAgentOrchestrator {
  createDAG(goal: string, roles: AgentRole[]): Promise<AgentDAG>;
  executeDAG(dagId: string, mode: WorkflowMode): Promise<void>;
  pauseDAG(dagId: string): Promise<void>;
  cancelDAG(dagId: string): Promise<void>;
  getDAGStatus(dagId: string): Promise<AgentDAG>;
  subscribeToEvents(dagId: string, handler: DAGEventHandler): () => void;
  /**
   * 带优先级的事件订阅。
   * 同一事件可注册多个 handler，按 priority 升序执行。
   */
  subscribeWithPriority(dagId: string, subscription: DAGEventSubscription): () => void;
}
