// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { FileIconThemeProvider, FileTreePanel } from '../index.js';
import type { FileTreeNode, MaterialIconManifest } from '../index.js';

const MANIFEST: MaterialIconManifest = {
  file: 'file',
  folder: 'folder',
  folderExpanded: 'folder-open',
  rootFolder: 'folder-root',
  rootFolderExpanded: 'folder-root-open',
  fileExtensions: { ts: 'typescript' },
  fileNames: { 'package.json': 'npm' },
  folderNames: { src: 'folder-src' },
  folderNamesExpanded: { src: 'folder-src-open' },
};

const NODES: FileTreeNode[] = [
  {
    path: 'src',
    name: 'src',
    type: 'directory',
    children: [
      {
        path: 'src/index.ts',
        name: 'index.ts',
        type: 'file',
        status: 'modified',
        linesAdded: 3,
        linesDeleted: 1,
      },
      { path: 'src/logo.png', name: 'logo.png', type: 'file' },
    ],
  },
];

function stubFetchWithManifest() {
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => MANIFEST,
    })),
  );
}

function stubFetchPending() {
  const pending = new Promise<never>(() => {});
  vi.stubGlobal(
    'fetch',
    vi.fn(() => pending),
  );
}

function imgSrcs(container: HTMLElement): string[] {
  return Array.from(container.querySelectorAll('img')).map((img) => img.getAttribute('src') ?? '');
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('FileTreePanel 文件图标主题', () => {
  it('清单就绪时目录与文件渲染类型图标，git 状态角标与展开箭头保留', async () => {
    stubFetchWithManifest();
    const { container } = render(
      <FileIconThemeProvider basePath="/file-icons-filetree">
        <FileTreePanel nodes={NODES} />
      </FileIconThemeProvider>,
    );

    await waitFor(() => {
      expect(imgSrcs(container).length).toBe(3);
    });

    expect(imgSrcs(container)).toEqual([
      '/file-icons-filetree/folder-src-open.svg',
      '/file-icons-filetree/typescript.svg',
      '/file-icons-filetree/file.svg',
    ]);
    // 状态文件同时保留类型图标与 git 状态角标
    expect(container.textContent).toContain('✏️');
    expect(container.textContent).toContain('▾');
  });

  it('清单加载中降级为通用轮廓，状态角标与展开箭头不受影响', () => {
    stubFetchPending();
    const { container } = render(
      <FileIconThemeProvider basePath="/file-icons-filetree-pending">
        <FileTreePanel nodes={NODES} />
      </FileIconThemeProvider>,
    );

    expect(container.querySelectorAll('img').length).toBe(0);
    expect(container.querySelectorAll('svg').length).toBe(3);
    expect(container.textContent).toContain('✏️');
    expect(container.textContent).toContain('▾');
  });

  it('点击目录行折叠后切换为闭合目录图标并隐藏子级', async () => {
    stubFetchWithManifest();
    const { container } = render(
      <FileIconThemeProvider basePath="/file-icons-filetree-toggle">
        <FileTreePanel nodes={NODES} />
      </FileIconThemeProvider>,
    );

    await waitFor(() => {
      expect(container.querySelector('img[src$="folder-src-open.svg"]')).not.toBeNull();
    });

    fireEvent.click(screen.getByText('src'));

    await waitFor(() => {
      expect(container.querySelector('img[src$="folder-src.svg"]')).not.toBeNull();
    });
    expect(container.textContent).not.toContain('index.ts');
    expect(container.textContent).toContain('▸');
  });
});
