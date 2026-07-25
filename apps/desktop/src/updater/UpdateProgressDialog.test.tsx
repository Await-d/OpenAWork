// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  checkForUpdate: vi.fn(),
  clearProxyCache: vi.fn(),
  downloadUpdate: vi.fn(),
  installUpdate: vi.fn(),
  restartDesktopApp: vi.fn(),
  stopDesktopGateway: vi.fn(),
  MockUpdateError: class MockUpdateError extends Error {
    constructor(
      public readonly kind: string,
      message: string,
    ) {
      super(message);
      this.name = 'MockUpdateError';
    }
  },
}));

vi.mock('./auto-update.js', () => ({
  checkForUpdate: mocks.checkForUpdate,
  clearProxyCache: mocks.clearProxyCache,
  downloadUpdate: mocks.downloadUpdate,
  installUpdate: mocks.installUpdate,
  toUpdateError: (error: unknown) =>
    error instanceof mocks.MockUpdateError
      ? error
      : new mocks.MockUpdateError(
          'unknown',
          error instanceof Error ? error.message : String(error),
        ),
  UpdateError: mocks.MockUpdateError,
}));

vi.mock('../utils/tauri-gateway.js', () => ({
  restartDesktopApp: mocks.restartDesktopApp,
  stopDesktopGateway: mocks.stopDesktopGateway,
}));

import { UpdateProgressDialog } from './UpdateProgressDialog.js';

function createNativeUpdateStub(): object {
  return {};
}

async function flushEffects(): Promise<void> {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
}

function findButton(container: HTMLElement, label: string): HTMLButtonElement | null {
  return (
    Array.from(container.querySelectorAll('button')).find(
      (button): button is HTMLButtonElement => button.textContent?.trim() === label,
    ) ?? null
  );
}

describe('UpdateProgressDialog', () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
    mocks.checkForUpdate.mockReset();
    mocks.clearProxyCache.mockReset();
    mocks.downloadUpdate.mockReset();
    mocks.installUpdate.mockReset();
    mocks.restartDesktopApp.mockReset();
    mocks.stopDesktopGateway.mockReset();
    mocks.stopDesktopGateway.mockResolvedValue(undefined);
  });

  afterEach(async () => {
    await act(async () => {
      root.unmount();
    });
    container.remove();
  });

  it('自动检查发现新版本时显示更新按钮', async () => {
    mocks.checkForUpdate.mockResolvedValue({
      available: true,
      update: createNativeUpdateStub(),
      version: '0.8.7',
      notes: 'preview update',
      installMode: 'native',
      channel: 'preview',
      proxyUsed: null,
    });

    await act(async () => {
      root.render(<UpdateProgressDialog autoCheck onClose={() => undefined} />);
    });
    await flushEffects();

    expect(container.textContent).toContain('发现新版本 0.8.7');
    expect(findButton(container, '更新')).toBeTruthy();
  });

  it('点击更新后完成下载与安装并显示重启按钮', async () => {
    const update = createNativeUpdateStub();
    mocks.checkForUpdate.mockResolvedValue({
      available: true,
      update,
      version: '0.8.7',
      notes: null,
      installMode: 'native',
      channel: 'preview',
      proxyUsed: null,
    });
    mocks.downloadUpdate.mockImplementation(
      async (
        _update: unknown,
        onProgress: (progress: {
          downloaded: number;
          total: number | null;
          percent: number;
        }) => void,
      ) => {
        onProgress({ downloaded: 10, total: 10, percent: 100 });
      },
    );
    mocks.installUpdate.mockResolvedValue(undefined);

    await act(async () => {
      root.render(<UpdateProgressDialog autoCheck onClose={() => undefined} />);
    });
    await flushEffects();

    const updateButton = findButton(container, '更新');
    if (!updateButton) {
      throw new Error('Expected 更新 button to be present');
    }

    await act(async () => {
      updateButton.click();
      await Promise.resolve();
    });
    await flushEffects();

    expect(mocks.downloadUpdate).toHaveBeenCalledWith(
      update,
      expect.any(Function),
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    );
    expect(mocks.installUpdate).toHaveBeenCalledWith(
      update,
      expect.objectContaining({ beforeInstall: expect.any(Function) }),
    );
    expect(findButton(container, '重启')).toBeTruthy();
  });
});
