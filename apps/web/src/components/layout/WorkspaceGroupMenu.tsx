import React, { useState } from 'react';

const PlusIcon = () => (
  <svg
    width="14"
    height="14"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2.5"
    strokeLinecap="round"
    strokeLinejoin="round"
    aria-hidden="true"
  >
    <line x1="12" y1="5" x2="12" y2="19" />
    <line x1="5" y1="12" x2="19" y2="12" />
  </svg>
);

const ChevronDownIcon = () => (
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
    <polyline points="6 9 12 15 18 9" />
  </svg>
);

const ChevronRightIcon = () => (
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
    <polyline points="9 18 15 12 9 6" />
  </svg>
);

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

export interface WorkspaceGroupMenuProps {
  workspacePath: string | null;
  workspaceLabel: string;
  sessionCount: number;
  x: number;
  y: number;
  isCollapsed: boolean;
  showCollapseAction?: boolean;
  canDelete?: boolean;
  onClose: () => void;
  onNewSession: () => void;
  onToggleCollapse: () => void;
  onDelete?: () => void;
}

const menuStyle: React.CSSProperties = {
  position: 'fixed',
  zIndex: 9999,
  background: 'var(--surface)',
  border: '1px solid var(--border)',
  borderRadius: 8,
  padding: '4px 0',
  minWidth: 160,
  boxShadow: '0 4px 16px rgba(0,0,0,.18)',
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
  disabled,
}: {
  label: string;
  icon: React.ReactNode;
  onClick: () => void;
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
        background: hovered && !disabled ? 'var(--bg-2)' : 'transparent',
        color: disabled ? 'var(--text-3)' : 'var(--text)',
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

export default function WorkspaceGroupMenu({
  workspacePath,
  workspaceLabel,
  sessionCount,
  x,
  y,
  isCollapsed,
  showCollapseAction = true,
  canDelete = false,
  onClose,
  onNewSession,
  onToggleCollapse,
  onDelete,
}: WorkspaceGroupMenuProps) {
  const deleteLabel =
    sessionCount > 0
      ? workspacePath === null
        ? `删除未绑定会话（${sessionCount} 个）`
        : `删除工作区及 ${sessionCount} 个会话`
      : `移除工作区 ${workspaceLabel}`;

  return (
    <>
      <button
        type="button"
        aria-label="关闭菜单"
        onClick={onClose}
        onKeyDown={(e) => {
          if (e.key === 'Escape') onClose();
        }}
        style={{
          position: 'fixed',
          inset: 0,
          zIndex: 9998,
          background: 'transparent',
          border: 'none',
          cursor: 'default',
          padding: 0,
        }}
      />
      <div style={{ ...menuStyle, top: y, left: x }} role="menu" aria-label="工作区操作菜单">
        <MenuItem
          label="在此新建会话"
          icon={<PlusIcon />}
          onClick={() => {
            onNewSession();
            onClose();
          }}
        />
        {showCollapseAction && (
          <>
            <MenuItem
              label={isCollapsed ? '展开' : '折叠'}
              icon={isCollapsed ? <ChevronRightIcon /> : <ChevronDownIcon />}
              onClick={() => {
                onToggleCollapse();
                onClose();
              }}
            />
            <hr style={sepStyle} />
          </>
        )}
        <MenuItem
          label="在文件管理器中打开"
          icon={<FolderIcon />}
          onClick={() => {
            if (workspacePath) window.open('file://' + workspacePath);
            onClose();
          }}
          disabled={!workspacePath}
        />
        {canDelete && onDelete && (
          <>
            <hr style={sepStyle} />
            <MenuItem
              label={deleteLabel}
              icon={<TrashIcon />}
              onClick={() => {
                onDelete();
                onClose();
              }}
            />
          </>
        )}
      </div>
    </>
  );
}
