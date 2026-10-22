export type StreamStopReason =
  'end_turn' | 'tool_use' | 'max_tokens' | 'error' | 'cancelled' | 'tool_permission';

export interface HandleStreamResult {
  errorSummary?: string;
  /**
   * 技术详情（上游错误码 / HTTP 状态 / 原始错误）。只给排障链路用 — 渠道侧写进
   * `CHANNEL_RUN_FAILED` 审计行的 `channelDetail`，不进 IM 回复正文。
   */
  errorDetail?: string;
  /** 上游错误码（如 `V2_TRANSIENT_5XX`），便于按错误类别检索审计行。 */
  errorCode?: string;
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
