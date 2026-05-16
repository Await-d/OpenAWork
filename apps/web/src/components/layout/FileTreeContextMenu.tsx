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

const OpenIcon = () => (
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
    <path d="M14 3h7v7" />
    <path d="M10 14 21 3" />
    <path d="M21 14v5a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5" />
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

const RelativePathIcon = () => (
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
    <path d="M4 7h16" />
    <path d="M4 12h10" />
    <path d="M4 17h7" />
    <path d="m15 16 3 3 3-3" />
    <path d="M18 8v11" />
  </svg>
);

const MessageIcon = () => (
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
    <path d="M21 15a4 4 0 0 1-4 4H8l-5 3V7a4 4 0 0 1 4-4h10a4 4 0 0 1 4 4z" />
    <path d="M8 9h8" />
    <path d="M8 13h5" />
  </svg>
);

const SparkSessionIcon = () => (
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
    <path d="M12 3 9.8 8.2 4 10.4l5.8 2.1L12 18l2.2-5.5 5.8-2.1-5.8-2.2z" />
    <path d="M19 17v4" />
    <path d="M17 19h4" />
  </svg>
);

const DeleteIcon = () => (
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
    <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
    <line x1="10" y1="11" x2="10" y2="17" />
    <line x1="14" y1="11" x2="14" y2="17" />
  </svg>
);

const RenameIcon = () => (
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
    <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" />
    <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" />
  </svg>
);

export interface FileTreeContextMenuProps {
  x: number;
  y: number;
  targetLabel: string;
  targetType: 'root' | 'file' | 'directory';
  relativePath: string | null;
  canOpen: boolean;
  canCreateSession: boolean;
  onClose: () => void;
  onOpen: () => void;
  onCopyPath: () => void;
  onCopyRelativePath: () => void;
  onReferenceInChat: () => void;
  onCreateSession: () => void;
  onCreateFile: () => void;
  onCreateFolder: () => void;
  onRefresh: () => void;
  onDelete?: () => void;
  onRename?: () => void;
}

const menuStyle: React.CSSProperties = {
  position: 'fixed',
  zIndex: 9999,
  background: 'var(--surface)',
  border: '1px solid var(--border)',
  borderRadius: 10,
  padding: '6px 0',
  minWidth: 232,
  boxShadow: '0 14px 34px rgba(0,0,0,.24)',
};

const dividerStyle: React.CSSProperties = {
  height: 1,
  background: 'var(--border-subtle)',
  margin: '5px 8px',
};

function MenuItem({
  label,
  icon,
  onClick,
  disabled = false,
  danger = false,
}: {
  label: string;
  icon: React.ReactNode;
  onClick: () => void;
  disabled?: boolean;
  danger?: boolean;
}) {
  const [hovered, setHovered] = useState(false);
  return (
    <button
      type="button"
      disabled={disabled}
      role="menuitem"
      onMouseDown={(event) => event.preventDefault()}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      onClick={onClick}
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 9,
        width: '100%',
        padding: '7px 12px',
        border: 'none',
        background:
          hovered && !disabled
            ? danger
              ? 'color-mix(in oklch, var(--danger) 10%, transparent)'
              : 'var(--bg-2)'
            : 'transparent',
        color: disabled ? 'var(--text-3)' : danger ? 'var(--danger)' : 'var(--text)',
        fontSize: 12,
        textAlign: 'left',
        cursor: disabled ? 'not-allowed' : 'pointer',
        opacity: disabled ? 0.55 : 1,
        transition: 'background 80ms ease, color 80ms ease',
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
  relativePath,
  canOpen,
  canCreateSession,
  onClose,
  onOpen,
  onCopyPath,
  onCopyRelativePath,
  onReferenceInChat,
  onCreateSession,
  onCreateFile,
  onCreateFolder,
  onRefresh,
  onDelete,
  onRename,
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
        {targetType === 'file' && (
          <MenuItem
            label="打开文件"
            icon={<OpenIcon />}
            disabled={!canOpen}
            onClick={() => {
              onOpen();
              onClose();
            }}
          />
        )}
        <MenuItem
          label="复制完整路径"
          icon={<CopyIcon />}
          onClick={() => {
            onCopyPath();
            onClose();
          }}
        />
        <MenuItem
          label={relativePath ? `复制相对路径：${relativePath}` : '复制相对路径'}
          icon={<RelativePathIcon />}
          disabled={!relativePath}
          onClick={() => {
            onCopyRelativePath();
            onClose();
          }}
        />
        <MenuItem
          label={
            targetType === 'directory' || targetType === 'root'
              ? '引用目录到对话'
              : '引用文件到对话'
          }
          icon={<MessageIcon />}
          onClick={() => {
            onReferenceInChat();
            onClose();
          }}
        />
        {(targetType === 'directory' || targetType === 'root') && (
          <MenuItem
            label="以此目录新建会话"
            icon={<SparkSessionIcon />}
            disabled={!canCreateSession}
            onClick={() => {
              onCreateSession();
              onClose();
            }}
          />
        )}
        <div style={dividerStyle} />
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
        {targetType !== 'root' && (onRename || onDelete) && <div style={dividerStyle} />}
        {targetType !== 'root' && onRename && (
          <MenuItem
            label={`重命名${targetType === 'directory' ? '文件夹' : '文件'}`}
            icon={<RenameIcon />}
            onClick={() => {
              onRename();
              onClose();
            }}
          />
        )}
        {targetType !== 'root' && onDelete && (
          <MenuItem
            label={`删除${targetType === 'directory' ? '文件夹' : '文件'}`}
            icon={<DeleteIcon />}
            onClick={() => {
              onDelete();
              onClose();
            }}
            danger
          />
        )}
      </div>
    </>
  );
}
