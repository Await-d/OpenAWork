import React, { useEffect, useMemo, useState } from 'react';
import { tokens } from './tokens.js';
import { UnifiedCodeDiff } from './UnifiedCodeDiff.js';

export interface ToolDiffFileView {
  afterText: string;
  beforeText: string;
  filePath: string;
  status?: 'added' | 'deleted' | 'modified';
  summary: string;
}

export interface ToolDiffCollectionProps {
  activePath?: string;
  chrome?: 'default' | 'minimal';
  files: ToolDiffFileView[];
  maxHeight?: number;
  onActivePathChange?: (path: string) => void;
  viewMode?: 'split' | 'unified';
}

function trimFilePath(value: string): string {
  const segments = value.split('/').filter(Boolean);
  return segments.slice(-2).join('/') || value;
}

export function ToolDiffCollection({
  activePath,
  chrome = 'default',
  files,
  maxHeight = 360,
  onActivePathChange,
  viewMode = 'unified',
}: ToolDiffCollectionProps) {
  const normalizedFiles = useMemo(() => files.filter((file) => file.filePath.length > 0), [files]);
  const [internalActivePath, setInternalActivePath] = useState(normalizedFiles[0]?.filePath ?? '');
  const resolvedActivePath = activePath ?? internalActivePath;

  useEffect(() => {
    if (!normalizedFiles.some((file) => file.filePath === resolvedActivePath)) {
      setInternalActivePath(normalizedFiles[0]?.filePath ?? '');
    }
  }, [normalizedFiles, resolvedActivePath]);

  const activeFile =
    normalizedFiles.find((file) => file.filePath === resolvedActivePath) ?? normalizedFiles[0];
  if (!activeFile) {
    return null;
  }

  const handleSelectFile = (path: string) => {
    if (activePath === undefined) {
      setInternalActivePath(path);
    }
    onActivePathChange?.(path);
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      {normalizedFiles.length > 1 && (
        <div
          style={{
            display: 'flex',
            flexWrap: 'wrap',
            gap: 6,
          }}
        >
          {normalizedFiles.map((file) => {
            const active = file.filePath === activeFile.filePath;
            return (
              <button
                key={file.filePath}
                type="button"
                onClick={() => handleSelectFile(file.filePath)}
                style={{
                  appearance: 'none',
                  border: active
                    ? '1px solid color-mix(in oklab, var(--color-accent, #60a5fa) 55%, transparent)'
                    : '1px solid rgba(148, 163, 184, 0.16)',
                  background: active
                    ? 'color-mix(in srgb, var(--color-accent, #60a5fa) 12%, transparent)'
                    : 'transparent',
                  borderRadius: tokens.radius.md,
                  padding: '6px 10px',
                  minWidth: 0,
                  cursor: 'pointer',
                  display: 'flex',
                  alignItems: 'center',
                  gap: 6,
                  maxWidth: '100%',
                }}
                title={file.filePath}
              >
                <span
                  aria-hidden="true"
                  style={{
                    width: 6,
                    height: 6,
                    borderRadius: 999,
                    flexShrink: 0,
                    background:
                      file.status === 'added'
                        ? '#34d399'
                        : file.status === 'deleted'
                          ? '#f87171'
                          : 'var(--color-muted, #94a3b8)',
                  }}
                />
                <span
                  style={{
                    minWidth: 0,
                    fontSize: 11,
                    fontWeight: active ? 700 : 600,
                    color: active ? 'var(--color-text, #f8fafc)' : 'var(--color-muted, #94a3b8)',
                    whiteSpace: 'nowrap',
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                  }}
                >
                  {trimFilePath(file.filePath)}
                </span>
              </button>
            );
          })}
        </div>
      )}
      <UnifiedCodeDiff
        beforeText={activeFile.beforeText}
        afterText={activeFile.afterText}
        chrome={chrome}
        filePath={activeFile.filePath}
        maxHeight={maxHeight}
        viewMode={viewMode}
      />
    </div>
  );
}
