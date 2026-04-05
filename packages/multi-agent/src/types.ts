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
  | { type: 'risk_escalation'; nodeId: string; riskDetail: string; suggestedAction: string };

export type DAGEventHandler = (event: DAGEvent) => void;

export interface MultiAgentOrchestrator {
  createDAG(goal: string, roles: AgentRole[]): Promise<AgentDAG>;
  executeDAG(dagId: string, mode: WorkflowMode): Promise<void>;
  pauseDAG(dagId: string): Promise<void>;
  cancelDAG(dagId: string): Promise<void>;
  getDAGStatus(dagId: string): Promise<AgentDAG>;
  subscribeToEvents(dagId: string, handler: DAGEventHandler): () => void;
}
