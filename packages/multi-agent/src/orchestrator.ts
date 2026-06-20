import type {
  AgentRole,
  AgentDAG,
  DAGNode,
  DAGEvent,
  DAGEventHandler,
  DAGEventSubscription,
  WorkflowMode,
  MultiAgentOrchestrator,
} from './types.js';
import { DAGRunner } from './dag.js';
import { isSubAgentPrompt, buildSubAgentPrompt } from '@openAwork/agent-core';

export interface SubagentRequest {
  parentSessionId: string;
  role: AgentRole;
  task: string;
  context?: unknown;
}

export interface SubagentResult {
  nodeId: string;
  role: string;
  output: unknown;
  durationMs: number;
  error?: string;
}

type ApprovalDecision = 'Proceed' | 'Skip' | 'Cancel' | 'Timeout';

type NodeExecutor = (node: DAGNode, mode: WorkflowMode, signal: AbortSignal) => Promise<unknown>;

export class MultiAgentOrchestratorImpl implements MultiAgentOrchestrator {
  private runner = new DAGRunner();
  private pausedDags = new Set<string>();
  private cancelledDags = new Set<string>();
  private nodeExecutor: NodeExecutor;
  private pendingApprovals = new Map<string, (decision: ApprovalDecision) => void>();

  constructor(nodeExecutor?: NodeExecutor) {
    this.nodeExecutor = nodeExecutor ?? this.defaultExecutor.bind(this);
  }

  private async defaultExecutor(
    node: DAGNode,
    mode: WorkflowMode,
    _signal: AbortSignal,
  ): Promise<unknown> {
    return { nodeId: node.id, status: 'completed', output: node.input ?? null, mode };
  }

  async createDAG(goal: string, roles: AgentRole[]): Promise<AgentDAG> {
    const dagId = crypto.randomUUID();
    const nodes: DAGNode[] = [
      {
        id: crypto.randomUUID(),
        type: 'orchestrator',
        label: goal,
        status: 'pending',
      },
      ...roles.map((role) => ({
        id: crypto.randomUUID(),
        type: 'subagent' as const,
        agentRole: role,
        label: role.displayName,
        status: 'pending' as const,
      })),
    ];

    const orchestratorNode = nodes[0]!;
    const edges = nodes.slice(1).map((n) => ({
      id: crypto.randomUUID(),
      source: orchestratorNode.id,
      target: n.id,
      label: 'delegates',
      dataFlow: 'parallel' as const,
      dataType: 'context' as const,
    }));

    const dag: AgentDAG = {
      id: dagId,
      sessionId: crypto.randomUUID(),
      nodes,
      edges,
      status: 'pending',
      createdAt: Date.now(),
    };

    this.runner.store(dag);
    return dag;
  }

  async executeDAG(dagId: string, mode: WorkflowMode): Promise<void> {
    const dag = this.runner.get(dagId);
    if (!dag) throw new Error(`DAG ${dagId} not found`);

    dag.status = 'running';

    while (true) {
      if (this.cancelledDags.has(dagId)) {
        dag.status = 'failed';
        return;
      }

      if (this.pausedDags.has(dagId)) {
        await new Promise((r) => setTimeout(r, 200));
        continue;
      }

      const ready = this.runner.getReadyNodes(dagId);
      if (ready.length === 0) {
        const allDone = dag.nodes.every(
          (n) => n.status === 'completed' || n.status === 'skipped' || n.status === 'failed',
        );
        if (allDone) break;
        // No ready nodes and not all terminal: either work is genuinely
        // in-flight (it isn't — every batch is awaited below) or some pending
        // nodes are permanently blocked by a failed/not-taken upstream.
        // Resolve those to a terminal state so failure propagates instead of
        // spinning here forever. If nothing could be resolved, the DAG is
        // truly deadlocked (e.g. a cycle) — fail it rather than hang.
        const progressed = this.runner.resolveStuckNodes(dagId);
        if (!progressed) {
          dag.status = 'failed';
          dag.completedAt = Date.now();
          this.runner.emit(dagId, { type: 'dag_completed', result: dag, timestamp: Date.now() });
          return;
        }
        continue;
      }

      const execPromises = ready.map(async (node) => {
        if (mode === 'interactive' && node.type === 'subagent') {
          const event: DAGEvent = {
            type: 'human_approval_required',
            nodeId: node.id,
            plan: `Execute: ${node.label}`,
            options: ['Proceed', 'Skip', 'Cancel'],
            ...(typeof node.approvalTimeoutMs === 'number' && node.approvalTimeoutMs > 0
              ? { autoResolveMs: node.approvalTimeoutMs }
              : {}),
          };
          this.runner.emit(dagId, event);

          const decision = await this.waitForApproval(node.id, node.approvalTimeoutMs);
          if (decision === 'Skip') {
            this.runner.updateNodeStatus(dagId, node.id, 'skipped');
            return;
          }
          if (decision === 'Cancel') {
            this.cancelledDags.add(dagId);
            this.runner.updateNodeStatus(dagId, node.id, 'failed');
            this.runner.emit(dagId, {
              type: 'node_failed',
              nodeId: node.id,
              error: 'Cancelled by approval gate',
              timestamp: Date.now(),
            });
            return;
          }
          if (decision === 'Timeout') {
            this.runner.updateNodeStatus(dagId, node.id, 'failed');
            this.runner.emit(dagId, {
              type: 'node_failed',
              nodeId: node.id,
              error: `Approval timed out after ${node.approvalTimeoutMs}ms`,
              timestamp: Date.now(),
            });
            return;
          }
        }

        this.decorateNodeInput(node);
        const executor = (n: DAGNode, m: WorkflowMode, signal: AbortSignal) => {
          return this.nodeExecutor(n, m, signal);
        };

        await this.runner.executeWithRetry(dagId, node, mode, executor);
      });

      await Promise.allSettled(execPromises);
    }

    const anyFailed = dag.nodes.some((n) => n.status === 'failed');
    dag.status = anyFailed ? 'failed' : 'completed';
    dag.completedAt = Date.now();

    this.runner.emit(dagId, { type: 'dag_completed', result: dag, timestamp: Date.now() });
  }

