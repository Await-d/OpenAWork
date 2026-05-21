import { useState, useEffect } from 'react';
import { getVersion } from '@tauri-apps/api/app';
import { UpdateProgressDialog } from './UpdateProgressDialog.js';

export interface UpdateActionPanelProps {
  onClose: () => void;
}

/**
 * 操作面板：点击托盘"检查更新"后先弹出此面板，
 * 用户可选择"检查更新"、"查看当前版本"等操作。
 */
export function UpdateActionPanel({ onClose }: UpdateActionPanelProps) {
  const [appVersion, setAppVersion] = useState<string>('');
  const [showUpdateProgress, setShowUpdateProgress] = useState(false);

  useEffect(() => {
    void getVersion().then((v) => setAppVersion(v));
  }, []);

  // 如果用户选择了"检查更新"，则展示 UpdateProgressDialog
  if (showUpdateProgress) {
    return <UpdateProgressDialog autoCheck onClose={onClose} />;
  }

  return (
    <dialog
      open
      style={{
        position: 'fixed',
        inset: 0,
        background: 'rgba(0,0,0,0.6)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        zIndex: 9000,
        border: 'none',
        padding: 0,
        margin: 0,
        maxWidth: '100vw',
        maxHeight: '100vh',
        width: '100vw',
        height: '100vh',
      }}
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
      onKeyDown={(e) => {
        if (e.key === 'Escape') onClose();
      }}
    >
      <div
        style={{
          background: 'hsl(var(--background))',
          border: '1px solid hsl(var(--border-default))',
          borderRadius: 12,
          padding: '1.5rem',
          width: 380,
          display: 'flex',
          flexDirection: 'column',
          gap: '1rem',
        }}
      >
        {/* 标题 */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <div
            style={{
              width: 36,
              height: 36,
              borderRadius: 8,
              background: 'hsl(var(--primary) / 0.12)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              fontSize: 18,
            }}
          >
            🔄
          </div>
          <div>
            <div style={{ fontSize: 16, fontWeight: 600 }}>软件更新</div>
            <div style={{ fontSize: 12, color: 'hsl(var(--muted-foreground))' }}>
              当前版本：v{appVersion || '...'}
            </div>
          </div>
        </div>

        {/* 分隔线 */}
        <div
          style={{
            borderTop: '1px solid hsl(var(--border-default))',
            margin: '4px 0',
          }}
        />

        {/* 操作按钮列表 */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          <ActionButton
            icon="🔍"
            label="检查更新"
            description="连接服务器查看是否有新版本可用"
            onClick={() => setShowUpdateProgress(true)}
          />
          <ActionButton
            icon="📋"
            label="查看更新日志"
            description="在浏览器中打开版本发布记录"
            onClick={() => {
              window.open('https://github.com/Await-d/OpenAWork/releases', '_blank');
            }}
          />
        </div>

        {/* 底部关闭按钮 */}
        <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 4 }}>
          <button
            type="button"
            onClick={onClose}
            style={{
              padding: '6px 14px',
              background: 'transparent',
              border: '1px solid hsl(var(--border-default))',
              borderRadius: 6,
              color: 'hsl(var(--muted-foreground))',
              cursor: 'pointer',
              fontSize: 13,
            }}
          >
            关闭
          </button>
        </div>
      </div>
    </dialog>
  );
}

/** 操作面板中的单个操作按钮 */
function ActionButton({
  icon,
  label,
  description,
  onClick,
}: {
  icon: string;
  label: string;
  description: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 12,
        padding: '10px 12px',
        background: 'hsl(var(--muted) / 0.3)',
        border: '1px solid hsl(var(--border-default))',
        borderRadius: 8,
        cursor: 'pointer',
        textAlign: 'left',
        transition: 'background 0.15s',
      }}
      onMouseEnter={(e) => {
        (e.currentTarget as HTMLButtonElement).style.background = 'hsl(var(--muted) / 0.6)';
      }}
      onMouseLeave={(e) => {
        (e.currentTarget as HTMLButtonElement).style.background = 'hsl(var(--muted) / 0.3)';
      }}
    >
      <span style={{ fontSize: 20, flexShrink: 0 }}>{icon}</span>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
        <span style={{ fontSize: 13, fontWeight: 600, color: 'hsl(var(--foreground))' }}>
          {label}
        </span>
        <span style={{ fontSize: 11, color: 'hsl(var(--muted-foreground))', lineHeight: 1.3 }}>
          {description}
        </span>
      </div>
    </button>
  );
}
