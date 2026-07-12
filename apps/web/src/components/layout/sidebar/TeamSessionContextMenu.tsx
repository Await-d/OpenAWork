import React, { useEffect, useRef, useState } from 'react';

const PencilIcon = () => (
  <svg
    width="14"
    height="14"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
    aria-hidden="true"
  >
    <path d="M12 20h9" />
    <path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z" />
  </svg>
);

const PauseIcon = () => (
  <svg
    width="14"
    height="14"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
    aria-hidden="true"
  >
    <rect x="6" y="4" width="4" height="16" />
    <rect x="14" y="4" width="4" height="16" />
  </svg>
);

const PlayIcon = () => (
  <svg
    width="14"
    height="14"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
    aria-hidden="true"
  >
    <polygon points="5 3 19 12 5 21 5 3" />
  </svg>
);

const CopyIcon = () => (
  <svg
    width="14"
    height="14"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
    aria-hidden="true"
  >
    <rect x="9" y="9" width="13" height="13" rx="2" ry="2" />
    <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
  </svg>
);

const TrashIcon = () => (
  <svg
    width="14"
    height="14"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
    aria-hidden="true"
  >
    <polyline points="3 6 5 6 21 6" />
    <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" />
    <path d="M10 11v6" />
    <path d="M14 11v6" />
  </svg>
);

export type TeamSessionStatus = 'idle' | 'running' | 'paused' | string;

export interface TeamSessionContextMenuProps {
  sessionId: string;
  sessionTitle: string | null;
  x: number;
  y: number;
  stateStatus: TeamSessionStatus;
  isRenaming: boolean;
  isDeleting: boolean;
  onClose: () => void;
  onRename: () => void;
  onTogglePause: () => void;
  onCopyId: () => void;
  onDelete: () => void;
}

const menuStyle: React.CSSProperties = {
  position: 'fixed',
  zIndex: 9999,
  background: 'var(--bg-overlay)',
  border: '1px solid var(--border-default)',
  borderRadius: 8,
  padding: '4px 0',
  minWidth: 180,
  boxShadow: 'var(--shadow-md)',
};

const sepStyle: React.CSSProperties = {
  margin: '3px 0',
  border: 'none',
  borderTop: '1px solid var(--border-subtle)',
};

function MenuItem({
  label,
  icon,
  onClick,
  danger,
  disabled,
}: {
  label: string;
  icon: React.ReactNode;
  onClick: () => void;
  danger?: boolean;
  disabled?: boolean;
}) {
  const [hovered, setHovered] = useState(false);
  return (
    <button
      type="button"
      onMouseDown={(e) => e.preventDefault()}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      onClick={onClick}
      disabled={disabled}
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 8,
        width: '100%',
        padding: '6px 12px',
        border: 'none',
        background: hovered && !disabled ? 'var(--bg-overlay)' : 'transparent',
        color: disabled ? 'var(--fg-muted)' : danger ? 'var(--danger)' : 'var(--fg-strong)',
        fontSize: 12,
        textAlign: 'left',
        cursor: disabled ? 'default' : 'pointer',
        transition: 'background 80ms ease',
      }}
    >
      <span
        style={{
          width: 14,
          height: 14,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          flexShrink: 0,
        }}
      >
        {icon}
      </span>
      {label}
    </button>
  );
}

export default function TeamSessionContextMenu({
  sessionId: _sessionId,
  sessionTitle: _sessionTitle,
  x,
  y,
  stateStatus,
  isRenaming,
  isDeleting,
  onClose,
  onRename,
  onTogglePause,
  onCopyId,
  onDelete,
}: TeamSessionContextMenuProps) {
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleMouseDown = (event: MouseEvent) => {
      if (menuRef.current && menuRef.current.contains(event.target as Node)) {
        return;
      }
      onClose();
    };
    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    document.addEventListener('mousedown', handleMouseDown, true);
    document.addEventListener('keydown', handleEscape);
    return () => {
      document.removeEventListener('mousedown', handleMouseDown, true);
      document.removeEventListener('keydown', handleEscape);
    };
  }, [onClose]);

  const isRunning = stateStatus === 'running';
  const isPaused = stateStatus === 'paused';
  const canTogglePause = isRunning || isPaused;

  return (
    <div
      ref={menuRef}
      style={{
        ...menuStyle,
        top: y,
        left: x,
      }}
      role="menu"
      aria-label="团队会话操作菜单"
    >
      <MenuItem
        label="重命名"
        icon={<PencilIcon />}
        onClick={() => {
          onRename();
          onClose();
        }}
        disabled={isRenaming}
      />
      <MenuItem
        label={isPaused ? '恢复运行' : '暂停'}
        icon={isPaused ? <PlayIcon /> : <PauseIcon />}
        onClick={() => {
          onTogglePause();
          onClose();
        }}
        disabled={!canTogglePause}
      />
      <hr style={sepStyle} />
      <MenuItem
        label="复制会话 ID"
        icon={<CopyIcon />}
        onClick={() => {
          onCopyId();
          onClose();
        }}
      />
      <hr style={sepStyle} />
      <MenuItem
        label="删除"
        icon={<TrashIcon />}
        onClick={() => {
          onDelete();
          onClose();
        }}
        danger
        disabled={isDeleting}
      />
    </div>
  );
}
