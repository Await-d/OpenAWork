/**
 * Request id the gateway persists for a NON-final model round.
 *
 * Mirrors `createIntermediateAssistantRequestId` in
 * `services/agent-gateway/src/routes/stream-model-round.ts`: the gateway stamps
 * `${requestId}:assistant:${round}` on every assistant message produced by a
 * round that ended with `tool_use`, and keeps the raw request id for the final
 * (`end_turn`) round. Stamping the same value on the client's locally committed
 * round lets snapshot reconciliation match the two by strong identity instead
 * of heuristic text comparison.
 */
export function createRoundAssistantRequestId(clientRequestId: string, roundIndex: number): string {
  return `${clientRequestId}:assistant:${roundIndex}`;
}

/**
 * 从已落库的助手消息反推「下一轮该用哪个轮次号」。
 *
 * 为什么不能只看恢复快照的 `usage.round`：AskUserQuestion / 审批暂停时网关的
 * runtime thread 已被 `clearSessionRuntimeThread` 清掉，`/recovery` 返回的
 * `runEvents` 是空数组，`recoverActiveAssistantStream` 因此拿不到任何 `usage`，
 * 上层会沿用**上一拍的旧快照**（可能是若干轮之前）。按旧快照 `usage.round + 1`
 * 铸出的 `clientRequestId` 会与历史里已存在的某一轮**同键**，本地提交的那条就会
 * 在 `deduplicateOverlappingMessages` 里被当成同一回合，顶掉旧槽位 —— 表现为
 * 「同一批消息 id 的相对顺序变化」。
 *
 * 网关侧续跑用 `deriveResumeRound`（`stream-runtime.ts`）从 transcript 取
 * `max(n) + 1`，本地必须用同一套推导才不会比网关小。
 *
 * `fallbackRound`（通常是 `usage.round + 1`）只作为下界兜底：历史里一条中间轮都
 * 找不到时（首轮即暂停）沿用它。
 */
export function resolveNextAssistantRoundIndex(input: {
  clientRequestId: string;
  messages: readonly { clientRequestId?: string | undefined }[];
  fallbackRound: number;
}): number {
  const prefix = `${input.clientRequestId}:assistant:`;
  let maxHistoryRound = 0;
  for (const message of input.messages) {
    const value = message.clientRequestId;
    if (typeof value !== 'string' || !value.startsWith(prefix)) continue;
    const parsed = Number.parseInt(value.slice(prefix.length), 10);
    if (Number.isFinite(parsed) && parsed > maxHistoryRound) {
      maxHistoryRound = parsed;
    }
  }
  const fromHistory = maxHistoryRound > 0 ? maxHistoryRound + 1 : 0;
  return Math.max(fromHistory, input.fallbackRound, 1);
}
