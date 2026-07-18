import { describe, expect, it } from 'vitest';
import {
  normalizeMobileGatewayUrl,
  resolveDefaultMobileGatewayUrl,
} from './mobile-gateway-defaults.js';

describe('resolveDefaultMobileGatewayUrl', () => {
  it('优先使用 Expo 构建时注入的 HTTPS 网关地址', () => {
    expect(resolveDefaultMobileGatewayUrl('ios', 'https://gateway.openwork.app/')).toBe(
      'https://gateway.openwork.app',
    );
  });

  it('在 Android 上把 localhost 开发地址改写成模拟器可访问的 10.0.2.2', () => {
    expect(resolveDefaultMobileGatewayUrl('android', 'http://localhost:3000')).toBe(
      'http://10.0.2.2:3000',
    );
    expect(resolveDefaultMobileGatewayUrl('android', 'http://127.0.0.1:4010')).toBe(
      'http://10.0.2.2:4010',
    );
  });

  it('构建配置无效时回退到平台默认地址', () => {
    expect(resolveDefaultMobileGatewayUrl('android', 'not-a-url')).toBe('http://10.0.2.2:3000');
    expect(resolveDefaultMobileGatewayUrl('ios', '')).toBe('http://localhost:3000');
  });
});

describe('normalizeMobileGatewayUrl', () => {
  it('允许局域网私网 HTTP 地址', () => {
    expect(normalizeMobileGatewayUrl('http://192.168.1.20:3000/')).toBe(
      'http://192.168.1.20:3000',
    );
  });

  it('拒绝公网 HTTP 地址', () => {
    expect(() => normalizeMobileGatewayUrl('http://gateway.openwork.app')).toThrow(
      '移动端仅允许 HTTPS 网关；本地开发时可使用 localhost 或局域网私网地址。',
    );
  });
});
