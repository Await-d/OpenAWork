import type { SessionStateStatus } from '../session/session-runtime.js';
import type { UpstreamStreamSummary } from '@openAwork/shared';
import { formatChatUpstreamSummaryLabel } from './upstream-summary-label.js';

type StopCapability = 'none' | 'precise' | 'best_effort' | 'observe_only';

/** 运行状态条相位：待办交互优先于 status，其余按重连、权限续跑、status 依次收敛。 */
type SessionRunStatePhase =
  'awaiting_permission' | 'awaiting_question' | 'continuing' | 'resuming' | 'running' | 'paused';

interface SessionRunStateTone {
  dotColor: string;
  panelBackground: string;
  panelBorder: string;
}

interface SessionRunStateMeta extends SessionRunStateTone {
  badge: string;
  description: string;
}

/** 警示色调：待审批 / 待回答 / 恢复中 / paused 共用，避免样式对象散落多处。 */
const WARNING_TONE: SessionRunStateTone = {
  dotColor: 'var(--warning)',
  panelBackground: 'color-mix(in srgb, var(--warning) 8%, var(--bg-overlay))',
  panelBorder: '1px solid color-mix(in srgb, var(--warning) 26%, var(--border-default))',
};

/** 强调色调：继续中 / running 共用（与既有 running 样式逐字节一致）。 */
const ACCENT_TONE: SessionRunStateTone = {
  dotColor: 'var(--accent)',
  panelBackground: 'color-mix(in oklch, var(--bg-overlay) 86%, var(--accent) 14%)',
  panelBorder: '1px solid color-mix(in oklch, var(--accent) 30%, var(--border-default))',
};

/**
 * 把「待办交互 / 重连 / 权限续跑 / 服务端状态」收敛成唯一相位。
 * 优先级：待审批 > 待回答 > 恢复中(重连) > 继续中(权限续跑) > status。
 */
function resolveSessionRunStatePhase({
  latestUpstreamSummary,
  pendingPermissionsCount,
  pendingQuestionsCount,
  reconnecting,
  status,
}: {
  latestUpstreamSummary: UpstreamStreamSummary | null;
  pendingPermissionsCount: number;
  pendingQuestionsCount: number;
  reconnecting: boolean;
  status: Extract<SessionStateStatus, 'running' | 'paused'>;
}): SessionRunStatePhase {
  if (pendingPermissionsCount > 0) {
    return 'awaiting_permission';
  }

  if (pendingQuestionsCount > 0) {
    return 'awaiting_question';
  }

  // 传输出错后 attach 重试期间才算「重新接入」，与正常的「审批 → 续跑」happy path 无关。
  if (reconnecting) {
    return 'resuming';
  }

  // `tool_permission` 表示上一轮因权限暂停收尾；在恢复轮次产出新 summary 之前，
  // 回答仍是同一次，因此只表示「继续中」而非重连。
  if (latestUpstreamSummary?.stopReason === 'tool_permission') {
    return 'continuing';
  }

  return status;
}

/** 相位 → 文案 / 色调的唯一纯函数映射；调用方不得复制分支内样式对象。 */
function getSessionRunStateMeta(phase: SessionRunStatePhase): SessionRunStateMeta {
  if (phase === 'awaiting_permission') {
    return {
      badge: '等待审批',
      description: '当前会话已暂停，等待你批准或拒绝授权后会继续同步最新结果。',
      ...WARNING_TONE,
    };
  }

  if (phase === 'awaiting_question') {
    return {
      badge: '等待回答',
      description: '当前会话已暂停，等待你回答问题后会继续同步最新结果。',
      ...WARNING_TONE,
    };
  }

  if (phase === 'continuing') {
    return {
      badge: '继续中',
      description: '已处理授权，助手正在继续本次回答并同步最新输出。',
      ...ACCENT_TONE,
    };
  }

  if (phase === 'resuming') {
    return {
      badge: '恢复中',
      description: '实时连接中断，正在重新接入并同步最新输出。',
      ...WARNING_TONE,
    };
  }

  if (phase === 'paused') {
    return {
      badge: '等待处理',
      description: '当前会话已暂停，处理权限或问题后会继续同步最新结果。',
      ...WARNING_TONE,
    };
  }

  return {
    badge: '持续运行中',
    description: '你切回当前会话后，页面会继续自动同步最新消息和状态。',
    ...ACCENT_TONE,
  };
}

