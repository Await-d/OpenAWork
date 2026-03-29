import React, { useState } from 'react';

const FilePlusIcon = () => (
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
    <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
    <polyline points="14 2 14 8 20 8" />
    <line x1="12" y1="12" x2="12" y2="18" />
    <line x1="9" y1="15" x2="15" y2="15" />
  </svg>
);

const FolderPlusIcon = () => (
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
    <line x1="12" y1="11" x2="12" y2="17" />
    <line x1="9" y1="14" x2="15" y2="14" />
  </svg>
);

const RefreshIcon = () => (
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
    <polyline points="23 4 23 10 17 10" />
    <polyline points="1 20 1 14 7 14" />
    <path d="M3.51 9a9 9 0 0 1 14.13-3.36L23 10" />
    <path d="M20.49 15a9 9 0 0 1-14.13 3.36L1 14" />
  </svg>
);

export interface FileTreeContextMenuProps {
  x: number;
  y: number;
  targetLabel: string;
  targetType: 'root' | 'file' | 'directory';
  onClose: () => void;
  onCreateFile: () => void;
  onCreateFolder: () => void;
  onRefresh: () => void;
}

const menuStyle: React.CSSProperties = {
  position: 'fixed',
  zIndex: 9999,
  background: 'var(--surface)',
  border: '1px solid var(--border)',
  borderRadius: 8,
  padding: '4px 0',
  minWidth: 186,
  boxShadow: '0 4px 16px rgba(0,0,0,.18)',
};

function MenuItem({
  label,
  icon,
  onClick,
}: {
  label: string;
  icon: React.ReactNode;
  onClick: () => void;
}) {
  const [hovered, setHovered] = useState(false);
  return (
    <button
      type="button"
      onMouseDown={(event) => event.preventDefault()}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      onClick={onClick}
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 8,
        width: '100%',
        padding: '6px 12px',
        border: 'none',
        background: hovered ? 'var(--bg-2)' : 'transparent',
        color: 'var(--text)',
        fontSize: 12,
        textAlign: 'left',
        cursor: 'pointer',
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

export default function FileTreeContextMenu({
  x,
  y,
  targetLabel,
  targetType,
  onClose,
  onCreateFile,
  onCreateFolder,
  onRefresh,
}: FileTreeContextMenuProps) {
  const baseLabel =
    targetType === 'root'
      ? '根目录'
      : targetType === 'directory'
        ? targetLabel
        : `${targetLabel} 所在目录`;

  return (
    <>
      <button
        type="button"
        aria-label="关闭菜单"
        onClick={onClose}
        onKeyDown={(event) => {
          if (event.key === 'Escape') onClose();
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
      <div style={{ ...menuStyle, top: y, left: x }} role="menu" aria-label="文件树操作菜单">
        <div
          style={{
            padding: '6px 12px 8px',
            borderBottom: '1px solid var(--border-subtle)',
            marginBottom: 4,
          }}
        >
          <div style={{ fontSize: 10, color: 'var(--text-3)', marginBottom: 3 }}>当前位置</div>
          <div
            style={{
              fontSize: 12,
              color: 'var(--text)',
              fontWeight: 600,
              maxWidth: 240,
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
            }}
            title={targetLabel}
          >
            {targetLabel}
          </div>
        </div>
        <MenuItem
          label={`在${baseLabel}中新建文件`}
          icon={<FilePlusIcon />}
          onClick={() => {
            onCreateFile();
            onClose();
          }}
        />
        <MenuItem
          label={`在${baseLabel}中新建文件夹`}
          icon={<FolderPlusIcon />}
          onClick={() => {
            onCreateFolder();
            onClose();
          }}
        />
        <MenuItem
          label={targetType === 'root' ? '刷新文件树' : `刷新${baseLabel}`}
          icon={<RefreshIcon />}
          onClick={() => {
            onRefresh();
            onClose();
          }}
        />
      </div>
    </>
  );
}
