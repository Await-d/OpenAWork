import type {
  AgentDAG,
  DAGNode,
  DAGEdge,
  DAGEvent,
  DAGEventHandler,
  DAGEventSubscription,
  WorkflowMode,
  RetryPolicy,
  FailureEscalationRecord,
  RootCauseAnalysis,
  DAGNodeStatus,
} from './types.js';
import {
  checkHallucination,
  diagnoseNodeIssues,
  isRetryBudgetExhausted,
} from './hallucination-checker.js';

const DEFAULT_RETRY_POLICY: RetryPolicy = {
  maxRetries: 1,
  backoffMs: 1000,
  escalateOnExhaustion: true,
};

export class DAGRunner {
  private dags = new Map<string, AgentDAG>();
  private eventHandlers = new Map<string, DAGEventSubscription[]>();

  store(dag: AgentDAG): void {
    this.dags.set(dag.id, dag);
  }

  get(dagId: string): AgentDAG | undefined {
    return this.dags.get(dagId);
  }

  subscribe(dagId: string, handler: DAGEventHandler): () => void {
    return this.subscribeWithPriority(dagId, { handler });
  }

  subscribeWithPriority(dagId: string, subscription: DAGEventSubscription): () => void {
    if (!this.eventHandlers.has(dagId)) {
      this.eventHandlers.set(dagId, []);
    }
    this.eventHandlers.get(dagId)!.push(subscription);
    // 按 priority 升序排序（默认 priority=0）
    this.eventHandlers.get(dagId)!.sort((a, b) => (a.priority ?? 0) - (b.priority ?? 0));
    return () => {
      const list = this.eventHandlers.get(dagId);
      if (!list) return;
      const idx = list.indexOf(subscription);
      if (idx >= 0) list.splice(idx, 1);
    };
  }

  emit(dagId: string, event: DAGEvent): void {
    const subscriptions = this.eventHandlers.get(dagId);
    if (!subscriptions || subscriptions.length === 0) {
      return;
    }
    // Per-subscriber fault isolation with priority ordering (spec-kit v0.10.0):
    // handlers execute in priority order. A throwing handler with
    // continueOnError=true (default) is isolated and doesn't block subsequent
    // handlers. Only when continueOnError=false does the error propagate.
    // Snapshot the array so a handler that unsubscribes itself mid-dispatch
    // can't shift iteration.
    for (const subscription of [...subscriptions]) {
      try {
        subscription.handler(event);
      } catch (err) {
        const handlerName = subscription.name ?? 'anonymous';
        if (subscription.continueOnError === false) {
          // Re-throw: caller explicitly opted out of fault isolation
          throw err;
        }
        console.warn(
          `[multi-agent] DAG event handler "${handlerName}" threw, isolating: ${
            err instanceof Error ? err.message : String(err)
          }`,
        );
      }
    }
  }

  updateNodeStatus(dagId: string, nodeId: string, status: DAGNodeStatus, output?: unknown): void {
    const dag = this.dags.get(dagId);
    if (!dag) return;
    const node = dag.nodes.find((n) => n.id === nodeId);
    if (!node) return;
    node.status = status;
    if (output !== undefined) node.output = output;
    if (status === 'running') node.startedAt = Date.now();
    if (status === 'completed' || status === 'failed') {
      node.completedAt = Date.now();
      node.durationMs = node.startedAt ? node.completedAt - node.startedAt : undefined;
    }
  }

  getReadyNodes(dagId: string): DAGNode[] {
    const dag = this.dags.get(dagId);
    if (!dag) return [];

    return dag.nodes.filter((node) => {
      if (node.status !== 'pending') return false;
      const incomingEdges = dag.edges.filter((edge) => edge.target === node.id);
      const depsSatisfied = incomingEdges.every((edge) => this.isEdgeSatisfied(dag, edge));
      if (!depsSatisfied) return false;
      return this.isSequentiallyReleased(dag, incomingEdges);
    });
  }

