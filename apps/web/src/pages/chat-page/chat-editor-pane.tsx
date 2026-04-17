import React from 'react';
import { FileEditorPanel } from '../../components/FileEditorPanel.js';
import type { OpenFile } from '../../hooks/useFileEditor.js';

export interface ChatEditorPaneProps {
  editorMode: boolean;
  splitPos: number;
  splitDragging: React.MutableRefObject<boolean>;
  editorPaneRef: React.RefObject<HTMLDivElement | null>;
  handleSplitMouseDown: (e: React.MouseEvent) => void;
  fileEditor: {
    openFiles: OpenFile[];
    activeFile: OpenFile | null;
    activeFilePath: string | null;
    isDirty: (path: string) => boolean;
    saveError: string | null;
    setActiveFilePath: (path: string | null) => void;
    closeFile: (path: string) => void;
    updateContent: (path: string, content: string) => void;
  };
  saving: boolean;
  handleSaveFile: (path: string) => Promise<void>;
}

export function ChatEditorPane({
  editorMode,
  splitPos,
  splitDragging,
  editorPaneRef,
  handleSplitMouseDown,
  fileEditor,
  saving,
  handleSaveFile,
}: ChatEditorPaneProps) {
  return (
    <>
      <button
        type="button"
        aria-label="拖动调整编辑器宽度"
        onMouseDown={handleSplitMouseDown}
        disabled={!editorMode}
        style={{
          width: editorMode ? 5 : 0,
          flexShrink: 0,
          cursor: editorMode ? 'col-resize' : 'default',
          background: 'var(--border-subtle)',
          transition: splitDragging.current
            ? 'none'
            : 'width 240ms ease, opacity 180ms ease, background 150ms ease',
          zIndex: 10,
          border: 'none',
          padding: 0,
          opacity: editorMode ? 1 : 0,
          pointerEvents: editorMode ? 'auto' : 'none',
        }}
      />
      <div
        ref={editorPaneRef}
        aria-hidden={!editorMode}
        style={{
          flex: '0 0 auto',
          width: editorMode ? `calc(${100 - splitPos}% - 2.5px)` : 0,
          minWidth: 0,
          overflow: 'hidden',
          display: 'flex',
          flexDirection: 'column',
          borderLeft: editorMode ? '1px solid var(--border)' : '1px solid transparent',
          opacity: editorMode ? 1 : 0,
          transform: editorMode ? 'translateX(0)' : 'translateX(10px)',
          pointerEvents: editorMode ? 'auto' : 'none',
          transition: splitDragging.current
            ? 'none'
            : 'width 240ms ease, opacity 180ms ease, transform 240ms ease, border-color 180ms ease',
        }}
      >
        <FileEditorPanel
          files={fileEditor.openFiles}
          activeFile={fileEditor.activeFile}
          activeFilePath={fileEditor.activeFilePath}
          isDirty={fileEditor.isDirty}
          saving={saving}
          saveError={fileEditor.saveError}
          onActivate={fileEditor.setActiveFilePath}
          onClose={fileEditor.closeFile}
          onChange={fileEditor.updateContent}
          onSave={handleSaveFile}
        />
      </div>
    </>
  );
}
