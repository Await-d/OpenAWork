// @vitest-environment jsdom

import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import WorkspacePickerModal from './WorkspacePickerModal.js';

interface FileTreeNode {
  path: string;
  name: string;
  type: 'file' | 'directory';
  children?: FileTreeNode[];
}

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

async function renderModal(props?: Partial<React.ComponentProps<typeof WorkspacePickerModal>>) {
  const fetchRootPath = vi.fn(async () => '/workspace');
  const fetchWorkspaceRoots = vi.fn(async () => ['/workspace', '/second-workspace']);
  const fetchTree = vi.fn(async (path: string): Promise<FileTreeNode[]> => {
    if (path === '/workspace') {
      return [
        { path: '/workspace/alpha', name: 'alpha', type: 'directory' },
        { path: '/workspace/beta', name: 'beta', type: 'directory' },
        { path: '/workspace/readme.md', name: 'readme.md', type: 'file' },
      ];
    }
    if (path === '/second-workspace') {
      return [{ path: '/second-workspace/mobile', name: 'mobile', type: 'directory' }];
    }
    if (path === '/workspace/alpha') {
      return [{ path: '/workspace/alpha/nested', name: 'nested', type: 'directory' }];
    }
    return [];
  });
  const validatePath = vi.fn(async (path: string) => ({ valid: true, path }));
  const onSelect = vi.fn(async (_path: string) => undefined);

  await act(async () => {
    root!.render(
      <WorkspacePickerModal
        isOpen={true}
        onClose={() => undefined}
        onSelect={onSelect}
        fetchRootPath={fetchRootPath}
        fetchWorkspaceRoots={fetchWorkspaceRoots}
        fetchTree={fetchTree}
        validatePath={validatePath}
        {...props}
      />,
    );
  });

  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });

  return {
    fetchRootPath,
    fetchWorkspaceRoots,
    fetchTree,
    validatePath,
    onSelect,
    rendered: container!,
  };
}

describe('WorkspacePickerModal', () => {
  it('renders clickable directory entries from the workspace root', async () => {
    const { rendered } = await renderModal();

    expect(rendered.textContent).toContain('alpha');
    expect(rendered.textContent).toContain('beta');
    expect(rendered.textContent).not.toContain('readme.md');
  });

  it('navigates into a directory and selects the current folder', async () => {
    const { rendered, onSelect } = await renderModal();

    const alphaButton = Array.from(rendered.querySelectorAll('button')).find((button) =>
      button.textContent?.includes('alpha'),
    );

    act(() => {
      alphaButton?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });

    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(rendered.textContent).toContain('nested');

    const selectCurrent = Array.from(rendered.querySelectorAll('button')).find(
      (button) => button.textContent?.trim() === '选择当前文件夹',
    );

    act(() => {
      selectCurrent?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });

    await act(async () => {
      await Promise.resolve();
    });

    expect(onSelect).toHaveBeenCalledWith('/workspace/alpha');
  });

  it('switches between workspace roots and still allows navigating to parent directories', async () => {
    const { rendered, fetchTree } = await renderModal();

    const rootSelect = rendered.querySelector(
      'select[aria-label="工作区根目录"]',
    ) as HTMLSelectElement | null;

    expect(rootSelect).not.toBeNull();

    act(() => {
      rootSelect!.value = '/second-workspace';
      rootSelect!.dispatchEvent(new Event('change', { bubbles: true }));
    });

    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(fetchTree).toHaveBeenCalledWith('/second-workspace', 1);
    expect(rendered.textContent).toContain('mobile');

    const goUpButton = Array.from(rendered.querySelectorAll('button')).find(
      (button) => button.textContent?.trim() === '上一级',
    ) as HTMLButtonElement | undefined;

    expect(goUpButton).toBeDefined();
    expect(goUpButton?.disabled).toBe(false);

    act(() => {
      goUpButton?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });

    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(fetchTree).toHaveBeenCalledWith('/', 1);
  });

  it('opens an arbitrary absolute path from manual input', async () => {
    const { rendered, fetchTree, validatePath } = await renderModal();

    const pathInput = rendered.querySelector(
      'input[aria-label="工作区路径输入"]',
    ) as HTMLInputElement | null;
    const openButton = Array.from(rendered.querySelectorAll('button')).find(
      (button) => button.textContent?.trim() === '打开路径',
    );

    expect(pathInput).not.toBeNull();
    expect(openButton).not.toBeNull();

    act(() => {
      const valueSetter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
      valueSetter?.call(pathInput, '/second-workspace');
      pathInput!.dispatchEvent(new Event('input', { bubbles: true }));
    });

    await act(async () => {
      await Promise.resolve();
    });

    act(() => {
      openButton?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });

    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(validatePath).toHaveBeenCalledWith('/second-workspace');
    expect(fetchTree).toHaveBeenCalledWith('/second-workspace', 1);
    expect(rendered.textContent).toContain('mobile');
  });

  it('keeps an absolute initial path under filesystem root and can navigate back to slash', async () => {
    const fetchWorkspaceRoots = vi.fn(async () => ['/']);
    const fetchTree = vi.fn(async (path: string): Promise<FileTreeNode[]> => {
      if (path === '/etc') {
        return [{ path: '/etc/nginx', name: 'nginx', type: 'directory' }];
      }
      if (path === '/') {
        return [{ path: '/etc', name: 'etc', type: 'directory' }];
      }

      return [];
    });

    await act(async () => {
      root!.render(
        <WorkspacePickerModal
          isOpen={true}
          onClose={() => undefined}
          onSelect={async () => undefined}
          fetchWorkspaceRoots={fetchWorkspaceRoots}
          fetchTree={fetchTree}
          initialPath="/etc"
        />,
      );
    });

    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

    const pathInput = container?.querySelector(
      'input[aria-label="工作区路径输入"]',
    ) as HTMLInputElement | null;

    expect(pathInput?.value).toBe('/etc');

    const goUpButton = Array.from(container!.querySelectorAll('button')).find(
      (button) => button.textContent?.trim() === '上一级',
    ) as HTMLButtonElement | undefined;

    expect(goUpButton?.disabled).toBe(false);

    act(() => {
      goUpButton?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });

    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(fetchTree).toHaveBeenCalledWith('/etc', 1);
    expect(fetchTree).toHaveBeenCalledWith('/', 1);
    expect(pathInput?.value).toBe('/');
  });
});
