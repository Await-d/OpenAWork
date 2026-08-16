import { z } from 'zod';
import type { ProviderID } from '../schema/ids.js';

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

export interface ProviderBaseUrlValidationOptions {
  readonly allowInsecureLocalhost?: boolean;
}

const METADATA_HOSTS = new Set([
  'metadata',
  'metadata.google.com',
  'metadata.google.internal',
  'metadata.azure.com',
  'metadata.azure.internal',
  'instance-data',
]);

const normalizedHost = (hostname: string): string =>
  hostname
    .toLowerCase()
    .replace(/^\[|\]$/g, '')
    .replace(/\.$/, '');

const parseIpv4 = (hostname: string): readonly number[] | undefined => {
  const octets = hostname.split('.');
  if (octets.length !== 4 || octets.some((part) => !/^\d+$/.test(part))) return undefined;
  const values = octets.map((part) => Number(part));
  return values.every((part) => Number.isInteger(part) && part >= 0 && part <= 255)
    ? values
    : undefined;
};

const parseIpv6 = (hostname: string): readonly number[] | undefined => {
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

const isIpv6Loopback = (segments: readonly number[]): boolean =>
  segments.slice(0, 7).every((segment) => segment === 0) && segments[7] === 1;

const isLoopbackHost = (hostname: string): boolean => {
  if (hostname === 'localhost' || hostname.endsWith('.localhost')) return true;
  const ipv4 = parseIpv4(hostname);
  if (ipv4?.[0] === 127) return true;
  const ipv6 = parseIpv6(hostname);
  return ipv6 !== undefined && isIpv6Loopback(ipv6);
};

const isRestrictedIpv4 = (hostname: string): boolean => {
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

const isRestrictedIpv6 = (hostname: string): boolean => {
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

const isRestrictedHost = (hostname: string): boolean =>
  METADATA_HOSTS.has(hostname) ||
  hostname === 'host.docker.internal' ||
  isLoopbackHost(hostname) ||
  isRestrictedIpv4(hostname) ||
  isRestrictedIpv6(hostname);

export function validateProviderBaseUrl(
  baseUrl: string | undefined,
  options: ProviderBaseUrlValidationOptions = {},
): void {
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

export type ProviderConfig = z.infer<typeof ProviderConfigSchema>;

/**
 * 提供者元数据
 */
export interface ProviderMetadata {
  /** 提供者 ID */
  readonly id: ProviderID;
  /** 显示名称 */
  readonly displayName: string;
  /** 描述 */
  readonly description?: string;
  /** 支持的模型列表 */
  readonly supportedModels?: readonly string[];
  /** 默认 Base URL */
  readonly defaultBaseUrl?: string;
  /** 是否需要 API Key */
  readonly requiresApiKey: boolean;
}

/**
 * 提供者状态
 */
export type ProviderStatus = 'active' | 'inactive' | 'error';

/**
 * 提供者信息
 */
export interface ProviderInfo extends ProviderMetadata {
  /** 当前状态 */
  readonly status: ProviderStatus;
  /** 配置是否有效 */
  readonly isConfigured: boolean;
  /** 错误信息（如果有） */
  readonly error?: string;
}
