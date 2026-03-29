import React from 'react';

export function FileBreadcrumb({
  path,
  onNavigate,
}: {
  path: string;
  onNavigate?: (partialPath: string) => void;
}) {
  const parts = path.split('/').filter(Boolean);

  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 2,
        fontSize: 11,
        color: 'var(--text-3)',
        overflow: 'hidden',
        flexShrink: 0,
        minWidth: 0,
      }}
    >
      {parts.map((part, i) => {
        const partialPath = '/' + parts.slice(0, i + 1).join('/');
        const isLast = i === parts.length - 1;
        return (
          <React.Fragment key={partialPath}>
            {i > 0 && (
              <span style={{ color: 'var(--text-3)', opacity: 0.5, flexShrink: 0 }}>/</span>
            )}
            {isLast ? (
              <span
                style={{
                  color: 'var(--text)',
                  fontWeight: 600,
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  whiteSpace: 'nowrap',
                }}
              >
                {part}
              </span>
            ) : (
              <button
                type="button"
                onClick={() => onNavigate?.(partialPath)}
                style={{
                  background: 'none',
                  border: 'none',
                  padding: 0,
                  cursor: onNavigate ? 'pointer' : 'default',
                  color: 'var(--text-3)',
                  fontSize: 'inherit',
                  flexShrink: 0,
                  maxWidth: 80,
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  whiteSpace: 'nowrap',
                }}
              >
                {part}
              </button>
            )}
          </React.Fragment>
        );
      })}
    </div>
  );
}
