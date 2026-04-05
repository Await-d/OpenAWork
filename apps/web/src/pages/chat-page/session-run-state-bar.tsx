import type { SessionStateStatus } from './session-runtime.js';

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
      dotColor: '#f59e0b',
      panelBackground: 'color-mix(in srgb, #f59e0b 8%, var(--surface))',
      panelBorder: '1px solid color-mix(in srgb, #f59e0b 26%, var(--border))',
    };
  }

  return {
    badge: '持续运行中',
    description: '你切回当前会话后，页面会继续自动同步最新消息和状态。',
    dotColor: 'var(--accent)',
    panelBackground: 'color-mix(in oklch, var(--surface) 86%, var(--accent) 14%)',
    panelBorder: '1px solid color-mix(in oklch, var(--accent) 30%, var(--border))',
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
      background: 'color-mix(in srgb, #f59e0b 12%, transparent)',
      border: '1px solid color-mix(in srgb, #f59e0b 28%, var(--border))',
      color: '#fcd34d',
    };
  }

  if (capability === 'precise') {
    return {
      background: 'color-mix(in oklch, var(--accent) 10%, transparent)',
      border: '1px solid color-mix(in oklch, var(--accent) 22%, var(--border))',
      color: 'var(--accent)',
    };
  }

  return {
    background: 'transparent',
    border: '1px solid var(--border-subtle)',
    color: 'var(--text-3)',
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
        height: 22,
        padding: '0 8px',
        borderRadius: 999,
        fontSize: 10,
        fontWeight: 700,
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

  return (
    <div
      data-testid="chat-session-runtime-status"
      style={{
        padding: '0 10px 6px',
        background: 'var(--bg)',
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
          gap: 10,
          borderRadius: 12,
          padding: '8px 10px',
          background: meta.panelBackground,
          border: meta.panelBorder,
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 9, minWidth: 0, flex: 1 }}>
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
          <div style={{ minWidth: 0, flex: 1 }}>
            <div
              style={{
                fontSize: 11,
                fontWeight: 700,
                color: 'var(--text)',
                whiteSpace: 'nowrap',
                overflow: 'hidden',
                textOverflow: 'ellipsis',
              }}
            >
              会话{meta.badge}
            </div>
            <div
              style={{
                marginTop: 2,
                fontSize: 10,
                lineHeight: 1.35,
                color: 'var(--text-3)',
              }}
            >
              <div
                style={{
                  whiteSpace: 'nowrap',
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                }}
              >
                {meta.description}
              </div>
              {capabilityCopy && (
                <div
                  style={{
                    marginTop: 3,
                    whiteSpace: 'nowrap',
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    color: capabilityTone.color,
                  }}
                >
                  {capabilityCopy.description}
                </div>
              )}
            </div>
          </div>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexShrink: 0 }}>
          {onOpenRecovery ? (
            <button
              type="button"
              onClick={onOpenRecovery}
              style={{
                height: 24,
                padding: '0 8px',
                borderRadius: 999,
                border: '1px solid var(--border-subtle)',
                background: 'color-mix(in oklch, var(--surface) 82%, transparent)',
                color: 'var(--text)',
                fontSize: 10,
                fontWeight: 700,
                cursor: 'pointer',
              }}
            >
              查看恢复策略
            </button>
          ) : null}
          <StatusBadge
            background={
              status === 'paused'
                ? 'color-mix(in srgb, #f59e0b 12%, transparent)'
                : 'color-mix(in oklch, var(--accent) 10%, transparent)'
            }
            border={
              status === 'paused'
                ? '1px solid color-mix(in srgb, #f59e0b 28%, var(--border))'
                : '1px solid color-mix(in oklch, var(--accent) 22%, var(--border))'
            }
            color={status === 'paused' ? '#fcd34d' : 'var(--accent)'}
            label={meta.badge}
          />
          {capabilityCopy && <StatusBadge {...capabilityTone} label={capabilityCopy.badge} />}
          {(checkpointCount > 0 || pendingPermissionsCount > 0 || pendingQuestionsCount > 0) && (
            <StatusBadge
              background="color-mix(in oklch, var(--surface) 82%, transparent)"
              border="1px solid var(--border-subtle)"
              color="var(--text-2)"
              label={`检查点 ${checkpointCount} · 审批 ${pendingPermissionsCount} · 问题 ${pendingQuestionsCount}`}
            />
          )}
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
        color: 'var(--text-2)',
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
          color: 'var(--text)',
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
