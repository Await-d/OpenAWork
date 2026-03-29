// @vitest-environment jsdom

import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { OpenFile } from '../hooks/useFileEditor.js';
import { FileEditorPanel } from './FileEditorPanel.js';

vi.mock('@monaco-editor/react', () => ({
  default: () => <div data-testid="monaco-editor">mocked editor</div>,
}));

const htmlFile = {
  path: '/workspace/src/index.html',
  name: 'index.html',
  content: '<div>preview</div>',
  originalContent: '<div>preview</div>',
  language: 'html',
} satisfies OpenFile;

const tsxFile = {
  path: '/workspace/src/App.tsx',
  name: 'App.tsx',
  content: 'export function App() { return <div />; }',
  originalContent: 'export function App() { return <div />; }',
  language: 'typescript',
} satisfies OpenFile;

let root: Root | null = null;
let container: HTMLDivElement | null = null;

beforeEach(() => {
  (
    globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
  ).IS_REACT_ACT_ENVIRONMENT = true;
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  if (root) {
    act(() => {
      root?.unmount();
    });
  }
  root = null;
  container?.remove();
  container = null;
  delete (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean })
    .IS_REACT_ACT_ENVIRONMENT;
});

describe('FileEditorPanel', () => {
  it('jumps to preview mode from the opened file tab action', async () => {
    await act(async () => {
      root!.render(
        <FileEditorPanel
          files={[htmlFile]}
          activeFile={htmlFile}
          activeFilePath={htmlFile.path}
          isDirty={() => false}
          onActivate={vi.fn()}
          onClose={vi.fn()}
          onChange={vi.fn()}
          onSave={vi.fn()}
        />,
      );
    });

    const previewJumpButton = container?.querySelector(
      `[aria-label="预览 ${htmlFile.name}"]`,
    ) as HTMLButtonElement | null;

    expect(previewJumpButton).not.toBeNull();

    act(() => {
      previewJumpButton?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });

    const previewFrame = container?.querySelector(
      '[data-testid="file-editor-preview-frame"]',
    ) as HTMLIFrameElement | null;
    const previewBody = container?.querySelector(
      '[data-testid="file-editor-preview-body"]',
    ) as HTMLDivElement | null;

    expect(previewFrame).not.toBeNull();
    expect(previewBody).not.toBeNull();
    expect(previewFrame?.getAttribute('title')).toBe('HTML 预览');
    expect(previewFrame?.getAttribute('sandbox')).toBe('');
    expect(previewBody?.style.boxSizing).toBe('border-box');
    expect(previewFrame?.style.minHeight).toBe('320px');
  });

  it('does not expose preview controls for unsupported file types', async () => {
    await act(async () => {
      root!.render(
        <FileEditorPanel
          files={[tsxFile]}
          activeFile={tsxFile}
          activeFilePath={tsxFile.path}
          isDirty={() => false}
          onActivate={vi.fn()}
          onClose={vi.fn()}
          onChange={vi.fn()}
          onSave={vi.fn()}
        />,
      );
    });

    expect(container?.querySelector(`[aria-label="预览 ${tsxFile.name}"]`)).toBeNull();
    expect(container?.textContent).toContain('当前文件暂不支持预览');
    expect(container?.querySelector('[data-testid="file-editor-preview-frame"]')).toBeNull();
  });
});
