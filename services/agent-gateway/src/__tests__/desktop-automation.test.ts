import { describe, expect, it, vi } from 'vitest';
import {
  createDesktopAutomationManager,
  desktopAutomationToolDefinition,
  runDesktopAutomationTool,
  type DesktopAutomationManager,
} from '../desktop-automation.js';

function createManagerStub(): DesktopAutomationManager {
  return {
    status: vi.fn(async () => ({ enabled: true, started: true })),
    start: vi.fn(async () => undefined),
    goto: vi.fn(async () => undefined),
    click: vi.fn(async () => undefined),
    type: vi.fn(async () => undefined),
    screenshot: vi.fn(async () => 'base64-png'),
  };
}

describe('desktop-automation tool', () => {
  it('fails safely when desktop automation is disabled in this runtime', async () => {
    const manager = createDesktopAutomationManager({ enabled: false });

    await expect(manager.status()).resolves.toEqual({ enabled: false, started: false });
    await expect(runDesktopAutomationTool({ action: 'status' }, manager)).resolves.toBe(
      JSON.stringify({ enabled: false, started: false }),
    );
    await expect(runDesktopAutomationTool({ action: 'screenshot' }, manager)).rejects.toThrow(
      'desktop-only automation is disabled in this runtime',
    );
  });

  it('validates the action-based tool contract', () => {
    expect(
      desktopAutomationToolDefinition.inputSchema.safeParse({ action: 'goto', url: 'invalid-url' })
        .success,
    ).toBe(false);
    expect(
      desktopAutomationToolDefinition.inputSchema.safeParse({
        action: 'type',
        selector: '#query',
        text: 'OpenAWork',
      }).success,
    ).toBe(true);
  });

  it('routes status and screenshot actions through the shared manager contract', async () => {
    const manager = createManagerStub();

    await expect(runDesktopAutomationTool({ action: 'status' }, manager)).resolves.toBe(
      JSON.stringify({ enabled: true, started: true }),
    );
    await expect(runDesktopAutomationTool({ action: 'screenshot' }, manager)).resolves.toBe(
      JSON.stringify({ screenshotBase64: 'base64-png' }),
    );

    expect(manager.status).toHaveBeenCalledOnce();
    expect(manager.screenshot).toHaveBeenCalledOnce();
  });

  it('routes mutating actions through the same manager instance', async () => {
    const manager = createManagerStub();

    await expect(
      runDesktopAutomationTool({ action: 'start', url: 'https://example.com' }, manager),
    ).resolves.toBe(JSON.stringify({ ok: true }));
    await expect(
      runDesktopAutomationTool({ action: 'goto', url: 'https://openai.com' }, manager),
    ).resolves.toBe(JSON.stringify({ ok: true }));
    await expect(
      runDesktopAutomationTool({ action: 'click', selector: '#submit' }, manager),
    ).resolves.toBe(JSON.stringify({ ok: true }));
    await expect(
      runDesktopAutomationTool(
        { action: 'type', selector: 'input[name="q"]', text: 'desktop automation' },
        manager,
      ),
    ).resolves.toBe(JSON.stringify({ ok: true }));

    expect(manager.start).toHaveBeenCalledWith('https://example.com');
    expect(manager.goto).toHaveBeenCalledWith('https://openai.com');
    expect(manager.click).toHaveBeenCalledWith('#submit');
    expect(manager.type).toHaveBeenCalledWith('input[name="q"]', 'desktop automation');
  });
});
