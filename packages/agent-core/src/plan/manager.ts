import type { Plan, PlanManager, PlanStatus } from './types.js';

function generateId(): string {
  return Math.random().toString(36).slice(2) + Date.now().toString(36);
}

function assertStatus(plan: Plan, expected: PlanStatus | PlanStatus[], action: string): void {
  const allowed = Array.isArray(expected) ? expected : [expected];
  if (!allowed.includes(plan.status)) {
    throw new Error(
      `Cannot ${action} plan "${plan.id}": expected status ${allowed.join(' or ')}, got "${plan.status}"`,
    );
  }
}

export class PlanManagerImpl implements PlanManager {
  private plans: Map<string, Plan> = new Map();
  private activePlanId: string | null = null;

  getPlanBySession(sessionId: string): Plan | undefined {
    for (const plan of this.plans.values()) {
      if (plan.sessionId === sessionId) return plan;
    }
    return undefined;
  }

  getActivePlan(): Plan | undefined {
    if (this.activePlanId === null) return undefined;
    return this.plans.get(this.activePlanId);
  }

  list(): Plan[] {
    return Array.from(this.plans.values());
  }

  createPlan(
    sessionId: string,
    title: string,
    options?: Partial<Pick<Plan, 'status' | 'content' | 'specJson'>>,
  ): Plan {
    const now = Date.now();
    const plan: Plan = {
      id: generateId(),
      sessionId,
      title,
      status: options?.status ?? 'drafting',
      content: options?.content,
      specJson: options?.specJson,
      createdAt: now,
      updatedAt: now,
    };
    this.plans.set(plan.id, plan);
    return plan;
  }

  updatePlan(planId: string, patch: Partial<Omit<Plan, 'id' | 'sessionId' | 'createdAt'>>): void {
    const plan = this.plans.get(planId);
    if (!plan) throw new Error(`Plan not found: ${planId}`);
    Object.assign(plan, patch, { updatedAt: Date.now() });
  }

  deletePlan(planId: string): void {
    if (!this.plans.has(planId)) throw new Error(`Plan not found: ${planId}`);
    this.plans.delete(planId);
    if (this.activePlanId === planId) this.activePlanId = null;
  }

  approvePlan(planId: string): void {
    const plan = this.plans.get(planId);
    if (!plan) throw new Error(`Plan not found: ${planId}`);
    assertStatus(plan, 'drafting', 'approve');
    plan.status = 'approved';
    plan.updatedAt = Date.now();
  }

  rejectPlan(planId: string): void {
    const plan = this.plans.get(planId);
    if (!plan) throw new Error(`Plan not found: ${planId}`);
    assertStatus(plan, ['drafting', 'approved'], 'reject');
    plan.status = 'rejected';
    plan.updatedAt = Date.now();
  }

  startImplementing(planId: string): void {
    const plan = this.plans.get(planId);
    if (!plan) throw new Error(`Plan not found: ${planId}`);
    assertStatus(plan, 'approved', 'start implementing');
    plan.status = 'implementing';
    plan.updatedAt = Date.now();
  }

  completePlan(planId: string): void {
    const plan = this.plans.get(planId);
    if (!plan) throw new Error(`Plan not found: ${planId}`);
    assertStatus(plan, 'implementing', 'complete');
    plan.status = 'completed';
    plan.updatedAt = Date.now();
  }

  setActivePlan(planId: string | null): void {
    if (planId !== null && !this.plans.has(planId)) {
      throw new Error(`Plan not found: ${planId}`);
    }
    this.activePlanId = planId;
  }
}
