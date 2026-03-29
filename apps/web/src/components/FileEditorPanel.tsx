import React, { lazy, Suspense, useCallback, useEffect, useMemo, useState } from 'react';
import type { OpenFile } from '../hooks/useFileEditor.js';
import { getFilePreviewKind } from '../utils/file-preview.js';
import { EditorTabBar } from './EditorTabBar.js';
import { FileBreadcrumb } from './FileBreadcrumb.js';
import { FilePreviewPane } from './FilePreviewPane.js';

const MonacoEditor = lazy(() =>
  import('@monaco-editor/react').then((m) => ({ default: m.default })),
);

export function FileEditorPanel({
  files,
  activeFile,
  activeFilePath,
  isDirty,
  saving,
  saveError,
  theme,
  onActivate,
  onClose,
  onChange,
  onSave,
}: {
  files: OpenFile[];
  activeFile: OpenFile | null;
  activeFilePath: string | null;
  isDirty: (path: string) => boolean;
  saving?: boolean;
  saveError?: string | null;
  theme?: 'dark' | 'light';
  onActivate: (path: string) => void;
  onClose: (path: string) => void;
  onChange: (path: string, content: string) => void;
  onSave: (path: string) => void;
}) {
  const [panelMode, setPanelMode] = useState<'code' | 'preview'>('code');

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 's') {
        e.preventDefault();
        if (activeFilePath) onSave(activeFilePath);
      }
    },
    [activeFilePath, onSave],
  );

  const activePreviewKind = useMemo(
    () => (activeFile ? getFilePreviewKind(activeFile.path) : null),
    [activeFile],
  );

  useEffect(() => {
    if (!activePreviewKind && panelMode === 'preview') {
      setPanelMode('code');
    }
  }, [activePreviewKind, panelMode]);

  const handlePreview = useCallback(
    (path: string) => {
      onActivate(path);
      setPanelMode('preview');
    },
    [onActivate],
  );

  return (
    <section
      aria-label="文件编辑器"
      tabIndex={-1}
      style={{
        display: 'flex',
        flexDirection: 'column',
        height: '100%',
        minWidth: 0,
        outline: 'none',
      }}
      onKeyDown={handleKeyDown}
    >
      <EditorTabBar
        files={files}
        activeFilePath={activeFilePath}
        isDirty={isDirty}
        isPreviewAvailable={(path) => getFilePreviewKind(path) !== null}
        onActivate={onActivate}
        onClose={onClose}
        onPreview={handlePreview}
        previewFilePath={panelMode === 'preview' ? activeFilePath : null}
      />
      {activeFile ? (
        <>
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              gap: 8,
              padding: '4px 10px',
              borderBottom: '1px solid var(--border-subtle)',
              flexShrink: 0,
              background: 'var(--surface)',
            }}
          >
            <FileBreadcrumb path={activeFile.path} />
            <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexShrink: 0 }}>
              {activePreviewKind ? (
                <div
                  style={{
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: 4,
                    padding: 2,
                    borderRadius: 8,
                    background: 'var(--bg)',
                    border: '1px solid var(--border-subtle)',
                  }}
                >
                  <button
                    type="button"
                    aria-pressed={panelMode === 'code'}
                    onClick={() => setPanelMode('code')}
                    style={{
                      height: 24,
                      padding: '0 10px',
                      borderRadius: 6,
                      border: 'none',
                      background: panelMode === 'code' ? 'var(--surface)' : 'transparent',
                      color: panelMode === 'code' ? 'var(--text)' : 'var(--text-3)',
                      fontSize: 11,
                      fontWeight: panelMode === 'code' ? 600 : 500,
                      cursor: 'pointer',
                    }}
                  >
                    代码
                  </button>
                  <button
                    type="button"
                    aria-pressed={panelMode === 'preview'}
                    onClick={() => setPanelMode('preview')}
                    style={{
                      height: 24,
                      padding: '0 10px',
                      borderRadius: 6,
                      border: 'none',
                      background: panelMode === 'preview' ? 'var(--surface)' : 'transparent',
                      color: panelMode === 'preview' ? 'var(--text)' : 'var(--text-3)',
                      fontSize: 11,
                      fontWeight: panelMode === 'preview' ? 600 : 500,
                      cursor: 'pointer',
                    }}
                  >
                    预览
                  </button>
                </div>
              ) : (
                <span style={{ fontSize: 11, color: 'var(--text-3)' }}>当前文件暂不支持预览</span>
              )}
              {saveError && (
                <span style={{ fontSize: 11, color: 'var(--danger)' }}>{saveError}</span>
              )}
              {isDirty(activeFile.path) && (
                <button
                  type="button"
                  disabled={saving}
                  onClick={() => onSave(activeFile.path)}
                  style={{
                    height: 24,
                    padding: '0 10px',
                    borderRadius: 6,
                    border: 'none',
                    background: 'var(--accent)',
                    color: 'var(--accent-text)',
                    fontSize: 11,
                    fontWeight: 600,
                    cursor: saving ? 'not-allowed' : 'pointer',
                    opacity: saving ? 0.6 : 1,
                  }}
                >
                  {saving ? '保存中…' : '保存 ⌘S'}
                </button>
              )}
            </div>
          </div>
          <div style={{ flex: 1, minHeight: 0 }}>
            {panelMode === 'preview' && activePreviewKind ? (
              <FilePreviewPane path={activeFile.path} content={activeFile.content} />
            ) : (
              <Suspense
                fallback={
                  <div style={{ padding: 24, fontSize: 12, color: 'var(--text-3)' }}>
                    加载编辑器…
                  </div>
                }
              >
                <MonacoEditor
                  key={activeFile.path}
                  height="100%"
                  language={activeFile.language}
                  value={activeFile.content}
                  theme={theme === 'light' ? 'vs' : 'vs-dark'}
                  onChange={(val) => {
                    if (val !== undefined) onChange(activeFile.path, val);
                  }}
                  options={{
                    fontSize: 12,
                    minimap: { enabled: false },
                    scrollBeyondLastLine: false,
                    wordWrap: 'on',
                    tabSize: 2,
                    renderWhitespace: 'none',
                    lineNumbers: 'on',
                    folding: true,
                    automaticLayout: true,
                  }}
                />
              </Suspense>
            )}
          </div>
        </>
      ) : (
        <div
          style={{
            flex: 1,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            flexDirection: 'column',
            gap: 8,
            color: 'var(--text-3)',
            fontSize: 12,
          }}
        >
          <svg
            width="32"
            height="32"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.5"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
            style={{ opacity: 0.4 }}
          >
            <path d="M13 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9z" />
            <polyline points="13 2 13 9 20 9" />
          </svg>
          <span>从左侧文件树选择文件打开</span>
        </div>
      )}
    </section>
  );
}
