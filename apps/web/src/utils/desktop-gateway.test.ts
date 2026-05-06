import { describe, expect, it } from 'vitest';
import { gatewayBindHost } from './desktop-gateway.js';

describe('gatewayBindHost', () => {
  it('returns 127.0.0.1 for localhost mode (default desktop-only access)', () => {
    expect(gatewayBindHost('localhost')).toBe('127.0.0.1');
  });

  it('returns 0.0.0.0 for lan mode (LAN sharing across same Wi-Fi)', () => {
    expect(gatewayBindHost('lan')).toBe('0.0.0.0');
  });
});
