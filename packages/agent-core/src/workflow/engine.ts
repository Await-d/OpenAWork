import type {
  WorkflowEdge,
  WorkflowExecution,
  WorkflowNode,
  WorkflowTemplate,
  WorkflowTemplateManager,
} from './types.js';

export interface WorkflowEngine {
  execute(templateId: string, variables: Record<string, unknown>): Promise<WorkflowExecution>;
  getExecution(id: string): WorkflowExecution | undefined;
}

function generateId(): string {
  return Math.random().toString(36).slice(2) + Date.now().toString(36);
}

function evaluateExpression(
  expression: string,
  variables: Record<string, unknown>,
  condition: boolean,
): boolean {
  // eslint-disable-next-line @typescript-eslint/no-implied-eval
  const evaluator = new Function(
    'variables',
    'condition',
    `return Boolean((() => (${expression}))());`,
  ) as (variables: Record<string, unknown>, condition: boolean) => boolean;
  return evaluator(variables, condition);
}

function topologicalSort(nodes: WorkflowNode[], edges: WorkflowEdge[]): WorkflowNode[] {
  const nodeById = new Map(nodes.map((node) => [node.id, node]));
  const indegree = new Map<string, number>(nodes.map((node) => [node.id, 0]));
  const outgoing = new Map<string, string[]>();

  for (const edge of edges) {
    if (!nodeById.has(edge.source) || !nodeById.has(edge.target)) {
      continue;
    }
    indegree.set(edge.target, (indegree.get(edge.target) ?? 0) + 1);
    const list = outgoing.get(edge.source) ?? [];
    list.push(edge.target);
    outgoing.set(edge.source, list);
  }

  const queue: string[] = [];
  for (const [id, value] of indegree) {
    if (value === 0) {
      queue.push(id);
    }
  }

  const sorted: WorkflowNode[] = [];
  while (queue.length > 0) {
    const current = queue.shift();
    if (!current) {
      continue;
    }
    const node = nodeById.get(current);
    if (!node) {
      continue;
    }
    sorted.push(node);

    const next = outgoing.get(current) ?? [];
    for (const target of next) {
      const nextIndegree = (indegree.get(target) ?? 0) - 1;
      indegree.set(target, nextIndegree);
      if (nextIndegree === 0) {
        queue.push(target);
      }
    }
  }

  if (sorted.length !== nodes.length) {
    throw new Error('Workflow graph contains a cycle');
  }

  return sorted;
}

function getInitialActiveNodes(template: WorkflowTemplate): Set<string> {
  const indegree = new Map<string, number>(template.nodes.map((node) => [node.id, 0]));
  for (const edge of template.edges) {
    indegree.set(edge.target, (indegree.get(edge.target) ?? 0) + 1);
  }

  const starts = template.nodes.filter(
    (node) => node.type === 'start' || (indegree.get(node.id) ?? 0) === 0,
  );
  if (starts.length === 0 && template.nodes.length > 0) {
    const firstNode = template.nodes[0];
    if (firstNode) {
      return new Set([firstNode.id]);
    }
  }
  return new Set(starts.map((node) => node.id));
}

export class WorkflowEngineImpl implements WorkflowEngine {
  private executions = new Map<string, WorkflowExecution>();

  constructor(private readonly templateManager: WorkflowTemplateManager) {}

  async execute(
    templateId: string,
    variables: Record<string, unknown>,
  ): Promise<WorkflowExecution> {
    const template = this.templateManager.get(templateId);
    if (!template) {
      throw new Error(`Workflow template not found: ${templateId}`);
    }

    const execution: WorkflowExecution = {
      id: generateId(),
      templateId,
      status: 'pending',
      variables: { ...variables },
      startedAt: Date.now(),
    };
    this.executions.set(execution.id, execution);

    try {
      execution.status = 'running';
      const order = topologicalSort(template.nodes, template.edges);
      const activeNodes = getInitialActiveNodes(template);
      const outgoingBySource = new Map<string, WorkflowEdge[]>();
      for (const edge of template.edges) {
        const list = outgoingBySource.get(edge.source) ?? [];
        list.push(edge);
        outgoingBySource.set(edge.source, list);
      }

      for (const node of order) {
        if (!activeNodes.has(node.id)) {
          continue;
        }

        let conditionResult = true;
        if (node.type === 'condition') {
          const expression = node.config.expression;
          if (typeof expression === 'string') {
            conditionResult = evaluateExpression(expression, execution.variables, true);
          } else {
            conditionResult = false;
          }
          execution.variables[node.id] = conditionResult;
        }

        const outgoing = outgoingBySource.get(node.id) ?? [];
        for (const edge of outgoing) {
          let shouldActivate = true;
          if (node.type === 'condition') {
            if (edge.condition) {
              shouldActivate = evaluateExpression(
                edge.condition,
                execution.variables,
                conditionResult,
              );
            } else {
              shouldActivate = conditionResult;
            }
          } else if (edge.condition) {
            shouldActivate = evaluateExpression(edge.condition, execution.variables, true);
          }

          if (shouldActivate) {
            activeNodes.add(edge.target);
          }
        }
      }

      execution.status = 'completed';
      execution.completedAt = Date.now();
      return execution;
    } catch (error) {
      execution.status = 'failed';
      execution.completedAt = Date.now();
      execution.error = error instanceof Error ? error.message : String(error);
      return execution;
    }
  }

  getExecution(id: string): WorkflowExecution | undefined {
    return this.executions.get(id);
  }
}
