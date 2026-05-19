import type { SessionStateStatus } from '../session/session-runtime.js';

type StopCapability = 'none' | 'precise' | 'best_effort' | 'observe_only';

function getSessionRunStateMeta(status: Extract<SessionStateStatus, 'running' | 'paused'>): {
  badge: string;
  description: string;
  dotColor: string;
  panelBackground: string;
  panelBorder: string;
} {
  if (status === 'paused') {
    return {
      badge: '等待处理',
      description: '当前会话已暂停，处理权限或问题后会继续同步最新结果。',
      dotColor: 'var(--warning))',
      panelBackground: 'color-mix(in srgb, var(--warning) 8%, var(--bg-overlay))',
      panelBorder: '1px solid color-mix(in srgb, var(--warning) 26%, var(--border-default))',
    };
  }

  return {
    badge: '持续运行中',
    description: '你切回当前会话后，页面会继续自动同步最新消息和状态。',
    dotColor: 'var(--accent)',
    panelBackground: 'color-mix(in oklch, var(--bg-overlay) 86%, var(--accent) 14%)',
    panelBorder: '1px solid color-mix(in oklch, var(--accent) 30%, var(--border-default))',
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
      color: 'var(--warning))',
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
  onOpenRecovery,
  pendingPermissionsCount = 0,
  pendingQuestionsCount = 0,
  status,
  stopCapability = 'observe_only',
}: {
  checkpointCount?: number;
  onOpenRecovery?: () => void;
  pendingPermissionsCount?: number;
  pendingQuestionsCount?: number;
  status: Extract<SessionStateStatus, 'running' | 'paused'>;
  stopCapability?: StopCapability;
}) {
  const meta = getSessionRunStateMeta(status);
  const capabilityCopy = getStopCapabilityCopy(stopCapability);
  const capabilityTone = getStopCapabilityTone(stopCapability);

  const counterParts: string[] = [];
  if (checkpointCount > 0) counterParts.push(`检查点 ${checkpointCount}`);
  if (pendingPermissionsCount > 0) counterParts.push(`审批 ${pendingPermissionsCount}`);
  if (pendingQuestionsCount > 0) counterParts.push(`问题 ${pendingQuestionsCount}`);

  return (
    <div
      data-testid="chat-session-runtime-status"
      style={{
        padding: '0 10px 4px',
        background: 'var(--bg-base)',
        flexShrink: 0,
      }}
    >
      <div
        style={{
          maxWidth: 740,
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
            color={status === 'paused' ? 'var(--warning))' : 'var(--accent)'}
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
  const meta = getSessionRunStateMeta(status);
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
