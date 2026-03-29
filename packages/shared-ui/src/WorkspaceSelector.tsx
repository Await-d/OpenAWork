import React, { useState } from 'react';

export interface WorkspaceSelectorProps {
  currentPath?: string;
  onSelect: (path: string) => Promise<void> | void;
  onClear?: () => void;
  validatePath?: (path: string) => Promise<{ valid: boolean; error?: string }>;
  loading?: boolean;
  style?: React.CSSProperties;
}

export function WorkspaceSelector({
  currentPath,
  onSelect,
  onClear,
  validatePath,
  loading = false,
  style,
}: WorkspaceSelectorProps): React.ReactElement {
  const [inputValue, setInputValue] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [changing, setChanging] = useState(false);

  const containerStyle: React.CSSProperties = {
    display: 'flex',
    flexDirection: 'column',
    gap: '8px',
    padding: '12px',
    background: 'var(--color-surface)',
    border: '1px solid var(--color-border)',
    borderRadius: '6px',
    color: 'var(--color-text)',
    ...style,
  };

  const inputStyle: React.CSSProperties = {
    flex: 1,
    padding: '6px 10px',
    background: 'var(--color-surface)',
    border: '1px solid var(--color-border)',
    borderRadius: '4px',
    color: 'var(--color-text)',
    fontFamily: 'inherit',
    fontSize: '14px',
    outline: 'none',
  };

  const btnStyle = (primary?: boolean): React.CSSProperties => ({
    padding: '6px 14px',
    border: primary ? 'none' : '1px solid var(--color-border)',
    borderRadius: '4px',
    background: primary ? 'var(--color-accent)' : 'transparent',
    color: primary ? '#fff' : 'var(--color-text)',
    cursor: loading ? 'not-allowed' : 'pointer',
    opacity: loading ? 0.6 : 1,
    fontSize: '13px',
    fontFamily: 'inherit',
  });

  const handleSubmit = async (): Promise<void> => {
    const path = inputValue.trim();
    if (!path) return;
    setError(null);
    if (validatePath) {
      const result = await validatePath(path);
      if (!result.valid) {
        setError(result.error ?? '路径无效');
        return;
      }
    }
    await onSelect(path);
    setInputValue('');
    setChanging(false);
  };

  if (currentPath && !changing) {
    return (
      <div style={containerStyle}>
        <span
          style={{
            fontFamily: 'monospace',
            fontSize: '13px',
            color: 'var(--color-text)',
            wordBreak: 'break-all',
          }}
        >
          {currentPath}
        </span>
        <div style={{ display: 'flex', gap: '8px' }}>
          <button
            type="button"
            style={btnStyle()}
            disabled={loading}
            onClick={() => {
              setChanging(true);
              setInputValue(currentPath);
              setError(null);
            }}
          >
            {loading ? '...' : '更改'}
          </button>
          {onClear && (
            <button type="button" style={btnStyle()} disabled={loading} onClick={onClear}>
              {loading ? '...' : '解除'}
            </button>
          )}
        </div>
      </div>
    );
  }

  return (
    <div style={containerStyle}>
      <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
        <input
          style={inputStyle}
          type="text"
          value={inputValue}
          placeholder="/path/to/workspace"
          disabled={loading}
          onChange={(e) => {
            setInputValue(e.target.value);
            setError(null);
          }}
          onKeyDown={(e) => {
            if (e.key === 'Enter') void handleSubmit();
          }}
        />
        <button
          type="button"
          style={btnStyle(true)}
          disabled={loading}
          onClick={() => void handleSubmit()}
        >
          {loading ? '...' : '设置工作区'}
        </button>
        {changing && currentPath && (
          <button
            type="button"
            style={btnStyle()}
            disabled={loading}
            onClick={() => {
              setChanging(false);
              setError(null);
            }}
          >
            取消
          </button>
        )}
      </div>
      {error && <span style={{ color: 'red', fontSize: '12px' }}>{error}</span>}
    </div>
  );
}