  /**
   * Resolve pending nodes that can never become ready to a terminal state.
   *
   * The executor awaits every dispatched batch (`Promise.allSettled`), so at
   * the point this is called no node is mid-flight. Any pending node whose
   * incoming-edge sources are all terminal (completed / failed / skipped) yet
   * still isn't ready is permanently blocked — without resolving it the
   * executor's "no ready nodes but not all done" branch would spin forever.
   *
   * Classification:
   * - blocked by a `failed` (or missing) upstream → mark `failed`, so the
   *   failure propagates down the dependency chain and the DAG ends `failed`.
   * - blocked only because a conditional branch wasn't taken (all upstreams
   *   succeeded) → mark `skipped`, so a not-taken branch doesn't fail the DAG.
   *
   * Runs to a fixpoint so a freshly-failed node cascades to its descendants
   * within a single call. Returns true if any node changed.
   */
  resolveStuckNodes(dagId: string): boolean {
    const dag = this.dags.get(dagId);
    if (!dag) return false;

    let changedAny = false;
    let changedThisPass = true;
    while (changedThisPass) {
      changedThisPass = false;
      const readyIds = new Set(this.getReadyNodes(dagId).map((node) => node.id));
      for (const node of dag.nodes) {
        if (node.status !== 'pending') continue;
        if (readyIds.has(node.id)) continue;

        const incomingEdges = dag.edges.filter((edge) => edge.target === node.id);
        const allSourcesTerminal = incomingEdges.every((edge) => {
          const source = dag.nodes.find((candidate) => candidate.id === edge.source);
          return (
            !source ||
            source.status === 'completed' ||
            source.status === 'failed' ||
            source.status === 'skipped'
          );
        });
        // A non-terminal upstream may still unblock this node; leave it pending.
        if (!allSourcesTerminal) continue;

        const failedUpstream = incomingEdges.some((edge) => {
          const source = dag.nodes.find((candidate) => candidate.id === edge.source);
          return !source || source.status === 'failed';
        });
        const nextStatus: DAGNodeStatus = failedUpstream ? 'failed' : 'skipped';
        this.updateNodeStatus(dagId, node.id, nextStatus);
        if (nextStatus === 'failed') {
          this.emit(dagId, {
            type: 'node_failed',
            nodeId: node.id,
            error: 'Upstream dependency failed; node could not run',
            timestamp: Date.now(),
            ...toRuntimeRoleMetadata(node),
          });
        }
        changedThisPass = true;
        changedAny = true;
      }
    }
    return changedAny;
  }

  async executeWithRetry(
    dagId: string,
    node: DAGNode,
    mode: WorkflowMode,
    executor: (node: DAGNode, mode: WorkflowMode, signal: AbortSignal) => Promise<unknown>,
  ): Promise<void> {
    const policy = node.retryPolicy ?? DEFAULT_RETRY_POLICY;
    let attempt = 0;

    const tryExecute = async (): Promise<void> => {
      try {
        this.emitActivatedEdges(dagId, node.id);
        this.updateNodeStatus(dagId, node.id, 'running');
        this.emit(dagId, {
          type: 'node_started',
          nodeId: node.id,
          timestamp: Date.now(),
          ...toRuntimeRoleMetadata(node),
        });

        const output = await executeNodeWithTimeout(node, (signal) => executor(node, mode, signal));

        // 临时设置 output 以供幻觉检测器读取
        const previousOutput = node.output;
        node.output = output;

        // 幻觉检测门禁 — 验证节点输出是否真实（参考 hermes-agent v0.13.0）
        const hallucinationResult = checkHallucination(node);
        node.hallucinationCheck = hallucinationResult;

        if (!hallucinationResult.passed && !isRetryBudgetExhausted(node)) {
          // 检测到幻觉且重试预算未耗尽 → 恢复旧 output，标记为失败并重试
          node.output = previousOutput;
          this.emit(dagId, {
            type: 'hallucination_detected',
            nodeId: node.id,
            issues: hallucinationResult.issues.map((i) => ({ type: i.type, detail: i.detail })),
            timestamp: Date.now(),
          });
          throw new Error(
            `Hallucination detected: ${hallucinationResult.issues.map((i) => i.detail).join('; ')}`,
          );
        }

        // 诊断引擎：检查异常模式
        const diagnosticAlerts = diagnoseNodeIssues(node);
        for (const alert of diagnosticAlerts) {
          this.emit(dagId, {
            type: 'diagnostic_alert',
            nodeId: node.id,
            pattern: alert.pattern,
            detail: alert.detail,
            timestamp: Date.now(),
          });
        }

        this.updateNodeStatus(dagId, node.id, 'completed', output);
        this.emit(dagId, {
          type: 'node_completed',
          nodeId: node.id,
          output,
          timestamp: Date.now(),
          ...toRuntimeRoleMetadata(node),
        });
      } catch (err) {
        const error = err instanceof Error ? err.message : String(err);
        attempt++;

        const record: FailureEscalationRecord = {
          attempt,
          error,
          timestamp: Date.now(),
        };

        if (!node.failureEscalationLog) node.failureEscalationLog = [];
        node.failureEscalationLog.push(record);

        if (attempt <= policy.maxRetries) {
          await new Promise((r) => setTimeout(r, policy.backoffMs * Math.pow(2, attempt - 1)));
          await tryExecute();
          return;
        }

        if (policy.escalateOnExhaustion) {
          const rca = analyzeFailure(node, error);
          record.rootCauseAnalysis = rca;

          if (rca.requiresHuman) {
            this.emit(dagId, {
              type: 'risk_escalation',
              nodeId: node.id,
              riskDetail: `${rca.category}: ${rca.whyRetryFailed}`,
              suggestedAction: rca.fixSuggestion,
            });
          }
        }

        this.updateNodeStatus(dagId, node.id, 'failed');
        this.emit(dagId, {
          type: 'node_failed',
          nodeId: node.id,
          error,
          timestamp: Date.now(),
          ...toRuntimeRoleMetadata(node),
        });
      }
    };

    await tryExecute();
  }

