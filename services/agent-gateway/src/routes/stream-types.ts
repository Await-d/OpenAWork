export type StreamStopReason =
  | 'end_turn'
  | 'tool_use'
  | 'max_tokens'
  | 'error'
  | 'cancelled'
  | 'tool_permission';

export interface HandleStreamResult {
  errorSummary?: string;
  statusCode: number;
  stopReason?: StreamStopReason;
}

export function toStreamStopReason(value: string): StreamStopReason | undefined {
  return value === 'end_turn' ||
    value === 'tool_use' ||
    value === 'max_tokens' ||
    value === 'error' ||
    value === 'cancelled' ||
    value === 'tool_permission'
    ? value
    : undefined;
}
