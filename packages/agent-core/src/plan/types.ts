export type PlanStatus = 'drafting' | 'approved' | 'implementing' | 'completed' | 'rejected';

export type PlanStepStatus = 'pending' | 'running' | 'completed' | 'failed' | 'skipped';

export interface PlanStep {
  id: string;
  planId: string;
  index: number;
  title: string;
  description?: string;
  status: PlanStepStatus;
  startedAt?: number;
  completedAt?: number;
  errorMessage?: string;
}

export interface ToolCallRecord {
  id: string;
  sessionId: string;
  planId?: string;
  stepId?: string;
  toolName: string;
  input: unknown;
  output: unknown;
  isError: boolean;
  durationMs: number;
  calledAt: number;
}

export interface TaskPlan {
  id: string;
  sessionId: string;
  title: string;
  goal: string;
  steps: PlanStep[];
  status: PlanStatus;
  toolCallRecords: ToolCallRecord[];
  createdAt: number;
  updatedAt: number;
}

export type TaskPlanEvent =
  | { type: 'plan_created'; plan: TaskPlan }
  | { type: 'step_started'; planId: string; stepId: string }
  | { type: 'step_completed'; planId: string; stepId: string }
  | { type: 'step_failed'; planId: string; stepId: string; error: string }
  | { type: 'tool_called'; record: ToolCallRecord }
  | { type: 'plan_completed'; planId: string }
  | { type: 'plan_failed'; planId: string; error: string };

export type TaskPlanEventHandler = (event: TaskPlanEvent) => void;

export interface TaskPlanManager {
  create(
    sessionId: string,
    title: string,
    goal: string,
    steps: Omit<PlanStep, 'id' | 'planId' | 'status'>[],
  ): TaskPlan;
  get(planId: string): TaskPlan | undefined;
  listBySession(sessionId: string): TaskPlan[];
  updateStep(
    planId: string,
    stepId: string,
    patch: Partial<Pick<PlanStep, 'status' | 'startedAt' | 'completedAt' | 'errorMessage'>>,
  ): void;
  recordToolCall(record: Omit<ToolCallRecord, 'id'>): ToolCallRecord;
  subscribe(planId: string, handler: TaskPlanEventHandler): () => void;
  emit(planId: string, event: TaskPlanEvent): void;
}

export interface Plan {
  id: string;
  sessionId: string;
  title: string;
  status: PlanStatus;
  content?: string;
  specJson?: string;
  filePath?: string;
  createdAt: number;
  updatedAt: number;
}

export interface PlanManager {
  getPlanBySession(sessionId: string): Plan | undefined;
  getActivePlan(): Plan | undefined;
  list(): Plan[];
  createPlan(
    sessionId: string,
    title: string,
    options?: Partial<Pick<Plan, 'status' | 'content' | 'specJson'>>,
  ): Plan;
  updatePlan(planId: string, patch: Partial<Omit<Plan, 'id' | 'sessionId' | 'createdAt'>>): void;
  deletePlan(planId: string): void;
  approvePlan(planId: string): void;
  rejectPlan(planId: string): void;
  startImplementing(planId: string): void;
  completePlan(planId: string): void;
  setActivePlan(planId: string | null): void;
}
