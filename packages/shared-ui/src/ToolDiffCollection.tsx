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
                    ? `1px solid color-mix(in oklab, ${tokens.color.accent} 55%, transparent)`
                    : `1px solid ${tokens.color.borderSubtle}`,
                  background: active
                    ? `color-mix(in srgb, ${tokens.color.accent} 12%, transparent)`
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
                        ? tokens.color.success
                        : file.status === 'deleted'
                          ? tokens.color.danger
                          : tokens.color.muted,
                  }}
                />
                <span
                  style={{
                    minWidth: 0,
                    fontSize: 11,
                    fontWeight: active ? 700 : 600,
                    color: active ? tokens.color.text : tokens.color.muted,
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