function getStopCapabilityCopy(capability: StopCapability): {
  badge: string;
  description: string;
} | null {
  if (capability === 'precise') {
    return {
      badge: '可直接停止',
      description: '当前页仍持有这次运行的控制句柄，可直接停止并继续同步结果。',
    };
  }

  if (capability === 'best_effort') {
    return {
      badge: '可尝试停止',
      description: '当前页已恢复会话状态，但未接管原始请求；可尝试停止本会话的活动运行。',
    };
  }

  if (capability === 'observe_only') {
    return {
      badge: '仅可观察',
      description: '当前页只会继续同步运行状态，无法直接停止这次运行。',
    };
  }

  return null;
}

function getStopCapabilityTone(capability: StopCapability): {
  background: string;
  border: string;
  color: string;
} {
  if (capability === 'best_effort') {
    return {
      background: 'color-mix(in srgb, var(--warning) 12%, transparent)',
      border: '1px solid color-mix(in srgb, var(--warning) 28%, var(--border-default))',
      color: 'var(--warning)',
    };
  }

  if (capability === 'precise') {
    return {
      background: 'color-mix(in oklch, var(--accent) 10%, transparent)',
      border: '1px solid color-mix(in oklch, var(--accent) 22%, var(--border-default))',
      color: 'var(--accent)',
    };
  }

  return {
    background: 'transparent',
    border: '1px solid var(--border-subtle)',
    color: 'var(--fg-muted)',
  };
}

function StatusBadge({
  background,
  border,
  color,
  label,
}: {
  background: string;
  border: string;
  color: string;
  label: string;
}) {
  return (
    <span
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        height: 20,
        padding: '0 7px',
        borderRadius: 999,
        fontSize: 10,
        fontWeight: 600,
        color,
        border,
        background,
        flexShrink: 0,
      }}
    >
      {label}
    </span>
  );
}

export function SessionRunStateBar({
  checkpointCount = 0,
  latestCompaction = null,
  latestUpstreamSummary = null,
  onOpenRecovery,
  pendingPermissionsCount = 0,
  pendingQuestionsCount = 0,
  reconnecting = false,
  status,
  stopCapability = 'observe_only',
}: {
  checkpointCount?: number;
  latestCompaction?: {
    trigger: 'manual' | 'automatic';
    phase?: 'started' | 'completed' | 'failed';
    compactedMessages?: number;
    representedMessages?: number;
    cause?: 'manual' | 'usage_overflow' | 'provider_overflow' | 'proactive_near_overflow';
  } | null;
  latestUpstreamSummary?: UpstreamStreamSummary | null;
  onOpenRecovery?: () => void;
  pendingPermissionsCount?: number;
  pendingQuestionsCount?: number;
  /** 客户端是否正在重新接入（attach 重试待触发）；为 true 且无待办交互时展示「恢复中」。 */
  reconnecting?: boolean;
  status: Extract<SessionStateStatus, 'running' | 'paused'>;
  stopCapability?: StopCapability;
}) {
  const phase = resolveSessionRunStatePhase({
    latestUpstreamSummary,
    pendingPermissionsCount,
    pendingQuestionsCount,
    reconnecting,
    status,
  });
  const meta = getSessionRunStateMeta(phase);
  const capabilityCopy = getStopCapabilityCopy(stopCapability);
  const capabilityTone = getStopCapabilityTone(stopCapability);

  const counterParts: string[] = [];
  if (checkpointCount > 0) counterParts.push(`检查点 ${checkpointCount}`);
  if (latestCompaction) {
    if (latestCompaction.phase === 'failed') {
      counterParts.push('压缩失败');
    } else if (latestCompaction.phase === 'started') {
      counterParts.push(latestCompaction.trigger === 'manual' ? '压缩中' : '自动压缩中');
    } else if (
      typeof latestCompaction.representedMessages === 'number' &&
      latestCompaction.representedMessages > 0
    ) {
      counterParts.push(`摘要 ${latestCompaction.representedMessages} 条`);
    } else if (
      typeof latestCompaction.compactedMessages === 'number' &&
      latestCompaction.compactedMessages > 0
    ) {
      counterParts.push(`压缩 ${latestCompaction.compactedMessages} 条`);
    } else {
      counterParts.push(latestCompaction.trigger === 'manual' ? '已手动压缩' : '已自动压缩');
    }
  }
  if (pendingPermissionsCount > 0) counterParts.push(`审批 ${pendingPermissionsCount}`);
  if (pendingQuestionsCount > 0) counterParts.push(`问题 ${pendingQuestionsCount}`);
  const upstreamSummaryLabel = formatChatUpstreamSummaryLabel(latestUpstreamSummary);

  return (
    <div
      data-testid="chat-session-runtime-status"
      style={{
        padding: '0 10px 4px',
        flexShrink: 0,
      }}
    >
      <div
        style={{
          maxWidth: 860,
          margin: '0 auto',
          width: '100%',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: 8,
          borderRadius: 8,
          padding: '4px 8px',
          background: meta.panelBackground,
          border: meta.panelBorder,
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, minWidth: 0, flex: 1 }}>
          <span
            aria-hidden="true"
            style={{
              width: 6,
              height: 6,
              borderRadius: '50%',
              background: meta.dotColor,
              boxShadow:
                status === 'running'
                  ? '0 0 0 3px color-mix(in oklch, var(--accent) 14%, transparent)'
                  : 'none',
              flexShrink: 0,
            }}
          />
          <span
            style={{
              fontSize: 11,
              fontWeight: 600,
              color: 'var(--fg-strong)',
              whiteSpace: 'nowrap',
            }}
          >
            会话{meta.badge}
          </span>
          {capabilityCopy && (
            <span
              style={{
                fontSize: 10,
                color: capabilityTone.color,
                whiteSpace: 'nowrap',
              }}
            >
              · {capabilityCopy.badge}
            </span>
          )}
          {counterParts.length > 0 && (
            <span
              style={{
                fontSize: 10,
                color: 'var(--fg-muted)',
                whiteSpace: 'nowrap',
              }}
            >
              · {counterParts.join(' / ')}
            </span>
          )}
          {upstreamSummaryLabel && (
            <span
              style={{
                fontSize: 10,
                color: 'var(--fg-muted)',
                whiteSpace: 'nowrap',
              }}
              title={upstreamSummaryLabel}
            >
              · {upstreamSummaryLabel}
            </span>
          )}
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 5, flexShrink: 0 }}>
          {onOpenRecovery ? (
            <button
              type="button"
              onClick={onOpenRecovery}
              style={{
                height: 20,
                padding: '0 7px',
                borderRadius: 999,
                border: '1px solid var(--border-subtle)',
                background: 'var(--bg-overlay)',
                color: 'var(--fg-default)',
                fontSize: 10,
                fontWeight: 600,
                cursor: 'pointer',
              }}
            >
              恢复策略
            </button>
          ) : null}
          <StatusBadge
            background={
              status === 'paused'
                ? 'color-mix(in srgb, var(--warning) 12%, transparent)'
                : 'color-mix(in oklch, var(--accent) 10%, transparent)'
            }
            border={
              status === 'paused'
                ? '1px solid color-mix(in srgb, var(--warning) 28%, var(--border-default))'
                : '1px solid color-mix(in oklch, var(--accent) 22%, var(--border-default))'
            }
            color={status === 'paused' ? 'var(--warning)' : 'var(--accent)'}
            label={meta.badge}
          />
        </div>
      </div>
    </div>
  );
}

