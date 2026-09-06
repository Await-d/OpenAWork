/** A planning rejection is terminal for this attempt, including watcher fallback paths. */
export class PlanningFailure extends Error {
  constructor(reason: string) {
    super(`planning-generation-failed: ${reason}；需要用户介入`);
    this.name = 'PlanningFailure';
  }
}

export function nextPlanningRound(payload: unknown, retryCount: number): number {
  const values: unknown[] = [retryCount];
  if (typeof payload === 'object' && payload !== null) {
    if ('globalEscalationRound' in payload) values.push(payload.globalEscalationRound);
    if ('escalationRound' in payload) values.push(payload.escalationRound);
  }
  return (
    Math.max(
      0,
      ...values.map((value) =>
        typeof value === 'number' && Number.isFinite(value) ? Math.max(0, Math.floor(value)) : 0,
      ),
    ) + 1
  );
}
