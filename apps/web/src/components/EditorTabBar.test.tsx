// @vitest-environment jsdom

import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { OpenFile } from '../hooks/useFileEditor.js';
import { EditorTabBar } from './EditorTabBar.js';

const sampleFile = {
  path: '/workspace/src/EditorTabBar.tsx',
  name: 'EditorTabBar.tsx',
  content: 'export {}',
  originalContent: 'export {}',
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

describe('EditorTabBar', () => {
  it('renders activate and close actions as sibling buttons', async () => {
    await act(async () => {
      root!.render(
        <EditorTabBar
          files={[sampleFile]}
          activeFilePath={sampleFile.path}
          isDirty={() => false}
          isPreviewAvailable={() => true}
          onActivate={vi.fn()}
          onClose={vi.fn()}
          onPreview={vi.fn()}
          previewFilePath={null}
        />,
      );
    });

    const buttons = container!.querySelectorAll('button');

    expect(buttons).toHaveLength(3);
    expect(buttons[0]?.textContent).toContain(sampleFile.name);
    expect(buttons[0]?.querySelector('button')).toBeNull();
    expect(buttons[1]?.getAttribute('aria-label')).toBe(`预览 ${sampleFile.name}`);
    expect(buttons[2]?.getAttribute('aria-label')).toBe(`关闭 ${sampleFile.name}`);
  });

  it('keeps close clicks from activating the file tab', async () => {
    const onActivate = vi.fn();
    const onClose = vi.fn();

    await act(async () => {
      root!.render(
        <EditorTabBar
          files={[sampleFile]}
          activeFilePath={sampleFile.path}
          isDirty={() => true}
          isPreviewAvailable={() => true}
          onActivate={onActivate}
          onClose={onClose}
          onPreview={vi.fn()}
          previewFilePath={null}
        />,
      );
    });

    const buttons = container!.querySelectorAll('button');
    const activateButton = buttons[0];
    const closeButton = buttons[2];

    expect(activateButton).toBeDefined();
    expect(closeButton).toBeDefined();

    act(() => {
      closeButton?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });

    expect(onClose).toHaveBeenCalledWith(sampleFile.path);
    expect(onActivate).not.toHaveBeenCalled();

    act(() => {
      activateButton?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });

    expect(onActivate).toHaveBeenCalledWith(sampleFile.path);
  });

  it('fires preview action without triggering activate action', async () => {
    const onActivate = vi.fn();
    const onPreview = vi.fn();

    await act(async () => {
      root!.render(
        <EditorTabBar
          files={[sampleFile]}
          activeFilePath={sampleFile.path}
          isDirty={() => false}
          isPreviewAvailable={() => true}
          onActivate={onActivate}
          onClose={vi.fn()}
          onPreview={onPreview}
          previewFilePath={sampleFile.path}
        />,
      );
    });

    const buttons = container!.querySelectorAll('button');
    const previewButton = buttons[1];

    act(() => {
      previewButton?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });

    expect(onPreview).toHaveBeenCalledWith(sampleFile.path);
    expect(onActivate).not.toHaveBeenCalled();
  });
});
