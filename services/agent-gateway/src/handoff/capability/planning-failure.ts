/** A planning rejection is terminal for this attempt, including watcher fallback paths. */
export class PlanningFailure extends Error {
  constructor(reason: string) {
    super(`planning-generation-failed: ${reason}；需要用户介入`);
    this.name = 'PlanningFailure';
  }
}

/**
 * 把 `planning-generation-failed: <原因>；需要用户介入` 还原成给用户看的纯原因：剥掉内部
 * 前缀与固定尾注。直接把内部串贴进对话会让用户看不懂该做什么。
 */
export function humanizePlanningFailureReason(reason: string): string {
  const stripped = reason
    .replace(/^planning-generation-failed:\s*/, '')
    .replace(/；?需要用户介入\s*$/, '')
    .trim();
  return stripped.length > 0 ? stripped : reason;
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
