/**
 * 会话扩展两个页面（面板 / 确认）共用的展示常量与样式。
 *
 * 为什么抽出来：面板与确认页此前各自复制了一份 `Phase`、`STATUS_LABELS`、
 * `formatTime`，改一处状态文案要记得改两处。`apps/web/AGENTS.md` 的组件提取原则
 * 要求页面保持轻量、共享渲染放组件/hook——这里只放**纯数据**，不放 JSX。
 *
 * 样式按**页面变体**分两套而不是强行统一：面板是「文档式」长页，确认页是
 * 「居中的单卡片对话框」，两者视觉基线本就不同，合并会改变观感（属行为变更）。
 */

export type SessionExtensionPhase = 'loading' | 'ready' | 'unauthenticated' | 'not-found' | 'error';

/** 操作状态 → 中文。网关返回的 `status` 是唯一真相，这里只做展示映射。 */
export const STATUS_LABELS: Record<string, string> = {
  pending_approval: '待确认',
  approved: '已确认（等待执行）',
  applying: '执行中',
  succeeded: '已生效',
  configured_unavailable: '配置已保存但不可用',
  failed: '失败',
  rejected: '已拒绝',
  expired: '已过期',
  cancelled: '已取消',
};

export function statusLabel(status: string): string {
  return STATUS_LABELS[status] ?? status;
}

/** 未知状态的配色兜底成 warning，不隐藏也不谎报成功。 */
export function statusColor(status: string): string {
  if (status === 'succeeded') return 'var(--success, var(--accent))';
  if (status === 'configured_unavailable' || status === 'failed') return 'var(--danger)';
  if (status === 'rejected' || status === 'expired' || status === 'cancelled') {
    return 'var(--text-3)';
  }
  return 'var(--warning, var(--accent))';
}

export function formatTime(ms: number | null): string {
  if (typeof ms !== 'number' || !Number.isFinite(ms)) return '—';
  return new Date(ms).toLocaleString('zh-CN');
}

// ── 面板（文档式长页）────────────────────────────────────────────────
export const panelPageStyle: React.CSSProperties = {
  maxWidth: 880,
  margin: '0 auto',
  padding: '32px 20px 64px',
  display: 'flex',
  flexDirection: 'column',
  gap: 20,
};

export const panelCardStyle: React.CSSProperties = {
  border: '1px solid var(--border)',
  borderRadius: 12,
  padding: 16,
  background: 'var(--bg-2, transparent)',
  display: 'flex',
  flexDirection: 'column',
  gap: 10,
};

export const panelMutedStyle: React.CSSProperties = { color: 'var(--text-3)', fontSize: 13 };

export const panelRowStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 12,
  justifyContent: 'space-between',
};

/** 一组动作按钮（行内右侧）：统一间距，避免每处重写 flex/gap。 */
export const actionGroupStyle: React.CSSProperties = { display: 'flex', gap: 8 };

// ── 确认页（居中单卡片）──────────────────────────────────────────────
export const confirmPageStyle: React.CSSProperties = {
  minHeight: '100vh',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  padding: 24,
  background: 'var(--bg-1)',
};

export const confirmCardStyle: React.CSSProperties = {
  width: '100%',
  maxWidth: 560,
  padding: 20,
  borderRadius: 12,
  border: '1px solid var(--line-default, var(--line))',
  background: 'var(--bg-2)',
  display: 'flex',
  flexDirection: 'column',
  gap: 6,
};

export const confirmLabelStyle: React.CSSProperties = {
  fontSize: 12,
  color: 'var(--text-3)',
  margin: 0,
};

export const confirmValueStyle: React.CSSProperties = {
  fontSize: 13,
  color: 'var(--text-1)',
  margin: 0,
  wordBreak: 'break-word',
};

export const confirmDangerValueStyle: React.CSSProperties = {
  ...confirmValueStyle,
  color: 'var(--danger)',
};

export const confirmMutedStyle: React.CSSProperties = {
  fontSize: 12,
  color: 'var(--text-3)',
  margin: '4px 0',
  lineHeight: 1.6,
};

export const warningListStyle: React.CSSProperties = {
  margin: '8px 0',
  paddingLeft: 18,
  display: 'flex',
  flexDirection: 'column',
  gap: 4,
};

export const primaryButtonStyle: React.CSSProperties = {
  padding: '8px 16px',
  borderRadius: 8,
  border: 'none',
  background: 'var(--accent)',
  color: 'var(--accent-fg, #fff)',
  fontSize: 13,
  cursor: 'pointer',
};

export const secondaryButtonStyle: React.CSSProperties = {
  padding: '8px 16px',
  borderRadius: 8,
  border: '1px solid var(--line-default, var(--line))',
  background: 'transparent',
  color: 'var(--text-1)',
  fontSize: 13,
  cursor: 'pointer',
};
