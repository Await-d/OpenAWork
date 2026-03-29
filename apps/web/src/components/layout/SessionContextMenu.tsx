import React, { useState } from 'react';

const PinIcon = () => (
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
    <line x1="12" y1="17" x2="12" y2="22" />
    <path d="M5 17H19V15L17 9V4H18V2H6V4H7V9L5 15V17Z" />
  </svg>
);
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
const DownloadIcon = () => (
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
    <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
    <polyline points="7 10 12 15 17 10" />
    <line x1="12" y1="15" x2="12" y2="3" />
  </svg>
);
const EraserIcon = () => (
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
    <path d="M20 20H7L3 16l9-9 8 8-3.5 3.5" />
    <path d="M6.5 17.5l-1-1" />
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

export interface SessionContextMenuProps {
  sessionId: string;
  sessionTitle: string | null;
  x: number;
  y: number;
  isPinned: boolean;
  hasMessages: boolean;
  onClose: () => void;
  onRename: () => void;
  onExportMarkdown: () => Promise<void>;
  onExportJson: () => Promise<void>;
  onClearMessages: () => void;
  onPin: () => void;
  onDelete: () => void;
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
        background: hovered && !disabled ? 'var(--bg-2)' : 'transparent',
        color: disabled ? 'var(--text-3)' : danger ? 'var(--danger)' : 'var(--text)',
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

export default function SessionContextMenu({
  sessionId: _sessionId,
  sessionTitle: _sessionTitle,
  x,
  y,
  isPinned,
  hasMessages,
  onClose,
  onRename,
  onExportMarkdown,
  onExportJson,
  onClearMessages,
  onPin,
  onDelete,
}: SessionContextMenuProps) {
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
      <div
        style={{
          ...menuStyle,
          top: y,
          left: x,
        }}
        role="menu"
        aria-label="会话操作菜单"
      >
        <MenuItem
          label={isPinned ? '取消置顶' : '置顶'}
          icon={<PinIcon />}
          onClick={() => {
            onPin();
            onClose();
          }}
        />
        <MenuItem
          label="重命名"
          icon={<PencilIcon />}
          onClick={() => {
            onRename();
            onClose();
          }}
        />
        <hr style={sepStyle} />
        <MenuItem
          label="导出 Markdown"
          icon={<DownloadIcon />}
          onClick={() => {
            void onExportMarkdown();
            onClose();
          }}
        />
        <MenuItem
          label="导出 JSON"
          icon={<DownloadIcon />}
          onClick={() => {
            void onExportJson();
            onClose();
          }}
        />
        <hr style={sepStyle} />
        <MenuItem
          label="清空消息"
          icon={<EraserIcon />}
          onClick={() => {
            onClearMessages();
            onClose();
          }}
          disabled={!hasMessages}
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
        />
      </div>
    </>
  );
}