export function SessionRunStatePlaceholder({
  status,
  stopCapability = 'observe_only',
}: {
  status: Extract<SessionStateStatus, 'running' | 'paused'>;
  stopCapability?: StopCapability;
}) {
  // 占位符不携带待办计数与重连标记，走同一相位解析器以保持行为不变。
  const meta = getSessionRunStateMeta(
    resolveSessionRunStatePhase({
      latestUpstreamSummary: null,
      pendingPermissionsCount: 0,
      pendingQuestionsCount: 0,
      reconnecting: false,
      status,
    }),
  );
  const capabilityCopy = getStopCapabilityCopy(stopCapability);
  const capabilityTone = getStopCapabilityTone(stopCapability);

  return (
    <div
      data-testid="chat-remote-session-placeholder"
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 8,
        minHeight: 28,
        color: 'var(--fg-default)',
        animation: 'fade-in 180ms ease-out',
      }}
    >
      <span
        aria-hidden="true"
        style={{
          width: 8,
          height: 8,
          borderRadius: '50%',
          background: meta.dotColor,
          boxShadow:
            status === 'running'
              ? '0 0 0 4px color-mix(in oklch, var(--accent) 14%, transparent)'
              : 'none',
          flexShrink: 0,
        }}
      />
      <span
        style={{
          fontSize: 12,
          fontWeight: 600,
          letterSpacing: '0.01em',
          color: 'var(--fg-strong)',
        }}
      >
        会话{meta.badge}
      </span>
      {capabilityCopy && (
        <span
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            height: 20,
            padding: '0 7px',
            borderRadius: 999,
            fontSize: 10,
            fontWeight: 700,
            color: capabilityTone.color,
            border: capabilityTone.border,
            background: capabilityTone.background,
          }}
          title={capabilityCopy.description}
        >
          {capabilityCopy.badge}
        </span>
      )}
    </div>
  );
}
