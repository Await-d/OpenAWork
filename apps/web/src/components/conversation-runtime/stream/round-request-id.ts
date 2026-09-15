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
