/**
 * IncidentReadableCard — 将原始 incident JSON 解析为人类可读的结构化卡片。
 *
 * 当助手消息内容本身是一段 incident JSON（如 handoff_failure、runtime_incident 等）时，
 * 直接展示原始 JSON 对用户毫无意义。此组件把 JSON 解析为：
 *   - 严重度图标 + 标签
 *   - 类别 + 代码 badge
 *   - 时间戳
 *   - 消息正文（人类可读的描述）
 *   - 上下文 chips（handoffId、sessionId、roleLayer 等）
 */

import type { CSSProperties } from 'react';

interface IncidentData {
  category?: string;
  code?: string;
  message?: string;
  severity?: string;
  timestamp?: number;
  context?: Record<string, unknown>;
}

const CARD_STYLE: CSSProperties = {
  display: 'grid',
  gap: 6,
  padding: 0,
};

const HEADER_ROW_STYLE: CSSProperties = {
  display: 'flex',
  gap: 8,
  alignItems: 'center',
  flexWrap: 'wrap',
};

const CATEGORY_LABELS: Record<string, string> = {
  handoff_failure: '派发失败',
  handoff_runner_failed: '执行失败',
  handoff_courier_failed: '传递失败',
  handoff_timeout: '派发超时',
  runtime_incident: '运行异常',
  runtime_backend: '后端异常',
  routineIncident: '日常异常',
  routineBackend: '后端例行',
  'handoff-courier-failed': '传递失败',
  'handoff-runner-failed': '执行失败',
  constitution_violation: '规则违反',
  quality_review: '质量评审',
};

const CODE_LABELS: Record<string, string> = {
  'handoff-runner-failed': '任务执行器失败',
  'handoff-courier-failed': '任务传递失败',
  'stale-runtime-threads': '运行线程过期',
  'stale-decisions': '交互决策过期',
  'quality-review-pending': '评审待处理',
};

const SEVERITY_META: Record<string, { icon: string; label: string; color: string }> = {
  error: { icon: '⚠️', label: '错误', color: 'var(--danger)' },
  warning: { icon: '⚡', label: '警告', color: 'var(--warning)' },
  info: { icon: 'ℹ️', label: '提示', color: 'var(--aux)' },
  critical: { icon: '🚨', label: '严重', color: 'var(--danger)' },
};

const CONTEXT_PRIORITY_KEYS = [
  'handoffId',
  'pm2HandoffId',
  'sessionId',
  'fromSessionId',
  'toSessionId',
  'childSessionId',
  'roleLayer',
  'fromRoleLayer',
  'toRoleLayer',
  'toRoleLayer',
  'userId',
  'taskTitle',
  'artifactPhase',
];

const CONTEXT_LABELS: Record<string, string> = {
  handoffId: '任务',
  pm2HandoffId: '评审任务',
  sessionId: '会话',
  fromSessionId: '来源会话',
  toSessionId: '目标会话',
  childSessionId: '子会话',
  roleLayer: '角色',
  fromRoleLayer: '来源角色',
  toRoleLayer: '目标角色',
  userId: '用户',
  taskTitle: '任务标题',
  artifactPhase: '产物阶段',
};

const CHIP_STYLE: CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  gap: 4,
  padding: '1px 6px',
  borderRadius: 4,
  background: 'var(--bg-overlay)',
  color: 'var(--fg-muted)',
  fontSize: 10,
};

const CODE_BADGE_STYLE: CSSProperties = {
  padding: '1px 6px',
  borderRadius: 4,
  background: 'var(--bg-overlay)',
  color: 'var(--fg-muted)',
  fontSize: 10,
  fontWeight: 600,
};

function formatContextValue(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  if (typeof value === 'string') {
    const trimmed = value.trim();
    return trimmed.length > 0 ? trimmed : null;
  }
  if (typeof value === 'number') {
    return Number.isFinite(value) ? String(value) : null;
  }
  if (typeof value === 'boolean') {
    return value ? '是' : '否';
  }
  return null;
}

function truncateId(value: string): string {
  if (value.length <= 12) return value;
  return `${value.slice(0, 8)}…`;
}

