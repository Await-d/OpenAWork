import { z } from 'zod';
/**
 * 提供者配置 Schema
 */
const providerConfigShape = z.object({
  /** API Key */
  apiKey: z.string().min(1, 'API Key 不能为空'),
  /** Base URL */
  baseUrl: z.string().url('Base URL 必须是有效的 URL').optional(),
  allowInsecureLocalhost: z.boolean().optional(),
  /** 超时时间（毫秒） */
  timeout: z.number().int().positive().default(60000),
  /** 最大重试次数 */
  maxRetries: z.number().int().nonnegative().default(3),
  /** 自定义请求头 */
  headers: z.record(z.string(), z.string()).optional(),
  /** 其他自定义配置 */
  extra: z.record(z.string(), z.unknown()).optional(),
});
const METADATA_HOSTS = new Set([
  'metadata',
  'metadata.google.com',
  'metadata.google.internal',
  'metadata.azure.com',
  'metadata.azure.internal',
  'instance-data',
]);
const normalizedHost = (hostname) =>
  hostname
    .toLowerCase()
    .replace(/^\[|\]$/g, '')
    .replace(/\.$/, '');
const parseIpv4 = (hostname) => {
  const octets = hostname.split('.');
  if (octets.length !== 4 || octets.some((part) => !/^\d+$/.test(part))) return undefined;
  const values = octets.map((part) => Number(part));
  return values.every((part) => Number.isInteger(part) && part >= 0 && part <= 255)
    ? values
    : undefined;
};
const parseIpv6 = (hostname) => {
  let value = hostname.toLowerCase();
  if (value.includes('.')) {
    const separator = value.lastIndexOf(':');
    const ipv4 = parseIpv4(value.slice(separator + 1));
    if (separator < 1 || ipv4 === undefined) return undefined;
    const high = ((ipv4[0] ?? 0) << 8) | (ipv4[1] ?? 0);
    const low = ((ipv4[2] ?? 0) << 8) | (ipv4[3] ?? 0);
    value = `${value.slice(0, separator)}${high.toString(16)}:${low.toString(16)}`;
  }
  const sections = value.split('::');
  if (sections.length > 2) return undefined;
  const firstSection = sections[0] ?? '';
  const secondSection = sections[1] ?? '';
  const left = firstSection === '' ? [] : firstSection.split(':');
  const right = sections.length === 2 && secondSection !== '' ? secondSection.split(':') : [];
  const missing = 8 - left.length - right.length;
  if (
    missing < 0 ||
    (sections.length === 1 && missing !== 0) ||
    (sections.length === 2 && missing === 0)
  )
    return undefined;
  const parts = [...left, ...Array.from({ length: missing }, () => '0'), ...right];
  if (parts.length !== 8 || parts.some((part) => !/^[0-9a-f]{1,4}$/.test(part))) return undefined;
  return parts.map((part) => Number.parseInt(part, 16));
};
const isIpv6Loopback = (segments) =>
  segments.slice(0, 7).every((segment) => segment === 0) && segments[7] === 1;
const isLoopbackHost = (hostname) => {
  if (hostname === 'localhost' || hostname.endsWith('.localhost')) return true;
  const ipv4 = parseIpv4(hostname);
  if (ipv4?.[0] === 127) return true;
  const ipv6 = parseIpv6(hostname);
  return ipv6 !== undefined && isIpv6Loopback(ipv6);
};
const isRestrictedIpv4 = (hostname) => {
  const octets = parseIpv4(hostname);
  if (octets === undefined) return /^\d+$/.test(hostname);
  const [first, second] = octets;
  return (
    first === 0 ||
    first === 10 ||
    first === 127 ||
    (first === 169 && second === 254) ||
    (first === 172 && second !== undefined && second >= 16 && second <= 31) ||
    (first === 192 && second === 168) ||
    (first === 100 && second !== undefined && second >= 64 && second <= 127) ||
    (first === 198 && second !== undefined && (second === 18 || second === 19))
  );
};
const isRestrictedIpv6 = (hostname) => {
  const segments = parseIpv6(hostname);
  if (segments === undefined) return false;
  if (segments.every((segment) => segment === 0) || isIpv6Loopback(segments)) return true;
  const first = segments[0] ?? 0;
  if ((first & 0xfe00) === 0xfc00 || (first & 0xffc0) === 0xfe80) return true;
  if (segments.slice(0, 5).every((segment) => segment === 0) && segments[5] === 0xffff) {
    const mapped = [
      (segments[6] ?? 0) >> 8,
      (segments[6] ?? 0) & 0xff,
      (segments[7] ?? 0) >> 8,
      (segments[7] ?? 0) & 0xff,
    ].join('.');
    return isRestrictedIpv4(mapped);
  }
  return false;
};
const isRestrictedHost = (hostname) =>
  METADATA_HOSTS.has(hostname) ||
  hostname === 'host.docker.internal' ||
  isLoopbackHost(hostname) ||
  isRestrictedIpv4(hostname) ||
  isRestrictedIpv6(hostname);
export function validateProviderBaseUrl(baseUrl, options = {}) {
  if (baseUrl === undefined) return;
  const url = new URL(baseUrl);
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new Error('Base URL 必须使用 http 或 https 协议');
  }
  const hostname = normalizedHost(url.hostname);
  if (isRestrictedHost(hostname) && !(options.allowInsecureLocalhost && isLoopbackHost(hostname))) {
    throw new Error('Base URL 指向受限制的本地或内网地址');
  }
}
export const ProviderConfigSchema = providerConfigShape.superRefine((value, context) => {
  if (value.baseUrl === undefined) return;
  try {
    validateProviderBaseUrl(value.baseUrl, {
      allowInsecureLocalhost: value.allowInsecureLocalhost,
    });
  } catch (error) {
    if (error instanceof Error) {
      context.addIssue({ code: 'custom', path: ['baseUrl'], message: error.message });
      return;
    }
    throw error;
  }
});