  private emitActivatedEdges(dagId: string, nodeId: string): void {
    const dag = this.dags.get(dagId);
    if (!dag) {
      return;
    }
    for (const edge of dag.edges.filter((item) => item.target === nodeId)) {
      this.emit(dagId, {
        type: 'edge_activated',
        edgeId: edge.id,
        timestamp: Date.now(),
      });
    }
  }

  private isEdgeSatisfied(dag: AgentDAG, edge: DAGEdge): boolean {
    const sourceNode = dag.nodes.find((node) => node.id === edge.source);
    if (!sourceNode) {
      return false;
    }
    const sourceDone = sourceNode.status === 'completed' || sourceNode.status === 'skipped';
    if (!sourceDone) {
      return false;
    }
    if (edge.dataFlow !== 'conditional') {
      return true;
    }
    return this.matchesConditionalEdge(sourceNode.output, edge.label);
  }

  private isSequentiallyReleased(dag: AgentDAG, incomingEdges: DAGEdge[]): boolean {
    for (const edge of incomingEdges) {
      if (edge.dataFlow !== 'sequential') {
        continue;
      }
      const sequentialEdges = dag.edges.filter(
        (item) => item.source === edge.source && item.dataFlow === 'sequential',
      );
      const currentIndex = sequentialEdges.findIndex((item) => item.id === edge.id);
      if (currentIndex <= 0) {
        continue;
      }
      const earlierEdges = sequentialEdges.slice(0, currentIndex);
      const blocked = earlierEdges.some((earlierEdge) => {
        const earlierTarget = dag.nodes.find((node) => node.id === earlierEdge.target);
        return earlierTarget?.status !== 'completed' && earlierTarget?.status !== 'skipped';
      });
      if (blocked) {
        return false;
      }
    }
    return true;
  }

  private matchesConditionalEdge(output: unknown, label?: string): boolean {
    if (!label) {
      return Boolean(output);
    }
    if (typeof output === 'object' && output !== null && 'branch' in output) {
      return (output as { branch?: unknown }).branch === label;
    }
    if (typeof output === 'string') {
      return output === label;
    }
    if (typeof output === 'boolean') {
      return String(output) === label;
    }
    return false;
  }
}

async function executeNodeWithTimeout(
  node: DAGNode,
  executor: (signal: AbortSignal) => Promise<unknown>,
): Promise<unknown> {
  const controller = new AbortController();
  if (
    typeof node.executionTimeoutMs !== 'number' ||
    !Number.isFinite(node.executionTimeoutMs) ||
    node.executionTimeoutMs <= 0
  ) {
    return executor(controller.signal);
  }

  let timeoutHandle: ReturnType<typeof setTimeout> | undefined;
  try {
    const timeoutError = new Error(
      `Node execution timed out after ${Math.floor(node.executionTimeoutMs)}ms`,
    );
    return await Promise.race([
      executor(controller.signal),
      new Promise<never>((_, reject) => {
        timeoutHandle = setTimeout(() => {
          controller.abort(timeoutError);
          reject(timeoutError);
        }, node.executionTimeoutMs);
      }),
    ]);
  } finally {
    if (timeoutHandle) {
      clearTimeout(timeoutHandle);
    }
  }
}

function toRuntimeRoleMetadata(node: DAGNode) {
  return {
    agentRoleId: node.agentRole?.id,
    canonicalRole: node.agentRole?.canonicalRole,
  };
}

function analyzeFailure(node: DAGNode, error: string): RootCauseAnalysis {
  const lower = error.toLowerCase();
  let category: RootCauseAnalysis['category'] = 'logic_error';

  if (/network|econnrefused|timeout|enotfound/.test(lower)) category = 'env_issue';
  else if (/not found|missing|undefined|null/.test(lower)) category = 'missing_dependency';
  else if (/invalid|schema|parse|format/.test(lower)) category = 'input_format';
  else if (/context|token|length/.test(lower)) category = 'model_capability';

  return {
    category,
    whyRetryFailed: `All ${node.retryPolicy?.maxRetries ?? 1} retries failed with: ${error}`,
    affectedNodes: [node.id],
    fixSuggestion: getSuggestion(category),
    requiresHuman: category === 'missing_dependency' || category === 'model_capability',
  };
}

function getSuggestion(category: RootCauseAnalysis['category']): string {
  const suggestions: Record<RootCauseAnalysis['category'], string> = {
    logic_error: 'Review the task description for ambiguity and rephrase',
    missing_dependency: 'Check required tools, permissions, or data are available',
    env_issue: 'Check network connectivity and service availability',
    input_format: 'Verify the input format matches the expected schema',
    model_capability: 'Consider breaking the task into smaller subtasks',
  };
  return suggestions[category];
}

export type {
  AgentDAG,
  DAGNode,
  DAGEdge,
  DAGEvent,
  DAGEventHandler,
  DAGEventSubscription,
  WorkflowMode,
  RetryPolicy,
  FailureEscalationRecord,
  RootCauseAnalysis,
};
