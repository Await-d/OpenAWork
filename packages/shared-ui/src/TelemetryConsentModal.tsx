import type { CSSProperties } from 'react';

export interface TelemetryConsentModalProps {
  open: boolean;
  onAccept: () => void;
  onDecline: () => void;
}

const DATA_POINTS = [
  '会话时长和功能使用次数',
  '错误类型和崩溃报告（不含个人数据的堆栈跟踪）',
  '使用的命令分类（不含命令内容）',
  '操作系统平台和应用版本',
];

export function TelemetryConsentModal({ open, onAccept, onDecline }: TelemetryConsentModalProps) {
  if (!open) return null;

  const overlayStyle: CSSProperties = {
    position: 'fixed',
    inset: 0,
    background: 'rgba(0,0,0,0.6)',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 1000,
    fontFamily: 'system-ui, sans-serif',
  };

  const modalStyle: CSSProperties = {
    background: 'var(--color-surface, #1e293b)',
    border: '1px solid var(--color-border, #334155)',
    borderRadius: 14,
    padding: '1.5rem',
    maxWidth: 420,
    width: '90%',
    display: 'flex',
    flexDirection: 'column',
    gap: 14,
  };

  const btnStyle = (accent: string): CSSProperties => ({
    background: `${accent}22`,
    color: accent,
    border: `1px solid ${accent}44`,
    borderRadius: 7,
    padding: '0.45rem 1.2rem',
    fontSize: 12,
    fontWeight: 600,
    cursor: 'pointer',
  });

  return (
    <div style={overlayStyle} role="dialog" aria-modal="true" aria-labelledby="telemetry-title">
      <div style={modalStyle}>
        <div>
          <h2
            id="telemetry-title"
            style={{
              margin: 0,
              fontSize: 14,
              fontWeight: 700,
              color: 'var(--color-text, #e2e8f0)',
            }}
          >
            帮助改进 OpenAWork
          </h2>
          <p
            style={{
              margin: '6px 0 0',
              fontSize: 12,
              color: 'var(--color-muted, #94a3b8)',
              lineHeight: 1.5,
            }}
          >
            我们收集匿名使用数据以改进产品。绝不会收集任何个人信息或文件内容。
          </p>
        </div>

        <div
          style={{
            background: 'var(--color-bg, #0f172a)',
            border: '1px solid var(--color-border, #334155)',
            borderRadius: 8,
            padding: '0.75rem 1rem',
          }}
        >
          <div
            style={{
              fontSize: 11,
              fontWeight: 600,
              color: 'var(--color-muted, #94a3b8)',
              textTransform: 'uppercase',
              letterSpacing: 0.5,
              marginBottom: 8,
            }}
          >
            我们收集的数据
          </div>
          {DATA_POINTS.map((point) => (
            <div
              key={point}
              style={{
                display: 'flex',
                gap: 8,
                alignItems: 'flex-start',
                marginBottom: 5,
              }}
            >
              <span style={{ color: '#34d399', fontSize: 12, flexShrink: 0, marginTop: 1 }}>+</span>
              <span style={{ fontSize: 12, color: 'var(--color-text, #e2e8f0)', lineHeight: 1.4 }}>
                {point}
              </span>
            </div>
          ))}
        </div>

        <p
          style={{ margin: 0, fontSize: 12, color: 'var(--color-muted, #94a3b8)', lineHeight: 1.5 }}
        >
          你可以随时在偏好设置中更改此选项。数据以匿名方式发送，绝不会与第三方共享。
        </p>

        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
          <button type="button" onClick={onDecline} style={btnStyle('#64748b')}>
            不了，谢谢
          </button>
          <button type="button" onClick={onAccept} style={btnStyle('#6366f1')}>
            启用遥测
          </button>
        </div>
      </div>
    </div>
  );
}
