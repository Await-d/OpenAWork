import { afterEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  tauriInvoke: vi.fn(),
}));

vi.mock('../settings/shared/settings-page-helpers.js', () => ({
  tauriInvoke: mocks.tauriInvoke,
}));

import { openDesktopUpdatePanel } from './about-page-desktop-update.js';

describe('openDesktopUpdatePanel', () => {
  afterEach(() => {
    mocks.tauriInvoke.mockReset();
  });

  it('通过 Rust 命令打开桌面更新面板并传递 autoStart', async () => {
    mocks.tauriInvoke.mockResolvedValue(undefined);

    await openDesktopUpdatePanel();

    expect(mocks.tauriInvoke).toHaveBeenCalledWith('open_update_panel', {
      autoStart: true,
    });
  });
});
