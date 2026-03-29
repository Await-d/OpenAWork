import type {
  TaskPlan,
  TaskPlanManager,
  TaskPlanEvent,
  TaskPlanEventHandler,
  PlanStep,
  ToolCallRecord,
} from './types.js';

export class TaskPlanManagerImpl implements TaskPlanManager {
  private plans = new Map<string, TaskPlan>();
  private handlers = new Map<string, Set<TaskPlanEventHandler>>();

  create(
    sessionId: string,
    title: string,
    goal: string,
    steps: Omit<PlanStep, 'id' | 'planId' | 'status'>[],
  ): TaskPlan {
    const planId = crypto.randomUUID();
    const now = Date.now();
    const planSteps: PlanStep[] = steps.map((s, i) => ({
      ...s,
      id: crypto.randomUUID(),
      planId,
      index: i,
      status: 'pending',
    }));
    const plan: TaskPlan = {
      id: planId,
      sessionId,
      title,
      goal,
      steps: planSteps,
      status: 'drafting',
      toolCallRecords: [],
      createdAt: now,
      updatedAt: now,
    };
    this.plans.set(planId, plan);
    this.emit(planId, { type: 'plan_created', plan });
    return plan;
  }

  get(planId: string): TaskPlan | undefined {
    return this.plans.get(planId);
  }

  listBySession(sessionId: string): TaskPlan[] {
    return [...this.plans.values()].filter((p) => p.sessionId === sessionId);
  }

  updateStep(
    planId: string,
    stepId: string,
    patch: Partial<Pick<PlanStep, 'status' | 'startedAt' | 'completedAt' | 'errorMessage'>>,
  ): void {
    const plan = this.plans.get(planId);
    if (!plan) return;
    const step = plan.steps.find((s) => s.id === stepId);
    if (!step) return;
    Object.assign(step, patch);
    plan.updatedAt = Date.now();
    if (patch.status === 'running') {
      this.emit(planId, { type: 'step_started', planId, stepId });
    } else if (patch.status === 'completed') {
      this.emit(planId, { type: 'step_completed', planId, stepId });
    } else if (patch.status === 'failed') {
      this.emit(planId, { type: 'step_failed', planId, stepId, error: patch.errorMessage ?? '' });
    }
  }

  recordToolCall(record: Omit<ToolCallRecord, 'id'>): ToolCallRecord {
    const full: ToolCallRecord = { ...record, id: crypto.randomUUID() };
    if (record.planId) {
      const plan = this.plans.get(record.planId);
      if (plan) {
        plan.toolCallRecords.push(full);
        plan.updatedAt = Date.now();
      }
    }
    if (record.planId) {
      this.emit(record.planId, { type: 'tool_called', record: full });
    }
    return full;
  }

  subscribe(planId: string, handler: TaskPlanEventHandler): () => void {
    if (!this.handlers.has(planId)) this.handlers.set(planId, new Set());
    this.handlers.get(planId)!.add(handler);
    return () => this.handlers.get(planId)?.delete(handler);
  }

  emit(planId: string, event: TaskPlanEvent): void {
    const hs = this.handlers.get(planId);
    if (hs) for (const h of hs) h(event);
  }
}
