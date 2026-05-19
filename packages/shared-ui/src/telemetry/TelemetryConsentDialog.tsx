import { color } from '../tokens.js';
import type { CSSProperties } from 'react';

export interface TelemetryConsentDialogProps {
  open: boolean;
  onAccept: () => void;
  onDecline: () => void;
  appName?: string;
}

const s: Record<string, CSSProperties> = {
  overlay: {
    position: 'fixed',
    inset: 0,
    background: 'rgba(0,0,0,0.65)',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 1000,
  },
  dialog: {
    background: 'var(--bg-overlay))',
    border: '1px solid var(--border-default, hsla(215, 18%, 50%, 0.12))',
    borderRadius: 14,
    padding: '1.75rem',
    width: 460,
    maxWidth: '90vw',
    fontFamily: 'system-ui, sans-serif',
    boxShadow: '0 20px 60px rgba(0,0,0,0.45)',
    backdropFilter: 'blur(8px)',
  },
  icon: {
    width: 40,
    height: 40,
    borderRadius: 10,
    background: 'rgba(99,102,241,0.15)',
    border: '1px solid rgba(99,102,241,0.3)',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: '1rem',
    fontSize: 16,
  },
  title: {
    margin: '0 0 0.5rem',
    fontSize: 17,
    fontWeight: 700,
    color: 'var(--fg-default))',
  },
  body: {
    margin: '0 0 1.25rem',
    fontSize: 12,
    color: 'var(--fg-muted))',
    lineHeight: 1.6,
  },
  bodyText: {
    margin: 0,
  },
  list: {
    margin: '0.5rem 0 0',
    paddingLeft: '1.1rem',
    display: 'flex',
    flexDirection: 'column',
    gap: 4,
  },
  listItem: {
    fontSize: 12,
    color: 'var(--fg-muted))',
    lineHeight: 1.5,
  },
  divider: {
    borderTop: '1px solid var(--border-default, hsla(215, 18%, 50%, 0.12))',
    margin: '1.25rem 0',
  },
  footer: {
    display: 'flex',
    flexDirection: 'column',
    gap: 8,
  },
  btnPrimary: {
    background: 'var(--accent))',
    color: color.fgOnAccent,
    border: '1px solid rgba(99,102,241,0.5)',
    borderRadius: 8,
    padding: '0.55rem 1rem',
    fontSize: 12,
    fontWeight: 600,
    cursor: 'pointer',
    width: '100%',
  },
  btnSecondary: {
    background: 'transparent',
    color: 'var(--fg-muted))',
    border: '1px solid var(--border-default, hsla(215, 18%, 50%, 0.12))',
    borderRadius: 8,
    padding: '0.55rem 1rem',
    fontSize: 12,
    fontWeight: 500,
    cursor: 'pointer',
    width: '100%',
  },
  hint: {
    marginTop: '0.75rem',
    fontSize: 11,
    color: 'var(--fg-muted))',
    textAlign: 'center' as const,
    lineHeight: 1.5,
  },
};

export function TelemetryConsentDialog({
  open,
  onAccept,
  onDecline,
  appName = 'OpenAWork',
}: TelemetryConsentDialogProps) {
  if (!open) return null;

  return (
    <div style={s.overlay}>
      <div
        style={s.dialog}
        role="dialog"
        aria-modal="true"
        aria-labelledby="telemetry-dialog-title"
        onKeyDown={(e) => {
          if (e.key === 'Escape') onDecline();
        }}
      >
        <div style={s.icon}>&#128202;</div>

        <h3 id="telemetry-dialog-title" style={s.title}>
          帮助改进 {appName}
        </h3>

        <div style={s.body}>
          <p style={s.bodyText}>我们希望收集匿名使用数据，以了解功能使用情况并持续改进产品。</p>
          <ul style={s.list}>
            <li style={s.listItem}>
              仅收集匿名使用数据（会话启动、工具调用次数、模型切换等元数据）
            </li>
            <li style={s.listItem}>不收集任何 prompt、响应内容、文件内容或个人信息</li>
            <li style={s.listItem}>
              可随时通过设置环境变量 <code>DISABLE_METRICS=1</code> 或 <code>DO_NOT_TRACK=1</code>{' '}
              关闭
            </li>
          </ul>
        </div>

        <div style={s.divider} />

        <div style={s.footer}>
          <button type="button" style={s.btnPrimary} onClick={onAccept}>
            允许匿名数据收集
          </button>
          <button type="button" style={s.btnSecondary} onClick={onDecline}>
            拒绝
          </button>
        </div>

        <p style={s.hint}>你可以随时在设置 → 隐私中更改此偏好</p>
      </div>
    </div>
  );
}
