import React, { useEffect, useRef, useState } from 'react';

const FolderIcon = () => (
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
    <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z" />
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

export interface ChatWorkspaceContextMenuProps {
  workspacePath: string;
  workspaceLabel: string;
  x: number;
  y: number;
  isUnbound: boolean;
  isActive: boolean;
  onClose: () => void;
  onActivate: () => void;
  onCopyPath: () => void;
  onRemove: () => void;
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

export default function ChatWorkspaceContextMenu({
  workspacePath: _workspacePath,
  workspaceLabel: _workspaceLabel,
  x,
  y,
  isUnbound,
  isActive,
  onClose,
  onActivate,
  onCopyPath,
  onRemove,
}: ChatWorkspaceContextMenuProps) {
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

  return (
    <div
      ref={menuRef}
      style={{
        ...menuStyle,
        top: y,
        left: x,
      }}
      role="menu"
      aria-label="对话工作区操作菜单"
    >
      <MenuItem
        label={isActive ? '当前工作区（已选中）' : '设为当前工作区'}
        icon={<FolderIcon />}
        onClick={() => {
          onActivate();
          onClose();
        }}
        disabled={isActive || isUnbound}
      />
      <hr style={sepStyle} />
      <MenuItem
        label="复制工作区路径"
        icon={<CopyIcon />}
        onClick={() => {
          onCopyPath();
          onClose();
        }}
        disabled={isUnbound}
      />
      <hr style={sepStyle} />
      <MenuItem
        label="移除工作区"
        icon={<TrashIcon />}
        onClick={() => {
          onRemove();
          onClose();
        }}
        danger
        disabled={isUnbound}
      />
    </div>
  );
}
