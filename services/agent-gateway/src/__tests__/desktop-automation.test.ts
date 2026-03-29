import { describe, expect, it, vi } from 'vitest';
import {
  createDesktopAutomationManager,
  type DesktopAutomationDriver,
} from '../desktop-automation.js';

describe('DesktopAutomationManager', () => {
  it('returns unavailable when desktop automation is disabled', async () => {
    const manager = createDesktopAutomationManager({ enabled: false });
    await expect(manager.status()).resolves.toEqual({ enabled: false, started: false });
    await expect(manager.screenshot()).rejects.toThrow('desktop-only');
  });

  it('delegates start/goto/click/type/screenshot to the desktop driver when enabled', async () => {
    const startMock = vi.fn(async () => undefined);
    const isStartedMock = vi.fn(() => true);
    const gotoMock = vi.fn(async (_url: string) => undefined);
    const clickMock = vi.fn(async (_selector: string) => undefined);
    const typeMock = vi.fn(async (_selector: string, _text: string) => undefined);
    const screenshotMock = vi.fn(async () => Buffer.from('shot').toString('base64'));
    const driver: DesktopAutomationDriver = {
      start: startMock,
      isStarted: isStartedMock,
      goto: gotoMock,
      click: clickMock,
      type: typeMock,
      screenshot: screenshotMock,
    };

    const manager = createDesktopAutomationManager({ enabled: true, driver });
    await manager.start('https://example.com');
    await manager.goto('https://example.com/docs');
    await manager.click('#submit');
    await manager.type('#editor', 'hello');
    const screenshot = await manager.screenshot();

    expect(startMock).toHaveBeenCalledWith('https://example.com');
    expect(gotoMock).toHaveBeenCalledWith('https://example.com/docs');
    expect(clickMock).toHaveBeenCalledWith('#submit');
    expect(typeMock).toHaveBeenCalledWith('#editor', 'hello');
    expect(screenshot).toBe(Buffer.from('shot').toString('base64'));
  });
});
