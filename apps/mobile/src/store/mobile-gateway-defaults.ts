const DEFAULT_GATEWAY_PORT = 3000;

export type MobileRuntimePlatform = 'ios' | 'android';

function isLoopbackHostname(hostname: string): boolean {
  return hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '::1';
}

function isLocalDevelopmentHostname(hostname: string): boolean {
  if (
    hostname === 'localhost' ||
    hostname === '127.0.0.1' ||
    hostname === '::1' ||
    hostname === '10.0.2.2' ||
    hostname === '10.0.3.2'
  ) {
    return true;
  }

  if (/^10\./.test(hostname) || /^192\.168\./.test(hostname)) {
    return true;
  }

  const private172 = /^172\.(1[6-9]|2\d|3[0-1])\./.test(hostname);
  return private172 || hostname.endsWith('.local');
}

function platformDefaultGatewayUrl(platform: MobileRuntimePlatform): string {
  if (platform === 'android') {
    return `http://10.0.2.2:${DEFAULT_GATEWAY_PORT}`;
  }
  return `http://localhost:${DEFAULT_GATEWAY_PORT}`;
}

function rewriteLoopbackGatewayUrlForPlatform(
  rawUrl: string,
  platform: MobileRuntimePlatform,
): string {
  if (platform !== 'android') {
    return rawUrl.trim();
  }

  try {
    const parsed = new URL(rawUrl.trim());
    if (!isLoopbackHostname(parsed.hostname)) {
      return rawUrl.trim();
    }
    parsed.hostname = '10.0.2.2';
    return parsed.toString();
  } catch {
    return rawUrl.trim();
  }
}

export function normalizeMobileGatewayUrl(rawUrl: string): string {
  const normalized = rawUrl.trim().replace(/\/+$/, '');
  let parsed: URL;
  try {
    parsed = new URL(normalized);
  } catch {
    throw new Error('网关地址格式不正确，请输入完整的 http(s):// 地址。');
  }

  if (parsed.protocol === 'https:') {
    return normalized;
  }

  if (parsed.protocol === 'http:' && isLocalDevelopmentHostname(parsed.hostname)) {
    return normalized;
  }

  throw new Error('移动端仅允许 HTTPS 网关；本地开发时可使用 localhost 或局域网私网地址。');
}

export function resolveDefaultMobileGatewayUrl(
  platform: MobileRuntimePlatform,
  configuredGatewayUrl: string | undefined,
): string {
  const configured = configuredGatewayUrl?.trim();
  if (configured) {
    const rewritten = rewriteLoopbackGatewayUrlForPlatform(configured, platform);
    try {
      return normalizeMobileGatewayUrl(rewritten);
    } catch (error: unknown) {
      if (error instanceof Error) {
        return platformDefaultGatewayUrl(platform);
      }
      throw error;
    }
  }
  return platformDefaultGatewayUrl(platform);
}
