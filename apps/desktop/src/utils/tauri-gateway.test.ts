import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  invoke: vi.fn(),
}));

vi.mock('@tauri-apps/api/core', () => ({
  invoke: mocks.invoke,
}));

import { restartDesktopApp, startDesktopGateway, stopDesktopGateway } from './tauri-gateway.js';

describe('tauri-gateway helpers', () => {
  beforeEach(() => {
    mocks.invoke.mockReset();
  });

  it('restarts the desktop app through the restart_app command', async () => {
    await restartDesktopApp();

    expect(mocks.invoke).toHaveBeenCalledWith('restart_app');
  });

  it('starts the gateway through the Tauri command', async () => {
    await startDesktopGateway(3000, 'lan');

    expect(mocks.invoke).toHaveBeenCalledWith('start_gateway', {
      port: 3000,
      host: '0.0.0.0',
    });
  });

  it('stops the gateway through the Tauri command', async () => {
    await stopDesktopGateway();

    expect(mocks.invoke).toHaveBeenCalledWith('stop_gateway');
  });
});
