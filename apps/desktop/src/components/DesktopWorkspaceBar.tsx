import { useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { useWorkspace } from '../../../web/src/hooks/useWorkspace.js';

interface DesktopWorkspaceBarProps {
  sessionId: string | null;
}

const containerStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: '8px',
  padding: '6px 12px',
  background: 'hsl(var(--surface-1, 220 13% 13%))',
  borderBottom: '1px solid hsl(var(--border, 220 13% 20%))',
  fontFamily: 'inherit',
  fontSize: '13px',
  color: 'hsl(var(--fg, 220 13% 85%))',
  minHeight: '36px',
  userSelect: 'none',
};

const btnStyle: React.CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  gap: '6px',
  padding: '4px 10px',
  border: '1px solid hsl(var(--border, 220 13% 25%))',
  borderRadius: '6px',
  background: 'hsl(var(--surface-2, 220 13% 18%))',
  color: 'hsl(var(--fg, 220 13% 85%))',
  cursor: 'pointer',
  fontSize: '13px',
  fontFamily: 'inherit',
  transition: 'background 0.15s',
};

const clearBtnStyle: React.CSSProperties = {
  ...btnStyle,
  padding: '2px 7px',
  fontSize: '12px',
  color: 'hsl(var(--fg-muted, 220 13% 55%))',
  border: 'none',
  background: 'transparent',
};

const pathStyle: React.CSSProperties = {
  flex: 1,
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  whiteSpace: 'nowrap',
  color: 'hsl(var(--fg-muted, 220 13% 65%))',
};

export default function DesktopWorkspaceBar({ sessionId }: DesktopWorkspaceBarProps) {
  const workspace = useWorkspace(sessionId);
  const [picking, setPicking] = useState(false);

  const basename = workspace.workingDirectory
    ? (workspace.workingDirectory.split('/').filter(Boolean).pop() ?? workspace.workingDirectory)
    : null;

  async function handleOpen() {
    if (picking) return;
    setPicking(true);
    try {
      const result = await invoke<string | null>('pick_folder');
      if (result !== null) {
        await workspace.setWorkspace(result);
      }
    } finally {
      setPicking(false);
    }
  }

  async function handleClear() {
    await workspace.clearWorkspace();
  }

  return (
    <div style={containerStyle}>
      {workspace.workingDirectory ? (
        <>
          <span style={{ fontSize: '15px' }}>📁</span>
          <span style={pathStyle} title={workspace.workingDirectory}>
            {basename}
          </span>
          <button
            type="button"
            style={clearBtnStyle}
            onClick={handleClear}
            disabled={workspace.loading}
            aria-label="清除工作区"
          >
            ✕
          </button>
        </>
      ) : (
        <button
          type="button"
          style={btnStyle}
          onClick={handleOpen}
          disabled={picking || workspace.loading || !sessionId}
          aria-label="打开工作区文件夹"
        >
          <span style={{ fontSize: '15px' }}>📁</span>
          {picking ? '选择中…' : '打开工作区'}
        </button>
      )}
      {workspace.error && (
        <span style={{ color: 'hsl(var(--error, 0 72% 60%))', fontSize: '12px' }}>
          {workspace.error}
        </span>
      )}
    </div>
  );
}
