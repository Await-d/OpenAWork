import { describe, it, expect, vi, afterEach } from 'vitest';
import { PairingManagerImpl } from '../manager.js';

afterEach(() => vi.restoreAllMocks());

describe('PairingManagerImpl', () => {
  it('generatePairingCode returns valid session', async () => {
    const mgr = new PairingManagerImpl(3000);
    const session = await mgr.generatePairingCode();

    expect(session.token).toHaveLength(32);
    expect(session.hostUrl).toMatch(/^http:\/\//);
    expect(session.expiresAt).toBeGreaterThan(Date.now());
    const qrData = JSON.parse(session.qrData) as { token: string; version: string };
    expect(qrData.token).toBe(session.token);
    expect(qrData.version).toBe('1');
  });

  it('confirmClient resolves waitForClient promise', async () => {
    const mgr = new PairingManagerImpl();
    const session = await mgr.generatePairingCode();

    const clientInfo = {
      deviceName: 'Test Device',
      platform: 'ios' as const,
      connectedAt: Date.now(),
    };
    const waitPromise = mgr.waitForClient(session.token);
    const confirmed = mgr.confirmClient(session.token, clientInfo);

    expect(confirmed).toBe(true);
    const result = await waitPromise;
    expect(result.deviceName).toBe('Test Device');
  });

  it('confirmClient returns false for unknown token', async () => {
    const mgr = new PairingManagerImpl();
    const result = mgr.confirmClient('unknown-token-xxx', {
      deviceName: 'x',
      platform: 'ios',
      connectedAt: Date.now(),
    });
    expect(result).toBe(false);
  });

  it('connectWithToken calls pairing endpoint', async () => {
    const spy = vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({}),
    } as Response);

    const mgr = new PairingManagerImpl();
    await mgr.connectWithToken('http://192.168.1.5:3000', 'abc123');

    expect(spy).toHaveBeenCalledWith(
      'http://192.168.1.5:3000/pairing/connect',
      expect.objectContaining({ method: 'POST' }),
    );
    expect(mgr.isConnected).toBe(true);
  });

  it('disconnect clears connection state', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({}),
    } as Response);
    const mgr = new PairingManagerImpl();
    await mgr.connectWithToken('http://host', 'tok');
    await mgr.disconnect();
    expect(mgr.isConnected).toBe(false);
  });

  it('verifyConnection returns false when not connected', async () => {
    const mgr = new PairingManagerImpl();
    const result = await mgr.verifyConnection();
    expect(result).toBe(false);
  });
});
