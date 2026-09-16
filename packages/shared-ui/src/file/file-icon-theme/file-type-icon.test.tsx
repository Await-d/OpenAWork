// @vitest-environment jsdom

import { cleanup, fireEvent, render, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { FileIconThemeProvider, FileTypeIcon, FolderTypeIcon } from '../../index.js';
import type { MaterialIconManifest } from '../../index.js';

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

function findImg(container: HTMLElement): HTMLImageElement | null {
  return container.querySelector('img');
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('FileTypeIcon', () => {
  it('清单加载完成前渲染通用轮廓且不渲染图片', () => {
    stubFetchPending();
    const { container } = render(
      <FileIconThemeProvider basePath="/file-icons-pending">
        <FileTypeIcon path="/project/src/index.ts" />
      </FileIconThemeProvider>,
    );

    expect(findImg(container)).toBeNull();
    expect(container.querySelector('svg')).not.toBeNull();
  });

  it('minimal 主题渲染线条 SVG 且不请求清单', () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    const { container } = render(
      <FileIconThemeProvider theme="minimal">
        <FileTypeIcon path="/project/src/index.ts" />
      </FileIconThemeProvider>,
    );

    expect(findImg(container)).toBeNull();
    expect(container.querySelector('svg')).not.toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('material 主题在清单就绪后渲染真实图标', async () => {
    stubFetchWithManifest();
    const { container } = render(
      <FileIconThemeProvider basePath="/file-icons">
        <FileTypeIcon path="/project/src/index.ts" />
      </FileIconThemeProvider>,
    );

    const img = await waitFor(() => {
      const found = findImg(container);
      if (!found) throw new Error('图标尚未渲染');
      return found;
    });

    expect(img.getAttribute('src')?.endsWith('/file-icons/typescript.svg')).toBe(true);
    expect(img.getAttribute('src')).toBe('/file-icons/typescript.svg');
  });

  it('图片加载失败时降级为通用轮廓', async () => {
    stubFetchWithManifest();
    const { container } = render(
      <FileIconThemeProvider basePath="/file-icons-error">
        <FileTypeIcon path="/project/src/index.ts" />
      </FileIconThemeProvider>,
    );

    const img = await waitFor(() => {
      const found = findImg(container);
      if (!found) throw new Error('图标尚未渲染');
      return found;
    });

    fireEvent.error(img);

    await waitFor(() => {
      expect(findImg(container)).toBeNull();
    });
    expect(container.querySelector('svg')).not.toBeNull();
  });
});

describe('FolderTypeIcon', () => {
  it('material 主题目录图标按展开态选择图标', async () => {
    stubFetchWithManifest();
    const { container } = render(
      <FileIconThemeProvider basePath="/file-icons-folder">
        <FolderTypeIcon name="src" open />
      </FileIconThemeProvider>,
    );

    const img = await waitFor(() => {
      const found = findImg(container);
      if (!found) throw new Error('目录图标尚未渲染');
      return found;
    });

    expect(img.getAttribute('src')).toBe('/file-icons-folder/folder-src-open.svg');
  });
});
