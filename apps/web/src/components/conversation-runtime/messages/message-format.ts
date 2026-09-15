export function formatShortTime(value: number | string | undefined): string | null {
  if (value === undefined) return null;
  const date = typeof value === 'number' ? new Date(value) : new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

export function formatDurationLabel(durationMs: number | undefined): string | null {
  if (!durationMs || durationMs <= 0) return null;
  if (durationMs < 1000) return `${durationMs}ms`;
  const seconds = durationMs / 1000;
  return seconds < 10 ? `${seconds.toFixed(1)}s` : `${Math.round(seconds)}s`;
}

export function formatStopReasonLabel(stopReason: string | undefined): string | null {
  if (!stopReason) return null;
  if (stopReason === 'end_turn') return '完成';
  if (stopReason === 'tool_use') return '调用工具';
  if (stopReason === 'max_tokens') return '达到上限';
  if (stopReason === 'error') return '错误';
  if (stopReason === 'cancelled') return '已停止';
  return stopReason;
}