/** 尝试将文本解析为 incident 对象；非 incident JSON 返回 null。 */
export function tryParseIncidentJson(text: string): IncidentData | null {
  const trimmed = text.trim();
  if (!trimmed.startsWith('{')) return null;

  let parsed: Record<string, unknown>;
  try {
    parsed = JSON.parse(trimmed);
  } catch {
    return null;
  }

  // 判断是否是 incident 类数据：必须包含 category/code/message/severity 中至少两个
  const incidentFields = ['category', 'code', 'message', 'severity', 'timestamp', 'context'];
  const matchCount = incidentFields.filter((f) => f in parsed).length;
  if (matchCount < 2) return null;

  return {
    category: typeof parsed['category'] === 'string' ? (parsed['category'] as string) : undefined,
    code: typeof parsed['code'] === 'string' ? (parsed['code'] as string) : undefined,
    message: typeof parsed['message'] === 'string' ? (parsed['message'] as string) : undefined,
    severity: typeof parsed['severity'] === 'string' ? (parsed['severity'] as string) : undefined,
    timestamp:
      typeof parsed['timestamp'] === 'number' ? (parsed['timestamp'] as number) : undefined,
    context:
      typeof parsed['context'] === 'object' && parsed['context'] !== null
        ? (parsed['context'] as Record<string, unknown>)
        : undefined,
  };
}

export function IncidentReadableCard({ data }: { data: IncidentData }): React.ReactElement {
  const severityMeta =
    SEVERITY_META[data.severity ?? ''] ?? SEVERITY_META['info'] ?? SEVERITY_META['info'];
  const categoryLabel = CATEGORY_LABELS[data.category ?? ''] ?? data.category ?? '事件';
  const codeLabel = CODE_LABELS[data.code ?? ''] ?? data.code;

  // 构建上下文 chips
  const contextChips: { label: string; value: string; raw: string }[] = [];
  const context = data.context ?? {};
  const usedKeys = new Set<string>();

  for (const key of CONTEXT_PRIORITY_KEYS) {
    if (key in context) {
      const value = formatContextValue(context[key]);
      if (value) {
        const label = CONTEXT_LABELS[key] ?? key;
        contextChips.push({
          label,
          value: key.includes('Id') || key.includes('sessionId') ? truncateId(value) : value,
          raw: value,
        });
        usedKeys.add(key);
      }
    }
  }
  // 补充其他 context 字段
  for (const key of Object.keys(context).sort()) {
    if (usedKeys.has(key)) continue;
    const value = formatContextValue(context[key]);
    if (value) {
      contextChips.push({
        label: CONTEXT_LABELS[key] ?? key,
        value,
        raw: value,
      });
    }
  }

  const timeStr = data.timestamp
    ? new Date(data.timestamp).toLocaleString('zh-CN', {
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
      })
    : null;

  return (
    <div style={CARD_STYLE}>
      <div style={HEADER_ROW_STYLE}>
        <span aria-hidden style={{ fontSize: 14 }}>
          {severityMeta.icon}
        </span>
        <span style={{ color: severityMeta.color, fontWeight: 700, fontSize: 12 }}>
          {severityMeta.label}
        </span>
        <span style={{ color: 'var(--fg-strong)', fontWeight: 700, fontSize: 12 }}>
          {categoryLabel}
        </span>
        {codeLabel ? <span style={CODE_BADGE_STYLE}>{codeLabel}</span> : null}
        {timeStr ? <span style={{ color: 'var(--fg-muted)', fontSize: 11 }}>{timeStr}</span> : null}
      </div>
      {data.message ? (
        <span style={{ color: 'var(--fg-default)', fontSize: 12, lineHeight: 1.6 }}>
          {data.message}
        </span>
      ) : null}
      {contextChips.length > 0 ? (
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
          {contextChips.map((chip, i) => (
            <span key={`${chip.label}-${i}`} title={chip.raw} style={CHIP_STYLE}>
              {chip.label}: {chip.value}
            </span>
          ))}
        </div>
      ) : null}
    </div>
  );
}
