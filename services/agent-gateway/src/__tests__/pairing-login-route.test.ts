import Fastify from 'fastify';
import { describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  setex: vi.fn(),
  sqliteGet: vi.fn(() => ({ id: 'admin-user', email: 'admin@openAwork.local' })),
  sqliteRun: vi.fn(),
}));

vi.mock('../db.js', () => ({
  redis: { setex: mocks.setex },
  sqliteGet: mocks.sqliteGet,
  sqliteRun: mocks.sqliteRun,
}));

import authPlugin from '../auth.js';
import { pairingRoutes } from '../routes/pairing.js';

describe('pairing login route', () => {
  it('exchanges a valid pairing token for a token pair', async () => {
    const app = Fastify();
    await app.register(authPlugin);
    await app.register(pairingRoutes);

    const qrResponse = await app.inject({ method: 'GET', url: '/pairing/qr' });
    expect(qrResponse.statusCode).toBe(200);
    const qrBody = JSON.parse(qrResponse.body) as { qrData: string };
    const qrData = JSON.parse(qrBody.qrData) as { token: string };

    const loginResponse = await app.inject({
      method: 'POST',
      url: '/pairing/login',
      payload: { token: qrData.token, deviceName: 'Mobile', platform: 'android' },
    });

    expect(loginResponse.statusCode).toBe(200);
    const body = JSON.parse(loginResponse.body) as {
      accessToken?: string;
      expiresIn?: string;
      refreshToken?: string;
    };
    expect(body.accessToken).toEqual(expect.any(String));
    expect(body.refreshToken).toEqual(expect.any(String));
    expect(body.expiresIn).toBe('15m');
    expect(mocks.sqliteRun).toHaveBeenCalledWith(
      'INSERT INTO refresh_tokens (id, user_id, token_hash, expires_at) VALUES (?, ?, ?, ?)',
      expect.arrayContaining(['admin-user']),
    );
    expect(mocks.setex).toHaveBeenCalledWith('session:admin-user:active', 900, '1');

    await app.close();
  });
});
