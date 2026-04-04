export function relativeTime(dateStr: string): string {
  const diff = Date.now() - new Date(dateStr).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return '刚刚';
  if (mins < 60) return `${mins}分钟前`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}小时前`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}天前`;
  const weeks = Math.floor(days / 7);
  if (weeks < 5) return `${weeks}周前`;
  return `${Math.floor(days / 30)}个月前`;
}

export function statusLabel(s: string): string {
  if (s === 'idle') return '空闲';
  if (s === 'running') return '运行中';
  if (s === 'paused') return '已暂停';
  if (s === 'error') return '错误';
  return s;
}

export function statusDotColor(s: string): string {
  if (s === 'running') return '#22c55e';
  if (s === 'error') return 'var(--danger)';
  if (s === 'paused') return 'var(--warning)';
  return 'var(--accent)';
}

export function statusBadgeBg(s: string): string {
  if (s === 'running') return 'rgba(34,197,94,0.12)';
  if (s === 'error') return 'rgba(239,68,68,0.12)';
  if (s === 'paused') return 'rgba(245,158,11,0.12)';
  return 'var(--accent-muted)';
}

export function statusBadgeFg(s: string): string {
  if (s === 'running') return '#22c55e';
  if (s === 'error') return 'var(--danger)';
  if (s === 'paused') return 'var(--warning)';
  return 'var(--accent)';
}

export function isNestedInteractiveTarget(target: EventTarget | null): target is Element {
  return target instanceof Element && target.closest('button, input, textarea, select, a') !== null;
}