  async pauseDAG(dagId: string): Promise<void> {
    this.pausedDags.add(dagId);
  }

  async cancelDAG(dagId: string): Promise<void> {
    this.pausedDags.delete(dagId);
    this.cancelledDags.add(dagId);
    // Unblock any interactive approval gate still awaiting input for this
    // DAG. A node parked at `waitForApproval` with no `autoResolveMs` never
    // settles on its own, so `executeDAG`'s `Promise.allSettled` would never
    // return and the top-of-loop `cancelledDags` check is unreachable — the
    // DAG would hang forever despite being "cancelled". Resolving the pending
    // approval(s) with `Cancel` lets the in-flight batch settle so the loop
    // observes the cancellation and transitions to `failed`.
    const dag = this.runner.get(dagId);
    if (dag) {
      for (const node of dag.nodes) {
        const resolver = this.pendingApprovals.get(node.id);
        if (resolver) {
          this.pendingApprovals.delete(node.id);
          resolver('Cancel');
        }
      }
    }
  }

  async getDAGStatus(dagId: string): Promise<AgentDAG> {
    const dag = this.runner.get(dagId);
    if (!dag) throw new Error(`DAG ${dagId} not found`);
    return dag;
  }

  subscribeToEvents(dagId: string, handler: DAGEventHandler): () => void {
    return this.runner.subscribe(dagId, handler);
  }

  subscribeWithPriority(dagId: string, subscription: DAGEventSubscription): () => void {
    return this.runner.subscribeWithPriority(dagId, subscription);
  }

  resumeDAG(dagId: string): void {
    this.pausedDags.delete(dagId);
  }

  resolveApproval(nodeId: string, decision: Exclude<ApprovalDecision, 'Timeout'>): void {
    const resolver = this.pendingApprovals.get(nodeId);
    if (!resolver) {
      return;
    }
    this.pendingApprovals.delete(nodeId);
    resolver(decision);
  }

  async delegateToSubagent(request: SubagentRequest): Promise<SubagentResult> {
    const startAt = Date.now();
    const nodeId = crypto.randomUUID();
    try {
      const prompt = buildSubAgentPrompt(request.role.displayName, request.task);
      void isSubAgentPrompt(prompt);
      const node: DAGNode = {
        id: nodeId,
        type: 'subagent',
        agentRole: request.role,
        label: request.task,
        status: 'running',
        input: {
          context: request.context,
          prompt,
        },
      };
      const output = await this.nodeExecutor(node, 'delegated', new AbortController().signal);
      return { nodeId, role: request.role.id, output, durationMs: Date.now() - startAt };
    } catch (err) {
      return {
        nodeId,
        role: request.role.id,
        output: null,
        durationMs: Date.now() - startAt,
        error: err instanceof Error ? err.message : String(err),
      };
    }
  }

  private waitForApproval(nodeId: string, autoResolveMs?: number): Promise<ApprovalDecision> {
    return new Promise((resolve) => {
      let timer: ReturnType<typeof setTimeout> | undefined;
      const wrappedResolve = (decision: ApprovalDecision) => {
        if (timer) {
          clearTimeout(timer);
        }
        this.pendingApprovals.delete(nodeId);
        resolve(decision);
      };

      this.pendingApprovals.set(nodeId, wrappedResolve);
      if (
        typeof autoResolveMs === 'number' &&
        Number.isFinite(autoResolveMs) &&
        autoResolveMs > 0
      ) {
        timer = setTimeout(() => {
          wrappedResolve('Timeout');
        }, autoResolveMs);
      }
    });
  }

  private decorateNodeInput(node: DAGNode): void {
    if (!node.agentRole) {
      return;
    }
    const prompt = buildSubAgentPrompt(node.agentRole.displayName, node.label);
    node.input = {
      context: node.input,
      prompt,
    };
  }
}

export { isSubAgentPrompt, buildSubAgentPrompt };
